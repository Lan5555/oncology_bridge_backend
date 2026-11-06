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
          ].map(([field, observed, expected]) => ({
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
          }))
        : [];
    const expiryStatus = !identifiers.expiry
      ? 'UNKNOWN'
      : identifiers.expiry < checkedAt.slice(0, 10)
        ? 'EXPIRED'
        : 'NOT_EXPIRED';
    return {
      identifiers,
      checkedAt,
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
        comparisons: registrationComparisons,
      },
      expiry: {
        status: expiryStatus,
        source: 'BARCODE',
        verifiedByManufacturer: false,
      },
      recall: { status: 'NOT_CHECKED' },
      guidance:
        expiryStatus === 'EXPIRED'
          ? 'The encoded expiry date has passed. Do not use; consult a pharmacist.'
          : registrationLookup.records.some(
                (r) =>
                  r.status === 'Inactive' ||
                  (r.registrationExpiresAt !== null &&
                    r.registrationExpiresAt < checkedAt.slice(0, 10)),
              )
            ? 'The returned registration is inactive or its recorded registration expiry has passed. Ask a pharmacist to confirm the current regulatory status.'
            : [...comparisons, ...registrationComparisons].some(
                  (c) => c.status === 'MISMATCH',
                )
              ? 'Packaging details differ from the retrieved record. Ask a pharmacist or manufacturer to investigate.'
              : 'Compare the official details with the pack and use its manufacturer-approved verification channel. A missing record does not prove a counterfeit.',
    };
  }
}
