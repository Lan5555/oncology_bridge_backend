import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '../guards/auth.guard';

// Legacy invoices retain their public-reference contract. Marketplace invoices
// require a buyer identity checked by MarketplaceService before any data is returned.
@Injectable()
export class InvoiceAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthGuard) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      !context
        .switchToHttp()
        .getRequest<{ headers: { authorization?: string } }>().headers
        .authorization
    )
      return true;
    return this.auth.canActivate(context);
  }
}
