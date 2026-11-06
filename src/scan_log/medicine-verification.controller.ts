import {
  Body,
  Controller,
  HttpException,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { AuthGuard } from '../guards/auth.guard';
import { ResponseHelper } from '../helpers/response-helper';
import {
  VerifyMedicineDto,
  VerifyMedicineImageDto,
} from './dto/verify-medicine.dto';
import {
  Gs1ImageDecoderService,
  UploadedScannerImage,
} from './gs1-image-decoder.service';
import { MedicineVerificationService } from './medicine-verification.service';

type VerificationRequest = Request & { user?: { id: string } };

@Controller('api/scans')
@UseGuards(AuthGuard)
export class MedicineVerificationController {
  private readonly attempts = new Map<string, number[]>();
  constructor(
    private readonly verification: MedicineVerificationService,
    private readonly decoder: Gs1ImageDecoderService,
  ) {}

  private throttle(request: VerificationRequest) {
    if (!request.user?.id)
      throw new HttpException('Authentication required.', 401);
    const now = Date.now();
    for (const [key, values] of this.attempts) {
      if (values.every((at) => now - at >= 60_000)) this.attempts.delete(key);
    }
    const key = request.user.id;
    const attempts = (this.attempts.get(key) ?? []).filter(
      (at) => now - at < 60_000,
    );
    if (attempts.length >= 10)
      throw new HttpException(
        'Verification limit reached. Try again in one minute.',
        429,
      );
    attempts.push(now);
    this.attempts.set(key, attempts);
  }

  @Post('verify')
  async verify(
    @Body() dto: VerifyMedicineDto,
    @Req() request: VerificationRequest,
  ) {
    this.throttle(request);
    return ResponseHelper.Success(
      'Medicine verification assessment completed.',
      await this.verification.verify(dto),
    );
  }

  @Post('verify-image')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: {
        fileSize: 10 * 1024 * 1024,
        files: 1,
        fields: 7,
        fieldSize: 1024,
      },
      fileFilter: (_req, file, callback) =>
        callback(
          ['image/jpeg', 'image/png'].includes(file.mimetype)
            ? null
            : new BadRequestException(
                'Only JPEG and PNG images are supported.',
              ),
          ['image/jpeg', 'image/png'].includes(file.mimetype),
        ),
    }),
  )
  async verifyImage(
    @UploadedFile() image: UploadedScannerImage | undefined,
    @Body() dto: VerifyMedicineImageDto,
    @Req() request: VerificationRequest,
  ) {
    this.throttle(request);
    if (!image) throw new BadRequestException('Image file is required.');
    const decoded = await this.decoder.decode(image);
    return ResponseHelper.Success(
      'Medicine verification assessment completed.',
      await this.verification.verify({
        ...dto,
        rawBarcode: decoded.rawBarcode,
      }),
    );
  }
}
