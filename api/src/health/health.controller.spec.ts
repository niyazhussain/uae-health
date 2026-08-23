import { jest } from '@jest/globals';
import { HealthController } from './health.controller.js';
import type { DatabaseService } from '../database/database.service.js';

describe('HealthController', () => {
  const isReady = jest.fn().mockResolvedValue(undefined);
  const database = {
    isReady,
  } as unknown as DatabaseService;
  const controller = new HealthController(database);

  it('returns an available status with an ISO timestamp', () => {
    const response = controller.check();

    expect(response.status).toBe('ok');
    expect(new Date(response.timestamp).toISOString()).toBe(response.timestamp);
  });

  it('returns ready when PostgreSQL accepts a query', async () => {
    const response = await controller.ready();

    expect(isReady).toHaveBeenCalled();
    expect(response.status).toBe('ok');
    expect(response.database).toBe('ready');
  });
});
