import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type {
  AuthenticatedRequest,
  AuthenticatedSessionContext,
} from './auth.types.js';

export const CurrentWorkforceSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedSessionContext => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.workforceSession) {
      throw new Error('Authenticated workforce session is unavailable.');
    }

    return request.workforceSession;
  },
);
