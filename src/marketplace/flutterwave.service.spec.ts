import { matchers } from '../../test/matchers';
import { ConfigService } from '@nestjs/config';
import { FlutterwaveService } from './flutterwave.service';

describe('Flutterwave Standard v3 boundary', () => {
  const service = new FlutterwaveService(
    new ConfigService({
      FLUTTERWAVE_SECRET_KEY: 'test-only',
      FLUTTERWAVE_SECRET_HASH: 'webhook-test-only',
      FRONTEND_ORIGIN: 'https://app.example.test',
      CORS_ORIGIN: 'https://app.example.test',
    }),
  );
  afterEach(() => jest.restoreAllMocks());
  const respond = (data: object) =>
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'success', data }),
    } as Response);
  it('uses server reference, major units and an allowlisted callback', async () => {
    const fetcher = respond({
      link: 'https://checkout.flutterwave.com/v3/hosted/pay/test',
    });
    await expect(
      service.initialize('buyer@example.test', 12345, 'persisted', 'OB-1/?'),
    ).resolves.toContain('https://checkout.flutterwave.com/');
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.flutterwave.com/v3/payments',
      matchers.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string) as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({
      amount: '123.45',
      currency: 'NGN',
      tx_ref: 'persisted',
      customer: { email: 'buyer@example.test' },
      redirect_url: 'https://app.example.test/pay/OB-1%2F%3F',
    });
    expect(body.payload_hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([
    'http://checkout.flutterwave.com/pay',
    'https://checkout.flutterwave.com.evil.test/pay',
    'https://user@checkout.flutterwave.com/pay',
  ])('rejects unsafe URL %s', async (link) => {
    respond({ link });
    await expect(
      service.initialize('buyer@example.test', 100, 'ref', 'invoice'),
    ).rejects.toMatchObject({ status: 502 });
  });
  it('verifies by encoded persisted reference and normalizes successful payments to kobo', async () => {
    const fetcher = respond({
      status: 'successful',
      amount: 19.99,
      currency: 'NGN',
      tx_ref: 'ref/?',
    });
    await expect(service.verify('ref/?')).resolves.toEqual({
      status: 'success',
      amount: 1999,
      currency: 'NGN',
      reference: 'ref/?',
    });
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=ref%2F%3F',
    );
  });
  it.each([null, 'invalid', -1, 1.001])(
    'rejects invalid amount %s',
    async (amount) => {
      respond({ status: 'successful', amount, currency: 'NGN', tx_ref: 'ref' });
      await expect(service.verify('ref')).rejects.toMatchObject({
        status: 502,
      });
    },
  );
  it('authenticates v3 secret hashes and rejects missing configuration', () => {
    expect(() =>
      service.authenticateWebhook('webhook-test-only'),
    ).not.toThrow();
    for (const signature of [undefined, '', 'wrong'])
      expect(() => service.authenticateWebhook(signature)).toThrow();
    const missing = new FlutterwaveService(new ConfigService({}));
    expect(() => missing.authenticateWebhook('anything')).toThrow();
    expect(() => missing.assertConfigured()).toThrow();
  });
  it('does not invent a link on network failure', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'));
    await expect(
      service.initialize('buyer@example.test', 100, 'ref', 'invoice'),
    ).rejects.toMatchObject({ status: 502 });
  });
});
