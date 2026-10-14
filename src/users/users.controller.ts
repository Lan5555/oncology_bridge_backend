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
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuthGuard } from '../guards/auth.guard';

@Controller(['users', 'api/users'])
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @UseGuards(AuthGuard)
  findAllApi(@Query('take') take?: string, @Query('skip') skip?: string) {
    return this.usersService.findAll({
      take: Number(take) || 50,
      skip: Number(skip) || 0,
    });
  }

  @Get(':id') @UseGuards(AuthGuard) findOneApi(@Param('id') id: string) {
    return this.usersService.findOneUser(id);
  }

  @Post('/api/register-user')
  create(@Body() createUserDto: CreateUserDto, @Ip() ip: string) {
    return this.usersService.createRegular(createUserDto, ip);
  }

  @Get('/api/find-all-users')
  @UseGuards(AuthGuard)
  findAll(@Query('take') take: number, @Query('skip') skip: number) {
    return this.usersService.findAll({ take: +take, skip: +skip });
  }

  @Get('/api/find-one-user/:id')
  @UseGuards(AuthGuard)
  findOne(@Param('id') id: string) {
    return this.usersService.findOneUser(id);
  }

  @Patch('/api/update-one-user/:id')
  @UseGuards(AuthGuard)
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete('/api/delete-one-user/:id')
  @UseGuards(AuthGuard)
  remove(@Param('id') id: string) {
    return this.usersService.removeUser(id);
  }
}
