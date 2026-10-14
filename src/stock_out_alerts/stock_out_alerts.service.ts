import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StockOutAlert } from './entities/stock_out_alert.entity';
import { Hospital } from '../hospital/entities/hospital.entity';
import { Medicine } from '../medicine/entities/medicine.entity';
import { CreateStockOutAlertDto } from './dto/create-stock_out_alert.dto';
import { UpdateStockOutAlertDto } from './dto/update-stock_out_alert.dto';
import { ResponseHelper } from '../helpers/response-helper';
@Injectable()
export class StockOutAlertsService {
  constructor(
    @InjectRepository(StockOutAlert)
    private readonly alerts: Repository<StockOutAlert>,
    @InjectRepository(Hospital)
    private readonly hospitals: Repository<Hospital>,
    @InjectRepository(Medicine)
    private readonly medicines: Repository<Medicine>,
  ) {}
  async create(dto: CreateStockOutAlertDto) {
    const [hospital, medicine] = await Promise.all([
      this.hospitals.findOneBy({ id: dto.hospitalId }),
      this.medicines.findOneBy({ id: dto.medicineId }),
    ]);
    if (!hospital || !medicine)
      throw new NotFoundException('Facility or medicine not found');
    return ResponseHelper.Success(
      'Stock-out alert created',
      await this.alerts.save(
        this.alerts.create({
          hospital,
          medicine,
          requested_quantity: dto.requested_quantity,
        }),
      ),
    );
  }
  async findAll() {
    return ResponseHelper.Success(
      'Stock-out alerts retrieved',
      await this.alerts.find({
        relations: { hospital: true, medicine: true },
        order: { created_at: 'DESC' },
      }),
    );
  }
  async findOne(id: string) {
    const row = await this.alerts.findOne({
      where: { id },
      relations: { hospital: true, medicine: true },
    });
    if (!row) throw new NotFoundException('Alert not found');
    return ResponseHelper.Success('Alert retrieved', row);
  }
  async update(id: string, dto: UpdateStockOutAlertDto) {
    const row = await this.alerts.findOneBy({ id });
    if (!row) throw new NotFoundException('Alert not found');
    if (dto.status) row.status = dto.status;
    if (dto.requested_quantity !== undefined)
      row.requested_quantity = dto.requested_quantity;
    return ResponseHelper.Success('Alert updated', await this.alerts.save(row));
  }
  async remove(id: string) {
    const row = await this.alerts.findOneBy({ id });
    if (!row) throw new NotFoundException('Alert not found');
    await this.alerts.remove(row);
    return ResponseHelper.Success('Alert removed', null);
  }
}
