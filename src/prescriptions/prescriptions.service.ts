import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Prescription } from './entities/prescription.entity';
import { OrderEvent } from './entities/order-event.entity';

@Injectable()
export class PrescriptionsService {
  constructor(
    @InjectRepository(Prescription)
    private readonly prescriptions: Repository<Prescription>,
    @InjectRepository(OrderEvent)
    private readonly events: Repository<OrderEvent>,
  ) {}
  async create(data: Partial<Prescription>) {
    if (!data.icd10 || !/^C\d{2}(\.\d{1,2})?$/.test(data.icd10))
      throw new BadRequestException('A valid ICD-10 cancer code is required');
    if (
      !data.patient_ref ||
      !data.drug_id ||
      !data.pharmacy_facility_id ||
      !data.prescriber_id ||
      !Number.isInteger(data.qty) ||
      (data.qty ?? 0) < 1
    )
      throw new BadRequestException(
        'Patient reference, drug, facility, prescriber and positive quantity are required',
      );
    const display_id = `#${String(Date.now()).slice(-4)}`;
    const row = await this.prescriptions.save(
      this.prescriptions.create({
        ...data,
        display_id,
        auth_status: 'Pending',
        order_stage: 'Waiting',
      }),
    );
    await this.events.save(
      this.events.create({
        order_id: row.id,
        step: 'Stock Ingestion',
        state: 'active',
      }),
    );
    return row;
  }
  async findAll(tab?: string) {
    const rows = await this.prescriptions.find({
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
  async update(id: string, data: Partial<Prescription>) {
    const row = await this.prescriptions.findOneBy({ id });
    if (!row) throw new NotFoundException('Prescription not found');
    const {
      id: _ignored,
      created_at: _created,
      updated_at: _updated,
      ...changes
    } = data;
    Object.assign(row, changes);
    return this.prescriptions.save(row);
  }
  async eventsFor(id: string) {
    if (!(await this.prescriptions.exists({ where: { id } })))
      throw new NotFoundException('Prescription not found');
    return this.events.find({ where: { order_id: id }, order: { at: 'ASC' } });
  }
}
