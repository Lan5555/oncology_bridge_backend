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
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('/api/register-user')
  create(@Body() createUserDto: CreateUserDto, @Ip() ip: string) {
    return this.usersService.createRegular(createUserDto, ip);
  }

  @Get('/api/find-all-users')
  findAll(@Query('take') take: number, @Query('skip') skip: number) {
    return this.usersService.findAll({ take: +take, skip: +skip });
  }

  @Get('/api/find-one-user/:id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOneUser(id);
  }

  @Patch('/api/update-one-user/:id')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete('/api/delete-one-user/:id')
  remove(@Param('id') id: string) {
    return this.usersService.removeUser(id);
  }
}
