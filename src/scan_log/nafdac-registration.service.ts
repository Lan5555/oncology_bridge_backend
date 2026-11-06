import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isRecord, stringArray } from '../helpers/json-value';

export interface RegistrationRecord {
  productId: number;
  registrationNumber: string;
  productName: string;
  status: 'Active' | 'Inactive';
  applicant: string | null;
  manufacturer: string | null;
  activeIngredients: string[];
  strength: string | null;
  dosageForm: string | null;
  packSize: string | null;
  approvedAt: string | null;
  registrationExpiresAt: string | null;
  fetchedAt: string;
  sourceUrl: string;
  dataQualityNote: string | null;
}

export interface RegistrationLookup {
  status:
    | 'NOT_PROVIDED'
    | 'NOT_CONFIGURED'
    | 'FOUND'
    | 'NO_EXACT_MATCH'
    | 'AMBIGUOUS'
    | 'UNAVAILABLE';
  reason: string | null;
  source: 'NAFDAC_GREENBOOK_VIA_APIFY';
  officialApi: false;
  market: 'NG';
  registrationNumber: string | null;
  retrievedAt: string | null;
  completeness: 'NOT_GUARANTEED';
  records: RegistrationRecord[];
}

export const normalizeNafdacNumber = (value: string) =>
  value.trim().toUpperCase();

@Injectable()
export class NafdacRegistrationService {
  private readonly cache = new Map<
    string,
    { until: number; result: RegistrationLookup }
  >();
  private readonly pending = new Map<string, Promise<RegistrationLookup>>();
  constructor(private readonly config: ConfigService) {}

  async lookup(number?: string): Promise<RegistrationLookup> {
    const registrationNumber = number ? normalizeNafdacNumber(number) : null;
    const base: RegistrationLookup = {
      status: 'NOT_PROVIDED',
      reason: null,
      source: 'NAFDAC_GREENBOOK_VIA_APIFY',
      officialApi: false,
      market: 'NG',
      registrationNumber,
      retrievedAt: null,
      completeness: 'NOT_GUARANTEED',
      records: [],
    };
    if (!registrationNumber) return base;
    const token = this.config.get<string>('APIFY_API_TOKEN');
    if (!token || this.config.get<string>('APIFY_NAFDAC_ENABLED') !== 'true')
      return {
        ...base,
        status: 'NOT_CONFIGURED',
        reason: 'Nigerian registration lookup is not enabled or configured.',
      };
    const cached = this.cache.get(registrationNumber);
    if (cached && cached.until > Date.now()) return cached.result;
    const pending = this.pending.get(registrationNumber);
    if (pending) return pending;
    // Bound paid actor concurrency per process; no retries that could start duplicate runs.
    if (this.pending.size >= 2)
      return {
        ...base,
        status: 'UNAVAILABLE',
        reason: 'Registration provider is busy. Try again later.',
      };
    const operation = this.fetchRecords(base, token);
    this.pending.set(registrationNumber, operation);
    try {
      const result = await operation;
      for (const [key, item] of this.cache)
        if (item.until <= Date.now()) this.cache.delete(key);
      if (this.cache.size >= 1000) {
        const oldest: unknown = this.cache.keys().next().value;
        if (typeof oldest === 'string') this.cache.delete(oldest);
      }
      this.cache.set(registrationNumber, {
        result,
        until: Math.min(
          Date.now() + (result.status === 'UNAVAILABLE' ? 30_000 : 300_000),
          ...result.records.map(
            (record) => Date.parse(record.fetchedAt) + 86_400_000,
          ),
        ),
      });
      return result;
    } finally {
      this.pending.delete(registrationNumber);
    }
  }

  private async fetchRecords(
    base: RegistrationLookup,
    token: string,
  ): Promise<RegistrationLookup> {
    const unavailable = (reason: string): RegistrationLookup => ({
      ...base,
      status: 'UNAVAILABLE',
      reason,
    });
    try {
      const response = await fetch(
        'https://api.apify.com/v2/acts/a-g-d~ng-nafdac/run-sync-get-dataset-items?timeout=90&format=json&clean=true',
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(95_000),
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            registrationNumber: base.registrationNumber,
            maxItems: 100,
            includeManufacturer: true,
            includeManufacturerCountry: false,
          }),
        },
      );
      if (!response.ok)
        return unavailable('Registration provider request failed.');
      const rows: unknown = await response.json();
      if (!Array.isArray(rows) || rows.length >= 100)
        return unavailable(
          'Registration provider returned invalid or potentially truncated results.',
        );
      const records: RegistrationRecord[] = [];
      const entries: unknown[] = rows;
      for (const row of entries) {
        if (!isRecord(row) || typeof row.registrationNumber !== 'string')
          return unavailable(
            'Registration provider returned malformed records.',
          );
        // The actor performs contains searches. Never promote a partial NRN match.
        if (
          normalizeNafdacNumber(row.registrationNumber) !==
          base.registrationNumber
        )
          continue;
        const fetched =
          typeof row.fetchedAt === 'string' ? Date.parse(row.fetchedAt) : NaN;
        if (
          typeof row.productId !== 'number' ||
          !Number.isSafeInteger(row.productId) ||
          row.productId < 1 ||
          typeof row.productName !== 'string' ||
          !row.productName.trim() ||
          (row.status !== 'Active' && row.status !== 'Inactive') ||
          !Number.isFinite(fetched) ||
          fetched > Date.now() + 300_000 ||
          Date.now() - fetched > 86_400_000
        )
          return unavailable(
            'Registration evidence is malformed or older than 24 hours.',
          );
        const str = (value: unknown) =>
          typeof value === 'string' && value.trim() ? value.trim() : null;
        const date = (value: unknown) => {
          const text = str(value);
          if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
          const parsed = new Date(`${text}T00:00:00Z`);
          return Number.isFinite(parsed.getTime()) &&
            parsed.toISOString().slice(0, 10) === text
            ? text
            : null;
        };
        records.push({
          productId: row.productId,
          registrationNumber: normalizeNafdacNumber(row.registrationNumber),
          productName: row.productName.trim(),
          status: row.status,
          applicant: str(isRecord(row.applicant) ? row.applicant.name : null),
          manufacturer: str(
            isRecord(row.manufacturer) ? row.manufacturer.name : null,
          ),
          activeIngredients: stringArray(row.activeIngredients),
          strength: str(row.strength),
          dosageForm: str(row.dosageForm),
          packSize: str(row.packSize),
          approvedAt: date(row.approvedAt),
          registrationExpiresAt: date(row.expiresAt),
          fetchedAt: new Date(fetched).toISOString(),
          sourceUrl: `https://greenbook.nafdac.gov.ng/products/details/${row.productId}`,
          dataQualityNote: str(row.dataQualityNote),
        });
      }
      // Conflicting duplicate records must not disappear through arbitrary selection.
      const ids = new Set(records.map((row) => row.productId));
      if (ids.size !== records.length)
        return unavailable(
          'Registration provider returned duplicate product records.',
        );
      return {
        ...base,
        status:
          records.length > 1
            ? 'AMBIGUOUS'
            : records.length === 1
              ? 'FOUND'
              : 'NO_EXACT_MATCH',
        records,
        retrievedAt: new Date().toISOString(),
        reason: records.length
          ? null
          : 'No exact registration number was returned. This does not establish that the product is unregistered or counterfeit.',
      };
    } catch {
      // No provider bodies, headers, credentials or raw network errors enter logs/responses.
      return unavailable(
        'Registration lookup could not complete. An upstream run may still be finishing.',
      );
    }
  }
}
