import { DataSource, EntityManager, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { RegistryMetadataService } from './registry-metadata.service';
import { IntegrationConfiguration } from '../admin/entities/integration-configuration.entity';
import { HospitalService } from '../hospital/hospital.service';
import { Hospital } from '../hospital/entities/hospital.entity';
import { User } from '../users/entities/user.entity';
import { RolePermission } from '../role/entities/role-permission.entity';
import { FacilityMembershipRequest } from '../hospital/entities/facility-membership-request.entity';
import { FacilityLicenseCheck } from '../hospital/entities/facility-license-check.entity';
import { VerificationApplication } from '../verification_applications/entities/verification-application.entity';
import { VerificationApplicationsService } from '../verification_applications/verification-applications.service';
import { AuditLog } from '../audit_log/entities/audit_log.entity';
import { EncryptionService } from '../encryption/encryption.service';
import { UsersService } from '../users/users.service';

describe('registry metadata on existing review records', () => {
  let hospital: HospitalService;
  let applications: VerificationApplicationsService;
  let review: Record<string, unknown>;
  beforeEach(() => {
    const actor = {
      id: 'reviewer',
      active: true,
      verification_status: 'VERIFIED',
      role: { id: 1, name: 'FACILITY_ADMIN' },
      hospital: { id: 'facility', status: 'ACTIVE', deleted_at: null },
    };
    const applicant = {
      id: 'applicant',
      license_registry: 'PCN',
      active: false,
      verification_status: 'MANUAL_REVIEW',
    };
    const application = {
      id: 'application',
      user_id: 'applicant',
      registry: 'PCN',
      status: 'MANUAL_REVIEW',
    };
    const member = {
      id: 'membership',
      user_id: 'applicant',
      facility_id: 'facility',
      status: 'PENDING',
    };
    review = {
      id: 'review',
      registry: 'PCN',
      result: 'UNAVAILABLE',
      evidence: 'Provider unavailable.',
      membership_request_id: 'membership',
      checked_at: new Date(),
    };
    const users = {
      findOne: jest.fn(async (options) =>
        options.where.id === actor.id ? actor : applicant,
      ),
      findOneBy: jest.fn(async () => applicant),
    };
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === IntegrationConfiguration)
          return {
            findOneBy: async () => ({
              values: { pcn_registry_name: 'Configured pharmacy registry' },
            }),
          };
        if (entity === User) return users;
        if (entity === RolePermission)
          return {
            findOneBy: async () => ({ permission: 'facility.users.manage' }),
          };
        if (entity === FacilityMembershipRequest)
          return { find: async () => [member], findOne: async () => member };
        if (entity === VerificationApplication)
          return { findOne: async () => application };
        if (entity === FacilityLicenseCheck)
          return {
            findOne: async () => review,
            save: async (row) => ({
              ...row,
              id: 'review',
              checked_at: review.checked_at,
            }),
          };
        if (entity === AuditLog) return { save: jest.fn() };
        throw new Error('Unexpected repository');
      },
    };
    const db = {
      manager,
      getRepository: manager.getRepository,
      transaction: async (callback) =>
        callback(manager as unknown as EntityManager),
    } as unknown as DataSource;
    const metadata = new RegistryMetadataService(db);
    const encryption = {
      decrypt: (value: string) => value,
    } as EncryptionService;
    hospital = new HospitalService(
      {} as Repository<Hospital>,
      encryption,
      {} as UsersService,
      users as unknown as Repository<User>,
      {} as JwtService,
      db,
      metadata,
    );
    applications = new VerificationApplicationsService(
      {
        find: async () => [
          application,
          { ...application, id: 'legacy', registry: 'UNCONFIGURED' },
        ],
      } as unknown as Repository<VerificationApplication>,
      db,
      encryption,
      metadata,
    );
  });
  it('includes names on both the applicant and latest persisted facility review after refresh', async () => {
    const result = await hospital.membershipRequests('reviewer');
    expect(result.data).toMatchObject({
      requests: [
        {
          user: {
            registry: 'PCN',
            license_registry: 'PCN',
            registry_name: 'Configured pharmacy registry',
          },
          facility_license_review: {
            registry: 'PCN',
            registry_name: 'Configured pharmacy registry',
            result: 'UNAVAILABLE',
          },
        },
      ],
    });
  });
  it('includes names in manual evidence submission responses without changing the stored evidence contract', async () => {
    const result = await hospital.recordMembershipLicenseCheck(
      'membership',
      { result: 'UNAVAILABLE', evidence: 'Provider unavailable.' },
      'reviewer',
      'ip',
    );
    expect(result.data).toMatchObject({
      registry: 'PCN',
      registry_name: 'Configured pharmacy registry',
      result: 'UNAVAILABLE',
      evidence: 'Provider unavailable.',
    });
  });
  it('adds optional names to central licence application records and preserves unknown codes', async () => {
    expect(await applications.all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          registry: 'PCN',
          registry_name: 'Configured pharmacy registry',
        }),
        expect.objectContaining({
          registry: 'UNCONFIGURED',
          registry_name: null,
        }),
      ]),
    );
  });
});
