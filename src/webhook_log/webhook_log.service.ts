import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WebhookLog } from './entities/webhook_log.entity';
import { CreateWebhookLogDto } from './dto/create-webhook_log.dto';
import { UpdateWebhookLogDto } from './dto/update-webhook_log.dto';
import { ResponseHelper } from '../helpers/response-helper';
@Injectable()
export class WebhookLogService {
  constructor(
    @InjectRepository(WebhookLog) private readonly logs: Repository<WebhookLog>,
  ) {}
  async create(dto: CreateWebhookLogDto) {
    return ResponseHelper.Success(
      'Webhook event recorded',
      await this.logs.save(this.logs.create(dto)),
    );
  }
  async findAll() {
    return ResponseHelper.Success(
      'Webhook logs retrieved',
      await this.logs.find({ order: { created_at: 'DESC' }, take: 200 }),
    );
  }
  async findOne(id: string) {
    const row = await this.logs.findOneBy({ id });
    if (!row) throw new NotFoundException('Webhook log not found');
    return ResponseHelper.Success('Webhook log retrieved', row);
  }
  update(_id: string, _dto: UpdateWebhookLogDto): never {
    throw new ForbiddenException('Webhook logs are append-only');
  }
  remove(_id: string): never {
    throw new ForbiddenException('Webhook logs are append-only');
  }
}
