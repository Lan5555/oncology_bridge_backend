import { IsObject } from 'class-validator';

export class UpdateIntegrationConfigurationDto {
  @IsObject()
  values!: Record<string, unknown>;
}
