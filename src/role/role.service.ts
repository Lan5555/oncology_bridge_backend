import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from './entities/role.entity';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { ResponseHelper } from '../helpers/response-helper';

@Injectable()
export class RoleService {
  constructor(
    @InjectRepository(Role) private readonly roles: Repository<Role>,
  ) {}
  async create(dto: CreateRoleDto) {
    const role = await this.roles.save(this.roles.create(dto));
    return ResponseHelper.Success('Role created', role);
  }
  async findAll() {
    const rows = await this.roles.find({
      relations: { users: true },
      order: { id: 'ASC' },
    });
    return ResponseHelper.Success(
      'Roles retrieved',
      rows.map(({ users, ...r }) => ({ ...r, userCount: users?.length ?? 0 })),
    );
  }
  async findOne(id: number) {
    const role = await this.roles.findOne({
      where: { id },
      relations: { users: true },
    });
    if (!role) throw new NotFoundException('Role not found');
    return ResponseHelper.Success('Role retrieved', {
      ...role,
      userCount: role.users?.length ?? 0,
    });
  }
  async update(id: number, dto: UpdateRoleDto) {
    const role = await this.roles.findOneBy({ id });
    if (!role) throw new NotFoundException('Role not found');
    Object.assign(role, dto);
    return ResponseHelper.Success('Role updated', await this.roles.save(role));
  }
  async remove(id: number) {
    const role = await this.roles.findOne({
      where: { id },
      relations: { users: true },
    });
    if (!role) throw new NotFoundException('Role not found');
    if (role.users?.length)
      return ResponseHelper.Error(
        'Role is assigned to users and cannot be deleted',
        null,
      );
    await this.roles.remove(role);
    return ResponseHelper.Success('Role deleted', null);
  }
}
