import {
  businessLabel,
  currencyPreference,
  recordedNumber,
} from './business-values';
import { SettingsService } from '../settings/settings.service';
import { Setting } from '../settings/entities/setting.entity';
import { Repository } from 'typeorm';
import { readingPresentation } from '../storage_units/reading-presentation';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateListingDto,
  ListingQueryDto,
} from '../marketplace/marketplace.dto';
import { UpdateHospitalDto } from '../hospital/dto/update-hospital.dto';
import { PrescriptionsService } from '../prescriptions/prescriptions.service';
import { Prescription } from '../prescriptions/entities/prescription.entity';
import { OrderEvent } from '../prescriptions/entities/order-event.entity';
import { User } from '../users/entities/user.entity';
import { FormOptionsService } from '../form_options/form-options.service';

describe('explicit business values and missing data', () => {
  it('accepts category and payment labels beyond former fixed lists', () => {
    expect(businessLabel('  Radiopharmaceuticals  ', 'category', 100)).toBe(
      'Radiopharmaceuticals',
    );
    expect(
      businessLabel('New mutual benefit plan', 'insurer/payment method', 120),
    ).toBe('New mutual benefit plan');
    for (const value of [
      '',
      '   ',
      'x'.repeat(121),
      { name: 'insurer' },
      'bad\nlabel',
    ])
      expect(() => businessLabel(value, 'insurer/payment method', 120)).toThrow(
        'insurer/payment method',
      );
  });

  it('validates free category input and category search without offering fixed choices', async () => {
    const fields = {
      inventoryItemId: '00000000-0000-4000-8000-000000000001',
      category: '  Radiopharmaceuticals  ',
      unitPriceNaira: '1',
      availableQuantity: '1',
      unit: 'box',
      storage: 'Room temperature',
      description: 'Stock',
      prescriptionRequired: 'false',
    };
    expect(await validate(plainToInstance(CreateListingDto, fields))).toEqual(
      [],
    );
    expect(plainToInstance(CreateListingDto, fields).category).toBe(
      'Radiopharmaceuticals',
    );
    expect(
      await validate(
        plainToInstance(ListingQueryDto, { category: 'New category' }),
      ),
    ).toEqual([]);
    expect(
      await validate(plainToInstance(ListingQueryDto, { category: '' })),
    ).toEqual([]);
    expect(
      await validate(
        plainToInstance(CreateListingDto, { ...fields, category: ' ' }),
      ),
    ).not.toHaveLength(0);
    expect(
      await validate(
        plainToInstance(ListingQueryDto, { category: 'x'.repeat(101) }),
      ),
    ).not.toHaveLength(0);
  });

  it('keeps unknown facility presentation values out of persistence', async () => {
    expect(
      await validate(plainToInstance(UpdateHospitalDto, { status: 'UNKNOWN' })),
    ).not.toHaveLength(0);
    expect(
      await validate(
        plainToInstance(UpdateHospitalDto, { status: 'SUSPENDED' }),
      ),
    ).toEqual([]);
    expect(
      await validate(
        plainToInstance(UpdateHospitalDto, { facility_type: 'UNKNOWN' }),
      ),
    ).not.toHaveLength(0);
  });

  it('validates supplied insurer/payment labels on prescription creation and updates before saving', async () => {
    const row = Object.assign(new Prescription(), {
      id: 'prescription',
      auth_status: 'Pending',
      order_stage: 'Waiting',
      version: 1,
    });
    const save = jest.fn((data: Prescription) => Promise.resolve(data));
    const prescriptions = {
      create: (data: Partial<Prescription>) => Object.assign(row, data),
      save,
      findOne: () => Promise.resolve(row),
      manager: { query: () => Promise.resolve([{ value: 'Self pay' }]) },
    } as unknown as Repository<Prescription>;
    const manager = {
      query: () => Promise.resolve([{ value: 'Self pay' }]),
      getRepository: () => prescriptions,
    };
    Object.assign(prescriptions, {
      manager: {
        ...manager,
        transaction: async (callback: (value: typeof manager) => unknown) =>
          callback(manager),
      },
    });
    const events = {
      create: (data: Partial<OrderEvent>) => data,
      save: () => Promise.resolve(),
    } as unknown as Repository<OrderEvent>;
    const service = new PrescriptionsService(
      prescriptions,
      events,
      {} as Repository<User>,
      {
        actor: () =>
          Promise.resolve({ actor: { id: 'doctor', account_type: 'DOCTOR' } }),
      } as unknown as FormOptionsService,
    );
    const data = {
      patient_ref: 'pseudonym',
      icd10: 'C50',
      drug_id: 'medicine',
      pharmacy_facility_id: 'pharmacy',
      prescriber_id: 'doctor',
      qty: 1,
    };
    expect(
      (
        await service.update(
          row.id,
          { insurer: 'Self pay' },
          undefined,
          'doctor',
        )
      ).insurer,
    ).toBe('Self pay');
    const writes = save.mock.calls.length;
    await expect(service.create({ ...data, insurer: ' ' })).rejects.toThrow();
    await expect(
      service.update(row.id, { insurer: 'x'.repeat(121) }, undefined, 'doctor'),
    ).rejects.toThrow('120');
    expect(save).toHaveBeenCalledTimes(writes);
  });

  it('normalizes a new currency, permits clearing it and does not invent a default', async () => {
    const records = new Map<string, unknown>();
    const save = jest.fn((rows: Setting[]) => {
      for (const row of rows) records.set(row.key, row.value);
      return Promise.resolve(rows);
    });
    const repository = {
      find: () =>
        Promise.resolve([...records].map(([key, value]) => ({ key, value }))),
      create: (row: Setting) => row,
      save,
    };
    const manager = {
      query: () => Promise.resolve([{ value: 'ZAR' }]),
      getRepository: () => repository,
    };
    const settings = new SettingsService({
      ...repository,
      manager: {
        ...manager,
        transaction: async (callback: (value: typeof manager) => unknown) =>
          callback(manager),
      },
    } as unknown as Repository<Setting>);
    expect(await settings.all()).toEqual({});
    expect(await settings.update({ currency: ' zar ', threshold: 0 })).toEqual({
      currency: 'ZAR',
      threshold: 0,
    });
    expect(await settings.update({ currency: '' })).toEqual({
      currency: null,
      threshold: 0,
    });
    const calls = save.mock.calls.length;
    await expect(
      settings.update({ currency: 'NOT-A-CURRENCY', threshold: 99 }),
    ).rejects.toThrow('ISO 4217');
    expect(save).toHaveBeenCalledTimes(calls);
    expect(await settings.all()).toEqual({ currency: null, threshold: 0 });
    expect(currencyPreference(null)).toBeNull();
    expect(() => currencyPreference(0)).toThrow();
  });

  it('distinguishes missing numbers from actual recorded zero', () => {
    for (const value of [null, undefined, '', ' ', true, NaN, Infinity])
      expect(recordedNumber(value)).toBeNull();
    expect(recordedNumber(0)).toBe(0);
    expect(recordedNumber('0')).toBe(0);
  });
});

describe('cold-chain presentation without invented measurements or policy', () => {
  const reading = {
    temperature: 0,
    recordedAt: '2026-10-22T10:00:00.000Z',
    targetMin: 0,
    targetMax: 10,
  };
  it('preserves real zero and classifies configured non-default limits', () => {
    expect(readingPresentation(reading)).toMatchObject({
      currentC: 0,
      readingState: 'NOMINAL',
      targetMin: 0,
      targetMax: 10,
    });
    expect(
      readingPresentation({ ...reading, targetMin: 10, targetMax: 20 }),
    ).toMatchObject({ currentC: 0, readingState: 'BREACH' });
  });
  it.each([undefined, null, '', 'invalid'])(
    'does not substitute receipt time for timestamp %s',
    (recordedAt) => {
      expect(readingPresentation({ ...reading, recordedAt })).toMatchObject({
        currentC: null,
        currentReadingAt: null,
        readingState: 'UNKNOWN',
      });
    },
  );
  it.each([
    [null, 8],
    [undefined, 8],
    ['', 8],
    [8, 2],
    [2, 2],
    [NaN, 8],
    [2, Infinity],
  ])('does not classify without valid limits %s/%s', (targetMin, targetMax) => {
    expect(
      readingPresentation({ ...reading, targetMin, targetMax }),
    ).toMatchObject({
      targetMin: null,
      targetMax: null,
      readingState: 'UNKNOWN',
    });
  });
  it('requires recorded offline evidence and keeps missing telemetry unknown', () => {
    expect(readingPresentation({})).toMatchObject({
      currentC: null,
      readingState: 'UNKNOWN',
    });
    expect(readingPresentation({ operationalState: 'OFFLINE' })).toMatchObject({
      readingState: 'OFFLINE',
    });
    expect(
      readingPresentation(
        {
          ...reading,
          lastSeenAt: '2026-10-22T10:00:00Z',
          offlineAfterSeconds: 60,
        },
        Date.parse('2026-10-22T10:02:00Z'),
      ).readingState,
    ).toBe('OFFLINE');
  });
});
