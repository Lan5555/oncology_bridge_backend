import { Module } from '@nestjs/common';
import { CourierService } from './courier.service';
import { CourierController } from './courier.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Courier } from './entities/courier.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Courier])],
  controllers: [CourierController],
  providers: [CourierService],
})
export class CourierModule {}
