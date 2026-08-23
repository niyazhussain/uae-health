import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/health (GET)', () => {
    const server = app.getHttpServer() as Server;

    return request(server)
      .get('/health')
      .expect(200)
      .expect((response) => {
        const body: unknown = response.body;

        if (typeof body !== 'object' || body === null) {
          throw new Error('Health response body must be an object.');
        }

        const health = body as Record<string, unknown>;
        expect(health.status).toBe('ok');
        expect(typeof health.timestamp).toBe('string');

        if (typeof health.timestamp === 'string') {
          expect(new Date(health.timestamp).toISOString()).toBe(
            health.timestamp,
          );
        }
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
