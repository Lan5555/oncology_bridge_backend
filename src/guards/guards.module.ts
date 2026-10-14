import { Global, Module } from '@nestjs/common';
import { GuardsService } from './guards.service';
import { GuardsController } from './guards.controller';
import { AuthGuard } from './auth.guard';
import { JwtModule } from '@nestjs/jwt';

@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'default_secret_key',
    }),
  ],
  controllers: [GuardsController],
  providers: [GuardsService, AuthGuard],
  exports: [AuthGuard],
})
export class GuardsModule {}
