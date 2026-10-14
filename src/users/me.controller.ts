import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../guards/auth.guard';
import { UsersService } from './users.service';

type AuthenticatedRequest = Request & { user?: { id: string } };
@UseGuards(AuthGuard)
@Controller('api/me')
export class MeController {
  constructor(private readonly users: UsersService) {}
  @Get() me(@Req() req: AuthenticatedRequest) {
    return this.users.findOneUser(String(req.user?.id));
  }
  @Patch() update(@Req() req: AuthenticatedRequest, @Body() body: any) {
    return this.users.update(String(req.user?.id), body);
  }
  @Post('verification/resubmit') resubmit() {
    return {
      success: true,
      message:
        'Registry lookup is mocked until MDCN/PCN credentials are configured',
      data: {
        status: 'MANUAL_REVIEW',
        registryResult: 'UNAVAILABLE',
        demo: true,
      },
    };
  }
}
