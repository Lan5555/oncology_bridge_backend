import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EmailService } from './email.service';
import { EmailOutbox } from './entities/email-outbox.entity';

@Injectable()
export class EmailWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EmailWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly db: DataSource,
    private readonly emails: EmailService,
  ) {}

  onApplicationBootstrap() {
    if (!this.emails.enabled()) return;
    this.emails.assertConfigured();
    this.emails.frontendUrl('/');
    this.timer = setInterval(() => {
      void this.flush();
    }, 5000);
    this.timer.unref();
    void this.flush();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async flush() {
    if (this.running || !this.emails.enabled()) return;
    this.running = true;
    try {
      for (let i = 0; i < 10; i++) {
        const found = await this.db.transaction(async (manager) => {
          const rows = manager.getRepository(EmailOutbox);
          const row = await rows
            .createQueryBuilder('email')
            .where(
              "email.status = 'PENDING' AND email.available_at <= CURRENT_TIMESTAMP",
            )
            .orderBy('email.created_at', 'ASC')
            .take(1)
            .setLock('pessimistic_write')
            .setOnLocked('skip_locked')
            .getOne();
          if (!row) return false;
          if (
            !row.payload ||
            (row.expires_at && row.expires_at <= new Date())
          ) {
            row.status = 'EXPIRED';
            row.payload = null;
          } else {
            row.attempts += 1;
            try {
              row.message_id = await this.emails.deliver(row.payload, row.id);
              row.status = 'SENT';
              row.sent_at = new Date();
              row.payload = null;
            } catch (error: unknown) {
              row.status = row.attempts >= 8 ? 'FAILED' : 'PENDING';
              row.available_at = new Date(
                Date.now() +
                  Math.min(3600, 30 * 2 ** (row.attempts - 1)) * 1000,
              );
              if (row.status === 'FAILED') row.payload = null;
              this.logger.warn(
                `Email ${row.id} delivery failed (attempt ${row.attempts}, ${row.status}): ${this.deliveryFailureReason(error)}`,
              );
            }
          }
          await rows.save(row);
          return true;
        });
        if (!found) break;
      }
    } catch {
      this.logger.error('Email outbox processing failed');
    } finally {
      this.running = false;
    }
  }

  private deliveryFailureReason(error: unknown): string {
    // Only log known safe diagnostics; arbitrary errors can contain secrets or PII.
    if (error instanceof Error || error instanceof DOMException) {
      if (/^Brevo HTTP [1-5]\d{2}$/.test(error.message)) return error.message;
      if (
        error.message === 'Email delivery is not configured' ||
        error.message === 'Brevo response missing message ID'
      )
        return error.message;
      if (error.name === 'TimeoutError')
        return 'Email provider request timed out';
      if (error.name === 'AbortError') return 'Email provider request aborted';
      if (error instanceof TypeError && error.message === 'fetch failed')
        return 'Email provider connection failed';
    }
    return 'Delivery error (details suppressed to protect sensitive data)';
  }
}
