import { matchers } from '../../test/matchers';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { EncryptionService } from '../encryption/encryption.service';
import { OrderTrackingService } from '../orders/order-tracking.service';
import { CloudinaryImagesService } from './cloudinary-images.service';
import { FlutterwaveService } from './flutterwave.service';
import { MarketplaceService } from './marketplace.service';
import { PaystackService } from './paystack.service';

describe('marketplace maintenance diagnostics', () => {
  const query = jest.fn();
  const cleanupPending = jest.fn();
  const manager = { query } as unknown as EntityManager;
  const db = {
    query,
    transaction: (callback: (value: EntityManager) => Promise<unknown>) =>
      callback(manager),
  } as unknown as DataSource;
  const service = new MarketplaceService(
    db,
    { cleanupPending } as unknown as CloudinaryImagesService,
    {} as PaystackService,
    {} as EncryptionService,
    new ConfigService({}),
    {} as OrderTrackingService,
    {} as FlutterwaveService,
  );
  let warn: jest.SpyInstance;
  beforeEach(() => {
    query.mockReset().mockResolvedValue([]);
    cleanupPending.mockReset().mockResolvedValue(undefined);
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('logs the underlying database message and SQLSTATE without query or parameters, then retries', async () => {
    const driverError = Object.assign(
      new Error('relation "marketplace_orders" does not exist'),
      { code: '42P01', detail: 'private row data' },
    );
    query.mockRejectedValueOnce(
      new QueryFailedError('private SQL', ['private parameter'], driverError),
    );
    await service.maintenance();
    expect(warn).toHaveBeenCalledWith(
      'Marketplace maintenance failed during expiring reservations [42P01]: relation "marketplace_orders" does not exist. It will retry.',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/private/);
    await service.maintenance();
    expect(cleanupPending).toHaveBeenCalledTimes(1);
  });

  it('identifies image cleanup errors and redacts connection URLs and credential assignments', async () => {
    cleanupPending.mockRejectedValueOnce(
      new Error('connect postgres://user:password@host/db token=secret-value'),
    );
    await service.maintenance();
    expect(warn).toHaveBeenCalledWith(
      'Marketplace maintenance failed during cleaning up pending images: connect [redacted URL] token=[redacted]. It will retry.',
    );
  });

  it('reports payment verification failures while continuing cleanup', async () => {
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ payment_reference: 'test-reference' }]);
    jest
      .spyOn(service, 'reconcile')
      .mockRejectedValueOnce(new Error('Flutterwave is not configured.'));
    await service.maintenance();
    expect(warn).toHaveBeenCalledWith(
      matchers.stringContaining(
        'verifying a payment: Flutterwave is not configured.',
      ),
    );
    expect(cleanupPending).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenLastCalledWith(
      matchers.stringContaining('last_verified_at=now()'),
      ['test-reference'],
    );
  });
});
