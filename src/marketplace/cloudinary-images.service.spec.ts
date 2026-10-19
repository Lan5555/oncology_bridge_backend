import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { v2 as cloudinary } from 'cloudinary';
import sharp from 'sharp';
import { Writable } from 'node:stream';
import {
  CloudinaryImagesService,
  ListingUpload,
} from './cloudinary-images.service';

describe('Cloudinary image validation and rollback', () => {
  let service: CloudinaryImagesService;
  let database: { query: jest.Mock };
  let uploaded: Buffer[];
  const config = new ConfigService({
    CLOUDINARY_CLOUD_NAME: 'test',
    CLOUDINARY_API_KEY: 'key',
    CLOUDINARY_API_SECRET: 'secret',
  });
  const image = async (
    format: 'png' | 'jpeg' | 'webp' = 'png',
  ): Promise<ListingUpload> => {
    const buffer = await sharp({
      create: { width: 20, height: 10, channels: 3, background: 'red' },
    })
      .toFormat(format)
      .withMetadata()
      .toBuffer();
    return { buffer, size: buffer.length, mimetype: `image/${format}` };
  };
  beforeEach(() => {
    database = {
      query: jest.fn().mockResolvedValue([{ id: 'pending-image' }]),
    };
    uploaded = [];
    service = new CloudinaryImagesService(
      config,
      database as unknown as DataSource,
    );
    jest.spyOn(cloudinary.uploader, 'upload_stream').mockImplementation(
      ((options: any, callback: any) =>
        new Writable({
          write(chunk, _encoding, done) {
            uploaded.push(Buffer.from(chunk));
            done();
          },
          final(done) {
            callback(null, {
              public_id: options.public_id,
              secure_url: `https://res.cloudinary.com/test/${options.public_id}.webp`,
            });
            done();
          },
        })) as any,
    );
    jest
      .spyOn(cloudinary.uploader, 'destroy')
      .mockResolvedValue({ result: 'ok' });
  });
  afterEach(() => jest.restoreAllMocks());
  it('decodes JPEG, PNG and WebP, strips metadata and keeps stable IDs and cover order', async () => {
    const result = await service.upload(
      await Promise.all([image('jpeg'), image('png'), image('webp')]),
    );
    expect(result.map((r) => r.position)).toEqual([0, 1, 2]);
    expect(new Set(result.map((r) => r.id)).size).toBe(3);
    for (const buffer of uploaded) {
      const metadata = await sharp(buffer).metadata();
      expect(metadata.format).toBe('webp');
      expect(metadata.exif).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
    }
  });
  it('rejects corrupt, unsupported, empty, oversized and excessive photos before upload', async () => {
    await expect(service.upload([])).rejects.toMatchObject({ status: 422 });
    await expect(
      service.upload(Array(6).fill(await image())),
    ).rejects.toMatchObject({ status: 422 });
    for (const buffer of [
      Buffer.alloc(0),
      Buffer.from('corrupt'),
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"></svg>',
      ),
    ]) {
      await expect(
        service.upload([
          { buffer, size: buffer.length, mimetype: 'image/png' },
        ]),
      ).rejects.toMatchObject({ status: 422 });
    }
    await expect(
      service.upload([
        {
          buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
          size: 1,
          mimetype: 'image/png',
        },
      ]),
    ).rejects.toMatchObject({ status: 413 });
    expect(cloudinary.uploader.upload_stream).not.toHaveBeenCalled();
  });
  it('cleans attempted public IDs and retains durable records on partial failure', async () => {
    (cloudinary.uploader.upload_stream as jest.Mock)
      .mockImplementationOnce(
        ((options: any, callback: any) =>
          new Writable({
            final(done) {
              callback(null, {
                public_id: options.public_id,
                secure_url: 'https://res.cloudinary.com/test/1.webp',
              });
              done();
            },
            write(_chunk, _encoding, done) {
              done();
            },
          })) as any,
      )
      .mockImplementationOnce(
        ((_options: any, callback: any) =>
          new Writable({
            final(done) {
              callback(new Error('provider failure'));
              done();
            },
            write(_chunk, _encoding, done) {
              done();
            },
          })) as any,
      );
    await expect(
      service.upload([await image(), await image()]),
    ).rejects.toMatchObject({ status: 503 });
    expect(cloudinary.uploader.destroy).toHaveBeenCalledTimes(2);
    expect(
      database.query.mock.calls.filter(([sql]) => sql.startsWith('INSERT')),
    ).toHaveLength(2);
    expect(
      database.query.mock.calls.filter(([sql]) => sql.startsWith('UPDATE')),
    ).toHaveLength(2);
  });
  it('fails closed when credentials are missing', async () => {
    const missing = new CloudinaryImagesService(
      new ConfigService(),
      database as unknown as DataSource,
    );
    await expect(missing.upload([await image()])).rejects.toMatchObject({
      status: 503,
    });
    expect(cloudinary.uploader.upload_stream).not.toHaveBeenCalled();
  });
  it('never deletes attached images after an uncertain database commit', async () => {
    database.query.mockResolvedValue([]);
    await service.cleanup(['attached-key']);
    expect(cloudinary.uploader.destroy).not.toHaveBeenCalled();
  });
});
