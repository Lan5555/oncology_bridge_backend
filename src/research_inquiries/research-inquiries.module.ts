import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ResearchInquiry } from './entities/research-inquiry.entity';
import { ResearchInquiriesController } from './research-inquiries.controller';
import { ResearchInquiriesService } from './research-inquiries.service';
@Module({
  imports: [TypeOrmModule.forFeature([ResearchInquiry])],
  controllers: [ResearchInquiriesController],
  providers: [ResearchInquiriesService],
})
export class ResearchInquiriesModule {}
