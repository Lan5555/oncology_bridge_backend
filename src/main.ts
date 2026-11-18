import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import type { Request } from 'express';
import { NetResponseFilter } from './helpers/net-response.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  if (process.env.TRUST_PROXY === '1') {
    app.set('trust proxy', 1);
  }
  const configuredOrigins = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const useDevelopmentFallback =
    !configuredOrigins.length && process.env.NODE_ENV !== 'production';
  app.enableCors((request: Request, callback) => {
    const origin = request.headers.origin ?? '';
    callback(null, {
      origin: useDevelopmentFallback || configuredOrigins,
      credentials:
        configuredOrigins.includes(origin) ||
        (useDevelopmentFallback && origin === 'http://localhost:3001'),
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Idempotency-Key',
        'Last-Event-ID',
        'x-paystack-signature',
      ],
    });
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // remove extra fields
      forbidNonWhitelisted: true, // throw error on extra fields
      transform: true, // automatically transform types
    }),
  );
  app.useGlobalFilters(new NetResponseFilter());
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
