import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CourierAssignment } from './entities/courier_assignment.entity';
import { Courier } from '../courier/entities/courier.entity';
import { TransferRequest } from '../transfer_requests/entities/transfer_request.entity';
import { CreateCourierAssignmentDto } from './dto/create-courier_assignment.dto';
import { UpdateCourierAssignmentDto } from './dto/update-courier_assignment.dto';
import { ResponseHelper } from '../helpers/response-helper';
@Injectable()
export class CourierAssignmentService {
  constructor(
    @InjectRepository(CourierAssignment)
    private readonly assignments: Repository<CourierAssignment>,
    @InjectRepository(Courier) private readonly couriers: Repository<Courier>,
    @InjectRepository(TransferRequest)
    private readonly transfers: Repository<TransferRequest>,
  ) {}
  async create(dto: CreateCourierAssignmentDto) {
    const [courier, transfer] = await Promise.all([
      this.couriers.findOneBy({ id: dto.courierId, active: true }),
      this.transfers.findOneBy({ id: dto.transferId }),
    ]);
    if (!courier || !transfer)
      throw new NotFoundException('Active courier or transfer not found');
    if (!['APPROVED', 'IN_TRANSIT'].includes(transfer.status))
      throw new BadRequestException('Only approved transfers can be assigned');
    const row = this.assignments.create({
      courier,
      transfer,
      status: 'ASSIGNED',
    });
    transfer.status = 'IN_TRANSIT';
    await this.transfers.save(transfer);
    return ResponseHelper.Success(
      'Courier assigned to transfer',
      await this.assignments.save(row),
    );
  }
  async findAll() {
    return ResponseHelper.Success(
      'Courier assignments retrieved',
      await this.assignments.find({
        relations: {
          courier: true,
          transfer: { fromHospital: true, toHospital: true, medicine: true },
        },
        order: { picked_at: 'DESC' },
      }),
    );
  }
  async findOne(id: string) {
    const row = await this.assignments.findOne({
      where: { id },
      relations: { courier: true, transfer: true },
    });
    if (!row) throw new NotFoundException('Assignment not found');
    return ResponseHelper.Success('Assignment retrieved', row);
  }
  async update(id: string, dto: UpdateCourierAssignmentDto) {
    const row = await this.assignments.findOne({
      where: { id },
      relations: { transfer: true },
    });
    if (!row) throw new NotFoundException('Assignment not found');
    if (dto.status) {
      if (
        !['ASSIGNED', 'PICKED_UP', 'DELIVERED', 'CANCELLED'].includes(
          dto.status,
        )
      )
        throw new BadRequestException('Invalid courier status');
      row.status = dto.status;
      if (dto.status === 'PICKED_UP') {
        row.picked_at = new Date();
        row.transfer.status = 'IN_TRANSIT';
      }
      if (dto.status === 'DELIVERED') {
        row.delivered_at = new Date();
        row.transfer.status = 'DELIVERED';
      }
      await this.transfers.save(row.transfer);
    }
    return ResponseHelper.Success(
      'Assignment updated',
      await this.assignments.save(row),
    );
  }
  async remove(id: string) {
    const row = await this.assignments.findOneBy({ id });
    if (!row) throw new NotFoundException('Assignment not found');
    await this.assignments.remove(row);
    return ResponseHelper.Success('Assignment removed', null);
  }
}
