import {
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  BinaryBitmap,
  DataMatrixReader,
  DecodeHintType,
  HybridBinarizer,
  RGBLuminanceSource,
} from '@zxing/library';
import * as jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { Medicine } from '../medicine/entities/medicine.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import {
  normalizeGs1Expiry,
  parseGs1,
  validateIdentifiers,
} from './gs1-parser';

export interface UploadedScannerImage {
  mimetype: string;
  buffer: Buffer;
}

@Injectable()
export class Gs1ImageDecoderService {
  constructor(
    @InjectRepository(Medicine)
    private readonly medicines: Repository<Medicine>,
  ) {}

  async decode(file: UploadedScannerImage) {
    const { data, width, height } = this.readImage(file);
    if (width * height > 40_000_000)
      throw new BadRequestException(
        'Image dimensions exceed the decode limit.',
      );

    let raw: string;
    try {
      const hints = new Map([[DecodeHintType.TRY_HARDER, true]]);
      const bitmap = new BinaryBitmap(
        new HybridBinarizer(
          new RGBLuminanceSource(new Uint8ClampedArray(data), width, height),
        ),
      );
      raw = new DataMatrixReader().decode(bitmap, hints).getText();
    } catch {
      throw new BadRequestException(
        'No readable GS1 DataMatrix was found in the image.',
      );
    }

    const identifiers = parseGs1(raw);
    const validation = validateIdentifiers(identifiers);
    if (
      !identifiers.gtin &&
      !identifiers.lot &&
      !identifiers.expiry &&
      !identifiers.serial
    )
      throw new UnprocessableEntityException({
        message:
          'The image contains a readable code, but no supported GS1 identifiers were found.',
        data: { identifiers, validation },
      });

    const expiry = normalizeGs1Expiry(identifiers.expiry);
    const medicine = identifiers.gtin
      ? await this.medicines.findOneBy({ gtin: identifiers.gtin })
      : null;

    return {
      identifiers: {
        ...identifiers,
        expiry,
      },
      validation,
      medicine: medicine
        ? {
            id: medicine.id,
            name: medicine.generic_name,
            brand: medicine.brand_name,
          }
        : null,
    };
  }

  private readImage(file: UploadedScannerImage) {
    if (!file?.buffer?.length)
      throw new BadRequestException('Image file is required.');
    const isPng = file.buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJpeg = file.buffer[0] === 0xff && file.buffer[1] === 0xd8;
    if (!isPng && !isJpeg)
      throw new BadRequestException('Only JPEG and PNG images are supported.');
    try {
      const image = isPng
        ? PNG.sync.read(file.buffer)
        : jpeg.decode(file.buffer, { useTArray: true, formatAsRGBA: true });
      if (!image.width || !image.height)
        throw new Error('Invalid image dimensions');
      return { data: image.data, width: image.width, height: image.height };
    } catch {
      throw new BadRequestException('The uploaded image could not be decoded.');
    }
  }
}
