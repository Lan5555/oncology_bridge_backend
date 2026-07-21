import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthDto } from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}
  @Post('/api/login')
  async login(@Body() body: AuthDto) {
    return this.authService.loginUser(body);
  }
  @Get('/api/log-out')
  async logout(@Query('id') id: string) {
    return this.authService.logUserOut(id);
  }
}
