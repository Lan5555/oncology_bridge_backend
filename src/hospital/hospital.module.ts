import { Module } from '@nestjs/common';
import { HospitalService } from './hospital.service';
import {
  FacilitiesApiController,
  HospitalController,
  LicenseVerificationController,
  NetworkApiController,
  FacilityTeamMembershipController,
} from './hospital.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Hospital } from './entities/hospital.entity';
import { EncryptionModule } from '../encryption/encryption.module';
import { UsersModule } from '../users/users.module';
import { User } from '../users/entities/user.entity';
import { JwtModule } from '@nestjs/jwt';
import { FacilityMembershipRequest } from './entities/facility-membership-request.entity';
import { FacilityLicenseCheck } from './entities/facility-license-check.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Hospital, User, FacilityMembershipRequest, FacilityLicenseCheck]),
    EncryptionModule,
    UsersModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'development_only_secret',
      signOptions: { expiresIn: '1h' },
    }),
  ],
  controllers: [
    HospitalController,
    FacilitiesApiController,
    NetworkApiController,
    LicenseVerificationController,
    FacilityTeamMembershipController,
  ],
  providers: [HospitalService],
})
export class HospitalModule {}
