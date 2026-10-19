import { DataSource, EntityManager, Repository } from 'typeorm';
import { ExecutionContext } from '@nestjs/common';
import { StockAccessService } from './stock-access.service';
import { InventoryManagementGuard } from './inventory-management.guard';
import { InventoryAccessGrant } from './entities/inventory-access-grant.entity';
import { User } from '../users/entities/user.entity';
import { Hospital } from '../hospital/entities/hospital.entity';
import { Role } from '../role/entities/role.entity';
import { RolePermission } from '../role/entities/role-permission.entity';
import { VerificationApplication } from '../verification_applications/entities/verification-application.entity';
import { AuditLog } from '../audit_log/entities/audit_log.entity';
import { UsersService } from '../users/users.service';
import { EncryptionService } from '../encryption/encryption.service';

describe('explicit facility stock access', () => {
  let access: StockAccessService;
  let users: UsersService;
  let member: User;
  let permissions: string[];
  let individual: boolean;
  let applicationStatus: string;
  let usersRepo: { findOne: jest.Mock };
  let grantsRepo: { existsBy: jest.Mock; upsert: jest.Mock; delete: jest.Mock };
  let auditRepo: { save: jest.Mock };
  let db: DataSource;
  const network = {
    id: 'network',
    role: { id: 99, name: 'ADMIN' },
    active: true,
  } as User;

  beforeEach(() => {
    member = {
      id: 'member',
      account_type: 'PHARMACIST',
      role: { id: 1, name: 'FACILITY_ADMIN' },
      active: true,
      verification_status: 'VERIFIED',
      hospital: { id: 'facility', status: 'ACTIVE', deleted_at: null },
    } as User;
    permissions = ['facility.users.manage'];
    individual = false;
    applicationStatus = 'VERIFIED';
    usersRepo = {
      findOne: jest.fn(async (options) =>
        options.where.id === 'network' ? network : member,
      ),
    };
    grantsRepo = {
      existsBy: jest.fn(
        async (query) => individual && query.facility_id === 'facility',
      ),
      upsert: jest.fn(async () => {
        individual = true;
      }),
      delete: jest.fn(async () => {
        individual = false;
      }),
    };
    auditRepo = { save: jest.fn().mockResolvedValue({}) };
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === User) return usersRepo;
        if (entity === RolePermission)
          return {
            findBy: async (query: { role_id: number }) =>
              (query.role_id === 99
                ? ['admin.access', 'user.update', 'medicine.update']
                : permissions
              ).map((permission) => ({ permission })),
          };
        if (entity === InventoryAccessGrant) return grantsRepo;
        if (entity === VerificationApplication)
          return { findOne: async () => ({ status: applicationStatus }) };
        if (entity === AuditLog) return auditRepo;
        throw new Error('Unexpected entity');
      },
    };
    db = {
      manager,
      getRepository: manager.getRepository,
      transaction: async (callback) =>
        callback(manager as unknown as EntityManager),
    } as unknown as DataSource;
    access = new StockAccessService(db);
    users = new UsersService(
      usersRepo as unknown as Repository<User>,
      { decrypt: (value: string) => value } as EncryptionService,
      {} as Repository<Role>,
      db,
      access,
    );
  });

  it('does not turn team management into stock management', async () => {
    await expect(access.assertManage('member')).rejects.toMatchObject({
      status: 403,
    });
    const info = await users.authenticatedUser('member');
    expect(info.can_manage_facility_users).toBe(true);
    expect(info.permissions).toEqual(['facility.users.manage']);
    expect(info.allowed_pages).not.toContain('pg-scan');
  });
  it.each(['DOCTOR', 'PHARMACIST', 'PHARMACY_STORE'])(
    'allows verified %s stock admins with explicit grants and merges their pages',
    async (account) => {
      member.account_type = account;
      individual = true;
      await expect(access.assertManage('member', 'facility')).resolves.toBe(
        member,
      );
      const info = await users.authenticatedUser('member');
      expect(info.permissions).toEqual(
        expect.arrayContaining(['facility.users.manage', 'inventory.manage']),
      );
      expect(info.allowed_pages).toEqual(
        expect.arrayContaining([
          'pg-dashboard',
          'pg-users',
          'pg-inventory',
          'pg-scan',
          'pg-medicines',
          'pg-marketplace',
          'pg-settings',
        ]),
      );
      expect(info.permissions).not.toContain('marketplace.list');
    },
  );
  it('accepts role stock grants and individual grants without automatically granting team management', async () => {
    member.role.name = 'PHARMACIST';
    permissions = ['inventory.manage'];
    expect(
      (await users.authenticatedUser('member')).can_manage_facility_users,
    ).toBe(false);
    await expect(access.assertManage('member')).resolves.toBe(member);
    permissions = [];
    individual = true;
    expect((await users.authenticatedUser('member')).permissions).toEqual([
      'inventory.manage',
    ]);
  });
  it.each(['MANUAL_REVIEW', 'REJECTED'])(
    'limits %s accounts to dashboard and settings despite grants',
    async (status) => {
      individual = true;
      member.verification_status = status;
      await expect(access.assertManage('member')).rejects.toMatchObject({
        status: 403,
      });
      const info = await users.authenticatedUser('member');
      expect(info.allowed_pages).toEqual(['pg-dashboard', 'pg-settings']);
      expect(info.permissions).not.toContain('inventory.manage');
      expect(info.can_manage_inventory).toBe(false);
    },
  );
  it('uses the latest verification and rejects inactive or suspended memberships', async () => {
    individual = true;
    applicationStatus = 'REJECTED';
    await expect(access.assertManage('member')).rejects.toMatchObject({
      status: 403,
    });
    expect((await users.authenticatedUser('member')).allowed_pages).toEqual([
      'pg-dashboard',
      'pg-settings',
    ]);
    applicationStatus = 'VERIFIED';
    member.active = false;
    await expect(access.assertManage('member')).rejects.toMatchObject({
      status: 403,
    });
    member.active = true;
    member.hospital.status = 'SUSPENDED' as Hospital['status'];
    await expect(access.assertManage('member')).rejects.toMatchObject({
      status: 403,
    });
  });
  it('rejects foreign facilities and does not carry an individual grant to a new membership', async () => {
    individual = true;
    await expect(access.assertManage('member', 'other')).rejects.toMatchObject({
      status: 403,
    });
    member.hospital.id = 'other';
    await expect(access.assertManage('member')).rejects.toMatchObject({
      status: 403,
    });
  });
  it('honors granular catalogue permissions without granting manual inventory intake', async () => {
    permissions = ['medicine.update'];
    await expect(
      access.catalogueActor('member', 'medicine.update'),
    ).resolves.toMatchObject({ facilityId: 'facility' });
    await expect(access.assertManage('member')).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      access.catalogueActor('member', 'medicine.delete'),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('allows an audited network-admin designation and revocation, visible on the next user reload', async () => {
    const result = await access.setGrant(
      'member',
      true,
      'network',
      '127.0.0.1',
    );
    expect(result.data).toMatchObject({
      userId: 'member',
      facilityId: 'facility',
      sessionRefreshRequired: true,
    });
    expect(grantsRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'member', facility_id: 'facility' }),
      ['user_id', 'facility_id'],
    );
    expect((await users.authenticatedUser('member')).permissions).toContain(
      'inventory.manage',
    );
    await access.setGrant('member', false, 'network', '127.0.0.1');
    await expect(access.assertManage('member')).rejects.toMatchObject({
      status: 403,
    });
    expect(auditRepo.save).toHaveBeenCalledTimes(2);
  });
  it('does not allow a team administrator to self-assign stock grants', async () => {
    await expect(
      access.setGrant('member', true, 'member', 'ip'),
    ).rejects.toMatchObject({ status: 403 });
    expect(grantsRepo.upsert).not.toHaveBeenCalled();
  });
  it('derives manual intake scope and rejects both foreign facility aliases', async () => {
    individual = true;
    const guard = new InventoryManagementGuard(access);
    for (const body of [
      { facilityId: 'other' },
      { facilityId: 'facility', hospitalId: 'other' },
    ]) {
      const request = { user: { id: 'member' }, body };
      const context = {
        switchToHttp: () => ({ getRequest: () => request }),
      } as ExecutionContext;
      await expect(guard.canActivate(context)).rejects.toMatchObject({
        status: 403,
      });
    }
    const request = {
      user: { id: 'member', facilityId: 'untrusted' },
      body: {},
    };
    await guard.canActivate({
      switchToHttp: () => ({ getRequest: () => request }),
    } as ExecutionContext);
    expect(request.user.facilityId).toBe('facility');
  });
});
