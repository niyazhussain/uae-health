import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { PatientPortalAuthenticatedRequest } from './patient-portal-auth.types.js';

/**
 * Apply after PatientPortalSessionAuthenticationGuard on practice-owned APIs.
 * The selected profile remains server-authoritative session state.
 */
@Injectable()
export class PatientPortalPracticeContextGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<PatientPortalAuthenticatedRequest>();

    if (request.patientPortalSession?.context.kind !== 'practice') {
      throw new ForbiddenException(
        'Select an active practice before accessing practice data.',
      );
    }

    return true;
  }
}
