import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload } from '../helpers/types';
import { Request } from 'express';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';

interface RequestWithUser extends Request {
  user?: JwtPayload;
}
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();

    const auth = request.headers.authorization;

    if (!auth) {
      throw new UnauthorizedException();
    }

    const [type, token] = auth.split(' ');

    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Invalid authorization format');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync(token, {
        ...(process.env.JWT_ISSUER ? { issuer: process.env.JWT_ISSUER } : {}),
        ...(process.env.JWT_AUDIENCE ? { audience: process.env.JWT_AUDIENCE } : {}),
      });
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
    const principal = await this.dataSource.getRepository(User).findOne({
      where: { id: String(payload.id) },
      relations: { role: true, hospital: true },
    });
    if (!principal?.active) throw new UnauthorizedException('Account is inactive');
    const isNetworkAdmin = ['ADMIN', 'SUPERADMIN'].includes(
      principal.role?.name?.trim().toUpperCase() ?? '',
    );
    if (!isNetworkAdmin && principal.hospital && (
      principal.hospital.deleted_at ||
      ['PENDING', 'SUSPENDED', 'REJECTED'].includes(principal.hospital.status)
    )) throw new ForbiddenException('Facility account is not active');
    const whitelist = isNetworkAdmin ? [] : (principal.hospital?.ip_whitelist ?? []);
    if (whitelist.length) {
      const callerIp = request.ip?.replace(/^::ffff:/, '');
      if (!callerIp || !whitelist.includes(callerIp))
        throw new ForbiddenException('This network is not permitted for the facility');
    }
    const path = request.path.toLowerCase();
    const limitedPath = path.startsWith('/api/dashboard') || path.startsWith('/api/settings');
    if (!isNetworkAdmin && principal.account_type && principal.verification_status !== 'VERIFIED' && !limitedPath)
      throw new ForbiddenException('License review is pending');
    request.user = {
      ...payload,
      role: principal.role?.name ?? payload.role,
      facilityId: isNetworkAdmin ? undefined : (principal.hospital?.id ?? ''),
    } as JwtPayload;
    return true;
  }
}
