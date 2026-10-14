import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { NetResponseFilter } from './helpers/net-response.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  if (process.env.TRUST_PROXY === '1') {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }
  const configuredOrigins = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: configuredOrigins.length
      ? configuredOrigins
      : process.env.NODE_ENV === 'production'
        ? []
        : true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Last-Event-ID',
      'x-paystack-signature',
    ],
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
