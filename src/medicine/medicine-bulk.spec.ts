import { matchers } from '../../test/matchers';
import { ForbiddenException, ValidationPipe } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { StockAccessService } from '../guards/stock-access.service';
import { BulkCreateMedicinesDto } from './dto/bulk-create-medicines.dto';
import { Medicine } from './entities/medicine.entity';
import { MedicineService } from './medicine.service';

const medicine = {
  gtin: '12345678901231',
  generic_name: 'Drug',
  brand_name: 'Brand',
  manufacturer: 'Maker',
  strength: '10 mg',
  dosage_form: 'vial',
  storage_temperature: '2-8 C',
};

describe('bulk medicine creation', () => {
  let service: MedicineService;
  let repo: { find: jest.Mock; create: jest.Mock; save: jest.Mock };
  let access: { catalogueActor: jest.Mock };
  let manager: EntityManager;
  beforeEach(() => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((row: unknown) => row),
      save: jest.fn((rows: Medicine[]) =>
        Promise.resolve(
          rows.map((row, index) => ({ ...row, id: `id-${index}` })),
        ),
      ),
    };
    manager = { getRepository: () => repo } as unknown as EntityManager;
    access = {
      catalogueActor: jest.fn().mockResolvedValue({ facilityId: 'facility-a' }),
    };
    service = new MedicineService(
      repo as unknown as Repository<Medicine>,
      {
        transaction: (fn: (value: EntityManager) => Promise<unknown>) =>
          fn(manager),
      } as unknown as DataSource,
      access as unknown as StockAccessService,
    );
  });

  it('creates the batch in order with server-derived ownership and transaction-scoped authorization', async () => {
    const result = await service.createBulk(
      { medicines: [medicine, { ...medicine, gtin: '00012345600012' }] },
      'staff',
    );
    expect(access.catalogueActor).toHaveBeenCalledWith(
      'staff',
      'medicine.create',
      manager,
    );
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(result.data).toMatchObject({
      count: 2,
      medicines: [
        { id: 'id-0', gtin: medicine.gtin, catalog_facility_id: 'facility-a' },
        {
          id: 'id-1',
          gtin: '00012345600012',
          catalog_facility_id: 'facility-a',
        },
      ],
    });
  });

  it('preserves shared ownership for authorized network administrators', async () => {
    access.catalogueActor.mockResolvedValue({ facilityId: null });
    const result = await service.createBulk({ medicines: [medicine] }, 'admin');
    expect(result.data?.medicines[0].catalog_facility_id).toBeNull();
  });

  it('does not write when authorization fails', async () => {
    access.catalogueActor.mockRejectedValue(new ForbiddenException());
    await expect(
      service.createBulk({ medicines: [medicine] }, 'staff'),
    ).rejects.toMatchObject({ status: 403 });
    expect(repo.save).not.toHaveBeenCalled();
  });

  it.each([
    { ...medicine, gtin: '12345678901230' },
    { ...medicine, generic_name: '  ' },
  ])('rejects invalid rows before saving', async (invalid) => {
    await expect(
      service.createBulk({ medicines: [invalid] }, 'staff'),
    ).rejects.toMatchObject({ status: 400 });
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('reports zero-based row indexes for duplicate GTINs within the request', async () => {
    await expect(
      service.createBulk({ medicines: [medicine, medicine] }, 'staff'),
    ).rejects.toMatchObject({
      response: { data: { errors: [{ index: 1, field: 'gtin' }] } },
    });
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('rejects existing GTINs including deleted records without inserting any rows', async () => {
    repo.find.mockResolvedValue([{ gtin: medicine.gtin }]);
    await expect(
      service.createBulk({ medicines: [medicine] }, 'staff'),
    ).rejects.toMatchObject({
      status: 409,
      response: { data: { errors: [{ index: 0, field: 'gtin' }] } },
    });
    expect(repo.find).toHaveBeenCalledWith(
      matchers.objectContaining({ withDeleted: true }),
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('translates a concurrent unique violation to a conflict', async () => {
    repo.save.mockRejectedValue({ driverError: { code: '23505' } });
    await expect(
      service.createBulk({ medicines: [medicine] }, 'staff'),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('propagates other database errors', async () => {
    repo.save.mockRejectedValue(new Error('Database unavailable'));
    await expect(
      service.createBulk({ medicines: [medicine] }, 'staff'),
    ).rejects.toThrow('Database unavailable');
  });
});

describe('bulk medicine request validation', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const validate = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: BulkCreateMedicinesDto });

  it.each([
    {},
    { medicines: [] },
    { medicines: Array.from({ length: 101 }, () => medicine) },
    { medicines: [null] },
    { medicines: ['invalid'] },
    { medicines: [{ ...medicine, strength: 10 }] },
    { medicines: [{ ...medicine, brand_name: undefined }] },
    { medicines: [{ ...medicine, catalog_facility_id: 'foreign-facility' }] },
    { medicines: [medicine], facilityId: 'foreign-facility' },
  ])('rejects malformed, oversized, or extra fields: %j', async (body) => {
    await expect(validate(body)).rejects.toMatchObject({ status: 400 });
  });

  it('accepts a batch at the size limit', async () => {
    const body = { medicines: Array.from({ length: 100 }, () => medicine) };
    await expect(validate(body)).resolves.toBeInstanceOf(
      BulkCreateMedicinesDto,
    );
  });
});
