import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { User } from '../users/entities/user.entity';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdateNotificationDto } from './dto/update-notification.dto';
import { ResponseHelper } from '../helpers/response-helper';
@Injectable()
export class NotificationService {
  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}
  async create(dto: CreateNotificationDto) {
    const user = await this.users.findOneBy({ id: dto.userId });
    if (!user) throw new NotFoundException('User not found');
    const n = await this.notifications.save(
      this.notifications.create({
        user,
        title: dto.title,
        message: dto.message,
      }),
    );
    return ResponseHelper.Success('Notification created', n);
  }
  async findAll(userId?: string) {
    const rows = await this.notifications.find({
      where: userId ? { user: { id: userId } } : {},
      relations: { user: true },
      order: { created_at: 'DESC' },
      take: 200,
    });
    return ResponseHelper.Success(
      'Notifications retrieved',
      rows.map((n) => ({
        id: n.id,
        userId: n.user?.id,
        title: n.title,
        body: n.message,
        readAt: n.read ? n.created_at : null,
        createdAt: n.created_at,
      })),
    );
  }
  async findOne(id: string) {
    const n = await this.notifications.findOne({
      where: { id },
      relations: { user: true },
    });
    if (!n) throw new NotFoundException('Notification not found');
    return ResponseHelper.Success('Notification retrieved', n);
  }
  async update(id: string, dto: UpdateNotificationDto) {
    const n = await this.notifications.findOneBy({ id });
    if (!n) throw new NotFoundException('Notification not found');
    if (dto.title !== undefined) n.title = dto.title;
    if (dto.message !== undefined) n.message = dto.message;
    if (dto.read !== undefined) n.read = dto.read;
    return ResponseHelper.Success(
      'Notification updated',
      await this.notifications.save(n),
    );
  }
  async markRead(id: string) {
    return this.update(id, { read: true } as UpdateNotificationDto);
  }
  async remove(id: string) {
    const n = await this.notifications.findOneBy({ id });
    if (!n) throw new NotFoundException('Notification not found');
    await this.notifications.remove(n);
    return ResponseHelper.Success('Notification removed', null);
  }
}
