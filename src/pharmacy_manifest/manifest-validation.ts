import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { normalizeGs1Expiry, validateGtin } from '../scan_log/gs1-parser';
import { ManifestPackDto, UploadManifestDto } from './dto/manifest.dto';

export interface ManifestIssue {
  row: number;
  field: string;
  code: string;
  message: string;
}
export const issue = (
  row: number,
  field: string,
  code: string,
  message: string,
): ManifestIssue => ({
  row,
  field,
  code,
  message: `${row ? `Row ${row}: ` : ''}${message}`,
});
export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function inspectManifest(input: unknown, rowNumbers?: number[]) {
  const body = record(input),
    issues: ManifestIssue[] = [];
  const reference = typeof body.reference === 'string' ? body.reference : '';
  if (!reference.trim() || reference.length > 120)
    issues.push(
      issue(
        0,
        'reference',
        'INVALID_REFERENCE',
        'Enter a delivery reference of 1 to 120 characters.',
      ),
    );
  for (const key of Object.keys(body))
    if (!['reference', 'packs'].includes(key))
      issues.push(
        issue(
          0,
          key,
          'FIELD_UNEXPECTED',
          'Remove unexpected delivery fields; your pharmacy is selected from your account.',
        ),
      );
  const rows = Array.isArray(body.packs) ? body.packs : [];
  if (!rows.length)
    issues.push(
      issue(
        0,
        'packs',
        'PACKS_REQUIRED',
        'Enter at least one individual pack or vial.',
      ),
    );
  if (rows.length > 1000)
    issues.push(
      issue(
        0,
        'packs',
        'ROW_LIMIT_EXCEEDED',
        'Use no more than 1,000 pack rows per delivery.',
      ),
    );
  const packs: ManifestPackDto[] = [];
  const identities = new Map<string, number[]>();
  rows.slice(0, 1000).forEach((value, index) => {
    const pack = record(value),
      row = rowNumbers?.[index] ?? index + 1;
    for (const key of Object.keys(pack))
      if (!['gtin', 'lot', 'serial', 'expiry'].includes(key))
        issues.push(
          issue(
            row,
            key,
            'FIELD_UNEXPECTED',
            'Remove unexpected pack fields. Enter one serial number per pack.',
          ),
        );
    const gtin = typeof pack.gtin === 'string' ? pack.gtin : '';
    if (!validateGtin(gtin))
      issues.push(
        issue(
          row,
          'gtin',
          'INVALID_GTIN',
          'Enter the complete 14-digit barcode as text, including leading zeros, with a valid check digit.',
        ),
      );
    for (const field of ['lot', 'serial'] as const) {
      const content = pack[field];
      if (typeof content !== 'string' || !/^[!-~]{1,20}$/.test(content))
        issues.push(
          issue(
            row,
            field,
            field === 'lot' ? 'BATCH_REQUIRED' : 'SERIAL_REQUIRED',
            field === 'lot'
              ? 'Enter the batch number printed on this pack (1 to 20 printable characters without spaces).'
              : 'Enter the serial number printed on this pack (1 to 20 printable characters without spaces).',
          ),
        );
    }
    let expiry =
      typeof pack.expiry === 'string' ? normalizeGs1Expiry(pack.expiry) : null;
    if (expiry?.startsWith('0000-')) expiry = null;
    if (!expiry)
      issues.push(
        issue(
          row,
          'expiry',
          'INVALID_EXPIRY',
          'Enter a valid expiry date as YYYY-MM-DD.',
        ),
      );
    const normalized = {
      gtin,
      lot: typeof pack.lot === 'string' ? pack.lot : '',
      serial: typeof pack.serial === 'string' ? pack.serial : '',
      expiry: expiry ?? '',
    };
    packs.push(normalized);
    if (gtin && normalized.serial) {
      const key = `${gtin}:${normalized.serial}`;
      identities.set(key, [...(identities.get(key) ?? []), row]);
    }
  });
  for (const duplicates of identities.values())
    if (duplicates.length > 1)
      for (const row of duplicates)
        issues.push(
          issue(
            row,
            'serial',
            'DUPLICATE_PACK_IN_FILE',
            'This GTIN and serial pair is duplicated in this delivery. Keep one row per individual pack.',
          ),
        );
  return { reference: reference.trim(), packs, issues };
}

export function manifestBadRequest(issues: ManifestIssue[]) {
  return new BadRequestException({
    message: issues[0]?.message ?? 'Review the delivery list.',
    data: { issues },
  });
}

@Injectable()
export class ManifestBodyPipe implements PipeTransform<
  unknown,
  UploadManifestDto
> {
  transform(value: unknown) {
    const result = inspectManifest(value);
    if (result.issues.length) throw manifestBadRequest(result.issues);
    return { reference: result.reference, packs: result.packs };
  }
}
