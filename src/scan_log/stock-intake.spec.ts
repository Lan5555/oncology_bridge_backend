import { matchers } from '../../test/matchers';
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
  it.each([undefined, 'vial', 'box'])(
    'preserves reviewed scan unit %s and only merges matching eligible batches',
    async (unit) => {
      const facilityId = '00000000-0000-4000-8000-000000000001';
      const scans = {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((row: unknown) => row),
        save: jest.fn((row: ScanLog) =>
          Promise.resolve({ ...row, id: 'scan' }),
        ),
      };
      const inventory = {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((row: unknown) => row),
        save: jest.fn((row: Inventory) =>
          Promise.resolve({ ...row, id: 'inventory' }),
        ),
        increment: jest.fn(),
      };
      const service = new ScanLogService(
        scans as unknown as Repository<ScanLog>,
        inventory as unknown as Repository<Inventory>,
        {
          findOneBy: () => Promise.resolve({ id: 'medicine' }),
        } as unknown as Repository<Medicine>,
        {
          findOneBy: () => Promise.resolve({ id: facilityId }),
        } as unknown as Repository<Hospital>,
        {} as unknown as Repository<User>,
        {
          create: (row: unknown) => row,
          save: jest.fn(),
        } as unknown as Repository<AuditLog>,
        {
          assertManage: () => Promise.resolve({ id: 'user' }),
        } as unknown as StockAccessService,
      );
      await service.create(
        {
          gtin: '09506000134352',
          lot: 'LOT-1',
          serial: 'SERIAL-1',
          expiry: '2027-12-31',
          facilityId,
          clientUuid: '00000000-0000-4000-8000-000000000002',
          clientTs: new Date().toISOString(),
          action: 'NEW',
          unit,
        },
        { id: 'user' },
      );
      expect(inventory.create).toHaveBeenCalledWith(
        matchers.objectContaining({ selling_unit: unit ?? null }),
      );
      const [options] = inventory.findOne.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      const selected = options.where;
      expect(selected.selling_unit).toEqual(
        unit ?? matchers.objectContaining({ _type: 'isNull' }),
      );
      expect(selected.expiry_date).toEqual(
        new Date('2027-12-31T00:00:00.000Z'),
      );
      expect(selected.status).toEqual(
        matchers.objectContaining({
          _type: 'in',
          _value: ['AVAILABLE', 'NEAR_EXPIRY'],
        }),
      );
      expect(inventory.increment).not.toHaveBeenCalled();

      return Promise.resolve();
    },
  );
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
