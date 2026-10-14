import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from './entities/setting.entity';
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
    const rows = Object.entries(values).map(([key, value]) =>
      this.settings.create({ key, value }),
    );
    if (rows.length) await this.settings.save(rows);
    return this.all();
  }
}
