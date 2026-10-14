import { Module } from '@nestjs/common';
import { MedicineService } from './medicine.service';
import { Gs1LookupController, MedicineController } from './medicine.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Medicine } from './entities/medicine.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Medicine])],
  controllers: [MedicineController, Gs1LookupController],
  providers: [MedicineService],
})
export class MedicineModule {}
