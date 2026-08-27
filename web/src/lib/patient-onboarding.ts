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

export class PatientOnboardingApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PatientOnboardingApiError";
    this.status = status;
  }
}

export interface PatientRegistrationInput {
  displayName: string;
  email: string;
}

export async function registerPatient(
  input: PatientRegistrationInput,
  idempotencyKey: string,
): Promise<void> {
  const response = await fetch(
    new URL("/v1/patient-auth/registrations", apiBaseUrl),
    {
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(input),
    },
  );

  if (!response.ok) {
    throw new PatientOnboardingApiError(
      "Registration could not be submitted. Please try again.",
      response.status,
    );
  }
}

export interface PatientPortalInvitationContextsResponse {
  contexts: PatientPortalInvitationContext[];
}

export interface PatientPortalInvitationContext {
  organizationId: string;
  organizationName: string;
  tenantName: string;
}

export interface CreatePatientPortalInvitationInput {
  organizationId: string;
  reason: string;
}

export interface PatientPortalInvitationResponse {
  invitationUrl: string;
  expiresAt?: string;
}

export async function getPatientPortalInvitationContexts(): Promise<
  PatientPortalInvitationContextsResponse
> {
  const response = await fetch(
    new URL("/v1/admin/patient-portal-invitations/contexts", apiBaseUrl),
    {
      cache: "no-store",
      credentials: "include",
    },
  );

  if (!response.ok) {
    throw new PatientOnboardingApiError(
      await readError(
        response,
        `Patient invitation contexts could not be loaded (${response.status}).`,
      ),
      response.status,
    );
  }

  return (await response.json()) as PatientPortalInvitationContextsResponse;
}

export async function createPatientPortalInvitation(
  csrfToken: string,
  input: CreatePatientPortalInvitationInput,
): Promise<PatientPortalInvitationResponse> {
  const response = await fetch(
    new URL("/v1/admin/patient-portal-invitations", apiBaseUrl),
    {
      method: "POST",
      cache: "no-store",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify(input),
    },
  );

  if (!response.ok) {
    throw new PatientOnboardingApiError(
      await readError(
        response,
        `Patient invitation could not be created (${response.status}).`,
      ),
      response.status,
    );
  }

  return (await response.json()) as PatientPortalInvitationResponse;
}

export async function acceptPatientPortalInvitation(
  csrfToken: string,
  token: string,
): Promise<void> {
  const response = await fetch(
    new URL("/v1/patient-auth/invitations/accept", apiBaseUrl),
    {
      method: "POST",
      cache: "no-store",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({ token }),
    },
  );

  if (!response.ok) {
    throw new PatientOnboardingApiError(
      response.status === 401
        ? "The secure session has expired. Sign in again."
        : response.status === 404 || response.status === 410
          ? "This invitation is unavailable. Ask the practice for a new link."
          : "The invitation could not be accepted. Please try again.",
      response.status,
    );
  }
}
