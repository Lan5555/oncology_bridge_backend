import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { AuthGuard } from '../guards/auth.guard';
import { ResponseHelper } from '../helpers/response-helper';
import {
  CheckManifestDto,
  DispensePackDto,
  UploadManifestDto,
} from './dto/manifest.dto';
import { PharmacyManifestService } from './pharmacy-manifest.service';
import {
  ManifestBodyPipe,
  manifestBadRequest,
  issue,
  record,
} from './manifest-validation';
import {
  ManifestSpreadsheetService,
  DeliveryFile,
} from './manifest-spreadsheet.service';
import { ManifestResponseFilter } from './manifest-response.filter';

type ActorRequest = Request & { user: { id: string } };

@Controller('api/manifests')
@UseGuards(AuthGuard)
@UseFilters(ManifestResponseFilter)
export class PharmacyManifestController {
  constructor(
    private readonly manifests: PharmacyManifestService,
    private readonly spreadsheets: ManifestSpreadsheetService,
  ) {}

  @Post()
  async upload(
    @Body(new ManifestBodyPipe()) dto: unknown,
    @Req() req: ActorRequest,
    @Ip() ip: string,
  ) {
    return ResponseHelper.Success(
      'Pharmacy manifest uploaded.',
      await this.manifests.upload(dto as UploadManifestDto, req.user.id, ip),
    );
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('manifest', {
      limits: { fileSize: 1024 * 1024, files: 1, fields: 0 },
    }),
  )
  async uploadFile(
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Req() req: ActorRequest,
    @Ip() ip: string,
  ) {
    if (!file?.buffer.length)
      throw new BadRequestException('A JSON manifest file is required.');
    let body: unknown;
    try {
      body = JSON.parse(file.buffer.toString('utf8'));
    } catch {
      throw new BadRequestException('Manifest must contain valid JSON.');
    }
    const dto = new ManifestBodyPipe().transform(body);
    return ResponseHelper.Success(
      'Pharmacy manifest uploaded.',
      await this.manifests.upload(dto, req.user.id, ip),
    );
  }

  @Get('import/template')
  async template(
    @Query('format') format: string = 'xlsx',
    @Req() req: ActorRequest,
  ) {
    await this.manifests.assertImportAccess(req.user.id);
    const file = await this.spreadsheets.template(format);
    return new StreamableFile(file.buffer, {
      type: file.contentType,
      disposition: `attachment; filename="${file.filename}"`,
    });
  }

  @Post('import/preview')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 5 * 1024 * 1024,
        files: 1,
        fields: 1,
        fieldSize: 1024,
      },
    }),
  )
  async preview(
    @UploadedFile() file: DeliveryFile | undefined,
    @Body() input: unknown,
    @Req() req: ActorRequest,
  ) {
    await this.manifests.assertImportAccess(req.user.id);
    const body = record(input);
    if (Object.keys(body).some((field) => field !== 'reference'))
      throw manifestBadRequest([
        issue(
          0,
          'reference',
          'FIELD_UNEXPECTED',
          'Submit only the delivery reference. Your pharmacy is selected from your account.',
        ),
      ]);
    if (
      typeof body.reference !== 'string' ||
      !body.reference.trim() ||
      body.reference.length > 120
    )
      throw manifestBadRequest([
        issue(
          0,
          'reference',
          'INVALID_REFERENCE',
          'Enter a delivery reference of 1 to 120 characters.',
        ),
      ]);
    const parsed = await this.spreadsheets.parse(file);
    return ResponseHelper.Success(
      'Delivery spreadsheet reviewed.',
      await this.manifests.preview(parsed, body.reference, req.user.id),
    );
  }

  @Get()
  async list(@Req() req: ActorRequest, @Query('reference') reference?: string) {
    return ResponseHelper.Success(
      'Pharmacy manifests retrieved.',
      await this.manifests.list(req.user.id, reference),
    );
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: ActorRequest,
  ) {
    return ResponseHelper.Success(
      'Pharmacy manifest retrieved.',
      await this.manifests.findOne(id, req.user.id),
    );
  }
}

@Controller('api/scans')
@UseGuards(AuthGuard)
export class ManifestScanController {
  constructor(private readonly manifests: PharmacyManifestService) {}

  @Post('manifest-check')
  async check(@Body() dto: CheckManifestDto, @Req() req: ActorRequest) {
    return ResponseHelper.Success(
      'Manifest assessment completed.',
      await this.manifests.check(dto.rawBarcode, req.user.id),
    );
  }

  @Post('dispense')
  async dispense(
    @Body() dto: DispensePackDto,
    @Req() req: ActorRequest,
    @Ip() ip: string,
  ) {
    return ResponseHelper.Success(
      'Dispensing assessment recorded.',
      await this.manifests.dispense(dto, req.user.id, ip),
    );
  }
}
