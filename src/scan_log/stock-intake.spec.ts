import { ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ScanLogService } from './scan_log.service';
import { ScanLog } from './entities/scan_log.entity';
import { Inventory } from '../inventory/entities/inventory.entity';
import { Medicine } from '../medicine/entities/medicine.entity';
import { Hospital } from '../hospital/entities/hospital.entity';
import { User } from '../users/entities/user.entity';
import { AuditLog } from '../audit_log/entities/audit_log.entity';
import { StockAccessService } from '../guards/stock-access.service';

describe('GS1 stock intake authorization', () => {
  it('checks stock permission before decode and before creating or replaying scan records', async () => {
    const stock = {
      assertManage: jest
        .fn()
        .mockRejectedValue(
          new ForbiddenException('Missing permission: inventory.manage'),
        ),
    };
    const writes = {
      save: jest.fn(),
      increment: jest.fn(),
      findOne: jest.fn(),
    };
    const service = new ScanLogService(
      writes as unknown as Repository<ScanLog>,
      writes as unknown as Repository<Inventory>,
      {} as Repository<Medicine>,
      {} as Repository<Hospital>,
      {} as Repository<User>,
      {} as Repository<AuditLog>,
      stock as unknown as StockAccessService,
    );
    const facilityId = '00000000-0000-4000-8000-000000000001';
    await expect(
      service.assertCanScan({ id: 'user' }, facilityId),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.create(
        {
          gtin: '09506000134352',
          lot: 'LOT-1',
          serial: 'SERIAL-1',
          expiry: '2027-12-31',
          facilityId,
          clientUuid: '00000000-0000-4000-8000-000000000002',
          clientTs: new Date().toISOString(),
          action: 'NEW',
        },
        { id: 'user' },
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(stock.assertManage).toHaveBeenCalledWith('user', facilityId);
    expect(writes.findOne).not.toHaveBeenCalled();
    expect(writes.save).not.toHaveBeenCalled();
    expect(writes.increment).not.toHaveBeenCalled();
  });
});
