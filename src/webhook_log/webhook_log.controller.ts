import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { WebhookLogService } from './webhook_log.service';
import { CreateWebhookLogDto } from './dto/create-webhook_log.dto';
import { UpdateWebhookLogDto } from './dto/update-webhook_log.dto';

@Controller('webhook-log')
export class WebhookLogController {
  constructor(private readonly webhookLogService: WebhookLogService) {}

  @Post()
  create(@Body() createWebhookLogDto: CreateWebhookLogDto) {
    return this.webhookLogService.create(createWebhookLogDto);
  }

  @Get()
  findAll() {
    return this.webhookLogService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.webhookLogService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateWebhookLogDto: UpdateWebhookLogDto) {
    return this.webhookLogService.update(+id, updateWebhookLogDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.webhookLogService.remove(+id);
  }
}
