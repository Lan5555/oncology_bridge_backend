import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { UserSessionsService } from './user_sessions.service';
import { CreateUserSessionDto } from './dto/create-user_session.dto';
import { UpdateUserSessionDto } from './dto/update-user_session.dto';

@Controller('user-sessions')
export class UserSessionsController {
  constructor(private readonly userSessionsService: UserSessionsService) {}

  @Post()
  create(@Body() createUserSessionDto: CreateUserSessionDto) {
    return this.userSessionsService.create(createUserSessionDto);
  }

  @Get()
  findAll() {
    return this.userSessionsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.userSessionsService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUserSessionDto: UpdateUserSessionDto) {
    return this.userSessionsService.update(+id, updateUserSessionDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.userSessionsService.remove(+id);
  }
}
