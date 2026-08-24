import {
  ArrowClockwiseIcon,
  BuildingsIcon,
  CheckCircleIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  UserCircleIcon,
  UsersThreeIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getWorkforceDirectory,
  WorkforceApiError,
  type WorkforceDirectoryResponse,
  type WorkforceDirectoryUser,
} from "@/lib/workforce-directory";

interface WorkforceDirectoryProps {
  onSessionExpired: () => void;
}

function statusBadge(user: WorkforceDirectoryUser) {
  if (user.membershipStatus === "suspended" || user.cognitoEnabled === false) {
    return (
      <Badge variant="destructive">
        <WarningCircleIcon />
        Suspended
      </Badge>
    );
  }

  if (user.membershipStatus === "pending" || !user.cognitoStatus) {
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
                      user.membershipStatus === "active" && user.cognitoEnabled,
                  ).length
                }
              </p>
            </div>
          </div>
        )}
      </section>

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

        {!loading && !error && visibleUsers.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-start text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 text-start font-medium">User</th>
                  <th className="px-5 py-3 text-start font-medium">Access</th>
                  <th className="px-5 py-3 text-start font-medium">Cognito</th>
                  <th className="px-5 py-3 text-start font-medium">Data</th>
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
                    <td className="px-5 py-4">{statusBadge(user)}</td>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
