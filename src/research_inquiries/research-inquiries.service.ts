import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResearchInquiry } from './entities/research-inquiry.entity';
@Injectable()
export class ResearchInquiriesService {
  constructor(
    @InjectRepository(ResearchInquiry)
    private readonly rows: Repository<ResearchInquiry>,
  ) {}
  create(data: Partial<ResearchInquiry>) {
    return this.rows.save(this.rows.create(data));
  }
  async stats() {
    return { inquiryCount: await this.rows.count() };
  }
}
