import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Prescription } from './entities/prescription.entity';
import { OrderEvent } from './entities/order-event.entity';
import { User } from '../users/entities/user.entity';
import { businessLabel } from '../helpers/business-values';
import {
  FormOptionsService,
  managedValue,
  contractError,
} from '../form_options/form-options.service';
import { EntityManager } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { isUUID, validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreatePrescriptionDto } from './prescription.dto';
import { ResponseHelper } from '../helpers/response-helper';
import { catalogueMedicineScope } from '../operations/operational-resources';

const ELIGIBLE_PHARMACY = `h.facility_type='PHARMACY' AND h.status='ACTIVE' AND h.deleted_at IS NULL
 AND length(trim(h.name))>0 AND EXISTS (SELECT 1 FROM users u WHERE u.hospital_id=h.id AND u.active=true
 AND u.account_type IN ('PHARMACIST','PHARMACY_STORE') AND u.verification_status='VERIFIED'
 AND COALESCE((SELECT v.status FROM verification_applications v WHERE v.user_id=u.id ORDER BY v.submitted_at DESC,v.id DESC LIMIT 1),'VERIFIED')='VERIFIED')`;

@Injectable()
export class PrescriptionsService {
  constructor(
    @InjectRepository(Prescription)
    private readonly prescriptions: Repository<Prescription>,
    @InjectRepository(OrderEvent)
    private readonly events: Repository<OrderEvent>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly options: FormOptionsService,
  ) {}
  async pharmacies(actorId: string, query: { page?: number; limit?: number }) {
    await this.options.actor(actorId, 'prescription');
    const page = query.page ?? 1,
      limit = query.limit ?? 100;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      contractError(
        422,
        'INVALID_PAGINATION',
        'page must be positive and limit must be between 1 and 100.',
      );
    return this.users.manager.transaction(
      'REPEATABLE READ',
      async (manager) => {
        const [count] = await manager.query<{ total: number }[]>(
          `SELECT count(*)::int total FROM hospitals h WHERE ${ELIGIBLE_PHARMACY}`,
        );
        const items = await manager.query<
          {
            id: string;
            name: string;
            city: string | null;
            status: string;
            verified: boolean;
          }[]
        >(
          `SELECT h.id,h.name,h.city,h.status,true verified FROM hospitals h WHERE ${ELIGIBLE_PHARMACY} ORDER BY h.name,h.id LIMIT $1 OFFSET $2`,
          [limit, (page - 1) * limit],
        );
        return ResponseHelper.Success('Eligible pharmacies loaded', {
          items,
          pagination: { page, limit, total: count.total },
        });
      },
    );
  }
  private async pharmacy(manager: EntityManager, id: string) {
    const rows = await manager.query<{ id: string }[]>(
      `SELECT h.id FROM hospitals h WHERE h.id=$1 AND ${ELIGIBLE_PHARMACY} FOR SHARE`,
      [id],
    );
    if (!rows.length)
      contractError(
        422,
        'PHARMACY_UNAVAILABLE',
        'Select an active, verified pharmacy from the pharmacy directory.',
      );
  }
  async create(
    data: Partial<Prescription>,
    actorId?: string,
    facilityScope?: string,
  ) {
    void facilityScope;
    if (!data || typeof data !== 'object' || Array.isArray(data))
      contractError(
        422,
        'INVALID_PRESCRIPTION',
        'Send a prescription JSON object.',
      );
    const errors = validateSync(plainToInstance(CreatePrescriptionDto, data), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length)
      contractError(
        422,
        'INVALID_PRESCRIPTION',
        errors
          .flatMap((error) => Object.values(error.constraints ?? {}))
          .join('; '),
      );
    const actor = await this.options.prescriber(actorId ?? '');
    if (data.prescriber_id && data.prescriber_id !== actor.id)
      contractError(
        403,
        'PRESCRIBER_MISMATCH',
        'The prescriber must be the authenticated doctor.',
      );
    if (!data.icd10 || !/^C\d{2}(\.\d{1,2})?$/.test(data.icd10))
      throw new BadRequestException('A valid ICD-10 cancer code is required');
    if (
      !data.patient_ref ||
      !data.drug_id ||
      !data.pharmacy_facility_id ||
      !isUUID(data.drug_id) ||
      !isUUID(data.pharmacy_facility_id) ||
      !Number.isSafeInteger(data.qty) ||
      (data.qty ?? 0) < 1
    )
      throw new BadRequestException(
        'Patient reference, drug, facility, prescriber and positive quantity are required',
      );
    return this.prescriptions.manager.transaction(async (manager) => {
      await this.options.prescriber(actorId ?? '', manager);
      await managedValue(manager, 'prescription', data.insurer);
      await this.pharmacy(manager, data.pharmacy_facility_id!);
      const medicines = await manager.query<{ id: string }[]>(
        `SELECT m.id FROM medicines m WHERE m.id=$1 AND m.deleted_at IS NULL AND ${catalogueMedicineScope('$2')} FOR SHARE OF m`,
        [data.drug_id, actor.hospital.id],
      );
      if (!medicines.length)
        contractError(
          422,
          'MEDICINE_UNAVAILABLE',
          'Select a current medicine from the medicine catalogue.',
        );
      const row = await manager.getRepository(Prescription).save({
        display_id: `#${randomUUID()}`,
        patient_ref: businessLabel(data.patient_ref, 'patient reference', 200),
        icd10: data.icd10,
        tnm_stage: data.tnm_stage,
        drug_id: data.drug_id,
        qty: data.qty,
        insurer: data.insurer,
        pharmacy_facility_id: data.pharmacy_facility_id,
        prescriber_id: actor.id,
        auth_status: 'Pending',
        order_stage: 'Waiting',
      });
      await manager.getRepository(OrderEvent).save({
        order_id: row.id,
        step: 'Prescription Created',
        state: 'done',
      });
      return ResponseHelper.Success('Prescription created', row);
    });
  }
  async findAll(tab?: string, facilityScope?: string) {
    const rows = await this.prescriptions.find({
      where:
        facilityScope !== undefined
          ? { pharmacy_facility_id: facilityScope }
          : {},
      order: { created_at: 'DESC' },
    });
    const filtered =
      tab === 'awaiting'
        ? rows.filter((r) => r.auth_status === 'Pending')
        : tab === 'completed'
          ? rows.filter(
              (r) =>
                r.order_stage === 'Delivered' || r.order_stage === 'Dispensed',
            )
          : rows.filter(
              (r) =>
                r.order_stage !== 'Delivered' && r.order_stage !== 'Dispensed',
            );
    return {
      prescriptions: filtered,
      counts: {
        active: rows.filter(
          (r) => !['Delivered', 'Dispensed'].includes(r.order_stage),
        ).length,
        awaiting: rows.filter((r) => r.auth_status === 'Pending').length,
        completed: rows.filter((r) =>
          ['Delivered', 'Dispensed'].includes(r.order_stage),
        ).length,
      },
    };
  }
  async update(
    id: string,
    data: Partial<Prescription>,
    facilityScope?: string,
  ) {
    return this.prescriptions.manager.transaction(async (manager) => {
      const repository = manager.getRepository(Prescription);
      const where = {
        id,
        ...(facilityScope !== undefined
          ? { pharmacy_facility_id: facilityScope }
          : {}),
      };
      const row = await repository.findOne({
        where,
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) throw new NotFoundException('Prescription not found');
      if (Object.hasOwn(data, 'insurer')) {
        data.insurer = businessLabel(
          data.insurer,
          'insurer/payment method',
          120,
        );
        await managedValue(manager, 'prescription', data.insurer);
      }
      if (
        data.qty !== undefined &&
        (!Number.isSafeInteger(data.qty) ||
          data.qty < 1 ||
          data.qty > 2147483647)
      )
        contractError(
          422,
          'INVALID_QUANTITY',
          'qty must be a positive whole number.',
        );
      if (data.icd10 !== undefined && !/^C\d{2}(\.\d{1,2})?$/.test(data.icd10))
        contractError(
          422,
          'INVALID_ICD10',
          'A valid ICD-10 cancer code is required.',
        );
      if (data.patient_ref !== undefined)
        data.patient_ref = businessLabel(
          data.patient_ref,
          'patient reference',
          200,
        );
      if (data.drug_id !== undefined) {
        if (!isUUID(data.drug_id))
          contractError(422, 'INVALID_MEDICINE', 'Select a valid medicine.');
        const rows = await manager.query<{ id: string }[]>(
          'SELECT id FROM medicines WHERE id=$1 AND deleted_at IS NULL FOR SHARE',
          [data.drug_id],
        );
        if (!rows.length)
          contractError(
            422,
            'MEDICINE_UNAVAILABLE',
            'Select a current medicine.',
          );
      }
      const changes = { ...data };
      for (const key of [
        'id',
        'created_at',
        'updated_at',
        'pharmacy_facility_id',
        'prescriber_id',
      ] as const)
        delete changes[key];
      Object.assign(row, changes);
      return repository.save(row);
    });
  }
  async eventsFor(id: string, facilityScope?: string, actorId?: string) {
    if (
      !(await this.prescriptions.exists({
        where: [
          {
            id,
            ...(facilityScope !== undefined
              ? { pharmacy_facility_id: facilityScope }
              : {}),
          },
          ...(facilityScope !== undefined && actorId
            ? [{ id, prescriber_id: actorId }]
            : []),
        ],
      }))
    )
      throw new NotFoundException('Prescription not found');
    return this.events.find({ where: { order_id: id }, order: { at: 'ASC' } });
  }
}
