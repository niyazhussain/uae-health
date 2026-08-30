const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

interface ErrorResponse {
  message?: string | string[];
}

function responseMessage(error: ErrorResponse, fallback: string): string {
  if (Array.isArray(error.message)) return error.message.join(" ");
  return error.message ?? fallback;
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    return responseMessage((await response.json()) as ErrorResponse, fallback);
  } catch {
    return fallback;
  }
}

async function patientAppointmentRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(new URL(path, apiBaseUrl), {
    cache: "no-store",
    credentials: "include",
    ...init,
  });

  if (!response.ok) {
    throw new PatientAppointmentsApiError(
      await readError(
        response,
        `Patient appointment request failed (${response.status}).`,
      ),
      response.status,
    );
  }

  return (await response.json()) as T;
}

export class PatientAppointmentsApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PatientAppointmentsApiError";
    this.status = status;
  }
}

export interface BookablePatientPractice {
  bookablePracticeId: string;
  practiceName: string;
  timezone?: string;
}

export interface PatientBookablePracticesResponse {
  bookablePractices: BookablePatientPractice[];
}

export interface PatientAppointmentRelationship {
  appointmentRelationshipId: string;
  practiceName: string;
}

export interface PatientAppointmentSlot {
  slotId: string;
  startsAt: string;
  endsAt: string;
}

export interface PatientAppointmentAvailabilityResponse {
  practiceName: string;
  timezone: string;
  slots: PatientAppointmentSlot[];
}

export type PatientAppointmentStatus =
  "requested" | "confirmed" | "declined" | "cancelled";

export interface PatientAppointment {
  appointmentId: string;
  status: PatientAppointmentStatus;
  startsAt: string;
  endsAt: string;
  version: number;
  canCancel: boolean;
  canReschedule: boolean;
}

export interface PatientAppointmentsResponse {
  practiceName: string;
  timezone: string;
  appointments: PatientAppointment[];
}

export interface PatientAppointmentCommandResponse {
  appointment: PatientAppointment;
}

export async function getBookablePatientPractices(): Promise<
  PatientBookablePracticesResponse
> {
  return patientAppointmentRequest("/v1/patient-appointments/bookable-practices");
}

export async function createPatientAppointmentRelationship(
  csrfToken: string,
  bookablePracticeId: string,
  idempotencyKey: string,
): Promise<PatientAppointmentRelationship> {
  return patientAppointmentRequest("/v1/patient-appointments/relationships", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ bookablePracticeId }),
  });
}

export async function getPatientAppointmentAvailability(): Promise<
  PatientAppointmentAvailabilityResponse
> {
  return patientAppointmentRequest("/v1/patient-appointments/availability");
}

export async function getPatientAppointments(): Promise<
  PatientAppointmentsResponse
> {
  return patientAppointmentRequest("/v1/patient-appointments");
}

export async function createPatientAppointment(
  csrfToken: string,
  slotId: string,
  idempotencyKey: string,
): Promise<PatientAppointmentCommandResponse> {
  return patientAppointmentRequest("/v1/patient-appointments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ slotId }),
  });
}

export async function cancelPatientAppointment(
  csrfToken: string,
  appointmentId: string,
  version: number,
  idempotencyKey: string,
): Promise<PatientAppointmentCommandResponse> {
  return patientAppointmentRequest(
    `/v1/patient-appointments/${encodeURIComponent(appointmentId)}/cancellation`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({ version }),
    },
  );
}

export async function reschedulePatientAppointment(
  csrfToken: string,
  appointmentId: string,
  slotId: string,
  version: number,
  idempotencyKey: string,
): Promise<PatientAppointmentCommandResponse> {
  return patientAppointmentRequest(
    `/v1/patient-appointments/${encodeURIComponent(appointmentId)}/reschedule`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({ slotId, version }),
    },
  );
}
