import { BadRequestException, Injectable } from '@nestjs/common';
import { VerifyMedicineDto } from './dto/verify-medicine.dto';
import { validateGtin } from './gs1-parser';
import { verificationBarcode } from './verification-barcode';
import { OpenFdaLabelService } from './openfda-label.service';
import { NafdacRegistrationService } from './nafdac-registration.service';

@Injectable()
export class MedicineVerificationService {
  constructor(
    private readonly labels: OpenFdaLabelService,
    private readonly registrations: NafdacRegistrationService,
  ) {}

  async verify(dto: VerifyMedicineDto) {
    if (
      (dto.rawBarcode && dto.gtin) ||
      (!dto.rawBarcode && !dto.gtin && !dto.nafdacNumber?.trim())
    )
      throw new BadRequestException(
        'Supply rawBarcode, gtin, or nafdacNumber; rawBarcode and gtin cannot be combined.',
      );
    const identifiers = dto.rawBarcode
      ? verificationBarcode(dto.rawBarcode)
      : { gtin: dto.gtin ?? null, lot: null, serial: null, expiry: null };
    if (identifiers.gtin !== null && !validateGtin(identifiers.gtin))
      throw new BadRequestException('Invalid GTIN-14 check digit.');
    const [lookup, registrationLookup] = await Promise.all([
      identifiers.gtin
        ? this.labels.lookup(identifiers.gtin)
        : Promise.resolve({ status: 'NOT_REQUESTED', url: null, label: null }),
      this.registrations.lookup(dto.nafdacNumber),
    ]);
    const label = lookup.label;
    const strings = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.filter((v): v is string => typeof v === 'string')
        : [];
    const official = label
      ? {
          brandNames: strings(label.openfda?.brand_name),
          genericNames: strings(label.openfda?.generic_name),
          manufacturers: strings(label.openfda?.manufacturer_name),
          productNdcs: strings(label.openfda?.product_ndc),
          packageNdcs: strings(label.openfda?.package_ndc),
          activeIngredients: strings(label.active_ingredient),
          storageAndHandling: strings(label.storage_and_handling),
          warnings: strings(label.warnings),
        }
      : null;
    const normalize = (v: string) =>
      v.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
    const comparisons = [
      ['brandName', dto.brandName, official?.brandNames],
      ['genericName', dto.genericName, official?.genericNames],
      ['manufacturer', dto.manufacturer, official?.manufacturers],
    ].map(
      ([field, observed, expected]: [
        string,
        string | undefined,
        string[] | undefined,
      ]) => ({
        field,
        observed: observed ?? null,
        expected: expected ?? [],
        status: !observed?.trim()
          ? 'NOT_PROVIDED'
          : !expected?.length
            ? 'UNAVAILABLE'
            : expected.some((v) => normalize(v) === normalize(observed))
              ? 'MATCH'
              : 'MISMATCH',
      }),
    );
    const checkedAt = new Date().toISOString();
    const registrationComparisons =
      registrationLookup.records.length === 1 &&
      registrationLookup.status === 'FOUND'
        ? [
            [
              'productName',
              dto.productName,
              registrationLookup.records[0].productName,
            ],
            [
              'manufacturer',
              dto.manufacturer,
              registrationLookup.records[0].manufacturer,
            ],
            ['strength', dto.strength, registrationLookup.records[0].strength],
          ].map(
            ([field, observed, expected]: [
              string,
              string | undefined,
              string | null,
            ]) => ({
              field,
              observed: observed ?? null,
              expected: expected ?? null,
              status: !observed?.trim()
                ? 'NOT_PROVIDED'
                : !expected
                  ? 'UNAVAILABLE'
                  : normalize(observed) === normalize(expected)
                    ? 'MATCH'
                    : 'MISMATCH',
            }),
          )
        : [];
    const expiryStatus = !identifiers.expiry
      ? 'UNKNOWN'
      : identifiers.expiry < checkedAt.slice(0, 10)
        ? 'EXPIRED'
        : 'NOT_EXPIRED';
    // Link provider evidence directly. User-entered names cannot establish this link.
    const registration =
      registrationLookup.status === 'FOUND' &&
      registrationLookup.records.length === 1
        ? registrationLookup.records[0]
        : null;
    const crossSourceComparisons =
      registration && official
        ? [
            {
              field: 'productName',
              observed: registration.productName,
              expected: official.brandNames,
            },
            {
              field: 'manufacturer',
              observed: registration.manufacturer,
              expected: official.manufacturers,
            },
          ].map(({ field, observed, expected }) => ({
            field,
            observed,
            expected,
            status:
              !observed?.trim() || !expected.some((value) => value.trim())
                ? 'UNAVAILABLE'
                : expected.some(
                      (value) => normalize(value) === normalize(observed),
                    )
                  ? 'MATCH'
                  : 'MISMATCH',
          }))
        : [];
    const reasons: { code: string; message: string }[] = [];
    const warn = (code: string, message: string) =>
      reasons.push({ code, message });
    if (!identifiers.gtin)
      warn(
        'BARCODE_NOT_PROVIDED',
        'A scanned barcode or GTIN is required for the combined record check.',
      );
    else if (lookup.status !== 'FOUND' || !official) {
      const messages: Record<string, string> = {
        NOT_FOUND: 'No openFDA drug label matched the scanned barcode.',
        AMBIGUOUS:
          'Multiple openFDA drug labels matched the scanned barcode; the product cannot be selected reliably.',
        UNAVAILABLE: 'The openFDA lookup could not be completed.',
      };
      warn(
        `OPENFDA_${lookup.status}`,
        messages[lookup.status] ?? 'No usable openFDA label was returned.',
      );
    }
    if (!registration) {
      const messages: Record<string, string> = {
        NOT_PROVIDED:
          'Supply the NAFDAC registration number from the pack to check its Greenbook listing.',
        NOT_CONFIGURED: 'The NAFDAC Greenbook lookup is not configured.',
        NO_EXACT_MATCH:
          'No exact NAFDAC registration number was returned by the Greenbook provider.',
        AMBIGUOUS:
          'Multiple Greenbook products share this registration number; the product cannot be selected reliably.',
        UNAVAILABLE: 'The NAFDAC Greenbook lookup could not be completed.',
      };
      warn(
        `NAFDAC_${registrationLookup.status}`,
        messages[registrationLookup.status] ??
          'No single usable Greenbook registration was returned.',
      );
    }
    for (const comparison of crossSourceComparisons) {
      if (comparison.status !== 'MATCH')
        warn(
          `CROSS_SOURCE_${comparison.field === 'productName' ? 'PRODUCT' : 'MANUFACTURER'}_${comparison.status}`,
          comparison.status === 'UNAVAILABLE'
            ? `The ${comparison.field} is missing from one of the source records; the records cannot be linked.`
            : `The Greenbook ${comparison.field} does not match the barcode-linked openFDA label.`,
        );
    }
    if (registration?.status === 'Inactive')
      warn('NAFDAC_INACTIVE', 'The Greenbook registration is inactive.');
    if (
      registration?.registrationExpiresAt &&
      registration.registrationExpiresAt < checkedAt.slice(0, 10)
    )
      warn(
        'NAFDAC_REGISTRATION_EXPIRED',
        'The recorded NAFDAC registration expiry has passed.',
      );
    if (registration?.dataQualityNote)
      warn(
        'NAFDAC_DATA_QUALITY',
        'The Greenbook provider reported a data quality issue; review the registration evidence.',
      );
    for (const [source, items] of [
      ['OPENFDA', comparisons],
      ['NAFDAC', registrationComparisons],
    ] as const) {
      for (const item of items) {
        if (item.status === 'MISMATCH' || item.status === 'UNAVAILABLE')
          warn(
            `${source}_${item.field.toUpperCase()}_${item.status}`,
            `The supplied ${item.field} ${item.status === 'MISMATCH' ? 'differs from' : 'could not be compared with'} the ${source} record.`,
          );
      }
    }
    if (expiryStatus === 'EXPIRED')
      warn(
        'PACK_EXPIRED',
        'The encoded pack expiry date has passed. Do not use; consult a pharmacist.',
      );
    const validation = {
      status: reasons.length ? 'WARNING' : 'VALID',
      scope: 'PRODUCT_RECORD_CHECK',
      reason: reasons.length
        ? reasons.map((item) => item.message).join(' ')
        : 'The scanned barcode matches an openFDA label, and its product name and manufacturer match an active NAFDAC Greenbook registration.',
      reasons,
    };
    return {
      identifiers,
      checkedAt,
      validation,
      authenticity: {
        status: 'UNVERIFIED',
        provider: null,
        reason:
          'No manufacturer or serialization verification provider is connected. A product record or matching label does not authenticate this pack.',
      },
      productLookup: {
        status: lookup.status,
        source: 'OPENFDA_DRUG_LABEL',
        market: 'US',
        sourceUrl: lookup.url,
        labelId: label?.id ?? null,
        labelEffectiveTime: label?.effective_time ?? null,
        official,
      },
      comparisons,
      registrationLookup: {
        ...registrationLookup,
        barcodeLink: 'NOT_ESTABLISHED',
        recordLink:
          crossSourceComparisons.length === 2 &&
          crossSourceComparisons.every((item) => item.status === 'MATCH')
            ? 'PRODUCT_AND_MANUFACTURER_MATCH'
            : 'NOT_ESTABLISHED',
        crossSourceComparisons,
        comparisons: registrationComparisons,
      },
      expiry: {
        status: expiryStatus,
        source: 'BARCODE',
        verifiedByManufacturer: false,
      },
      recall: { status: 'NOT_CHECKED' },
      guidance:
        validation.status === 'WARNING'
          ? `${validation.reason} Ask a pharmacist or manufacturer to investigate. A missing record does not prove a counterfeit.`
          : 'Both source records match. Use the manufacturer-approved verification channel to authenticate the physical pack.',
    };
  }
}
