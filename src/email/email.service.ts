import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { isEmail } from 'class-validator';
import { EncryptionService } from '../encryption/encryption.service';
import { EmailOutbox } from './entities/email-outbox.entity';
import { renderEmailTemplate } from './email-template';
export { escapeHtml } from './email-template';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

@Injectable()
export class EmailService {
  constructor(
    private readonly config: ConfigService,
    private readonly db: DataSource,
    private readonly encryption: EncryptionService,
  ) {}

  enabled() {
    return this.config.get<string>('EMAIL_ENABLED') === 'true';
  }

  assertConfigured() {
    if (
      !this.enabled() ||
      !this.config.get<string>('BREVO_API_KEY')?.trim() ||
      !isEmail(this.config.get<string>('EMAIL_FROM_ADDRESS') ?? '')
    ) {
      throw new ServiceUnavailableException('Email delivery is not configured');
    }
  }

  frontendUrl(path: string) {
    try {
      const origin = new URL(this.config.get<string>('FRONTEND_ORIGIN') ?? '');
      if (
        origin.username ||
        origin.password ||
        origin.pathname !== '/' ||
        origin.search ||
        origin.hash ||
        (origin.protocol !== 'https:' &&
          !(
            this.config.get('NODE_ENV') !== 'production' &&
            origin.protocol === 'http:' &&
            ['localhost', '127.0.0.1'].includes(origin.hostname)
          ))
      )
        throw new Error();
      return new URL(path, origin).toString();
    } catch {
      throw new ServiceUnavailableException(
        'A valid FRONTEND_ORIGIN is required for email links',
      );
    }
  }

  passwordResetUrl(token: string) {
    const path =
      this.config.get<string>('PASSWORD_RESET_PATH') ?? '/reset-password';
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\'))
      throw new ServiceUnavailableException(
        'PASSWORD_RESET_PATH must be a local frontend path',
      );
    const url = new URL(this.frontendUrl(path));
    url.searchParams.set('token', token);
    return url.toString();
  }

  async enqueue(
    message: EmailMessage,
    manager: EntityManager = this.db.manager,
    expiresAt?: Date,
  ) {
    if (!this.enabled()) return;
    if (!isEmail(message.to) || !message.subject.trim() || !message.text.trim())
      throw new Error('Invalid transactional email');
    return manager.getRepository(EmailOutbox).save({
      payload: this.encryption.encrypt(
        JSON.stringify({
          ...message,
          html:
            message.html ??
            renderEmailTemplate({
              heading: message.subject,
              text: message.text,
            }),
        }),
      ),
      expires_at: expiresAt ?? null,
    });
  }

  async queuePasswordReset(
    to: string,
    token: string,
    expiresAt: Date,
    manager: EntityManager,
  ) {
    this.assertConfigured();
    const url = this.passwordResetUrl(token);
    return this.enqueue(
      {
        to,
        subject: 'Reset your OncoSourz password',
        text: `Reset your password: ${url}\nThis link expires in 15 minutes. If you did not request this, ignore this email.`,
        html: renderEmailTemplate({
          eyebrow: 'ACCOUNT SECURITY',
          heading: 'A fresh start, securely.',
          preheader:
            'Your password reset link is ready. It expires in 15 minutes.',
          text: 'We received a request to reset your OncoSourz password. Use the button below to choose a new one and get back to your account.',
          action: { label: 'Reset my password', url },
          showFallbackLink: true,
          note: {
            title: 'This link expires in 15 minutes',
            text: 'If you did not request a password reset, you can safely ignore this email. Your password will stay the same.',
          },
        }),
      },
      manager,
      expiresAt,
    );
  }

  // Fixed, minimal content keeps clinical details and internal review notes in the app.
  async queueAccountCreated(
    to: string,
    active: boolean,
    manager: EntityManager,
  ) {
    if (!this.enabled()) return;
    return this.enqueue(
      {
        to,
        subject: 'Welcome to OncoSourz',
        text: active
          ? 'Your OncoSourz account has been created. Sign in using the credentials you set or request a password reset. Never share your password.'
          : 'Your OncoSourz registration has been received and is awaiting review. We will notify you when a decision is available.',
        html: renderEmailTemplate({
          eyebrow: 'WELCOME TO THE NETWORK',
          heading: active
            ? 'Better care starts with connection.'
            : 'You’re one step closer.',
          preheader: active
            ? 'Your OncoSourz account is ready.'
            : 'We have received your registration. Here is what happens next.',
          badge: active ? 'Account created' : 'Registration received',
          text: active
            ? 'Welcome to OncoSourz. Your account has been created, connecting you to a network built around oncology care.\n\nSign in using the credentials you set, or request a password reset to access your account.'
            : 'Thank you for joining OncoSourz. We have received your registration and our team will review it.\n\nWe’ll email you when a decision is available. You do not need to submit another registration.',
          ...(active
            ? {
                action: { label: 'Open OncoSourz', url: this.frontendUrl('/') },
              }
            : {}),
          note: {
            title: active ? 'Keep your account secure' : 'What happens next?',
            text: active
              ? 'Your password belongs to you. Never share it with anyone, including other members of your facility.'
              : 'Your facility membership and professional licence may need approval before you can sign in.',
          },
        }),
      },
      manager,
    );
  }

  async queueNotification(
    to: string,
    manager: EntityManager,
    title?: string,
    message?: string,
  ) {
    if (!this.enabled()) return;
    const reviewTitles = [
      'Registration approved',
      'Registration decision',
      'Membership approved',
      'Membership request declined',
    ];
    const isReview = !!title && reviewTitles.includes(title);
    const text =
      isReview && message
        ? message
        : 'A new notification is available in your OncoSourz account. Open the app to review it.';
    return this.enqueue(
      {
        to,
        subject: isReview
          ? `OncoSourz: ${title}`
          : 'You have an OncoSourz update',
        text,
        html: renderEmailTemplate({
          eyebrow: isReview ? 'REGISTRATION UPDATE' : 'FROM YOUR NETWORK',
          heading: isReview ? title : 'An update is waiting for you.',
          preheader: isReview
            ? 'There is an update on your OncoSourz registration.'
            : 'Open OncoSourz to view your latest notification.',
          text,
          ...(!isReview
            ? {
                action: {
                  label: 'View my account',
                  url: this.frontendUrl('/'),
                },
              }
            : {}),
          note: {
            title: 'Your privacy matters',
            text: 'Clinical details and sensitive account information are kept inside OncoSourz.',
          },
        }),
      },
      manager,
    );
  }

  async deliver(payload: string, id: string): Promise<string> {
    this.assertConfigured();
    const message = JSON.parse(
      this.encryption.decrypt(payload),
    ) as EmailMessage;
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: {
        'api-key': this.config.get<string>('BREVO_API_KEY')!,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender: {
          email: this.config.get<string>('EMAIL_FROM_ADDRESS'),
          name: this.config.get<string>('EMAIL_FROM_NAME') ?? 'OncoSourz',
        },
        to: [{ email: message.to }],
        subject: message.subject,
        textContent: message.text,
        htmlContent:
          message.html ??
          renderEmailTemplate({ heading: message.subject, text: message.text }),
        headers: { idempotencyKey: id },
      }),
    });
    // Never expose provider bodies, which may echo credentials or recipient data.
    if (!response.ok) throw new Error(`Brevo HTTP ${response.status}`);
    const body = (await response.json()) as { messageId?: string };
    if (!body.messageId) throw new Error('Brevo response missing message ID');
    return body.messageId;
  }
}
