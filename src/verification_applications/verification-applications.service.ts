import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VerificationApplication } from './entities/verification-application.entity';
@Injectable()
export class VerificationApplicationsService {
  constructor(
    @InjectRepository(VerificationApplication)
    private readonly rows: Repository<VerificationApplication>,
  ) {}
  all(status?: string) {
    return this.rows.find({
      where: status ? { status } : {},
      order: { submitted_at: 'DESC' },
    });
  }
  create(data: Partial<VerificationApplication>) {
    return this.rows.save(
      this.rows.create({
        ...data,
        status: 'MANUAL_REVIEW',
        registry_result: data.registry_result ?? 'UNAVAILABLE',
      }),
    );
  }
  async decide(
    id: string,
    data: { status: string; reviewer_id: string; reason?: string },
  ) {
    const row = await this.rows.findOneBy({ id });
    if (!row) throw new NotFoundException('Verification application not found');
    row.status = data.status;
    row.reviewer_id = data.reviewer_id;
    row.reason = data.reason ?? null;
    row.reviewed_at = new Date();
    return this.rows.save(row);
  }
}
