import { PGlite } from '@electric-sql/pglite';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { FacilityLicenseLookupController } from './facility-license-lookup.controller';
import { FacilityLicenseLookupService } from './facility-license-lookup.service';
import { LicenseRegistryService } from './license-registry.service';
import { AdminIntegrationsService } from '../admin/admin-integrations.service';
import { FacilityLicenseReviewGuard } from '../guards/facility-license-review.guard';
import { AuthGuard } from '../guards/auth.guard';
import { FacilityTeamGuard } from '../guards/user-management.guard';
import { NetworkAdminGuard } from '../guards/network-admin.guard';
import { StockAccessService } from '../guards/stock-access.service';
import { NetResponseFilter } from '../helpers/net-response.filter';
import { User } from '../users/entities/user.entity';
import { Hospital } from './entities/hospital.entity';
import { RolePermission } from '../role/entities/role-permission.entity';
import { VerificationApplication } from '../verification_applications/entities/verification-application.entity';
import { FacilityMembershipRequest } from './entities/facility-membership-request.entity';
import { FacilityLicenseCheck } from './entities/facility-license-check.entity';
import { AuditLog } from '../audit_log/entities/audit_log.entity';
import { HospitalService } from './hospital.service';
import { FacilityTeamMembershipController } from './hospital.controller';
import { RegistryMetadataService } from '../registry_metadata/registry-metadata.service';
import { IntegrationConfiguration } from '../admin/entities/integration-configuration.entity';

jest.setTimeout(60000);
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Row = Record<string, unknown>;
type Query = (sql: string, values?: unknown[]) => Promise<Row[]>;
describe('automated facility licence lookup HTTP contract and persistence', () => {
  let pg: PGlite, app: INestApplication;
  let tokens: Record<string, string>;
  let query: Query;
  let payload: unknown;
  let networkError: boolean;
  let afterLookup: (() => Promise<void>) | undefined;
  const manual = jest
    .fn()
    .mockReturnValue({ success: true, data: { result: 'UNAVAILABLE' } });
  const lookupPath = `/api/facility-membership-requests/${id(301)}/license-lookup`;
  const search = {
    licenseNumber: 'PCN-1234',
    professionalType: 'PHARMACIST',
    registry: 'PCN',
  };
  beforeAll(async () => {
    pg = new PGlite();
    query = async (sql, values = []) =>
      (await pg.query(sql, values)).rows as Row[];
    await pg.exec(`CREATE TABLE roles(id int PRIMARY KEY,name text);
      CREATE TABLE hospitals(id uuid PRIMARY KEY,status text,deleted_at timestamptz,ip_whitelist text[] DEFAULT '{}');
      CREATE TABLE users(id uuid PRIMARY KEY,role_id int,hospital_id uuid,active boolean,verification_status text,account_type text,
        license_number text,license_registry text,last_name text);
      CREATE TABLE role_permissions(role_id int,permission text);
      CREATE TABLE verification_applications(id uuid PRIMARY KEY,user_id uuid,registry text,license_number text,status text,submitted_at timestamptz DEFAULT now());
      CREATE TABLE facility_membership_requests(id uuid PRIMARY KEY,user_id uuid,facility_id uuid,status text);
      CREATE TABLE facility_license_checks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),membership_request_id uuid REFERENCES facility_membership_requests(id),
        facility_id uuid REFERENCES hospitals(id),user_id uuid REFERENCES users(id),application_id uuid REFERENCES verification_applications(id),
        checked_by uuid REFERENCES users(id),registry text,result text CHECK(result IN ('MATCH','NO_MATCH','UNAVAILABLE','INCONCLUSIVE')),
        evidence text NOT NULL,checked_at timestamptz DEFAULT now());
      CREATE TABLE audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,action text,description text,object_id uuid);
      CREATE TABLE integration_configurations(integration_key text PRIMARY KEY,config_values jsonb);`);
    function repositories(run: Query) {
      const first = async (sql: string, values: unknown[]) =>
        (await run(sql, values))[0] ?? null;
      return (entity: unknown) => {
        if (entity === IntegrationConfiguration)
          return {
            findOneBy: async () =>
              first(
                "SELECT config_values AS values FROM integration_configurations WHERE integration_key='license_registry'",
                [],
              ),
          };
        if (entity === User)
          return {
            findOne: async (options: { where: { id: string } }) =>
              first(
                `SELECT u.*,jsonb_build_object('id',r.id,'name',r.name) role,
          CASE WHEN h.id IS NULL THEN NULL ELSE jsonb_build_object('id',h.id,'status',h.status,'deleted_at',h.deleted_at,'ip_whitelist',h.ip_whitelist) END hospital
          FROM users u LEFT JOIN roles r ON r.id=u.role_id LEFT JOIN hospitals h ON h.id=u.hospital_id WHERE u.id=$1`,
                [options.where.id],
              ),
          };
        if (entity === Hospital)
          return {
            findOneBy: async (where: { id: string }) =>
              first('SELECT * FROM hospitals WHERE id=$1', [where.id]),
          };
        if (entity === RolePermission)
          return {
            findBy: async (where: { role_id: number }) =>
              run('SELECT * FROM role_permissions WHERE role_id=$1', [
                where.role_id,
              ]),
            findOneBy: async (where: { role_id: number; permission: string }) =>
              first(
                'SELECT * FROM role_permissions WHERE role_id=$1 AND permission=$2',
                [where.role_id, where.permission],
              ),
          };
        if (entity === VerificationApplication)
          return {
            findOne: async (options: { where: { user_id: string } }) =>
              first(
                'SELECT * FROM verification_applications WHERE user_id=$1 ORDER BY submitted_at DESC,id DESC LIMIT 1',
                [options.where.user_id],
              ),
          };
        if (entity === FacilityMembershipRequest)
          return {
            findOne: async (options: {
              where: { id: string };
              lock?: unknown;
            }) =>
              first(
                `SELECT * FROM facility_membership_requests WHERE id=$1 ${options.lock ? 'FOR UPDATE' : ''}`,
                [options.where.id],
              ),
          };
        if (entity === FacilityLicenseCheck)
          return {
            save: async (row: Row) =>
              first(
                `INSERT INTO facility_license_checks(membership_request_id,facility_id,user_id,application_id,checked_by,registry,result,evidence)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
                [
                  row.membership_request_id,
                  row.facility_id,
                  row.user_id,
                  row.application_id,
                  row.checked_by,
                  row.registry,
                  row.result,
                  row.evidence,
                ],
              ),
          };
        if (entity === AuditLog)
          return {
            save: async (row: Row & { user: { id: string } }) =>
              first(
                'INSERT INTO audit_log(user_id,action,description,object_id) VALUES($1,$2,$3,$4) RETURNING *',
                [row.user.id, row.action, row.description, row.object_id],
              ),
          };
        throw new Error('Unexpected repository');
      };
    }
    const db = {
      getRepository: repositories(query),
      manager: { getRepository: repositories(query) },
      transaction: async (callback: (manager: unknown) => unknown) =>
        pg.transaction(async (tx) =>
          callback({
            getRepository: repositories(
              async (sql, values = []) =>
                (await tx.query(sql, values)).rows as Row[],
            ),
          }),
        ),
    };
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'licence-lookup-test' })],
      controllers: [
        FacilityLicenseLookupController,
        FacilityTeamMembershipController,
      ],
      providers: [
        FacilityLicenseLookupService,
        LicenseRegistryService,
        AuthGuard,
        FacilityTeamGuard,
        NetworkAdminGuard,
        FacilityLicenseReviewGuard,
        StockAccessService,
        RegistryMetadataService,
        { provide: DataSource, useValue: db },
        {
          provide: HospitalService,
          useValue: { recordMembershipLicenseCheck: manual },
        },
        {
          provide: AdminIntegrationsService,
          useValue: {
            licenseRegistryConnection: async () => ({
              url: 'https://registry.example.test/lookup',
              apiKey: 'SERVER-SECRET',
            }),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new NetResponseFilter());
    await app.init();
    const jwt = module.get(JwtService);
    tokens = Object.fromEntries(
      [
        ['facility', 101],
        ['admin', 102],
        ['superadmin', 103],
        ['staff', 104],
        ['otherFacility', 105],
        ['unprivilegedAdmin', 106],
      ].map(([name, n]) => [
        name,
        jwt.sign({ id: id(Number(n)), role: 'untrusted', mfa: true }),
      ]),
    );
  });
  afterAll(async () => {
    await app?.close();
    await pg?.close();
  });
  beforeEach(async () => {
    manual.mockClear();
    networkError = false;
    afterLookup = undefined;
    payload = {
      query: search,
      found: true,
      record: { ...search, lastName: 'Applicant', status: 'ACTIVE' },
      privateData: 'DO-NOT-RETURN',
    };
    await pg.exec(`TRUNCATE integration_configurations,audit_log,facility_license_checks,facility_membership_requests,verification_applications,users,hospitals,roles,role_permissions CASCADE;
      INSERT INTO integration_configurations VALUES ('license_registry','{"pcn_registry_name":"Configured pharmacy registry"}');
      INSERT INTO roles VALUES (1,'FACILITY_ADMIN'),(2,'ADMIN'),(3,'SUPERADMIN'),(4,'PHARMACIST'),(5,'ADMIN');
      INSERT INTO role_permissions VALUES (1,'facility.users.manage'),(2,'admin.access'),(2,'verification.decide'),(3,'admin.access'),(3,'verification.decide'),(5,'admin.access');`);
    await query(
      "INSERT INTO hospitals(id,status) VALUES($1,'ACTIVE'),($2,'ACTIVE')",
      [id(1), id(2)],
    );
    for (const [n, role, facility, active, type] of [
      [101, 1, 1, true, 'PHARMACIST'],
      [102, 2, 2, true, null],
      [103, 3, 2, true, null],
      [104, 4, 1, true, 'PHARMACIST'],
      [105, 1, 2, true, 'DOCTOR'],
      [106, 5, 2, true, null],
      [201, 4, 1, false, 'PHARMACIST'],
    ] as const) {
      await query(
        `INSERT INTO users VALUES($1,$2,$3,$4,$5,$6,'PCN-1234','PCN','Applicant')`,
        [
          id(n),
          role,
          id(facility),
          active,
          n === 201 ? 'MANUAL_REVIEW' : 'VERIFIED',
          type,
        ],
      );
      await query(
        "INSERT INTO verification_applications(id,user_id,registry,license_number,status) VALUES($1,$2,'PCN','PCN-1234',$3)",
        [id(n + 1000), id(n), n === 201 ? 'MANUAL_REVIEW' : 'VERIFIED'],
      );
    }
    await query(
      "INSERT INTO facility_membership_requests VALUES($1,$2,$3,'PENDING')",
      [id(301), id(201), id(1)],
    );
    jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      if (afterLookup) await afterLookup();
      if (networkError) throw new Error('Registry timeout SERVER-SECRET');
      return new Response(JSON.stringify(payload), {
        headers: { 'content-type': 'application/json' },
      });
    });
  });
  afterEach(() => jest.restoreAllMocks());
  const post = (who = 'facility', path = lookupPath, body: unknown = {}) =>
    request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${tokens[who]}`)
      .send(body);
  it.each(['MATCH', 'NO_MATCH', 'UNAVAILABLE', 'INCONCLUSIVE'])(
    'accepts {} and persists %s with reviewer, evidence and timestamp without approving the applicant',
    async (outcome) => {
      if (outcome === 'NO_MATCH') payload = { query: search, found: false };
      if (outcome === 'INCONCLUSIVE') payload = { result: 'MATCH' };
      if (outcome === 'UNAVAILABLE') networkError = true;
      const response = await post().expect(200);
      const review = response.body.data.facility_license_review;
      expect(review).toMatchObject({
        registry: 'PCN',
        registry_name: 'Configured pharmacy registry',
        result: outcome,
        status: 'MANUAL_REVIEW',
        checked_by: id(101),
        membership_request_id: id(301),
      });
      expect(review.evidence.length).toBeGreaterThanOrEqual(5);
      expect(review.evidence.length).toBeLessThanOrEqual(4000);
      expect(JSON.stringify(response.body)).not.toMatch(
        /DO-NOT-RETURN|SERVER-SECRET|lastName/,
      );
      const [saved] = await query(
        'SELECT * FROM facility_license_checks WHERE id=$1',
        [review.id],
      );
      expect(saved.result).toBe(outcome);
      expect(saved.evidence).toBe(review.evidence);
      expect((saved.checked_at as Date).toISOString()).toBe(review.checked_at);
      expect(
        (await query('SELECT status FROM facility_membership_requests'))[0]
          .status,
      ).toBe('PENDING');
      expect(
        (
          await query(
            'SELECT active,verification_status FROM users WHERE id=$1',
            [id(201)],
          )
        )[0],
      ).toEqual({ active: false, verification_status: 'MANUAL_REVIEW' });
      expect(
        (
          await query(
            'SELECT status FROM verification_applications WHERE user_id=$1',
            [id(201)],
          )
        )[0].status,
      ).toBe('MANUAL_REVIEW');
      expect(await query('SELECT * FROM audit_log')).toHaveLength(1);
    },
  );
  it.each(['admin', 'superadmin'])(
    'authorizes %s with verification.decide without applying the operator own facility scope',
    async (who) => {
      const response = await post(who).expect(200);
      expect(response.body.data.facility_license_review.facility_id).toBe(
        id(1),
      );
    },
  );
  it('keeps the registry code and lookup result when a display name has not been configured', async () => {
    await query("UPDATE integration_configurations SET config_values='{}'");
    const response = await post().expect(200);
    expect(response.body.data.facility_license_review).toMatchObject({
      registry: 'PCN',
      registry_name: null,
      result: 'MATCH',
    });
  });
  it('uses renamed backend metadata without altering immutable review evidence or the registry code', async () => {
    await post().expect(200);
    await query('UPDATE integration_configurations SET config_values=$1', [
      { pcn_registry_name: 'Renamed configured registry' },
    ]);
    const response = await post().expect(200);
    expect(response.body.data.facility_license_review).toMatchObject({
      registry: 'PCN',
      registry_name: 'Renamed configured registry',
      result: 'MATCH',
    });
    expect(await query('SELECT * FROM facility_license_checks')).toHaveLength(
      2,
    );
  });
  it.each(['staff', 'otherFacility', 'unprivilegedAdmin'])(
    'rejects %s before calling the registry',
    async (who) => {
      await post(who).expect(403);
      expect(fetch).not.toHaveBeenCalled();
      expect(await query('SELECT * FROM facility_license_checks')).toEqual([]);
    },
  );
  it('preserves the manual submission contract and rejects fabricated inputs on the automated endpoint', async () => {
    const manualPath = `/api/facility-membership-requests/${id(301)}/license-check`;
    await post('facility', manualPath, {}).expect(400);
    expect(manual).not.toHaveBeenCalled();
    await post('facility', manualPath, {
      result: 'UNAVAILABLE',
      evidence: 'Manual reviewer documented provider downtime.',
    }).expect(201);
    expect(manual).toHaveBeenCalledWith(
      id(301),
      expect.objectContaining({ result: 'UNAVAILABLE' }),
      id(101),
      expect.any(String),
    );
    await post('facility', lookupPath, {
      result: 'MATCH',
      evidence: 'Invented result',
    }).expect(400);
  });
  it('rejects malformed/missing request IDs and decided requests clearly', async () => {
    await post(
      'facility',
      '/api/facility-membership-requests/not-uuid/license-lookup',
    ).expect(400);
    await post(
      'facility',
      `/api/facility-membership-requests/${id(999)}/license-lookup`,
    ).expect(404);
    await query("UPDATE facility_membership_requests SET status='APPROVED'");
    await post().expect(409);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects missing or inconsistent licence data before registry access', async () => {
    await query("UPDATE users SET license_number='' WHERE id=$1", [id(201)]);
    await post().expect(422);
    await query(
      "UPDATE users SET license_number='PCN-1234',license_registry='MDCN' WHERE id=$1",
      [id(201)],
    );
    await post().expect(422);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects stale lookup evidence after an applicant changes during the lookup', async () => {
    afterLookup = async () => {
      await query("UPDATE users SET last_name='Changed' WHERE id=$1", [
        id(201),
      ]);
    };
    await post().expect(409);
    expect(await query('SELECT * FROM facility_license_checks')).toEqual([]);
  });
  it('rechecks reviewer permission after the lookup before recording evidence', async () => {
    afterLookup = async () => {
      await query('DELETE FROM role_permissions WHERE role_id=1');
    };
    await post().expect(403);
    expect(await query('SELECT * FROM facility_license_checks')).toEqual([]);
  });
});
