import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { RolePermission } from '../role/entities/role-permission.entity';
import { VerificationApplication } from '../verification_applications/entities/verification-application.entity';

@Injectable()
export class MedicineCatalogGuard implements CanActivate {
  constructor(private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: { id?: string }; method: string }>();
    if (!request.user?.id) throw new UnauthorizedException();
    const user = await this.dataSource.getRepository(User).findOne({
      where: { id: request.user.id }, relations: { role: true, hospital: true },
    });
    const licensedCatalogUser = user?.role?.name.trim().toUpperCase() === 'PHARMACIST' ||
      user?.account_type?.trim().toUpperCase() === 'PHARMACY_STORE';
    if (!user?.active || !user.role || !licensedCatalogUser || !user.hospital ||
      user.hospital.status !== 'ACTIVE' || user.hospital.deleted_at ||
      user.verification_status !== 'VERIFIED')
      throw new ForbiddenException('An active, verified pharmacist or pharmacy-store account is required');
    const application = await this.dataSource.getRepository(VerificationApplication).findOne({
      where: { user_id: user.id }, order: { submitted_at: 'DESC' },
    });
    if (application && application.status !== 'VERIFIED')
      throw new ForbiddenException('Licence verification is required');
    const permission = request.method === 'DELETE' ? 'medicine.delete' : 'medicine.update';
    const grant = await this.dataSource.getRepository(RolePermission).findOneBy({
      role_id: user.role.id, permission,
    });
    if (!grant) throw new ForbiddenException(`Missing permission: ${permission}`);
    return true;
  }
}
