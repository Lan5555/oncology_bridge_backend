import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Role } from '../../helpers/types';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { role: Role } }>();
    const { user } = request;
    if (
      user?.role !== 'ADMIN' &&
      user?.role !== 'FACILITY_ADMIN' &&
      user?.role !== 'SUPERADMIN'
    ) {
      throw new UnauthorizedException('Admins Only');
    }
    return true;
  }
}
