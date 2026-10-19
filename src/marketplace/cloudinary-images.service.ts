import {
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  v2 as cloudinary,
  UploadApiOptions,
  UploadApiResponse,
} from 'cloudinary';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

export interface ListingUpload {
  buffer: Buffer;
  size: number;
  mimetype: string;
}
export interface ListingImage {
  id: string;
  storageKey: string;
  url: string;
  alt: string;
  position: number;
  contentType: string;
  byteSize: number;
}

@Injectable()
export class CloudinaryImagesService {
  private readonly logger = new Logger(CloudinaryImagesService.name);
  constructor(
    private readonly config: ConfigService,
    private readonly db: DataSource,
  ) {}

  private options(): UploadApiOptions {
    const cloud_name = this.config.get<string>('CLOUDINARY_CLOUD_NAME');
    const api_key = this.config.get<string>('CLOUDINARY_API_KEY');
    const api_secret = this.config.get<string>('CLOUDINARY_API_SECRET');
    if (!cloud_name || !api_key || !api_secret)
      throw new ServiceUnavailableException(
        'Cloudinary image storage is not configured.',
      );
    return { cloud_name, api_key, api_secret, secure: true, timeout: 30000 };
  }

  async upload(files: ListingUpload[]): Promise<ListingImage[]> {
    if (!Array.isArray(files) || files.length < 1 || files.length > 5)
      throw new HttpException(
        {
          message: 'Upload between 1 and 5 product photos.',
          code: 'INVALID_IMAGE',
        },
        422,
      );
    // Decode every file before sending any data to the provider. Do not trust names or MIME.
    const sanitized: Buffer[] = [];
    for (const file of files) {
      if (!Buffer.isBuffer(file.buffer) || file.buffer.length === 0)
        throw new HttpException(
          { message: 'An image is empty or invalid.', code: 'INVALID_IMAGE' },
          422,
        );
      if (file.buffer.length > 5 * 1024 * 1024)
        throw new HttpException(
          {
            message: 'Each image must be at most 5 MiB.',
            code: 'IMAGE_TOO_LARGE',
          },
          413,
        );
      try {
        const image = sharp(file.buffer, {
          failOn: 'warning',
          limitInputPixels: 25000000,
        });
        const meta = await image.metadata();
        if (
          !['jpeg', 'png', 'webp'].includes(meta.format ?? '') ||
          (meta.pages ?? 1) > 1
        )
          throw new Error('Unsupported image');
        // Sharp strips metadata by default; rotate before stripping EXIF orientation.
        sanitized.push(
          await image
            .rotate()
            .resize({
              width: 2400,
              height: 2400,
              fit: 'inside',
              withoutEnlargement: true,
            })
            .webp({ quality: 85 })
            .toBuffer(),
        );
      } catch {
        throw new HttpException(
          {
            message: 'Upload valid, non-animated JPEG, PNG or WebP photos.',
            code: 'INVALID_IMAGE',
          },
          422,
        );
      }
    }
    const options = this.options();
    const images: ListingImage[] = [];
    const attempted: string[] = [];
    try {
      for (const [position, buffer] of sanitized.entries()) {
        const id = randomUUID();
        const storageKey = `oncology-bridge/marketplace/${id}`;
        // Persist before uploading so even a process crash or provider timeout is recoverable.
        await this.db.query(
          'INSERT INTO marketplace_image_uploads(id,storage_key) VALUES ($1,$2)',
          [id, storageKey],
        );
        attempted.push(storageKey);
        const result = await new Promise<UploadApiResponse>(
          (resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              {
                ...options,
                public_id: storageKey,
                resource_type: 'image',
                type: 'upload',
                overwrite: false,
                format: 'webp',
                allowed_formats: ['webp'],
              },
              (error, result) =>
                error || !result
                  ? reject(
                      new Error(
                        error
                          ? 'Cloudinary upload failed'
                          : 'Empty upload response',
                      ),
                    )
                  : resolve(result),
            );
            stream.on('error', reject);
            stream.end(buffer);
          },
        );
        if (
          !result.secure_url?.startsWith('https://') ||
          result.public_id !== storageKey
        )
          throw new Error('Invalid upload response');
        images.push({
          id,
          storageKey,
          url: result.secure_url,
          alt: `Medicine product packaging, photo ${position + 1}`,
          position,
          contentType: 'image/webp',
          byteSize: buffer.length,
        });
      }
      return images;
    } catch {
      await this.cleanup(attempted);
      throw new ServiceUnavailableException(
        'Product photos could not be stored. Please retry.',
      );
    }
  }

  async cleanup(keys: string[]) {
    for (const key of keys) {
      try {
        // A connection can fail after COMMIT succeeds. Never delete attached photos
        // merely because the caller did not receive the commit acknowledgement.
        const [pending] = await this.db.query<{ id: string }[]>(
          "SELECT id FROM marketplace_image_uploads WHERE storage_key=$1 AND state='PENDING'",
          [key],
        );
        if (!pending) continue;
        const result = (await cloudinary.uploader.destroy(key, {
          ...this.options(),
          resource_type: 'image',
          invalidate: true,
        })) as { result: string };
        if (!['ok', 'not found'].includes(result.result))
          throw new Error('Deletion failed');
        // Keep the durable record for a later retry: a timed-out upload may finish after destroy.
        await this.db.query(
          "UPDATE marketplace_image_uploads SET cleanup_after=now()+interval '1 hour' WHERE storage_key=$1 AND state='PENDING'",
          [key],
        );
      } catch {
        this.logger.warn(`Cloudinary cleanup queued for ${key}`);
      }
    }
  }

  async cleanupPending() {
    const rows = await this.db.query<{ storage_key: string }[]>(
      "SELECT storage_key FROM marketplace_image_uploads WHERE state='PENDING' AND cleanup_after < now() LIMIT 50",
    );
    await this.cleanup(rows.map((r: { storage_key: string }) => r.storage_key));
  }
}
