import { transactionQueryBuilder } from '../../test/typeorm-query-builder';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { MedicineService } from './medicine.service';
import { Medicine } from './entities/medicine.entity';
import { StockAccessService } from '../guards/stock-access.service';
import { Inventory } from '../inventory/entities/inventory.entity';

describe('facility catalogue ownership', () => {
  const actor = { user: { id: 'staff' }, facilityId: 'facility-a' };
  let service: MedicineService;
  let medicine: Medicine;
  let repo: {
    findOne: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
    create: jest.Mock;
  };
  let foreignStock: boolean;
  beforeEach(() => {
    medicine = {
      id: 'drug',
      catalog_facility_id: 'facility-a',
      generic_name: 'Old name',
    } as Medicine;
    repo = {
      findOne: jest.fn(async () => medicine),
      save: jest.fn(async (row) => row),
      softDelete: jest.fn(),
      create: jest.fn((row) => row),
    };
    foreignStock = false;
    const manager = {
      createQueryBuilder: () => transactionQueryBuilder(async () => []),
      query: jest.fn().mockResolvedValue([]),
      getRepository: (entity: unknown) =>
        entity === Medicine
          ? repo
          : entity === Inventory
            ? { exists: async () => foreignStock }
            : { save: jest.fn() },
    };
    const db = {
      transaction: async (callback) =>
        callback(manager as unknown as EntityManager),
    } as unknown as DataSource;
    service = new MedicineService(repo as unknown as Repository<Medicine>, db, {
      catalogueActor: jest.fn().mockResolvedValue(actor),
    } as unknown as StockAccessService);
  });
  it('derives ownership for new catalogue records from the actor', async () => {
    await service.create(
      {
        gtin: '12345678901231',
        generic_name: 'Drug',
        brand_name: 'Brand',
        strength: '10 mg',
        manufacturer: 'Maker',
        dosage_form: 'vial',
        storage_temperature: '2-8 C',
      },
      'staff',
    );
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ catalog_facility_id: 'facility-a' }),
    );
  });
  it.each([null, 'facility-b'])(
    'rejects mutation of a record owned by %s',
    async (owner) => {
      medicine.catalog_facility_id = owner;
      await expect(
        service.update('drug', { generic_name: 'New name' }, 'staff', 'ip'),
      ).rejects.toMatchObject({ status: 403 });
      await expect(service.remove('drug', 'staff', 'ip')).rejects.toMatchObject(
        { status: 403 },
      );
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.softDelete).not.toHaveBeenCalled();
    },
  );
  it('allows authorized mutations of the facility own catalogue record', async () => {
    await service.update('drug', { generic_name: 'New name' }, 'staff', 'ip');
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ generic_name: 'New name' }),
    );
    await service.remove('drug', 'staff', 'ip');
    expect(repo.softDelete).toHaveBeenCalledWith({ id: 'drug' });
  });
  it('protects other facilities after a facility-owned catalogue entry becomes shared', async () => {
    foreignStock = true;
    await expect(
      service.update('drug', { generic_name: 'New name' }, 'staff', 'ip'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(service.remove('drug', 'staff', 'ip')).rejects.toMatchObject({
      status: 403,
    });
    expect(repo.save).not.toHaveBeenCalled();
    expect(repo.softDelete).not.toHaveBeenCalled();
  });
});
