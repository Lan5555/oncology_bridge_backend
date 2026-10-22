import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { DataSource, EntitySubscriberInterface, InsertEvent } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Notification } from '../notification/entities/notification.entity';
import { EmailService } from './email.service';
import { EncryptionService } from '../encryption/encryption.service';

// Using the event's manager puts emails in the same transaction as the action.
// This also covers notification writers that intentionally bypass NotificationService.
@Injectable()
export class EmailEventsSubscriber
  implements EntitySubscriberInterface, OnModuleDestroy
{
  constructor(
    private readonly db: DataSource,
    private readonly emails: EmailService,
    private readonly encryption: EncryptionService,
  ) {
    db.subscribers.push(this);
  }

  async afterInsert(event: InsertEvent<User | Notification>) {
    if (!this.emails.enabled() || !event.entity) return;
    if (event.metadata.target === User) {
      const user = event.entity as User;
      if (user.email)
        await this.emails.queueAccountCreated(
          this.encryption.decrypt(user.email),
          user.active,
          event.manager,
        );
    } else if (event.metadata.target === Notification) {
      const notification = event.entity as Notification;
      if (!notification.user?.id) return;
      const user = await event.manager
        .getRepository(User)
        .findOneBy({ id: notification.user.id });
      if (user?.email)
        await this.emails.queueNotification(
          this.encryption.decrypt(user.email),
          event.manager,
          notification.title,
          notification.message,
        );
    }
  }

  onModuleDestroy() {
    const index = this.db.subscribers.indexOf(this);
    if (index >= 0) this.db.subscribers.splice(index, 1);
  }
}
