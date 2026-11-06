import { matchers } from '../../test/matchers';
import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthGuard } from '../guards/auth.guard';
import { MedicineVerificationController } from './medicine-verification.controller';
import { MedicineVerificationService } from './medicine-verification.service';
import { Gs1ImageDecoderService } from './gs1-image-decoder.service';

describe('medicine verification HTTP contract', () => {
  let app: INestApplication;
  let actor = 'user';
  const verify = jest.fn(() =>
    Promise.resolve({
      authenticity: { status: 'UNVERIFIED' },
    }),
  );
  const decode = jest.fn(() =>
    Promise.resolve({ rawBarcode: '(01)09506000134352' }),
  );
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [MedicineVerificationController],
      providers: [
        { provide: MedicineVerificationService, useValue: { verify } },
        { provide: Gs1ImageDecoderService, useValue: { decode } },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (context: import('@nestjs/common').ExecutionContext) => {
          if (!actor) throw new UnauthorizedException();
          context
            .switchToHttp()
            .getRequest<{ user: Record<string, unknown> }>().user = {
            id: actor,
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it('requires authentication for both routes', async () => {
    actor = '';
    await request(app.getHttpServer() as import('node:http').Server)
      .post('/api/scans/verify')
      .send({ gtin: '09506000134352' })
      .expect(401);
    await request(app.getHttpServer() as import('node:http').Server)
      .post('/api/scans/verify-image')
      .expect(401);
    expect(verify).not.toHaveBeenCalled();
  });
  it('returns the shared response envelope without facility/intake fields', async () => {
    actor = 'read-only-user';
    const result = await request(
      app.getHttpServer() as import('node:http').Server,
    )
      .post('/api/scans/verify')
      .send({ gtin: '09506000134352' })
      .expect(201);
    expect(result.body).toMatchObject({
      success: true,
      data: { authenticity: { status: 'UNVERIFIED' } },
    });
  });
  it('rejects unknown fields and oversized strings', async () => {
    await request(app.getHttpServer() as import('node:http').Server)
      .post('/api/scans/verify')
      .send({ gtin: '09506000134352', authenticity: 'VERIFIED' })
      .expect(400);
    await request(app.getHttpServer() as import('node:http').Server)
      .post('/api/scans/verify')
      .send({ rawBarcode: 'x'.repeat(513) })
      .expect(400);
  });
  it('accepts a normalized NAFDAC number without a barcode and validates comparison fields', async () => {
    actor = 'ng-user';
    await request(app.getHttpServer() as import('node:http').Server)
      .post('/api/scans/verify')
      .send({
        nafdacNumber: ' a4-1234 ',
        productName: 'Example',
        strength: '20 mg',
      })
      .expect(201);
    expect(verify).toHaveBeenLastCalledWith(
      matchers.objectContaining({
        nafdacNumber: 'A4-1234',
        productName: 'Example',
        strength: '20 mg',
      }),
    );
    await request(app.getHttpServer() as import('node:http').Server)
      .post('/api/scans/verify')
      .send({ nafdacNumber: ' ' })
      .expect(400);
    await request(app.getHttpServer() as import('node:http').Server)
      .post('/api/scans/verify')
      .send({ nafdacNumber: 'A4-1234', strength: 'x'.repeat(201) })
      .expect(400);
  });
  it('accepts image-only uploads and forwards the original barcode', async () => {
    actor = 'image-user';
    await request(app.getHttpServer() as import('node:http').Server)
      .post('/api/scans/verify-image')
      .attach('image', Buffer.from('mocked decoder input'), {
        filename: 'scan.png',
        contentType: 'image/png',
      })
      .expect(201);
    expect(verify).toHaveBeenLastCalledWith({
      rawBarcode: '(01)09506000134352',
    });
    await request(app.getHttpServer() as import('node:http').Server)
      .post('/api/scans/verify-image')
      .field('nafdacNumber', 'a4-1234')
      .field('productName', 'Example')
      .attach('image', Buffer.from('mocked'), {
        filename: 'scan.png',
        contentType: 'image/png',
      })
      .expect(201);
    expect(verify).toHaveBeenLastCalledWith(
      matchers.objectContaining({
        rawBarcode: '(01)09506000134352',
        nafdacNumber: 'A4-1234',
        productName: 'Example',
      }),
    );
    await request(app.getHttpServer() as import('node:http').Server)
      .post('/api/scans/verify-image')
      .attach('image', Buffer.from('bad'), {
        filename: 'scan.txt',
        contentType: 'text/plain',
      })
      .expect(400);
  });
  it('shares a per-user limit between raw and image requests', async () => {
    actor = 'limited-user';
    for (let i = 0; i < 10; i++)
      await request(app.getHttpServer() as import('node:http').Server)
        .post('/api/scans/verify')
        .send({ gtin: '09506000134352' })
        .expect(201);
    await request(app.getHttpServer() as import('node:http').Server)
      .post('/api/scans/verify-image')
      .expect(429);
  });
});
