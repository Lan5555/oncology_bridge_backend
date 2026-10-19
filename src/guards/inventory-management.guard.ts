import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { StockAccessService } from './stock-access.service';

type StockRequest = {
  user?: { id: string; facilityId?: string };
  body?: { facilityId?: string; hospitalId?: string };
};
@Injectable()
export class InventoryManagementGuard implements CanActivate {
  constructor(private readonly stock: StockAccessService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<StockRequest>();
    if (!request.user?.id) throw new UnauthorizedException();
    const actor = await this.stock.assertManage(request.user.id);
    // Check both aliases even when the preferred alias was also supplied.
    for (const id of [request.body?.facilityId, request.body?.hospitalId])
      if (id !== undefined && id !== actor.hospital.id)
        await this.stock.assertManage(actor.id, id);
    request.user.facilityId = actor.hospital.id;
    return true;
  }
}
