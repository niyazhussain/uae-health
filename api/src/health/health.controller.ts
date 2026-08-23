import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DatabaseService } from '../database/database.service.js';

export interface HealthResponse {
  status: 'ok';
  timestamp: string;
}

export interface ReadinessResponse extends HealthResponse {
  database: 'ready';
}

@ApiTags('System')
@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  @ApiOperation({ summary: 'Check whether the API process is available' })
  @ApiOkResponse({ description: 'The API process is accepting requests.' })
  check(): HealthResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Check whether the API dependencies are available' })
  @ApiOkResponse({ description: 'The API and PostgreSQL are ready.' })
  async ready(): Promise<ReadinessResponse> {
    try {
      await this.database.isReady();
    } catch {
      throw new ServiceUnavailableException('Database is not ready.');
    }

    return {
      ...this.check(),
      database: 'ready',
    };
  }
}
