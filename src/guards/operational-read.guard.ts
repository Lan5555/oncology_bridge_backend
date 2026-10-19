import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { NetworkAdminGuard } from './network-admin.guard';

@Injectable()
export class OperationalReadGuard implements CanActivate {
  constructor(private readonly network: NetworkAdminGuard) {}
  async canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<{ method: string; user?: { role?: string } }>();
    if (
      request.method === 'GET' &&
      ['ADMIN', 'SUPERADMIN'].includes(
        request.user?.role?.trim().toUpperCase() ?? '',
      )
    )
      return this.network.canActivate(context);
    return true;
  }
}
