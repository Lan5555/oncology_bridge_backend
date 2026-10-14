import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Param,
  UseGuards,
  ForbiddenException,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { AuthDto } from './dto/auth.dto';
import { AuthGuard } from '../guards/auth.guard';

type RequestWithUser = Request & { user?: { id: string } };

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}
  @Post('/api/login')
  async login(@Body() body: AuthDto) {
    return this.authService.loginUser(body);
  }
  @Post('/api/refresh') refresh(
    @Body() body: { token?: string; refreshToken?: string },
  ) {
    return this.authService.refreshToken(body.refreshToken ?? body.token ?? '');
  }
  @Post('/api/forgot-password') forgotPassword(
    @Body() body: { email: string },
  ) {
    return this.authService.forgotPassword(body.email);
  }
  @Post('/api/reset-password') resetPassword(
    @Body() body: { token: string; password: string },
  ) {
    return this.authService.resetPassword(body.token, body.password);
  }
  @Get('/api/log-out')
  @UseGuards(AuthGuard)
  async logout(@Query('id') id: string, @Req() req: RequestWithUser) {
    if (String(req.user?.id) !== String(id))
      throw new ForbiddenException('You can only revoke your own session');
    return this.authService.logUserOut(id);
  }
  @Get('/api/log-out/:id')
  @UseGuards(AuthGuard)
  async logoutById(@Param('id') id: string, @Req() req: RequestWithUser) {
    if (String(req.user?.id) !== String(id))
      throw new ForbiddenException('You can only revoke your own session');
    return this.authService.logUserOut(id);
  }
  @Get('/api/ping-server')
  pingServer() {
    return this.authService.pingServer();
  }
}
