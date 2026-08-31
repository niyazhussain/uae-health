import type {
  PatientAppointmentCommandView,
  PatientAppointmentPractitionerOptionView,
  PatientAppointmentServiceView,
  PatientAppointmentView,
  PatientProviderAwareAppointmentView,
} from './patient-appointments.types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function decodeService(value: unknown): PatientAppointmentServiceView | null {
  if (!isRecord(value)) return null;
  const specialty = value.specialty;
  const facility = value.facility;
  if (
    typeof value.appointmentServiceId !== 'string' ||
    typeof value.patientFacingName !== 'string' ||
    !isInteger(value.durationMinutes) ||
    value.durationMinutes <= 0 ||
    typeof value.allowsAnyPractitioner !== 'boolean' ||
    !isRecord(specialty) ||
    typeof specialty.specialtyId !== 'string' ||
    typeof specialty.name !== 'string' ||
    !isRecord(facility) ||
    typeof facility.facilityId !== 'string' ||
    typeof facility.name !== 'string' ||
    typeof facility.timezone !== 'string'
  ) {
    return null;
  }

  return {
    appointmentServiceId: value.appointmentServiceId,
    patientFacingName: value.patientFacingName,
    durationMinutes: value.durationMinutes,
    allowsAnyPractitioner: value.allowsAnyPractitioner,
    specialty: {
      specialtyId: specialty.specialtyId,
      name: specialty.name,
    },
    facility: {
      facilityId: facility.facilityId,
      name: facility.name,
      timezone: facility.timezone,
    },
  };
}

function decodePractitionerOption(
  value: unknown,
): PatientAppointmentPractitionerOptionView | null {
  if (
    !isRecord(value) ||
    typeof value.practitionerOptionId !== 'string' ||
    typeof value.displayName !== 'string' ||
    typeof value.professionalTitle !== 'string'
  ) {
    return null;
  }

  return {
    practitionerOptionId: value.practitionerOptionId,
    displayName: value.displayName,
    professionalTitle: value.professionalTitle,
  };
}

/**
 * Decode and reconstruct one durable appointment command snapshot through a
 * strict patient-facing allowlist. A legacy snapshot remains valid, while an
 * expanded provider-aware snapshot must contain its complete scheduling
 * bundle or fail closed.
 */
export function decodeStoredAppointmentCommandView(
  value: unknown,
): PatientAppointmentCommandView | null {
  if (!isRecord(value)) return null;
  const version = value.version;
  if (
    typeof value.appointmentId !== 'string' ||
    (value.status !== 'requested' &&
      value.status !== 'confirmed' &&
      value.status !== 'declined' &&
      value.status !== 'cancelled') ||
    typeof value.startsAt !== 'string' ||
    typeof value.endsAt !== 'string' ||
    !isInteger(version) ||
    typeof value.canCancel !== 'boolean' ||
    typeof value.canReschedule !== 'boolean'
  ) {
    return null;
  }

  const baseAppointment: PatientAppointmentView = {
    appointmentId: value.appointmentId,
    status: value.status,
    startsAt: value.startsAt,
    endsAt: value.endsAt,
    version,
    canCancel: value.canCancel,
    canReschedule: value.canReschedule,
  };
  const hasProviderAwareField =
    value.slotId !== undefined ||
    value.service !== undefined ||
    value.practitionerOption !== undefined;
  if (!hasProviderAwareField) return baseAppointment;

  const service = decodeService(value.service);
  const practitionerOption = decodePractitionerOption(value.practitionerOption);
  if (typeof value.slotId !== 'string' || !service || !practitionerOption) {
    return null;
  }

  const providerAwareAppointment: PatientProviderAwareAppointmentView = {
    ...baseAppointment,
    slotId: value.slotId,
    service,
    practitionerOption,
  };
  return providerAwareAppointment;
}
