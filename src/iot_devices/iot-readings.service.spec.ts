import { matchers } from '../../test/matchers';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, createHmac } from 'crypto';
import { IotReadingsService } from './iot-readings.service';
import { IotDevice } from './entities/iot-device.entity';

interface IotReadingInternals {
  authenticate(
    headers: {
      deviceId: string;
      timestamp: string;
      nonce: string;
      signature: string;
    },
    body: Buffer,
    ip: string,
  ): Promise<IotDevice>;
  validateBatch(device: IotDevice, payload: unknown): unknown[];
}

describe('IotReadingsService device security and batch validation', () => {
  const secret = 'a-test-only-device-signing-secret-with-sufficient-entropy';
  const unitId = '11111111-1111-4111-8111-111111111111';
  const deviceId = 'test-sensor-01';
  const facilityId = '22222222-2222-4222-8222-222222222222';
  let service: IotReadingsService;
  let device: IotDevice;
  let nonceSave: jest.Mock;

  beforeEach(() => {
    process.env.IOT_DEVICE_KEYS = JSON.stringify({ TEST_DEVICE_KEY: secret });
    device = Object.assign(new IotDevice(), {
      id: '33333333-3333-4333-8333-333333333333',
      device_id: deviceId,
      facility_id: facilityId,
      secret_ref: 'TEST_DEVICE_KEY',
      secret_fingerprint: createHash('sha256').update(secret).digest('hex'),
      active: true,
      revoked_at: null,
      sensor_min_celsius: -30,
      sensor_max_celsius: 70,
      expected_interval_seconds: 300,
      units: [
        {
          unit: {
            id: unitId,
            facility_id: facilityId,
          },
        },
      ],
    });
    nonceSave = jest.fn().mockResolvedValue({});
    service = new IotReadingsService(
      {
        findOne: jest.fn().mockResolvedValue(device),
      } as unknown as import('typeorm').Repository<
        import('./entities/iot-device.entity').IotDevice
      >,
      {} as unknown as import('typeorm').Repository<
        import('./entities/iot-device-unit.entity').IotDeviceUnit
      >,
      {
        create: jest.fn((row: unknown) => row),
        save: nonceSave,
      } as unknown as import('typeorm').Repository<
        import('./entities/iot-request-nonce.entity').IotRequestNonce
      >,
      {} as unknown as import('typeorm').Repository<
        import('../storage_units/entities/storage-unit.entity').StorageUnit
      >,
      {} as unknown as import('typeorm').Repository<
        import('../temperature_log/entities/temperature_log.entity').TemperatureLog
      >,
      {} as unknown as import('typeorm').Repository<
        import('../cold_chain_events/entities/cold-chain-outbox.entity').ColdChainOutbox
      >,
      {} as unknown as import('typeorm').DataSource,
      {
        publish: jest.fn(),
      } as unknown as import('../cold_chain_events/cold-chain-event-bus').ColdChainEventBus,
    );
  });

  afterEach(() => {
    delete process.env.IOT_DEVICE_KEYS;
  });

  function signedRequest(body: Buffer, nonce = 'nonce-value-123456') {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', secret)
      .update(`${timestamp}.${nonce}.`)
      .update(body)
      .digest('hex');
    return {
      headers: { deviceId, timestamp, nonce, signature },
      body,
    };
  }

  it('authenticates a valid raw-body HMAC and stores its nonce', async () => {
    const request = signedRequest(Buffer.from('{"readings":[]}'));
    await (service as unknown as IotReadingInternals).authenticate(
      request.headers,
      request.body,
      '127.0.0.1',
    );
    expect(nonceSave).toHaveBeenCalledWith(
      matchers.objectContaining({
        device_id: device.id,
        nonce: request.headers.nonce,
      }),
    );
  });

  it('rejects a tampered request body', async () => {
    const request = signedRequest(Buffer.from('{"readings":[]}'));
    await expect(
      (service as unknown as IotReadingInternals).authenticate(
        request.headers,
        Buffer.from('{"readings":[{}]}'),
        '127.0.0.1',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(nonceSave).not.toHaveBeenCalled();
  });

  it('rejects a reused nonce as a conflict', async () => {
    nonceSave.mockRejectedValue({ code: '23505' });
    const request = signedRequest(Buffer.from('{"readings":[]}'));
    await expect(
      (service as unknown as IotReadingInternals).authenticate(
        request.headers,
        request.body,
        '127.0.0.1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('accepts readings only for an assigned unit within sensor limits', () => {
    const batch = (service as unknown as IotReadingInternals).validateBatch(
      device,
      {
        readings: [
          {
            unitId,
            celsius: 5.2,
            recordedAt: '2026-10-14T12:30:00.000Z',
            sequence: 1842,
          },
        ],
      },
    );
    expect(batch[0]).toEqual({
      unitId,
      celsius: 5.2,
      recordedAt: '2026-10-14T12:30:00.000Z',
      sequence: 1842,
    });
  });

  it('rejects cross-facility units and out-of-range sensor readings', () => {
    expect(() =>
      (service as unknown as IotReadingInternals).validateBatch(device, {
        readings: [
          {
            unitId: '44444444-4444-4444-8444-444444444444',
            celsius: 5,
            recordedAt: '2026-10-14T12:30:00.000Z',
            sequence: 1,
          },
        ],
      }),
    ).toThrow(ForbiddenException);
    expect(() =>
      (service as unknown as IotReadingInternals).validateBatch(device, {
        readings: [
          {
            unitId,
            celsius: 71,
            recordedAt: '2026-10-14T12:30:00.000Z',
            sequence: 2,
          },
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects conflicting sequence numbers within one batch', () => {
    expect(() =>
      (service as unknown as IotReadingInternals).validateBatch(device, {
        readings: [
          {
            unitId,
            celsius: 5,
            recordedAt: '2026-10-14T12:30:00.000Z',
            sequence: 9,
          },
          {
            unitId,
            celsius: 6,
            recordedAt: '2026-10-14T12:31:00.000Z',
            sequence: 9,
          },
        ],
      }),
    ).toThrow(ConflictException);
  });
  it.each([
    undefined,
    null,
    '',
    '2026-10-14',
    '2026-10-14T12:30:00',
    '2026-02-30T12:30:00Z',
  ])(
    'requires actual measurement timestamp with timezone: %s',
    (recordedAt) => {
      expect(() =>
        (service as unknown as IotReadingInternals).validateBatch(device, {
          readings: [{ unitId, celsius: 0, recordedAt, sequence: 1 }],
        }),
      ).toThrow('valid ISO timestamp');
    },
  );
});
