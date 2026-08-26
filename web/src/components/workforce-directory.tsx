import {
  ArrowClockwiseIcon,
  BuildingsIcon,
  CheckCircleIcon,
  EnvelopeSimpleIcon,
  MagnifyingGlassIcon,
  MinusCircleIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  ShieldCheckIcon,
  ShieldPlusIcon,
  UserCircleIcon,
  UserPlusIcon,
  UsersThreeIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  assignWorkforceGlobalRole,
  assignWorkforceTenantLocalRole,
  changeWorkforceMembershipStatus,
  createWorkforceInvitation,
  createWorkforceTenantLocalRole,
  getWorkforceDirectory,
  revokeWorkforceRoleAssignment,
  WorkforceApiError,
  type WorkforceDirectoryResponse,
  type WorkforceRoleAssignment,
  type WorkforceDirectoryUser,
} from "@/lib/workforce-directory";

interface WorkforceDirectoryProps {
  csrfToken: string;
  onSessionExpired: () => void;
}

function statusBadge(
  user: WorkforceDirectoryUser,
  cognitoStatusAvailable: boolean,
) {
  if (
    user.membershipStatus === "suspended" ||
    (cognitoStatusAvailable && user.cognitoEnabled === false)
  ) {
    return (
      <Badge variant="destructive">
        <WarningCircleIcon />
        Suspended
      </Badge>
    );
  }

  if (
    user.membershipStatus === "pending" ||
    (cognitoStatusAvailable &&
      (!user.cognitoStatus ||
        user.cognitoStatus === "FORCE_CHANGE_PASSWORD"))
  ) {
    return (
      <Badge variant="warning">
        <WarningCircleIcon />
        Pending setup
      </Badge>
    );
  }

  if (
    user.membershipStatus === "active" &&
    user.cognitoStatus === "CONFIRMED"
  ) {
    return (
      <Badge variant="success">
        <CheckCircleIcon />
        Active
      </Badge>
    );
  }

  return <Badge variant="outline">{user.membershipStatus}</Badge>;
}

export function WorkforceDirectory({
  csrfToken,
  onSessionExpired,
}: WorkforceDirectoryProps) {
  const [directory, setDirectory] = useState<WorkforceDirectoryResponse | null>(
    null,
  );
  const [selectedOrganizationId, setSelectedOrganizationId] =
    useState<string>();
  const [reloadVersion, setReloadVersion] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revalidatedLegacyDirectory, setRevalidatedLegacyDirectory] =
    useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [inviteDisplayName, setInviteDisplayName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteReason, setInviteReason] = useState("");
  const [membershipChangeTarget, setMembershipChangeTarget] =
    useState<WorkforceDirectoryUser | null>(null);
  const [membershipChangeReason, setMembershipChangeReason] = useState("");
  const [membershipChangeSubmitting, setMembershipChangeSubmitting] =
    useState(false);
  const [membershipChangeError, setMembershipChangeError] = useState<
    string | null
  >(null);
  const [membershipChangeSuccess, setMembershipChangeSuccess] = useState<
    string | null
  >(null);
  const [roleManagementTarget, setRoleManagementTarget] =
    useState<WorkforceDirectoryUser | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [roleManagementReason, setRoleManagementReason] = useState("");
  const [roleManagementSubmitting, setRoleManagementSubmitting] =
    useState(false);
  const [roleManagementError, setRoleManagementError] = useState<string | null>(
    null,
  );
  const [roleManagementSuccess, setRoleManagementSuccess] = useState<
    string | null
  >(null);
  const [tenantLocalRoleOpen, setTenantLocalRoleOpen] = useState(false);
  const [tenantLocalRoleSubmitting, setTenantLocalRoleSubmitting] =
    useState(false);
  const [tenantLocalRoleError, setTenantLocalRoleError] = useState<
    string | null
  >(null);
  const [tenantLocalRoleName, setTenantLocalRoleName] = useState("");
  const [tenantLocalRoleDescription, setTenantLocalRoleDescription] =
    useState("");
  const [tenantLocalRolePermissionIds, setTenantLocalRolePermissionIds] =
    useState<string[]>([]);
  const [tenantLocalRoleReason, setTenantLocalRoleReason] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    getWorkforceDirectory(selectedOrganizationId)
      .then((response) => {
        if (controller.signal.aborted) return;
        setDirectory(response);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (reason instanceof WorkforceApiError && reason.status === 401) {
          onSessionExpired();
          return;
        }
        setError(
          reason instanceof Error
            ? reason.message
            : "The workforce directory could not be loaded.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [onSessionExpired, reloadVersion, selectedOrganizationId]);

  useEffect(() => {
    if (
      !directory ||
      revalidatedLegacyDirectory ||
      directory.users.every((user) => Array.isArray(user.roleAssignments))
    ) {
      return;
    }

    const revalidate = window.setTimeout(() => {
      setRevalidatedLegacyDirectory(true);
      setLoading(true);
      setError(null);
      setReloadVersion((version) => version + 1);
    }, 0);

    return () => window.clearTimeout(revalidate);
  }, [directory, revalidatedLegacyDirectory]);

  const selectOrganization = (organizationId: string) => {
    setLoading(true);
    setError(null);
    setSelectedOrganizationId(organizationId);
  };

  const retry = () => {
    setLoading(true);
    setError(null);
    setReloadVersion((version) => version + 1);
  };

  const visibleUsers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!directory || !query) return directory?.users ?? [];

    return directory.users.filter((user) =>
      [
        user.displayName,
        user.email ?? "",
        user.membershipStatus,
        user.cognitoStatus ?? "",
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query),
    );
  }, [directory, search]);

  const activeOrganizationId =
    selectedOrganizationId ?? directory?.selectedContext.organizationId;
  const assignableGlobalRoles = directory?.assignableGlobalRoles ?? [];
  const tenantLocalRoles = directory?.tenantLocalRoles ?? [];
  const delegablePermissions = directory?.delegablePermissions ?? [];

  const setInvitationDialogOpen = (open: boolean) => {
    if (inviteSubmitting) return;
    setInviteOpen(open);
    setInviteError(null);
  };

  const submitInvitation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!activeOrganizationId) {
      setInviteError("Select a practice before inviting a user.");
      return;
    }

    setInviteSubmitting(true);
    setInviteError(null);
    setInviteSuccess(null);

    try {
      const result = await createWorkforceInvitation(csrfToken, {
        organizationId: activeOrganizationId,
        displayName: inviteDisplayName.trim(),
        email: inviteEmail.trim().toLowerCase(),
        reason: inviteReason.trim(),
      });
      setInviteSuccess(
        result.accountCreated
          ? `Cognito accepted the invitation for ${result.email}. Practice access is active with no role assigned.`
          : `The existing account for ${result.email} now has practice access. No role was assigned.`,
      );
      setInviteDisplayName("");
      setInviteEmail("");
      setInviteReason("");
      setInviteOpen(false);
      retry();
    } catch (reason: unknown) {
      if (reason instanceof WorkforceApiError && reason.status === 401) {
        onSessionExpired();
        return;
      }
      setInviteError(
        reason instanceof Error
          ? reason.message
          : "The workforce invitation could not be completed.",
      );
    } finally {
      setInviteSubmitting(false);
    }
  };

  const setMembershipChangeDialogOpen = (open: boolean) => {
    if (membershipChangeSubmitting) return;

    if (!open) {
      setMembershipChangeTarget(null);
      setMembershipChangeReason("");
      setMembershipChangeError(null);
    }
  };

  const openMembershipChangeDialog = (user: WorkforceDirectoryUser) => {
    setMembershipChangeError(null);
    setMembershipChangeReason("");
    setMembershipChangeTarget(user);
  };

  const submitMembershipChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!activeOrganizationId || !membershipChangeTarget) {
      setMembershipChangeError("Select a practice and user before continuing.");
      return;
    }

    const nextStatus =
      membershipChangeTarget.membershipStatus === "active"
        ? "suspended"
        : "active";
    setMembershipChangeSubmitting(true);
    setMembershipChangeError(null);
    setMembershipChangeSuccess(null);

    try {
      const result = await changeWorkforceMembershipStatus(
        csrfToken,
        membershipChangeTarget.membershipId,
        {
          organizationId: activeOrganizationId,
          status: nextStatus,
          reason: membershipChangeReason.trim(),
        },
      );
      setMembershipChangeSuccess(
        result.membershipStatus === "suspended"
          ? `${membershipChangeTarget.displayName}'s practice access was suspended. ${result.sessionsRevoked} active session${result.sessionsRevoked === 1 ? "" : "s"} revoked.`
          : `${membershipChangeTarget.displayName}'s practice access was restored. Existing valid roles remain unchanged.`,
      );
      setMembershipChangeTarget(null);
      setMembershipChangeReason("");
      retry();
    } catch (reason: unknown) {
      if (reason instanceof WorkforceApiError && reason.status === 401) {
        onSessionExpired();
        return;
      }
      setMembershipChangeError(
        reason instanceof Error
          ? reason.message
          : "The workforce membership could not be changed.",
      );
    } finally {
      setMembershipChangeSubmitting(false);
    }
  };

  const setRoleManagementDialogOpen = (open: boolean) => {
    if (roleManagementSubmitting || open) return;

    setRoleManagementTarget(null);
    setSelectedRoleId("");
    setRoleManagementReason("");
    setRoleManagementError(null);
  };

  const openRoleManagementDialog = (user: WorkforceDirectoryUser) => {
    setSelectedRoleId("");
    setRoleManagementReason("");
    setRoleManagementError(null);
    setRoleManagementTarget(user);
  };

  const submitRoleAssignment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!activeOrganizationId || !roleManagementTarget || !selectedRoleId) {
      setRoleManagementError(
        "Select a practice, user, and role before continuing.",
      );
      return;
    }

    setRoleManagementSubmitting(true);
    setRoleManagementError(null);
    setRoleManagementSuccess(null);

    try {
      const input = {
        organizationId: activeOrganizationId,
        roleId: selectedRoleId,
        reason: roleManagementReason.trim(),
      };
      const isTenantLocalRole = tenantLocalRoles.some(
        (role) => role.roleId === selectedRoleId,
      );
      const assignment = isTenantLocalRole
        ? await assignWorkforceTenantLocalRole(
            csrfToken,
            roleManagementTarget.membershipId,
            input,
          )
        : await assignWorkforceGlobalRole(
            csrfToken,
            roleManagementTarget.membershipId,
            input,
          );
      setRoleManagementSuccess(
        `${assignment.roleName} was assigned to ${roleManagementTarget.displayName}.`,
      );
      setSelectedRoleId("");
      setRoleManagementReason("");
      retry();
    } catch (reason: unknown) {
      if (reason instanceof WorkforceApiError && reason.status === 401) {
        onSessionExpired();
        return;
      }
      setRoleManagementError(
        reason instanceof Error
          ? reason.message
          : "The global role could not be assigned.",
      );
    } finally {
      setRoleManagementSubmitting(false);
    }
  };

  const setTenantLocalRoleDialogOpen = (open: boolean) => {
    if (tenantLocalRoleSubmitting) return;

    setTenantLocalRoleOpen(open);
    if (!open) {
      setTenantLocalRoleError(null);
      setTenantLocalRoleName("");
      setTenantLocalRoleDescription("");
      setTenantLocalRolePermissionIds([]);
      setTenantLocalRoleReason("");
    }
  };

  const toggleTenantLocalRolePermission = (permissionId: string) => {
    setTenantLocalRolePermissionIds((permissionIds) =>
      permissionIds.includes(permissionId)
        ? permissionIds.filter((id) => id !== permissionId)
        : [...permissionIds, permissionId],
    );
  };

  const submitTenantLocalRole = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!activeOrganizationId || tenantLocalRolePermissionIds.length === 0) {
      setTenantLocalRoleError(
        "Select a practice and at least one permission before continuing.",
      );
      return;
    }

    setTenantLocalRoleSubmitting(true);
    setTenantLocalRoleError(null);
    setRoleManagementSuccess(null);

    try {
      const role = await createWorkforceTenantLocalRole(csrfToken, {
        organizationId: activeOrganizationId,
        name: tenantLocalRoleName.trim(),
        description: tenantLocalRoleDescription.trim(),
        permissionIds: tenantLocalRolePermissionIds,
        reason: tenantLocalRoleReason.trim(),
      });
      setRoleManagementSuccess(
        `${role.name} is available to assign in this tenant.`,
      );
      setTenantLocalRoleOpen(false);
      setTenantLocalRoleName("");
      setTenantLocalRoleDescription("");
      setTenantLocalRolePermissionIds([]);
      setTenantLocalRoleReason("");
      retry();
    } catch (reason: unknown) {
      if (reason instanceof WorkforceApiError && reason.status === 401) {
        onSessionExpired();
        return;
      }
      setTenantLocalRoleError(
        reason instanceof Error
          ? reason.message
          : "The tenant-local role could not be created.",
      );
    } finally {
      setTenantLocalRoleSubmitting(false);
    }
  };

  const revokeRoleAssignment = async (assignment: WorkforceRoleAssignment) => {
    if (!activeOrganizationId || !roleManagementTarget) {
      setRoleManagementError("Select a practice and user before continuing.");
      return;
    }

    const reason = roleManagementReason.trim();
    if (reason.length < 3) {
      setRoleManagementError(
        "Enter an access-change reason of at least 3 characters.",
      );
      return;
    }

    setRoleManagementSubmitting(true);
    setRoleManagementError(null);
    setRoleManagementSuccess(null);

    try {
      const revoked = await revokeWorkforceRoleAssignment(
        csrfToken,
        assignment.assignmentId,
        {
          organizationId: activeOrganizationId,
          reason,
        },
      );
      setRoleManagementSuccess(
        `${revoked.roleName} was removed from ${roleManagementTarget.displayName}.`,
      );
      setRoleManagementReason("");
      retry();
    } catch (reason: unknown) {
      if (reason instanceof WorkforceApiError && reason.status === 401) {
        onSessionExpired();
        return;
      }
      setRoleManagementError(
        reason instanceof Error
          ? reason.message
          : "The role assignment could not be revoked.",
      );
    } finally {
      setRoleManagementSubmitting(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="flex flex-col gap-5 border-b pb-7 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <ShieldCheckIcon className="size-5" />
            Access administration
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
            Workforce directory
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            Review practice membership and Cognito account readiness. Access is
            limited to your current administrative scope.
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-3 sm:items-end">
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              onClick={() => setInvitationDialogOpen(true)}
              disabled={!directory || loading || Boolean(error)}
            >
              <UserPlusIcon />
              Invite user
            </Button>
            {directory?.canManageRoles && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setTenantLocalRoleDialogOpen(true)}
                disabled={loading || Boolean(error)}
              >
                <ShieldPlusIcon />
                Create local role
              </Button>
            )}
          </div>
          {directory && (
            <div className="flex gap-3">
              <div className="rounded-lg border bg-card px-4 py-3">
                <p className="text-xs text-muted-foreground">Visible users</p>
                <p className="mt-0.5 text-xl font-semibold">
                  {directory.users.length}
                </p>
              </div>
              <div className="rounded-lg border bg-card px-4 py-3">
                <p className="text-xs text-muted-foreground">Active</p>
                <p className="mt-0.5 text-xl font-semibold text-success">
                  {
                    directory.users.filter(
                      (user) =>
                        user.membershipStatus === "active" &&
                        user.cognitoEnabled &&
                        user.cognitoStatus === "CONFIRMED",
                    ).length
                  }
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {inviteSuccess && (
        <div
          className="mt-6 flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 p-4 text-sm"
          role="status"
        >
          <CheckCircleIcon className="mt-0.5 size-5 shrink-0 text-success" />
          <div className="flex-1">
            <p className="font-medium text-foreground">Invitation completed</p>
            <p className="mt-1 text-muted-foreground">{inviteSuccess}</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setInviteSuccess(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

      {membershipChangeSuccess && (
        <div
          className="mt-6 flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 p-4 text-sm"
          role="status"
        >
          <CheckCircleIcon className="mt-0.5 size-5 shrink-0 text-success" />
          <div className="flex-1">
            <p className="font-medium text-foreground">Access updated</p>
            <p className="mt-1 text-muted-foreground">
              {membershipChangeSuccess}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setMembershipChangeSuccess(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

      {roleManagementSuccess && (
        <div
          className="mt-6 flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 p-4 text-sm"
          role="status"
        >
          <CheckCircleIcon className="mt-0.5 size-5 shrink-0 text-success" />
          <div className="flex-1">
            <p className="font-medium text-foreground">Role access updated</p>
            <p className="mt-1 text-muted-foreground">
              {roleManagementSuccess}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setRoleManagementSuccess(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

      <section
        className="mt-7 rounded-xl border bg-card shadow-[0_12px_35px_rgba(30,73,79,0.06)]"
        aria-labelledby="directory-heading"
      >
        <div className="grid gap-4 border-b p-4 sm:p-5 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(18rem,1.2fr)]">
          <div className="grid gap-2">
            <Label htmlFor="organization">Practice</Label>
            <Select
              value={
                selectedOrganizationId ??
                directory?.selectedContext.organizationId
              }
              onValueChange={selectOrganization}
              disabled={!directory || loading}
            >
              <SelectTrigger id="organization">
                <SelectValue placeholder="Select a practice" />
              </SelectTrigger>
              <SelectContent>
                {directory?.contexts.map((context) => (
                  <SelectItem
                    key={context.organizationId}
                    value={context.organizationId}
                  >
                    {context.organizationName} · {context.tenantName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="directory-search">Search directory</Label>
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="directory-search"
                className="ps-9"
                placeholder="Name, email, or status"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>
        </div>

        {loading && (
          <div
            className="grid gap-3 p-5"
            role="status"
            aria-label="Loading workforce directory"
          >
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <span className="sr-only">Loading workforce directory</span>
          </div>
        )}

        {!loading && error && (
          <div className="grid justify-items-start gap-3 p-6" role="alert">
            <span className="grid size-10 place-items-center rounded-full bg-destructive/10 text-destructive">
              <WarningCircleIcon className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold">Directory unavailable</h2>
              <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            </div>
            <Button size="sm" variant="outline" onClick={retry}>
              <ArrowClockwiseIcon />
              Try again
            </Button>
          </div>
        )}

        {!loading && !error && visibleUsers.length === 0 && (
          <div className="grid justify-items-center gap-3 px-5 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
              <UsersThreeIcon className="size-6" />
            </span>
            <div>
              <h2 className="font-semibold">No matching workforce users</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Try a different search or practice.
              </p>
            </div>
          </div>
        )}

        {!loading && !error && !directory?.cognitoStatusAvailable && (
          <div className="border-b border-warning/30 bg-warning/10 px-5 py-3 text-sm text-warning-foreground">
            Cognito account status is temporarily unavailable. Practice access
            and role assignments below are current database-authoritative data.
          </div>
        )}

        {!loading && !error && visibleUsers.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[64rem] text-start text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 text-start font-medium">User</th>
                  <th className="px-5 py-3 text-start font-medium">Access</th>
                  <th className="px-5 py-3 text-start font-medium">Roles</th>
                  <th className="px-5 py-3 text-start font-medium">Cognito</th>
                  <th className="px-5 py-3 text-start font-medium">Data</th>
                  <th className="px-5 py-3 text-end font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visibleUsers.map((user) => (
                  <tr
                    key={user.applicationUserId}
                    className="hover:bg-muted/35"
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <span className="grid size-9 place-items-center rounded-full bg-secondary text-secondary-foreground">
                          <UserCircleIcon className="size-5" />
                        </span>
                        <div>
                          <p className="font-medium">{user.displayName}</p>
                          <p className="text-xs text-muted-foreground">
                            {user.email ?? "No primary email"}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      {statusBadge(
                        user,
                        directory?.cognitoStatusAvailable ?? true,
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {!Array.isArray(user.roleAssignments) ? (
                        <span className="text-xs text-muted-foreground">
                          Refreshing role data…
                        </span>
                      ) : user.roleAssignments.length > 0 ? (
                        <div className="flex max-w-64 flex-wrap gap-1.5">
                          {user.roleAssignments.map((assignment) => (
                            <Badge
                              key={assignment.assignmentId}
                              variant="outline"
                            >
                              {assignment.roleName}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          No roles assigned
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <p>{user.cognitoStatus ?? "Not linked"}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {user.identityStatus
                          ? `Identity ${user.identityStatus}`
                          : "No Cognito identity binding"}
                      </p>
                    </td>
                    <td className="px-5 py-4">
                      {user.isSynthetic ? (
                        <Badge variant="info">
                          <BuildingsIcon />
                          Synthetic
                        </Badge>
                      ) : (
                        <Badge variant="outline">Production</Badge>
                      )}
                    </td>
                    <td className="px-5 py-4 text-end">
                      <div className="flex justify-end gap-2">
                        {directory?.canManageRoles &&
                          user.canChangeMembership &&
                          user.membershipStatus === "active" && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => openRoleManagementDialog(user)}
                            >
                              <ShieldPlusIcon />
                              Manage roles
                            </Button>
                          )}
                        {user.canChangeMembership &&
                          user.membershipStatus === "active" && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => openMembershipChangeDialog(user)}
                            >
                              <PauseCircleIcon />
                              Suspend
                            </Button>
                          )}
                        {user.canChangeMembership &&
                          user.membershipStatus === "suspended" && (
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => openMembershipChangeDialog(user)}
                            >
                              <PlayCircleIcon />
                              Restore
                            </Button>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog open={inviteOpen} onOpenChange={setInvitationDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <form className="grid gap-5" onSubmit={submitInvitation}>
            <DialogHeader>
              <DialogTitle>Invite workforce user</DialogTitle>
              <DialogDescription>
                Cognito sends the initial sign-in email. The user must set a
                password and enroll an authenticator before signing in.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-lg border bg-muted/45 p-3">
              <p className="text-xs font-medium text-muted-foreground">
                Practice
              </p>
              <p className="mt-1 font-medium">
                {directory?.selectedContext.organizationName ??
                  "Select a practice"}
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="invite-display-name">Full name</Label>
              <Input
                id="invite-display-name"
                name="displayName"
                autoComplete="name"
                minLength={2}
                maxLength={200}
                required
                value={inviteDisplayName}
                onChange={(event) => setInviteDisplayName(event.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                name="email"
                type="email"
                autoComplete="email"
                maxLength={320}
                required
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                Use a controlled test mailbox in staging. Never enter real
                patient data.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="invite-reason">Reason for access</Label>
              <Textarea
                id="invite-reason"
                name="reason"
                minLength={3}
                maxLength={500}
                required
                value={inviteReason}
                onChange={(event) => setInviteReason(event.target.value)}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                This reason is stored in the audit trail. No role or facility
                access is assigned by this invitation. Do not include patient or
                clinical details.
              </p>
            </div>

            {inviteError && (
              <div
                className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                role="alert"
              >
                <WarningCircleIcon className="mt-0.5 size-4 shrink-0" />
                <p>{inviteError}</p>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setInvitationDialogOpen(false)}
                disabled={inviteSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={inviteSubmitting}>
                <EnvelopeSimpleIcon />
                {inviteSubmitting ? "Creating invitation" : "Create invitation"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={tenantLocalRoleOpen}
        onOpenChange={setTenantLocalRoleDialogOpen}
      >
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl">
          <form className="grid gap-5" onSubmit={submitTenantLocalRole}>
            <DialogHeader>
              <DialogTitle>Create tenant-local role</DialogTitle>
              <DialogDescription>
                Build an administrator-assigned role for this tenant from the
                approved delegable permission catalogue. Facility scope, role
                requests, and Cognito changes are not part of this action.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-lg border bg-muted/45 p-3">
              <p className="text-xs font-medium text-muted-foreground">
                Practice
              </p>
              <p className="mt-1 font-medium">
                {directory?.selectedContext.organizationName ??
                  "Select a practice"}
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="tenant-local-role-name">Role name</Label>
              <Input
                id="tenant-local-role-name"
                name="name"
                minLength={2}
                maxLength={200}
                required
                value={tenantLocalRoleName}
                onChange={(event) => setTenantLocalRoleName(event.target.value)}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                Must be unique within this tenant.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="tenant-local-role-description">
                Role description
              </Label>
              <Textarea
                id="tenant-local-role-description"
                name="description"
                minLength={3}
                maxLength={1000}
                required
                value={tenantLocalRoleDescription}
                onChange={(event) =>
                  setTenantLocalRoleDescription(event.target.value)
                }
              />
            </div>

            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">
                Delegable permissions
              </legend>
              <p className="text-xs leading-5 text-muted-foreground">
                Select at least one permission. Site-controlled privileged
                permissions are excluded.
              </p>
              <div className="grid max-h-60 gap-2 overflow-y-auto rounded-lg border p-3">
                {delegablePermissions.map((permission) => {
                  const checked = tenantLocalRolePermissionIds.includes(
                    permission.permissionId,
                  );
                  const id = `tenant-local-permission-${permission.permissionId}`;

                  return (
                    <div key={permission.permissionId} className="flex gap-3">
                      <Checkbox
                        id={id}
                        checked={checked}
                        onCheckedChange={() =>
                          toggleTenantLocalRolePermission(
                            permission.permissionId,
                          )
                        }
                      />
                      <Label
                        htmlFor={id}
                        className="grid cursor-pointer gap-0.5 font-normal"
                      >
                        <span className="font-medium">{permission.name}</span>
                        <span className="text-xs leading-5 text-muted-foreground">
                          {permission.description}
                        </span>
                      </Label>
                    </div>
                  );
                })}
              </div>
            </fieldset>

            <div className="grid gap-2">
              <Label htmlFor="tenant-local-role-reason">
                Reason for role definition
              </Label>
              <Textarea
                id="tenant-local-role-reason"
                name="reason"
                minLength={3}
                maxLength={500}
                required
                value={tenantLocalRoleReason}
                onChange={(event) =>
                  setTenantLocalRoleReason(event.target.value)
                }
              />
              <p className="text-xs leading-5 text-muted-foreground">
                This reason is stored in the audit trail. Do not include patient
                or clinical details.
              </p>
            </div>

            {tenantLocalRoleError && (
              <div
                className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                role="alert"
              >
                <WarningCircleIcon className="mt-0.5 size-4 shrink-0" />
                <p>{tenantLocalRoleError}</p>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setTenantLocalRoleDialogOpen(false)}
                disabled={tenantLocalRoleSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  tenantLocalRoleSubmitting ||
                  tenantLocalRolePermissionIds.length === 0
                }
              >
                <ShieldPlusIcon />
                {tenantLocalRoleSubmitting
                  ? "Creating local role"
                  : "Create local role"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={roleManagementTarget !== null}
        onOpenChange={setRoleManagementDialogOpen}
      >
        <DialogContent className="sm:max-w-lg">
          <form className="grid min-w-0 gap-5" onSubmit={submitRoleAssignment}>
            <DialogHeader>
              <DialogTitle>Manage practice roles</DialogTitle>
              <DialogDescription>
                Assign approved global or tenant-local roles for this practice,
                or remove an existing eligible role. Cognito sign-in and other
                practice access are unchanged.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-lg border bg-muted/45 p-3">
              <p className="text-xs font-medium text-muted-foreground">User</p>
              <p className="mt-1 font-medium">
                {roleManagementTarget?.displayName}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {roleManagementTarget?.email ?? "No primary email"}
              </p>
            </div>

            <div className="grid gap-2">
              <Label>Current roles</Label>
              {(roleManagementTarget?.roleAssignments ?? []).length ? (
                <div className="grid gap-2">
                  {(roleManagementTarget?.roleAssignments ?? []).map(
                    (assignment) => (
                      <div
                        key={assignment.assignmentId}
                        className="flex items-center justify-between gap-3 rounded-lg border p-3"
                      >
                        <div>
                          <p className="font-medium">{assignment.roleName}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {assignment.roleDescription}
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void revokeRoleAssignment(assignment)}
                          disabled={roleManagementSubmitting}
                        >
                          <MinusCircleIcon />
                          Remove
                        </Button>
                      </div>
                    ),
                  )}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  No role is currently assigned for this practice.
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="role-to-assign">Role to assign</Label>
              <Select value={selectedRoleId} onValueChange={setSelectedRoleId}>
                <SelectTrigger id="role-to-assign">
                  <SelectValue placeholder="Select an approved role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Global roles</SelectLabel>
                    {assignableGlobalRoles.map((role) => (
                      <SelectItem key={role.roleId} value={role.roleId}>
                        {role.name} · {role.description}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  {tenantLocalRoles.length ? (
                    <SelectGroup>
                      <SelectLabel>Tenant-local roles</SelectLabel>
                      {tenantLocalRoles.map((role) => (
                        <SelectItem key={role.roleId} value={role.roleId}>
                          {role.name} · {role.description}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ) : null}
                </SelectContent>
              </Select>
              <p className="text-xs leading-5 text-muted-foreground">
                Privileged roles, facility scope, and descendant access are not
                available through this screen.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="role-management-reason">
                Reason for access change
              </Label>
              <Textarea
                id="role-management-reason"
                name="reason"
                minLength={3}
                maxLength={500}
                required
                value={roleManagementReason}
                onChange={(event) =>
                  setRoleManagementReason(event.target.value)
                }
              />
              <p className="text-xs leading-5 text-muted-foreground">
                This reason is stored in the audit trail. Do not include patient
                or clinical details.
              </p>
            </div>

            {roleManagementError && (
              <div
                className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                role="alert"
              >
                <WarningCircleIcon className="mt-0.5 size-4 shrink-0" />
                <p>{roleManagementError}</p>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRoleManagementDialogOpen(false)}
                disabled={roleManagementSubmitting}
              >
                Close
              </Button>
              <Button
                type="submit"
                disabled={roleManagementSubmitting || !selectedRoleId}
              >
                <ShieldPlusIcon />
                {roleManagementSubmitting ? "Updating roles" : "Assign role"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={membershipChangeTarget !== null}
        onOpenChange={setMembershipChangeDialogOpen}
      >
        <DialogContent className="sm:max-w-lg">
          <form className="grid gap-5" onSubmit={submitMembershipChange}>
            <DialogHeader>
              <DialogTitle>
                {membershipChangeTarget?.membershipStatus === "active"
                  ? "Suspend practice access"
                  : "Restore practice access"}
              </DialogTitle>
              <DialogDescription>
                {membershipChangeTarget?.membershipStatus === "active"
                  ? "This removes access to this practice and immediately revokes the user's active application sessions. Their Cognito account and other practice access are unchanged."
                  : "This restores access only to this practice. It does not create any new roles or facility access."}
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-lg border bg-muted/45 p-3">
              <p className="text-xs font-medium text-muted-foreground">User</p>
              <p className="mt-1 font-medium">
                {membershipChangeTarget?.displayName}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {membershipChangeTarget?.email ?? "No primary email"}
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="membership-change-reason">
                Reason for access change
              </Label>
              <Textarea
                id="membership-change-reason"
                name="reason"
                minLength={3}
                maxLength={500}
                required
                value={membershipChangeReason}
                onChange={(event) =>
                  setMembershipChangeReason(event.target.value)
                }
              />
              <p className="text-xs leading-5 text-muted-foreground">
                This reason is stored in the audit trail. Do not include patient
                or clinical details.
              </p>
            </div>

            {membershipChangeError && (
              <div
                className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                role="alert"
              >
                <WarningCircleIcon className="mt-0.5 size-4 shrink-0" />
                <p>{membershipChangeError}</p>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setMembershipChangeDialogOpen(false)}
                disabled={membershipChangeSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={membershipChangeSubmitting}>
                {membershipChangeTarget?.membershipStatus === "active" ? (
                  <PauseCircleIcon />
                ) : (
                  <PlayCircleIcon />
                )}
                {membershipChangeSubmitting
                  ? "Updating access"
                  : membershipChangeTarget?.membershipStatus === "active"
                    ? "Suspend access"
                    : "Restore access"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
