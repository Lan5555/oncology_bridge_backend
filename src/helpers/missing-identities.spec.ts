import { HospitalService } from '../hospital/hospital.service';
import { AuditLogService } from '../audit_log/audit_log.service';
import { AuditLog } from '../audit_log/entities/audit_log.entity';
import { User } from '../users/entities/user.entity';
import { Repository } from 'typeorm';

describe('missing recorded identities and activity', () => {
  it('does not manufacture an active/inactive state or facility type when none is recorded', async () => {
    const facilities = [
      {
        id: 'missing',
        name: 'Recorded facility',
        status: null,
        facility_type: null,
      },
      {
        id: 'active',
        name: 'Active facility',
        status: 'ACTIVE',
        facility_type: 'PHARMACY',
      },
    ];
    const args = [
      { find: () => Promise.resolve(facilities) },
      null,
      null,
      null,
      null,
      null,
      null,
    ] as unknown as ConstructorParameters<typeof HospitalService>;
    const result = await new HospitalService(...args).getNetwork();
    expect(result.data?.facilities[0]).toMatchObject({
      id: 'missing',
      type: null,
      status: null,
      online: null,
      alert: null,
    });
    expect(result.data?.facilities[1]).toMatchObject({
      id: 'active',
      type: 'PHARMACY',
      status: 'ACTIVE',
      online: true,
      alert: false,
    });
  });

  it('returns a missing actor instead of constructing a name from null fields', async () => {
    const rows = [
      Object.assign(new AuditLog(), {
        id: 'missing',
        user: Object.assign(new User(), {
          id: 'user',
          first_name: null,
          last_name: null,
        }),
      }),
      Object.assign(new AuditLog(), {
        id: 'recorded',
        user: Object.assign(new User(), {
          id: 'user',
          first_name: 'Ada',
          last_name: 'Okafor',
        }),
      }),
    ];
    const query = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: () => Promise.resolve([rows, 2]),
    };
    const audits = {
      createQueryBuilder: () => query,
    } as unknown as Repository<AuditLog>;
    const result = await new AuditLogService(
      audits,
      {} as Repository<User>,
    ).findAll();
    expect(result.data?.items[0]).toMatchObject({
      actorId: 'user',
      actor: null,
    });
    expect(result.data?.items[1]).toMatchObject({ actor: 'Ada Okafor' });
  });
});
