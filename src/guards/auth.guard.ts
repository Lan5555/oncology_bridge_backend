import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload } from '../helpers/types';
import { Request } from 'express';

interface RequestWithUser extends Request {
  user?: JwtPayload;
}
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();

    const auth = request.headers.authorization;

    if (!auth) {
      throw new UnauthorizedException();
    }

    const [type, token] = auth.split(' ');

    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Invalid authorization format');
    }

    try {
      const payload: JwtPayload = await this.jwtService.verifyAsync(token);

      request.user = payload;

      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
