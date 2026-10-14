import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Courier } from './entities/courier.entity';
import { CreateCourierDto } from './dto/create-courier.dto';
import { UpdateCourierDto } from './dto/update-courier.dto';
import { ResponseHelper } from '../helpers/response-helper';
@Injectable()
export class CourierService {
  constructor(
    @InjectRepository(Courier) private readonly couriers: Repository<Courier>,
  ) {}
  async create(dto: CreateCourierDto) {
    return ResponseHelper.Success(
      'Courier created',
      await this.couriers.save(this.couriers.create(dto)),
    );
  }
  async findAll() {
    return ResponseHelper.Success(
      'Couriers retrieved',
      await this.couriers.find({
        relations: { assignments: true },
        order: { created_at: 'DESC' },
      }),
    );
  }
  async findOne(id: string) {
    const row = await this.couriers.findOne({
      where: { id },
      relations: { assignments: { transfer: true } },
    });
    if (!row) throw new NotFoundException('Courier not found');
    return ResponseHelper.Success('Courier retrieved', row);
  }
  async update(id: string, dto: UpdateCourierDto) {
    const row = await this.couriers.findOneBy({ id });
    if (!row) throw new NotFoundException('Courier not found');
    Object.assign(row, dto);
    return ResponseHelper.Success(
      'Courier updated',
      await this.couriers.save(row),
    );
  }
  async remove(id: string) {
    const row = await this.couriers.findOneBy({ id });
    if (!row) throw new NotFoundException('Courier not found');
    row.active = false;
    return ResponseHelper.Success(
      'Courier deactivated',
      await this.couriers.save(row),
    );
  }
}
