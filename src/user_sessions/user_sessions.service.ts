import { Injectable } from '@nestjs/common';
import { CreateUserSessionDto } from './dto/create-user_session.dto';
import { UpdateUserSessionDto } from './dto/update-user_session.dto';

@Injectable()
export class UserSessionsService {
  create(createUserSessionDto: CreateUserSessionDto) {
    return 'This action adds a new userSession';
  }

  findAll() {
    return `This action returns all userSessions`;
  }

  findOne(id: number) {
    return `This action returns a #${id} userSession`;
  }

  update(id: number, updateUserSessionDto: UpdateUserSessionDto) {
    return `This action updates a #${id} userSession`;
  }

  remove(id: number) {
    return `This action removes a #${id} userSession`;
  }
}
