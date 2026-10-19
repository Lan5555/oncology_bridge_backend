import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { StockAccessService } from './stock-access.service';
import { NetworkAdminGuard } from './network-admin.guard';

@Injectable()
export class MedicineCatalogGuard implements CanActivate {
  constructor(
    private readonly stock: StockAccessService,
    private readonly network: NetworkAdminGuard,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user?: { id: string; facilityId?: string };
      method: string;
    }>();
    if (!request.user?.id) throw new UnauthorizedException();
    const permission =
      request.method === 'POST'
        ? 'medicine.create'
        : request.method === 'DELETE'
          ? 'medicine.delete'
          : 'medicine.update';
    const actor = await this.stock.catalogueActor(request.user.id, permission);
    if (actor.facilityId === null) await this.network.canActivate(context);
    else request.user.facilityId = actor.facilityId;
    return true;
  }
}
