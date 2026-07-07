import { Module } from '@nestjs/common';
import { WebhookLogService } from './webhook_log.service';
import { WebhookLogController } from './webhook_log.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhookLog } from './entities/webhook_log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([WebhookLog])],
  controllers: [WebhookLogController],
  providers: [WebhookLogService],
})
export class WebhookLogModule {}
