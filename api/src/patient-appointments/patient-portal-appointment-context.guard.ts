import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { PatientPortalAuthenticatedRequest } from '../patient-portal-auth/patient-portal-auth.types.js';

/**
 * Apply after PatientPortalSessionAuthenticationGuard on appointment APIs.
 * The only accepted scopes are the server-restored active profile or one
 * server-restored pending appointment relationship. Browser input never
 * supplies a tenant, organization, profile, or relationship scope.
 */
@Injectable()
export class PatientPortalAppointmentContextGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<PatientPortalAuthenticatedRequest>();
    const patientContext = request.patientPortalSession?.context;

    if (
      patientContext?.kind !== 'practice' &&
      patientContext?.kind !== 'appointment-onboarding'
    ) {
      throw new ForbiddenException(
        'Select an active practice or appointment relationship before accessing appointments.',
      );
    }

    return true;
  }
}
