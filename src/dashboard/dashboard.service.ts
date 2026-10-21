import { activeInventory } from '../inventory/active-inventory';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Hospital } from '../hospital/entities/hospital.entity';
import { Inventory } from '../inventory/entities/inventory.entity';
import { ScanLog } from '../scan_log/entities/scan_log.entity';
import { TransferRequest } from '../transfer_requests/entities/transfer_request.entity';
import { ResponseHelper } from '../helpers/response-helper';
import { DashboardScope } from '../guards/dashboard-read.guard';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Hospital)
    private readonly hospitals: Repository<Hospital>,
    @InjectRepository(Inventory)
    private readonly inventory: Repository<Inventory>,
    @InjectRepository(ScanLog) private readonly scans: Repository<ScanLog>,
    @InjectRepository(TransferRequest)
    private readonly transfers: Repository<TransferRequest>,
  ) {}
  // Read a fresh consistent snapshot on every request; never cache across sessions.
  private async snapshot(scope: DashboardScope) {
    if (!scope || (scope.type === 'facility' && !scope.facilityId))
      throw new ForbiddenException('Dashboard scope is required');
    const facilityId = scope.type === 'facility' ? scope.facilityId : null;
    return this.inventory.manager.transaction(
      'REPEATABLE READ',
      async (manager) => {
        const [{ asOf }] = await manager.query(
          'SELECT CURRENT_TIMESTAMP AS "asOf"',
        );
        const facilities = await manager.query(
          `
        SELECT id FROM hospitals WHERE status='ACTIVE' AND deleted_at IS NULL
        AND ($1::uuid IS NULL OR id=$1)`,
          [facilityId],
        );
        const items = await manager.query(
          `
        SELECT i.*, m.generic_name AS drug,
          (UPPER(i.status) IN ('AVAILABLE','NEAR_EXPIRY') AND i.quantity>0
            AND i.expiry_date>=CURRENT_DATE) AS available,
          LEAST(GREATEST(i.quantity,0), (
            SELECT COUNT(DISTINCT (s.gtin,s.serial_number)) FROM scan_logs s
            WHERE s.inventory_id=i.id AND s.result='CLEAN' AND s.client_uuid IS NOT NULL
              AND s.action IN ('NEW','AVAILABLE','NEAR_EXPIRY')
              AND s.gtin=m.gtin AND s.batch_number=i.batch_number
              AND s.expiry_date::date=i.expiry_date::date
          )) AS authenticated_serials
        FROM inventory i JOIN medicines m ON m.id=i.medicine_id AND m.deleted_at IS NULL
        JOIN hospitals h ON h.id=i.hospital_id AND h.status='ACTIVE' AND h.deleted_at IS NULL
        WHERE UPPER(i.status)<>'DISPOSED' AND ($1::uuid IS NULL OR i.hospital_id=$1)
        ORDER BY i.created_at,i.id`,
          [facilityId],
        );
        const transfers = await manager.query(
          `
        SELECT t.id,t.status,t.quantity,t.created_at,i.selling_unit AS unit
        FROM transfer_requests t LEFT JOIN inventory i ON i.id=t.inventory_id
        WHERE ($1::uuid IS NULL OR t.from_hospital=$1 OR t.to_hospital=$1)
        ORDER BY t.created_at,t.id`,
          [facilityId],
        );
        const units = await manager.query(
          `
        SELECT u.id, (u.last_seen_at IS NOT NULL
          AND u.last_seen_at >= CURRENT_TIMESTAMP - make_interval(secs => u.offline_after_seconds)
          AND u.operational_state='ONLINE'
          AND NOT EXISTS (SELECT 1 FROM cold_chain_events e WHERE e.unit_id=u.id AND e.state='OPEN')) AS healthy
        FROM storage_units u JOIN hospitals h ON h.id=u.facility_id
        WHERE h.status='ACTIVE' AND h.deleted_at IS NULL
          AND ($1::uuid IS NULL OR u.facility_id=$1)`,
          [facilityId],
        );
        return { asOf, facilities, items, transfers, units };
      },
    );
  }

  async summary(scope: DashboardScope) {
    const { asOf, facilities, items, transfers, units } =
      await this.snapshot(scope);
    const available = items.filter((i) => i.available);
    const vialItems = available.filter((i) => i.selling_unit === 'vial');
    const medicines = new Set(items.map((i) => i.medicine_id));
    const stocked = new Set(available.map((i) => i.medicine_id));
    const quantitiesByUnit: Record<string, number> = {};
    for (const i of available) {
      const unit = i.selling_unit || 'unknown';
      quantitiesByUnit[unit] =
        (quantitiesByUnit[unit] ?? 0) + Number(i.quantity);
    }
    const now = new Date(asOf).getTime();
    return ResponseHelper.Success('Dashboard summary retrieved', {
      asOf,
      scope,
      network: { name: 'Oncosourz', region: 'Lagos-Ibadan' },
      nodes: facilities.length,
      gs1AuthenticatedVials: vialItems.reduce(
        (n, i) => n + Number(i.authenticated_serials),
        0,
      ),
      totalVials: vialItems.reduce((n, i) => n + Number(i.quantity), 0),
      quantitiesByUnit,
      stockOutRiskPct: medicines.size
        ? Math.round((100 * (medicines.size - stocked.size)) / medicines.size)
        : 0,
      chainIntegrityPct: units.length
        ? Math.round(
            (100 * units.filter((u) => u.healthy).length) / units.length,
          )
        : 0,
      monitoredStorageUnits: units.length,
      nearExpiry: available.filter(
        (i) => new Date(i.expiry_date).getTime() <= now + 60 * 86400000,
      ).length,
      pendingTransfers: transfers.filter((t) =>
        ['PENDING', 'PENDING_APPROVAL'].includes(t.status),
      ).length,
      velocityPct: null,
      stockOutDeltaPct: null,
      valueRecoveredNaira: null,
    });
  }

  async charts(scope: DashboardScope) {
    const { asOf, items, transfers } = await this.snapshot(scope);
    const stock = new Map<
      string,
      { drug: string; unit: string; qty: number }
    >();
    const months = new Map<
      string,
      { label: string; vials: number; quantitiesByUnit: Record<string, number> }
    >();
    const totals: Record<string, number> = {};
    for (const i of items.filter((item) => item.available)) {
      const unit = i.selling_unit || 'unknown';
      const key = JSON.stringify([i.medicine_id, unit]);
      const row = stock.get(key) ?? { drug: i.drug, unit, qty: 0 };
      row.qty += Number(i.quantity);
      stock.set(key, row);
      totals[unit] = (totals[unit] ?? 0) + Number(i.quantity);
      const label = new Date(i.created_at).toISOString().slice(0, 7);
      const month = months.get(label) ?? {
        label,
        vials: 0,
        quantitiesByUnit: {},
      };
      month.quantitiesByUnit[unit] =
        (month.quantitiesByUnit[unit] ?? 0) + Number(i.quantity);
      if (unit === 'vial') month.vials += Number(i.quantity);
      months.set(label, month);
    }
    return ResponseHelper.Success('Dashboard charts retrieved', {
      asOf,
      scope,
      inventoryOverTimeBasis: 'current_available_stock_by_intake_month',
      inventoryOverTime: [...months.values()].sort((a, b) =>
        a.label.localeCompare(b.label),
      ),
      drugSplit: [...stock.values()].map(({ drug, unit, qty }) => ({
        drug,
        unit,
        pct: Math.round((qty * 100) / totals[unit]),
      })),
      therapeuticStock: [...stock.values()],
      redistributionEfficiency: transfers
        .filter((t) => t.status === 'DELIVERED')
        .map((t) => ({
          id: t.id,
          label: t.created_at,
          quantity: Number(t.quantity),
          unit: t.unit || 'unknown',
          days: null,
        })),
      redistributionTimingAvailable: false,
    });
  }

  async publicStats() {
    const { data } = await this.summary({ type: 'network' });
    const deliveries = await this.transfers.count({
      where: { status: 'DELIVERED' },
    });
    return ResponseHelper.Success('Public network statistics retrieved', {
      asOf: data!.asOf,
      facilities: data!.nodes,
      authenticatedVials: data!.gs1AuthenticatedVials,
      totalInventoryVials: data!.totalVials,
      completedRedistributions: deliveries,
    });
  }
  async exportReport(body: any) {
    const type = String(body.type ?? 'CSV').toUpperCase();
    if (!['CSV', 'PDF', 'XLSX'].includes(type))
      throw new BadRequestException('type must be CSV, PDF, or XLSX');
    if (type !== 'CSV')
      return ResponseHelper.Success(
        'Report job queued; PDF/XLSX worker is not configured',
        { jobId: randomUUID(), status: 'QUEUED', type, demo: true },
      );
    const qb = this.inventory
      .createQueryBuilder('i')
      .andWhere(activeInventory())
      .leftJoinAndSelect('i.medicine', 'medicine')
      .leftJoinAndSelect('i.hospital', 'hospital')
      .orderBy('i.expiry_date', 'ASC');
    if (body.from) {
      const from = new Date(body.from);
      if (Number.isNaN(from.getTime()))
        throw new BadRequestException('Invalid from date');
      qb.andWhere('i.created_at >= :from', { from });
    }
    if (body.to) {
      const to = new Date(body.to);
      if (Number.isNaN(to.getTime()))
        throw new BadRequestException('Invalid to date');
      qb.andWhere('i.created_at <= :to', { to });
    }
    const rows = await qb.getMany();
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [
      'id,drug,gtin,lot,facility,quantity,expiry,status',
      ...rows.map((i) =>
        [
          i.id,
          i.medicine.generic_name,
          i.medicine.gtin,
          i.batch_number,
          i.hospital.name,
          i.quantity,
          i.expiry_date,
          i.status,
        ]
          .map(q)
          .join(','),
      ),
    ].join('\n');
    return ResponseHelper.Success('CSV report generated', { type: 'CSV', csv });
  }
}
