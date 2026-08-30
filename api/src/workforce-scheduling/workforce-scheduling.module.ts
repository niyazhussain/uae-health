import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { IdentityProviderModule } from '../identity-provider/identity-provider.module.js';
import { WorkforceSchedulingController } from './workforce-scheduling.controller.js';
import { WorkforceSchedulingRepository } from './workforce-scheduling.repository.js';
import { WorkforceSchedulingService } from './workforce-scheduling.service.js';

@Module({
  imports: [AuthModule, AuthorizationModule, IdentityProviderModule],
  controllers: [WorkforceSchedulingController],
  providers: [WorkforceSchedulingRepository, WorkforceSchedulingService],
})
export class WorkforceSchedulingModule {}
