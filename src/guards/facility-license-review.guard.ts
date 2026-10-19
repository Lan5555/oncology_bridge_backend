import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { NetworkAdminGuard } from './network-admin.guard';
import { FacilityTeamGuard } from './user-management.guard';

@Injectable()
export class FacilityLicenseReviewGuard implements CanActivate {
  constructor(
    private readonly network: NetworkAdminGuard,
    private readonly facility: FacilityTeamGuard,
  ) {}
  canActivate(context: ExecutionContext) {
    const role = context
      .switchToHttp()
      .getRequest<{ user?: { role?: string } }>()
      .user?.role?.trim()
      .toUpperCase();
    return ['ADMIN', 'SUPERADMIN'].includes(role ?? '')
      ? this.network.canActivate(context)
      : this.facility.canActivate(context);
  }
}
