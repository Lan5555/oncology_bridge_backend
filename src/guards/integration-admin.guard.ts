import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';

@Injectable()
export class IntegrationAdminGuard implements CanActivate {
  constructor(private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { id?: string } }>();
    if (!request.user?.id) throw new UnauthorizedException();
    const user = await this.dataSource.getRepository(User).findOne({
      where: { id: request.user.id },
      relations: { role: true },
    });
    if (
      !user?.active ||
      !['ADMIN', 'SUPERADMIN'].includes(
        user.role?.name.trim().toUpperCase() ?? '',
      )
    )
      throw new ForbiddenException('ADMIN or SUPERADMIN role required');
    return true;
  }
}
