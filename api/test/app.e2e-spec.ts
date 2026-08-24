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

  it('/v1/auth/session rejects a missing workforce session', () => {
    const server = app.getHttpServer() as Server;

    return request(server).get('/v1/auth/session').expect(401).expect({
      message: 'Active workforce session required.',
      error: 'Unauthorized',
      statusCode: 401,
    });
  });

  it('/v1/auth/session exchange rejects a missing Cognito access token', () => {
    const server = app.getHttpServer() as Server;

    return request(server).post('/v1/auth/session').expect(401).expect({
      message: 'Valid Cognito access token required.',
      error: 'Unauthorized',
      statusCode: 401,
    });
  });

  it('/v1/admin/workforce-directory rejects an unauthenticated request', () => {
    const server = app.getHttpServer() as Server;

    return request(server)
      .get('/v1/admin/workforce-directory')
      .expect(401)
      .expect({
        message: 'Active workforce session required.',
        error: 'Unauthorized',
        statusCode: 401,
      });
  });

  it('/v1/admin/workforce-directory/invitations rejects an unauthenticated request', () => {
    const server = app.getHttpServer() as Server;

    return request(server)
      .post('/v1/admin/workforce-directory/invitations')
      .send({
        organizationId: '20000000-0000-4000-8000-000000000001',
        displayName: 'Synthetic Invited Clinician',
        email: 'invited.clinician@example.invalid',
        reason: 'Approved synthetic staging access.',
      })
      .expect(401)
      .expect({
        message: 'Active workforce session required.',
        error: 'Unauthorized',
        statusCode: 401,
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
