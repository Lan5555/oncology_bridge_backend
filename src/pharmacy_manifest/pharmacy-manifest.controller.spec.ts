import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthGuard } from '../guards/auth.guard';
import {
  ManifestScanController,
  PharmacyManifestController,
} from './pharmacy-manifest.controller';
import { PharmacyManifestService } from './pharmacy-manifest.service';
import { ManifestSpreadsheetService } from './manifest-spreadsheet.service';

describe('manifest HTTP validation', () => {
  let app: INestApplication;
  const service = {
    upload: jest.fn().mockResolvedValue({ packCount: 1 }),
    dispense: jest.fn().mockResolvedValue({ canDispense: false }),
    assertImportAccess: jest.fn().mockResolvedValue(undefined),
    preview: jest
      .fn()
      .mockResolvedValue({ canImport: false, packs: [], issues: [] }),
  };
  const manifest = {
    reference: 'DELIVERY-1',
    packs: [
      { gtin: '09506000134352', serial: 'S1', lot: 'B1', expiry: '2027-12-31' },
    ],
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PharmacyManifestController, ManifestScanController],
      providers: [
        { provide: PharmacyManifestService, useValue: service },
        ManifestSpreadsheetService,
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest<{ user: { id: string } }>().user = {
            id: 'actor',
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
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => {
    await app.close();
  });
  it('accepts a JSON file upload and passes the authenticated actor', async () => {
    await request(app.getHttpServer() as Server)
      .post('/api/manifests/upload')
      .attach(
        'manifest',
        Buffer.from(JSON.stringify(manifest)),
        'manifest.json',
      )
      .expect(201);
    expect(service.upload).toHaveBeenCalledWith(
      manifest,
      'actor',
      expect.any(String),
    );
  });
  it.each([
    { ...manifest, facilityId: 'untrusted' },
    { ...manifest, packs: [{ ...manifest.packs[0], quantity: 2 }] },
    { ...manifest, packs: [{ ...manifest.packs[0], serial: '' }] },
    { ...manifest, packs: [] },
  ])('rejects invalid nested file rows or facility override', async (body) => {
    await request(app.getHttpServer() as Server)
      .post('/api/manifests/upload')
      .attach('manifest', Buffer.from(JSON.stringify(body)), 'manifest.json')
      .expect(400);
    expect(service.upload).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON', async () => {
    await request(app.getHttpServer() as Server)
      .post('/api/manifests/upload')
      .attach('manifest', Buffer.from('{broken'), 'manifest.json')
      .expect(400);
    expect(service.upload).not.toHaveBeenCalled();
  });
  it('validates dispensing idempotency keys', async () => {
    await request(app.getHttpServer() as Server)
      .post('/api/scans/dispense')
      .send({ rawBarcode: 'scan', clientUuid: 'invalid' })
      .expect(400);
    expect(service.dispense).not.toHaveBeenCalled();
  });
  it('returns the blocked decision inside the response envelope', async () => {
    const response = await request(app.getHttpServer() as Server)
      .post('/api/scans/dispense')
      .send({
        rawBarcode: 'scan',
        clientUuid: 'bd9d8d89-e680-4981-a0e0-5a7719272a36',
      })
      .expect(201);
    expect(response.body).toMatchObject({
      success: true,
      data: { canDispense: false },
    });
  });
  it('serves downloadable template files under the static import route', async () => {
    await request(app.getHttpServer() as Server)
      .get('/api/manifests/import/template?format=xlsx')
      .expect(200)
      .expect('Content-Type', /spreadsheetml/)
      .expect('Content-Disposition', /attachment.*xlsx/);
    await request(app.getHttpServer() as Server)
      .get('/api/manifests/import/template?format=csv')
      .expect(200)
      .expect('Content-Type', /text\/csv/);
  });
  it('previews a readable file using HTTP 200 and never calls save', async () => {
    const response = await request(app.getHttpServer() as Server)
      .post('/api/manifests/import/preview')
      .field('reference', 'REF')
      .attach(
        'file',
        Buffer.from('gtin,lot,serial,expiry\n09506000134352,B1,S1,2027-12-31'),
        'delivery.csv',
      )
      .expect(200);
    expect(response.body).toMatchObject({
      success: true,
      message: 'Delivery spreadsheet reviewed.',
    });
    expect(service.preview).toHaveBeenCalledWith(
      expect.objectContaining({ totalRows: 1, rowNumbers: [2] }),
      'REF',
      'actor',
    );
    expect(service.upload).not.toHaveBeenCalled();
  });
  it('returns 415 for unsupported files and 413 for files larger than 5 MiB', async () => {
    await request(app.getHttpServer() as Server)
      .post('/api/manifests/import/preview')
      .field('reference', 'REF')
      .attach('file', Buffer.from('pdf'), 'delivery.pdf')
      .expect(415);
    await request(app.getHttpServer() as Server)
      .post('/api/manifests/import/preview')
      .field('reference', 'REF')
      .attach('file', Buffer.alloc(5 * 1024 * 1024 + 1), 'delivery.csv')
      .expect(413);
  });
  it('rejects a submitted facility override', async () => {
    await request(app.getHttpServer() as Server)
      .post('/api/manifests/import/preview')
      .field('facilityId', 'other')
      .attach('file', Buffer.from('gtin,lot,serial,expiry'), 'delivery.csv')
      .expect(400);
    expect(service.preview).not.toHaveBeenCalled();
  });
  it('requires stock authorization before parsing previews or serving templates', async () => {
    service.assertImportAccess.mockRejectedValueOnce(
      new ForbiddenException('Permission denied'),
    );
    await request(app.getHttpServer() as Server)
      .get('/api/manifests/import/template')
      .expect(403);
    service.assertImportAccess.mockRejectedValueOnce(
      new ForbiddenException('Permission denied'),
    );
    await request(app.getHttpServer() as Server)
      .post('/api/manifests/import/preview')
      .field('reference', 'REF')
      .attach('file', Buffer.from('malformed'), 'delivery.xlsx')
      .expect(403);
  });
  it('provides structured save issues in the existing failure envelope', async () => {
    const response = await request(app.getHttpServer() as Server)
      .post('/api/manifests')
      .send({ reference: 'REF', packs: [{ ...manifest.packs[0], serial: '' }] })
      .expect(400);
    expect(response.body).toMatchObject({
      success: false,
      data: {
        issues: [
          expect.objectContaining({
            row: 1,
            field: 'serial',
            code: 'SERIAL_REQUIRED',
          }),
        ],
      },
    });
  });
  it('preserves structured 409 conflict issues and never exposes raw server errors', async () => {
    service.upload.mockRejectedValueOnce(
      new ConflictException({
        message: 'Already saved',
        data: {
          issues: [
            {
              row: 0,
              field: 'reference',
              code: 'REFERENCE_ALREADY_EXISTS',
              message: 'Check saved deliveries.',
            },
          ],
        },
      }),
    );
    const response = await request(app.getHttpServer() as Server)
      .post('/api/manifests')
      .send(manifest)
      .expect(409);
    expect(response.body).toMatchObject({
      success: false,
      data: { issues: [{ code: 'REFERENCE_ALREADY_EXISTS' }] },
    });
    service.upload.mockRejectedValueOnce(new Error('SELECT private_db_error'));
    const failure = await request(app.getHttpServer() as Server)
      .post('/api/manifests')
      .send(manifest)
      .expect(500);
    expect(JSON.stringify(failure.body)).not.toMatch(
      /SELECT|private_db_error|stack/i,
    );
  });
});
