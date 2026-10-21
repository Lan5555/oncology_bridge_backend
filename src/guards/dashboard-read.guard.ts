import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { StockAccessService } from './stock-access.service';
import { NetworkAdminGuard } from './network-admin.guard';

export type DashboardScope =
  { type: 'network' } | { type: 'facility'; facilityId: string };
export type DashboardRequest = {
  user?: { id: string; facilityId?: string };
  dashboardScope: DashboardScope;
};

@Injectable()
export class DashboardReadGuard implements CanActivate {
  constructor(
    private readonly db: DataSource,
    private readonly stockAccess: StockAccessService,
    private readonly network: NetworkAdminGuard,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<DashboardRequest>();
    if (!request.user?.id) throw new UnauthorizedException();
    const user = await this.db.getRepository(User).findOne({
      where: { id: request.user.id },
      relations: { role: true, hospital: true },
    });
    if (
      user &&
      ['ADMIN', 'SUPERADMIN'].includes(
        user.role?.name.trim().toUpperCase() ?? '',
      )
    ) {
      await this.network.canActivate(context);
      request.dashboardScope = { type: 'network' };
      request.user.facilityId = undefined;
      return true;
    }
    if (!user || !(await this.stockAccess.verifiedMember(user)))
      throw new ForbiddenException(
        'Active, verified facility membership is required for dashboard access',
      );
    if (!(await this.stockAccess.permissions(user)).includes('dashboard.read'))
      throw new ForbiddenException('Missing permission: dashboard.read');
    request.dashboardScope = { type: 'facility', facilityId: user.hospital.id };
    request.user.facilityId = user.hospital.id;
    return true;
  }
}
