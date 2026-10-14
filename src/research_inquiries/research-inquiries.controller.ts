import { Body, Controller, Get, Post } from '@nestjs/common';
import { ResearchInquiry } from './entities/research-inquiry.entity';
import { ResearchInquiriesService } from './research-inquiries.service';
@Controller('api/research')
export class ResearchInquiriesController {
  constructor(private readonly service: ResearchInquiriesService) {}
  @Post('inquiries') create(@Body() body: Partial<ResearchInquiry>) {
    return this.service.create(body);
  }
  @Get('stats') stats() {
    return this.service.stats();
  }
}
