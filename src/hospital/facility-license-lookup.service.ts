import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { isUUID } from 'class-validator';
import { User } from '../users/entities/user.entity';
import { Hospital } from './entities/hospital.entity';
import { FacilityMembershipRequest } from './entities/facility-membership-request.entity';
import { VerificationApplication } from '../verification_applications/entities/verification-application.entity';
import { RolePermission } from '../role/entities/role-permission.entity';
import { FacilityLicenseCheck } from './entities/facility-license-check.entity';
import { AuditLog } from '../audit_log/entities/audit_log.entity';
import { StockAccessService } from '../guards/stock-access.service';
import { ResponseHelper } from '../helpers/response-helper';
import { LicenseRegistryService } from './license-registry.service';
import { RegistryMetadataService } from '../registry_metadata/registry-metadata.service';

@Injectable()
export class FacilityLicenseLookupService {
  constructor(
    private readonly db: DataSource,
    private readonly registry: LicenseRegistryService,
    private readonly access: StockAccessService,
    private readonly registryMetadata: RegistryMetadataService,
  ) {}

  private async prepare(
    manager: EntityManager,
    requestId: string,
    actorId: string,
    lock = false,
  ) {
    const actor = await manager.getRepository(User).findOne({
      where: { id: actorId },
      relations: { role: true, hospital: true },
    });
    if (!actor?.active || !actor.role)
      throw new ForbiddenException(
        'An active licence reviewer account is required.',
      );
    const network = ['ADMIN', 'SUPERADMIN'].includes(
      actor.role.name.trim().toUpperCase(),
    );
    const grants = await manager
      .getRepository(RolePermission)
      .findBy({ role_id: actor.role.id });
    const permissions = new Set(grants.map((g) => g.permission));
    if (network) {
      if (
        !permissions.has('admin.access') ||
        !permissions.has('verification.decide')
      )
        throw new ForbiddenException(
          'admin.access and verification.decide are required for registry review.',
        );
    } else if (
      actor.role.name.trim().toUpperCase() !== 'FACILITY_ADMIN' ||
      !permissions.has('facility.users.manage') ||
      !(await this.access.verifiedMember(actor, manager))
    )
      throw new ForbiddenException(
        'Active, verified facility administration with facility.users.manage is required.',
      );
    const membership = await manager
      .getRepository(FacilityMembershipRequest)
      .findOne({
        where: { id: requestId },
        ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
      });
    if (!membership)
      throw new NotFoundException('Membership request not found.');
    if (!network && membership.facility_id !== actor.hospital.id)
      throw new ForbiddenException(
        'You cannot check licences for another facility.',
      );
    if (membership.status !== 'PENDING')
      throw new ConflictException(
        'Only pending membership requests can receive a facility licence lookup.',
      );
    const applicant = await manager.getRepository(User).findOne({
      where: { id: membership.user_id },
      relations: { hospital: true },
    });
    const facility = await manager
      .getRepository(Hospital)
      .findOneBy({ id: membership.facility_id });
    if (!applicant || !facility || facility.deleted_at)
      throw new NotFoundException(
        'The membership applicant or facility no longer exists.',
      );
    if (applicant.hospital?.id !== membership.facility_id)
      throw new ConflictException(
        'The applicant facility membership has changed. Reload the membership request.',
      );
    const application = await manager
      .getRepository(VerificationApplication)
      .findOne({
        where: { user_id: applicant.id },
        order: { submitted_at: 'DESC', id: 'DESC' },
      });
    if (!application)
      throw new UnprocessableEntityException(
        'The applicant has no licence verification application.',
      );
    const licenseNumber = (
      applicant.license_number ??
      application.license_number ??
      ''
    )
      .trim()
      .toUpperCase();
    const registry = (applicant.license_registry ?? application.registry ?? '')
      .trim()
      .toUpperCase();
    const professionalType = applicant.account_type?.trim().toUpperCase() ?? '';
    const registries: Record<string, string> = {
      DOCTOR: 'MDCN',
      PHARMACIST: 'PCN',
      PHARMACY_STORE: 'PCN_PREMISES',
    };
    if (
      !/^[A-Z0-9/-]{4,24}$/.test(licenseNumber) ||
      !registry ||
      !registries[professionalType]
    )
      throw new UnprocessableEntityException(
        'Applicant licence number, professional type and registry must be present and valid.',
      );
    if (
      registries[professionalType] !== registry ||
      application.registry?.trim().toUpperCase() !== registry ||
      application.license_number?.trim().toUpperCase() !== licenseNumber
    )
      throw new UnprocessableEntityException(
        'Applicant licence details do not agree with the linked verification application. Correct the applicant records before retrying.',
      );
    const input = {
      licenseNumber,
      registry,
      professionalType,
      lastName: applicant.last_name ?? '',
    };
    const snapshot = JSON.stringify([
      membership.user_id,
      membership.facility_id,
      application.id,
      input,
    ]);
    return { actor, membership, application, input, snapshot };
  }

  async lookup(requestId: string, actorId: string, ip: string) {
    if (!isUUID(requestId))
      throw new BadRequestException('requestId must be a valid UUID.');
    const prepared = await this.prepare(this.db.manager, requestId, actorId);
    // No database locks or transaction are held during the provider call.
    const outcome = await this.registry.lookup(prepared.input);
    if (
      !['MATCH', 'NO_MATCH', 'UNAVAILABLE', 'INCONCLUSIVE'].includes(
        outcome.result,
      ) ||
      typeof outcome.evidence !== 'string' ||
      outcome.evidence.trim().length < 5 ||
      outcome.evidence.length > 4000
    )
      throw new UnprocessableEntityException(
        'The registry adapter did not produce valid review evidence.',
      );
    const registryName = await this.registryMetadata.name(prepared.input.registry);
    return this.db.transaction(async (manager) => {
      const current = await this.prepare(manager, requestId, actorId, true);
      if (current.snapshot !== prepared.snapshot)
        throw new ConflictException(
          'Applicant licence details changed during the lookup. Retry using the updated membership request.',
        );
      const saved = await manager.getRepository(FacilityLicenseCheck).save({
        membership_request_id: requestId,
        facility_id: current.membership.facility_id,
        user_id: current.membership.user_id,
        application_id: current.application.id,
        checked_by: current.actor.id,
        registry: current.input.registry,
        result: outcome.result,
        evidence: outcome.evidence.trim(),
      });
      await manager.getRepository(AuditLog).save({
        user: { id: actorId } as User,
        action: 'FACILITY_LICENSE_LOOKUP_COMPLETED',
        description: `Automated licence lookup ${saved.id} for membership request ${requestId}; result ${saved.result}`,
        ip_address: ip || 'unknown',
        object_type: 'facility_license_check',
        object_id: saved.id,
        event_key: null,
      });
      return ResponseHelper.Success(
        'Registry check completed. Manual review is required.',
        {
          facility_license_review: {
            id: saved.id,
            membership_request_id: saved.membership_request_id,
            facility_id: saved.facility_id,
            user_id: saved.user_id,
            application_id: saved.application_id,
            registry: saved.registry,
            registry_name: registryName,
            result: saved.result,
            evidence: saved.evidence,
            checked_by: saved.checked_by,
            checked_at: saved.checked_at,
            status: 'MANUAL_REVIEW',
          },
        },
      );
    });
  }
}
