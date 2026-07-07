import { Injectable } from '@nestjs/common';
import { CreateWebhookLogDto } from './dto/create-webhook_log.dto';
import { UpdateWebhookLogDto } from './dto/update-webhook_log.dto';

@Injectable()
export class WebhookLogService {
  create(createWebhookLogDto: CreateWebhookLogDto) {
    return 'This action adds a new webhookLog';
  }

  findAll() {
    return `This action returns all webhookLog`;
  }

  findOne(id: number) {
    return `This action returns a #${id} webhookLog`;
  }

  update(id: number, updateWebhookLogDto: UpdateWebhookLogDto) {
    return `This action updates a #${id} webhookLog`;
  }

  remove(id: number) {
    return `This action removes a #${id} webhookLog`;
  }
}
