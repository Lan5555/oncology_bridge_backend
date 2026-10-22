import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Hospital } from '../hospital/entities/hospital.entity';
import { Inventory } from '../inventory/entities/inventory.entity';
import { ScanLog } from '../scan_log/entities/scan_log.entity';
import { TransferRequest } from '../transfer_requests/entities/transfer_request.entity';
import { ResponseHelper } from '../helpers/response-helper';
import { DashboardScope } from '../guards/dashboard-read.guard';
import { ForbiddenException } from '@nestjs/common';

import { recordedNumber } from '../helpers/business-values';
import { storageReadingStateSql } from '../storage_units/reading-presentation';
import { recordedTimestamp } from '../storage_units/reading-presentation';

interface DashboardStockRow {
  medicine_id: string;
  selling_unit: string | null;
  quantity: number | string | null;
  status: string | null;
  expiry_date: Date | null;
  created_at: Date | null;
  drug: string;
  available: boolean | null;
  authenticated_serials: number | string;
}
interface DashboardTransferRow {
  id: string;
  status: string | null;
  quantity: number | string | null;
  created_at: Date;
  unit: string | null;
}

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
        const [{ asOf }] = await manager.query<{ asOf: Date }[]>(
          'SELECT CURRENT_TIMESTAMP AS "asOf"',
        );
        const facilities = await manager.query<{ id: string }[]>(
          `
        SELECT id FROM hospitals WHERE status='ACTIVE' AND deleted_at IS NULL
        AND ($1::uuid IS NULL OR id=$1)`,
          [facilityId],
        );
        const items = await manager.query<DashboardStockRow[]>(
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
        const transfers = await manager.query<DashboardTransferRow[]>(
          `
        SELECT t.id,t.status,t.quantity,t.created_at,i.selling_unit AS unit
        FROM transfer_requests t LEFT JOIN inventory i ON i.id=t.inventory_id
        WHERE ($1::uuid IS NULL OR t.from_hospital=$1 OR t.to_hospital=$1)
        ORDER BY t.created_at,t.id`,
          [facilityId],
        );
        const units = await manager.query<
          { id: string; healthy: boolean | null }[]
        >(
          `
        SELECT observed.id, CASE WHEN observed.reading_state='UNKNOWN' THEN NULL
          ELSE observed.reading_state='NOMINAL' AND NOT EXISTS (
            SELECT 1 FROM cold_chain_events e WHERE e.unit_id=observed.id AND e.state='OPEN') END AS healthy
        FROM (SELECT unit.id, ${storageReadingStateSql} AS reading_state
          FROM storage_units unit JOIN hospitals h ON h.id=unit.facility_id
          LEFT JOIN LATERAL (SELECT r.temperature,r.recorded_at FROM temperature_logs r
            WHERE r.unit_id=unit.id AND r.recorded_at IS NOT NULL AND isfinite(r.recorded_at) ORDER BY r.recorded_at DESC,r.id DESC LIMIT 1) reading ON true
          WHERE h.status='ACTIVE' AND h.deleted_at IS NULL
            AND ($1::uuid IS NULL OR unit.facility_id=$1)) observed`,
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
    const quantitiesByUnit: Record<string, number | null> = {};
    for (const i of available) {
      const unit = i.selling_unit;
      if (!unit) continue;
      quantitiesByUnit[unit] =
        (quantitiesByUnit[unit] ?? 0) + Number(i.quantity);
    }
    const unknownStock = items.filter(
      (item) =>
        recordedNumber(item.quantity) === null ||
        !item.status ||
        item.status.toUpperCase() === 'UNKNOWN' ||
        !recordedTimestamp(item.expiry_date),
    );
    const unknownVials = unknownStock.some(
      (item) => item.selling_unit === 'vial',
    );
    for (const item of unknownStock)
      if (item.selling_unit) quantitiesByUnit[item.selling_unit] = null;
    const now = new Date(asOf).getTime();
    return ResponseHelper.Success('Dashboard summary retrieved', {
      asOf,
      scope,
      network: { name: 'Oncosourz', region: null },
      nodes: facilities.length,
      gs1AuthenticatedVials: unknownVials
        ? null
        : vialItems.reduce((n, i) => n + Number(i.authenticated_serials), 0),
      totalVials: unknownVials
        ? null
        : vialItems.reduce((n, i) => n + Number(i.quantity), 0),
      quantitiesByUnit,
      stockOutRiskPct: unknownStock.length
        ? null
        : medicines.size
          ? Math.round((100 * (medicines.size - stocked.size)) / medicines.size)
          : null,
      chainIntegrityPct:
        units.length && units.every((u) => typeof u.healthy === 'boolean')
          ? Math.round(
              (100 * units.filter((u) => u.healthy).length) / units.length,
            )
          : null,
      monitoredStorageUnits: units.length,
      nearExpiry: unknownStock.length
        ? null
        : available.filter(
            (i) =>
              Date.parse(recordedTimestamp(i.expiry_date)!) <=
              now + 60 * 86400000,
          ).length,
      pendingTransfers: transfers.filter(
        (t) =>
          t.status !== null &&
          ['PENDING', 'PENDING_APPROVAL'].includes(t.status),
      ).length,
      completedRedistributions: transfers.filter(
        (t) => t.status === 'DELIVERED',
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
      { drug: string; unit: string | null; qty: number }
    >();
    const months = new Map<
      string,
      { label: string; vials: number; quantitiesByUnit: Record<string, number> }
    >();
    const totals: Record<string, number> = {};
    for (const i of items.filter((item) => item.available)) {
      const unit: string | null = i.selling_unit || null;
      const key = JSON.stringify([i.medicine_id, unit]);
      const row = stock.get(key) ?? { drug: i.drug, unit, qty: 0 };
      row.qty += Number(i.quantity);
      stock.set(key, row);
      if (unit) totals[unit] = (totals[unit] ?? 0) + Number(i.quantity);
      const createdAt = recordedTimestamp(i.created_at);
      if (!createdAt) continue;
      const label = createdAt.slice(0, 7);
      const month = months.get(label) ?? {
        label,
        vials: 0,
        quantitiesByUnit: {},
      };
      if (unit)
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
        pct: unit ? Math.round((qty * 100) / totals[unit]) : null,
      })),
      therapeuticStock: [...stock.values()],
      redistributionEfficiency: transfers
        .filter((t) => t.status === 'DELIVERED')
        .map((t) => ({
          id: t.id,
          label: t.created_at,
          quantity: recordedNumber(t.quantity),
          unit: t.unit || null,
          days: null,
        })),
      redistributionTimingAvailable: false,
    });
  }

  async publicStats() {
    const { data } = await this.summary({ type: 'network' });
    return ResponseHelper.Success('Public network statistics retrieved', {
      asOf: data!.asOf,
      facilities: data!.nodes,
      authenticatedVials: data!.gs1AuthenticatedVials,
      totalInventoryVials: data!.totalVials,
      completedRedistributions: data!.completedRedistributions,
      scope: 'recorded_network',
      timeWindow: { from: null, to: data!.asOf, basis: 'database_snapshot' },
      metricDefinitions: {
        facilities: 'Active, nondeleted facilities recorded in this database',
        authenticatedVials:
          'Available vials with qualifying matching GS1 serial scans',
        totalInventoryVials:
          'Available stock explicitly recorded in vials; excludes other and missing units',
        completedRedistributions: 'Transfer records with DELIVERED status',
      },
      metricPeriods: {
        facilities: 'current_snapshot',
        authenticatedVials: 'current_available_stock',
        totalInventoryVials: 'current_available_stock',
        completedRedistributions: 'all_recorded_deliveries',
      },
    });
  }
}
