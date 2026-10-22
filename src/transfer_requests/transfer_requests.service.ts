/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Medicine } from '../medicine/entities/medicine.entity';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { TransferRequest } from './entities/transfer_request.entity';
import { CreateTransferRequestDto } from './dto/create-transfer_request.dto';
import { UpdateTransferRequestDto } from './dto/update-transfer_request.dto';
import { Inventory } from '../inventory/entities/inventory.entity';
import { FacilityStatus, Hospital } from '../hospital/entities/hospital.entity';
import { ResponseHelper } from '../helpers/response-helper';
import { StockAccessService } from '../guards/stock-access.service';
import { SELLING_UNITS } from '../inventory/selling-unit';
import { transferAvailableQuantity } from './transfer-availability';
import { User } from '../users/entities/user.entity';
import { Notification } from '../notification/entities/notification.entity';
import { contractError } from '../form_options/form-options.service';
import { OperationalQueryDto } from '../operations/operational-query.dto';
import { randomUUID } from 'node:crypto';

@Injectable()
export class TransferRequestsService {
  constructor(
    @InjectRepository(TransferRequest)
    private readonly transfers: Repository<TransferRequest>,
    @InjectRepository(Inventory)
    private readonly inventory: Repository<Inventory>,
    @InjectRepository(Hospital)
    private readonly hospitals: Repository<Hospital>,
    private readonly stockAccess: StockAccessService,
  ) {}

  private async lockStockWorkflow(manager: EntityManager) {
    // Match marketplace checkout's lock order, then lock the specific stock row.
    await manager.query(
      "SELECT pg_advisory_xact_lock(hashtext('oncology-marketplace-stock'))",
    );
  }

  private async loadStock(manager: EntityManager, id: string) {
    const stock = manager.getRepository(Inventory);
    const locked = await stock.findOne({
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!locked) throw new NotFoundException('Inventory item not found');
    const item = await stock.findOne({
      where: { id },
      relations: { hospital: true, medicine: true },
    });
    if (!item?.hospital || !item.medicine)
      throw new BadRequestException(
        'Stock must be linked to a facility and medicine',
      );
    const donor = await manager.getRepository(Hospital).findOne({
      where: { id: item.hospital.id },
      lock: { mode: 'pessimistic_read' },
    });
    if (!donor) throw new BadRequestException('Donor facility is unavailable');
    item.hospital = donor;
    return item;
  }

  private async validateStock(manager: EntityManager, item: Inventory) {
    const medicine = await manager.getRepository(Medicine).findOne({
      where: { id: item.medicine.id },
      lock: { mode: 'pessimistic_read' },
    });
    if (!medicine || medicine.deleted_at)
      throw new BadRequestException(
        'Deleted medicine stock cannot be transferred',
      );
    if (
      item.hospital.status !== FacilityStatus.ACTIVE ||
      item.hospital.deleted_at
    )
      throw new BadRequestException('Donor facility is not active');
    if (
      item.status?.trim().toUpperCase() !== 'AVAILABLE' ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity <= 0
    )
      throw new BadRequestException('This stock is not available for transfer');
    const [{ today }] = await manager.query<{ today: string }[]>(
      'SELECT CURRENT_DATE::text AS today',
    );
    const expiry = new Date(item.expiry_date);
    if (
      !Number.isFinite(expiry.getTime()) ||
      expiry.toISOString().slice(0, 10) <= today
    )
      throw new BadRequestException('Expired batches cannot be transferred');
    if (
      !SELLING_UNITS.includes(
        item.selling_unit as (typeof SELLING_UNITS)[number],
      )
    )
      throw new BadRequestException(
        'Stock selling unit must be reviewed before transfer',
      );
  }

  private recipientDistance(
    donor: Hospital,
    recipient: Hospital,
  ): number | null {
    if (
      donor.id === recipient.id ||
      recipient.status !== FacilityStatus.ACTIVE ||
      recipient.deleted_at ||
      !recipient.name?.trim()
    )
      return null;
    const distance = this.distanceKm(
      donor.latitude,
      donor.longitude,
      recipient.latitude,
      recipient.longitude,
    );
    return distance !== null && distance <= 80 ? distance : null;
  }

  private async available(
    manager: EntityManager,
    id: string,
    excludeTransfer?: string,
  ) {
    const [row] = await manager.query<{ available: number | null }[]>(
      `SELECT ${transferAvailableQuantity('i', excludeTransfer ? '$2' : undefined)} AS available FROM inventory i WHERE i.id=$1`,
      excludeTransfer ? [id, excludeTransfer] : [id],
    );
    if (!row || row.available === null)
      throw new BadRequestException(
        'Available quantity is not recorded for this batch',
      );
    return row.available;
  }

  private quantity(value: number) {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new BadRequestException('quantity must be a positive whole number');
    return value;
  }

  async create(dto: CreateTransferRequestDto, actorId: string) {
    return this.transfers.manager.transaction(async (manager) => {
      await this.lockStockWorkflow(manager);
      const actor = await this.stockAccess.assertManage(
        actorId,
        undefined,
        undefined,
        manager,
      );
      const item = await this.loadStock(manager, dto.inventoryItemId);
      if (item.hospital.id !== actor.hospital.id)
        throw new NotFoundException(
          'Inventory item not found in your facility',
        );
      await this.validateStock(manager, item);
      const recipient = await manager.getRepository(Hospital).findOne({
        where: { id: dto.recipientFacilityId },
        lock: { mode: 'pessimistic_read' },
      });
      if (
        !recipient ||
        this.recipientDistance(item.hospital, recipient) === null
      )
        throw new BadRequestException(
          'Recipient is not eligible for this stock batch',
        );
      const qty = this.quantity(dto.quantity);
      if (qty > (await this.available(manager, item.id)))
        throw new BadRequestException(
          'Quantity exceeds currently available stock',
        );
      const transfers = manager.getRepository(TransferRequest);
      const transfer = transfers.create({
        fromHospital: item.hospital,
        toHospital: recipient,
        medicine: item.medicine,
        inventory: item,
        quantity: qty,
        selling_unit: item.selling_unit,
        batch_number: item.batch_number,
        expiry_date: new Date(item.expiry_date).toISOString().slice(0, 10),
        status: 'PENDING_APPROVAL',
      });
      return ResponseHelper.Success(
        'Transfer submitted for approval',
        this.present(await transfers.save(transfer), actor.hospital.id, true),
      );
    });
  }
  async findAll(status?: string, facilityScope?: string) {
    const rows = await this.transfers.find({
      where:
        facilityScope !== undefined
          ? [
              {
                ...(status ? { status } : {}),
                fromHospital: { id: facilityScope },
              },
              {
                ...(status ? { status } : {}),
                toHospital: { id: facilityScope },
              },
            ]
          : status
            ? { status }
            : {},
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
  async findOne(id: string, facilityScope?: string) {
    const row = await this.transfers.findOne({
      where: { id },
      relations: {
        fromHospital: true,
        toHospital: true,
        medicine: true,
        inventory: true,
      },
    });
    if (!row) throw new NotFoundException('Transfer not found');
    if (
      facilityScope !== undefined &&
      row.fromHospital.id !== facilityScope &&
      row.toHospital.id !== facilityScope
    )
      throw new NotFoundException('Transfer not found');
    return ResponseHelper.Success(
      'Transfer retrieved',
      this.present(row, facilityScope),
    );
  }
  async decide(id: string, approved: boolean, actorId: string) {
    return this.transfers.manager.transaction(async (manager) => {
      await this.lockStockWorkflow(manager);
      const actor = await this.stockAccess.assertManage(
        actorId,
        undefined,
        undefined,
        manager,
      );
      const transfers = manager.getRepository(TransferRequest);
      const inventory = manager.getRepository(Inventory);
      await transfers
        .createQueryBuilder('transfer')
        .where('transfer.id = :id', { id })
        .setLock('pessimistic_write')
        .getOne();
      const row = await transfers.findOne({
        where: { id },
        withDeleted: true,
        relations: {
          inventory: true,
          medicine: true,
          fromHospital: true,
          toHospital: true,
        },
      });
      if (!row) throw new NotFoundException('Transfer not found');
      if (row.toHospital.id !== actor.hospital.id)
        throw new NotFoundException('Transfer not found for this facility');
      if (!['PENDING', 'PENDING_APPROVAL'].includes(row.status))
        contractError(
          409,
          'TRANSFER_STATE_CONFLICT',
          `Transfer is ${row.status}; it is no longer awaiting approval.`,
        );
      if (approved) {
        const item = await this.loadStock(manager, row.inventory.id);
        await this.validateStock(manager, item);
        const recipient = await manager.getRepository(Hospital).findOne({
          where: { id: row.toHospital.id },
          lock: { mode: 'pessimistic_read' },
        });
        if (
          !recipient ||
          this.recipientDistance(item.hospital, recipient) === null
        )
          throw new BadRequestException(
            'Recipient is no longer eligible for this stock batch',
          );
        if (
          item.hospital.id !== row.fromHospital.id ||
          item.medicine.id !== row.medicine?.id ||
          !row.selling_unit ||
          item.selling_unit !== row.selling_unit ||
          row.batch_number !== item.batch_number ||
          row.expiry_date !==
            new Date(item.expiry_date).toISOString().slice(0, 10)
        )
          throw new BadRequestException(
            'Stock identity or selling unit changed; submit a new request',
          );
        if (
          this.quantity(row.quantity) >
          (await this.available(manager, item.id, row.id))
        )
          throw new BadRequestException(
            'Insufficient currently available stock',
          );
        row.inventory = item;
        row.inventory.quantity -= row.quantity;
        await inventory.save(row.inventory);
      }
      row.status = approved ? 'APPROVED' : 'REJECTED';
      row.approved_at = new Date();
      row.approvedBy = { id: actorId } as User;
      return ResponseHelper.Success(
        `Transfer ${row.status.toLowerCase()}`,
        this.present(await transfers.save(row), actor.hospital.id, true),
      );
    });
  }
  private present(
    row: TransferRequest,
    facilityId?: string,
    canManage = false,
  ) {
    const status = row.status === 'PENDING' ? 'PENDING_APPROVAL' : row.status;
    const donor = row.fromHospital?.id === facilityId,
      recipient = row.toHospital?.id === facilityId;
    const allowedActions: string[] = [];
    if (canManage && recipient && status === 'PENDING_APPROVAL')
      allowedActions.push('approve', 'reject');
    if (canManage && donor && status === 'APPROVED')
      allowedActions.push('dispatch');
    if (canManage && recipient && status === 'IN_TRANSIT')
      allowedActions.push('deliver');
    return {
      id: row.id,
      drug: row.medicine?.generic_name ?? null,
      quantity: row.quantity ?? null,
      unit: row.selling_unit ?? null,
      donorFacility: {
        id: row.fromHospital?.id,
        name: row.fromHospital?.name ?? null,
      },
      recipientFacility: {
        id: row.toHospital?.id,
        name: row.toHospital?.name ?? null,
      },
      lot: row.batch_number ?? row.inventory?.batch_number ?? null,
      status,
      allowedActions,
      dispatchedAt: row.dispatched_at ?? null,
      deliveredAt: row.delivered_at ?? null,
    };
  }

  async listForActor(actorId: string, query: OperationalQueryDto) {
    const manager = this.transfers.manager;
    const actor = await manager.getRepository(User).findOne({
      where: { id: actorId },
      relations: { role: true, hospital: true },
    });
    if (!actor?.active)
      contractError(403, 'ACCOUNT_FORBIDDEN', 'An active account is required.');
    const network = ['ADMIN', 'SUPERADMIN'].includes(
      actor.role?.name.trim().toUpperCase() ?? '',
    );
    const permissions = await this.stockAccess.permissions(actor, manager);
    const member = await this.stockAccess.verifiedMember(actor, manager);
    if (
      network
        ? !permissions.includes('admin.access') ||
          !permissions.includes('transfer.read')
        : !member
    )
      contractError(
        403,
        'TRANSFER_FORBIDDEN',
        'Active facility membership or authorized network transfer access is required.',
      );
    if (!network && query.facilityId && query.facilityId !== actor.hospital.id)
      contractError(
        403,
        'FACILITY_FORBIDDEN',
        'You cannot read another facility transfers.',
      );
    const facilityId = network ? query.facilityId : actor.hospital.id;
    const requested = query.status?.toUpperCase();
    if (
      requested &&
      ![
        'PENDING_APPROVAL',
        'APPROVED',
        'IN_TRANSIT',
        'DELIVERED',
        'REJECTED',
        'CANCELLED',
      ].includes(requested)
    )
      contractError(
        422,
        'INVALID_TRANSFER_STATUS',
        'Use PENDING_APPROVAL, APPROVED, IN_TRANSIT, DELIVERED, REJECTED, or CANCELLED.',
      );
    const rows = await this.transfers.find({
      where: facilityId
        ? [
            { fromHospital: { id: facilityId } },
            { toHospital: { id: facilityId } },
          ]
        : {},
      relations: {
        fromHospital: true,
        toHospital: true,
        medicine: true,
        inventory: true,
      },
      order: { created_at: 'DESC', id: 'ASC' },
    });
    const filtered = rows.filter(
      (row) =>
        (!requested ||
          (row.status === 'PENDING' ? 'PENDING_APPROVAL' : row.status) ===
            requested) &&
        (!query.q?.trim() ||
          [
            row.medicine?.generic_name,
            row.batch_number,
            row.fromHospital?.name,
            row.toHospital?.name,
          ].some((value) =>
            value?.toLowerCase().includes(query.q!.trim().toLowerCase()),
          )),
    );
    return ResponseHelper.Success('Transfers loaded', {
      items: filtered.map((row) =>
        this.present(
          row,
          actor.hospital?.id,
          member && permissions.includes('inventory.manage'),
        ),
      ),
      total: filtered.length,
    });
  }

  async move(id: string, action: 'dispatch' | 'deliver', actorId: string) {
    return this.transfers.manager.transaction(async (manager) => {
      await this.lockStockWorkflow(manager);
      const actor = await this.stockAccess.assertManage(
        actorId,
        undefined,
        undefined,
        manager,
      );
      const repo = manager.getRepository(TransferRequest);
      await repo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      const row = await repo.findOne({
        where: { id },
        relations: {
          fromHospital: true,
          toHospital: true,
          medicine: true,
          inventory: true,
        },
      });
      if (!row) contractError(404, 'TRANSFER_NOT_FOUND', 'Transfer not found.');
      if (
        (action === 'dispatch' ? row.fromHospital.id : row.toHospital.id) !==
        actor.hospital.id
      )
        contractError(
          403,
          'TRANSFER_CUSTODY_FORBIDDEN',
          `Only the ${action === 'dispatch' ? 'donor' : 'recipient'} facility can ${action} this transfer.`,
        );
      const target = action === 'dispatch' ? 'IN_TRANSIT' : 'DELIVERED';
      if (
        row.status === target ||
        (action === 'dispatch' &&
          row.status === 'DELIVERED' &&
          row.dispatched_at)
      )
        return ResponseHelper.Success('Transfer already updated', {
          transfer: this.present(row, actor.hospital.id, true),
        });
      if (row.status !== (action === 'dispatch' ? 'APPROVED' : 'IN_TRANSIT'))
        contractError(
          409,
          'TRANSFER_STATE_CONFLICT',
          `Cannot ${action} a transfer in ${row.status} state. Reload the transfer list.`,
        );
      if (!row.inventory?.id || !row.medicine?.id)
        contractError(
          409,
          'TRANSFER_STOCK_UNAVAILABLE',
          'The recorded batch or medicine is unavailable. Review the transfer.',
        );
      const item = await this.loadStock(manager, row.inventory.id);
      if (!Number.isSafeInteger(item.quantity) || item.quantity < 0)
        contractError(
          409,
          'TRANSFER_STOCK_UNAVAILABLE',
          'The remaining donor stock quantity must be reconciled.',
        );
      // Approval already deducted this allocation. Remaining donor quantity may be zero.
      try {
        await this.validateStock(
          manager,
          Object.assign(new Inventory(), item, { quantity: row.quantity }),
        );
      } catch (error) {
        if (error instanceof HttpException && error.getStatus() === 400)
          contractError(409, 'TRANSFER_STOCK_UNAVAILABLE', error.message);
        throw error;
      }
      if (
        !row.batch_number ||
        !row.expiry_date ||
        !row.selling_unit ||
        item.hospital.id !== row.fromHospital.id ||
        item.medicine.id !== row.medicine.id ||
        item.batch_number !== row.batch_number ||
        new Date(item.expiry_date).toISOString().slice(0, 10) !==
          row.expiry_date ||
        item.selling_unit !== row.selling_unit
      )
        contractError(
          409,
          'TRANSFER_STOCK_CHANGED',
          'Stock identity, expiry, or unit changed. Review the transfer before continuing.',
        );
      this.quantity(row.quantity);
      const recipient = await manager.getRepository(Hospital).findOne({
        where: { id: row.toHospital.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !recipient ||
        this.recipientDistance(item.hospital, recipient) === null
      )
        contractError(
          409,
          'RECIPIENT_UNAVAILABLE',
          'Recipient is no longer eligible. Review the transfer.',
        );
      if (action === 'deliver') {
        const existing = await manager.getRepository(Inventory).find({
          where: {
            hospital: { id: recipient.id },
            medicine: { id: row.medicine.id },
            batch_number: row.batch_number,
          },
          lock: { mode: 'pessimistic_write' },
        });
        if (existing.length > 1)
          contractError(
            409,
            'RECIPIENT_BATCH_CONFLICT',
            'Multiple recipient batches match. Reconcile stock before receipt.',
          );
        const received = existing[0];
        if (received) {
          if (
            received.selling_unit !== row.selling_unit ||
            !Number.isFinite(new Date(received.expiry_date).getTime()) ||
            new Date(received.expiry_date).toISOString().slice(0, 10) !==
              row.expiry_date ||
            received.status !== 'AVAILABLE' ||
            !Number.isSafeInteger(received.quantity) ||
            received.quantity < 0 ||
            received.quantity + row.quantity > 2147483647
          )
            contractError(
              409,
              'RECIPIENT_BATCH_CONFLICT',
              'Recipient batch quantity, unit, expiry, or state must be reconciled before receipt.',
            );
          received.quantity += row.quantity;
          await manager.getRepository(Inventory).save(received);
          row.recipient_inventory_id = received.id;
        } else {
          const receivedId = randomUUID();
          await manager.getRepository(Inventory).save({
            id: receivedId,
            hospital: recipient,
            medicine: row.medicine,
            batch_number: row.batch_number,
            serial_number: item.serial_number ?? '',
            expiry_date: new Date(row.expiry_date),
            quantity: row.quantity,
            selling_unit: row.selling_unit,
            status: 'AVAILABLE',
            storage_unit_id: null,
          });
          row.recipient_inventory_id = receivedId;
        }
        row.delivered_at = new Date();
        row.delivered_by = actorId;
      } else {
        row.dispatched_at = new Date();
        row.dispatched_by = actorId;
      }
      const previous = row.status;
      row.status = target;
      await repo.save(row);
      await manager.query(
        `INSERT INTO audit_logs(user_id,action,description,ip_address,object_type,object_id,before_status,after_status) VALUES ($1,$2,$3,'unknown','transfer',$4,$5,$6)`,
        [
          actorId,
          `TRANSFER_${target}`,
          `Transfer ${action} recorded`,
          id,
          previous,
          target,
        ],
      );
      const users = await manager.getRepository(User).find({
        where: {
          hospital: {
            id: action === 'dispatch' ? row.toHospital.id : row.fromHospital.id,
          },
          active: true,
          verification_status: 'VERIFIED',
        },
      });
      for (const user of users)
        await manager.getRepository(Notification).save({
          user,
          title:
            action === 'dispatch'
              ? 'Transfer dispatched'
              : 'Transfer delivered',
          message: `Transfer ${id} was ${action === 'dispatch' ? 'dispatched by the donor' : 'received by the recipient'} facility.`,
          read: false,
        });
      return ResponseHelper.Success('Transfer updated', {
        transfer: this.present(row, actor.hospital.id, true),
      });
    });
  }
  async update(id: string, dto: UpdateTransferRequestDto, actorId: string) {
    return this.transfers.manager.transaction(async (manager) => {
      await this.lockStockWorkflow(manager);
      const actor = await this.stockAccess.assertManage(
        actorId,
        undefined,
        undefined,
        manager,
      );
      const transfers = manager.getRepository(TransferRequest);
      const row = await transfers.findOne({
        where: { id },
        relations: {
          fromHospital: true,
          toHospital: true,
          inventory: true,
          medicine: true,
        },
      });
      if (!row || row.fromHospital.id !== actor.hospital.id)
        throw new NotFoundException('Transfer not found');
      if (!['PENDING', 'PENDING_APPROVAL'].includes(row.status))
        throw new BadRequestException('Only pending requests can be edited');
      if (
        dto.inventoryItemId !== undefined ||
        dto.recipientFacilityId !== undefined
      )
        throw new BadRequestException(
          'Submit a new request to change the stock batch or recipient',
        );
      if (Object.keys(dto).some((key) => key !== 'quantity'))
        throw new ForbiddenException(
          'Only the requested quantity can be edited',
        );
      const item = await this.loadStock(manager, row.inventory.id);
      await this.validateStock(manager, item);
      const recipient = await manager.getRepository(Hospital).findOne({
        where: { id: row.toHospital.id },
        lock: { mode: 'pessimistic_read' },
      });
      if (
        !recipient ||
        this.recipientDistance(item.hospital, recipient) === null
      )
        throw new BadRequestException('Recipient is no longer eligible');
      if (
        item.hospital.id !== row.fromHospital.id ||
        item.medicine.id !== row.medicine.id ||
        !row.selling_unit ||
        row.selling_unit !== item.selling_unit
      )
        throw new BadRequestException(
          'Stock identity or selling unit changed; submit a new request',
        );
      const quantity = this.quantity(dto.quantity ?? row.quantity);
      if (quantity > (await this.available(manager, item.id, row.id)))
        throw new BadRequestException(
          'Quantity exceeds currently available stock',
        );
      row.quantity = quantity;
      return ResponseHelper.Success(
        'Transfer updated',
        this.present(await transfers.save(row), actor.hospital.id, true),
      );
    });
  }
  async remove(id: string, actorId: string) {
    return this.transfers.manager.transaction(async (manager) => {
      await this.lockStockWorkflow(manager);
      const actor = await this.stockAccess.assertManage(
        actorId,
        undefined,
        undefined,
        manager,
      );
      const transfers = manager.getRepository(TransferRequest);
      const row = await transfers.findOne({
        where: { id },
        relations: { fromHospital: true },
      });
      if (!row || row.fromHospital.id !== actor.hospital.id)
        throw new NotFoundException('Transfer not found');
      if (
        !['PENDING', 'PENDING_APPROVAL', 'REJECTED', 'CANCELLED'].includes(
          row.status,
        )
      )
        throw new BadRequestException('Approved transfers cannot be deleted');
      await transfers.remove(row);
      return ResponseHelper.Success('Transfer deleted', null);
    });
  }
  async stats(facilityScope?: string) {
    const rows = await this.transfers.find({
      where:
        facilityScope !== undefined
          ? [
              { fromHospital: { id: facilityScope } },
              { toHospital: { id: facilityScope } },
            ]
          : {},
    });
    return ResponseHelper.Success('Transfer statistics retrieved', {
      pending: rows.filter((r) =>
        ['PENDING', 'PENDING_APPROVAL'].includes(r.status),
      ).length,
      recentDeliveries: rows.filter((r) => r.status === 'DELIVERED').length,
    });
  }
  async activeOrder(facilityScope?: string) {
    const row = await this.transfers.findOne({
      where:
        facilityScope !== undefined
          ? [
              { status: 'IN_TRANSIT', fromHospital: { id: facilityScope } },
              { status: 'IN_TRANSIT', toHospital: { id: facilityScope } },
            ]
          : { status: 'IN_TRANSIT' },
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
      { step: 'Transfer submitted', at: row.created_at },
      { step: 'Transfer approved', at: row.approved_at },
      { step: 'Transfer dispatched', at: row.dispatched_at },
      { step: 'Transfer delivered', at: row.delivered_at },
    ];
    return ResponseHelper.Success('Active transfer timeline retrieved', {
      id: row.id,
      drug: row.medicine?.generic_name,
      lot: row.inventory?.batch_number,
      route: `${row.fromHospital?.name} → ${row.toHospital?.name}`,
      status: row.status,
      timeline: stages.map(({ step, at }) => ({
        step,
        state: at ? 'done' : 'unavailable',
        at: at ?? null,
      })),
      timelineData:
        'Recorded transfer timestamps; missing events are unavailable',
    });
  }
  async suggest(inventoryItemId: string, actorId: string) {
    return this.transfers.manager.transaction(async (manager) => {
      const actor = await this.stockAccess.assertManage(
        actorId,
        undefined,
        undefined,
        manager,
      );
      const item = await this.loadStock(manager, inventoryItemId);
      if (item.hospital.id !== actor.hospital.id)
        throw new NotFoundException(
          'Inventory item not found in your facility',
        );
      await this.validateStock(manager, item);
      if ((await this.available(manager, item.id)) <= 0)
        throw new BadRequestException(
          'No stock is currently available for transfer',
        );
      const facilities = await manager
        .getRepository(Hospital)
        .find({ where: { status: FacilityStatus.ACTIVE } });
      const suggestions = facilities
        .flatMap((facility) => {
          const distanceKm = this.recipientDistance(item.hospital, facility);
          return distanceKm === null
            ? []
            : [
                {
                  id: facility.id,
                  facilityId: facility.id,
                  name: facility.name,
                  city: facility.city,
                  distanceKm,
                },
              ];
        })
        .sort(
          (a, b) => a.distanceKm - b.distanceKm || a.id.localeCompare(b.id),
        );
      return ResponseHelper.Success(
        'Recipient suggestions retrieved',
        suggestions,
      );
    });
  }
  private distanceKm(
    lat1?: number,
    lon1?: number,
    lat2?: number,
    lon2?: number,
  ): number | null {
    if (lat1 == null || lon1 == null || lat2 == null || lon2 == null)
      return null;
    const coordinates = [lat1, lon1, lat2, lon2].map(Number);
    if (
      coordinates.some((n) => !Number.isFinite(n)) ||
      Math.abs(coordinates[0]) > 90 ||
      Math.abs(coordinates[2]) > 90 ||
      Math.abs(coordinates[1]) > 180 ||
      Math.abs(coordinates[3]) > 180
    )
      return null;
    const rad = (n: number) => (Number(n) * Math.PI) / 180;
    const dLat = rad(lat2 - lat1),
      dLon = rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    const bounded = Math.min(1, Math.max(0, a));
    return 6371 * 2 * Math.atan2(Math.sqrt(bounded), Math.sqrt(1 - bounded));
  }
}
