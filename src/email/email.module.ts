import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EncryptionModule } from '../encryption/encryption.module';
import { EmailOutbox } from './entities/email-outbox.entity';
import { PasswordReset } from './entities/password-reset.entity';
import { EmailService } from './email.service';
import { EmailEventsSubscriber } from './email-events.subscriber';
import { EmailWorker } from './email-worker.service';

@Global()
@Module({
  imports: [
    ConfigModule,
    EncryptionModule,
    TypeOrmModule.forFeature([EmailOutbox, PasswordReset]),
  ],
  providers: [EmailService, EmailEventsSubscriber, EmailWorker],
  exports: [EmailService],
})
export class EmailModule {}
