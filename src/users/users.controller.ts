import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Ip,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuthGuard } from '../guards/auth.guard';
import { FacilityTeamGuard, UserManagementGuard } from '../guards/user-management.guard';
import { FacilityInviteDto } from './dto/facility-invite.dto';

type AdminRequest = Request & { user: { id: string; facilityId?: string } };

@Controller(['users', 'api/users'])
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @UseGuards(AuthGuard, UserManagementGuard)
  findAllApi(
    @Query('take') take?: string,
    @Query('skip') skip?: string,
    @Query('roleId') roleId?: string,
    @Query('facilityId') facilityId?: string,
    @Req() req?: AdminRequest,
  ) {
    return this.usersService.findAllForActor(String(req?.user.id), {
      take: Number(take) || 50,
      skip: Number(skip) || 0,
      roleId: roleId ? Number(roleId) : undefined,
      facilityId,
    });
  }

  @Get(':id') @UseGuards(AuthGuard, UserManagementGuard) findOneApi(
    @Param('id') id: string,
    @Req() req: AdminRequest,
  ) {
    return this.usersService.findOneForActor(id, req.user.id);
  }

  @Post()
  @UseGuards(AuthGuard, FacilityTeamGuard)
  invite(@Body() body: FacilityInviteDto, @Req() req: AdminRequest, @Ip() ip: string) {
    return this.usersService.inviteFacilityUser(body, req.user.id, ip);
  }

  @Post('/api/register-user')
  create(@Body() createUserDto: CreateUserDto, @Ip() ip: string) {
    return this.usersService.createRegular(createUserDto, ip);
  }

  @Get('/api/find-all-users')
  @UseGuards(AuthGuard, UserManagementGuard)
  findAll(@Query('take') take: number, @Query('skip') skip: number, @Req() req: AdminRequest) {
    return this.usersService.findAllForActor(req.user.id, { take: +take, skip: +skip });
  }

  @Get('/api/find-one-user/:id')
  @UseGuards(AuthGuard, UserManagementGuard)
  findOne(@Param('id') id: string, @Req() req: AdminRequest) {
    return this.usersService.findOneForActor(id, req.user.id);
  }

  @Patch('/api/update-one-user/:id')
  @UseGuards(AuthGuard, UserManagementGuard)
  update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @Req() req: AdminRequest,
  ) {
    return this.usersService.updateForActor(id, updateUserDto, req.user.id);
  }

  @Delete(':id')
  @UseGuards(AuthGuard, UserManagementGuard)
  softDelete(@Param('id') id: string, @Req() req: AdminRequest) {
    return this.usersService.updateForActor(id, { is_active: false }, req.user.id);
  }

  @Delete('/api/delete-one-user/:id')
  @UseGuards(AuthGuard, UserManagementGuard)
  remove(@Param('id') id: string, @Req() req: AdminRequest) {
    return this.usersService.updateForActor(
      id,
      { is_active: false },
      req.user.id,
    );
  }
}
