import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Role } from '../../helpers/types';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { role: Role } }>();
    const { user } = request;
    if (user?.role !== 'SUPERADMIN') {
      throw new UnauthorizedException('Super Admins Only');
    }
    return true;
  }
}
