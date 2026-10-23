import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { EmailService } from '../email/email.service';
import { EncryptionService } from '../encryption/encryption.service';

@Injectable()
export class OrderTrackingService {
  constructor(
    private readonly emails: EmailService,
    private readonly encryption: EncryptionService,
  ) {}

  async event(
    manager: EntityManager,
    orderId: string,
    key: string,
    status: string,
    message: string,
    actorId: string | null = null,
    previousStatus: string | null = null,
    ip = 'payment-worker',
    notify = false,
  ) {
    const id = randomUUID();
    const inserted = await manager.query<{ id: string }[]>(
      `INSERT INTO purchase_order_events(id,order_id,event_key,status,message) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT(order_id,event_key) DO NOTHING RETURNING id`,
      [id, orderId, key, status, message],
    );
    if (!inserted.length) return;
    await manager.query(
      `INSERT INTO audit_logs(id,user_id,action,description,ip_address,event_key,object_type,object_id,before_status,after_status)
      VALUES ($1,$2,'PURCHASE_ORDER_EVENT',$3,$4,$1,'purchase_order',$5,$6,$7)`,
      [
        id,
        actorId,
        `Purchase order event: ${status}`,
        ip,
        orderId,
        previousStatus,
        status,
      ],
    );
    if (notify && this.emails.enabled()) {
      const [row] = await manager.query<
        { email: string; invoice_reference: string }[]
      >(
        'SELECT u.email,o.invoice_reference FROM marketplace_orders o JOIN users u ON u.id=o.buyer_id WHERE o.id=$1',
        [orderId],
      );
      await this.emails.enqueue(
        {
          to: this.encryption.decrypt(row.email),
          subject: `Order ${row.invoice_reference}: ${status.toLowerCase()}`,
          text: `Order ${row.invoice_reference}\n${message}`,
        },
        manager,
      );
    }
  }
}
