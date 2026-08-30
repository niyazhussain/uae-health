import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { IdentityProviderModule } from '../identity-provider/identity-provider.module.js';
import { WorkforceAppointmentQueueController } from './workforce-appointment-queue.controller.js';
import { WorkforceAppointmentQueueRepository } from './workforce-appointment-queue.repository.js';
import { WorkforceAppointmentQueueService } from './workforce-appointment-queue.service.js';
import { WorkforceSchedulingController } from './workforce-scheduling.controller.js';
import { WorkforceSchedulingRepository } from './workforce-scheduling.repository.js';
import { WorkforceSchedulingService } from './workforce-scheduling.service.js';

@Module({
  imports: [AuthModule, AuthorizationModule, IdentityProviderModule],
  controllers: [
    WorkforceSchedulingController,
    WorkforceAppointmentQueueController,
  ],
  providers: [
    WorkforceSchedulingRepository,
    WorkforceSchedulingService,
    WorkforceAppointmentQueueRepository,
    WorkforceAppointmentQueueService,
  ],
})
export class WorkforceSchedulingModule {}
