import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { MeController } from './me.controller';
import { EncryptionModule } from '../encryption/encryption.module';
import { Role } from '../role/entities/role.entity';
import { GuardsModule } from '../guards/guards.module';
import { AuditLog } from '../audit_log/entities/audit_log.entity';
import { VerificationApplication } from '../verification_applications/entities/verification-application.entity';
import { FacilityMembershipRequest } from '../hospital/entities/facility-membership-request.entity';
import { RolePermission } from '../role/entities/role-permission.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Role,
      AuditLog,
      VerificationApplication,
      FacilityMembershipRequest,
      RolePermission,
    ]),
    EncryptionModule,
    GuardsModule,
  ],
  controllers: [UsersController, MeController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
