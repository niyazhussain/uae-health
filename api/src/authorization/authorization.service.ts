import { Inject, Injectable } from '@nestjs/common';
import { AUTHORIZATION_REPOSITORY } from './authorization.constants.js';
import type {
  AuthorizationDatabaseExecutor,
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

  evaluate(
    request: AuthorizationRequest,
    executor?: AuthorizationDatabaseExecutor,
  ): Promise<AuthorizedAccess | null> {
    return this.repository.findAuthorizedAccess(request, executor);
  }

  recordDenied(
    request: AuthorizationRequest,
    executor?: AuthorizationDatabaseExecutor,
  ): Promise<void> {
    return this.repository.recordDeniedAccess(request, executor);
  }

  async assertAuthorized(
    request: AuthorizationRequest,
    executor?: AuthorizationDatabaseExecutor,
  ): Promise<AuthorizedAccess> {
    const access = await this.evaluate(request, executor);

    if (access) return access;

    await this.recordDenied(request, executor);
    throw new AuthorizationDeniedError();
  }
}
