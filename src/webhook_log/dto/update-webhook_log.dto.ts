import { PartialType } from '@nestjs/mapped-types';
import { CreateWebhookLogDto } from './create-webhook_log.dto';

export class UpdateWebhookLogDto extends PartialType(CreateWebhookLogDto) {}
