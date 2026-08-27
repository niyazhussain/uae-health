import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type {
  PatientPortalAuthenticatedRequest,
  PatientPortalPrincipal,
} from './patient-portal-auth.types.js';

export const CurrentPatientPortalPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PatientPortalPrincipal => {
    const request = context
      .switchToHttp()
      .getRequest<PatientPortalAuthenticatedRequest>();

    if (!request.patientPortalPrincipal) {
      throw new Error('Authenticated patient portal principal is unavailable.');
    }

    return request.patientPortalPrincipal;
  },
);
