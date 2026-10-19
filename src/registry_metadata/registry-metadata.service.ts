import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { IntegrationConfiguration } from '../admin/entities/integration-configuration.entity';

// Names are optional configuration, never inferred from the applicant account type.
export const REGISTRY_NAME_FIELDS: Readonly<Record<string, string>> = {
  MDCN: 'mdcn_registry_name',
  PCN: 'pcn_registry_name',
  PCN_PREMISES: 'pcn_premises_registry_name',
};

@Injectable()
export class RegistryMetadataService {
  constructor(private readonly db: DataSource) {}
  async names(
    manager: EntityManager = this.db.manager,
  ): Promise<ReadonlyMap<string, string>> {
    try {
      // Read display metadata only: this must not depend on Vault or provider availability.
      const row = await manager
        .getRepository(IntegrationConfiguration)
        .findOneBy({ integration_key: 'license_registry' });
      const names = new Map<string, string>();
      for (const [code, field] of Object.entries(REGISTRY_NAME_FIELDS)) {
        const value = row?.values?.[field];
        if (
          typeof value === 'string' &&
          value.trim() &&
          value.trim().length <= 200 &&
          !Array.from(value).some((character) => {
            const code = character.charCodeAt(0);
            return code < 32 || code === 127;
          })
        )
          names.set(code, value.trim());
      }
      return names;
    } catch {
      // Optional display metadata cannot prevent licence review or fabricate a name.
      return new Map();
    }
  }
  async name(
    registry: string | null | undefined,
    manager?: EntityManager,
  ): Promise<string | null> {
    if (!registry?.trim()) return null;
    return (
      (await this.names(manager)).get(registry.trim().toUpperCase()) ?? null
    );
  }
}
