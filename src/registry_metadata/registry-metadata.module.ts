import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationConfiguration } from '../admin/entities/integration-configuration.entity';
import { RegistryMetadataService } from './registry-metadata.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([IntegrationConfiguration])],
  providers: [RegistryMetadataService],
  exports: [RegistryMetadataService],
})
export class RegistryMetadataModule {}
