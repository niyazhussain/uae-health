import { Inject, Injectable } from '@nestjs/common';
import { AUTHORIZATION_REPOSITORY } from './authorization.constants.js';
import type {
  AuthorizationRepositoryPort,
  AuthorizationRequest,
  AuthorizedAccess,
} from './authorization.types.js';
import { AuthorizationDeniedError } from './authorization.types.js';

@Injectable()
export class AuthorizationService {
  constructor(
    @Inject(AUTHORIZATION_REPOSITORY)
    private readonly repository: AuthorizationRepositoryPort,
  ) {}

  async assertAuthorized(
    request: AuthorizationRequest,
  ): Promise<AuthorizedAccess> {
    const access = await this.repository.findAuthorizedAccess(request);

    if (access) return access;

    await this.repository.recordDeniedAccess(request);
    throw new AuthorizationDeniedError();
  }
}
