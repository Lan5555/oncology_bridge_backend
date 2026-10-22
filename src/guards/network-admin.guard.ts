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

@Injectable()
export class NetworkAdminGuard implements CanActivate {
  constructor(private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user?: { id?: string; mfa?: boolean; amr?: string[] };
      method: string;
      path: string;
    }>();
    if (!request.user?.id) throw new UnauthorizedException();
    const user = await this.dataSource.getRepository(User).findOne({
      where: { id: request.user.id },
      relations: { role: true },
    });
    const role = user?.role?.name.trim().toLowerCase();
    if (
      !user?.active ||
      ![
        'admin',
        'c',
        'network admin',
        'network_admin',
        'network-admin',
        'superadmin',
      ].includes(role ?? '')
    )
      throw new ForbiddenException('Network Admin role required');
    const permission = this.requiredPermission(request.method, request.path);
    const permissionRepo = this.dataSource.getRepository(RolePermission);
    const grants = await permissionRepo.findBy({ role_id: user.role.id });
    const assigned = new Set(grants.map((grant) => grant.permission));
    const rolePermissionsEndpoint =
      /^\/(?:api\/roles|role)\/[^/]+\/permissions\/?$/i.test(request.path);
    // role.update remains supported for existing administrators. role.manage
    // authorizes viewing and replacing grants, without bypassing network/MFA checks.
    const canManageRolePermissions =
      rolePermissionsEndpoint &&
      ['GET', 'PUT'].includes(request.method) &&
      assigned.has('role.manage');
    const legacyRoleUpdate =
      rolePermissionsEndpoint &&
      request.method === 'PUT' &&
      assigned.has('role.update');
    if (
      !assigned.has('admin.access') ||
      !(
        assigned.has(permission) ||
        canManageRolePermissions ||
        legacyRoleUpdate
      )
    )
      throw new ForbiddenException(
        `Missing permission: ${!assigned.has('admin.access') ? 'admin.access' : permission}`,
      );
    if (
      process.env.ADMIN_MFA_REQUIRED === 'true' &&
      request.user.mfa !== true &&
      !request.user.amr?.includes('mfa')
    )
      throw new ForbiddenException(
        'MFA is required for network administration',
      );
    return true;
  }

  private requiredPermission(method: string, path: string): string {
    const p = path.toLowerCase();
    if (p.startsWith('/api/reports')) return 'report.export';
    if (
      method === 'PUT' &&
      /^\/(?:api\/roles|role)\/[^/]+\/permissions\/?$/.test(p)
    )
      return 'role.manage';
    if (
      method === 'POST' &&
      /^\/api\/facility-membership-requests\/[^/]+\/license-lookup\/?$/.test(p)
    )
      return 'verification.decide';
    if (method === 'GET') {
      const reads: Record<string, string> = {
        '/api/medicines': 'medicine.read',
        '/medicine': 'medicine.read',
        '/api/inventory': 'inventory.read',
        '/api/expiry': 'inventory.read',
        '/api/stock': 'inventory.read',
        '/admin/api/marketplace/listings': 'marketplace.read',
        '/api/prescriptions': 'prescription.read',
        '/api/invoices': 'invoice.read',
        '/api/transfers': 'transfer.read',
        '/transfer-requests': 'transfer.read',
        '/api/scans': 'scan.read',
        '/scan-log': 'scan.read',
        '/api/storage-units': 'coldchain.read',
        '/api/cold-chain-events': 'coldchain.read',
        '/api/coldchain': 'coldchain.read',
        '/api/network': 'network.read',
        '/api/research/inquiries': 'research.read',
      };
      for (const [prefix, permission] of Object.entries(reads))
        if (p === prefix || p.startsWith(`${prefix}/`)) return permission;
    }
    if (p.startsWith('/admin/api/verifications'))
      return method === 'GET' ? 'verification.read' : 'verification.decide';
    if (p.startsWith('/admin/api/integrations')) {
      if (p.endsWith('/sync')) return 'integration.sync';
      if (p.endsWith('/test') || p.endsWith('/configuration'))
        return method === 'GET' ? 'integration.manage' : 'integration.manage';
      return 'integration.read';
    }
    if (p.startsWith('/api/dashboard')) return 'dashboard.read';
    if (p.startsWith('/api/settlements')) return 'settlement.read';
    if (p.startsWith('/api/audit') || p.startsWith('/audit-log'))
      return p.endsWith('/export.csv') ? 'audit.export' : 'audit.read';
    if (p.startsWith('/api/roles') || p.startsWith('/role'))
      return method === 'GET' ? 'role.read' : 'role.update';
    if (p.startsWith('/api/users') || p.startsWith('/users'))
      return method === 'GET' ? 'user.read' : 'user.update';
    if (
      p.startsWith('/hospital/api') ||
      p.startsWith('/api/facilities') ||
      p.startsWith('/api/network')
    ) {
      if (method === 'GET') return 'facility.read';
      if (method === 'DELETE') return 'facility.delete';
      return 'facility.update';
    }
    return 'admin.access';
  }
}
