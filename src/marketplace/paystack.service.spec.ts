import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { PaystackService } from './paystack.service';

describe('Paystack boundary', () => {
  const service = new PaystackService(
    new ConfigService({
      PAYSTACK_SECRET_KEY: 'test-secret',
      FRONTEND_ORIGIN: 'https://app.example.test',
      CORS_ORIGIN: 'https://app.example.test',
    }),
  );
  afterEach(() => jest.restoreAllMocks());
  it('authenticates exact raw bytes and rejects modified or missing signatures', () => {
    const raw = Buffer.from('{ "event": "charge.success" }');
    const signature = createHmac('sha512', 'test-secret')
      .update(raw)
      .digest('hex');
    expect(() => service.authenticateWebhook(raw, signature)).not.toThrow();
    expect(() =>
      service.authenticateWebhook(
        Buffer.from('{"event":"charge.success"}'),
        signature,
      ),
    ).toThrow();
    expect(() => service.authenticateWebhook(raw, undefined)).toThrow();
    expect(() => service.authenticateWebhook(undefined, signature)).toThrow();
  });
  it('initializes from server values using an encoded, allowlisted callback', async () => {
    const fetcher = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        status: true,
        data: {
          reference: 'persisted',
          authorization_url: 'https://checkout.paystack.com/test',
        },
      }),
    } as Response);
    await expect(
      service.initialize('buyer@example.test', 12345, 'persisted', 'OB-1/?'),
    ).resolves.toBe('https://checkout.paystack.com/test');
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.paystack.co/transaction/initialize',
      expect.objectContaining({
        body: JSON.stringify({
          email: 'buyer@example.test',
          amount: 12345,
          reference: 'persisted',
          currency: 'NGN',
          callback_url: 'https://app.example.test/pay/OB-1%2F%3F',
        }),
      }),
    );
  });
  it.each([
    'http://checkout.paystack.com/test',
    'https://checkout.paystack.com.evil.test/test',
    'https://user@checkout.paystack.com/test',
  ])('rejects unsafe checkout URL %s', async (url) => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        status: true,
        data: { reference: 'ref', authorization_url: url },
      }),
    } as Response);
    await expect(
      service.initialize('buyer@example.test', 100, 'ref', 'OB-1'),
    ).rejects.toMatchObject({ status: 502 });
  });
  it('rejects provider failure without a fake checkout URL', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('network timeout'));
    await expect(
      service.initialize('buyer@example.test', 100, 'ref', 'OB-1'),
    ).rejects.toMatchObject({ status: 502 });
  });
  it('rejects callback origins outside the server allowlist', () => {
    const invalid = new PaystackService(
      new ConfigService({
        PAYSTACK_SECRET_KEY: 'secret',
        FRONTEND_ORIGIN: 'https://other.example.test',
        CORS_ORIGIN: 'https://app.example.test',
      }),
    );
    expect(() => invalid.assertConfigured()).toThrow();
  });
});
