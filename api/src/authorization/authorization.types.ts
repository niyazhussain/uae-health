import type { Kysely, Transaction } from 'kysely';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import type { DatabaseSchema } from '../database/database.types.js';

export type AuthorizationDatabaseExecutor =
  Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;

export interface AuthorizationRequest {
  principal: AuthenticatedPrincipal;
  tenantId: string;
  organizationId: string;
  facilityId?: string;
  permissionCode: string;
  confidential: boolean;
  action: string;
  targetEntityType: string;
  targetEntityId: string;
  correlationId: string;
  reason: string;
}

export interface AuthorizedAccess {
  applicationUserId: string;
  membershipId: string;
}

export interface AuthorizationRepositoryPort {
  findAuthorizedAccess(
    request: AuthorizationRequest,
    executor?: AuthorizationDatabaseExecutor,
  ): Promise<AuthorizedAccess | null>;
  recordDeniedAccess(
    request: AuthorizationRequest,
    executor?: AuthorizationDatabaseExecutor,
  ): Promise<void>;
}

export class AuthorizationDeniedError extends Error {
  constructor() {
    super('The current authorization does not permit this operation.');
  }
}
