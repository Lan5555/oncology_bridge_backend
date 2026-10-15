import { Module } from '@nestjs/common';
import { AdminIntegrationsController } from './admin.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { GuardsModule } from '../guards/guards.module';
import { AdminIntegrationsService } from './admin-integrations.service';
import { IntegrationConfiguration } from './entities/integration-configuration.entity';
import { IntegrationSyncJob } from './entities/integration-sync-job.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, IntegrationConfiguration, IntegrationSyncJob]), GuardsModule],
  controllers: [AdminIntegrationsController],
  providers: [AdminIntegrationsService],
})
export class AdminModule {}
