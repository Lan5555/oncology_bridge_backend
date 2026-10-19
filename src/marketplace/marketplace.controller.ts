import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { AuthGuard } from '../guards/auth.guard';
import { MarketplaceService } from './marketplace.service';
import {
  CheckoutDto,
  CreateListingDto,
  ListingQueryDto,
} from './marketplace.dto';
import type { ListingUpload } from './cloudinary-images.service';

type MarketplaceRequest = Request & { user: { id: string } };
@Controller('api/marketplace')
@UseGuards(AuthGuard)
export class MarketplaceController {
  constructor(private readonly service: MarketplaceService) {}
  @Get('listings') browse(
    @Req() req: MarketplaceRequest,
    @Query() query: ListingQueryDto,
  ) {
    return this.service.browse(req.user.id, query);
  }
  @Post('listings')
  @UseInterceptors(
    FilesInterceptor('images', 5, {
      limits: {
        files: 5,
        fileSize: 5 * 1024 * 1024,
        fields: 8,
        fieldSize: 8192,
        parts: 13,
      },
    }),
  )
  create(
    @Req() req: MarketplaceRequest,
    @Body() body: CreateListingDto,
    @UploadedFiles() images: ListingUpload[],
  ) {
    return this.service.createListing(req.user.id, body, images);
  }
  @Post('checkout')
  @HttpCode(200)
  checkout(
    @Req() req: MarketplaceRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: CheckoutDto,
  ) {
    return this.service.checkout(req.user.id, key, body);
  }
}

@Controller('api/payments/paystack')
export class MarketplacePaymentsController {
  constructor(private readonly service: MarketplaceService) {}
  @Post('webhook')
  @HttpCode(200)
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature: string | undefined,
    @Body() body: unknown,
  ) {
    return this.service.webhook(req.rawBody, signature, body);
  }
}
