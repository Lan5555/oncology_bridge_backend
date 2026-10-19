import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { FacilityStatus } from '../hospital/entities/hospital.entity';
import { RolePermission } from '../role/entities/role-permission.entity';
import { VerificationApplication } from '../verification_applications/entities/verification-application.entity';
import { InventoryAccessGrant } from './entities/inventory-access-grant.entity';
import { AuditLog } from '../audit_log/entities/audit_log.entity';
import { ResponseHelper } from '../helpers/response-helper';

@Injectable()
export class StockAccessService {
  constructor(private readonly db: DataSource) {}

  isNetworkAdmin(user: User) {
    return [
      'ADMIN',
      'SUPERADMIN',
      'C',
      'NETWORK ADMIN',
      'NETWORK_ADMIN',
      'NETWORK-ADMIN',
    ].includes(user.role?.name.trim().toUpperCase() ?? '');
  }
  async permissions(
    user: User,
    manager: EntityManager = this.db.manager,
  ): Promise<string[]> {
    const grants = user.role
      ? await manager
          .getRepository(RolePermission)
          .findBy({ role_id: user.role.id })
      : [];
    const permissions = new Set(grants.map((g) => g.permission));
    if (
      user.hospital?.id &&
      (await manager
        .getRepository(InventoryAccessGrant)
        .existsBy({ user_id: user.id, facility_id: user.hospital.id }))
    )
      permissions.add('inventory.manage');
    return [...permissions];
  }
  async verifiedMember(user: User, manager: EntityManager = this.db.manager) {
    if (
      !user.active ||
      !user.hospital ||
      user.hospital.status !== FacilityStatus.ACTIVE ||
      user.hospital.deleted_at ||
      user.verification_status !== 'VERIFIED'
    )
      return false;
    const application = await manager
      .getRepository(VerificationApplication)
      .findOne({
        where: { user_id: user.id },
        order: { submitted_at: 'DESC', id: 'DESC' },
      });
    return !application || application.status === 'VERIFIED';
  }
  async assertManage(
    actorId: string,
    facilityId?: string,
    granularPermission?: string,
    manager: EntityManager = this.db.manager,
  ) {
    const user = await manager.getRepository(User).findOne({
      where: { id: actorId },
      relations: { hospital: true, role: true },
    });
    if (!user || !(await this.verifiedMember(user, manager)))
      throw new ForbiddenException(
        'Active, verified facility membership is required for stock management.',
      );
    if (facilityId !== undefined && user.hospital.id !== facilityId)
      throw new ForbiddenException(
        'Stock operations must use your authenticated facility.',
      );
    const permissions = await this.permissions(user, manager);
    if (
      !permissions.includes('inventory.manage') &&
      !(granularPermission && permissions.includes(granularPermission))
    )
      throw new ForbiddenException('Missing permission: inventory.manage');
    return user;
  }

  async setGrant(
    targetId: string,
    enabled: boolean,
    actorId: string,
    ip: string,
  ) {
    return this.db.transaction(async (manager) => {
      const users = manager.getRepository(User);
      const actor = await users.findOne({
        where: { id: actorId },
        relations: { role: true },
      });
      if (!actor?.active || !this.isNetworkAdmin(actor))
        throw new ForbiddenException(
          'Network administration is required to assign stock access.',
        );
      const permissions = await this.permissions(actor, manager);
      if (
        !permissions.includes('admin.access') ||
        !permissions.includes('user.update')
      )
        throw new ForbiddenException(
          'admin.access and user.update permissions are required.',
        );
      // Serialize assignments with other user updates and bind the grant to this membership.
      await users.findOne({
        where: { id: targetId },
        lock: { mode: 'pessimistic_write' },
      });
      const target = await users.findOne({
        where: { id: targetId },
        relations: { hospital: true, role: true },
      });
      if (
        !target?.hospital ||
        target.hospital.status !== FacilityStatus.ACTIVE ||
        target.hospital.deleted_at
      )
        throw new NotFoundException('User must belong to an active facility.');
      const grants = manager.getRepository(InventoryAccessGrant);
      if (enabled)
        await grants.upsert(
          {
            user_id: targetId,
            facility_id: target.hospital.id,
            granted_by: actorId,
          },
          ['user_id', 'facility_id'],
        );
      else
        await grants.delete({
          user_id: targetId,
          facility_id: target.hospital.id,
        });
      await manager.getRepository(AuditLog).save({
        user: { id: actorId } as User,
        action: enabled
          ? 'INVENTORY_ACCESS_GRANTED'
          : 'INVENTORY_ACCESS_REVOKED',
        description: `Individual stock access ${enabled ? 'granted to' : 'revoked from'} ${targetId} at facility ${target.hospital.id}`,
        ip_address: ip || 'unknown',
        object_type: 'user',
        object_id: targetId,
        event_key: null,
      });
      return ResponseHelper.Success(
        'Stock access updated. Refresh the affected user session to reload navigation.',
        {
          userId: targetId,
          facilityId: target.hospital.id,
          individualGrant: enabled,
          sessionRefreshRequired: true,
          permissions: await this.permissions(target, manager),
        },
      );
    });
  }

  async catalogueActor(
    actorId: string,
    permission: string,
    manager: EntityManager = this.db.manager,
  ) {
    const user = await manager.getRepository(User).findOne({
      where: { id: actorId },
      relations: { role: true, hospital: true },
    });
    if (user?.active && this.isNetworkAdmin(user)) {
      const permissions = await this.permissions(user, manager);
      if (
        !permissions.includes('admin.access') ||
        !permissions.includes(permission)
      )
        throw new ForbiddenException(
          `admin.access and ${permission} permissions are required.`,
        );
      return { user, facilityId: null };
    }
    const member = await this.assertManage(
      actorId,
      undefined,
      permission,
      manager,
    );
    return { user: member, facilityId: member.hospital.id };
  }
}
