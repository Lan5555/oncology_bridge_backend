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
        create: jest.fn((row) => row),
        save: jest.fn(async (row) => ({ ...row, id: 'scan' })),
      };
      const inventory = {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((row) => row),
        save: jest.fn(async (row) => ({ ...row, id: 'inventory' })),
        increment: jest.fn(),
      };
      const service = new ScanLogService(
        scans as any,
        inventory as any,
        { findOneBy: async () => ({ id: 'medicine' }) } as any,
        { findOneBy: async () => ({ id: facilityId }) } as any,
        {} as any,
        { create: (row) => row, save: jest.fn() } as any,
        { assertManage: async () => ({ id: 'user' }) } as any,
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
        expect.objectContaining({ selling_unit: unit ?? null }),
      );
      const selected = inventory.findOne.mock.calls[0][0].where;
      expect(selected.selling_unit).toEqual(
        unit ?? expect.objectContaining({ _type: 'isNull' }),
      );
      expect(selected.expiry_date).toEqual(
        new Date('2027-12-31T00:00:00.000Z'),
      );
      expect(selected.status).toEqual(
        expect.objectContaining({
          _type: 'in',
          _value: ['AVAILABLE', 'NEAR_EXPIRY'],
        }),
      );
      expect(inventory.increment).not.toHaveBeenCalled();
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
