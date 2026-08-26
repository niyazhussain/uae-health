import {
  ArrowClockwiseIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckCircleIcon,
  EyeIcon,
  LockKeyIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  UsersThreeIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getWorkforceRoleCatalogue,
  getWorkforceRoleCatalogueRole,
  WorkforceApiError,
  type WorkforceDirectoryContext,
  type WorkforceRoleCatalogueRole,
  type WorkforceRoleCatalogueRoleDetail,
  type WorkforceRoleCatalogueResponse,
  type WorkforceRoleCatalogueSource,
} from "@/lib/workforce-directory";

const PAGE_SIZE = 25;

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
  const [catalogue, setCatalogue] =
    useState<WorkforceRoleCatalogueResponse | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<WorkforceRoleCatalogueSource>("all");
  const [page, setPage] = useState(1);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] =
    useState<WorkforceRoleCatalogueRole | null>(null);
  const [roleDetail, setRoleDetail] =
    useState<WorkforceRoleCatalogueRoleDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailReloadVersion, setDetailReloadVersion] = useState(0);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchInput.trim());
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;

    const loadCatalogue = async () => {
      setLoading(true);
      setError(null);

      try {
        const nextCatalogue = await getWorkforceRoleCatalogue({
          organizationId: selectedOrganizationId,
          page,
          pageSize: PAGE_SIZE,
          source,
          search,
        });

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
    page,
    reloadVersion,
    search,
    selectedOrganizationId,
    source,
  ]);

  const activeOrganizationId =
    catalogue?.selectedContext.organizationId ?? selectedOrganizationId;

  useEffect(() => {
    if (!detailOpen || !selectedRole || !activeOrganizationId) {
      return;
    }

    let cancelled = false;

    const loadRoleDetail = async () => {
      setDetailLoading(true);
      setDetailError(null);
      setRoleDetail(null);

      try {
        const nextDetail = await getWorkforceRoleCatalogueRole(
          selectedRole.roleId,
          activeOrganizationId,
        );

        if (!cancelled) setRoleDetail(nextDetail);
      } catch (reason: unknown) {
        if (cancelled) return;

        if (reason instanceof WorkforceApiError && reason.status === 401) {
          onSessionExpired();
          return;
        }

        setDetailError(
          reason instanceof Error
            ? reason.message
            : "The role details could not be loaded.",
        );
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    };

    void loadRoleDetail();

    return () => {
      cancelled = true;
    };
  }, [
    activeOrganizationId,
    detailOpen,
    detailReloadVersion,
    onSessionExpired,
    selectedRole,
  ]);

  useEffect(() => {
    if (!loading) onPageReady();
  }, [loading, onPageReady]);

  const retry = () => setReloadVersion((value) => value + 1);
  const retryDetail = () => setDetailReloadVersion((value) => value + 1);
  const clearSelectedRole = () => {
    setDetailOpen(false);
    setSelectedRole(null);
    setRoleDetail(null);
    setDetailError(null);
  };
  const selectOrganization = (organizationId: string) => {
    clearSelectedRole();
    setPage(1);
    onSelectedOrganizationChange(organizationId);
  };
  const changeSearch = (value: string) => {
    setSearchInput(value);
    setPage(1);
  };
  const changeSource = (value: WorkforceRoleCatalogueSource) => {
    clearSelectedRole();
    setSource(value);
    setPage(1);
  };
  const openRoleDetail = (role: WorkforceRoleCatalogueRole) => {
    setSelectedRole(role);
    setRoleDetail(null);
    setDetailError(null);
    setDetailOpen(true);
  };

  const total = catalogue?.total ?? 0;
  const pageSize = catalogue?.pageSize ?? PAGE_SIZE;
  const currentPage = catalogue?.page ?? page;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const firstResult = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastResult = Math.min(total, currentPage * pageSize);
  const canSwitchPractice = (catalogue?.contexts.length ?? 0) > 1;

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="border-b pb-7">
        <div className="flex items-center gap-2 text-sm font-semibold text-primary">
          <ShieldCheckIcon className="size-5" />
          Authorization catalogue
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
          Roles and permissions
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          Review the roles available to this practice. Viewing a role never
          changes anyone&apos;s access.
        </p>
      </section>

      <section
        className="mt-7 overflow-hidden rounded-xl border bg-card shadow-[0_10px_28px_rgba(30,73,79,0.06)]"
        aria-label="Role catalogue"
      >
        <div className="grid gap-4 border-b bg-muted/20 p-4 sm:p-5 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(12rem,0.55fr)_minmax(18rem,1.2fr)]">
          <div className="grid gap-2">
            {canSwitchPractice ? (
              <Label htmlFor="role-catalogue-practice">Practice</Label>
            ) : (
              <p
                id="role-catalogue-practice-label"
                className="text-sm font-medium leading-none"
              >
                Practice
              </p>
            )}
            {canSwitchPractice ? (
              <Select
                value={
                  catalogue?.selectedContext.organizationId ??
                  selectedOrganizationId
                }
                onValueChange={selectOrganization}
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
            ) : (
              <div
                aria-labelledby="role-catalogue-practice-label"
                className="flex h-10 items-center rounded-md border bg-card px-3 text-sm text-muted-foreground"
              >
                {catalogue
                  ? `${catalogue.selectedContext.organizationName} · ${catalogue.selectedContext.tenantName}`
                  : "Loading practice"}
              </div>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="role-catalogue-source">Role type</Label>
            <Select
              value={source}
              onValueChange={(value) =>
                changeSource(value as WorkforceRoleCatalogueSource)
              }
              disabled={loading || Boolean(error)}
            >
              <SelectTrigger id="role-catalogue-source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                <SelectItem value="global">System templates</SelectItem>
                <SelectItem value="tenant-local">Practice roles</SelectItem>
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
                value={searchInput}
                onChange={(event) => changeSearch(event.target.value)}
                disabled={loading || Boolean(error)}
              />
            </div>
          </div>
        </div>

        {loading && <RoleTableSkeleton />}

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

        {!loading && !error && total === 0 && (
          <div className="grid justify-items-center gap-3 px-5 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
              <UsersThreeIcon className="size-6" />
            </span>
            <div>
              <h2 className="font-semibold">No matching roles</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Try another role type, role name, permission, or code.
              </p>
            </div>
          </div>
        )}

        {!loading && !error && total > 0 && catalogue && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[48rem] border-collapse text-sm">
                <caption className="sr-only">
                  Roles available to the selected practice
                </caption>
                <thead className="border-b bg-muted/35 text-left text-xs font-semibold tracking-[0.02em] text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-5 py-3">
                      Role
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Type
                    </th>
                    <th scope="col" className="px-4 py-3 text-center">
                      Permissions
                    </th>
                    <th scope="col" className="px-4 py-3 text-center">
                      Assigned
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Delegation
                    </th>
                    <th scope="col" className="px-5 py-3 text-right">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {catalogue.roles.map((role) => (
                    <tr key={role.roleId} className="bg-card hover:bg-muted/25">
                      <td className="px-5 py-4">
                        <div className="font-semibold text-foreground">
                          {role.name}
                        </div>
                        <code className="mt-1 block font-mono text-xs text-muted-foreground">
                          {role.code}
                        </code>
                      </td>
                      <td className="px-4 py-4">
                        <Badge
                          variant={
                            role.source === "global" ? "info" : "outline"
                          }
                        >
                          {role.source === "global" ? "System" : "Practice"}
                        </Badge>
                      </td>
                      <td className="px-4 py-4 text-center font-medium tabular-nums">
                        {role.permissionCount}
                      </td>
                      <td className="px-4 py-4 text-center font-medium tabular-nums">
                        {role.assignmentCount}
                      </td>
                      <td className="px-4 py-4">
                        {role.isDelegable ? (
                          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
                            <CheckCircleIcon className="size-4" />
                            Delegable
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                            <LockKeyIcon className="size-4" />
                            Restricted
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openRoleDetail(role)}
                        >
                          <EyeIcon />
                          View details
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 border-t px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground" aria-live="polite">
                Showing {firstResult}–{lastResult} of {total} roles
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  <CaretLeftIcon />
                  Previous
                </Button>
                <span className="min-w-22 text-center text-sm text-muted-foreground">
                  Page {currentPage} of {lastPage}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={currentPage >= lastPage}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                  <CaretRightIcon />
                </Button>
              </div>
            </div>
          </>
        )}
      </section>

      <Dialog
        open={detailOpen}
        onOpenChange={(open) => {
          if (!open) clearSelectedRole();
        }}
      >
        <DialogContent className="top-1/2 start-1/2 max-h-[calc(100vh-2rem)] w-full max-w-[42rem] -translate-x-1/2 -translate-y-1/2 gap-0 overflow-y-auto p-0 sm:max-w-[42rem]">
          <RoleDetailDialog
            role={roleDetail}
            fallbackRole={selectedRole}
            loading={detailLoading}
            error={detailError}
            onRetry={retryDetail}
            onClose={clearSelectedRole}
          />
        </DialogContent>
      </Dialog>
    </main>
  );
}

function RoleTableSkeleton() {
  return (
    <div className="space-y-3 p-5" aria-label="Loading role catalogue">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

interface RoleDetailDialogProps {
  role: WorkforceRoleCatalogueRoleDetail | null;
  fallbackRole: WorkforceRoleCatalogueRole | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}

function RoleDetailDialog({
  role,
  fallbackRole,
  loading,
  error,
  onRetry,
  onClose,
}: RoleDetailDialogProps) {
  const roleName = role?.name ?? fallbackRole?.name ?? "Role details";

  return (
    <>
      <div className="border-b px-5 py-5 sm:px-6">
        <DialogHeader className="gap-3 pe-10">
          <div className="flex flex-wrap items-center gap-2">
            {fallbackRole && (
              <Badge
                variant={
                  fallbackRole.source === "global" ? "info" : "outline"
                }
              >
                {fallbackRole.source === "global"
                  ? "System template"
                  : "Practice role"}
              </Badge>
            )}
            {fallbackRole?.isDelegable ? (
              <Badge variant="success">
                <CheckCircleIcon />
                Delegable
              </Badge>
            ) : fallbackRole ? (
              <Badge variant="warning">
                <LockKeyIcon />
                Restricted
              </Badge>
            ) : null}
          </div>
          <DialogTitle className="text-xl font-semibold tracking-[-0.02em]">
            {roleName}
          </DialogTitle>
          {!loading && role && (
            <DialogDescription className="leading-6">
              {role.description}
            </DialogDescription>
          )}
        </DialogHeader>
      </div>

      {loading && (
        <div className="space-y-4 px-5 py-6 sm:px-6" aria-label="Loading role details">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {!loading && error && (
        <div className="grid justify-items-start gap-3 px-5 py-7 sm:px-6" role="alert">
          <span className="grid size-10 place-items-center rounded-full bg-destructive/10 text-destructive">
            <WarningCircleIcon className="size-5" />
          </span>
          <div>
            <h2 className="font-semibold">Role details unavailable</h2>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          </div>
          <Button size="sm" variant="outline" onClick={onRetry}>
            <ArrowClockwiseIcon />
            Try again
          </Button>
        </div>
      )}

      {!loading && !error && role && (
        <div className="px-5 py-6 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/15 px-4 py-3">
            <code className="font-mono text-xs text-muted-foreground">
              {role.code}
            </code>
            <div className="flex gap-5 text-sm">
              <span>
                <strong className="font-semibold text-foreground">
                  {role.permissionCount}
                </strong>{" "}
                <span className="text-muted-foreground">permissions</span>
              </span>
              <span>
                <strong className="font-semibold text-foreground">
                  {role.assignmentCount}
                </strong>{" "}
                <span className="text-muted-foreground">assigned</span>
              </span>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between border-b pb-3">
            <h2 className="font-semibold">Permissions</h2>
            <span className="text-sm text-muted-foreground">
              {role.permissions.length} active
            </span>
          </div>
          {role.permissions.length > 0 ? (
            <ul className="divide-y" aria-label={`${role.name} permissions`}>
              {role.permissions.map((permission) => (
                <li key={permission.permissionId} className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">
                        {permission.name}
                      </p>
                      <p className="mt-1 text-sm leading-5 text-muted-foreground">
                        {permission.description}
                      </p>
                    </div>
                    <code className="max-w-40 shrink-0 break-words text-end font-mono text-xs text-muted-foreground">
                      {permission.code}
                    </code>
                  </div>
                  {!permission.isDelegable && (
                    <p className="mt-2 text-xs font-medium text-warning">
                      Restricted from practice-local roles
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-5 text-sm text-muted-foreground">
              This role has no active permission grants.
            </p>
          )}
        </div>
      )}

      <DialogFooter className="sticky bottom-0 bg-popover">
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </>
  );
}
