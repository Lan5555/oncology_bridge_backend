import {
  ForbiddenException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { FacilityStatus } from '../hospital/entities/hospital.entity';
import { RolePermission } from '../role/entities/role-permission.entity';
import { VerificationApplication } from '../verification_applications/entities/verification-application.entity';
import { ResponseHelper } from '../helpers/response-helper';
import { OperationalQueryDto } from './operational-query.dto';
import {
  OperationalResource,
  READ_DEFINITIONS,
  READ_PERMISSIONS,
} from './operational-resources';

@Injectable()
export class OperationalReadsService {
  constructor(private readonly db: DataSource) {}
  async list(
    resource: OperationalResource,
    actorId: string | number | undefined,
    query: OperationalQueryDto,
  ) {
    try {
      const actor =
        actorId === undefined
          ? null
          : await this.db.getRepository(User).findOne({
              where: { id: String(actorId) },
              relations: { role: true, hospital: true },
            });
      if (!actor?.active)
        throw new ForbiddenException(
          'An active authenticated account is required.',
        );
      const network = ['ADMIN', 'SUPERADMIN'].includes(
        actor.role?.name.trim().toUpperCase() ?? '',
      );
      const definition = READ_DEFINITIONS[resource];
      if (network) {
        const grants = await this.db
          .getRepository(RolePermission)
          .findBy({ role_id: actor.role.id });
        const permissions = new Set(grants.map((g) => g.permission));
        if (
          !permissions.has('admin.access') ||
          !permissions.has(READ_PERMISSIONS[resource])
        )
          throw new ForbiddenException(
            `Missing permission: ${!permissions.has('admin.access') ? 'admin.access' : READ_PERMISSIONS[resource]}`,
          );
      } else {
        if (definition.networkOnly)
          throw new ForbiddenException(
            'This operational list requires network administration.',
          );
        if (
          !actor.hospital ||
          actor.hospital.status !== FacilityStatus.ACTIVE ||
          actor.hospital.deleted_at ||
          actor.verification_status !== 'VERIFIED'
        )
          throw new ForbiddenException(
            'Active, verified facility membership is required.',
          );
        const application = await this.db
          .getRepository(VerificationApplication)
          .findOne({
            where: { user_id: actor.id },
            order: { submitted_at: 'DESC', id: 'DESC' },
          });
        if (application && application.status !== 'VERIFIED')
          throw new ForbiddenException('Licence verification is required.');
        if (query.facilityId && query.facilityId !== actor.hospital.id)
          throw new ForbiddenException(
            'You cannot read another facility operational records.',
          );
      }
      const values: unknown[] = [];
      const add = (value: unknown) => {
        values.push(value);
        return `$${values.length}`;
      };
      const where = [definition.where ?? 'true'];
      if (
        (resource === 'inventory' || resource === 'expiry') &&
        !query.includeDeletedMedicines
      )
        where.push('m.deleted_at IS NULL');
      if (!network) where.push(definition.scope(add(actor.hospital.id)));
      else if (query.facilityId)
        where.push(definition.scope(add(query.facilityId)));
      if (query.q?.trim())
        where.push(
          `${definition.search} ILIKE ${add(`%${query.q.trim().replace(/[\\%_]/g, '\\$&')}%`)}`,
        );
      if (resource === 'expiry')
        where.push(
          `i.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE+${add(query.withinDays ?? 60)}::int AND i.status NOT IN ('QUARANTINED','DISPOSED','RECALLED')`,
        );
      if (resource === 'inventory') {
        if (query.category === 'expiry')
          where.push('i.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE+60');
        if (query.category === 'quarantine')
          where.push("i.status='QUARANTINED'");
        if (query.category === 'redistributed')
          where.push("i.status='REDISTRIBUTED'");
      }
      const statusColumn = {
        marketplace: 'l.status',
        inventory: 'i.status',
        transfers: 't.status',
        events: 'e.state',
        network: 'h.status',
        invoices: 'x.status',
      };
      if (query.status && resource in statusColumn)
        where.push(
          `${statusColumn[resource as keyof typeof statusColumn]}=${add(query.status.toUpperCase())}`,
        );
      if (resource === 'prescriptions') {
        if (query.tab === 'awaiting') where.push("p.auth_status='Pending'");
        if (query.tab === 'completed')
          where.push("p.order_stage IN ('Delivered','Dispensed')");
        if (query.tab === 'active')
          where.push("p.order_stage NOT IN ('Delivered','Dispensed')");
      }
      if (resource === 'events') {
        if (query.unitId) where.push(`e.unit_id=${add(query.unitId)}`);
        if (query.from) where.push(`e.at>=${add(query.from)}::timestamptz`);
        if (query.to) where.push(`e.at<=${add(query.to)}::timestamptz`);
      }
      const base = `FROM ${definition.from} WHERE ${where.join(' AND ')}`;
      const page = query.page ?? 1,
        limit = Math.min(100, query.limit ?? 25);
      return await this.db.transaction('REPEATABLE READ', async (manager) => {
        const [count] = await manager.query<{ total: number }[]>(
          `SELECT count(*)::int total ${base}`,
          values,
        );
        const items = await manager.query<Record<string, unknown>[]>(
          `SELECT ${definition.select} ${base}
          ORDER BY ${definition.order} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
          [...values, limit, (page - 1) * limit],
        );
        return ResponseHelper.Success('', {
          items,
          total: count.total,
          page,
          limit,
        });
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        `The ${resource} list is currently unavailable. Check database migrations and connectivity.`,
      );
    }
  }
}
