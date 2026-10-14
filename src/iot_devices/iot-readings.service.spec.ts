import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, createHmac } from 'crypto';
import { IotReadingsService } from './iot-readings.service';

describe('IotReadingsService device security and batch validation', () => {
  const secret = 'a-test-only-device-signing-secret-with-sufficient-entropy';
  const unitId = '11111111-1111-4111-8111-111111111111';
  const deviceId = 'test-sensor-01';
  const facilityId = '22222222-2222-4222-8222-222222222222';
  let service: IotReadingsService;
  let device: any;
  let nonceSave: jest.Mock;

  beforeEach(() => {
    process.env.IOT_DEVICE_KEYS = JSON.stringify({ TEST_DEVICE_KEY: secret });
    device = {
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
    };
    nonceSave = jest.fn().mockResolvedValue({});
    service = new IotReadingsService(
      { findOne: jest.fn().mockResolvedValue(device) } as any,
      {} as any,
      {
        create: jest.fn((row) => row),
        save: nonceSave,
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { publish: jest.fn() } as any,
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
    await (service as any).authenticate(
      request.headers,
      request.body,
      '127.0.0.1',
    );
    expect(nonceSave).toHaveBeenCalledWith(
      expect.objectContaining({
        device_id: device.id,
        nonce: request.headers.nonce,
      }),
    );
  });

  it('rejects a tampered request body', async () => {
    const request = signedRequest(Buffer.from('{"readings":[]}'));
    await expect(
      (service as any).authenticate(
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
      (service as any).authenticate(request.headers, request.body, '127.0.0.1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('accepts readings only for an assigned unit within sensor limits', () => {
    const batch = (service as any).validateBatch(device, {
      readings: [
        {
          unitId,
          celsius: 5.2,
          recordedAt: '2026-10-14T12:30:00.000Z',
          sequence: 1842,
        },
      ],
    });
    expect(batch[0]).toEqual({
      unitId,
      celsius: 5.2,
      recordedAt: '2026-10-14T12:30:00.000Z',
      sequence: 1842,
    });
  });

  it('rejects cross-facility units and out-of-range sensor readings', () => {
    expect(() =>
      (service as any).validateBatch(device, {
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
      (service as any).validateBatch(device, {
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
      (service as any).validateBatch(device, {
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
});
