import { BadRequestException, Injectable } from '@nestjs/common';
import { currencyPreference } from '../helpers/business-values';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from './entities/setting.entity';
import { managedValue } from '../form_options/form-options.service';
@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(Setting) private readonly settings: Repository<Setting>,
  ) {}
  async all() {
    return Object.fromEntries(
      (await this.settings.find()).map((item) => [item.key, item.value]),
    );
  }
  async update(values: Record<string, unknown>) {
    if (!values || typeof values !== 'object' || Array.isArray(values))
      throw new BadRequestException('Settings must be a JSON object');
    const normalized = { ...values };
    if (Object.hasOwn(normalized, 'currency'))
      normalized.currency = currencyPreference(normalized.currency);
    return this.settings.manager.transaction(async (manager) => {
      if (normalized.currency)
        await managedValue(manager, 'settings', normalized.currency);
      const repository = manager.getRepository(Setting);
      const rows = Object.entries(normalized).map(([key, value]) =>
        repository.create({ key, value }),
      );
      if (rows.length) await repository.save(rows);
      return Object.fromEntries(
        (await repository.find()).map((item) => [item.key, item.value]),
      );
    });
  }
}
