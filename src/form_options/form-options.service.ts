import { HttpException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { StockAccessService } from '../guards/stock-access.service';
import { ResponseHelper } from '../helpers/response-helper';

export const REPORT_FORMATS = ['CSV', 'PDF', 'XLSX'] as const;
export function contractError(
  status: number,
  code: string,
  message: string,
): never {
  throw new HttpException(
    { success: false, message, data: null, code },
    status,
  );
}
export async function managedValue(
  manager: EntityManager,
  context: string,
  value: unknown,
): Promise<string> {
  const field =
    (
      {
        prescription: 'insurer/payment method',
        marketplace: 'category',
        settings: 'currency',
      } as Record<string, string>
    )[context] ?? context;
  if (typeof value !== 'string' || !value.trim())
    contractError(422, 'OPTION_REQUIRED', `Select a ${field} option.`);
  const rows = await manager.query<{ value: string }[]>(
    'SELECT value FROM form_options WHERE context=$1 AND value=$2 AND active=true FOR SHARE',
    [context, value],
  );
  if (!rows.length)
    contractError(
      422,
      'OPTION_UNAVAILABLE',
      `The selected ${field} option is unavailable. Reload the form options and choose again.`,
    );
  return value;
}

@Injectable()
export class FormOptionsService {
  constructor(
    private readonly db: DataSource,
    private readonly access: StockAccessService,
  ) {}

  async actor(actorId: string, context: string, manager = this.db.manager) {
    const actor = await manager.getRepository(User).findOne({
      where: { id: actorId },
      relations: { hospital: true, role: true },
    });
    if (!actor?.active)
      contractError(403, 'ACCOUNT_FORBIDDEN', 'An active account is required.');
    const network = ['ADMIN', 'SUPERADMIN'].includes(
      actor.role?.name.trim().toUpperCase() ?? '',
    );
    const permissions = await this.access.permissions(actor, manager);
    if (network) {
      const permission =
        context === 'reports'
          ? 'report.export'
          : context === 'prescription'
            ? 'prescription.read'
            : context === 'marketplace'
              ? 'marketplace.read'
              : 'settings.read';
      if (
        !permissions.includes('admin.access') ||
        !permissions.includes(permission)
      )
        contractError(
          403,
          'PERMISSION_DENIED',
          `admin.access and ${permission} are required.`,
        );
    } else {
      if (!(await this.access.verifiedMember(actor, manager)))
        contractError(
          403,
          'MEMBERSHIP_REQUIRED',
          'Active, verified facility membership is required.',
        );
      if (context === 'prescription' && actor.account_type !== 'DOCTOR')
        contractError(
          403,
          'PRESCRIBER_REQUIRED',
          'A verified doctor account is required.',
        );
      if (
        context === 'marketplace' &&
        !['DOCTOR', 'PHARMACIST', 'PHARMACY_STORE'].includes(
          actor.account_type ?? '',
        )
      )
        contractError(
          403,
          'MARKETPLACE_FORBIDDEN',
          'Your account cannot use the medicine marketplace.',
        );
      if (context === 'reports' && !permissions.includes('report.export'))
        contractError(
          403,
          'PERMISSION_DENIED',
          'Missing permission: report.export',
        );
    }
    return { actor, facilityId: network ? undefined : actor.hospital.id };
  }

  async get(context: string, actorId: string) {
    const groups: Record<string, string> = {
      prescription: 'insurers',
      marketplace: 'categories',
      settings: 'currencies',
      reports: 'reportFormats',
    };
    if (typeof context !== 'string' || !Object.hasOwn(groups, context))
      contractError(
        422,
        'INVALID_CONTEXT',
        'context must be prescription, marketplace, settings, or reports.',
      );
    await this.actor(actorId, context);
    const options =
      context === 'reports'
        ? REPORT_FORMATS.map((value) => ({ value, label: value }))
        : await this.db.manager.query<{ value: string; label: string }[]>(
            'SELECT value,label FROM form_options WHERE context=$1 AND active=true ORDER BY position,label,value',
            [context],
          );
    if (
      options.some(
        (option) =>
          option.value !== option.value.trim().normalize('NFC') ||
          (context === 'settings' &&
            !Intl.supportedValuesOf('currency').includes(option.value)),
      )
    )
      contractError(
        503,
        'OPTIONS_CONFIGURATION_INVALID',
        'The configured form options need administrator review before they can be used.',
      );
    return ResponseHelper.Success('Options loaded', {
      context,
      options: { [groups[context]]: options },
    });
  }

  async prescriber(actorId: string, manager = this.db.manager) {
    const { actor } = await this.actor(actorId, 'prescription', manager);
    if (
      actor.account_type !== 'DOCTOR' ||
      !(await this.access.verifiedMember(actor, manager))
    )
      contractError(
        403,
        'PRESCRIBER_REQUIRED',
        'A verified doctor with active facility membership is required.',
      );
    return actor;
  }
}
