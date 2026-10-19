import { Global, Module } from '@nestjs/common';
import { GuardsService } from './guards.service';
import { GuardsController } from './guards.controller';
import { AuthGuard } from './auth.guard';
import { NetworkAdminGuard } from './network-admin.guard';
import {
  UserManagementGuard,
  FacilityTeamGuard,
} from './user-management.guard';
import { MedicineCatalogGuard } from './medicine-catalog.guard';
import { IntegrationAdminGuard } from './integration-admin.guard';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryAccessGrant } from './entities/inventory-access-grant.entity';
import { StockAccessService } from './stock-access.service';
import { InventoryManagementGuard } from './inventory-management.guard';
import { OperationalReadGuard } from './operational-read.guard';
import { FacilityLicenseReviewGuard } from './facility-license-review.guard';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([InventoryAccessGrant]),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'default_secret_key',
    }),
  ],
  controllers: [GuardsController],
  providers: [
    FacilityLicenseReviewGuard,
    OperationalReadGuard,
    GuardsService,
    AuthGuard,
    NetworkAdminGuard,
    UserManagementGuard,
    FacilityTeamGuard,
    MedicineCatalogGuard,
    IntegrationAdminGuard,
    StockAccessService,
    InventoryManagementGuard,
  ],
  exports: [
    FacilityLicenseReviewGuard,
    OperationalReadGuard,
    AuthGuard,
    NetworkAdminGuard,
    UserManagementGuard,
    FacilityTeamGuard,
    MedicineCatalogGuard,
    IntegrationAdminGuard,
    StockAccessService,
    InventoryManagementGuard,
  ],
})
export class GuardsModule {}
