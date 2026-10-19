import { OperationalReadGuard } from '../guards/operational-read.guard';
import { OperationalReadsService } from '../operations/operational-reads.service';
import { OperationalQueryDto } from '../operations/operational-query.dto';
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ForbiddenException,
  HttpException,
  Ip,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { AuthGuard } from '../guards/auth.guard';
import { ScanLogService } from './scan_log.service';
import { CreateScanLogDto } from './dto/create-scan_log.dto';
import { UpdateScanLogDto } from './dto/update-scan_log.dto';
import {
  Gs1ImageDecoderService,
  UploadedScannerImage,
} from './gs1-image-decoder.service';
import { ResponseHelper } from '../helpers/response-helper';

interface ScannerRequest extends Request {
  user?: { id: string };
}

@Controller(['scan-log', 'api/scans'])
@UseGuards(AuthGuard, OperationalReadGuard)
export class ScanLogController {
  private readonly decodeAttempts = new Map<string, number[]>();

  constructor(
    private readonly scanLogService: ScanLogService,
    private readonly decoder: Gs1ImageDecoderService,
    private readonly reads: OperationalReadsService,
  ) {}

  @Post('decode')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
      fileFilter: (_request, file, callback) => {
        if (!['image/jpeg', 'image/png'].includes(file.mimetype)) {
          callback(
            new HttpException('Only JPEG and PNG images are supported.', 400),
            false,
          );
          return;
        }
        callback(null, true);
      },
    }),
  )
  async decode(
    @UploadedFile() image: UploadedScannerImage | undefined,
    @Body() body: Record<string, string>,
    @Req() request: ScannerRequest,
    @Ip() ip: string,
  ) {
    const userId = request.user?.id;
    if (!userId)
      throw new ForbiddenException('Authenticated user is required.');
    if (!image) throw new HttpException('Image file is required.', 400);
    if (!body.facilityId || !body.clientUuid || !body.clientTs)
      throw new HttpException(
        'facilityId, clientUuid and clientTs are required.',
        400,
      );
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        body.facilityId,
      ) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        body.clientUuid,
      ) ||
      Number.isNaN(Date.parse(body.clientTs))
    )
      throw new HttpException(
        'facilityId/clientUuid must be UUIDs and clientTs must be an ISO timestamp.',
        400,
      );
    if (!['NEW', 'AVAILABLE', 'NEAR_EXPIRY'].includes(body.action))
      throw new HttpException(
        'action must be NEW, AVAILABLE, or NEAR_EXPIRY.',
        400,
      );

    const rateKey = `${userId}:${ip}`;
    const now = Date.now();
    const attempts = (this.decodeAttempts.get(rateKey) ?? []).filter(
      (at) => now - at < 60_000,
    );
    if (attempts.length >= 30)
      throw new HttpException(
        'Decode limit reached. Try again in one minute.',
        429,
      );
    attempts.push(now);
    this.decodeAttempts.set(rateKey, attempts);

    await this.scanLogService.assertCanScan({ id: userId }, body.facilityId);
    const decoded = await this.decoder.decode(image);
    return ResponseHelper.Success('GS1 DataMatrix decoded.', decoded);
  }

  @Post()
  create(
    @Body() createScanLogDto: CreateScanLogDto,
    @Req() request: ScannerRequest,
    @Ip() ip: string,
  ) {
    return this.scanLogService.create(
      createScanLogDto,
      { id: request.user!.id },
      ip,
    );
  }
  @Post('batch') batch(
    @Body() body: { scans?: CreateScanLogDto[] } | CreateScanLogDto[],
    @Req() request: ScannerRequest,
    @Ip() ip: string,
  ) {
    const scans = Array.isArray(body) ? body : body.scans;
    return this.scanLogService.batch(
      scans as CreateScanLogDto[],
      { id: request.user!.id },
      ip,
    );
  }
  @Get('recent') recent(
    @Query('limit') limit: string | undefined,
    @Req() request: ScannerRequest,
  ) {
    return this.scanLogService.recent(
      { id: request.user!.id },
      Number(limit) || 5,
    );
  }
  @Get('monthly') monthly(@Req() request: ScannerRequest) {
    return this.scanLogService.monthly({ id: request.user!.id });
  }

  @Get() findAll(
    @Req() req: ScannerRequest,
    @Query() query: OperationalQueryDto,
  ) {
    return this.reads.list('scans', req.user?.id, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() request: ScannerRequest) {
    return this.scanLogService.findOne(id, { id: request.user!.id });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateScanLogDto: UpdateScanLogDto) {
    return this.scanLogService.update(id, updateScanLogDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.scanLogService.remove(id);
  }
}
