import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Role } from '../../helpers/types';

@Injectable()
export class PharmacistGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { role: Role } }>();
    const { user } = request;
    if (user?.role !== 'PHARMACIST') {
      throw new UnauthorizedException('Pharmacists Only');
    }
    return true;
  }
}
