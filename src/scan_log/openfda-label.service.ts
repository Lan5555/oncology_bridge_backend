import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isRecord, stringArray } from '../helpers/json-value';

export interface OfficialDrugLabel {
  id: string;
  set_id?: string;
  effective_time?: string;
  openfda?: Record<string, string[]>;
  active_ingredient?: string[];
  storage_and_handling?: string[];
  warnings?: string[];
}

export type LabelLookup = {
  status: 'FOUND' | 'NOT_FOUND' | 'UNAVAILABLE' | 'AMBIGUOUS';
  url: string;
  label: OfficialDrugLabel | null;
};

@Injectable()
export class OpenFdaLabelService {
  constructor(private readonly config: ConfigService) {}

  async lookup(gtin: string): Promise<LabelLookup> {
    // Keep the exact GTIN. Never assume an arbitrary GTIN encodes a US NDC.
    const url = new URL('https://api.fda.gov/drug/label.json');
    url.searchParams.set('search', `openfda.upc:"${gtin}"`);
    url.searchParams.set('limit', '2');
    const sourceUrl = url.toString();
    const unavailable: LabelLookup = {
      status: 'UNAVAILABLE',
      url: sourceUrl,
      label: null,
    };
    const key = this.config.get<string>('OPENFDA_API_KEY');
    if (key) url.searchParams.set('api_key', key);
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      });
      const body: unknown = await response.json();
      if (!isRecord(body)) return unavailable;
      if (
        response.status === 404 &&
        isRecord(body.error) &&
        body.error.code === 'NOT_FOUND'
      )
        return { status: 'NOT_FOUND', url: sourceUrl, label: null };
      if (
        !response.ok ||
        !Array.isArray(body.results) ||
        !isRecord(body.meta) ||
        !isRecord(body.meta.results) ||
        typeof body.meta.results.total !== 'number'
      )
        return unavailable;
      if (body.meta.results.total > 1)
        return { status: 'AMBIGUOUS', url: sourceUrl, label: null };
      const candidates: unknown[] = body.results;
      const label = candidates[0];
      if (
        !isRecord(label) ||
        typeof label.id !== 'string' ||
        !isRecord(label.openfda) ||
        !stringArray(label.openfda.upc).includes(gtin)
      )
        return unavailable;
      return {
        status: 'FOUND',
        url: sourceUrl,
        label: {
          id: label.id,
          effective_time:
            typeof label.effective_time === 'string'
              ? label.effective_time
              : undefined,
          openfda: Object.fromEntries(
            Object.entries(label.openfda).map(([key, value]) => [
              key,
              stringArray(value),
            ]),
          ),
          active_ingredient: stringArray(label.active_ingredient),
          storage_and_handling: stringArray(label.storage_and_handling),
          warnings: stringArray(label.warnings),
        },
      };
    } catch {
      // Never log the request URL: it may contain the provider API key.
      return unavailable;
    }
  }
}
