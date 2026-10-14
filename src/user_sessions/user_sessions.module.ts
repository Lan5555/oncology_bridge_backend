import { Module } from '@nestjs/common';
import { UserSessionsService } from './user_sessions.service';
import { UserSessionsController } from './user_sessions.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserSession } from './entities/user_session.entity';
import { User } from '../users/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UserSession, User])],
  controllers: [UserSessionsController],
  providers: [UserSessionsService],
})
export class UserSessionsModule {}
