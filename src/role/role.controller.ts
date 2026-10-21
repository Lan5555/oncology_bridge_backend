import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  Put,
} from '@nestjs/common';
import { Request } from 'express';
import { ArrayUnique, IsArray, IsString } from 'class-validator';
import { AuthGuard } from '../guards/auth.guard';
import { NetworkAdminGuard } from '../guards/network-admin.guard';
import { RoleService } from './role.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { SystemRolePermissionsGuard } from './system-role-permissions.guard';

type AdminRequest = Request & { user: { id: string } };
class RolePermissionsDto {
  @IsArray() @ArrayUnique() @IsString({ each: true }) permissions!: string[];
}

@Controller(['role', 'api/roles'])
@UseGuards(AuthGuard, NetworkAdminGuard, SystemRolePermissionsGuard)
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Post()
  create(@Body() createRoleDto: CreateRoleDto, @Req() req: AdminRequest) {
    return this.roleService.create(createRoleDto, req.user.id);
  }

  @Get()
  findAll() {
    return this.roleService.findAll();
  }

  @Get(':id/permissions') permissions(@Param('id') id: string) {
    return this.roleService.permissions(+id);
  }

  @Put(':id/permissions') setPermissions(
    @Param('id') id: string,
    @Body() body: RolePermissionsDto,
    @Req() req: AdminRequest,
  ) {
    return this.roleService.setPermissions(+id, body.permissions, req.user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.roleService.findOne(+id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateRoleDto: UpdateRoleDto,
    @Req() req: AdminRequest,
  ) {
    return this.roleService.update(+id, updateRoleDto, req.user.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: AdminRequest) {
    return this.roleService.remove(+id, req.user.id);
  }
}
