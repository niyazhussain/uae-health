export interface WorkforceDirectoryContext {
  tenantId: string;
  tenantName: string;
  organizationId: string;
  organizationName: string;
}

export interface WorkforceDirectoryUser {
  membershipId: string;
  applicationUserId: string;
  canChangeMembership: boolean;
  roleAssignments: WorkforceRoleAssignment[];
  displayName: string;
  email: string | null;
  membershipStatus: "pending" | "active" | "suspended" | "revoked";
  identityStatus: "active" | "suspended" | null;
  cognitoStatus: string | null;
  cognitoEnabled: boolean | null;
  cognitoCreatedAt: string | null;
  cognitoUpdatedAt: string | null;
  isSynthetic: boolean;
}

export interface WorkforceRoleAssignment {
  assignmentId: string;
  membershipId: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  roleDescription: string;
  organizationId: string;
}

export interface WorkforceAssignableGlobalRole {
  roleId: string;
  code: string;
  name: string;
  description: string;
}

export interface WorkforceDirectoryResponse {
  contexts: WorkforceDirectoryContext[];
  selectedContext: WorkforceDirectoryContext;
  canManageRoles: boolean;
  assignableGlobalRoles: WorkforceAssignableGlobalRole[];
  users: WorkforceDirectoryUser[];
}

export interface CreateWorkforceInvitationInput {
  organizationId: string;
  displayName: string;
  email: string;
  reason: string;
}

export interface WorkforceInvitationResponse {
  applicationUserId: string;
  membershipId: string;
  organizationId: string;
  email: string;
  membershipStatus: "active";
  accountCreated: boolean;
  delivery: "email" | "existing-account";
}

export interface ChangeWorkforceMembershipStatusInput {
  organizationId: string;
  status: "active" | "suspended";
  reason: string;
}

export interface WorkforceMembershipStatusResponse {
  membershipId: string;
  organizationId: string;
  membershipStatus: "active" | "suspended";
  sessionsRevoked: number;
}

export interface AssignWorkforceGlobalRoleInput {
  organizationId: string;
  roleId: string;
  reason: string;
}

export interface RevokeWorkforceRoleAssignmentInput {
  organizationId: string;
  reason: string;
}

interface ErrorResponse {
  message?: string | string[];
}

function errorMessage(error: ErrorResponse, fallback: string): string {
  if (Array.isArray(error.message)) return error.message.join(" ");
  return error.message ?? fallback;
}

export class WorkforceApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "WorkforceApiError";
    this.status = status;
  }
}

export async function getWorkforceDirectory(
  organizationId?: string,
): Promise<WorkforceDirectoryResponse> {
  const apiBaseUrl =
    import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
  const url = new URL("/v1/admin/workforce-directory", apiBaseUrl);

  if (organizationId) {
    url.searchParams.set("organizationId", organizationId);
  }

  const response = await fetch(url, {
    credentials: "include",
  });

  if (!response.ok) {
    let error: ErrorResponse = {};

    try {
      error = (await response.json()) as ErrorResponse;
    } catch {
      // The status-based fallback below is safe for non-JSON upstream errors.
    }

    throw new WorkforceApiError(
      errorMessage(error, `Directory request failed (${response.status}).`),
      response.status,
    );
  }

  return (await response.json()) as WorkforceDirectoryResponse;
}

export async function createWorkforceInvitation(
  csrfToken: string,
  input: CreateWorkforceInvitationInput,
): Promise<WorkforceInvitationResponse> {
  const apiBaseUrl =
    import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
  const response = await fetch(
    new URL("/v1/admin/workforce-directory/invitations", apiBaseUrl),
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify(input),
    },
  );

  if (!response.ok) {
    let error: ErrorResponse = {};

    try {
      error = (await response.json()) as ErrorResponse;
    } catch {
      // The status-based fallback below is safe for non-JSON upstream errors.
    }

    throw new WorkforceApiError(
      errorMessage(error, `Invitation request failed (${response.status}).`),
      response.status,
    );
  }

  return (await response.json()) as WorkforceInvitationResponse;
}

export async function changeWorkforceMembershipStatus(
  csrfToken: string,
  membershipId: string,
  input: ChangeWorkforceMembershipStatusInput,
): Promise<WorkforceMembershipStatusResponse> {
  const apiBaseUrl =
    import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
  const response = await fetch(
    new URL(
      `/v1/admin/workforce-directory/memberships/${membershipId}/status`,
      apiBaseUrl,
    ),
    {
      method: "PATCH",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify(input),
    },
  );

  if (!response.ok) {
    let error: ErrorResponse = {};

    try {
      error = (await response.json()) as ErrorResponse;
    } catch {
      // The status-based fallback below is safe for non-JSON upstream errors.
    }

    throw new WorkforceApiError(
      errorMessage(
        error,
        `Membership status request failed (${response.status}).`,
      ),
      response.status,
    );
  }

  return (await response.json()) as WorkforceMembershipStatusResponse;
}

export async function assignWorkforceGlobalRole(
  csrfToken: string,
  membershipId: string,
  input: AssignWorkforceGlobalRoleInput,
): Promise<WorkforceRoleAssignment> {
  const apiBaseUrl =
    import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
  const response = await fetch(
    new URL(
      `/v1/admin/workforce-directory/memberships/${membershipId}/role-assignments`,
      apiBaseUrl,
    ),
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify(input),
    },
  );

  if (!response.ok) {
    let error: ErrorResponse = {};

    try {
      error = (await response.json()) as ErrorResponse;
    } catch {
      // The status-based fallback below is safe for non-JSON upstream errors.
    }

    throw new WorkforceApiError(
      errorMessage(
        error,
        `Role assignment request failed (${response.status}).`,
      ),
      response.status,
    );
  }

  return (await response.json()) as WorkforceRoleAssignment;
}

export async function revokeWorkforceRoleAssignment(
  csrfToken: string,
  assignmentId: string,
  input: RevokeWorkforceRoleAssignmentInput,
): Promise<WorkforceRoleAssignment> {
  const apiBaseUrl =
    import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
  const response = await fetch(
    new URL(
      `/v1/admin/workforce-directory/role-assignments/${assignmentId}`,
      apiBaseUrl,
    ),
    {
      method: "DELETE",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify(input),
    },
  );

  if (!response.ok) {
    let error: ErrorResponse = {};

    try {
      error = (await response.json()) as ErrorResponse;
    } catch {
      // The status-based fallback below is safe for non-JSON upstream errors.
    }

    throw new WorkforceApiError(
      errorMessage(
        error,
        `Role revocation request failed (${response.status}).`,
      ),
      response.status,
    );
  }

  return (await response.json()) as WorkforceRoleAssignment;
}
