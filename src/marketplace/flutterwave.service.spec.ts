import { matchers } from '../../test/matchers';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { FlutterwaveService } from './flutterwave.service';

describe('Flutterwave Standard v3 boundary', () => {
  const service = new FlutterwaveService(
    new ConfigService({
      FLUTTERWAVE_SECRET_KEY: 'FLWSECK-live-fixture-X',
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
      amount: 123.45,
      currency: 'NGN',
      tx_ref: 'persisted',
      customer: { email: 'buyer@example.test' },
      redirect_url: 'https://app.example.test/pay/OB-1%2F%3F',
    });
  });
  it('accepts the Flutterwave test checkout host with a test key', async () => {
    const testGateway = new FlutterwaveService(
      new ConfigService({
        FLUTTERWAVE_SECRET_KEY: 'FLWSECK_TEST-fixture-X',
        FRONTEND_ORIGIN: 'https://app.example.test',
        CORS_ORIGIN: 'https://app.example.test',
      }),
    );
    const link = 'https://checkout-v2.dev-flutterwave.com/v3/hosted/pay/test';
    respond({ link });

    await expect(
      testGateway.initialize('buyer@example.test', 100, 'ref', 'invoice'),
    ).resolves.toBe(link);
  });
  it.each([
    [250000, 2500],
    [250050, 2500.5],
    [250051, 2500.51],
  ])(
    'creates a hosted link for %i kobo without the optional checksum',
    async (kobo, naira) => {
      const fetcher = respond({
        link: 'https://checkout.flutterwave.com/v3/hosted/pay/test',
      });
      await service.initialize('buyer@example.test', kobo, 'ref', 'invoice');

      const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
      expect(body).toMatchObject({ amount: naira });
      expect(body).not.toHaveProperty('payload_hash');
    },
  );
  it('sends an allowlisted local development callback with the invoice path', async () => {
    const local = new FlutterwaveService(
      new ConfigService({
        NODE_ENV: 'development',
        FLUTTERWAVE_SECRET_KEY: 'test-only',
        FLUTTERWAVE_SECRET_HASH: 'webhook-test-only',
        FRONTEND_ORIGIN: 'http://localhost:3001',
        CORS_ORIGIN: 'http://localhost:3001',
      }),
    );
    const fetcher = respond({
      link: 'https://checkout.flutterwave.com/v3/hosted/pay/test',
    });

    expect(() => local.assertConfigured()).not.toThrow();
    await local.initialize('buyer@example.test', 100, 'ref', 'OB-local');
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toMatchObject({
      redirect_url: 'http://localhost:3001/pay/OB-local',
    });
  });
  it.each([
    ['production', 'http://localhost:3001', 'http://localhost:3001'],
    ['development', 'http://portal.example.test', 'http://portal.example.test'],
    ['development', 'http://localhost:3001', 'http://localhost:3002'],
  ])(
    'rejects an unsafe %s callback origin %s',
    (environment, origin, allowed) => {
      const gateway = new FlutterwaveService(
        new ConfigService({
          NODE_ENV: environment,
          FLUTTERWAVE_SECRET_KEY: 'test-only',
          FLUTTERWAVE_SECRET_HASH: 'webhook-test-only',
          FRONTEND_ORIGIN: origin,
          CORS_ORIGIN: allowed,
        }),
      );
      expect(() => gateway.assertConfigured()).toThrow('FRONTEND_ORIGIN');
    },
  );
  it.each([
    [undefined, 'data.link is missing, blank, or not a string'],
    ['/pay/session-token', 'data.link is not an absolute URL'],
    ['http://checkout.flutterwave.com/pay', 'the URL does not use HTTPS'],
    [
      'https://checkout.flutterwave.com.evil.test/pay?token=session-token',
      'unexpected hostname (checkout.flutterwave.com.evil.test)',
    ],
    [
      'https://user:password@checkout.flutterwave.com/pay',
      'the URL embeds credentials',
    ],
    [
      'https://checkout.flutterwave.com:8443/pay',
      'the URL uses a nonstandard HTTPS port',
    ],
    [
      'https://checkout-v2.dev-flutterwave.com/v3/hosted/pay/test',
      'unexpected hostname (checkout-v2.dev-flutterwave.com)',
    ],
  ])(
    'rejects unsafe checkout link %s and logs only the reason',
    async (link, reason) => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      respond({ link });
      await expect(
        service.initialize('buyer@example.test', 100, 'ref', 'invoice'),
      ).rejects.toMatchObject({ status: 502 });
      expect(warn.mock.calls).toEqual([
        [`Flutterwave checkout link rejected. Reason: ${reason}.`],
      ]);
    },
  );
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

  it('logs the upstream HTTP status without reading the error response body', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const json = jest.fn();
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      json,
    } as unknown as Response);

    await expect(
      service.initialize('buyer@example.test', 100, 'ref', 'invoice'),
    ).rejects.toMatchObject({ status: 502 });
    expect(warn).toHaveBeenCalledWith(
      'Flutterwave checkout request failed. Flutterwave returned HTTP 401.',
    );
    expect(json).not.toHaveBeenCalled();
  });
});
