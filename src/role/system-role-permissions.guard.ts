import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { assertRolePermissionsMutable } from './system-role-policy';

@Injectable()
export class SystemRolePermissionsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      method: string;
      params: { id?: string };
      body?: unknown;
    }>();
    // Run before DTO validation so alternate role updates containing permissions
    // receive the same forbidden response, including empty/null assignments.
    if (
      ['PUT', 'PATCH', 'POST'].includes(request.method) &&
      request.body !== null &&
      typeof request.body === 'object' &&
      Object.prototype.hasOwnProperty.call(request.body, 'permissions')
    )
      assertRolePermissionsMutable(Number(request.params.id));
    return true;
  }
}
