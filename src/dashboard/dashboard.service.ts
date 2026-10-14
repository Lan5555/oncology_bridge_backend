import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Hospital } from '../hospital/entities/hospital.entity';
import { Inventory } from '../inventory/entities/inventory.entity';
import { ScanLog } from '../scan_log/entities/scan_log.entity';
import { TransferRequest } from '../transfer_requests/entities/transfer_request.entity';
import { ResponseHelper } from '../helpers/response-helper';
import { BadRequestException } from '@nestjs/common';
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
  async summary() {
    const [facilities, items, scans, transfers] = await Promise.all([
      this.hospitals.find(),
      this.inventory.find({ relations: { medicine: true } }),
      this.scans.count(),
      this.transfers.find(),
    ]);
    const active = facilities.filter((f) => f.status === 'ACTIVE').length;
    const vials = items.reduce((n, i) => n + Number(i.quantity), 0);
    const now = Date.now(),
      limit = now + 60 * 86400000;
    const near = items.filter(
      (i) =>
        new Date(i.expiry_date).getTime() >= now &&
        new Date(i.expiry_date).getTime() <= limit,
    ).length;
    return ResponseHelper.Success('Dashboard summary retrieved', {
      network: { name: 'Oncosourz', region: 'Lagos–Ibadan' },
      nodes: active,
      gs1AuthenticatedVials: scans,
      velocityPct: null,
      stockOutRiskPct: null,
      stockOutDeltaPct: null,
      valueRecoveredNaira: null,
      chainIntegrityPct: null,
      totalVials: vials,
      nearExpiry: near,
      pendingTransfers: transfers.filter((t) =>
        ['PENDING', 'PENDING_APPROVAL'].includes(t.status),
      ).length,
    });
  }
  async charts() {
    const [items, scans, transfers] = await Promise.all([
      this.inventory.find({ relations: { medicine: true } }),
      this.scans.find({ order: { created_at: 'ASC' } }),
      this.transfers.find(),
    ]);
    const stock = new Map<string, number>();
    items.forEach((i) => {
      const key = i.medicine?.generic_name ?? 'Unknown';
      stock.set(key, (stock.get(key) ?? 0) + Number(i.quantity));
    });
    const total = [...stock.values()].reduce((a, b) => a + b, 0) || 1;
    const months = new Map<string, number>();
    scans.forEach((s) => {
      const m = new Date(s.created_at).toISOString().slice(0, 7);
      months.set(m, (months.get(m) ?? 0) + 1);
    });
    return ResponseHelper.Success('Dashboard charts retrieved', {
      inventoryOverTime: [...months].map(([label, vials]) => ({
        label,
        vials,
      })),
      drugSplit: [...stock].map(([drug, qty]) => ({
        drug,
        pct: Math.round((qty * 100) / total),
      })),
      therapeuticStock: [...stock].map(([drug, qty]) => ({ drug, qty })),
      redistributionEfficiency: transfers.map((t) => ({
        label: t.created_at,
        days: t.approved_at
          ? Math.max(
              0,
              (new Date(t.approved_at).getTime() -
                new Date(t.created_at).getTime()) /
                86400000,
            )
          : null,
      })),
    });
  }
  async publicStats() {
    const [facilities, vials, scans, deliveries] = await Promise.all([
      this.hospitals.count({ where: { status: 'ACTIVE' as any } }),
      this.inventory
        .createQueryBuilder('i')
        .select('COALESCE(SUM(i.quantity),0)', 'total')
        .getRawOne(),
      this.scans.count(),
      this.transfers.count({ where: { status: 'DELIVERED' } }),
    ]);
    return ResponseHelper.Success('Public network statistics retrieved', {
      facilities,
      authenticatedVials: scans,
      totalInventoryVials: Number(vials?.total ?? 0),
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
