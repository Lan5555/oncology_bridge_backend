import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UseGuards,
  Ip,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../guards/auth.guard';
import { UsersService } from './users.service';
import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './dto/create-user.dto';
import { ResubmitVerificationDto } from './dto/resubmit-verification.dto';

class UpdateMeDto extends PartialType(CreateUserDto) {}

type AuthenticatedRequest = Request & { user?: { id: string } };
@Controller('api/me')
export class MeController {
  constructor(private readonly users: UsersService) {}
  @Get() @UseGuards(AuthGuard) me(@Req() req: AuthenticatedRequest) {
    return this.users.findOneUser(String(req.user?.id));
  }
  @Patch() @UseGuards(AuthGuard) async update(
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdateMeDto,
  ) {
    const id = String(req.user?.id);
    await this.users.update(id, body);
    return this.users.findOneUser(id);
  }
  @Post('verification/resubmit') async resubmit(
    @Body() body: ResubmitVerificationDto,
    @Ip() ip: string,
  ) {
    return this.users.resubmitVerification(body, ip);
  }
}
