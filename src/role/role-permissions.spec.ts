import { PGlite } from '@electric-sql/pglite';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { DataSource, Repository } from 'typeorm';
import request from 'supertest';
import { RoleController } from './role.controller';
import { RoleService } from './role.service';
import { Role } from './entities/role.entity';
import { RolePermission } from './entities/role-permission.entity';
import { User } from '../users/entities/user.entity';
import { AuditLog } from '../audit_log/entities/audit_log.entity';
import { AuthGuard } from '../guards/auth.guard';
import { NetworkAdminGuard } from '../guards/network-admin.guard';
import { UpdateRoleDto } from './dto/update-role.dto';
import { SystemRolePermissionsGuard } from './system-role-permissions.guard';
import { NetResponseFilter } from '../helpers/net-response.filter';

jest.setTimeout(60000);
describe('assignable marketplace permission API', () => {
  let pg: PGlite, app: INestApplication;
  let token: string;
  let service: RoleService;
  let adminGrants: string[], networkRole: string;
  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(
      `CREATE TABLE roles(id int PRIMARY KEY,name text); INSERT INTO roles VALUES (2,'PHARMACY_STORE'); CREATE TABLE role_permissions(role_id int,permission text); CREATE TABLE audit_logs(action text);`,
    );
    const makeManager = (tx: any): any => ({
      getRepository: (entity: any): any => {
        if (entity === RolePermission)
          return {
            findBy: async ({ role_id }: any) =>
              role_id === 1
                ? adminGrants.map((permission) => ({ permission }))
                : (
                    await tx.query(
                      'SELECT * FROM role_permissions WHERE role_id=$1',
                      [role_id],
                    )
                  ).rows,
            delete: async ({ role_id }: any) =>
              tx.query('DELETE FROM role_permissions WHERE role_id=$1', [
                role_id,
              ]),
            create: (row: any) => row,
            save: async (rows: any[]) => {
              for (const row of rows)
                await tx.query('INSERT INTO role_permissions VALUES ($1,$2)', [
                  row.role_id,
                  row.permission,
                ]);
            },
          };
        if (entity === User)
          return {
            findOne: async () => ({
              id: 'admin',
              active: true,
              role: { id: 1, name: networkRole },
            }),
          };
        if (entity === AuditLog)
          return {
            save: async (row: any) =>
              tx.query('INSERT INTO audit_logs VALUES ($1)', [row.action]),
          };
        throw new Error('Unexpected entity');
      },
    });
    const db: any = {
      getRepository: (entity: any) => makeManager(pg).getRepository(entity),
      transaction: async (cb: any) =>
        pg.transaction((tx) => cb(makeManager(tx))),
    };
    service = new RoleService(
      {
        findOneBy: async ({ id }: any) =>
          (await pg.query('SELECT * FROM roles WHERE id=$1', [id])).rows[0],
      } as Repository<Role>,
      db.getRepository(RolePermission),
      db as DataSource,
    );
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'permission-test' })],
      controllers: [RoleController],
      providers: [
        AuthGuard,
        NetworkAdminGuard,
        SystemRolePermissionsGuard,
        { provide: RoleService, useValue: service },
        { provide: DataSource, useValue: db },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new NetResponseFilter());
    await app.init();
    token = module.get(JwtService).sign({ id: 'admin' });
  });
  beforeEach(async () => {
    adminGrants = ['admin.access', 'role.manage'];
    networkRole = 'ADMIN';
    await pg.exec('TRUNCATE role_permissions,audit_logs');
  });
  afterAll(async () => {
    await app?.close();
    await pg?.close();
  });
  const get = (path = '/api/roles/2/permissions') =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', 'Bearer ' + token);
  const put = (permissions: string[], path = '/api/roles/2/permissions') =>
    request(app.getHttpServer())
      .put(path)
      .set('Authorization', 'Bearer ' + token)
      .send({ permissions });
  it('exposes the exact key alongside assigned permissions, permits grant/revoke, and persists after reload', async () => {
    const initial = await get().expect(200);
    expect(initial.body.data.permissions).toEqual([]);
    expect(initial.body.data.availablePermissions).toEqual(
      expect.arrayContaining([
        'marketplace.list',
        'inventory.manage',
        'role.manage',
      ]),
    );
    await put(['marketplace.list']).expect(200);
    expect((await get().expect(200)).body.data.permissions).toEqual([
      'marketplace.list',
    ]);
    expect((await pg.query('SELECT * FROM role_permissions')).rows).toEqual([
      { role_id: 2, permission: 'marketplace.list' },
    ]);
    await put([]).expect(200);
    expect((await get().expect(200)).body.data.permissions).toEqual([]);
    expect((await pg.query('SELECT * FROM audit_logs')).rows).toHaveLength(2);
  });
  it('supports legacy role.update and the role route alias', async () => {
    adminGrants = ['admin.access', 'role.read', 'role.update'];
    await put(['marketplace.list'], '/role/2/permissions').expect(200);
    expect(
      (await get('/role/2/permissions').expect(200)).body.data.permissions,
    ).toEqual(['marketplace.list']);
  });
  it('requires network administration and role permission management', async () => {
    adminGrants = ['admin.access', 'role.read'];
    await put(['marketplace.list']).expect(403);
    adminGrants = ['role.manage'];
    await put(['marketplace.list']).expect(403);
    adminGrants = ['admin.access', 'role.manage'];
    networkRole = 'FACILITY_ADMIN';
    await put(['marketplace.list']).expect(403);
    expect((await pg.query('SELECT * FROM role_permissions')).rows).toEqual([]);
  });
  it('does not accept an invented listing permission or unknown role', async () => {
    await put(['marketplace.listings.manage']).expect(409);
    await put(['marketplace.list'], '/api/roles/999/permissions').expect(404);
  });
  const seedProtected = async (name = 'SUPERADMIN') => {
    await pg.query(
      'INSERT INTO roles VALUES (4,$1) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name',
      [name],
    );
    await pg.exec(
      "INSERT INTO role_permissions VALUES (4,'admin.access'),(4,'role.manage')",
    );
  };
  const expectProtectedUnchanged = async () => {
    expect(
      (
        await pg.query(
          'SELECT permission FROM role_permissions WHERE role_id=4 ORDER BY permission',
        )
      ).rows,
    ).toEqual([{ permission: 'admin.access' }, { permission: 'role.manage' }]);
    expect((await pg.query('SELECT * FROM audit_logs')).rows).toEqual([]);
  };
  it.each(['ADMIN', 'SUPERADMIN'])(
    'forbids every caller including %s from changing system role permissions through either alias',
    async (caller) => {
      networkRole = caller;
      await seedProtected();
      for (const path of ['/api/roles/4/permissions', '/role/4/permissions']) {
        for (const permissions of [
          [],
          ['medicine.read'],
          ['admin.access', 'role.manage'],
        ]) {
          const result = await put(permissions, path).expect(403);
          expect(result.body).toMatchObject({
            success: false,
            message:
              'System SUPERADMIN role permissions are protected and cannot be changed.',
          });
          await expectProtectedUnchanged();
        }
        // Authorized reads remain available even when writes are protected.
        const result = await get(path).expect(200);
        expect(result.body.data.permissions).toEqual([
          'admin.access',
          'role.manage',
        ]);
        expect(result.body.data.availablePermissions).toContain(
          'marketplace.list',
        );
      }
    },
  );
  it('protects the immutable ID after renaming and does not confuse a matching display name on another role', async () => {
    await seedProtected('Renamed system role');
    await pg.query("UPDATE roles SET name='SUPERADMIN' WHERE id=2");
    await put([], '/api/roles/4/permissions').expect(403);
    await expectProtectedUnchanged();
    await put(['medicine.read']).expect(200);
    expect((await get().expect(200)).body.data.permissions).toEqual([
      'medicine.read',
    ]);
    await pg.query("UPDATE roles SET name='PHARMACY_STORE' WHERE id=2");
  });
  it.each(['/api/roles/4', '/role/4'])(
    'rejects alternate role updates containing permissions before validation or mutation: %s',
    async (path) => {
      adminGrants.push('role.update');
      await seedProtected();
      for (const permissions of [[], ['medicine.read'], null]) {
        const result = await request(app.getHttpServer())
          .patch(path)
          .set('Authorization', 'Bearer ' + token)
          .send({ name: 'Attempted rename', permissions })
          .expect(403);
        expect(result.body.message).toContain('permissions are protected');
      }
      expect(
        (await pg.query('SELECT name FROM roles WHERE id=4')).rows,
      ).toEqual([{ name: 'SUPERADMIN' }]);
      await expectProtectedUnchanged();
    },
  );
  it('protects service-level writes and deletion even after a display-name change', async () => {
    await seedProtected('Renamed system role');
    await expect(
      service.setPermissions(4, [], 'superadmin'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.update(
        4,
        { name: 'Attempt', permissions: [] } as UpdateRoleDto,
        'superadmin',
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(service.remove(4, 'superadmin')).rejects.toMatchObject({
      status: 403,
    });
    await expectProtectedUnchanged();
  });
});
