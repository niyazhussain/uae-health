import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CognitoWorkforceDirectoryAdapter } from './cognito-workforce-directory.adapter.js';
import {
  COGNITO_WORKFORCE_DIRECTORY,
  WORKFORCE_DIRECTORY_REPOSITORY,
} from './workforce-directory.constants.js';
import { WorkforceDirectoryController } from './workforce-directory.controller.js';
import { WorkforceDirectoryRepository } from './workforce-directory.repository.js';
import { WorkforceDirectoryService } from './workforce-directory.service.js';

@Module({
  imports: [AuthModule],
  controllers: [WorkforceDirectoryController],
  providers: [
    WorkforceDirectoryRepository,
    CognitoWorkforceDirectoryAdapter,
    WorkforceDirectoryService,
    {
      provide: WORKFORCE_DIRECTORY_REPOSITORY,
      useExisting: WorkforceDirectoryRepository,
    },
    {
      provide: COGNITO_WORKFORCE_DIRECTORY,
      useExisting: CognitoWorkforceDirectoryAdapter,
    },
  ],
})
export class WorkforceDirectoryModule {}
