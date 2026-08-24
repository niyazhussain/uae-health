import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.enableCors({
    origin: config
      .getOrThrow<string>('CORS_ORIGIN')
      .split(',')
      .map((origin) => origin.trim()),
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  if (config.getOrThrow<string>('ENABLE_API_DOCS') === 'true') {
    const documentConfig = new DocumentBuilder()
      .setTitle('UAE Health API')
      .setDescription('Development API contract for the UAE Health platform.')
      .setVersion('0.1')
      .addBearerAuth()
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
