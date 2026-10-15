import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from './entities/role.entity';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { ResponseHelper } from '../helpers/response-helper';
import { RolePermission } from './entities/role-permission.entity';
import { AuditLog } from '../audit_log/entities/audit_log.entity';
import { User } from '../users/entities/user.entity';
import { DataSource } from 'typeorm';

const AVAILABLE_PERMISSIONS = [
  'facility.read', 'facility.update', 'facility.delete', 'user.read', 'user.update',
  'role.read', 'role.update', 'verification.read', 'verification.decide',
  'audit.read', 'audit.export', 'settlement.read', 'integration.read',
  'dashboard.read', 'admin.access', 'integration.manage', 'integration.sync',
  'medicine.update', 'medicine.delete',
  'facility.users.manage',
];

@Injectable()
export class RoleService {
  constructor(
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(RolePermission) private readonly grants: Repository<RolePermission>,
    private readonly dataSource: DataSource,
  ) {}
  async audit(actorId: string, action: string, description: string) {
    await this.grants.manager.getRepository(AuditLog).save({
      user: { id: actorId } as User, action, description,
      ip_address: 'admin-api', event_key: null,
    });
  }
  async create(dto: CreateRoleDto, actorId: string) {
    const role = await this.roles.save(this.roles.create(dto));
    await this.audit(actorId, 'ROLE_CREATED', `Role ${role.id} created`);
    return ResponseHelper.Success('Role created', role);
  }
  async findAll() {
    const rows = await this.roles.find({ relations: { users: true }, order: { id: 'ASC' } });
    const permissions = await this.grants.find();
    return ResponseHelper.Success(
      'Roles retrieved',
      rows.map(({ users, ...role }) => ({
        ...role,
        userCount: users?.length ?? 0,
        permissions: permissions.filter((p) => p.role_id === role.id).map((p) => p.permission),
      })),
    );
  }
  async findOne(id: number) {
    const role = await this.roles.findOne({
      where: { id },
      relations: { users: true },
    });
    if (!role) throw new NotFoundException('Role not found');
    const { users, ...safeRole } = role;
    const grants = await this.grants.findBy({ role_id: id });
    return ResponseHelper.Success('Role retrieved', {
      ...safeRole, userCount: users?.length ?? 0,
      permissions: grants.map((grant) => grant.permission),
    });
  }
  async update(id: number, dto: UpdateRoleDto, actorId: string) {
    const role = await this.roles.findOneBy({ id });
    if (!role) throw new NotFoundException('Role not found');
    Object.assign(role, dto);
    const saved = await this.roles.save(role);
    await this.audit(actorId, 'ROLE_UPDATED', `Role ${id} updated`);
    return ResponseHelper.Success('Role updated', saved);
  }
  async remove(id: number, actorId: string) {
    const role = await this.roles.findOne({
      where: { id },
      relations: { users: true },
    });
    if (!role) throw new NotFoundException('Role not found');
    if (role.users?.length) throw new ConflictException('Role is assigned to users and cannot be deleted');
    if (['c', 'admin', 'network_admin', 'network admin', 'superadmin'].includes(role.name.trim().toLowerCase()))
      throw new ForbiddenException('The network administrator role cannot be deleted');
    await this.roles.remove(role);
    await this.audit(actorId, 'ROLE_DELETED', `Role ${id} deleted`);
    return ResponseHelper.Success('Role deleted', null);
  }

  async permissions(id: number) {
    await this.findRole(id);
    const permissions = (await this.grants.findBy({ role_id: id })).map((p) => p.permission);
    return ResponseHelper.Success('Role permissions retrieved', { permissions, availablePermissions: AVAILABLE_PERMISSIONS });
  }

  async setPermissions(id: number, requested: string[], actorId: string) {
    const role = await this.findRole(id);
    if (!Array.isArray(requested) || requested.some((p) => !AVAILABLE_PERMISSIONS.includes(p)))
      throw new ConflictException('One or more permissions are not assignable');
    const permissions = [...new Set(requested)];
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(RolePermission);
      await repo.delete({ role_id: id });
      if (permissions.length) await repo.save(permissions.map((permission) => repo.create({ role, role_id: id, permission })));
      await manager.getRepository(AuditLog).save({
        user: { id: actorId } as User, action: 'ROLE_PERMISSIONS_UPDATED',
        description: `Permissions updated for role ${id}`, ip_address: 'admin-api', event_key: null,
      });
    });
    return ResponseHelper.Success('Role permissions updated', { roleId: id, permissions, availablePermissions: AVAILABLE_PERMISSIONS });
  }

  private async findRole(id: number) {
    const role = await this.roles.findOneBy({ id });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }
}
