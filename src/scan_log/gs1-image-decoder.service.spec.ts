import {
  BarcodeFormat,
  DataMatrixWriter,
  EncodeHintType,
} from '@zxing/library';
import sharp from 'sharp';
import { Repository } from 'typeorm';
import { Medicine } from '../medicine/entities/medicine.entity';
import { Gs1ImageDecoderService } from './gs1-image-decoder.service';

describe('GS1 DataMatrix image decoding', () => {
  it.each([
    '(01)09506000134352(17)991231(10)B1(21)S1',
    '01095060001343521799123110B1\u001d21S1',
  ])('decodes an actual RGBA PNG with payload %s', async (raw) => {
    const hints = new Map([[EncodeHintType.DATA_MATRIX_SHAPE, 1]]);
    const base = new DataMatrixWriter().encode(
      raw,
      BarcodeFormat.DATA_MATRIX,
      0,
      0,
      hints,
    );
    const bits = new DataMatrixWriter().encode(
      raw,
      BarcodeFormat.DATA_MATRIX,
      base.getWidth() * 8,
      base.getHeight() * 8,
      hints,
    );
    const width = bits.getWidth() + 40,
      height = bits.getHeight() + 40;
    const pixels = Buffer.alloc(width * height * 4, 255);
    for (let y = 0; y < bits.getHeight(); y++) {
      for (let x = 0; x < bits.getWidth(); x++) {
        if (!bits.get(x, y)) continue;
        const offset = ((y + 20) * width + x + 20) * 4;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
      }
    }
    const medicines = { findOneBy: jest.fn().mockResolvedValue(null) };
    const service = new Gs1ImageDecoderService(
      medicines as unknown as Repository<Medicine>,
    );
    const buffer = await sharp(pixels, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();
    expect(
      await service.decode({ mimetype: 'image/png', buffer }),
    ).toMatchObject({
      rawBarcode: raw,
      identifiers: {
        gtin: '09506000134352',
        expiry: '2099-12-31',
        lot: 'B1',
        serial: 'S1',
      },
      validation: { valid: true },
    });
  });
});
