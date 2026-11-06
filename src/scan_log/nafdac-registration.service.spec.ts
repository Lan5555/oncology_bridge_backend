import { ConfigService } from '@nestjs/config';
import { NafdacRegistrationService } from './nafdac-registration.service';

describe('NAFDAC registration evidence via Apify', () => {
  const originalFetch = global.fetch;
  const mockFetch = jest.fn();
  const config = (enabled = 'true', token = 'test-token') =>
    ({
      get: (key: string) =>
        ({ APIFY_API_TOKEN: token, APIFY_NAFDAC_ENABLED: enabled })[key],
    }) as unknown as ConfigService;
  let service: NafdacRegistrationService;
  const row = (extra = {}) => ({
    productId: 123,
    registrationNumber: 'A4-1234',
    productName: 'Example tablets',
    status: 'Active',
    manufacturer: { name: 'Example Pharma' },
    applicant: { name: 'Example Applicant' },
    activeIngredients: ['Example'],
    fetchedAt: new Date().toISOString(),
    expiresAt: '2030-12-31',
    ...extra,
  });
  const response = (body: unknown, status = 201) => ({
    ok: status < 300,
    status,
    json: () => Promise.resolve(body),
  });
  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch;
    service = new NafdacRegistrationService(config());
  });
  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('never makes paid requests without a number and explicit configuration', async () => {
    expect((await service.lookup()).status).toBe('NOT_PROVIDED');
    expect(
      (await new NafdacRegistrationService(config('false')).lookup('A4-1234'))
        .status,
    ).toBe('NOT_CONFIGURED');
    expect(
      (
        await new NafdacRegistrationService(config('true', '')).lookup(
          'A4-1234',
        )
      ).status,
    ).toBe('NOT_CONFIGURED');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('uses the documented actor input and header auth, filters exact NRNs and returns sanitized provenance', async () => {
    mockFetch.mockResolvedValue(
      response([
        row(),
        row({ productId: 124, registrationNumber: 'A4-12345' }),
      ]),
    );
    const result = await service.lookup(' a4-1234 ');
    expect(result.status).toBe('FOUND');
    expect(result.records).toHaveLength(1);
    expect(result.records[0].sourceUrl).toBe(
      'https://greenbook.nafdac.gov.ng/products/details/123',
    );
    expect(result.records[0].registrationExpiresAt).toBe('2030-12-31');
    const [url, options] = mockFetch.mock.calls[0] as [
      string,
      { headers: { Authorization: string }; body: string },
    ];
    expect(url).not.toContain('test-token');
    expect(options.headers.Authorization).toBe('Bearer test-token');
    expect(JSON.parse(options.body)).toEqual({
      registrationNumber: 'A4-1234',
      maxItems: 100,
      includeManufacturer: true,
      includeManufacturerCountry: false,
    });
    expect(JSON.stringify(result)).not.toContain('test-token');
    await service.lookup('A4-1234');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('reports multiple exact records as ambiguous, never selects the first', async () => {
    mockFetch.mockResolvedValue(
      response([row(), row({ productId: 124, productName: 'Other product' })]),
    );
    const result = await service.lookup('A4-1234');
    expect(result.status).toBe('AMBIGUOUS');
    expect(result.records).toHaveLength(2);
  });

  it('does not treat partial number matches as registered or definitively absent', async () => {
    mockFetch.mockResolvedValue(
      response([row({ registrationNumber: 'A4-12345' })]),
    );
    const result = await service.lookup('A4-1234');
    expect(result.status).toBe('NO_EXACT_MATCH');
    expect(result.completeness).toBe('NOT_GUARANTEED');
    expect(result.records).toEqual([]);
  });

  it.each([401, 402, 408, 429, 500])(
    'fails honestly without exposing upstream errors for HTTP %s',
    async (status) => {
      mockFetch.mockResolvedValue(
        response({ error: { message: 'test-token' } }, status),
      );
      const result = await service.lookup('A4-1234');
      expect(result.status).toBe('UNAVAILABLE');
      expect(JSON.stringify(result)).not.toContain('test-token');
    },
  );

  it.each([
    { error: 'upstream' },
    [{ error: 'upstream' }],
    [row({ fetchedAt: '2020-01-01T00:00:00Z' })],
    [row({ fetchedAt: '2099-01-01T00:00:00Z' })],
    [row({ status: 'Unknown' })],
    [row({ productId: '../evil' })],
    Array.from({ length: 100 }, () => row()),
    [row(), row()],
  ])(
    'rejects malformed, stale, duplicate or potentially truncated evidence',
    async (body) => {
      mockFetch.mockResolvedValue(response(body));
      expect((await service.lookup('A4-1234')).status).toBe('UNAVAILABLE');
    },
  );

  it('does not retry an uncertain paid run after a transport failure', async () => {
    mockFetch.mockRejectedValue(new Error('sensitive upstream test-token'));
    const result = await service.lookup('A4-1234');
    expect(result.status).toBe('UNAVAILABLE');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('test-token');
  });

  it('coalesces equal lookups and bounds concurrent paid runs', async () => {
    let finish!: (value: unknown) => void;
    mockFetch.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const first = service.lookup('A4-1234');
    const same = service.lookup('a4-1234');
    const second = service.lookup('A4-2222');
    expect((await service.lookup('A4-3333')).status).toBe('UNAVAILABLE');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    finish(response([]));
    await Promise.all([first, same, second]);
  });
});
