import { JwtService } from '@nestjs/jwt';
import { EntityManager, Repository } from 'typeorm';
import { AuthService } from './auth.service';
import { User } from '../users/entities/user.entity';
import { UserSession } from '../user_sessions/entities/user_session.entity';
import { UsersService } from '../users/users.service';
import { EncryptionService } from '../encryption/encryption.service';
import { EmailService } from '../email/email.service';
import { PasswordReset } from '../email/entities/password-reset.entity';

describe('password recovery', () => {
  function setup() {
    type Account = { id: string; email: string; password_hash: string };
    let account: Account | null = {
      id: 'user',
      email: 'encrypted-email',
      password_hash: 'old',
    };
    let reset: PasswordReset | null = null;
    const resets = {
      findOne: jest.fn(() => Promise.resolve(reset)),
      findOneBy: jest.fn(({ token_hash }: { token_hash: string }) =>
        Promise.resolve(reset?.token_hash === token_hash ? reset : null),
      ),
      save: jest.fn((value: Omit<PasswordReset, 'created_at'>) => {
        reset = { ...value, created_at: new Date() };
        return Promise.resolve();
      }),
      delete: jest.fn(() => {
        reset = null;
        return Promise.resolve();
      }),
    };
    const sessions = { update: jest.fn() };
    const users = {
      findOneBy: jest.fn(() => Promise.resolve(account)),
      findOne: jest.fn(() => Promise.resolve(account)),
      save: jest.fn(),
    };
    const manager = {
      getRepository: (entity: unknown) =>
        entity === PasswordReset
          ? resets
          : entity === UserSession
            ? sessions
            : users,
    };
    const repository = {
      ...users,
      manager: {
        transaction: jest.fn((fn: (manager: EntityManager) => Promise<void>) =>
          fn(manager as unknown as EntityManager),
        ),
      },
    } as unknown as Repository<User>;
    const encryption = {
      hash: (value: string) => `hash:${value}`,
      decrypt: () => 'user@example.com',
      hashPassword: () => 'new-hash',
    };
    const emails = {
      assertConfigured: jest.fn(),
      passwordResetUrl: jest.fn(),
      queuePasswordReset: jest.fn<
        ReturnType<EmailService['queuePasswordReset']>,
        Parameters<EmailService['queuePasswordReset']>
      >(),
      enqueue: jest.fn(),
    };
    const auth = new AuthService(
      {} as JwtService,
      repository,
      sessions as unknown as Repository<UserSession>,
      encryption as unknown as EncryptionService,
      {} as UsersService,
      emails as unknown as EmailService,
    );
    return {
      auth,
      resets,
      users,
      repository,
      sessions,
      emails,
      manager,
      setAccount: (value: Account | null) => {
        account = value;
      },
      getReset: () => reset,
    };
  }

  it('returns identical responses for known and unknown emails without exposing a token', async () => {
    const s = setup();
    const known = await s.auth.forgotPassword('user@example.com');
    const token = s.emails.queuePasswordReset.mock.calls[0][1];
    expect(s.getReset()!.token_hash).toBe(`hash:${token}`);
    expect(s.emails.queuePasswordReset).toHaveBeenCalledWith(
      'user@example.com',
      token,
      expect.any(Date),
      s.manager,
    );
    expect(JSON.stringify(known)).not.toContain(token);
    s.setAccount(null);
    expect(await s.auth.forgotPassword('missing@example.com')).toEqual(known);
    expect(s.emails.queuePasswordReset).toHaveBeenCalledTimes(1);
  });

  it('throttles repeat requests per account without changing the public response', async () => {
    const s = setup();
    const first = await s.auth.forgotPassword('user@example.com');
    expect(await s.auth.forgotPassword('user@example.com')).toEqual(first);
    expect(s.emails.queuePasswordReset).toHaveBeenCalledTimes(1);
  });

  it('uses persistent tokens across service instances, revokes sessions, and prevents reuse', async () => {
    const s = setup();
    await s.auth.forgotPassword('user@example.com');
    const token = s.emails.queuePasswordReset.mock.calls[0][1];
    const restarted = new AuthService(
      {} as JwtService,
      s.repository,
      s.sessions as unknown as Repository<UserSession>,
      {
        hash: (v: string) => `hash:${v}`,
        decrypt: () => 'user@example.com',
        hashPassword: () => 'new-hash',
      } as unknown as EncryptionService,
      {} as UsersService,
      s.emails as unknown as EmailService,
    );
    await restarted.resetPassword(token, 'new-password');
    expect(s.users.save).toHaveBeenCalledWith(
      expect.objectContaining({ password_hash: 'new-hash' }),
    );
    expect(s.sessions.update).toHaveBeenCalledWith(
      { user: { id: 'user' } },
      { refresh_token: '' },
    );
    expect(s.emails.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Your OncoSourz password was changed',
      }),
      s.manager,
    );
    await expect(s.auth.resetPassword(token, 'new-password')).rejects.toThrow(
      'Invalid or expired',
    );
  });

  it('rejects expired or missing tokens and weak passwords before updating credentials', async () => {
    const s = setup();
    await s.auth.forgotPassword('user@example.com');
    const token = s.emails.queuePasswordReset.mock.calls[0][1];
    s.getReset()!.expires_at = new Date(Date.now() - 1000);
    await expect(s.auth.resetPassword(token, 'new-password')).rejects.toThrow(
      'Invalid or expired',
    );
    await expect(s.auth.resetPassword('', 'new-password')).rejects.toThrow(
      'Invalid or expired',
    );
    await expect(s.auth.resetPassword(token, 'short')).rejects.toThrow(
      'at least 8',
    );
    expect(s.users.save).not.toHaveBeenCalled();
  });
});
