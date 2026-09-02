export type SchedulingStatus = "active" | "inactive" | "retired";

export interface SchedulingFacilityContext {
  facilityId: string;
  facilityName: string;
  timezone: string;
}

export interface SchedulingContext {
  tenantId: string;
  tenantName: string;
  organizationId: string;
  organizationName: string;
  canManagePracticeCatalogue: boolean;
  facilities: SchedulingFacilityContext[];
}

export interface SchedulingContextsResponse {
  contexts: SchedulingContext[];
}

export interface SchedulingPage<T> {
  page: number;
  pageSize: number;
  total: number;
  items: T[];
}

export interface PractitionerFacilityAssignment {
  assignmentId: string;
  facilityId: string;
  facilityName: string;
  status: "active" | "inactive";
  updatedAt: string;
}

export interface PractitionerServiceAssignment {
  assignmentId: string;
  practitionerFacilityAssignmentId: string;
  appointmentServiceId: string;
  serviceName: string;
  facilityId: string;
  status: "active" | "inactive";
  updatedAt: string;
}

export interface SchedulingPractitioner {
  practitionerId: string;
  displayName: string;
  professionalTitle: string;
  status: "active" | "inactive";
  applicationUserLinked: boolean;
  updatedAt: string;
  facilityAssignments: PractitionerFacilityAssignment[];
  serviceAssignments: PractitionerServiceAssignment[];
}

export interface SchedulingSpecialty {
  specialtyId: string;
  code: string;
  name: string;
  status: "active" | "retired";
  updatedAt: string;
}

export interface SchedulingService {
  appointmentServiceId: string;
  facilityId: string;
  facilityName: string;
  specialtyId: string;
  specialtyName: string;
  code: string;
  patientFacingName: string;
  durationMinutes: number;
  allowsAnyPractitioner: boolean;
  status: "active" | "inactive";
  publishable: boolean;
  activePractitionerCount: number;
  updatedAt: string;
  practitionerAssignments: PractitionerServiceAssignment[];
}

export interface SchedulingAvailabilityTemplate {
  availabilityTemplateId: string;
  facilityId: string;
  facilityName: string;
  practitionerFacilityAssignmentId: string;
  practitionerServiceAssignmentId: string;
  practitionerId: string;
  practitionerDisplayName: string;
  appointmentServiceId: string;
  serviceName: string;
  durationMinutes: number;
  isoWeekday: number;
  localStartMinute: number;
  localEndMinute: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  sourceTimezone: string;
  status: "active" | "inactive";
  updatedAt: string;
}

export interface SchedulingAvailabilityException {
  availabilityExceptionId: string;
  facilityId: string;
  facilityName: string;
  practitionerFacilityAssignmentId: string | null;
  practitionerId: string | null;
  practitionerDisplayName: string | null;
  kind: "facility_closed" | "practitioner_unavailable";
  isAllDay: boolean;
  localStartsAt: string;
  localEndsAt: string;
  startsAt: string;
  endsAt: string;
  sourceTimezone: string;
  status: "active" | "cancelled";
  updatedAt: string;
}

export interface SchedulingAvailabilitySlot {
  appointmentSlotId: string;
  availabilityTemplateId: string;
  facilityId: string;
  practitionerFacilityAssignmentId: string;
  practitionerServiceAssignmentId: string;
  practitionerId: string;
  appointmentServiceId: string;
  sourceLocalDate: string;
  sourceTimezone: string;
  startsAt: string;
  endsAt: string;
  status: "available" | "withdrawn";
  withdrawalPending: boolean;
  hasLiveAppointment: boolean;
  updatedAt: string;
}

export interface AvailabilityMaterializationSummary {
  horizonStartsOn: string;
  horizonEndsBefore: string;
  sourceTimezone: string;
  createdSlotCount: number;
  reactivatedSlotCount: number;
  withdrawnSlotCount: number;
  preservedLiveSlotCount: number;
  skippedOverlapCount: number;
  affectedAppointmentCount: number;
  affectedAppointmentIds: string[];
  affectedAppointmentIdsTruncated: boolean;
}

export interface AvailabilityTemplateMutationResponse {
  template: SchedulingAvailabilityTemplate;
  replacedTemplateId: string | null;
  materialization: AvailabilityMaterializationSummary;
}

export interface AvailabilityExceptionMutationResponse {
  exception: SchedulingAvailabilityException;
  materialization: AvailabilityMaterializationSummary;
}

export interface ServiceDurationMutationResponse {
  service: SchedulingService;
  materialization: AvailabilityMaterializationSummary;
}

export type SchedulingReasonCode =
  | "catalogue-setup"
  | "staffing-change"
  | "service-configuration"
  | "service-retirement"
  | "availability-configuration"
  | "provider-availability-change"
  | "facility-availability-change"
  | "service-duration-change";

interface ApiErrorBody {
  message?: string | string[];
}

export class WorkforceSchedulingApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "WorkforceSchedulingApiError";
    this.status = status;
  }
}

function apiBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
}

function errorMessage(body: ApiErrorBody, fallback: string): string {
  return Array.isArray(body.message)
    ? body.message.join(" ")
    : (body.message ?? fallback);
}

async function decodeError(
  response: Response,
  fallback: string,
): Promise<never> {
  let body: ApiErrorBody = {};
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    // The status-based fallback is safe for a non-JSON upstream response.
  }
  throw new WorkforceSchedulingApiError(
    errorMessage(body, `${fallback} (${response.status}).`),
    response.status,
  );
}

async function read<T>(
  path: string,
  query?: Record<string, string>,
): Promise<T> {
  const url = new URL(path, apiBaseUrl());
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value) url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "include",
  });
  if (!response.ok) return decodeError(response, "Scheduling request failed");
  return (await response.json()) as T;
}

async function command<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH",
  csrfToken: string,
  input: Record<string, unknown>,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<T> {
  const response = await fetch(new URL(path, apiBaseUrl()), {
    method,
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) return decodeError(response, "Scheduling change failed");
  return (await response.json()) as T;
}

export function getSchedulingContexts(): Promise<SchedulingContextsResponse> {
  return read("/v1/admin/scheduling/contexts");
}

function cataloguePage<T>(
  resource: "practitioners" | "specialties" | "services",
  organizationId: string,
): Promise<SchedulingPage<T>> {
  return read(`/v1/admin/scheduling/${resource}`, {
    organizationId,
    page: "1",
    pageSize: "50",
  });
}

export function getSchedulingPractitioners(
  organizationId: string,
): Promise<SchedulingPage<SchedulingPractitioner>> {
  return cataloguePage("practitioners", organizationId);
}

export function getSchedulingSpecialties(
  organizationId: string,
): Promise<SchedulingPage<SchedulingSpecialty>> {
  return cataloguePage("specialties", organizationId);
}

export function getSchedulingServices(
  organizationId: string,
): Promise<SchedulingPage<SchedulingService>> {
  return cataloguePage("services", organizationId);
}

export function createSchedulingPractitioner(
  csrfToken: string,
  input: {
    organizationId: string;
    facilityId: string;
    displayName: string;
    professionalTitle: string;
  },
): Promise<{ practitioner: SchedulingPractitioner }> {
  return command("/v1/admin/scheduling/practitioners", "POST", csrfToken, {
    ...input,
    reasonCode: "catalogue-setup",
  });
}

export function addPractitionerFacilityAssignment(
  csrfToken: string,
  practitionerId: string,
  organizationId: string,
  facilityId: string,
): Promise<unknown> {
  return command(
    `/v1/admin/scheduling/practitioners/${practitionerId}/facility-assignments`,
    "POST",
    csrfToken,
    { organizationId, facilityId, reasonCode: "staffing-change" },
  );
}

export function changePractitionerFacilityAssignment(
  csrfToken: string,
  assignment: PractitionerFacilityAssignment,
  organizationId: string,
  status: "active" | "inactive",
): Promise<unknown> {
  return command(
    `/v1/admin/scheduling/practitioner-facility-assignments/${assignment.assignmentId}`,
    "PATCH",
    csrfToken,
    {
      organizationId,
      status,
      expectedUpdatedAt: assignment.updatedAt,
      reasonCode: "staffing-change",
    },
  );
}

export function createSchedulingSpecialty(
  csrfToken: string,
  organizationId: string,
  code: string,
  name: string,
): Promise<{ specialty: SchedulingSpecialty }> {
  return command("/v1/admin/scheduling/specialties", "POST", csrfToken, {
    organizationId,
    code,
    name,
    reasonCode: "catalogue-setup",
  });
}

export function updateSchedulingSpecialty(
  csrfToken: string,
  specialty: SchedulingSpecialty,
  organizationId: string,
  input: { name?: string; status?: "active" | "retired" },
): Promise<{ specialty: SchedulingSpecialty }> {
  return command(
    `/v1/admin/scheduling/specialties/${specialty.specialtyId}`,
    "PATCH",
    csrfToken,
    {
      organizationId,
      ...input,
      expectedUpdatedAt: specialty.updatedAt,
      reasonCode:
        input.status === "retired"
          ? "service-retirement"
          : "service-configuration",
    },
  );
}

export function createSchedulingService(
  csrfToken: string,
  input: {
    organizationId: string;
    facilityId: string;
    specialtyId: string;
    code: string;
    patientFacingName: string;
    durationMinutes: number;
    allowsAnyPractitioner: boolean;
  },
): Promise<{ service: SchedulingService }> {
  return command("/v1/admin/scheduling/services", "POST", csrfToken, {
    ...input,
    reasonCode: "catalogue-setup",
  });
}

export function updateSchedulingService(
  csrfToken: string,
  service: SchedulingService,
  organizationId: string,
  input: {
    patientFacingName?: string;
    allowsAnyPractitioner?: boolean;
    status?: "active" | "inactive";
  },
): Promise<{ service: SchedulingService }> {
  return command(
    `/v1/admin/scheduling/services/${service.appointmentServiceId}`,
    "PATCH",
    csrfToken,
    {
      organizationId,
      ...input,
      expectedUpdatedAt: service.updatedAt,
      reasonCode:
        input.status === "inactive"
          ? "service-retirement"
          : "service-configuration",
    },
  );
}

export function createPractitionerServiceAssignment(
  csrfToken: string,
  serviceId: string,
  organizationId: string,
  practitionerFacilityAssignmentId: string,
): Promise<unknown> {
  return command(
    `/v1/admin/scheduling/services/${serviceId}/practitioner-assignments`,
    "POST",
    csrfToken,
    {
      organizationId,
      practitionerFacilityAssignmentId,
      reasonCode: "staffing-change",
    },
  );
}

export function changePractitionerServiceAssignment(
  csrfToken: string,
  assignment: PractitionerServiceAssignment,
  organizationId: string,
  status: "active" | "inactive",
): Promise<unknown> {
  return command(
    `/v1/admin/scheduling/practitioner-service-assignments/${assignment.assignmentId}`,
    "PATCH",
    csrfToken,
    {
      organizationId,
      status,
      expectedUpdatedAt: assignment.updatedAt,
      reasonCode: "staffing-change",
    },
  );
}

export function getSchedulingAvailabilityTemplates(
  organizationId: string,
  facilityId: string,
  page = 1,
  filters?: {
    appointmentServiceId?: string;
    status?: "active" | "inactive";
  },
): Promise<SchedulingPage<SchedulingAvailabilityTemplate>> {
  return read("/v1/admin/scheduling/availability-templates", {
    organizationId,
    facilityId,
    page: String(page),
    pageSize: "50",
    ...(filters?.appointmentServiceId
      ? { appointmentServiceId: filters.appointmentServiceId }
      : {}),
    ...(filters?.status ? { status: filters.status } : {}),
  });
}

export function getSchedulingAvailabilityExceptions(
  organizationId: string,
  facilityId: string,
  page = 1,
): Promise<SchedulingPage<SchedulingAvailabilityException>> {
  return read("/v1/admin/scheduling/availability-exceptions", {
    organizationId,
    facilityId,
    page: String(page),
    pageSize: "50",
  });
}

export function getSchedulingAvailabilitySlots(input: {
  organizationId: string;
  facilityId: string;
  startsAt: string;
  endsAt: string;
  page?: number;
  status?: "available" | "withdrawn";
}): Promise<SchedulingPage<SchedulingAvailabilitySlot>> {
  return read("/v1/admin/scheduling/slots", {
    organizationId: input.organizationId,
    facilityId: input.facilityId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    page: String(input.page ?? 1),
    pageSize: "100",
    ...(input.status ? { status: input.status } : {}),
  });
}

export function createSchedulingAvailabilityTemplate(
  csrfToken: string,
  input: {
    organizationId: string;
    practitionerServiceAssignmentId: string;
    isoWeekday: number;
    localStartMinute: number;
    localEndMinute: number;
    effectiveFrom: string;
    effectiveUntil?: string;
  },
  idempotencyKey: string,
): Promise<AvailabilityTemplateMutationResponse> {
  return command(
    "/v1/admin/scheduling/availability-templates",
    "POST",
    csrfToken,
    {
      ...input,
      status: "inactive",
      reasonCode: "availability-configuration",
    },
    idempotencyKey,
  );
}

export function replaceSchedulingAvailabilityTemplate(
  csrfToken: string,
  template: SchedulingAvailabilityTemplate,
  input: {
    organizationId: string;
    practitionerServiceAssignmentId: string;
    isoWeekday: number;
    localStartMinute: number;
    localEndMinute: number;
    effectiveFrom: string;
    effectiveUntil?: string;
    status: "active" | "inactive";
  },
  idempotencyKey: string,
): Promise<AvailabilityTemplateMutationResponse> {
  return command(
    `/v1/admin/scheduling/availability-templates/${template.availabilityTemplateId}`,
    "PUT",
    csrfToken,
    {
      ...input,
      expectedUpdatedAt: template.updatedAt,
      reasonCode: "availability-configuration",
    },
    idempotencyKey,
  );
}

export function changeSchedulingAvailabilityTemplateStatus(
  csrfToken: string,
  template: SchedulingAvailabilityTemplate,
  organizationId: string,
  status: "active" | "inactive",
  idempotencyKey: string,
): Promise<AvailabilityTemplateMutationResponse> {
  return command(
    `/v1/admin/scheduling/availability-templates/${template.availabilityTemplateId}/status`,
    "PATCH",
    csrfToken,
    {
      organizationId,
      status,
      expectedUpdatedAt: template.updatedAt,
      reasonCode: "availability-configuration",
    },
    idempotencyKey,
  );
}

export function materializeSchedulingAvailabilityTemplate(
  csrfToken: string,
  template: SchedulingAvailabilityTemplate,
  organizationId: string,
  idempotencyKey: string,
): Promise<AvailabilityTemplateMutationResponse> {
  return command(
    `/v1/admin/scheduling/availability-templates/${template.availabilityTemplateId}/materializations`,
    "POST",
    csrfToken,
    {
      organizationId,
      expectedUpdatedAt: template.updatedAt,
      reasonCode: "availability-configuration",
    },
    idempotencyKey,
  );
}

export function createSchedulingAvailabilityException(
  csrfToken: string,
  input: {
    organizationId: string;
    facilityId: string;
    practitionerFacilityAssignmentId?: string;
    kind: "facility_closed" | "practitioner_unavailable";
    isAllDay: boolean;
    localStartsAt: string;
    localEndsAt: string;
  },
  idempotencyKey: string,
): Promise<AvailabilityExceptionMutationResponse> {
  return command(
    "/v1/admin/scheduling/availability-exceptions",
    "POST",
    csrfToken,
    {
      ...input,
      reasonCode:
        input.kind === "facility_closed"
          ? "facility-availability-change"
          : "provider-availability-change",
    },
    idempotencyKey,
  );
}

export function cancelSchedulingAvailabilityException(
  csrfToken: string,
  exception: SchedulingAvailabilityException,
  organizationId: string,
  idempotencyKey: string,
): Promise<AvailabilityExceptionMutationResponse> {
  return command(
    `/v1/admin/scheduling/availability-exceptions/${exception.availabilityExceptionId}/status`,
    "PATCH",
    csrfToken,
    {
      organizationId,
      status: "cancelled",
      expectedUpdatedAt: exception.updatedAt,
      reasonCode:
        exception.kind === "facility_closed"
          ? "facility-availability-change"
          : "provider-availability-change",
    },
    idempotencyKey,
  );
}

export function changeSchedulingServiceDuration(
  csrfToken: string,
  service: SchedulingService,
  organizationId: string,
  durationMinutes: number,
  idempotencyKey: string,
): Promise<ServiceDurationMutationResponse> {
  return command(
    `/v1/admin/scheduling/services/${service.appointmentServiceId}/duration`,
    "PATCH",
    csrfToken,
    {
      organizationId,
      durationMinutes,
      expectedUpdatedAt: service.updatedAt,
      reasonCode: "service-duration-change",
    },
    idempotencyKey,
  );
}
