import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { DataSource, EntityManager, InsertEvent } from 'typeorm';
import { EncryptionService } from '../encryption/encryption.service';
import { EmailService, escapeHtml } from './email.service';
import type { EmailMessage } from './email.service';
import { EmailOutbox } from './entities/email-outbox.entity';
import { EmailWorker } from './email-worker.service';
import { EmailEventsSubscriber } from './email-events.subscriber';
import { User } from '../users/entities/user.entity';
import { Notification } from '../notification/entities/notification.entity';

describe('Brevo transactional email', () => {
  const settings = {
    EMAIL_ENABLED: 'true',
    BREVO_API_KEY: 'test-api-key',
    EMAIL_FROM_ADDRESS: 'no-reply@example.com',
    FRONTEND_ORIGIN: 'https://app.example.com',
  };
  const originalKey = process.env.ENCRYPTION_KEY;
  let encryption: EncryptionService;
  const save = jest.fn((row: Pick<EmailOutbox, 'payload' | 'expires_at'>) =>
    Promise.resolve(row),
  );
  const getRepository = jest.fn(() => ({ save }));
  const manager = {
    getRepository,
  } as unknown as EntityManager;
  let emails: EmailService;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = 'ab'.repeat(32);
    encryption = new EncryptionService();
  });
  afterAll(() => {
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
  });
  beforeEach(() => {
    jest.clearAllMocks();
    emails = new EmailService(
      new ConfigService(settings),
      { manager } as DataSource,
      encryption,
    );
  });
  afterEach(() => jest.restoreAllMocks());

  it('queues encrypted content using the caller transaction and never calls Brevo inline', async () => {
    const fetcher = jest.spyOn(globalThis, 'fetch');
    const expires = new Date(Date.now() + 900000);
    await emails.queuePasswordReset(
      'user@example.com',
      'secret-token',
      expires,
      manager,
    );
    expect(getRepository).toHaveBeenCalledWith(EmailOutbox);
    const row = save.mock.calls[0][0];
    expect(row.payload).not.toContain('secret-token');
    expect(row.payload).not.toContain('user@example.com');
    const message = JSON.parse(
      encryption.decrypt(row.payload!),
    ) as EmailMessage;
    expect(message.to).toBe('user@example.com');
    expect(message.text).toContain(
      'https://app.example.com/reset-password?token=secret-token',
    );
    expect(row.expires_at).toEqual(expires);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('authenticates to the fixed Brevo endpoint with a stable message key and escaped HTML', async () => {
    const fetcher = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messageId: 'accepted' }),
    } as Response);
    const payload = encryption.encrypt(
      JSON.stringify({
        to: 'user@example.com',
        subject: 'Update',
        text: '<script>alert(1)</script>\nNext line',
      }),
    );
    await expect(emails.deliver(payload, 'outbox-id')).resolves.toBe(
      'accepted',
    );
    const options = fetcher.mock.calls[0][1]!;
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://api.brevo.com/v3/smtp/email',
    );
    expect(options.headers).toMatchObject({ 'api-key': 'test-api-key' });
    expect(options.redirect).toBe('error');
    expect(JSON.parse(options.body as string)).toMatchObject({
      sender: { email: 'no-reply@example.com', name: 'OncoSourz' },
      to: [{ email: 'user@example.com' }],
      headers: { idempotencyKey: 'outbox-id' },
    });
    const delivered = JSON.parse(options.body as string) as {
      htmlContent: string;
    };
    expect(delivered.htmlContent).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt;<br>Next line',
    );
    expect(delivered.htmlContent).not.toContain('<script>');
  });

  it('does not expose provider response bodies on failure', async () => {
    const readBody = jest.fn();
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
      text: readBody,
    } as unknown as Response);
    await expect(
      emails.deliver(
        encryption.encrypt(
          JSON.stringify({
            to: 'user@example.com',
            subject: 'Test',
            text: 'Test',
          }),
        ),
        'id',
      ),
    ).rejects.toThrow('Brevo HTTP 429');
    expect(readBody).not.toHaveBeenCalled();
  });

  it('skips optional email while disabled and fails password recovery explicitly', async () => {
    const disabled = new EmailService(
      new ConfigService({ EMAIL_ENABLED: 'false' }),
      {} as DataSource,
      encryption,
    );
    await disabled.enqueue(
      { to: 'user@example.com', subject: 'Test', text: 'Test' },
      manager,
    );
    expect(save).not.toHaveBeenCalled();
    await expect(
      disabled.queuePasswordReset(
        'user@example.com',
        'token',
        new Date(),
        manager,
      ),
    ).rejects.toThrow('not configured');
  });

  it.each(['//evil.example/reset', 'https://evil.example', '/\\evil.example'])(
    'rejects unsafe reset paths %s',
    (path) => {
      const service = new EmailService(
        new ConfigService({ ...settings, PASSWORD_RESET_PATH: path }),
        {} as DataSource,
        encryption,
      );
      expect(() => service.passwordResetUrl('token')).toThrow();
    },
  );

  it('encodes reset tokens and escapes HTML attributes', () => {
    expect(emails.passwordResetUrl('a&b')).toBe(
      'https://app.example.com/reset-password?token=a%26b',
    );
    expect(escapeHtml('<a href="x">&\'</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;',
    );
  });

  it('keeps arbitrary notification content out of email and delivers review outcomes to pending users', async () => {
    await emails.queueNotification(
      'user@example.com',
      manager,
      'Patient details',
      'sensitive clinical notes',
    );
    expect(encryption.decrypt(save.mock.calls[0][0].payload!)).not.toContain(
      'sensitive clinical notes',
    );
    await emails.queueNotification(
      'user@example.com',
      manager,
      'Membership approved',
      'Licence review is still pending.',
    );
    expect(
      JSON.parse(encryption.decrypt(save.mock.calls[1][0].payload!)),
    ).toMatchObject({
      subject: 'OncoSourz: Membership approved',
      text: 'Licence review is still pending.',
    });
  });

  it('uses the insert transaction for registration and notifications written outside NotificationService', async () => {
    const accountCreated = jest
      .spyOn(emails, 'queueAccountCreated')
      .mockResolvedValue(undefined);
    const notification = jest
      .spyOn(emails, 'queueNotification')
      .mockResolvedValue(undefined);
    const user = {
      id: 'u',
      email: encryption.encrypt('user@example.com'),
      active: false,
    } as User;
    const transactionManager = {
      getRepository: () => ({ findOneBy: () => Promise.resolve(user) }),
    } as unknown as EntityManager;
    const db = { subscribers: [] } as unknown as DataSource;
    const subscriber = new EmailEventsSubscriber(db, emails, encryption);
    await subscriber.afterInsert({
      metadata: { target: User },
      entity: user,
      manager: transactionManager,
    } as unknown as InsertEvent<User>);
    await subscriber.afterInsert({
      metadata: { target: Notification },
      entity: {
        user: { id: 'u' },
        title: 'Membership approved',
        message: 'Approved',
      },
      manager: transactionManager,
    } as unknown as InsertEvent<Notification>);
    expect(accountCreated).toHaveBeenCalledWith(
      'user@example.com',
      false,
      transactionManager,
    );
    expect(notification).toHaveBeenCalledWith(
      'user@example.com',
      transactionManager,
      'Membership approved',
      'Approved',
    );
    subscriber.onModuleDestroy();
    expect(db.subscribers).toHaveLength(0);
  });
});

describe('durable email worker', () => {
  function setup(overrides: Partial<EmailOutbox> = {}, failure = false) {
    const row = Object.assign(new EmailOutbox(), {
      id: 'id',
      payload: 'encrypted',
      status: 'PENDING',
      attempts: 0,
      expires_at: null,
      ...overrides,
    });
    const builder = {
      where: jest.fn(),
      orderBy: jest.fn(),
      take: jest.fn(),
      setLock: jest.fn(),
      setOnLocked: jest.fn(),
      getOne: jest
        .fn<Promise<EmailOutbox | null>, []>()
        .mockResolvedValueOnce(row)
        .mockResolvedValue(null),
    };
    for (const method of [
      'where',
      'orderBy',
      'take',
      'setLock',
      'setOnLocked',
    ] as const)
      builder[method].mockReturnValue(builder);
    const save = jest.fn();
    const manager = {
      getRepository: () => ({ createQueryBuilder: () => builder, save }),
    };
    const db = {
      transaction: (fn: (manager: EntityManager) => Promise<unknown>) =>
        fn(manager as unknown as EntityManager),
    } as unknown as DataSource;
    const deliver = failure
      ? jest.fn().mockRejectedValue(new Error('provider down'))
      : jest.fn().mockResolvedValue('message-id');
    const emails = { enabled: () => true, deliver } as unknown as EmailService;
    return { row, builder, save, deliver, worker: new EmailWorker(db, emails) };
  }

  it('locks queued rows across workers, records acceptance, and removes delivered content', async () => {
    const { worker, row, deliver, builder } = setup();
    await worker.flush();
    expect(builder.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(builder.setOnLocked).toHaveBeenCalledWith('skip_locked');
    expect(deliver).toHaveBeenCalledWith('encrypted', 'id');
    expect(row).toMatchObject({
      status: 'SENT',
      payload: null,
      message_id: 'message-id',
      attempts: 1,
    });
  });

  it('retains failed messages for retry and caps retries without throwing into the business action', async () => {
    const retry = setup({}, true);
    await expect(retry.worker.flush()).resolves.toBeUndefined();
    expect(retry.row).toMatchObject({
      status: 'PENDING',
      payload: 'encrypted',
      attempts: 1,
    });
    const failed = setup({ attempts: 7 }, true);
    await failed.worker.flush();
    expect(failed.row).toMatchObject({
      status: 'FAILED',
      payload: null,
      attempts: 8,
    });
  });

  it('never delivers expired password reset links', async () => {
    const { worker, row, deliver } = setup({
      expires_at: new Date(Date.now() - 1),
    });
    await worker.flush();
    expect(deliver).not.toHaveBeenCalled();
    expect(row).toMatchObject({ status: 'EXPIRED', payload: null });
  });

  it.each([
    [new Error('Brevo HTTP 401'), 'Brevo HTTP 401'],
    [
      new DOMException('private details', 'TimeoutError'),
      'Email provider request timed out',
    ],
    [new TypeError('fetch failed'), 'Email provider connection failed'],
    [
      new Error('secret-key user@example.com'),
      'Delivery error (details suppressed to protect sensitive data)',
    ],
  ])('logs a safe delivery diagnostic for %s', async (error, reason) => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    try {
      const { worker, deliver } = setup();
      deliver.mockRejectedValue(error);
      await worker.flush();
      expect(warn).toHaveBeenCalledWith(
        `Email id delivery failed (attempt 1, PENDING): ${reason}`,
      );
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(
        /secret-key|user@example\.com|private details/,
      );
    } finally {
      warn.mockRestore();
    }
  });
});
