import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { UserSession } from '../user_sessions/entities/user_session.entity';
import { VerificationApplication } from '../verification_applications/entities/verification-application.entity';
import { FacilityMembershipRequest } from '../hospital/entities/facility-membership-request.entity';
import { UsersModule } from '../users/users.module';
import { EncryptionModule } from '../encryption/encryption.module';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'default_secret_key',
      signOptions: { expiresIn: '1h' },
    }),
    TypeOrmModule.forFeature([User, UserSession, VerificationApplication, FacilityMembershipRequest]),
    UsersModule,
    EncryptionModule,
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
