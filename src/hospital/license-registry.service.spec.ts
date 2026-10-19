import { LicenseRegistryService } from './license-registry.service';
import { AdminIntegrationsService } from '../admin/admin-integrations.service';

describe('server registry adapter', () => {
  const input = {
    licenseNumber: 'PCN-1234',
    professionalType: 'PHARMACIST',
    registry: 'PCN',
    lastName: 'Applicant',
  };
  const query = {
    licenseNumber: input.licenseNumber,
    professionalType: input.professionalType,
    registry: input.registry,
  };
  const record = { ...query, lastName: 'Applicant', status: 'ACTIVE' };
  let service: LicenseRegistryService;
  let connection: jest.Mock;
  beforeEach(() => {
    connection = jest
      .fn()
      .mockResolvedValue({
        url: 'https://registry.example.test/lookup',
        apiKey: 'SERVER-SECRET',
      });
    service = new LicenseRegistryService({
      licenseRegistryConnection: connection,
    } as unknown as AdminIntegrationsService);
  });
  afterEach(() => jest.restoreAllMocks());
  const respond = (payload: unknown) =>
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify(payload), {
          headers: { 'content-type': 'application/json' },
        }),
      );

  it.each([
    [{ query, found: true, record }, 'MATCH'],
    [{ query, found: false }, 'NO_MATCH'],
    [
      { query, found: true, record: { ...record, status: 'EXPIRED' } },
      'NO_MATCH',
    ],
    [
      { query, found: true, record: { ...record, lastName: 'Different' } },
      'NO_MATCH',
    ],
    [
      { query, found: true, record: { ...record, status: 'UNKNOWN' } },
      'INCONCLUSIVE',
    ],
    [
      { query, found: true, record: { ...record, lastName: undefined } },
      'INCONCLUSIVE',
    ],
    [{ query, found: true, record, ambiguous: true }, 'INCONCLUSIVE'],
    [
      { query: { ...query, licenseNumber: 'OTHER' }, found: false },
      'INCONCLUSIVE',
    ],
    [{ result: 'MATCH', evidence: 'client-supplied claim' }, 'INCONCLUSIVE'],
    [{}, 'INCONCLUSIVE'],
    [null, 'INCONCLUSIVE'],
  ])('derives %s safely as %s', async (payload, expected) => {
    respond(payload);
    const outcome = await service.lookup(input);
    expect(outcome.result).toBe(expected);
    expect(outcome.evidence.length).toBeGreaterThanOrEqual(5);
    expect(outcome.evidence.length).toBeLessThanOrEqual(4000);
    expect(outcome.evidence).not.toContain('SERVER-SECRET');
    expect(outcome.evidence).not.toContain('Applicant');
  });
  it('sends only the server-owned licence search and keeps credentials in the authorization header', async () => {
    const fetcher = respond({
      query,
      found: true,
      record,
      unrelatedPatient: 'PRIVATE-PATIENT',
    });
    const outcome = await service.lookup(input);
    expect(fetcher).toHaveBeenCalledWith(
      'https://registry.example.test/lookup',
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        headers: expect.objectContaining({
          Authorization: 'Bearer SERVER-SECRET',
        }),
        body: JSON.stringify(query),
      }),
    );
    expect(JSON.stringify(outcome)).not.toMatch(
      /PRIVATE-PATIENT|SERVER-SECRET/,
    );
  });
  it.each([401, 404, 429, 500, 503])(
    'records HTTP %s as unavailable instead of inferring a licence mismatch',
    async (status) => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response('provider or credentials unavailable', { status }),
        );
      expect((await service.lookup(input)).result).toBe('UNAVAILABLE');
    },
  );
  it('records network errors and timeouts as unavailable', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('network failed with SERVER-SECRET'));
    const outcome = await service.lookup(input);
    expect(outcome.result).toBe('UNAVAILABLE');
    expect(outcome.evidence).not.toContain('SERVER-SECRET');
  });
  it('records missing configuration or an unavailable vault as unavailable without calling the registry', async () => {
    const fetcher = jest.spyOn(globalThis, 'fetch');
    connection
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('vault failure'));
    expect((await service.lookup(input)).result).toBe('UNAVAILABLE');
    expect((await service.lookup(input)).result).toBe('UNAVAILABLE');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    ['not JSON', 'application/json'],
    ['<html>proxy response</html>', 'text/html'],
    [JSON.stringify({ long: 'x'.repeat(70000) }), 'application/json'],
  ])(
    'records malformed, unsupported or oversized responses as inconclusive',
    async (body, type) => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response(body, { headers: { 'content-type': type } }),
        );
      expect((await service.lookup(input)).result).toBe('INCONCLUSIVE');
    },
  );
  it('does not fabricate a match when the applicant surname is missing', async () => {
    respond({ query, found: true, record });
    expect((await service.lookup({ ...input, lastName: '' })).result).toBe(
      'INCONCLUSIVE',
    );
  });
});
