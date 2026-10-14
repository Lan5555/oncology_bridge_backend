/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TransferRequest } from './entities/transfer_request.entity';
import { CreateTransferRequestDto } from './dto/create-transfer_request.dto';
import { UpdateTransferRequestDto } from './dto/update-transfer_request.dto';
import { Inventory } from '../inventory/entities/inventory.entity';
import { Hospital } from '../hospital/entities/hospital.entity';
import { ResponseHelper } from '../helpers/response-helper';

@Injectable()
export class TransferRequestsService {
  constructor(
    @InjectRepository(TransferRequest)
    private readonly transfers: Repository<TransferRequest>,
    @InjectRepository(Inventory)
    private readonly inventory: Repository<Inventory>,
    @InjectRepository(Hospital)
    private readonly hospitals: Repository<Hospital>,
  ) {}
  async create(dto: CreateTransferRequestDto) {
    const [item, recipient] = await Promise.all([
      this.inventory.findOne({
        where: { id: dto.inventoryItemId },
        relations: { hospital: true, medicine: true },
      }),
      this.hospitals.findOneBy({ id: dto.recipientFacilityId }),
    ]);
    if (!item || !recipient)
      throw new NotFoundException(
        'Inventory item or recipient facility not found',
      );
    const qty = Number(dto.quantity);
    if (!Number.isInteger(qty) || qty < 1)
      throw new BadRequestException('quantity must be a positive integer');
    if (
      item.status.toUpperCase() === 'QUARANTINED' ||
      item.status.toUpperCase() === 'DISPOSED'
    )
      throw new BadRequestException('This stock cannot be transferred');
    if (qty > item.quantity)
      throw new BadRequestException('quantity exceeds available stock');
    if (item.hospital.id === recipient.id)
      throw new BadRequestException(
        'Donor and recipient facilities must differ',
      );
    const distance = this.distanceKm(
      item.hospital.latitude,
      item.hospital.longitude,
      recipient.latitude,
      recipient.longitude,
    );
    if (distance !== null && distance > 80)
      throw new BadRequestException(
        'Recipient is outside the 80 km transfer radius',
      );
    const queued = await this.transfers.find({
      where: { inventory: { id: item.id }, status: 'PENDING_APPROVAL' },
    });
    if (
      queued.reduce((n, t) => n + Number(t.quantity), 0) + qty >
      item.quantity
    )
      throw new BadRequestException('Quantity exceeds unreserved stock');
    const transfer = this.transfers.create({
      fromHospital: item.hospital,
      toHospital: recipient,
      medicine: item.medicine,
      inventory: item,
      quantity: qty,
      status: 'PENDING_APPROVAL',
    });
    return ResponseHelper.Success(
      'Transfer submitted for approval',
      await this.transfers.save(transfer),
    );
  }
  async findAll(status?: string) {
    const rows = await this.transfers.find({
      where: status ? { status } : {},
      relations: {
        fromHospital: true,
        toHospital: true,
        medicine: true,
        inventory: true,
      },
      order: { created_at: 'DESC' },
    });
    return ResponseHelper.Success('Transfers retrieved', rows);
  }
  async findOne(id: string) {
    const row = await this.transfers.findOne({
      where: { id },
      relations: {
        fromHospital: true,
        toHospital: true,
        medicine: true,
        inventory: true,
        approvedBy: true,
      },
    });
    if (!row) throw new NotFoundException('Transfer not found');
    return ResponseHelper.Success('Transfer retrieved', row);
  }
  async decide(id: string, approved: boolean, actorId?: string) {
    const row = await this.transfers.findOne({
      where: { id },
      relations: { inventory: true },
    });
    if (!row) throw new NotFoundException('Transfer not found');
    if (!['PENDING', 'PENDING_APPROVAL'].includes(row.status))
      throw new BadRequestException('Transfer is no longer awaiting approval');
    if (approved && row.inventory.quantity < row.quantity)
      throw new BadRequestException('Insufficient available stock');
    if (approved) {
      row.inventory.quantity -= row.quantity;
      await this.inventory.save(row.inventory);
    }
    row.status = approved ? 'APPROVED' : 'REJECTED';
    row.approved_at = new Date();
    if (actorId) row.approvedBy = { id: actorId } as any;
    return ResponseHelper.Success(
      `Transfer ${row.status.toLowerCase()}`,
      await this.transfers.save(row),
    );
  }
  async update(id: string, dto: UpdateTransferRequestDto) {
    const row = await this.transfers.findOneBy({ id });
    if (!row) throw new NotFoundException('Transfer not found');
    Object.assign(row, dto);
    return ResponseHelper.Success(
      'Transfer updated',
      await this.transfers.save(row),
    );
  }
  async remove(id: string) {
    const row = await this.transfers.findOneBy({ id });
    if (!row) throw new NotFoundException('Transfer not found');
    if (
      row.status === 'APPROVED' ||
      row.status === 'IN_TRANSIT' ||
      row.status === 'DELIVERED'
    )
      throw new BadRequestException('Approved transfers cannot be deleted');
    await this.transfers.remove(row);
    return ResponseHelper.Success('Transfer deleted', null);
  }
  async stats() {
    const rows = await this.transfers.find();
    return ResponseHelper.Success('Transfer statistics retrieved', {
      pending: rows.filter((r) =>
        ['PENDING', 'PENDING_APPROVAL'].includes(r.status),
      ).length,
      recentDeliveries: rows.filter((r) => r.status === 'DELIVERED').length,
    });
  }
  async activeOrder() {
    const row = await this.transfers.findOne({
      where: { status: 'IN_TRANSIT' },
      relations: {
        fromHospital: true,
        toHospital: true,
        medicine: true,
        inventory: true,
      },
      order: { created_at: 'DESC' },
    });
    if (!row) return ResponseHelper.Success('No active transfer', null);
    const stages = [
      'Stock Ingestion',
      'Prescription Packaged',
      'Order Matched & Reserved',
      'Prior-Authorization Cleared',
      'GS1 Validation Scan',
      'Last-Mile Delivery',
    ];
    const current = row.status === 'DELIVERED' ? 6 : 5;
    return ResponseHelper.Success('Active transfer timeline retrieved', {
      id: row.id,
      drug: row.medicine?.generic_name,
      lot: row.inventory?.batch_number,
      route: `${row.fromHospital?.name} → ${row.toHospital?.name}`,
      timeline: stages.map((step, index) => ({
        step,
        state:
          index < current ? 'done' : index === current ? 'active' : 'pending',
        at: index === 0 ? row.created_at : index === 2 ? row.approved_at : null,
      })),
      timelineData:
        'Derived from transfer fields; order event timestamps are not stored in the existing schema',
    });
  }
  async suggest(inventoryItemId: string) {
    const item = await this.inventory.findOne({
      where: { id: inventoryItemId },
      relations: { hospital: true },
    });
    if (!item) throw new NotFoundException('Inventory item not found');
    const facilities = await this.hospitals.find({
      where: { status: 'ACTIVE' as any },
    });
    const suggestions = facilities
      .filter((h) => h.id !== item.hospital.id)
      .map((h) => ({
        facilityId: h.id,
        name: h.name,
        city: h.city,
        distanceKm: this.distanceKm(
          item.hospital.latitude,
          item.hospital.longitude,
          h.latitude,
          h.longitude,
        ),
      }))
      .filter((h) => h.distanceKm !== null && h.distanceKm <= 80)
      .sort((a, b) => a.distanceKm! - b.distanceKm!);
    return ResponseHelper.Success(
      'Recipient suggestions retrieved',
      suggestions,
    );
  }
  private distanceKm(
    lat1?: number,
    lon1?: number,
    lat2?: number,
    lon2?: number,
  ): number | null {
    if (lat1 == null || lon1 == null || lat2 == null || lon2 == null)
      return null;
    const rad = (n: number) => (Number(n) * Math.PI) / 180;
    const dLat = rad(lat2 - lat1),
      dLon = rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
