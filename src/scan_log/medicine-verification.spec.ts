import { ConfigService } from '@nestjs/config';
import { MedicineVerificationService } from './medicine-verification.service';
import { OpenFdaLabelService } from './openfda-label.service';
import { verificationBarcode } from './verification-barcode';

const gtin = '09506000134352';
const rawBarcode = `(01)${gtin}(17)271200(10)LOT1(21)SERIAL1`;

describe('medicine authenticity evidence', () => {
  const lookup = jest.fn();
  const registrationLookup = jest.fn();
  const service = new MedicineVerificationService(
    { lookup } as unknown as OpenFdaLabelService,
    {
      lookup: registrationLookup,
    } as unknown as import('./nafdac-registration.service').NafdacRegistrationService,
  );
  beforeEach(() => {
    lookup.mockReset();
    registrationLookup
      .mockReset()
      .mockResolvedValue({ status: 'NOT_PROVIDED', records: [] });
  });

  it('parses scanner group separators and month-end expiry', () => {
    expect(
      verificationBarcode(`]d201${gtin}1727120010LOT1\u001d21SERIAL1`),
    ).toEqual({ gtin, expiry: '2027-12-31', lot: 'LOT1', serial: 'SERIAL1' });
  });

  it.each([
    `(01)${gtin}99`,
    `(01)${gtin}(01)${gtin}`,
    `(01)${gtin}(17)270230`,
    `(01)${gtin}(21)${'A'.repeat(21)}`,
    `(01)${gtin}(99)unknown`,
    `(01)09506000134351`,
  ])('rejects malformed or ambiguous data: %s', (raw) => {
    expect(() => verificationBarcode(raw)).toThrow();
  });

  it('does not convert matching public label data into pack authentication', async () => {
    lookup.mockResolvedValue({
      status: 'FOUND',
      url: 'https://api.fda.gov/drug/label.json',
      label: {
        id: 'label',
        openfda: {
          brand_name: ['Example'],
          manufacturer_name: ['Example Pharma'],
        },
      },
    });
    const result = await service.verify({
      rawBarcode,
      brandName: ' EXAMPLE ',
      manufacturer: 'Other company',
    });
    expect(result.authenticity.status).toBe('UNVERIFIED');
    expect(result.comparisons.map((c) => c.status)).toEqual([
      'MATCH',
      'NOT_PROVIDED',
      'MISMATCH',
    ]);
    expect(result.expiry.verifiedByManufacturer).toBe(false);
    expect(result.recall.status).toBe('NOT_CHECKED');
  });

  it.each(['NOT_FOUND', 'UNAVAILABLE', 'AMBIGUOUS'])(
    'keeps %s distinct and unverified',
    async (status) => {
      lookup.mockResolvedValue({
        status,
        url: 'https://api.fda.gov/drug/label.json',
        label: null,
      });
      const result = await service.verify({ gtin, brandName: 'Example' });
      expect(result.productLookup.status).toBe(status);
      expect(result.authenticity.status).toBe('UNVERIFIED');
      expect(result.comparisons[0].status).toBe('UNAVAILABLE');
      expect(result.expiry.status).toBe('UNKNOWN');
    },
  );

  it('flags encoded expiry separately from authenticity', async () => {
    lookup.mockResolvedValue({
      status: 'NOT_FOUND',
      url: 'https://api.fda.gov/drug/label.json',
      label: null,
    });
    const result = await service.verify({
      rawBarcode: `(01)${gtin}(17)200101`,
    });
    expect(result.expiry.status).toBe('EXPIRED');
    expect(result.authenticity.status).toBe('UNVERIFIED');
  });

  it.each([{}, { rawBarcode, gtin }, { gtin: '09506000134351' }])(
    'rejects invalid requests before provider call',
    async (dto) => {
      await expect(service.verify(dto)).rejects.toThrow();
      expect(lookup).not.toHaveBeenCalled();
    },
  );

  it('supports a NAFDAC-only check without calling openFDA and compares only the exact returned record', async () => {
    registrationLookup.mockResolvedValue({
      status: 'FOUND',
      records: [
        {
          productName: 'Example tablets',
          manufacturer: 'Example Pharma',
          strength: '20 mg',
          status: 'Active',
          registrationExpiresAt: '2099-01-01',
        },
      ],
    });
    const result = await service.verify({
      nafdacNumber: 'A4-1234',
      productName: ' Example tablets ',
      manufacturer: 'Other',
      strength: '20 mg',
    });
    expect(lookup).not.toHaveBeenCalled();
    expect(result.productLookup.status).toBe('NOT_REQUESTED');
    expect(result.registrationLookup.comparisons.map((c) => c.status)).toEqual([
      'MATCH',
      'MISMATCH',
      'MATCH',
    ]);
    expect(result.registrationLookup.barcodeLink).toBe('NOT_ESTABLISHED');
    expect(result.identifiers.gtin).toBeNull();
    expect(result.authenticity.status).toBe('UNVERIFIED');
  });

  it('does not auto-select ambiguous registration records', async () => {
    lookup.mockResolvedValue({ status: 'NOT_FOUND', url: null, label: null });
    registrationLookup.mockResolvedValue({
      status: 'AMBIGUOUS',
      records: [{ productName: 'A' }, { productName: 'B' }],
    });
    const result = await service.verify({
      gtin,
      nafdacNumber: 'A4-1234',
      productName: 'A',
    });
    expect(result.registrationLookup.comparisons).toEqual([]);
    expect(result.authenticity.status).toBe('UNVERIFIED');
  });

  it('warns about inactive registration without reporting a counterfeit', async () => {
    registrationLookup.mockResolvedValue({
      status: 'FOUND',
      records: [
        { productName: 'A', status: 'Inactive', registrationExpiresAt: null },
      ],
    });
    const result = await service.verify({ nafdacNumber: 'A4-1234' });
    expect(result.guidance).toContain('inactive');
    expect(result.authenticity.status).toBe('UNVERIFIED');
  });

  describe('combined record verdict', () => {
    const record = {
      productName: 'Example tablets',
      manufacturer: 'Example Pharma',
      status: 'Active',
      registrationExpiresAt: '2099-01-01',
    };
    beforeEach(() => {
      lookup.mockResolvedValue({
        status: 'FOUND',
        url: null,
        label: {
          id: 'label',
          openfda: {
            brand_name: ['Example tablets'],
            manufacturer_name: ['Example Pharma'],
            product_ndc: ['12345-678'],
          },
        },
      });
      registrationLookup.mockResolvedValue({
        status: 'FOUND',
        records: [record],
      });
    });

    it('accepts matching source records without user-entered names', async () => {
      const result = await service.verify({ gtin, nafdacNumber: 'A4-1234' });
      expect(result.validation.status).toBe('VALID');
      expect(result.validation.reasons).toEqual([]);
      expect(result.productLookup.official?.productNdcs).toEqual(['12345-678']);
      expect(result.registrationLookup.recordLink).toBe(
        'PRODUCT_AND_MANUFACTURER_MATCH',
      );
      expect(result.authenticity.status).toBe('UNVERIFIED');
    });

    it.each([
      [{ productName: 'Other product' }, 'CROSS_SOURCE_PRODUCT_MISMATCH'],
      [
        { manufacturer: 'Other manufacturer' },
        'CROSS_SOURCE_MANUFACTURER_MISMATCH',
      ],
      [{ manufacturer: null }, 'CROSS_SOURCE_MANUFACTURER_UNAVAILABLE'],
      [{ status: 'Inactive' }, 'NAFDAC_INACTIVE'],
      [{ registrationExpiresAt: '2000-01-01' }, 'NAFDAC_REGISTRATION_EXPIRED'],
      [{ dataQualityNote: 'Conflicting source fields' }, 'NAFDAC_DATA_QUALITY'],
    ])(
      'warns for conflicting or incomplete registration evidence: %j',
      async (changes, code) => {
        registrationLookup.mockResolvedValue({
          status: 'FOUND',
          records: [{ ...record, ...changes }],
        });
        const result = await service.verify({ gtin, nafdacNumber: 'A4-1234' });
        expect(result.validation.status).toBe('WARNING');
        expect(result.validation.reasons).toEqual(
          expect.arrayContaining([expect.objectContaining({ code })]),
        );
      },
    );

    it.each([
      'NOT_PROVIDED',
      'NOT_CONFIGURED',
      'NO_EXACT_MATCH',
      'AMBIGUOUS',
      'UNAVAILABLE',
    ])('warns when NAFDAC lookup is %s', async (status) => {
      registrationLookup.mockResolvedValue({ status, records: [] });
      const result = await service.verify({ gtin });
      expect(result.validation.status).toBe('WARNING');
      expect(result.validation.reasons[0].code).toBe(`NAFDAC_${status}`);
    });

    it.each(['NOT_FOUND', 'UNAVAILABLE', 'AMBIGUOUS'])(
      'requires openFDA evidence even with an active registration: %s',
      async (status) => {
        lookup.mockResolvedValue({ status, url: null, label: null });
        const result = await service.verify({ gtin, nafdacNumber: 'A4-1234' });
        expect(result.validation.status).toBe('WARNING');
        expect(result.validation.reasons[0].code).toBe(`OPENFDA_${status}`);
      },
    );

    it('blocks expired packs and supplied packaging mismatches even when sources agree', async () => {
      const result = await service.verify({
        rawBarcode: `(01)${gtin}(17)200101`,
        manufacturer: 'Other',
      });
      expect(result.validation.status).toBe('WARNING');
      expect(result.validation.reasons.map((item) => item.code)).toEqual(
        expect.arrayContaining([
          'PACK_EXPIRED',
          'OPENFDA_MANUFACTURER_MISMATCH',
          'NAFDAC_MANUFACTURER_MISMATCH',
        ]),
      );
    });

    it('keeps a NAFDAC-only lookup as a warning', async () => {
      const result = await service.verify({ nafdacNumber: 'A4-1234' });
      expect(result.validation.status).toBe('WARNING');
      expect(result.validation.reasons[0].code).toBe('BARCODE_NOT_PROVIDED');
    });
  });
});

describe('openFDA exact identifier lookup', () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;
  const service = new OpenFdaLabelService({
    get: () => 'test-only-key',
  } as unknown as ConfigService);
  beforeEach(() => {
    global.fetch = fetchMock;
    fetchMock.mockReset();
  });
  afterAll(() => {
    global.fetch = originalFetch;
  });
  const response = (body: unknown, status = 200) => ({
    ok: status === 200,
    status,
    json: () => Promise.resolve(body),
  });

  it('uses exact GTIN and strips the key from returned provenance', async () => {
    fetchMock.mockResolvedValue(
      response({
        meta: { results: { total: 1 } },
        results: [{ id: 'a', openfda: { upc: [gtin] } }],
      }),
    );
    const result = await service.lookup(gtin);
    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.searchParams.get('search')).toBe(`openfda.upc:"${gtin}"`);
    expect(url.searchParams.get('api_key')).toBe('test-only-key');
    expect(JSON.stringify(result)).not.toContain('test-only-key');
    expect(result.status).toBe('FOUND');
  });
  it('distinguishes documented absence from upstream failure', async () => {
    fetchMock.mockResolvedValueOnce(
      response({ error: { code: 'NOT_FOUND' } }, 404),
    );
    expect((await service.lookup(gtin)).status).toBe('NOT_FOUND');
    fetchMock.mockResolvedValueOnce(response({}, 429));
    expect((await service.lookup(gtin)).status).toBe('UNAVAILABLE');
    fetchMock.mockRejectedValueOnce(new Error('network or timeout'));
    expect((await service.lookup(gtin)).status).toBe('UNAVAILABLE');
  });
  it('rejects mismatched, malformed and multiple records', async () => {
    for (const body of [
      {
        meta: { results: { total: 1 } },
        results: [{ id: 'a', openfda: { upc: ['other'] } }],
      },
      { results: [] },
    ]) {
      fetchMock.mockResolvedValueOnce(response(body));
      expect((await service.lookup(gtin)).status).toBe('UNAVAILABLE');
    }
    fetchMock.mockResolvedValueOnce(
      response({
        meta: { results: { total: 2 } },
        results: [{ id: 'a' }, { id: 'b' }],
      }),
    );
    expect((await service.lookup(gtin)).status).toBe('AMBIGUOUS');
  });
});
