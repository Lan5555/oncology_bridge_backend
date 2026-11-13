import {
  BadRequestException,
  ConflictException,
  Injectable,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { StockAccessService } from '../guards/stock-access.service';
import { AuditLog } from '../audit_log/entities/audit_log.entity';
import {
  normalizeGs1Expiry,
  parseGs1,
  validateIdentifiers,
} from '../scan_log/gs1-parser';
import { DispensePackDto, UploadManifestDto } from './dto/manifest.dto';
import {
  PackAssessment,
  PackDispenseEvent,
  PharmacyManifest,
  PharmacyManifestPack,
} from './entities/pharmacy-manifest.entity';
import {
  inspectManifest,
  issue,
  manifestBadRequest,
  ManifestIssue,
} from './manifest-validation';
import type { ParsedDelivery } from './manifest-spreadsheet.service';

@Injectable()
export class PharmacyManifestService {
  constructor(
    private readonly db: DataSource,
    private readonly access: StockAccessService,
  ) {}

  async upload(dto: UploadManifestDto, actorId: string, ip: string) {
    try {
      return await this.db.transaction(async (manager) => {
        const user = await this.access.assertManage(
          actorId,
          undefined,
          undefined,
          manager,
        );
        // Serialize manifest saves at this pharmacy, then revalidate the entire
        // delivery and all conflicts within the same write transaction.
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`manifest-save:${user.hospital.id}`],
        );
        const checked = inspectManifest(dto);
        if (checked.issues.length) throw manifestBadRequest(checked.issues);
        const { packs, reference } = checked;
        const conflicts = await this.conflicts(
          manager,
          user.hospital.id,
          reference,
          packs,
        );
        if (conflicts.length) throw this.conflictError(conflicts);
        const manifest = await manager.getRepository(PharmacyManifest).save({
          facility_id: user.hospital.id,
          uploaded_by: user.id,
          reference,
        });
        await manager.getRepository(PharmacyManifestPack).insert(
          packs.map((pack) => ({
            ...pack,
            manifest_id: manifest.id,
            facility_id: user.hospital.id,
          })),
        );
        await manager.getRepository(AuditLog).save({
          user,
          action: 'PHARMACY_MANIFEST_UPLOADED',
          object_type: 'pharmacy_manifest',
          object_id: manifest.id,
          description: JSON.stringify({
            reference: manifest.reference,
            packCount: packs.length,
          }),
          ip_address: ip || 'unknown',
        });
        return { ...manifest, packCount: packs.length };
      });
    } catch (error) {
      const failure = error as {
        code?: string;
        driverError?: { code?: string };
      };
      if ((failure.driverError?.code ?? failure.code) === '23505') {
        // A legacy writer may not use the advisory lock. Re-read after the
        // failed transaction rolls back; never return SQL or constraint text.
        const user = await this.access.assertManage(actorId);
        const checked = inspectManifest(dto);
        const issues = await this.conflicts(
          this.db.manager,
          user.hospital.id,
          checked.reference,
          checked.packs,
        );
        throw this.conflictError(
          issues.length
            ? issues
            : [
                issue(
                  0,
                  'packs',
                  'PACK_ALREADY_IMPORTED',
                  'This delivery conflicts with a saved delivery. Refresh saved deliveries before trying again.',
                ),
              ],
        );
      }
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'The delivery could not be saved. Check saved deliveries by reference before retrying.',
      );
    }
  }

  private conflictError(issues: ManifestIssue[]) {
    return new ConflictException({
      message:
        'This reference or a pack is already uploaded at your pharmacy. Review the delivery list.',
      data: { issues },
    });
  }

  private async conflicts(
    manager: EntityManager,
    facilityId: string,
    reference: string,
    packs: UploadManifestDto['packs'],
    rowNumbers?: number[],
  ) {
    const issues: ManifestIssue[] = [];
    if (
      await manager
        .getRepository(PharmacyManifest)
        .existsBy({ facility_id: facilityId, reference })
    )
      issues.push(
        issue(
          0,
          'reference',
          'REFERENCE_ALREADY_EXISTS',
          'A delivery with this reference is already saved at your pharmacy. Check saved deliveries before trying again.',
        ),
      );
    const identities = [
      ...new Map(
        packs
          .filter((pack) => pack.gtin && pack.serial)
          .map((pack) => [
            `${pack.gtin}:${pack.serial}`,
            { facility_id: facilityId, gtin: pack.gtin, serial: pack.serial },
          ]),
      ).values(),
    ];
    const existing = identities.length
      ? await manager
          .getRepository(PharmacyManifestPack)
          .find({ where: identities, select: { gtin: true, serial: true } })
      : [];
    const keys = new Set(existing.map((pack) => `${pack.gtin}:${pack.serial}`));
    packs.forEach((pack, index) => {
      if (keys.has(`${pack.gtin}:${pack.serial}`))
        issues.push(
          issue(
            rowNumbers?.[index] ?? index + 1,
            'serial',
            'PACK_ALREADY_IMPORTED',
            'This GTIN and serial pair is already saved at your pharmacy. Check the saved delivery.',
          ),
        );
    });
    return issues;
  }

  async preview(parsed: ParsedDelivery, reference: string, actorId: string) {
    const user = await this.access.assertManage(actorId);
    const reviewed = inspectManifest(
      { reference, packs: parsed.packs },
      parsed.rowNumbers,
    );
    const conflicts = await this.conflicts(
      this.db.manager,
      user.hospital.id,
      reviewed.reference,
      reviewed.packs,
      parsed.rowNumbers,
    );
    const issues = [...parsed.issues, ...reviewed.issues, ...conflicts];
    const badRows = new Set(
      issues
        .filter((entry) => parsed.rowNumbers.includes(entry.row))
        .map((entry) => entry.row),
    );
    const columnError = issues.some((entry) =>
      entry.code.startsWith('COLUMN_'),
    );
    return {
      reference,
      canImport: issues.length === 0,
      totalRows: parsed.totalRows,
      validRows: columnError ? 0 : parsed.packs.length - badRows.size,
      packs: issues.length ? [] : reviewed.packs,
      issues,
    };
  }

  async assertImportAccess(actorId: string) {
    await this.access.assertManage(actorId);
  }

  async list(actorId: string, reference?: string) {
    const user = await this.access.assertManage(actorId);
    if (
      reference !== undefined &&
      (!reference.trim() || reference.length > 120)
    )
      throw manifestBadRequest([
        issue(
          0,
          'reference',
          'INVALID_REFERENCE',
          'Enter a delivery reference of 1 to 120 characters.',
        ),
      ]);
    return this.db.getRepository(PharmacyManifest).find({
      where: {
        facility_id: user.hospital.id,
        ...(reference === undefined ? {} : { reference: reference.trim() }),
      },
      order: { created_at: 'DESC' },
      take: 100,
    });
  }

  async findOne(id: string, actorId: string) {
    const user = await this.access.assertManage(actorId);
    const manifest = await this.db
      .getRepository(PharmacyManifest)
      .findOneBy({ id, facility_id: user.hospital.id });
    if (!manifest)
      throw new NotFoundException('Manifest not found at your facility.');
    const packs = await this.db
      .getRepository(PharmacyManifestPack)
      .findBy({ manifest_id: id, facility_id: user.hospital.id });
    return { ...manifest, packs };
  }

  private identifiers(raw: string) {
    const ids = parseGs1(raw);
    const validation = validateIdentifiers(ids);
    if (!validation.valid) throw new BadRequestException(validation.messages);
    return {
      gtin: ids.gtin!,
      serial: ids.serial!,
      lot: ids.lot!,
      expiry: normalizeGs1Expiry(ids.expiry)!,
    };
  }

  private async assess(
    manager: EntityManager,
    facilityId: string,
    identifiers: PackAssessment['identifiers'],
  ): Promise<PackAssessment> {
    const { gtin, serial, expiry } = identifiers;
    const pack = await manager
      .getRepository(PharmacyManifestPack)
      .findOneBy({ facility_id: facilityId, gtin, serial });
    const mismatches = pack
      ? ['lot', 'expiry'].filter((key) => pack[key] !== identifiers[key])
      : [];
    const duplicate = await manager
      .getRepository(PackDispenseEvent)
      .existsBy({ gtin, serial, accepted: true });
    const reasons: string[] = [];
    if (!pack) reasons.push('PACK_NOT_IN_MANIFEST');
    if (mismatches.length) reasons.push('MANIFEST_MISMATCH');
    if (expiry < new Date().toISOString().slice(0, 10))
      reasons.push('PACK_EXPIRED');
    if (duplicate) reasons.push('SERIAL_ALREADY_DISPENSED');
    return {
      identifiers,
      manifestId: pack?.manifest_id ?? null,
      manifestMatch: !pack
        ? 'NOT_FOUND'
        : mismatches.length
          ? 'MISMATCH'
          : 'MATCH',
      mismatches,
      duplicate,
      suspectedCounterfeit: duplicate,
      canDispense: reasons.length === 0,
      reasons,
      authenticity: 'UNVERIFIED',
    };
  }

  async check(raw: string, actorId: string) {
    const user = await this.access.assertManage(actorId);
    return this.assess(
      this.db.manager,
      user.hospital.id,
      this.identifiers(raw),
    );
  }

  async dispense(dto: DispensePackDto, actorId: string, ip: string) {
    const identifiers = this.identifiers(dto.rawBarcode);
    const clientUuid = dto.clientUuid.toLowerCase();
    return this.db.transaction(async (manager) => {
      const user = await this.access.assertManage(
        actorId,
        undefined,
        undefined,
        manager,
      );
      const facilityId = user.hospital.id;
      // Lock requests before pack identities. Both locks last until commit/rollback.
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`dispense-request:${facilityId}:${clientUuid}`],
      );
      const events = manager.getRepository(PackDispenseEvent);
      const existing = await events.findOneBy({
        facility_id: facilityId,
        client_uuid: clientUuid,
      });
      if (existing) {
        if (
          existing.actor_id !== user.id ||
          ['gtin', 'serial', 'lot', 'expiry'].some(
            (key) => existing[key] !== identifiers[key],
          )
        )
          throw new ConflictException(
            'clientUuid was already used for a different dispensing request.',
          );
        return { id: existing.id, ...existing.assessment, replay: true };
      }
      // Global identity lock prevents two facilities accepting the same serial concurrently.
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`dispense-pack:${identifiers.gtin}:${identifiers.serial}`],
      );
      const assessment = await this.assess(manager, facilityId, identifiers);
      const event = await events.save({
        facility_id: facilityId,
        actor_id: user.id,
        client_uuid: clientUuid,
        ...identifiers,
        accepted: assessment.canDispense,
        assessment,
      });
      await manager.getRepository(AuditLog).save({
        user,
        action: assessment.canDispense
          ? 'PACK_DISPENSE_ACCEPTED'
          : 'PACK_DISPENSE_BLOCKED',
        object_type: 'pack_dispense',
        object_id: event.id,
        description: JSON.stringify({
          gtin: identifiers.gtin,
          serial: identifiers.serial,
          reasons: assessment.reasons,
        }),
        ip_address: ip || 'unknown',
      });
      return { id: event.id, ...assessment, replay: false };
    });
  }
}
