import { Global, Module } from '@nestjs/common';
import { GuardsService } from './guards.service';
import { GuardsController } from './guards.controller';
import { AuthGuard } from './auth.guard';
import { NetworkAdminGuard } from './network-admin.guard';
import { UserManagementGuard, FacilityTeamGuard } from './user-management.guard';
import { MedicineCatalogGuard } from './medicine-catalog.guard';
import { IntegrationAdminGuard } from './integration-admin.guard';
import { JwtModule } from '@nestjs/jwt';

@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'default_secret_key',
    }),
  ],
  controllers: [GuardsController],
  providers: [GuardsService, AuthGuard, NetworkAdminGuard, UserManagementGuard, FacilityTeamGuard, MedicineCatalogGuard, IntegrationAdminGuard],
  exports: [AuthGuard, NetworkAdminGuard, UserManagementGuard, FacilityTeamGuard, MedicineCatalogGuard, IntegrationAdminGuard],
})
export class GuardsModule {}
