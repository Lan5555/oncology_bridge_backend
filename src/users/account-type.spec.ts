import { PGlite } from '@electric-sql/pglite';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { Role } from '../role/entities/role.entity';
import { RolePermission } from '../role/entities/role-permission.entity';
import { AuditLog } from '../audit_log/entities/audit_log.entity';
import { UserSession } from '../user_sessions/entities/user_session.entity';
import { VerificationApplication } from '../verification_applications/entities/verification-application.entity';
import { EncryptionService } from '../encryption/encryption.service';
import { StockAccessService } from '../guards/stock-access.service';
import { RegistryMetadataService } from '../registry_metadata/registry-metadata.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { VerificationApplicationsService } from '../verification_applications/verification-applications.service';
import { AuthGuard } from '../guards/auth.guard';
import { ExecutionContext, HttpException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

jest.setTimeout(60000);

describe('professional account reclassification', () => {
  let pg: PGlite;
  let service: UsersService;
  let db: DataSource;
  let failAudit = false;
  const original = {
    id: 'target',
    first_name: 'Before',
    last_name: 'User',
    email: 'encrypted',
    phone: 'encrypted',
    password_hash: 'secret',
    email_hash: 'target@example.test',
    phone_hash: 'index',
    active: true,
    role: { id: 3, name: 'ONCOLOGIST' },
    hospital: { id: 'facility', status: 'ACTIVE' },
    account_type: 'DOCTOR',
    verification_status: 'VERIFIED',
    license_number: 'OLD123',
    license_registry: 'MDCN',
  };
  const payload = (
    type = 'PHARMACIST',
    expected: string | null = 'DOCTOR',
  ): UpdateUserDto => ({
    first_name: 'After',
    account_type: type,
    expected_account_type: expected,
    account_type_change_reason: ' Reviewed classification ',
  });
  type Sql = {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  };
  const repository = (sql: Sql, entity: unknown) => {
    if (entity === User)
      return {
        findOne: async ({
          where,
          lock,
        }: {
          where: { id?: string; email_hash?: string };
          lock?: unknown;
        }) => {
          const result = await sql.query(
            `SELECT doc FROM people WHERE ${where.id ? 'id=$1' : "doc->>'email_hash'=$1"}${lock ? ' FOR UPDATE' : ''}`,
            [where.id ?? where.email_hash],
          );
          return (result.rows[0] as { doc: User } | undefined)?.doc ?? null;
        },
        findOneBy: async (where: { id?: string; license_number?: string }) => {
          const result = await sql.query(
            `SELECT doc FROM people WHERE ${where.id ? 'id=$1' : "doc->>'license_number'=$1"}`,
            [where.id ?? where.license_number],
          );
          return (result.rows[0] as { doc: User } | undefined)?.doc ?? null;
        },
        save: async (user: User) => {
          await sql.query('UPDATE people SET doc=$2 WHERE id=$1', [
            user.id,
            JSON.stringify(user),
          ]);
          return user;
        },
      };
    if (entity === RolePermission)
      return {
        findBy: ({ role_id }: { role_id: number }) =>
          Promise.resolve(
            role_id === 1
              ? [{ permission: 'admin.access' }, { permission: 'user.update' }]
              : [],
          ),
      };
    if (entity === Role)
      return {
        findOneBy: ({ name }: { name: string }) =>
          Promise.resolve({
            id: name === 'ONCOLOGIST' ? 3 : 4,
            name,
          }),
      };
    if (entity === UserSession)
      return {
        update: async () =>
          sql.query("UPDATE sessions SET token='' WHERE id='target'"),
      };
    if (entity === AuditLog)
      return {
        save: async (audit: unknown) => {
          if (failAudit) throw new Error('audit unavailable');
          await sql.query('INSERT INTO audits(doc) VALUES ($1)', [
            JSON.stringify(audit),
          ]);
        },
      };
    if (entity === VerificationApplication)
      return {
        save: async (app: object) => {
          const row = { id: 'new-application', ...app };
          await sql.query('INSERT INTO evidence(doc) VALUES ($1)', [
            JSON.stringify(row),
          ]);
          return row;
        },
        findOne: () => Promise.resolve({ id: 'latest' }),
      };
    throw new Error('Unexpected repository');
  };
  const target = async () =>
    (await pg.query<{ doc: User }>("SELECT doc FROM people WHERE id='target'"))
      .rows[0].doc;
  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(
      'CREATE TABLE people(id text PRIMARY KEY,doc jsonb); CREATE TABLE sessions(id text,token text); CREATE TABLE audits(doc jsonb); CREATE TABLE evidence(doc jsonb)',
    );
    db = {
      getRepository: (entity: unknown) => repository(pg, entity),
      transaction: (work: (manager: EntityManager) => Promise<unknown>) =>
        pg.transaction((tx) =>
          work({
            getRepository: (entity: unknown) => repository(tx, entity),
          } as EntityManager),
        ),
    } as unknown as DataSource;
    service = new UsersService(
      db.getRepository(User),
      {
        encrypt: (s: string) => s,
        decrypt: () => 'safe',
        hash: (s: string) => s.trim().toLowerCase(),
        comparePassword: (s: string) => s === 'correct-password',
      } as unknown as EncryptionService,
      {} as Repository<Role>,
      db,
      {
        isNetworkAdmin: (u: User) =>
          ['ADMIN', 'SUPERADMIN'].includes(u.role?.name),
      } as StockAccessService,
      {} as RegistryMetadataService,
    );
  });
  afterAll(async () => pg.close());
  beforeEach(async () => {
    failAudit = false;
    await pg.exec('TRUNCATE people,sessions,audits,evidence');
    await pg.query('INSERT INTO people VALUES ($1,$2),($3,$4)', [
      'target',
      JSON.stringify(original),
      'admin',
      JSON.stringify({
        id: 'admin',
        active: true,
        role: { id: 1, name: 'ADMIN' },
      }),
    ]);
    await pg.exec(
      'INSERT INTO sessions VALUES (\'target\',\'refresh\'); INSERT INTO evidence VALUES (\'{"id":"old","license_number":"OLD123","status":"VERIFIED"}\')',
    );
  });
  it.each(['DOCTOR', 'PHARMACIST', 'PHARMACY_STORE'])(
    'saves %s, revokes sessions and preserves historical evidence',
    async (type) => {
      await pg.query(
        "UPDATE people SET doc=jsonb_set(doc,'{account_type}','null') WHERE id='target'",
      );
      const response = await service.updateForActor(
        'target',
        payload(type, null),
        'admin',
      );
      expect(response.data).toMatchObject({
        account_type: type,
        active: false,
        verification_status: 'MANUAL_REVIEW',
      });
      expect(JSON.stringify(response)).not.toMatch(
        /password_hash|email_hash|phone_hash|refresh_token/,
      );
      expect(await target()).toMatchObject({
        first_name: 'After',
        license_number: null,
        license_registry: null,
      });
      expect((await pg.query('SELECT token FROM sessions')).rows).toEqual([
        { token: '' },
      ]);
      expect((await pg.query('SELECT * FROM evidence')).rows).toHaveLength(1);
      const audit = (
        await pg.query<{ doc: { description: string } }>(
          'SELECT doc FROM audits',
        )
      ).rows[0].doc;
      expect(JSON.parse(audit.description)).toMatchObject({
        actor: 'admin',
        target: 'target',
        reason: 'Reviewed classification',
        previous_license: { number: 'OLD123', registry: 'MDCN' },
      });
    },
  );
  it('rejects a stale edit and leaves contact details untouched', async () => {
    const results = await Promise.allSettled([
      service.updateForActor('target', payload(), 'admin'),
      service.updateForActor(
        'target',
        { ...payload('PHARMACY_STORE'), first_name: 'Stale contact' },
        'admin',
      ),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    const rejected = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect((rejected.reason as HttpException).getStatus()).toBe(409);
    expect((await target()).first_name).toBe('After');
  });
  it('rolls back contacts, sessions and classification if auditing fails', async () => {
    failAudit = true;
    await expect(
      service.updateForActor('target', payload(), 'admin'),
    ).rejects.toThrow('audit unavailable');
    expect(await target()).toEqual(original);
    expect((await pg.query('SELECT token FROM sessions')).rows).toEqual([
      { token: 'refresh' },
    ]);
  });
  it.each([
    { account_type: 'ADMIN' },
    { expected_account_type: undefined },
    { account_type_change_reason: ' ' },
    { account_type_change_reason: 'a'.repeat(1001) },
    { is_active: true },
  ])('rejects invalid type-change fields %j without writes', async (fields) => {
    const dto = { ...payload(), ...fields };
    if (dto.expected_account_type === undefined)
      delete dto.expected_account_type;
    await expect(
      service.updateForActor('target', dto, 'admin'),
    ).rejects.toMatchObject({ status: 400 });
    expect(await target()).toEqual(original);
  });
  it.each(['FACILITY_ADMIN', 'ONCOLOGIST', 'ADMIN'])(
    'rejects %s without explicit grants',
    async (name) => {
      await pg.query(
        "UPDATE people SET doc=jsonb_set(doc,'{role}', $1) WHERE id='admin'",
        [JSON.stringify({ id: 9, name })],
      );
      await expect(
        service.updateForActor('target', payload(), 'admin'),
      ).rejects.toMatchObject({ status: 403 });
      expect(await target()).toEqual(original);
    },
  );
  it.each(['ADMIN', 'SUPERADMIN', 'FACILITY_ADMIN'])(
    'rejects administrator target %s',
    async (name) => {
      await pg.query(
        "UPDATE people SET doc=jsonb_set(doc,'{role}', $1) WHERE id='target'",
        [JSON.stringify({ id: 1, name })],
      );
      await expect(
        service.updateForActor('target', payload(), 'admin'),
      ).rejects.toMatchObject({ status: 403 });
    },
  );
  it('keeps contact-only changes and verification intact', async () => {
    await service.updateForActor(
      'target',
      plainToInstance(UpdateUserDto, { first_name: 'Contact' }),
      'admin',
    );
    expect(await target()).toMatchObject({
      first_name: 'Contact',
      account_type: 'DOCTOR',
      active: true,
      verification_status: 'VERIFIED',
    });
  });
  it('returns 404 for an absent target', async () => {
    await expect(
      service.updateForActor('absent', payload(), 'admin'),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('rejects self-service professional changes', async () => {
    await expect(service.update('target', payload())).rejects.toMatchObject({
      status: 403,
    });
    expect(await target()).toEqual(original);
  });
  it('denies an existing access token during review and after approval for the new type', async () => {
    const guard = new AuthGuard(
      {
        verifyAsync: () =>
          Promise.resolve({ id: 'target', account_type: 'DOCTOR' }),
      } as unknown as JwtService,
      db,
    );
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: 'Bearer old-access-token' },
          path: '/api/prescriptions',
        }),
      }),
    } as unknown as ExecutionContext;
    await service.updateForActor('target', payload(), 'admin');
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 401,
    });
    await pg.query(
      "UPDATE people SET doc=jsonb_set(doc,'{active}','true') WHERE id='target'",
    );
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 401,
    });
  });
  it('validates the DTO and rejects escalation fields', async () => {
    const options = { whitelist: true, forbidNonWhitelisted: true };
    expect(
      await validate(plainToInstance(UpdateUserDto, payload()), options),
    ).toHaveLength(0);
    expect(
      (
        await validate(
          plainToInstance(UpdateUserDto, { ...payload(), role: 'SUPERADMIN' }),
          options,
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await validate(
          plainToInstance(UpdateUserDto, { account_type: 'DOCTOR' }),
          options,
        )
      ).length,
    ).toBeGreaterThan(0);
  });
  it('collects new licence evidence using credentials without activating the account', async () => {
    await service.updateForActor('target', payload(), 'admin');
    await expect(
      service.resubmitVerification(
        {
          email: original.email_hash,
          password: 'wrong-password',
          registry: 'PCN',
          license_number: 'NEW123',
        },
        'test',
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      service.resubmitVerification(
        {
          email: original.email_hash,
          password: 'correct-password',
          registry: 'MDCN',
          license_number: 'NEW123',
        },
        'test',
      ),
    ).rejects.toMatchObject({ status: 400 });
    await service.resubmitVerification(
      {
        email: original.email_hash,
        password: 'correct-password',
        registry: 'PCN',
        license_number: 'NEW123',
      },
      'test',
    );
    expect(await target()).toMatchObject({
      active: false,
      license_number: 'NEW123',
      license_registry: 'PCN',
    });
    expect((await pg.query('SELECT * FROM evidence')).rows).toHaveLength(2);
  });
  it('prevents historical evidence from being approved or rechecked', async () => {
    const review = new VerificationApplicationsService(
      {} as Repository<VerificationApplication>,
      db,
      {} as EncryptionService,
      {} as RegistryMetadataService,
    );
    // Exercise the shared review invariant without any configured registry provider.
    const reviewer = review as unknown as {
      assertCurrentEvidence: (
        row: object,
        user: User,
        manager: object,
      ) => Promise<void>;
    };
    await expect(
      reviewer.assertCurrentEvidence(
        {
          id: 'old',
          user_id: 'target',
          license_number: 'OLD123',
          registry: 'MDCN',
        },
        { ...original, license_number: null },
        db,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
});
