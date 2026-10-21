import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

@Injectable()
export class RoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user?: {
        role: string;
      };
    }>();

    const { user } = request;

    if (
      user?.role === 'ADMIN' ||
      user?.role === 'FACILITY_ADMIN' ||
      user?.role === 'PHARMACIST' ||
      user?.role === 'ONCOLOGIST' ||
      user?.role === 'SUPERADMIN'
    ) {
      return true;
    }

    throw new UnauthorizedException(
      'User not authenticated or does not have the required role',
    );
  }
}
