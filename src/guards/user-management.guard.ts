import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { RolePermission } from '../role/entities/role-permission.entity';
import { VerificationApplication } from '../verification_applications/entities/verification-application.entity';

type ManagedRequest = {
  user?: { id?: string; mfa?: boolean; amr?: string[]; facilityId?: string };
  method: string;
  path: string;
};

@Injectable()
export class UserManagementGuard implements CanActivate {
  constructor(private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ManagedRequest>();
    const actorId = req.user?.id;
    if (!actorId) throw new UnauthorizedException();
    const actor = await this.dataSource.getRepository(User).findOne({
      where: { id: actorId },
      relations: { role: true, hospital: true },
    });
    if (!actor?.active || !actor.role)
      throw new ForbiddenException('Active account required');
    const roleName = actor.role.name.trim().toUpperCase();
    const grants = await this.dataSource
      .getRepository(RolePermission)
      .findBy({ role_id: actor.role.id });
    const assigned = new Set(grants.map((grant) => grant.permission));

    if (
      [
        'ADMIN',
        'SUPERADMIN',
        'C',
        'NETWORK ADMIN',
        'NETWORK_ADMIN',
        'NETWORK-ADMIN',
      ].includes(roleName)
    ) {
      const permission = req.method === 'GET' ? 'user.read' : 'user.update';
      if (!assigned.has('admin.access') || !assigned.has(permission))
        throw new ForbiddenException(
          `Missing permission: ${!assigned.has('admin.access') ? 'admin.access' : permission}`,
        );
      if (
        process.env.ADMIN_MFA_REQUIRED === 'true' &&
        req.user?.mfa !== true &&
        !req.user?.amr?.includes('mfa')
      )
        throw new ForbiddenException(
          'MFA is required for network administration',
        );
      return true;
    }

    if (
      roleName !== 'FACILITY_ADMIN' ||
      !actor.hospital ||
      actor.hospital.status !== 'ACTIVE' ||
      actor.hospital.deleted_at ||
      actor.verification_status !== 'VERIFIED' ||
      !assigned.has('facility.users.manage')
    )
      throw new ForbiddenException(
        'facility.users.manage permission is required',
      );
    const application = await this.dataSource
      .getRepository(VerificationApplication)
      .findOne({
        where: { user_id: actor.id },
        order: { submitted_at: 'DESC' },
      });
    if ((application?.status ?? actor.verification_status) !== 'VERIFIED')
      throw new ForbiddenException(
        'Facility administrator licence approval is required',
      );
    req.user!.facilityId = actor.hospital.id;
    return true;
  }
}

@Injectable()
export class FacilityTeamGuard implements CanActivate {
  constructor(private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ManagedRequest>();
    if (!req.user?.id) throw new UnauthorizedException();
    const actor = await this.dataSource.getRepository(User).findOne({
      where: { id: req.user.id },
      relations: { role: true, hospital: true },
    });
    if (
      !actor?.active ||
      actor.role?.name.trim().toUpperCase() !== 'FACILITY_ADMIN' ||
      !actor.hospital ||
      actor.hospital.status !== 'ACTIVE' ||
      actor.hospital.deleted_at ||
      actor.verification_status !== 'VERIFIED'
    )
      throw new ForbiddenException(
        'Active facility administrator access is required',
      );
    const grant = await this.dataSource
      .getRepository(RolePermission)
      .findOneBy({
        role_id: actor.role.id,
        permission: 'facility.users.manage',
      });
    if (!grant)
      throw new ForbiddenException('Missing permission: facility.users.manage');
    const application = await this.dataSource
      .getRepository(VerificationApplication)
      .findOne({
        where: { user_id: actor.id },
        order: { submitted_at: 'DESC' },
      });
    if ((application?.status ?? actor.verification_status) !== 'VERIFIED')
      throw new ForbiddenException(
        'Facility administrator licence approval is required',
      );
    req.user.facilityId = actor.hospital.id;
    return true;
  }
}
