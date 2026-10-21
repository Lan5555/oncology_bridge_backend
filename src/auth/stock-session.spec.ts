import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { UserSession } from '../user_sessions/entities/user_session.entity';
import { EncryptionService } from '../encryption/encryption.service';

describe('stock grants on session refresh', () => {
  it('reloads grants for both the returned user and newly issued tokens', async () => {
    let granted = true;
    const authenticatedUser = jest.fn(async () => ({
      account_type: 'PHARMACIST',
      verification_status: 'VERIFIED',
      permissions: granted
        ? ['facility.users.manage', 'inventory.manage', 'marketplace.list']
        : ['facility.users.manage'],
      allowed_pages: granted
        ? [
            'pg-dashboard',
            'pg-settings',
            'pg-inventory',
            'pg-scan',
            'pg-medicines',
          ]
        : ['pg-dashboard', 'pg-settings'],
      can_manage_facility_users: true,
      can_manage_inventory: granted,
    }));
    const jwt = {
      verifyAsync: jest.fn().mockResolvedValue({
        tokenType: 'refresh',
        email: 'user@test.example',
      }),
      signAsync: jest.fn().mockResolvedValue('rotated-token'),
    };
    const session = {
      user: { id: 'user', active: true, role: { name: 'FACILITY_ADMIN' } },
      expires_at: new Date(Date.now() + 86400000),
    };
    const sessions = {
      findOne: jest.fn().mockResolvedValue(session),
      save: jest.fn().mockResolvedValue(session),
    };
    const service = new AuthService(
      jwt as unknown as JwtService,
      {} as Repository<User>,
      sessions as unknown as Repository<UserSession>,
      {} as EncryptionService,
      { authenticatedUser } as unknown as UsersService,
    );
    const first = await service.refreshToken('old-token');
    expect(first.data).toMatchObject({
      user: {
        permissions: expect.arrayContaining([
          'inventory.manage',
          'marketplace.list',
        ]),
        allowed_pages: expect.arrayContaining(['pg-scan']),
      },
    });
    expect(jwt.signAsync.mock.calls[0][0]).toMatchObject({
      permissions: expect.arrayContaining(['inventory.manage']),
      can_manage_inventory: true,
    });
    granted = false;
    const second = await service.refreshToken('rotated-token');
    expect(second.data).toMatchObject({
      user: {
        permissions: ['facility.users.manage'],
        can_manage_inventory: false,
      },
    });
    expect(jwt.signAsync.mock.calls[2][0]).toMatchObject({
      permissions: ['facility.users.manage'],
      can_manage_inventory: false,
    });
    expect(authenticatedUser).toHaveBeenCalledTimes(2);
  });
  it('includes listing permission keys in login user data and tokens', async () => {
    const user = {
      id: 'seller',
      active: true,
      role: { name: 'PHARMACIST' },
      verification_status: 'VERIFIED',
      hospital: { status: 'ACTIVE' },
      email: 'encrypted',
      password_hash: await bcrypt.hash('test-password', 4),
    };
    const users = {
      findOne: jest.fn().mockResolvedValue(user),
      save: jest.fn().mockResolvedValue(user),
      manager: { getRepository: () => ({ findOne: async () => null }) },
    };
    const sessions = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((row) => row),
      save: jest.fn(),
    };
    const jwt = { signAsync: jest.fn().mockResolvedValue('token') };
    const authenticatedUser = {
      id: 'seller',
      account_type: 'PHARMACY_STORE',
      permissions: ['marketplace.list'],
      allowed_pages: ['pg-marketplace'],
    };
    const auth = new AuthService(
      jwt as unknown as JwtService,
      users as unknown as Repository<User>,
      sessions as unknown as Repository<UserSession>,
      {
        hash: () => 'hash',
        decrypt: () => 'seller@example.test',
      } as unknown as EncryptionService,
      {
        authenticatedUser: async () => authenticatedUser,
      } as unknown as UsersService,
    );
    const result = await auth.loginUser({
      email: 'seller@example.test',
      password: 'test-password',
    });
    expect(result).toMatchObject({
      success: true,
      data: { user: { permissions: ['marketplace.list'] } },
    });
    expect(jwt.signAsync.mock.calls[0][0]).toMatchObject({
      permissions: ['marketplace.list'],
    });
  });
});
