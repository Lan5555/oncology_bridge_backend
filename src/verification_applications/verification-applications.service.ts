import {
  ConflictException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { VerificationApplication } from './entities/verification-application.entity';
import { User } from '../users/entities/user.entity';
import { Hospital } from '../hospital/entities/hospital.entity';
import { AuditLog } from '../audit_log/entities/audit_log.entity';
import { Notification } from '../notification/entities/notification.entity';
import { EncryptionService } from '../encryption/encryption.service';
import { ResponseHelper } from '../helpers/response-helper';
import { FacilityMembershipRequest } from '../hospital/entities/facility-membership-request.entity';

@Injectable()
export class VerificationApplicationsService {
  private readonly rechecks = new Map<string, number[]>();
  constructor(
    @InjectRepository(VerificationApplication)
    private readonly rows: Repository<VerificationApplication>,
    private readonly dataSource: DataSource,
    private readonly encryption: EncryptionService,
  ) {}

  async adminList(options: { status?: string; page?: number; limit?: number; q?: string }) {
    const page = Math.max(1, Math.floor(options.page || 1));
    const limit = Math.min(100, Math.max(1, Math.floor(options.limit || 50)));
    const status = (options.status || 'ALL').toUpperCase();
    if (!['ALL', 'PENDING', 'MANUAL_REVIEW', 'VERIFIED', 'REJECTED'].includes(status))
      throw new BadRequestException('Unsupported verification status filter');
    const qb = this.rows.createQueryBuilder('app')
      .leftJoin(User, 'u', 'u.id = app.user_id')
      .leftJoin(Hospital, 'h', 'h.id = u.hospital_id')
      .select([
        'app.id AS app_id', 'app.status AS app_status', 'app.registry AS app_registry',
        'app.registry_result AS app_result', 'app.license_number AS app_license',
        'app.submitted_at AS app_submitted', 'app.reviewed_at AS app_reviewed',
        'app.reason AS app_reason', 'app.reviewer_id AS app_reviewer_id',
        'app.last_checked_at AS app_last_checked', 'u.id AS user_id', 'u.first_name AS first_name',
        'u.last_name AS last_name', 'u.email AS email', 'u.email_hash AS email_hash',
        'u.account_type AS account_type', 'u.verification_status AS user_verification',
        'u.active AS user_active', 'h.id AS facility_id', 'h.name AS facility_name',
        'h.facility_type AS facility_type', 'h.hospital_code AS hospital_code',
        'h.status AS facility_status', 'h.city AS city', 'h.state AS state',
      ]);
    if (status !== 'ALL') qb.andWhere('app.status = :status', { status });
    const q = options.q?.trim();
    if (q) {
      const emailHash = this.encryption.hash(q.toLowerCase());
      qb.andWhere(
        `(LOWER(u.first_name) LIKE LOWER(:q) OR LOWER(u.last_name) LIKE LOWER(:q) OR LOWER(h.name) LIKE LOWER(:q) OR LOWER(app.license_number) LIKE LOWER(:q) OR u.email_hash = :emailHash)`,
        { q: `%${q}%`, emailHash },
      );
    }
    qb.orderBy('app.submitted_at', 'DESC').skip((page - 1) * limit).take(limit);
    const countQuery = this.rows.createQueryBuilder('app')
      .leftJoin(User, 'u', 'u.id = app.user_id')
      .leftJoin(Hospital, 'h', 'h.id = u.hospital_id');
    if (status !== 'ALL') countQuery.andWhere('app.status = :status', { status });
    if (q) {
      const emailHash = this.encryption.hash(q.toLowerCase());
      countQuery.andWhere(
        `(LOWER(u.first_name) LIKE LOWER(:q) OR LOWER(u.last_name) LIKE LOWER(:q) OR LOWER(h.name) LIKE LOWER(:q) OR LOWER(app.license_number) LIKE LOWER(:q) OR u.email_hash = :emailHash)`,
        { q: `%${q}%`, emailHash },
      );
    }
    const [items, total] = await Promise.all([qb.getRawMany(), countQuery.getCount()]);
    const applications = items.map((r: Record<string, any>) => ({
      id: r.app_id, status: r.app_status, registry: r.app_registry,
      registry_result: r.app_result, license_number: r.app_license,
      submitted_at: r.app_submitted, reviewed_at: r.app_reviewed,
      last_checked_at: r.app_last_checked, reviewer_id: r.app_reviewer_id,
      reason: r.app_reason,
      user: r.user_id ? {
        id: r.user_id, first_name: r.first_name, last_name: r.last_name,
        email: this.encryption.decrypt(r.email), account_type: r.account_type,
        verification_status: r.user_verification, active: r.user_active,
      } : null,
      facility: r.facility_id ? {
        id: r.facility_id, name: r.facility_name, facility_type: r.facility_type,
        hospital_code: r.hospital_code, status: r.facility_status,
        city: r.city, state: r.state,
      } : null,
    }));
    return ResponseHelper.Success('Registration applications loaded.', {
      applications, page, limit, total,
    });
  }

  async recheck(id: string, actorId: string, ip: string) {
    const now = Date.now();
    const attempts = (this.rechecks.get(actorId) ?? []).filter((at) => now - at < 60_000);
    if (attempts.length >= 10) throw new HttpException('Recheck rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    attempts.push(now);
    this.rechecks.set(actorId, attempts);
    return this.dataSource.transaction(async (manager) => {
      const rows = manager.getRepository(VerificationApplication);
      const row = await rows.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) throw new NotFoundException('Verification application not found');
      if (['VERIFIED', 'REJECTED'].includes(row.status))
        throw new ConflictException('A decided application cannot be rechecked');
      const previousStatus = row.status;
      row.registry_result = 'UNAVAILABLE';
      row.status = 'MANUAL_REVIEW';
      row.last_checked_at = new Date();
      await rows.save(row);
      await manager.getRepository(User).update({ id: row.user_id }, {
        registry_result: 'UNAVAILABLE', verification_status: 'MANUAL_REVIEW',
      });
      await manager.getRepository(AuditLog).save({
        user: { id: actorId } as User,
        action: 'VERIFICATION_RECHECKED',
        description: `Registry recheck performed for application ${row.id}; provider unavailable`,
        ip_address: ip || 'unknown', event_key: null,
        object_type: 'verification_application', object_id: row.id,
        request_id: null, before_status: previousStatus, after_status: row.status,
      });
      return ResponseHelper.Success('Registry is unavailable; application remains in manual review.', {
        id: row.id, registryResult: row.registry_result, status: row.status,
        checkedAt: row.last_checked_at,
      });
    });
  }

  async decide(id: string, decision: 'VERIFIED' | 'REJECTED', actorId: string, reason?: string, ip?: string) {
    const note = reason?.trim();
    if (decision === 'REJECTED' && !note)
      throw new UnprocessableEntityException('A reason is required to reject an application');
    return this.dataSource.transaction(async (manager) => {
      const rows = manager.getRepository(VerificationApplication);
      const row = await rows.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) throw new NotFoundException('Verification application not found');
      if (!['PENDING', 'MANUAL_REVIEW'].includes(row.status))
        throw new ConflictException('Application has already been decided');
      const previousStatus = row.status;
      const reviewedAt = new Date();
      const users = manager.getRepository(User);
      const user = await users.findOne({ where: { id: row.user_id }, relations: { hospital: true } });
      if (!user) throw new NotFoundException('Applicant not found');
      if (!user.hospital) throw new ConflictException('Applicant facility is missing');
      const facility = user.hospital;
      const membership = await manager.getRepository(FacilityMembershipRequest).findOneBy({ user_id: user.id });
      if (
        user.active ||
        !['PENDING', 'MANUAL_REVIEW'].includes(user.verification_status) ||
        (membership ? facility.status !== 'ACTIVE' : facility.status !== 'PENDING')
      )
        throw new ConflictException(
          'Application, user, and facility must all be pending review before a decision',
        );

      row.status = decision;
      row.reviewer_id = actorId;
      row.reviewed_at = reviewedAt;
      row.reason = note ?? null;
      user.verification_status = decision;
      if (!membership)
        facility.status = decision === 'VERIFIED' ? 'ACTIVE' as any : 'REJECTED' as any;
      user.active = decision === 'VERIFIED' && (!membership || membership.status === 'APPROVED') && facility.status === 'ACTIVE';
      await rows.save(row);
      await users.save(user);
      const audit = manager.getRepository(AuditLog);
      await audit.save({
        user: { id: actorId } as User,
        action: 'VERIFICATION_DECISION',
        description: membership
          ? `Application ${row.id} ${decision.toLowerCase()} for membership applicant ${user.id}`
          : `Application ${row.id} ${decision.toLowerCase()}; facility ${facility.id} set ${facility.status}`,
        ip_address: ip || 'unknown', event_key: null,
        object_type: 'verification_application', object_id: row.id,
        request_id: null, before_status: previousStatus, after_status: decision,
      });
      const message = decision === 'VERIFIED'
        ? user.active
          ? 'Your registration was approved. You can now sign in.'
          : 'Your licence was approved. Facility membership approval is still pending.'
        : `Your registration was not approved. ${note}`;
      await manager.getRepository(Notification).save({
        user, title: decision === 'VERIFIED' ? 'Registration approved' : 'Registration decision',
        message, read: false, cold_chain_outbox_id: null,
      });
      return ResponseHelper.Success('Verification decision recorded.', {
        id: row.id, status: row.status, registry: row.registry,
        registry_result: row.registry_result, license_number: row.license_number,
        submitted_at: row.submitted_at, reviewed_at: row.reviewed_at,
        reason: row.reason,
        user: { id: user.id, first_name: user.first_name, last_name: user.last_name,
          account_type: user.account_type, verification_status: user.verification_status,
          active: user.active },
        facility: { id: facility.id, name: facility.name, facility_type: facility.facility_type,
          hospital_code: facility.hospital_code, status: facility.status,
          city: facility.city, state: facility.state },
      });
    });
  }

  all(status?: string) {
    return this.rows.find({ where: status && status !== 'ALL' ? { status } : {}, order: { submitted_at: 'DESC' } });
  }
  create(): never {
    throw new ConflictException('Applications are created through facility registration');
  }
}
