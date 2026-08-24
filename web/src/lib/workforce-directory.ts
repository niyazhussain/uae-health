export interface WorkforceDirectoryContext {
  tenantId: string;
  tenantName: string;
  organizationId: string;
  organizationName: string;
}

export interface WorkforceDirectoryUser {
  applicationUserId: string;
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

export interface WorkforceDirectoryResponse {
  contexts: WorkforceDirectoryContext[];
  selectedContext: WorkforceDirectoryContext;
  users: WorkforceDirectoryUser[];
}

interface ErrorResponse {
  message?: string;
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
      error.message ?? `Directory request failed (${response.status}).`,
      response.status,
    );
  }

  return (await response.json()) as WorkforceDirectoryResponse;
}
