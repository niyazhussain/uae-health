import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type {
  PatientPortalAuthenticatedRequest,
  PatientPortalSessionContext,
} from './patient-portal-auth.types.js';

export const CurrentPatientPortalSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PatientPortalSessionContext => {
    const request = context
      .switchToHttp()
      .getRequest<PatientPortalAuthenticatedRequest>();

    if (!request.patientPortalSession) {
      throw new Error('Authenticated patient portal session is unavailable.');
    }

    return request.patientPortalSession;
  },
);
