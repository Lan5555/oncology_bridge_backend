import { Injectable } from '@nestjs/common';
import { AdminIntegrationsService } from '../admin/admin-integrations.service';

export type LicenseLookupResult =
  'MATCH' | 'NO_MATCH' | 'UNAVAILABLE' | 'INCONCLUSIVE';
export interface LicenseLookupInput {
  licenseNumber: string;
  professionalType: string;
  registry: string;
  lastName: string;
}
export interface LicenseLookupOutcome {
  result: LicenseLookupResult;
  evidence: string;
}
class RegistryPayloadError extends Error {}
const normal = (value: string) => value.trim().normalize('NFKC').toUpperCase();
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

@Injectable()
export class LicenseRegistryService {
  constructor(private readonly integrations: AdminIntegrationsService) {}
  async lookup(input: LicenseLookupInput): Promise<LicenseLookupOutcome> {
    let config: { url: string; apiKey: string } | null;
    try {
      config = await this.integrations.licenseRegistryConnection();
    } catch {
      return {
        result: 'UNAVAILABLE',
        evidence:
          'The registry connection or secret configuration is unavailable. Retry the lookup or review the licence manually.',
      };
    }
    if (!config)
      return {
        result: 'UNAVAILABLE',
        evidence:
          'Server-side registry lookup is not configured. Manual licence review is required.',
      };
    try {
      const response = await fetch(config.url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          licenseNumber: input.licenseNumber,
          professionalType: input.professionalType,
          registry: input.registry,
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return {
          result: 'UNAVAILABLE',
          evidence:
            'The registry did not complete the lookup successfully. Retry the lookup or review the licence manually.',
        };
      }
      let payload: unknown;
      try {
        payload = await this.readResponse(response);
      } catch (error) {
        if (!(error instanceof RegistryPayloadError)) throw error;
        return {
          result: 'INCONCLUSIVE',
          evidence:
            'The registry response could not be interpreted as a bounded JSON lookup result. Manual review is required.',
        };
      }
      return this.interpret(input, payload);
    } catch {
      return {
        result: 'UNAVAILABLE',
        evidence:
          'The registry could not be reached or the lookup timed out. Retry the lookup or review the licence manually.',
      };
    }
  }

  private async readResponse(response: Response): Promise<unknown> {
    if (
      !response.headers
        .get('content-type')
        ?.toLowerCase()
        .includes('application/json') ||
      !response.body
    )
      throw new RegistryPayloadError('Invalid registry response');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > 65536)
          throw new RegistryPayloadError('Registry response too large');
        chunks.push(chunk.value);
      }
      try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      } catch {
        throw new RegistryPayloadError('Invalid registry JSON');
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  }

  private interpret(
    input: LicenseLookupInput,
    payload: unknown,
  ): LicenseLookupOutcome {
    const inconclusive: LicenseLookupOutcome = {
      result: 'INCONCLUSIVE',
      evidence:
        'The registry response did not establish a definite licence and professional identity match. Manual review is required.',
    };
    const data = object(payload),
      query = object(data?.query);
    // A response must be tied to this exact search before it can be treated as evidence.
    for (const key of [
      'licenseNumber',
      'professionalType',
      'registry',
    ] as const)
      if (
        typeof query?.[key] !== 'string' ||
        normal(query[key]) !== normal(input[key])
      )
        return inconclusive;
    if (data?.ambiguous === true) return inconclusive;
    if (data?.found === false)
      return {
        result: 'NO_MATCH',
        evidence:
          'The registry completed the requested search and reported no licence record. Review the applicant licence details manually.',
      };
    const record = object(data?.record);
    if (data?.found !== true || !record || data.ambiguous === true)
      return inconclusive;
    for (const key of [
      'licenseNumber',
      'professionalType',
      'registry',
      'lastName',
      'status',
    ])
      if (typeof record[key] !== 'string' || !record[key].trim())
        return inconclusive;
    if (!input.lastName.trim()) return inconclusive;
    const status = normal(record.status as string);
    if (
      !['ACTIVE', 'INACTIVE', 'EXPIRED', 'SUSPENDED', 'REVOKED'].includes(
        status,
      )
    )
      return inconclusive;
    const matches = (
      ['licenseNumber', 'professionalType', 'registry', 'lastName'] as const
    ).every((key) => normal(record[key] as string) === normal(input[key]));
    if (matches && status === 'ACTIVE')
      return {
        result: 'MATCH',
        evidence:
          'The registry returned an active licence with matching licence number, registry, professional type and applicant surname. Central approval is still required.',
      };
    return {
      result: 'NO_MATCH',
      evidence:
        'The registry returned a record with conflicting licence or professional identity details, or a licence that is not active. Manual review is required.',
    };
  }
}
