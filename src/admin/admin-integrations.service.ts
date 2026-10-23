/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-base-to-string */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { lookup } from 'node:dns/promises';
import { connect as tcpConnect, isIP } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { AuditLog } from '../audit_log/entities/audit_log.entity';
import { User } from '../users/entities/user.entity';
import { ResponseHelper } from '../helpers/response-helper';
import { IntegrationConfiguration } from './entities/integration-configuration.entity';
import { IntegrationSyncJob } from './entities/integration-sync-job.entity';
import { UpdateIntegrationConfigurationDto } from './dto/update-integration-configuration.dto';

type FieldType = 'text' | 'url' | 'secret' | 'boolean';
type IntegrationField = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  description: string;
  env?: string;
};

const SCHEMAS: Record<
  string,
  { name: string; description: string; fields: IntegrationField[] }
> = {
  license_registry: {
    name: 'License registry',
    description: 'Professional license registry connectivity.',
    fields: [
      {
        key: 'mdcn_registry_name',
        label: 'MDCN display name',
        type: 'text',
        required: false,
        description:
          'Configured display name returned as registry_name for MDCN licence records.',
      },
      {
        key: 'pcn_registry_name',
        label: 'PCN display name',
        type: 'text',
        required: false,
        description:
          'Configured display name returned as registry_name for PCN licence records.',
      },
      {
        key: 'pcn_premises_registry_name',
        label: 'PCN_PREMISES display name',
        type: 'text',
        required: false,
        description:
          'Configured display name returned as registry_name for PCN_PREMISES licence records.',
      },
      {
        key: 'registry_url',
        label: 'Registry URL',
        type: 'url',
        required: true,
        description: 'HTTPS endpoint used to check license records.',
      },
      {
        key: 'api_key',
        label: 'API key',
        type: 'secret',
        required: true,
        description: 'Registry API credential.',
      },
      {
        key: 'sync_url',
        label: 'Sync URL',
        type: 'url',
        required: false,
        description: 'Optional provider endpoint for a registry sync job.',
      },
    ],
  },
  email: {
    name: 'Email delivery',
    description: 'SMTP delivery configuration.',
    fields: [
      {
        key: 'smtp_host',
        label: 'SMTP host',
        type: 'text',
        required: true,
        description: 'SMTP server host.',
        env: 'SMTP_HOST',
      },
      {
        key: 'smtp_port',
        label: 'SMTP port',
        type: 'text',
        required: true,
        description: 'SMTP server port.',
        env: 'SMTP_PORT',
      },
      {
        key: 'smtp_username',
        label: 'SMTP username',
        type: 'text',
        required: true,
        description: 'SMTP authentication username.',
        env: 'SMTP_USERNAME',
      },
      {
        key: 'smtp_password',
        label: 'SMTP password',
        type: 'secret',
        required: true,
        description: 'SMTP authentication credential.',
        env: 'SMTP_PASSWORD',
      },
      {
        key: 'smtp_secure',
        label: 'Use TLS',
        type: 'boolean',
        required: false,
        description: 'Whether SMTP uses TLS.',
        env: 'SMTP_SECURE',
      },
      {
        key: 'from_address',
        label: 'From address',
        type: 'text',
        required: true,
        description: 'Sender address.',
        env: 'SMTP_FROM',
      },
      {
        key: 'sync_url',
        label: 'Sync URL',
        type: 'url',
        required: false,
        description: 'Optional email provider sync endpoint.',
      },
    ],
  },
  payments: {
    name: 'Payments',
    description: 'Payment provider configuration.',
    fields: [
      {
        key: 'api_url',
        label: 'API URL',
        type: 'url',
        required: true,
        description: 'HTTPS payment provider API endpoint.',
      },
      {
        key: 'public_key',
        label: 'Public key',
        type: 'text',
        required: false,
        description: 'Non-secret provider public key.',
        env: 'PAYSTACK_PUBLIC_KEY',
      },
      {
        key: 'secret_key',
        label: 'Secret key',
        type: 'secret',
        required: true,
        description: 'Payment provider credential.',
        env: 'PAYSTACK_SECRET_KEY',
      },
      {
        key: 'sync_url',
        label: 'Sync URL',
        type: 'url',
        required: false,
        description: 'Optional payment reconciliation endpoint.',
      },
    ],
  },
  cold_chain: {
    name: 'Cold chain',
    description: 'Cold-chain provider configuration.',
    fields: [
      {
        key: 'api_url',
        label: 'API URL',
        type: 'url',
        required: true,
        description: 'HTTPS cold-chain provider endpoint.',
      },
      {
        key: 'api_key',
        label: 'API key',
        type: 'secret',
        required: true,
        description: 'Cold-chain provider credential.',
        env: 'IOT_DEVICE_KEYS',
      },
      {
        key: 'sync_url',
        label: 'Sync URL',
        type: 'url',
        required: false,
        description: 'Optional cold-chain synchronization endpoint.',
      },
    ],
  },
};

@Injectable()
export class AdminIntegrationsService {
  constructor(private readonly dataSource: DataSource) {}

  // Internal-only connection access; no controller returns these credentials.
  async licenseRegistryConnection(): Promise<{
    url: string;
    apiKey: string;
  } | null> {
    const { values, secrets, complete } =
      await this.readConfiguration('license_registry');
    if (!complete || typeof values.registry_url !== 'string') return null;
    return {
      url: await this.assertPublicHttpsUrl(values.registry_url),
      apiKey: secrets.api_key,
    };
  }

  async health() {
    const integrations = await Promise.all(
      Object.entries(SCHEMAS).map(async ([key, schema]) => {
        const config = await this.dataSource
          .getRepository(IntegrationConfiguration)
          .findOneBy({ integration_key: key });
        const { complete } = await this.readConfiguration(key);
        return {
          key,
          name: schema.name,
          status:
            config?.last_status ?? (complete ? 'CONFIGURED' : 'UNAVAILABLE'),
          description: complete
            ? schema.description
            : `${schema.name} is not fully configured.`,
          lastCheckedAt: config?.last_checked_at?.toISOString() ?? null,
        };
      }),
    );
    return ResponseHelper.Success('Integration health loaded.', {
      integrations,
    });
  }

  async configuration(key: string, actorId: string, ip: string) {
    const schema = this.schema(key);
    const { values, secrets } = await this.readConfiguration(key);
    const fields = await Promise.all(
      schema.fields.map(async (field) => {
        const secret = field.type === 'secret';
        const value = secret
          ? undefined
          : (values[field.key] ?? this.envValue(field));
        const configured = secret
          ? Boolean(
              secrets[field.key] ||
              (field.env && process.env[field.env]?.trim()),
            )
          : value !== undefined && value !== null && value !== '';
        return {
          key: field.key,
          label: field.label,
          type: field.type,
          required: field.required,
          configured,
          description: field.description,
          ...(!secret && configured ? { value } : {}),
        };
      }),
    );
    await this.audit(
      actorId,
      ip,
      'INTEGRATION_CONFIGURATION_VIEWED',
      `Configuration schema viewed for ${key}`,
    );
    return ResponseHelper.Success('Integration configuration loaded.', {
      fields,
    });
  }

  async updateConfiguration(
    key: string,
    dto: UpdateIntegrationConfigurationDto,
    actorId: string,
    ip: string,
  ) {
    const schema = this.schema(key);
    if (
      !dto.values ||
      typeof dto.values !== 'object' ||
      Array.isArray(dto.values)
    )
      throw new BadRequestException('values must be an object');
    const fields = new Map(schema.fields.map((field) => [field.key, field]));
    const nonSecretValues: Record<string, unknown> = {};
    const submittedSecrets: Record<string, string> = {};
    for (const [fieldKey, value] of Object.entries(dto.values)) {
      const field = fields.get(fieldKey);
      if (!field)
        throw new BadRequestException(
          `Unsupported configuration field: ${fieldKey}`,
        );
      if (field.type === 'secret') {
        if (value === '' || value === null || value === undefined) continue;
        if (typeof value !== 'string' || value.length > 8192)
          throw new BadRequestException(
            `${fieldKey} must be a string no longer than 8192 characters`,
          );
        submittedSecrets[fieldKey] = value;
      } else if (field.type === 'boolean') {
        if (typeof value !== 'boolean')
          throw new BadRequestException(`${fieldKey} must be a boolean`);
        nonSecretValues[fieldKey] = value;
      } else {
        if (typeof value !== 'string' || value.length > 4096)
          throw new BadRequestException(
            `${fieldKey} must be a string no longer than 4096 characters`,
          );
        const normalized = value.trim();
        if (
          key === 'license_registry' &&
          fieldKey.endsWith('_registry_name') &&
          (normalized.length > 200 ||
            Array.from(value).some(
              (character) =>
                character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
            ))
        )
          throw new BadRequestException(
            `${fieldKey} must be a single-line display name no longer than 200 characters`,
          );
        if (field.required && !normalized)
          throw new BadRequestException(`${fieldKey} is required`);
        if (field.type === 'url' && normalized) {
          let parsed: URL;
          try {
            parsed = new URL(normalized);
          } catch {
            throw new BadRequestException(`${fieldKey} must be a valid URL`);
          }
          if (parsed.protocol !== 'https:')
            throw new BadRequestException(`${fieldKey} must use HTTPS`);
        }
        if (
          fieldKey === 'smtp_port' &&
          normalized &&
          (!/^\d{1,5}$/.test(normalized) ||
            Number(normalized) < 1 ||
            Number(normalized) > 65535)
        )
          throw new BadRequestException('smtp_port must be a valid TCP port');
        nonSecretValues[fieldKey] = normalized;
      }
    }
    const repo = this.dataSource.getRepository(IntegrationConfiguration);
    const previous = await repo.findOneBy({ integration_key: key });
    const merged = { ...(previous?.values ?? {}), ...nonSecretValues };
    if (Object.keys(submittedSecrets).length) {
      const priorVault = await this.readVaultSecrets(key);
      const envSecrets = Object.fromEntries(
        schema.fields
          .filter((f) => f.type === 'secret' && f.env && process.env[f.env])
          .map((f) => [f.key, process.env[f.env!]!]),
      );
      await this.writeVaultSecrets(key, {
        ...envSecrets,
        ...priorVault,
        ...submittedSecrets,
      });
    }
    await repo.save(
      repo.create({
        integration_key: key,
        values: merged,
        updated_by: actorId,
        last_checked_at: null,
        last_status: null,
      }),
    );
    const changed = [
      ...Object.keys(nonSecretValues),
      ...Object.keys(submittedSecrets),
    ];
    await this.audit(
      actorId,
      ip,
      'INTEGRATION_CONFIGURATION_UPDATED',
      `Configuration updated for ${key}; fields: ${changed.join(', ') || 'none'}`,
    );
    return this.configuration(key, actorId, ip);
  }

  async test(key: string, actorId: string, ip: string) {
    const schema = this.schema(key);
    const { values, secrets, complete } = await this.readConfiguration(key);
    let status = 'UNAVAILABLE';
    let summary = 'Required server-side configuration is incomplete.';
    if (complete && key !== 'email') {
      const url = String(values.api_url ?? values.registry_url ?? '');
      try {
        const safeUrl = await this.assertPublicHttpsUrl(url);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
          const token = secrets.api_key ?? secrets.secret_key ?? '';
          const response = await fetch(safeUrl, {
            method: 'GET',
            signal: controller.signal,
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          status = response.ok ? 'HEALTHY' : 'UNAVAILABLE';
          summary = response.ok
            ? 'Provider endpoint responded successfully.'
            : `Provider endpoint returned HTTP ${response.status}.`;
        } finally {
          clearTimeout(timer);
        }
      } catch {
        summary = 'Provider endpoint could not be reached or validated.';
      }
    } else if (complete && key === 'email') {
      try {
        const host = String(values.smtp_host);
        await this.assertPublicHost(host);
        const port = Number(values.smtp_port);
        await this.probeSmtp(host, port, values.smtp_secure === true);
        status = 'HEALTHY';
        summary =
          'SMTP endpoint accepted a connection; authentication was not attempted.';
      } catch {
        summary = 'SMTP endpoint could not be reached or validated.';
      }
    }
    const repo = this.dataSource.getRepository(IntegrationConfiguration);
    const config = await repo.findOneBy({ integration_key: key });
    await repo.save(
      repo.create({
        integration_key: key,
        values: config?.values ?? {},
        updated_by: config?.updated_by ?? null,
        last_checked_at: new Date(),
        last_status: status,
      }),
    );
    await this.audit(
      actorId,
      ip,
      'INTEGRATION_TESTED',
      `Configuration test for ${key} returned ${status}`,
    );
    return ResponseHelper.Success('Integration test completed.', {
      key,
      status,
      checkedAt: new Date().toISOString(),
      summary,
    });
  }

  async sync(key: string, actorId: string, ip: string) {
    this.schema(key);
    const { values, secrets, complete } = await this.readConfiguration(key);
    const syncUrl = values.sync_url;
    if (!complete)
      throw new BadRequestException(
        'Complete the required integration configuration before syncing',
      );
    if (typeof syncUrl !== 'string' || !syncUrl)
      throw new BadRequestException(
        'Configure a sync_url before starting a sync',
      );
    const publicUrl = await this.assertPublicHttpsUrl(syncUrl);
    const repo = this.dataSource.getRepository(IntegrationSyncJob);
    const job = await this.dataSource.transaction(async (manager) => {
      const created = await manager.getRepository(IntegrationSyncJob).save({
        integration_key: key,
        status: 'RUNNING',
        started_by: actorId,
        started_ip: ip || 'unknown',
        started_at: new Date(),
        finished_at: null,
        safe_summary: null,
      });
      await manager.getRepository(AuditLog).save({
        user: { id: actorId } as User,
        action: 'INTEGRATION_SYNC_STARTED',
        description: `Sync ${created.id} started for ${key}`,
        ip_address: ip || 'unknown',
        event_key: null,
        object_type: 'integration_sync_job',
        object_id: created.id,
        request_id: null,
        before_status: null,
        after_status: 'RUNNING',
      });
      return created;
    });
    const token =
      secrets.api_key ?? secrets.secret_key ?? secrets.smtp_password ?? '';
    void this.executeSync(job.id, publicUrl, token).catch(() => undefined);
    return ResponseHelper.Success('Integration sync started.', {
      jobId: job.id,
      status: job.status,
      startedAt: job.started_at.toISOString(),
    });
  }

  private async executeSync(jobId: string, url: string, token: string) {
    const jobs = this.dataSource.getRepository(IntegrationSyncJob);
    const job = await jobs.findOneBy({ id: jobId });
    if (!job) return;
    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ jobId }),
      });
      job.status = response.ok ? 'SUCCEEDED' : 'FAILED';
      job.safe_summary = response.ok
        ? 'Provider accepted the synchronization request.'
        : `Provider returned HTTP ${response.status}.`;
    } catch {
      job.status = 'FAILED';
      job.safe_summary = 'Provider synchronization request failed.';
    }
    job.finished_at = new Date();
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(IntegrationSyncJob).save(job);
      await manager.getRepository(AuditLog).save({
        user: { id: job.started_by } as User,
        action: 'INTEGRATION_SYNC_COMPLETED',
        description: `Sync ${job.id} for ${job.integration_key} completed with status ${job.status}`,
        ip_address: job.started_ip || 'unknown',
        event_key: null,
        object_type: 'integration_sync_job',
        object_id: job.id,
        request_id: null,
        before_status: 'RUNNING',
        after_status: job.status,
      });
    });
  }

  private async readConfiguration(key: string) {
    const schema = this.schema(key);
    const row = await this.dataSource
      .getRepository(IntegrationConfiguration)
      .findOneBy({ integration_key: key });
    const values: Record<string, unknown> = { ...(row?.values ?? {}) };
    for (const field of schema.fields) {
      if (
        values[field.key] === undefined &&
        field.env &&
        process.env[field.env] !== undefined &&
        field.type !== 'secret'
      )
        values[field.key] =
          field.type === 'boolean'
            ? process.env[field.env] === 'true'
            : process.env[field.env];
    }
    const secrets = await this.readVaultSecrets(key);
    for (const field of schema.fields.filter((f) => f.type === 'secret'))
      if (!secrets[field.key] && field.env && process.env[field.env])
        secrets[field.key] = process.env[field.env]!;
    const complete = schema.fields
      .filter((f) => f.required)
      .every((f) => {
        const value = f.type === 'secret' ? secrets[f.key] : values[f.key];
        return value !== undefined && value !== null && value !== '';
      });
    return { values, secrets, complete };
  }

  private schema(key: string) {
    const schema = SCHEMAS[key];
    if (!schema) throw new NotFoundException('Unknown integration');
    return schema;
  }

  private envValue(field: IntegrationField) {
    if (!field.env || process.env[field.env] === undefined) return undefined;
    return field.type === 'boolean'
      ? process.env[field.env] === 'true'
      : process.env[field.env];
  }

  private async readVaultSecrets(key: string): Promise<Record<string, string>> {
    const addr = process.env.VAULT_ADDR?.replace(/\/$/, '');
    const token = process.env.VAULT_TOKEN;
    if (!addr || !token) return {};
    try {
      const response = await fetch(this.vaultUrl(addr, key), {
        headers: { 'X-Vault-Token': token },
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      });
      if (response.status === 404) return {};
      if (!response.ok) throw new Error('vault read failed');
      const payload = (await response.json()) as {
        data?: { data?: Record<string, string> };
      };
      return payload.data?.data ?? {};
    } catch {
      throw new ServiceUnavailableException(
        'Integration secret manager is unavailable',
      );
    }
  }

  private async writeVaultSecrets(
    key: string,
    secrets: Record<string, string>,
  ) {
    const addr = process.env.VAULT_ADDR?.replace(/\/$/, '');
    const token = process.env.VAULT_TOKEN;
    if (!addr || !token)
      throw new ServiceUnavailableException(
        'Integration secret manager is not configured',
      );
    try {
      const response = await fetch(this.vaultUrl(addr, key), {
        method: 'POST',
        headers: { 'X-Vault-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: secrets }),
      });
      if (!response.ok) throw new Error('vault write failed');
    } catch {
      throw new ServiceUnavailableException(
        'Integration secret manager is unavailable',
      );
    }
  }

  private vaultUrl(addr: string, key: string) {
    const mount = (process.env.INTEGRATION_VAULT_MOUNT ?? 'secret').replace(
      /^\/+|\/+$/g,
      '',
    );
    const path = `oncology-bridge/integrations/${encodeURIComponent(key)}`;
    return `${addr}/v1/${mount}/data/${path}`;
  }

  private async assertPublicHttpsUrl(value: string): Promise<string> {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new BadRequestException('Integration URL is invalid');
    }
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new BadRequestException(
        'Integration endpoints must be HTTPS URLs without embedded credentials',
      );
    await this.assertPublicHost(url.hostname);
    return url.toString();
  }

  private async assertPublicHost(hostname: string) {
    const host = hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local')
    )
      throw new BadRequestException(
        'Private integration endpoints are not allowed',
      );
    try {
      const records = isIP(host)
        ? [{ address: host }]
        : await lookup(host, { all: true });
      for (const record of records) {
        const address = record.address.toLowerCase();
        if (
          address === '::1' ||
          address.startsWith('fc') ||
          address.startsWith('fd') ||
          address.startsWith('fe80:') ||
          address.startsWith('10.') ||
          address.startsWith('192.168.') ||
          address.startsWith('127.') ||
          /^172\.(1[6-9]|2\d|3[01])\./.test(address) ||
          address === '0.0.0.0'
        )
          throw new BadRequestException(
            'Private integration endpoints are not allowed',
          );
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Integration host could not be resolved');
    }
  }

  private probeSmtp(host: string, port: number, secure: boolean) {
    return new Promise<void>((resolve, reject) => {
      const socket = secure
        ? tlsConnect({ host, port, servername: host })
        : tcpConnect({ host, port });
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('SMTP probe timeout'));
      }, 8000);
      socket.once('error', (error) => {
        clearTimeout(timeout);
        socket.destroy();
        reject(error);
      });
      socket.once('data', (data: Buffer) => {
        clearTimeout(timeout);
        socket.destroy();
        if (data.toString('utf8').startsWith('220')) resolve();
        else reject(new Error('SMTP greeting invalid'));
      });
    });
  }

  private async audit(
    actorId: string,
    ip: string,
    action: string,
    description: string,
  ) {
    await this.dataSource.getRepository(AuditLog).save({
      user: { id: actorId } as User,
      action,
      description,
      ip_address: ip || 'unknown',
      event_key: null,
      object_type: 'integration',
      object_id: null,
      request_id: null,
      before_status: null,
      after_status: null,
    });
  }
}
