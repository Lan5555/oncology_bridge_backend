import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserSession } from './entities/user_session.entity';
import { User } from '../users/entities/user.entity';
import { CreateUserSessionDto } from './dto/create-user_session.dto';
import { UpdateUserSessionDto } from './dto/update-user_session.dto';
import { ResponseHelper } from '../helpers/response-helper';
@Injectable()
export class UserSessionsService {
  constructor(
    @InjectRepository(UserSession)
    private readonly sessions: Repository<UserSession>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}
  async create(dto: CreateUserSessionDto) {
    const user = await this.users.findOneBy({ id: dto.userId });
    if (!user) throw new NotFoundException('User not found');
    const expiresAt = dto.expires_at
      ? new Date(dto.expires_at)
      : new Date(Date.now() + 60 * 60 * 1000);
    const row = await this.sessions.save(
      this.sessions.create({
        user,
        refresh_token: dto.refresh_token,
        device_id: dto.device_id,
        ip_address: dto.ip_address,
        expires_at: expiresAt,
      }),
    );
    return ResponseHelper.Success('Session created', this.safe(row));
  }
  async findAll(userId?: string) {
    const rows = await this.sessions.find({
      where: userId ? { user: { id: userId } } : {},
      relations: { user: true },
      order: { created_at: 'DESC' },
    });
    return ResponseHelper.Success(
      'Sessions retrieved',
      rows.map((s) => this.safe(s)),
    );
  }
  async findOne(id: string) {
    const row = await this.sessions.findOne({
      where: { id },
      relations: { user: true },
    });
    if (!row) throw new NotFoundException('Session not found');
    return ResponseHelper.Success('Session retrieved', this.safe(row));
  }
  async update(id: string, _dto: UpdateUserSessionDto) {
    const row = await this.sessions.findOne({
      where: { id },
      relations: { user: true },
    });
    if (!row) throw new NotFoundException('Session not found');
    row.refresh_token = '';
    return ResponseHelper.Success(
      'Session revoked',
      this.safe(await this.sessions.save(row)),
    );
  }
  async remove(id: string) {
    const row = await this.sessions.findOneBy({ id });
    if (!row) throw new NotFoundException('Session not found');
    row.refresh_token = '';
    await this.sessions.save(row);
    return ResponseHelper.Success('Session revoked', null);
  }
  private safe(row: UserSession) {
    return {
      id: row.id,
      userId: row.user?.id,
      deviceId: row.device_id,
      ipAddress: row.ip_address,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      active: !!row.refresh_token && row.expires_at > new Date(),
    };
  }
}
