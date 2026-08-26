import { Module } from '@nestjs/common';
import { IdentityProviderModule } from '../identity-provider/identity-provider.module.js';
import { AUTHORIZATION_REPOSITORY } from './authorization.constants.js';
import { AuthorizationRepository } from './authorization.repository.js';
import { AuthorizationService } from './authorization.service.js';

@Module({
  imports: [IdentityProviderModule],
  providers: [
    AuthorizationRepository,
    AuthorizationService,
    {
      provide: AUTHORIZATION_REPOSITORY,
      useExisting: AuthorizationRepository,
    },
  ],
  exports: [AuthorizationService],
})
export class AuthorizationModule {}
