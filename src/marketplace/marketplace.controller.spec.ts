import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { AuthGuard } from '../guards/auth.guard';
import { NetResponseFilter } from '../helpers/net-response.filter';

describe('marketplace HTTP contract', () => {
  let app: INestApplication;
  const service = {
    browse: jest.fn(),
    createListing: jest.fn(),
    checkout: jest.fn(),
  };
  const inventoryItemId = '00000000-0000-4000-8000-000000000001';
  const fields = {
    inventoryItemId,
    category: 'Biologics',
    unitPriceNaira: '10.25',
    availableQuantity: '2',
    unit: 'vial',
    storage: '2-8 C',
    description: 'Sealed vial',
    prescriptionRequired: 'true',
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [MarketplaceController],
      providers: [{ provide: MarketplaceService, useValue: service }],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (context) => {
          context.switchToHttp().getRequest().user = { id: 'buyer' };
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
    app.useGlobalFilters(new NetResponseFilter());
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });
  it('accepts multipart fields and ordered repeated images with HTTP 201', async () => {
    service.createListing.mockResolvedValue({
      success: true,
      message: 'Listing submitted.',
      data: { listing: { id: inventoryItemId, status: 'PUBLISHED' } },
    });
    const submission = request(app.getHttpServer()).post(
      '/api/marketplace/listings',
    );
    for (const [key, value] of Object.entries(fields))
      submission.field(key, value);
    await submission
      .attach('images', Buffer.from('cover'), 'cover.png')
      .attach('images', Buffer.from('second'), 'second.png')
      .expect(201);
    const photos = service.createListing.mock.calls[0][2];
    expect(photos.map((p) => p.buffer.toString())).toEqual(['cover', 'second']);
  });
  it('rejects unknown ownership fields and non-literal multipart booleans', async () => {
    for (const changes of [
      { facilityId: inventoryItemId },
      { prescriptionRequired: '1' },
    ]) {
      const submission = request(app.getHttpServer()).post(
        '/api/marketplace/listings',
      );
      for (const [key, value] of Object.entries({ ...fields, ...changes }))
        submission.field(key, value);
      const result = await submission
        .attach('images', Buffer.from('photo'), 'photo.png')
        .expect(400);
      expect(result.body.success).toBe(false);
    }
    expect(service.createListing).not.toHaveBeenCalled();
  });
  it('rejects more than five files and files larger than 5 MiB at the HTTP boundary', async () => {
    const tooMany = request(app.getHttpServer()).post(
      '/api/marketplace/listings',
    );
    for (const [key, value] of Object.entries(fields))
      tooMany.field(key, value);
    for (let index = 0; index < 6; index++)
      tooMany.attach('images', Buffer.from('photo'), `${index}.png`);
    await tooMany.expect(400);
    const oversized = request(app.getHttpServer()).post(
      '/api/marketplace/listings',
    );
    for (const [key, value] of Object.entries(fields))
      oversized.field(key, value);
    await oversized
      .attach('images', Buffer.alloc(5 * 1024 * 1024 + 1), 'photo.png')
      .expect(413);
    expect(service.createListing).not.toHaveBeenCalled();
  });
  it('validates positive integer checkout quantities without accepting client totals', async () => {
    for (const body of [
      { listingId: inventoryItemId, quantity: 0 },
      { listingId: inventoryItemId, quantity: 1.5 },
      { listingId: inventoryItemId, quantity: '2' },
      { listingId: inventoryItemId, quantity: 1, totalNaira: 1 },
    ]) {
      await request(app.getHttpServer())
        .post('/api/marketplace/checkout')
        .send(body)
        .expect(400);
    }
    expect(service.checkout).not.toHaveBeenCalled();
  });
  it('enforces pagination bounds and converts valid query parameters', async () => {
    await request(app.getHttpServer())
      .get('/api/marketplace/listings?limit=101')
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/marketplace/listings?page=-1')
      .expect(400);
    service.browse.mockResolvedValue({
      success: true,
      message: '',
      data: { items: [], total: 0, page: 2, limit: 12 },
    });
    await request(app.getHttpServer())
      .get(
        '/api/marketplace/listings?page=2&limit=12&sort=price_asc&inStock=false',
      )
      .expect(200);
    expect(service.browse).toHaveBeenCalledWith(
      'buyer',
      expect.objectContaining({
        page: 2,
        limit: 12,
        sort: 'price_asc',
        inStock: 'false',
      }),
    );
  });
});
