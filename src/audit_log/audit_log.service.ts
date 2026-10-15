/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-base-to-string */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  ForbiddenException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './entities/audit_log.entity';
import { User } from '../users/entities/user.entity';
import { CreateAuditLogDto } from './dto/create-audit_log.dto';
import { UpdateAuditLogDto } from './dto/update-audit_log.dto';
import { ResponseHelper } from '../helpers/response-helper';

@Injectable()
export class AuditLogService {
  constructor(
    @InjectRepository(AuditLog) private readonly audits: Repository<AuditLog>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}
  async create(dto: CreateAuditLogDto, actorId: string) {
    const actor = await this.users.findOneBy({ id: actorId });
    if (!actor) throw new NotFoundException('Audit actor not found');
    const log = this.audits.create({
      user: actor,
      action: dto.action,
      description: dto.description,
      ip_address: dto.ip_address ?? 'unknown',
    });
    return ResponseHelper.Success(
      'Audit event appended',
      await this.audits.save(log),
    );
  }
  async findAll(
    options: { type?: string; page?: number; limit?: number; actor?: string; from?: string; to?: string } = {},
  ) {
    const page = Math.max(1, Number(options.page) || 1),
      limit = Math.min(200, Math.max(1, Number(options.limit) || 50));
    const qb = this.audits
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.user', 'user')
      .orderBy('a.created_at', 'DESC');
    if (options.type) qb.andWhere('a.action = :type', { type: options.type });
    if (options.actor) qb.andWhere('user.id = :actor', { actor: options.actor });
    if (options.from) {
      const from = new Date(options.from);
      if (Number.isNaN(from.getTime())) throw new BadRequestException('Invalid from date');
      qb.andWhere('a.created_at >= :from', { from });
    }
    if (options.to) {
      const to = new Date(options.to);
      if (Number.isNaN(to.getTime())) throw new BadRequestException('Invalid to date');
      qb.andWhere('a.created_at <= :to', { to });
    }
    const [rows, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return ResponseHelper.Success('Audit records retrieved', {
      items: rows.map((a) => ({
        id: a.id,
        at: a.created_at,
        actorId: a.user?.id,
        actor: a.user ? `${a.user.first_name} ${a.user.last_name}` : null,
        type: a.action,
        detail: a.description,
        ip: a.ip_address,
      })),
      total,
      page,
      limit,
    });
  }
  async findOne(id: string) {
    const row = await this.audits.findOne({
      where: { id },
      relations: { user: true },
    });
    if (!row) throw new NotFoundException('Audit record not found');
    return ResponseHelper.Success('Audit record retrieved', row);
  }
  async exportCsv(actorId: string, options: { type?: string; actor?: string; from?: string; to?: string } = {}) {
    const result: any = await this.findAll({ ...options, limit: 200 });
    const rows = result.data?.items ?? [];
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [
      'id,at,actorId,actor,type,detail,ip',
      ...rows.map((r: any) =>
        [r.id, r.at, r.actorId, r.actor, r.type, r.detail, r.ip]
          .map(q)
          .join(','),
      ),
    ].join('\n');
    const actor = await this.users.findOneBy({ id: actorId });
    if (actor) await this.audits.save(this.audits.create({
      user: actor, action: 'AUDIT_EXPORTED',
      description: `Audit CSV exported${options.type ? ` with action filter ${options.type}` : ''}`,
      ip_address: 'admin-api', event_key: null,
    }));
    return ResponseHelper.Success('Audit export generated', { csv });
  }
  verifyChain() {
    return ResponseHelper.Success(
      'Hash-chain verification is unavailable because the existing audit entity does not store chain hashes',
      {
        verifiable: false,
        reason:
          'Existing audit_logs schema contains no prev_hash or hash fields',
      },
    );
  }
  update(_id: string, _dto: UpdateAuditLogDto): never {
    throw new ForbiddenException('Audit records are append-only');
  }
  remove(_id: string): never {
    throw new ForbiddenException('Audit records are append-only');
  }
}
