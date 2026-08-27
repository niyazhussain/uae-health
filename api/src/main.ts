import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { PATIENT_PORTAL_COOKIE_AUTH } from './patient-portal-auth/patient-portal-auth.constants.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.enableCors({
    origin: config
      .getOrThrow<string>('CORS_ORIGIN')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-CSRF-Token'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  if (config.getOrThrow<string>('ENABLE_API_DOCS') === 'true') {
    const sessionCookieName =
      config.getOrThrow<string>('SESSION_COOKIE_SECURE') === 'true'
        ? '__Host-uae_health_session'
        : 'uae_health_session_local';
    const patientSessionCookieName =
      config.getOrThrow<string>('SESSION_COOKIE_SECURE') === 'true'
        ? '__Host-uae_health_patient_session'
        : 'uae_health_patient_session_local';
    const documentConfig = new DocumentBuilder()
      .setTitle('UAE Health API')
      .setDescription('Development API contract for the UAE Health platform.')
      .setVersion('0.1')
      .addBearerAuth()
      .addCookieAuth(sessionCookieName)
      .addCookieAuth(
        patientSessionCookieName,
        undefined,
        PATIENT_PORTAL_COOKIE_AUTH,
      )
      .build();
    const documentFactory = () =>
      SwaggerModule.createDocument(app, documentConfig);

    SwaggerModule.setup('docs', app, documentFactory, {
      jsonDocumentUrl: 'docs/openapi.json',
    });
  }

  await app.listen(config.getOrThrow<number>('PORT'));
}
void bootstrap();
