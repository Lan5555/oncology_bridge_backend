import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../guards/auth.guard';
import { NetworkAdminGuard } from '../guards/network-admin.guard';
import { PrescriptionReviewService } from './prescription-review.service';
import {
  PrescriptionDecisionDto,
  PrescriptionReviewQueryDto,
} from './prescription-review.dto';
type ReviewRequest = Request & { user: { id: string } };
@Controller('admin/api/prescriptions')
@UseGuards(AuthGuard, NetworkAdminGuard)
export class PrescriptionReviewController {
  constructor(private readonly reviews: PrescriptionReviewService) {}
  @Get() @Header('Cache-Control', 'private, no-store') list(
    @Req() req: ReviewRequest,
    @Query() q: PrescriptionReviewQueryDto,
  ) {
    return this.reviews.list(req.user.id, q);
  }
  @Get(':id') @Header('Cache-Control', 'private, no-store') detail(
    @Req() req: ReviewRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.reviews.detail(req.user.id, id);
  }
  @Post(':id/decision')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  decide(
    @Req() req: ReviewRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PrescriptionDecisionDto,
  ) {
    return this.reviews.decide(req.user.id, id, dto, req.ip ?? 'unknown');
  }
}
