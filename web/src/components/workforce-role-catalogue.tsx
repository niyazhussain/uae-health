import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  LockKeyIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
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
  getWorkforceRoleCatalogue,
  WorkforceApiError,
  type WorkforceDirectoryContext,
  type WorkforceRoleCatalogueResponse,
} from "@/lib/workforce-directory";

interface WorkforceRoleCatalogueProps {
  selectedOrganizationId?: string;
  onSelectedOrganizationChange: (organizationId: string) => void;
  onContextChange: (context: WorkforceDirectoryContext) => void;
  onPageReady: () => void;
  onSessionExpired: () => void;
}

export function WorkforceRoleCatalogue({
  selectedOrganizationId,
  onSelectedOrganizationChange,
  onContextChange,
  onPageReady,
  onSessionExpired,
}: WorkforceRoleCatalogueProps) {
  const [catalogue, setCatalogue] = useState<WorkforceRoleCatalogueResponse | null>(
    null,
  );
  const [reloadVersion, setReloadVersion] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadCatalogue = async () => {
      setLoading(true);
      setError(null);

      try {
        const nextCatalogue = await getWorkforceRoleCatalogue(
          selectedOrganizationId,
        );

        if (cancelled) return;

        setCatalogue(nextCatalogue);
        onContextChange(nextCatalogue.selectedContext);
        if (
          selectedOrganizationId !==
          nextCatalogue.selectedContext.organizationId
        ) {
          onSelectedOrganizationChange(
            nextCatalogue.selectedContext.organizationId,
          );
        }
      } catch (reason: unknown) {
        if (cancelled) return;

        if (reason instanceof WorkforceApiError && reason.status === 401) {
          onSessionExpired();
          return;
        }

        setError(
          reason instanceof Error
            ? reason.message
            : "The role catalogue could not be loaded.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadCatalogue();

    return () => {
      cancelled = true;
    };
  }, [
    onContextChange,
    onSelectedOrganizationChange,
    onSessionExpired,
    reloadVersion,
    selectedOrganizationId,
  ]);

  useEffect(() => {
    if (!loading) onPageReady();
  }, [loading, onPageReady]);

  const visibleRoles = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();

    if (!normalizedSearch) return catalogue?.roles ?? [];

    return (catalogue?.roles ?? []).filter((role) => {
      const roleText = [role.name, role.code, role.description]
        .join(" ")
        .toLocaleLowerCase();
      const permissionText = role.permissions
        .flatMap((permission) => [
          permission.name,
          permission.code,
          permission.description,
        ])
        .join(" ")
        .toLocaleLowerCase();

      return (
        roleText.includes(normalizedSearch) ||
        permissionText.includes(normalizedSearch)
      );
    });
  }, [catalogue?.roles, search]);

  const retry = () => setReloadVersion((value) => value + 1);
  const globalRoleCount = catalogue?.roles.filter(
    (role) => role.source === "global",
  ).length;
  const tenantRoleCount = catalogue?.roles.filter(
    (role) => role.source === "tenant-local",
  ).length;
  const totalAssignments = catalogue?.roles.reduce(
    (total, role) => total + role.assignmentCount,
    0,
  );

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="flex flex-col gap-5 border-b pb-7 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <ShieldCheckIcon className="size-5" />
            Authorization catalogue
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
            Roles and permissions
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            Review the active system templates and roles created for the
            current tenant. This view never changes access.
          </p>
        </div>
        {catalogue && (
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <RoleMetric label="System" value={globalRoleCount ?? 0} />
            <RoleMetric label="Practice" value={tenantRoleCount ?? 0} />
            <RoleMetric label="Assignments" value={totalAssignments ?? 0} />
          </div>
        )}
      </section>

      <section
        className="mt-7 rounded-xl border bg-card shadow-[0_12px_35px_rgba(30,73,79,0.06)]"
        aria-labelledby="role-catalogue-heading"
      >
        <div className="grid gap-4 border-b p-4 sm:p-5 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(18rem,1.2fr)]">
          <div className="grid gap-2">
            <Label htmlFor="role-catalogue-practice">Practice</Label>
            <Select
              value={
                catalogue?.selectedContext.organizationId ??
                selectedOrganizationId
              }
              onValueChange={onSelectedOrganizationChange}
              disabled={!catalogue || loading}
            >
              <SelectTrigger id="role-catalogue-practice">
                <SelectValue placeholder="Select a practice" />
              </SelectTrigger>
              <SelectContent>
                {catalogue?.contexts.map((context) => (
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
            <Label htmlFor="role-catalogue-search">
              Search roles and permissions
            </Label>
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="role-catalogue-search"
                className="ps-9"
                placeholder="Role name, permission, or code"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                disabled={loading || Boolean(error)}
              />
            </div>
          </div>
        </div>

        {loading && (
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Skeleton className="h-60 w-full" />
            <Skeleton className="h-60 w-full" />
          </div>
        )}

        {!loading && error && (
          <div className="grid justify-items-start gap-3 p-6" role="alert">
            <span className="grid size-10 place-items-center rounded-full bg-destructive/10 text-destructive">
              <WarningCircleIcon className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold">Role catalogue unavailable</h2>
              <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            </div>
            <Button size="sm" variant="outline" onClick={retry}>
              <ArrowClockwiseIcon />
              Try again
            </Button>
          </div>
        )}

        {!loading && !error && visibleRoles.length === 0 && (
          <div className="grid justify-items-center gap-3 px-5 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
              <UsersThreeIcon className="size-6" />
            </span>
            <div>
              <h2 className="font-semibold">No matching roles</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Try a different role name, permission, or code.
              </p>
            </div>
          </div>
        )}

        {!loading && !error && visibleRoles.length > 0 && (
          <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-2">
            {visibleRoles.map((role) => (
              <article
                key={role.roleId}
                className="rounded-xl border bg-background p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={role.source === "global" ? "info" : "outline"}>
                        {role.source === "global"
                          ? "System template"
                          : "Tenant local"}
                      </Badge>
                      {role.isDelegable ? (
                        <Badge variant="success">
                          <CheckCircleIcon />
                          Delegable
                        </Badge>
                      ) : (
                        <Badge variant="warning">
                          <LockKeyIcon />
                          Read only
                        </Badge>
                      )}
                    </div>
                    <h2 className="mt-3 font-semibold">{role.name}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {role.description}
                    </p>
                  </div>
                  <div className="text-end text-xs text-muted-foreground">
                    <p className="font-mono text-[0.7rem] text-foreground/75">
                      {role.code}
                    </p>
                    <p className="mt-2">
                      {role.assignmentCount} active practice assignment
                      {role.assignmentCount === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>

                <div className="mt-5 border-t pt-4">
                  <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    Permissions
                  </p>
                  {role.permissions.length > 0 ? (
                    <ul className="mt-3 grid gap-2">
                      {role.permissions.map((permission) => (
                        <li
                          key={permission.permissionId}
                          className="rounded-lg bg-muted/55 px-3 py-2 text-sm"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <span className="font-medium">{permission.name}</span>
                            {!permission.isDelegable && (
                              <span className="shrink-0 text-xs text-muted-foreground">
                                Not delegable
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {permission.code} · {permission.description}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">
                      This role has no active permission grants.
                    </p>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function RoleMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-3 text-end sm:px-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-semibold">{value}</p>
    </div>
  );
}
