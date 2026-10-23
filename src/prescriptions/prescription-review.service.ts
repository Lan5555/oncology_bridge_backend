import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { ResponseHelper } from '../helpers/response-helper';
import { catalogueMedicineScope } from '../operations/operational-resources';
import {
  PrescriptionDecisionDto,
  PrescriptionReviewQueryDto,
} from './prescription-review.dto';

interface ReviewRow {
  id: string;
  patient_ref: string;
  icd10: string;
  description: string | null;
  tnm_stage: string | null;
  insurer: string | null;
  qty: number;
  auth_status: string;
  order_stage: string;
  created_at: Date;
  version: number;
  drug_id: string;
  pharmacy_facility_id: string;
  prescriber_id: string;
  pharmacy: {
    id: string;
    name: string;
    city: string | null;
    state: string | null;
    status: string;
  } | null;
  medicine: { id: string; name: string; strength: string | null } | null;
  prescriber: { id: string; name: string } | null;
  eligible: boolean;
}
const ELIGIBLE = `p.qty>0 AND length(trim(COALESCE(p.insurer,'')))>0 AND m.id IS NOT NULL AND m.deleted_at IS NULL
 AND u.active=true AND (to_jsonb(u)->>'deleted_at') IS NULL AND u.account_type='DOCTOR' AND u.verification_status='VERIFIED'
 AND prescriber_facility.status='ACTIVE' AND prescriber_facility.deleted_at IS NULL
 AND COALESCE((SELECT v.status FROM verification_applications v WHERE v.user_id=u.id ORDER BY v.submitted_at DESC,v.id DESC LIMIT 1),'VERIFIED')='VERIFIED'
 AND ${catalogueMedicineScope('u.hospital_id')}
 AND h.status='ACTIVE' AND h.deleted_at IS NULL AND h.facility_type='PHARMACY' AND length(trim(h.name))>0
 AND EXISTS(SELECT 1 FROM users pharmacist WHERE pharmacist.hospital_id=h.id AND pharmacist.active=true
 AND pharmacist.account_type IN ('PHARMACIST','PHARMACY_STORE') AND pharmacist.verification_status='VERIFIED'
 AND (to_jsonb(pharmacist)->>'deleted_at') IS NULL
 AND COALESCE((SELECT v.status FROM verification_applications v WHERE v.user_id=pharmacist.id ORDER BY v.submitted_at DESC,v.id DESC LIMIT 1),'VERIFIED')='VERIFIED')`;
const STATUS = `CASE WHEN upper(p.auth_status) IN ('CLEARED','APPROVED') THEN 'Approved'
 WHEN upper(p.auth_status)='PENDING' THEN 'Pending' WHEN upper(p.auth_status)='REJECTED' THEN 'Rejected' ELSE p.auth_status END`;
const FROM = `FROM prescriptions p LEFT JOIN medicines m ON m.id=p.drug_id
 LEFT JOIN hospitals h ON h.id=p.pharmacy_facility_id LEFT JOIN users u ON u.id=p.prescriber_id
 LEFT JOIN hospitals prescriber_facility ON prescriber_facility.id=u.hospital_id`;
const SELECT = `SELECT p.*,${STATUS} canonical_status,COALESCE((${ELIGIBLE}),false) eligible,
 CASE WHEN h.id IS NULL THEN NULL ELSE jsonb_build_object('id',h.id,'name',h.name,'city',h.city,'state',h.state,'status',h.status) END pharmacy,
 CASE WHEN m.id IS NULL THEN NULL ELSE jsonb_build_object('id',m.id,'name',m.generic_name,'strength',m.strength) END medicine,
 CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object('id',u.id,'name',concat_ws(' ',u.first_name,u.last_name)) END prescriber ${FROM}`;
type SelectedRow = ReviewRow & { canonical_status: string };

@Injectable()
export class PrescriptionReviewService {
  constructor(private readonly db: DataSource) {}
  private async authorize(m: EntityManager, id: string, decide = false) {
    const [actor] = await m.query<
      { active: boolean; role: string; permissions: string[] }[]
    >(
      `SELECT u.active,r.name role,
     ARRAY(SELECT permission FROM role_permissions WHERE role_id=u.role_id) permissions FROM users u JOIN roles r ON r.id=u.role_id
     WHERE u.id=$1 AND (to_jsonb(u)->>'deleted_at') IS NULL`,
      [id],
    );
    if (
      !actor?.active ||
      ![
        'ADMIN',
        'SUPERADMIN',
        'C',
        'NETWORK ADMIN',
        'NETWORK_ADMIN',
        'NETWORK-ADMIN',
      ].includes(actor.role.trim().toUpperCase()) ||
      !actor.permissions.includes('admin.access') ||
      !actor.permissions.includes('prescription.read') ||
      (decide && !actor.permissions.includes('prescription.review'))
    )
      throw new ForbiddenException(
        'Network prescription review permission required',
      );
    return actor.permissions.includes('prescription.review');
  }
  private summary(row: SelectedRow) {
    return {
      id: row.id,
      patient_ref: row.patient_ref,
      icd10: row.icd10,
      description: row.description ?? null,
      tnm_stage: row.tnm_stage,
      insurer: row.insurer ?? '',
      qty: row.qty,
      auth_status: row.canonical_status,
      order_stage: row.order_stage,
      pharmacy: row.pharmacy,
      pharmacy_name: row.pharmacy?.name ?? null,
      medicine: row.medicine,
      prescriber: row.prescriber,
      created_at: new Date(row.created_at).toISOString(),
    };
  }
  private decisions(row: SelectedRow, canReview: boolean) {
    return canReview &&
      row.eligible &&
      row.canonical_status === 'Pending' &&
      row.order_stage?.trim().toUpperCase() === 'WAITING'
      ? ['APPROVE', 'REJECT']
      : [];
  }
  private async read(m: EntityManager, id: string) {
    const [row] = await m.query<SelectedRow[]>(`${SELECT} WHERE p.id=$1`, [id]);
    if (!row) throw new NotFoundException('Prescription not found');
    return row;
  }
  private async detailData(
    m: EntityManager,
    row: SelectedRow,
    canReview: boolean,
  ) {
    const events = await m.query<
      {
        id: string;
        type: string;
        message: string;
        at: Date;
        actor_name: string | null;
      }[]
    >(
      `SELECT e.id,COALESCE(e.event_type,e.step) type,
      COALESCE(e.message,e.step) message,e.at,NULLIF(trim(concat_ws(' ',a.first_name,a.last_name)),'') actor_name
      FROM order_events e LEFT JOIN users a ON a.id=e.actor_id WHERE e.order_id=$1 ORDER BY e.at,e.review_version NULLS FIRST,e.id`,
      [row.id],
    );
    return {
      ...this.summary(row),
      version: row.version,
      allowedDecisions: this.decisions(row, canReview),
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        message: e.message,
        createdAt: new Date(e.at).toISOString(),
        actorName: e.actor_name,
      })),
    };
  }
  async list(actorId: string, q: PrescriptionReviewQueryDto) {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      await this.authorize(m, actorId);
      const args: unknown[] = [];
      const param = (v: unknown) => {
        args.push(v);
        return `$${args.length}`;
      };
      const where = ['true'];
      if (q.authStatus) where.push(`(${STATUS})=${param(q.authStatus)}`);
      if (q.q?.trim())
        where.push(
          `concat_ws(' ',p.patient_ref,m.generic_name,m.brand_name,h.name,u.first_name,u.last_name) ILIKE ${param(`%${q.q.trim().replace(/[\\%_]/g, '\\$&')}%`)}`,
        );
      const [count] = await m.query<{ total: number }[]>(
        `SELECT count(*)::int total ${FROM} WHERE ${where.join(' AND ')}`,
        args,
      );
      const rows = await m.query<SelectedRow[]>(
        `${SELECT} WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC,p.id DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
        [...args, q.limit, (q.page - 1) * q.limit],
      );
      return ResponseHelper.Success('', {
        items: rows.map((r) => this.summary(r)),
        pagination: {
          page: q.page,
          limit: q.limit,
          total: count.total,
          totalPages: Math.ceil(count.total / q.limit),
        },
      });
    });
  }
  async detail(actorId: string, id: string) {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      const canReview = await this.authorize(m, actorId);
      return ResponseHelper.Success(
        '',
        await this.detailData(m, await this.read(m, id), canReview),
      );
    });
  }
  async decide(
    actorId: string,
    id: string,
    dto: PrescriptionDecisionDto,
    ip: string,
  ) {
    return this.db.transaction(async (m) => {
      await this.authorize(m, actorId, true);
      const locked = await m.query<{ id: string }[]>(
        'SELECT id FROM prescriptions WHERE id=$1 FOR UPDATE',
        [id],
      );
      if (!locked.length) throw new NotFoundException('Prescription not found');
      await this.authorize(m, actorId, true);
      // Hold linked eligibility rows until commit so concurrent suspensions/deletions serialize with review.
      await m.query(
        `SELECT u.id FROM users u JOIN hospitals h ON h.id=u.hospital_id WHERE
       u.id=(SELECT prescriber_id FROM prescriptions WHERE id=$1) OR u.hospital_id=(SELECT pharmacy_facility_id FROM prescriptions WHERE id=$1) FOR SHARE OF u,h`,
        [id],
      );
      await m.query(
        'SELECT id FROM medicines WHERE id=(SELECT drug_id FROM prescriptions WHERE id=$1) FOR SHARE',
        [id],
      );
      const row = await this.read(m, id);
      if (
        row.version !== dto.expectedVersion ||
        !this.decisions(row, true).includes(dto.decision)
      )
        throw new ConflictException(
          'Prescription changed, was reviewed, or is no longer eligible. Reload and review the saved record.',
        );
      const status = dto.decision === 'APPROVE' ? 'Approved' : 'Rejected';
      await m.query(
        'UPDATE prescriptions SET auth_status=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1',
        [id, status],
      );
      const updated = await this.read(m, id);
      const eventId = randomUUID();
      await m.query(
        `INSERT INTO order_events(id,order_id,step,state,at,event_type,message,actor_id,review_version)
       VALUES($1,$2,$3,'done',clock_timestamp(),$4,$5,$6,$7)`,
        [
          eventId,
          id,
          `Authorization ${status}`,
          dto.decision,
          dto.reason,
          actorId,
          updated.version,
        ],
      );
      await m.query(
        `INSERT INTO audit_logs(id,user_id,action,description,ip_address,event_key,object_type,object_id,before_status,after_status)
       VALUES($1,$2,'PRESCRIPTION_REVIEWED',$3,$4,$1,'prescription',$5,$6,$7)`,
        [eventId, actorId, dto.reason, ip, id, row.canonical_status, status],
      );
      return ResponseHelper.Success(
        '',
        await this.detailData(m, updated, true),
      );
    });
  }
}
