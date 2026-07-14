import { Module } from '@nestjs/common';
import { HospitalService } from './hospital.service';
import { HospitalController } from './hospital.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Hospital } from './entities/hospital.entity';
import { EncryptionModule } from '../encryption/encryption.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Hospital]),
    EncryptionModule,
    UsersModule,
  ],
  controllers: [HospitalController],
  providers: [HospitalService],
})
export class HospitalModule {}
