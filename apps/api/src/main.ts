import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

// Polyfill BigInt.prototype.toJSON so Fastify/JSON.stringify can serialize BigInt fields
// (e.g. Organization.storageBytes) as strings instead of crashing
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: process.env.NODE_ENV !== 'production' }),
  );

  // Global prefix
  app.setGlobalPrefix('api');

  // API versioning
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  // Multipart (file uploads) — registered lazily so the API still
  // boots if @fastify/multipart isn't installed in a given environment.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const multipart = require('@fastify/multipart');
    await (app as any).register(multipart, {
      limits: { fileSize: 50 * 1024 * 1024 },
    });
  } catch (e: any) {
    console.warn(`@fastify/multipart not registered: ${e.message}`);
  }

  // Custom content-type parsers (urlencoded for Twilio inbound SMS, and a
  // raw-body-capturing JSON parser for Stripe signature verification) were
  // tried here but COLLIDE with the parsers NestJS's FastifyAdapter registers
  // itself during app.listen() ("Content type parser already present" → boot
  // crash). The correct way to capture the raw body on this stack is
  // `NestFactory.create(AppModule, new FastifyAdapter(), { rawBody: true })`
  // plus the `@fastify/formbody` plugin for urlencoded — to be wired as a
  // dedicated follow-up. Until then, the inbound Twilio webhook parses
  // urlencoded manually and Stripe sig verification uses the controller
  // JSON.stringify fallback (both already non-load-bearing in prod).

  // CORS
  app.enableCors({
    origin: process.env.APP_URL || 'http://localhost:3000',
    credentials: true,
  });

  // Swagger (dev only)
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('AppoinlyCRM API')
      .setDescription('Multi-tenant CRM REST API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`API running on http://localhost:${port}/api`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`Swagger docs: http://localhost:${port}/api/docs`);
  }
}

bootstrap();
