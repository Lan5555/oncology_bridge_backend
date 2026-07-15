import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthDto } from './dto/auth.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { Repository } from 'typeorm';
import { CoreResponse, ResponseHelper } from '../helpers/response-helper';
import * as bcrypt from 'bcrypt';
import { UserSession } from '../user_sessions/entities/user_session.entity';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserSession)
    private readonly userSession: Repository<UserSession>,
  ) {}

  async loginUser(userDetails: AuthDto): CoreResponse {
    try {
      const user = await this.userRepository.findOneBy({
        email: userDetails.email,
      });
      if (!user) {
        return ResponseHelper.Error('User not found');
      }
      const decryptPassword = await bcrypt.compare(
        userDetails.password,
        user.password_hash,
      );
      if (!decryptPassword) {
        return ResponseHelper.Error('Invalid password');
      }

      // 1. Update mutable state FIRST before stripping properties
      user.last_login = new Date();
      user.active = true;
      await this.userRepository.save(user);

      const payload = {
        id: user.id,
        email: user.email,
        role: user.role?.name,
      };

      const accessToken = await this.jwtService.signAsync(payload);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { password_hash, ...userInfo } = user;

      return ResponseHelper.Success<{
        user: Omit<User, 'password_hash'>;
        token: string;
      }>('Login successful', {
        user: userInfo,
        token: accessToken,
      });
    } catch (error: any) {
      return ResponseHelper.Error(error);
    }
  }

  async logUserOut(id: string) {
    try {
      await this.userSession.update(
        { user: { id: id } },
        {
          refresh_token: '',
        },
      );
      return ResponseHelper.Success('User logged out successfully.', null);
    } catch (error) {
      return ResponseHelper.Error(error, null);
    }
  }
}
