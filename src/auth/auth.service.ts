/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthDto } from './dto/auth.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { Repository } from 'typeorm';
import { CoreResponse, ResponseHelper } from '../helpers/response-helper';
import * as bcrypt from 'bcrypt';
import { UserSession } from '../user_sessions/entities/user_session.entity';
import { VerificationApplication } from '../verification_applications/entities/verification-application.entity';
import { FacilityMembershipRequest } from '../hospital/entities/facility-membership-request.entity';
import { EncryptionService } from '../encryption/encryption.service';
import { CleanResponse } from '../helpers/cleanerss';
import { randomUUID } from 'crypto';
import {
  UnauthorizedException,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

@Injectable()
export class AuthService {
  private readonly loginAttempts = new Map<string, number[]>();
  private readonly passwordResets = new Map<
    string,
    { userId: string; expiresAt: number }
  >();
  private jwtIssuerAudience() {
    return {
      ...(process.env.JWT_ISSUER ? { issuer: process.env.JWT_ISSUER } : {}),
      ...(process.env.JWT_AUDIENCE
        ? { audience: process.env.JWT_AUDIENCE }
        : {}),
    };
  }
  constructor(
    private jwtService: JwtService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserSession)
    private readonly userSession: Repository<UserSession>,
    private encryptionService: EncryptionService,
    private readonly usersService: UsersService,
  ) {}

  async loginUser(userDetails: AuthDto, ip = 'unknown'): CoreResponse {
    const now = Date.now();
    const attempts = (this.loginAttempts.get(ip) ?? []).filter(
      (at) => now - at < 15 * 60 * 1000,
    );
    if (attempts.length >= 10)
      throw new HttpException(
        'Too many login attempts. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    attempts.push(now);
    this.loginAttempts.set(ip, attempts);
    const userMail = this.encryptionService.hash(userDetails.email);
    try {
      const user = await this.userRepository.findOne({
        where: {
          email_hash: userMail,
        },
        relations: {
          role: true,
          hospital: true,
        },
      });
      if (!user) {
        return ResponseHelper.Error('Invalid email or password');
      }
      const decryptPassword = await bcrypt.compare(
        userDetails.password,
        user.password_hash,
      );
      if (!decryptPassword) {
        return ResponseHelper.Error('Invalid email or password');
      }
      const isNetworkAdmin = ['ADMIN', 'SUPERADMIN'].includes(
        user.role?.name?.trim().toUpperCase() ?? '',
      );
      const membership = await this.userRepository.manager
        .getRepository(FacilityMembershipRequest)
        .findOne({
          where: { user_id: user.id },
          order: { submitted_at: 'DESC' },
        });
      if (membership?.status === 'PENDING')
        return ResponseHelper.Error(
          'FACILITY_MEMBERSHIP_PENDING: Your request to join this facility is awaiting approval.',
        );
      if (membership?.status === 'REJECTED')
        return ResponseHelper.Error(
          `Your facility membership request was declined. ${membership.reason ?? ''}`.trim(),
        );
      // The latest application is the canonical licence-review state. Keep the
      // denormalized user flag as a fallback for accounts without an application.
      const application = await this.userRepository.manager
        .getRepository(VerificationApplication)
        .findOne({
          where: { user_id: user.id },
          order: { submitted_at: 'DESC' },
        });
      const verificationStatus =
        application?.status ?? user.verification_status;
      if (!isNetworkAdmin && verificationStatus === 'REJECTED')
        return ResponseHelper.Error(
          `Your licence review was not approved. ${application?.reason ?? ''}`.trim(),
        );
      if (!isNetworkAdmin && verificationStatus !== 'VERIFIED')
        return ResponseHelper.Error(
          'Registration is awaiting facility and license review',
        );
      if (!isNetworkAdmin && user.hospital?.status !== 'ACTIVE')
        return ResponseHelper.Error(
          'Registration is awaiting facility and license review',
        );
      if (
        !isNetworkAdmin &&
        (user.hospital?.status === 'SUSPENDED' ||
          user.hospital?.status === 'REJECTED')
      )
        return ResponseHelper.Error('This facility account is not active');
      if (!user.active)
        return ResponseHelper.Error('This account is deactivated');

      // 1. Update mutable state FIRST before stripping properties
      user.last_login = new Date();
      await this.userRepository.save(user);

      const oneMonth = 30 * 24 * 60 * 60 * 1000;
      const email = this.encryptionService.decrypt(user.email);
      const authenticatedUser = await this.usersService.authenticatedUser(
        user.id,
      );

      const payload = {
        id: user.id,
        email,
        role: user.role?.name,
        account_type: authenticatedUser.account_type,
        verification_status: authenticatedUser.verification_status,
        permissions: authenticatedUser.permissions,
        allowed_pages: authenticatedUser.allowed_pages,
        can_manage_facility_users: authenticatedUser.can_manage_facility_users,
        can_manage_inventory: authenticatedUser.can_manage_inventory,
      };

      const accessToken = await this.jwtService.signAsync(payload, {
        expiresIn: '15m',
        ...this.jwtIssuerAudience(),
      });
      const refreshToken = await this.jwtService.signAsync(
        { ...payload, tokenType: 'refresh' },
        { expiresIn: '30d', ...this.jwtIssuerAudience() },
      );

      const userInfo = CleanResponse.cleanWithPassword(user);
      const checkSession = await this.userSession.findOne({
        where: {
          user: {
            id: user.id,
          },
        },
      });
      if (!checkSession) {
        const session = this.userSession.create({
          user: userInfo,
          device_id: userInfo.device_id,
          ip_address: userInfo.allowed_ip,
          expires_at: new Date(Date.now() + oneMonth),
          refresh_token: refreshToken,
        });
        await this.userSession.save(session);
      } else {
        await this.userSession.update(
          { id: checkSession.id },
          {
            refresh_token: refreshToken,
            expires_at: new Date(Date.now() + oneMonth),
            device_id: user.device_id ?? '',
            ip_address: user.allowed_ip ?? '',
          },
        );
      }

      return ResponseHelper.Success<{
        user: Record<string, unknown>;
        token: string;
        refreshToken: string;
      }>('Login successful', {
        user: authenticatedUser,
        token: accessToken,
        refreshToken,
      });
    } catch (error: any) {
      return ResponseHelper.Error(error);
    }
  }

  async refreshToken(token: string) {
    if (!token) throw new UnauthorizedException('Refresh token is required');
    let payload: any;
    try {
      payload = await this.jwtService.verifyAsync(
        token,
        this.jwtIssuerAudience(),
      );
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (payload.tokenType !== 'refresh')
      throw new UnauthorizedException('A refresh token is required');
    const session = await this.userSession.findOne({
      where: { refresh_token: token },
      relations: { user: { role: true, hospital: true } },
    });
    if (!session || session.expires_at <= new Date() || !session.user.active)
      throw new UnauthorizedException('Session expired or revoked');
    const authenticatedUser = await this.usersService.authenticatedUser(
      session.user.id,
    );
    const nextPayload = {
      id: session.user.id,
      email: payload.email,
      role: session.user.role?.name,
      account_type: authenticatedUser.account_type,
      verification_status: authenticatedUser.verification_status,
      permissions: authenticatedUser.permissions,
      allowed_pages: authenticatedUser.allowed_pages,
      can_manage_facility_users: authenticatedUser.can_manage_facility_users,
      can_manage_inventory: authenticatedUser.can_manage_inventory,
    };
    const next = await this.jwtService.signAsync(nextPayload, {
      expiresIn: '15m',
      ...this.jwtIssuerAudience(),
    });
    const nextRefresh = await this.jwtService.signAsync(
      { ...nextPayload, tokenType: 'refresh' },
      { expiresIn: '30d', ...this.jwtIssuerAudience() },
    );
    session.refresh_token = nextRefresh;
    session.expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await this.userSession.save(session);
    return ResponseHelper.Success('Session refreshed', {
      user: authenticatedUser,
      token: next,
      refreshToken: nextRefresh,
      expiresIn: 900,
    });
  }

  async forgotPassword(email: string) {
    if (!email) throw new BadRequestException('Email is required');
    const user = await this.userRepository.findOneBy({
      email_hash: this.encryptionService.hash(email),
    });
    if (!user)
      return ResponseHelper.Success(
        'If the account exists, reset instructions have been queued',
        { emailQueued: true },
      );
    const resetToken = randomUUID();
    this.passwordResets.set(resetToken, {
      userId: user.id,
      expiresAt: Date.now() + 15 * 60 * 1000,
    });
    return ResponseHelper.Success(
      'Password reset instructions queued by demo email adapter',
      {
        emailQueued: true,
        ...(process.env.NODE_ENV === 'production'
          ? {}
          : { demoResetToken: resetToken }),
      },
    );
  }

  async resetPassword(token: string, password: string) {
    const reset = this.passwordResets.get(token);
    if (!reset || reset.expiresAt < Date.now())
      throw new BadRequestException('Invalid or expired reset token');
    if (!password || password.length < 8)
      throw new BadRequestException('Password must be at least 8 characters');
    const user = await this.userRepository.findOneBy({ id: reset.userId });
    if (!user) throw new BadRequestException('Invalid or expired reset token');
    user.password_hash = this.encryptionService.hashPassword(password);
    await this.userRepository.save(user);
    this.passwordResets.delete(token);
    await this.userSession.update(
      { user: { id: user.id } },
      { refresh_token: '' },
    );
    return ResponseHelper.Success(
      'Password reset; existing sessions revoked',
      null,
    );
  }

  async logUserOut(id: string) {
    try {
      await this.userSession.update(
        { user: { id: id } },
        {
          refresh_token: '',
        },
      );
      return ResponseHelper.Success('User logged out successfully.', null);
    } catch (error) {
      return ResponseHelper.Error(error, null);
    }
  }

  pingServer() {
    return ResponseHelper.Success('Loaded Successdully', null);
  }
}
