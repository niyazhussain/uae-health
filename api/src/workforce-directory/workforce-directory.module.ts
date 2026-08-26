import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { IdentityProviderModule } from '../identity-provider/identity-provider.module.js';
import { WORKFORCE_DIRECTORY_REPOSITORY } from './workforce-directory.constants.js';
import { WorkforceDirectoryController } from './workforce-directory.controller.js';
import { WorkforceDirectoryRepository } from './workforce-directory.repository.js';
import { WorkforceDirectoryService } from './workforce-directory.service.js';

@Module({
  imports: [AuthModule, IdentityProviderModule],
  controllers: [WorkforceDirectoryController],
  providers: [
    WorkforceDirectoryRepository,
    WorkforceDirectoryService,
    {
      provide: WORKFORCE_DIRECTORY_REPOSITORY,
      useExisting: WorkforceDirectoryRepository,
    },
  ],
})
export class WorkforceDirectoryModule {}
