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
import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './dto/create-user.dto';

class UpdateMeDto extends PartialType(CreateUserDto) {}

type AuthenticatedRequest = Request & { user?: { id: string } };
@UseGuards(AuthGuard)
@Controller('api/me')
export class MeController {
  constructor(private readonly users: UsersService) {}
  @Get() me(@Req() req: AuthenticatedRequest) {
    return this.users.findOneUser(String(req.user?.id));
  }
  @Patch() async update(@Req() req: AuthenticatedRequest, @Body() body: UpdateMeDto) {
    const id = String(req.user?.id);
    await this.users.update(id, body);
    return this.users.findOneUser(id);
  }
  @Post('verification/resubmit') async resubmit(@Req() req: AuthenticatedRequest) {
    return {
      success: true,
      message:
        'Registry lookup is mocked until MDCN/PCN credentials are configured',
      data: {
        user: await this.users.authenticatedUser(String(req.user?.id)),
        status: 'MANUAL_REVIEW',
        registryResult: 'UNAVAILABLE',
        demo: true,
      },
    };
  }
}
