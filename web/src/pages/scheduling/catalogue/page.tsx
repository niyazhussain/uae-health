import {
  ArrowClockwiseIcon,
  BuildingsIcon,
  CalendarCheckIcon,
  CheckCircleIcon,
  InfoIcon,
  LinkSimpleIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  ShieldCheckIcon,
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  addPractitionerFacilityAssignment,
  changePractitionerFacilityAssignment,
  changePractitionerServiceAssignment,
  createPractitionerServiceAssignment,
  createSchedulingPractitioner,
  createSchedulingService,
  createSchedulingSpecialty,
  getSchedulingContexts,
  getSchedulingPractitioners,
  getSchedulingServices,
  getSchedulingSpecialties,
  updateSchedulingService,
  updateSchedulingSpecialty,
  WorkforceSchedulingApiError,
  type PractitionerFacilityAssignment,
  type PractitionerServiceAssignment,
  type SchedulingContext,
  type SchedulingPractitioner,
  type SchedulingService,
  type SchedulingSpecialty,
} from "@/lib/workforce-scheduling";

type CatalogueView =
  "practitioners" | "specialties" | "services" | "facilities";

interface SchedulingCatalogueProps {
  csrfToken: string;
  selectedOrganizationId?: string;
  onSelectedOrganizationChange: (organizationId: string) => void;
  onContextChange: (context: SchedulingContext) => void;
  onPageReady: () => void;
  onSessionExpired: () => void;
}

interface ConfirmationAction {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  execute: () => Promise<boolean>;
}

const catalogueViews: Array<{
  id: CatalogueView;
  label: string;
  description: string;
}> = [
  {
    id: "practitioners",
    label: "Practitioners",
    description: "Profiles and facility affiliations",
  },
  {
    id: "specialties",
    label: "Specialties",
    description: "Practice-owned clinical categories",
  },
  {
    id: "services",
    label: "Services",
    description: "Patient-facing bookable services",
  },
  {
    id: "facilities",
    label: "Facilities",
    description: "Authorized scheduling locations",
  },
];

function apiMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

function statusBadge(status: "active" | "inactive" | "retired") {
  if (status === "active") {
    return (
      <Badge variant="success">
        <CheckCircleIcon />
        Active
      </Badge>
    );
  }
  if (status === "retired") {
    return <Badge variant="outline">Retired</Badge>;
  }
  return <Badge variant="warning">Inactive</Badge>;
}

export function SchedulingCatalogue({
  csrfToken,
  selectedOrganizationId,
  onSelectedOrganizationChange,
  onContextChange,
  onPageReady,
  onSessionExpired,
}: SchedulingCatalogueProps) {
  const [contexts, setContexts] = useState<SchedulingContext[]>([]);
  const [activeOrganizationId, setActiveOrganizationId] = useState(
    selectedOrganizationId ?? "",
  );
  const [practitioners, setPractitioners] = useState<SchedulingPractitioner[]>(
    [],
  );
  const [specialties, setSpecialties] = useState<SchedulingSpecialty[]>([]);
  const [services, setServices] = useState<SchedulingService[]>([]);
  const [totals, setTotals] = useState({
    practitioners: 0,
    specialties: 0,
    services: 0,
  });
  const [view, setView] = useState<CatalogueView>("practitioners");
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [createPractitionerOpen, setCreatePractitionerOpen] = useState(false);
  const [createSpecialtyOpen, setCreateSpecialtyOpen] = useState(false);
  const [createServiceOpen, setCreateServiceOpen] = useState(false);
  const [editSpecialty, setEditSpecialty] =
    useState<SchedulingSpecialty | null>(null);
  const [editService, setEditService] = useState<SchedulingService | null>(
    null,
  );
  const [addFacilityPractitioner, setAddFacilityPractitioner] =
    useState<SchedulingPractitioner | null>(null);
  const [eligibilityService, setEligibilityService] =
    useState<SchedulingService | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationAction | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setDenied(false);
      setError(null);
      setMutationError(null);
      try {
        const contextResponse = await getSchedulingContexts();
        if (cancelled) return;
        const nextContext =
          contextResponse.contexts.find(
            (context) => context.organizationId === activeOrganizationId,
          ) ??
          contextResponse.contexts.find(
            (context) => context.organizationId === selectedOrganizationId,
          ) ??
          contextResponse.contexts[0];

        setContexts(contextResponse.contexts);
        if (!nextContext) {
          setPractitioners([]);
          setSpecialties([]);
          setServices([]);
          setTotals({ practitioners: 0, specialties: 0, services: 0 });
          return;
        }

        if (nextContext.organizationId !== activeOrganizationId) {
          setActiveOrganizationId(nextContext.organizationId);
        }
        onSelectedOrganizationChange(nextContext.organizationId);
        onContextChange(nextContext);

        const [practitionerPage, specialtyPage, servicePage] =
          await Promise.all([
            getSchedulingPractitioners(nextContext.organizationId),
            getSchedulingSpecialties(nextContext.organizationId),
            getSchedulingServices(nextContext.organizationId),
          ]);
        if (cancelled) return;
        setPractitioners(practitionerPage.items);
        setSpecialties(specialtyPage.items);
        setServices(servicePage.items);
        setTotals({
          practitioners: practitionerPage.total,
          specialties: specialtyPage.total,
          services: servicePage.total,
        });
      } catch (reason: unknown) {
        if (cancelled) return;
        setPractitioners([]);
        setSpecialties([]);
        setServices([]);
        setTotals({ practitioners: 0, specialties: 0, services: 0 });
        if (reason instanceof WorkforceSchedulingApiError) {
          if (reason.status === 401) {
            onSessionExpired();
            return;
          }
          if (reason.status === 403) {
            setDenied(true);
            return;
          }
        }
        setError(
          apiMessage(reason, "The scheduling catalogue could not be loaded."),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [
    activeOrganizationId,
    onContextChange,
    onSelectedOrganizationChange,
    onSessionExpired,
    reloadVersion,
    selectedOrganizationId,
  ]);

  useEffect(() => {
    if (!loading) onPageReady();
  }, [loading, onPageReady]);

  const activeContext = contexts.find(
    (context) => context.organizationId === activeOrganizationId,
  );

  const availableFacilityAssignments = useMemo(() => {
    if (!eligibilityService) return [];
    return practitioners.flatMap((practitioner) =>
      practitioner.facilityAssignments
        .filter(
          (assignment) =>
            assignment.facilityId === eligibilityService.facilityId &&
            assignment.status === "active" &&
            !eligibilityService.practitionerAssignments.some(
              (existing) =>
                existing.practitionerFacilityAssignmentId ===
                assignment.assignmentId,
            ),
        )
        .map((assignment) => ({ practitioner, assignment })),
    );
  }, [eligibilityService, practitioners]);

  const selectPractice = (organizationId: string) => {
    setCreatePractitionerOpen(false);
    setCreateSpecialtyOpen(false);
    setCreateServiceOpen(false);
    setEditSpecialty(null);
    setEditService(null);
    setAddFacilityPractitioner(null);
    setEligibilityService(null);
    setConfirmation(null);
    setPractitioners([]);
    setSpecialties([]);
    setServices([]);
    setSuccess(null);
    setMutationError(null);
    setLoading(true);
    setActiveOrganizationId(organizationId);
    onSelectedOrganizationChange(organizationId);
  };

  const retry = () => {
    setLoading(true);
    setError(null);
    setDenied(false);
    setReloadVersion((version) => version + 1);
  };

  const runMutation = async (
    command: () => Promise<unknown>,
    successMessage: string,
  ): Promise<boolean> => {
    setSubmitting(true);
    setMutationError(null);
    try {
      await command();
      setSuccess(successMessage);
      setReloadVersion((version) => version + 1);
      return true;
    } catch (reason: unknown) {
      if (reason instanceof WorkforceSchedulingApiError) {
        if (reason.status === 401) {
          onSessionExpired();
          return false;
        }
        if (reason.status === 403) {
          setDenied(true);
          setCreatePractitionerOpen(false);
          setCreateSpecialtyOpen(false);
          setCreateServiceOpen(false);
          setEditSpecialty(null);
          setEditService(null);
          setAddFacilityPractitioner(null);
          setEligibilityService(null);
          setConfirmation(null);
          setPractitioners([]);
          setSpecialties([]);
          setServices([]);
          return false;
        }
        if (reason.status === 409) {
          setMutationError(
            "This catalogue changed before your command completed. Review the latest state and try again.",
          );
          return false;
        }
      }
      setMutationError(
        apiMessage(reason, "The scheduling change could not be completed."),
      );
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const askFacilityStatusChange = (
    practitioner: SchedulingPractitioner,
    assignment: PractitionerFacilityAssignment,
  ) => {
    const nextStatus = assignment.status === "active" ? "inactive" : "active";
    setConfirmation({
      title: `${nextStatus === "active" ? "Activate" : "Deactivate"} facility affiliation`,
      description:
        nextStatus === "active"
          ? `${practitioner.displayName} will become available for service eligibility at ${assignment.facilityName}.`
          : `New scheduling through ${assignment.facilityName} will stop. Existing appointment evidence remains available for staff resolution.`,
      confirmLabel:
        nextStatus === "active"
          ? "Activate affiliation"
          : "Deactivate affiliation",
      destructive: nextStatus === "inactive",
      execute: () =>
        runMutation(
          () =>
            changePractitionerFacilityAssignment(
              csrfToken,
              assignment,
              activeOrganizationId,
              nextStatus,
            ),
          `Facility affiliation ${nextStatus === "active" ? "activated" : "deactivated"}.`,
        ),
    });
  };

  const askEligibilityStatusChange = (
    service: SchedulingService,
    assignment: PractitionerServiceAssignment,
  ) => {
    const nextStatus = assignment.status === "active" ? "inactive" : "active";
    setConfirmation({
      title: `${nextStatus === "active" ? "Activate" : "Deactivate"} practitioner eligibility`,
      description:
        nextStatus === "active"
          ? `The practitioner will become eligible for ${service.patientFacingName}. The service still requires a complete active chain before publication.`
          : `New scheduling for this practitioner and service will stop. Existing appointment evidence remains available.`,
      confirmLabel:
        nextStatus === "active"
          ? "Activate eligibility"
          : "Deactivate eligibility",
      destructive: nextStatus === "inactive",
      execute: () =>
        runMutation(
          () =>
            changePractitionerServiceAssignment(
              csrfToken,
              assignment,
              activeOrganizationId,
              nextStatus,
            ),
          `Practitioner eligibility ${nextStatus === "active" ? "activated" : "deactivated"}.`,
        ),
    });
  };

  const askSpecialtyRetirement = (specialty: SchedulingSpecialty) => {
    setConfirmation({
      title: "Retire specialty",
      description: `${specialty.name} can be retired only after its dependent services are inactive. Retirement is terminal and preserves existing scheduling evidence.`,
      confirmLabel: "Retire specialty",
      destructive: true,
      execute: () =>
        runMutation(
          () =>
            updateSchedulingSpecialty(
              csrfToken,
              specialty,
              activeOrganizationId,
              {
                status: "retired",
              },
            ),
          "Specialty retired.",
        ),
    });
  };

  const askServiceStatusChange = (service: SchedulingService) => {
    const nextStatus = service.status === "active" ? "inactive" : "active";
    setConfirmation({
      title: `${nextStatus === "active" ? "Activate" : "Deactivate"} service`,
      description:
        nextStatus === "active"
          ? `${service.patientFacingName} will be published only if its specialty, facility, and practitioner eligibility chain is active.`
          : `New patient discovery and booking for ${service.patientFacingName} will stop. Existing requests remain available.`,
      confirmLabel:
        nextStatus === "active" ? "Activate service" : "Deactivate service",
      destructive: nextStatus === "inactive",
      execute: () =>
        runMutation(
          () =>
            updateSchedulingService(csrfToken, service, activeOrganizationId, {
              status: nextStatus,
            }),
          `Service ${nextStatus === "active" ? "activated" : "deactivated"}.`,
        ),
    });
  };

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="border-b pb-7">
        <div className="flex items-center gap-2 text-sm font-semibold text-primary">
          <ShieldCheckIcon className="size-5" />
          Scheduling administration
        </div>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
              Scheduling catalogue
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
              Configure practitioners, specialties, services, and eligibility in
              one authorized practice. Lifecycle changes preserve appointment
              evidence.
            </p>
          </div>
          {view === "practitioners" && activeContext && (
            <Button onClick={() => setCreatePractitionerOpen(true)}>
              <UserPlusIcon />
              Add practitioner
            </Button>
          )}
          {view === "specialties" &&
            activeContext?.canManagePracticeCatalogue && (
              <Button onClick={() => setCreateSpecialtyOpen(true)}>
                <PlusIcon />
                Add specialty
              </Button>
            )}
          {view === "services" && activeContext && (
            <Button onClick={() => setCreateServiceOpen(true)}>
              <PlusIcon />
              Add service
            </Button>
          )}
        </div>
      </section>

      {success && (
        <div
          className="mt-6 flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 p-4 text-sm"
          role="status"
        >
          <CheckCircleIcon className="mt-0.5 size-5 shrink-0 text-success" />
          <div className="flex-1">
            <p className="font-medium">Catalogue updated</p>
            <p className="mt-1 text-muted-foreground">{success}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setSuccess(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {mutationError && (
        <div
          className="fixed inset-x-4 bottom-4 z-[70] flex items-start gap-3 rounded-xl border border-destructive/30 bg-card p-4 text-sm shadow-xl sm:start-auto sm:w-full sm:max-w-md"
          role="alert"
        >
          <WarningCircleIcon className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="flex-1">
            <p className="font-medium">Change not completed</p>
            <p className="mt-1 text-muted-foreground">{mutationError}</p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setMutationError(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

      <section
        className="mt-7 overflow-hidden rounded-xl border bg-card shadow-[0_10px_28px_rgba(30,73,79,0.06)]"
        aria-label="Scheduling catalogue"
      >
        <div className="border-b bg-muted/20 p-4 sm:p-5">
          <div className="grid gap-2 sm:max-w-md">
            <Label htmlFor="scheduling-catalogue-practice">Practice</Label>
            <Select
              value={activeOrganizationId}
              onValueChange={selectPractice}
              disabled={loading || contexts.length === 0}
            >
              <SelectTrigger id="scheduling-catalogue-practice">
                <SelectValue placeholder="Select a practice" />
              </SelectTrigger>
              <SelectContent>
                {contexts.map((context) => (
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
        </div>

        <div
          className="border-b px-3 pt-3 sm:px-5"
          role="tablist"
          aria-label="Catalogue view"
        >
          <div className="flex gap-1 overflow-x-auto">
            {catalogueViews.map((catalogueView) => (
              <button
                key={catalogueView.id}
                type="button"
                role="tab"
                aria-selected={view === catalogueView.id}
                tabIndex={view === catalogueView.id ? 0 : -1}
                aria-controls={`catalogue-panel-${catalogueView.id}`}
                id={`catalogue-tab-${catalogueView.id}`}
                className={`min-h-11 shrink-0 rounded-t-md border-b-2 px-3 text-start text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:px-4 ${
                  view === catalogueView.id
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setView(catalogueView.id)}
                onKeyDown={(event) => {
                  const currentIndex = catalogueViews.findIndex(
                    (candidate) => candidate.id === catalogueView.id,
                  );
                  const nextIndex =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? catalogueViews.length - 1
                        : event.key === "ArrowRight"
                          ? (currentIndex + 1) % catalogueViews.length
                          : event.key === "ArrowLeft"
                            ? (currentIndex - 1 + catalogueViews.length) %
                              catalogueViews.length
                            : -1;
                  if (nextIndex < 0) return;
                  event.preventDefault();
                  const nextView = catalogueViews[nextIndex];
                  setView(nextView.id);
                  document
                    .getElementById(`catalogue-tab-${nextView.id}`)
                    ?.focus();
                }}
              >
                <span className="block">{catalogueView.label}</span>
                <span className="hidden text-xs font-normal text-muted-foreground lg:block">
                  {catalogueView.description}
                </span>
              </button>
            ))}
          </div>
        </div>

        {loading && <CatalogueSkeleton />}
        {!loading && denied && <DeniedState onRetry={retry} />}
        {!loading && !denied && error && (
          <ErrorState message={error} onRetry={retry} />
        )}
        {!loading && !denied && !error && contexts.length === 0 && (
          <EmptyState
            icon={<BuildingsIcon className="size-6" />}
            title="No scheduling practices"
            description="Your current account has no exact practice with scheduling administration access."
          />
        )}

        {!loading && !denied && !error && activeContext && (
          <div
            role="tabpanel"
            id={`catalogue-panel-${view}`}
            aria-labelledby={`catalogue-tab-${view}`}
          >
            <CatalogueGuidance view={view} />
            {view === "practitioners" && (
              <PractitionersPanel
                practitioners={practitioners}
                total={totals.practitioners}
                authorizedFacilityCount={activeContext.facilities.length}
                onAddFacility={setAddFacilityPractitioner}
                onChangeFacilityStatus={askFacilityStatusChange}
              />
            )}
            {view === "specialties" && (
              <SpecialtiesPanel
                specialties={specialties}
                total={totals.specialties}
                canManage={activeContext.canManagePracticeCatalogue}
                onEdit={setEditSpecialty}
                onRetire={askSpecialtyRetirement}
              />
            )}
            {view === "services" && (
              <ServicesPanel
                services={services}
                practitioners={practitioners}
                total={totals.services}
                onEdit={setEditService}
                onChangeStatus={askServiceStatusChange}
                onAddEligibility={setEligibilityService}
                onChangeEligibilityStatus={askEligibilityStatusChange}
              />
            )}
            {view === "facilities" && (
              <FacilitiesPanel
                context={activeContext}
                practitioners={practitioners}
                services={services}
              />
            )}
          </div>
        )}
      </section>

      {activeContext && (
        <>
          <CreatePractitionerDialog
            open={createPractitionerOpen}
            submitting={submitting}
            facilities={activeContext.facilities}
            onOpenChange={setCreatePractitionerOpen}
            onSubmit={(input) =>
              runMutation(
                () =>
                  createSchedulingPractitioner(csrfToken, {
                    organizationId: activeOrganizationId,
                    ...input,
                  }),
                "Practitioner created with an active facility affiliation.",
              )
            }
          />
          <CreateSpecialtyDialog
            open={createSpecialtyOpen}
            submitting={submitting}
            onOpenChange={setCreateSpecialtyOpen}
            onSubmit={(input) =>
              runMutation(
                () =>
                  createSchedulingSpecialty(
                    csrfToken,
                    activeOrganizationId,
                    input.code,
                    input.name,
                  ),
                "Specialty created.",
              )
            }
          />
          <CreateServiceDialog
            open={createServiceOpen}
            submitting={submitting}
            facilities={activeContext.facilities}
            specialties={specialties.filter(
              (specialty) => specialty.status === "active",
            )}
            onOpenChange={setCreateServiceOpen}
            onSubmit={(input) =>
              runMutation(
                () =>
                  createSchedulingService(csrfToken, {
                    organizationId: activeOrganizationId,
                    ...input,
                  }),
                "Inactive service created. Add an eligible practitioner before activation.",
              )
            }
          />
          {editSpecialty && (
            <EditSpecialtyDialog
              specialty={editSpecialty}
              submitting={submitting}
              onClose={() => setEditSpecialty(null)}
              onSubmit={(name) =>
                runMutation(
                  () =>
                    updateSchedulingSpecialty(
                      csrfToken,
                      editSpecialty,
                      activeOrganizationId,
                      { name },
                    ),
                  "Specialty name updated.",
                )
              }
            />
          )}
          {editService && (
            <EditServiceDialog
              service={editService}
              submitting={submitting}
              onClose={() => setEditService(null)}
              onSubmit={(input) =>
                runMutation(
                  () =>
                    updateSchedulingService(
                      csrfToken,
                      editService,
                      activeOrganizationId,
                      input,
                    ),
                  "Service settings updated.",
                )
              }
            />
          )}
          {addFacilityPractitioner && (
            <AddFacilityDialog
              practitioner={addFacilityPractitioner}
              facilities={activeContext.facilities.filter(
                (facility) =>
                  !addFacilityPractitioner.facilityAssignments.some(
                    (assignment) =>
                      assignment.facilityId === facility.facilityId,
                  ),
              )}
              submitting={submitting}
              onClose={() => setAddFacilityPractitioner(null)}
              onSubmit={(facilityId) =>
                runMutation(
                  () =>
                    addPractitionerFacilityAssignment(
                      csrfToken,
                      addFacilityPractitioner.practitionerId,
                      activeOrganizationId,
                      facilityId,
                    ),
                  "Inactive facility affiliation added. Activate it when staffing is approved.",
                )
              }
            />
          )}
          {eligibilityService && (
            <AddEligibilityDialog
              service={eligibilityService}
              options={availableFacilityAssignments}
              submitting={submitting}
              onClose={() => setEligibilityService(null)}
              onSubmit={(assignmentId) =>
                runMutation(
                  () =>
                    createPractitionerServiceAssignment(
                      csrfToken,
                      eligibilityService.appointmentServiceId,
                      activeOrganizationId,
                      assignmentId,
                    ),
                  "Inactive practitioner eligibility added. Activate it when the service is ready.",
                )
              }
            />
          )}
        </>
      )}

      <ConfirmationDialog
        action={confirmation}
        submitting={submitting}
        onClose={() => setConfirmation(null)}
      />
    </main>
  );
}

function CatalogueSkeleton() {
  return (
    <div
      className="space-y-3 p-5"
      role="status"
      aria-label="Loading scheduling catalogue"
    >
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
      <span className="sr-only">Loading scheduling catalogue</span>
    </div>
  );
}

function DeniedState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="grid justify-items-start gap-3 p-6" role="alert">
      <span className="grid size-10 place-items-center rounded-full bg-destructive/10 text-destructive">
        <WarningCircleIcon className="size-5" />
      </span>
      <div>
        <h2 className="font-semibold">Catalogue access unavailable</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Scheduling catalogue access is not permitted for this practice.
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={onRetry}>
        <ArrowClockwiseIcon />
        Try again
      </Button>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="grid justify-items-start gap-3 p-6" role="alert">
      <span className="grid size-10 place-items-center rounded-full bg-destructive/10 text-destructive">
        <WarningCircleIcon className="size-5" />
      </span>
      <div>
        <h2 className="font-semibold">Catalogue unavailable</h2>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      </div>
      <Button size="sm" variant="outline" onClick={onRetry}>
        <ArrowClockwiseIcon />
        Try again
      </Button>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="grid justify-items-center gap-3 px-5 py-14 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </span>
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-1 max-w-lg text-sm text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

function ResultNotice({
  shown,
  total,
  label,
}: {
  shown: number;
  total: number;
  label: string;
}) {
  return (
    <p className="border-t px-5 py-3 text-xs text-muted-foreground">
      Showing {shown} of {total} {label}. The API limits this administration
      view to 50 records.
    </p>
  );
}

function InfoTip({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={label}
        >
          <InfoIcon className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  );
}

function CatalogueGuidance({ view }: { view: CatalogueView }) {
  const guidance: Record<CatalogueView, string> = {
    practitioners:
      "A practitioner profile does not create login access. Facility affiliations define where that practitioner may become eligible for services.",
    specialties:
      "Specialties organize patient-facing services. Retire a specialty only after every dependent service is inactive.",
    services:
      "A service becomes publishable only with an active specialty, facility affiliation, and practitioner eligibility. Weekly schedules and generated time slots are managed in Availability.",
    facilities:
      "Scheduling uses existing authorized facilities. Facility creation and ownership remain in Operations.",
  };

  return (
    <div className="flex items-start gap-3 border-b bg-info/10 px-5 py-3 text-sm">
      <InfoIcon className="mt-0.5 size-5 shrink-0 text-primary" />
      <p className="max-w-4xl leading-6 text-muted-foreground">
        {guidance[view]}
      </p>
    </div>
  );
}

function PractitionersPanel({
  practitioners,
  total,
  authorizedFacilityCount,
  onAddFacility,
  onChangeFacilityStatus,
}: {
  practitioners: SchedulingPractitioner[];
  total: number;
  authorizedFacilityCount: number;
  onAddFacility: (practitioner: SchedulingPractitioner) => void;
  onChangeFacilityStatus: (
    practitioner: SchedulingPractitioner,
    assignment: PractitionerFacilityAssignment,
  ) => void;
}) {
  if (practitioners.length === 0) {
    return (
      <EmptyState
        icon={<UsersThreeIcon className="size-6" />}
        title="No practitioners configured"
        description="Create a practitioner and their first facility affiliation to begin the scheduling catalogue."
      />
    );
  }
  return (
    <>
      <div className="divide-y">
        {practitioners.map((practitioner) => (
          <article key={practitioner.practitionerId} className="p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground">
                  <UserCircleIcon className="size-5" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">
                      {practitioner.displayName}
                    </h2>
                    {statusBadge(practitioner.status)}
                    {practitioner.applicationUserLinked && (
                      <Badge variant="info">
                        <LinkSimpleIcon />
                        Workforce link
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {practitioner.professionalTitle}
                  </p>
                </div>
              </div>
              {practitioner.facilityAssignments.length >=
              authorizedFacilityCount ? (
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="outline" disabled>
                    All facilities assigned
                  </Button>
                  <InfoTip label="This practitioner already has an affiliation with every facility in your current scheduling scope." />
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onAddFacility(practitioner)}
                >
                  <PlusIcon />
                  Add facility
                </Button>
              )}
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="flex items-center gap-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Facility affiliations
                  </p>
                  <InfoTip label="An affiliation connects this practitioner to one authorized facility. It does not grant workforce login access." />
                </div>
                <div className="mt-3 grid gap-2">
                  {practitioner.facilityAssignments.map((assignment) => (
                    <div
                      key={assignment.assignmentId}
                      className="flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {assignment.facilityName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {assignment.status}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          onChangeFacilityStatus(practitioner, assignment)
                        }
                      >
                        {assignment.status === "active" ? (
                          <PauseIcon />
                        ) : (
                          <PlayIcon />
                        )}
                        {assignment.status === "active"
                          ? "Deactivate"
                          : "Activate"}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="flex items-center gap-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Service eligibility
                  </p>
                  <InfoTip label="Eligibility connects an active facility affiliation to a specific appointment service." />
                </div>
                {practitioner.serviceAssignments.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    No service eligibility assigned.
                  </p>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {practitioner.serviceAssignments.map((assignment) => (
                      <Badge
                        key={assignment.assignmentId}
                        variant={
                          assignment.status === "active" ? "success" : "outline"
                        }
                      >
                        {assignment.serviceName} · {assignment.status}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      <ResultNotice
        shown={practitioners.length}
        total={total}
        label="practitioners"
      />
    </>
  );
}

function SpecialtiesPanel({
  specialties,
  total,
  canManage,
  onEdit,
  onRetire,
}: {
  specialties: SchedulingSpecialty[];
  total: number;
  canManage: boolean;
  onEdit: (specialty: SchedulingSpecialty) => void;
  onRetire: (specialty: SchedulingSpecialty) => void;
}) {
  if (specialties.length === 0) {
    return (
      <EmptyState
        icon={<CalendarCheckIcon className="size-6" />}
        title="No specialties configured"
        description="An organization-wide scheduling administrator can add the first specialty."
      />
    );
  }
  return (
    <>
      {!canManage && (
        <div className="border-b bg-info/10 px-5 py-3 text-sm text-muted-foreground">
          Specialty management requires practice-wide catalogue authority. You
          can still use active specialties when configuring an authorized
          facility.
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[42rem] text-sm">
          <caption className="sr-only">
            Specialties in the selected practice
          </caption>
          <thead className="border-b bg-muted/35 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">Specialty</th>
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-5 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {specialties.map((specialty) => (
              <tr key={specialty.specialtyId} className="hover:bg-muted/25">
                <td className="px-5 py-4 font-semibold">{specialty.name}</td>
                <td className="px-4 py-4 font-mono text-xs text-muted-foreground">
                  {specialty.code}
                </td>
                <td className="px-4 py-4">{statusBadge(specialty.status)}</td>
                <td className="px-5 py-4">
                  <div className="flex justify-end gap-2">
                    {canManage && specialty.status === "active" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onEdit(specialty)}
                        >
                          Rename
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onRetire(specialty)}
                        >
                          Retire
                        </Button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ResultNotice
        shown={specialties.length}
        total={total}
        label="specialties"
      />
    </>
  );
}

function ServicesPanel({
  services,
  practitioners,
  total,
  onEdit,
  onChangeStatus,
  onAddEligibility,
  onChangeEligibilityStatus,
}: {
  services: SchedulingService[];
  practitioners: SchedulingPractitioner[];
  total: number;
  onEdit: (service: SchedulingService) => void;
  onChangeStatus: (service: SchedulingService) => void;
  onAddEligibility: (service: SchedulingService) => void;
  onChangeEligibilityStatus: (
    service: SchedulingService,
    assignment: PractitionerServiceAssignment,
  ) => void;
}) {
  if (services.length === 0) {
    return (
      <EmptyState
        icon={<CalendarCheckIcon className="size-6" />}
        title="No services configured"
        description="Create an inactive service, add eligible practitioners, then activate it for patient discovery."
      />
    );
  }
  return (
    <>
      <div className="divide-y">
        {services.map((service) => (
          <article key={service.appointmentServiceId} className="p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">{service.patientFacingName}</h2>
                  {statusBadge(service.status)}
                  <Badge variant={service.publishable ? "success" : "warning"}>
                    {service.publishable
                      ? "Ready to publish"
                      : "Not publishable"}
                  </Badge>
                  <InfoTip label="Publishable means the specialty, practitioner, facility affiliation, and service eligibility chain is active." />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {service.specialtyName} · {service.facilityName} ·{" "}
                  {service.durationMinutes} minutes
                </p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {service.code}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onEdit(service)}
                >
                  Edit settings
                </Button>
                {hasAdditionalEligibility(service, practitioners) ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onAddEligibility(service)}
                  >
                    <UserPlusIcon />
                    Add eligibility
                  </Button>
                ) : (
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" disabled>
                      All practitioners assigned
                    </Button>
                    <InfoTip label="Every active practitioner affiliation at this service facility already has an eligibility record." />
                  </div>
                )}
                <Button
                  size="sm"
                  variant={service.status === "active" ? "outline" : "default"}
                  onClick={() => onChangeStatus(service)}
                >
                  {service.status === "active" ? <PauseIcon /> : <PlayIcon />}
                  {service.status === "active" ? "Deactivate" : "Activate"}
                </Button>
              </div>
            </div>
            <div className="mt-4 rounded-lg border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Eligible practitioners
                  </p>
                  <InfoTip label="Eligibility permits this practitioner to provide the service at its exact facility. It does not create schedule hours or time slots." />
                </div>
                <span className="text-xs text-muted-foreground">
                  {service.activePractitionerCount} active
                </span>
              </div>
              {service.practitionerAssignments.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  No eligible practitioners assigned.
                </p>
              ) : (
                <div className="mt-3 overflow-hidden rounded-md border bg-card">
                  <div className="hidden grid-cols-[minmax(0,1fr)_10rem_9rem] items-center border-b bg-muted/35 px-3 py-2 text-xs font-medium text-muted-foreground sm:grid">
                    <span>Practitioner</span>
                    <span>Eligibility</span>
                    <span className="text-right">Action</span>
                  </div>
                  <ul className="divide-y">
                    {service.practitionerAssignments.map((assignment) => {
                      const practitionerName =
                        practitioners.find((practitioner) =>
                          practitioner.facilityAssignments.some(
                            (facilityAssignment) =>
                              facilityAssignment.assignmentId ===
                              assignment.practitionerFacilityAssignmentId,
                          ),
                        )?.displayName ?? "Eligible practitioner";

                      return (
                        <li
                          key={assignment.assignmentId}
                          className="grid gap-3 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_10rem_9rem] sm:items-center"
                        >
                          <p className="min-w-0 truncate text-sm font-medium">
                            {practitionerName}
                          </p>
                          <div>{statusBadge(assignment.status)}</div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-fit sm:justify-self-end"
                            aria-label={`${
                              assignment.status === "active"
                                ? "Deactivate"
                                : "Activate"
                            } eligibility for ${practitionerName}`}
                            onClick={() =>
                              onChangeEligibilityStatus(service, assignment)
                            }
                          >
                            {assignment.status === "active" ? (
                              <PauseIcon />
                            ) : (
                              <PlayIcon />
                            )}
                            {assignment.status === "active"
                              ? "Deactivate"
                              : "Activate"}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1">
                {service.allowsAnyPractitioner
                  ? "Any practitioner allowed"
                  : "Named practitioner required"}
                <InfoTip
                  label={
                    service.allowsAnyPractitioner
                      ? "Patients may request any currently available eligible practitioner. A concrete practitioner and slot are still recorded before booking."
                      : "Patients must select one named eligible practitioner before choosing a time."
                  }
                />
              </span>
            </div>
          </article>
        ))}
      </div>
      <ResultNotice shown={services.length} total={total} label="services" />
    </>
  );
}

function hasAdditionalEligibility(
  service: SchedulingService,
  practitioners: SchedulingPractitioner[],
): boolean {
  return practitioners.some((practitioner) =>
    practitioner.facilityAssignments.some(
      (facilityAssignment) =>
        facilityAssignment.facilityId === service.facilityId &&
        facilityAssignment.status === "active" &&
        !service.practitionerAssignments.some(
          (assignment) =>
            assignment.practitionerFacilityAssignmentId ===
            facilityAssignment.assignmentId,
        ),
    ),
  );
}

function FacilitiesPanel({
  context,
  practitioners,
  services,
}: {
  context: SchedulingContext;
  practitioners: SchedulingPractitioner[];
  services: SchedulingService[];
}) {
  if (context.facilities.length === 0) {
    return (
      <EmptyState
        icon={<BuildingsIcon className="size-6" />}
        title="No authorized facilities"
        description="Facility ownership is managed in Operations. Scheduling access appears here only after exact facility authorization is granted."
      />
    );
  }
  return (
    <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
      {context.facilities.map((facility) => {
        const affiliationCount = practitioners.reduce(
          (count, practitioner) =>
            count +
            practitioner.facilityAssignments.filter(
              (assignment) =>
                assignment.facilityId === facility.facilityId &&
                assignment.status === "active",
            ).length,
          0,
        );
        const serviceCount = services.filter(
          (service) => service.facilityId === facility.facilityId,
        ).length;
        return (
          <article
            key={facility.facilityId}
            className="rounded-xl border bg-muted/15 p-4"
          >
            <span className="grid size-10 place-items-center rounded-lg bg-secondary text-secondary-foreground">
              <BuildingsIcon className="size-5" />
            </span>
            <h2 className="mt-4 font-semibold">{facility.facilityName}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {facility.timezone}
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-4 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">
                  Visible active practitioners
                </dt>
                <dd className="mt-1 font-semibold tabular-nums">
                  {affiliationCount}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  Visible services
                </dt>
                <dd className="mt-1 font-semibold tabular-nums">
                  {serviceCount}
                </dd>
              </div>
            </dl>
          </article>
        );
      })}
      <p className="md:col-span-2 xl:col-span-3 text-xs leading-5 text-muted-foreground">
        Facility creation and ownership remain under Operations. This view shows
        only locations where your current scheduling scope is authorized.
      </p>
    </div>
  );
}

function CreatePractitionerDialog({
  open,
  facilities,
  submitting,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  facilities: SchedulingContext["facilities"];
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: {
    facilityId: string;
    displayName: string;
    professionalTitle: string;
  }) => Promise<boolean>;
}) {
  const [facilityId, setFacilityId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [professionalTitle, setProfessionalTitle] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!facilityId) return;
    if (await onSubmit({ facilityId, displayName, professionalTitle })) {
      setFacilityId("");
      setDisplayName("");
      setProfessionalTitle("");
      onOpenChange(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form className="grid gap-5" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add practitioner</DialogTitle>
            <DialogDescription>
              Create a scheduling profile and its first active facility
              affiliation. This does not create login access.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="practitioner-name">Display name</Label>
            <Input
              id="practitioner-name"
              minLength={2}
              maxLength={200}
              required
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="practitioner-title">Professional title</Label>
            <Input
              id="practitioner-title"
              minLength={2}
              maxLength={200}
              required
              value={professionalTitle}
              onChange={(event) => setProfessionalTitle(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="practitioner-facility">First facility</Label>
            <Select value={facilityId} onValueChange={setFacilityId} required>
              <SelectTrigger id="practitioner-facility">
                <SelectValue placeholder="Select a facility" />
              </SelectTrigger>
              <SelectContent>
                {facilities.map((facility) => (
                  <SelectItem
                    key={facility.facilityId}
                    value={facility.facilityId}
                  >
                    {facility.facilityName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting || !facilityId || facilities.length === 0}
            >
              <UserPlusIcon />
              {submitting ? "Adding practitioner" : "Add practitioner"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateSpecialtyDialog({
  open,
  submitting,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: { code: string; name: string }) => Promise<boolean>;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await onSubmit({ code: code.toUpperCase(), name })) {
      setCode("");
      setName("");
      onOpenChange(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form className="grid gap-5" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add specialty</DialogTitle>
            <DialogDescription>
              Create a controlled specialty for this exact practice. Codes
              remain immutable.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="specialty-code">Code</Label>
            <Input
              id="specialty-code"
              minLength={2}
              maxLength={64}
              pattern="[A-Za-z0-9][A-Za-z0-9-]+"
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="GENERAL-MEDICINE"
            />
            <p className="text-xs text-muted-foreground">
              Letters, numbers, and hyphens only.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="specialty-name">Name</Label>
            <Input
              id="specialty-name"
              minLength={2}
              maxLength={200}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Adding specialty" : "Add specialty"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateServiceDialog({
  open,
  submitting,
  facilities,
  specialties,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  submitting: boolean;
  facilities: SchedulingContext["facilities"];
  specialties: SchedulingSpecialty[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: {
    facilityId: string;
    specialtyId: string;
    code: string;
    patientFacingName: string;
    durationMinutes: number;
    allowsAnyPractitioner: boolean;
  }) => Promise<boolean>;
}) {
  const [facilityId, setFacilityId] = useState("");
  const [specialtyId, setSpecialtyId] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [duration, setDuration] = useState("30");
  const [allowsAny, setAllowsAny] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!facilityId || !specialtyId) return;
    if (
      await onSubmit({
        facilityId,
        specialtyId,
        code: code.toUpperCase(),
        patientFacingName: name,
        durationMinutes: Number(duration),
        allowsAnyPractitioner: allowsAny,
      })
    ) {
      setFacilityId("");
      setSpecialtyId("");
      setCode("");
      setName("");
      setDuration("30");
      setAllowsAny(false);
      onOpenChange(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl">
        <form className="grid gap-5" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add appointment service</DialogTitle>
            <DialogDescription>
              New services start inactive. Add eligible practitioners before
              activation.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="service-facility">Facility</Label>
              <Select value={facilityId} onValueChange={setFacilityId} required>
                <SelectTrigger id="service-facility">
                  <SelectValue placeholder="Select facility" />
                </SelectTrigger>
                <SelectContent>
                  {facilities.map((facility) => (
                    <SelectItem
                      key={facility.facilityId}
                      value={facility.facilityId}
                    >
                      {facility.facilityName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="service-specialty">Specialty</Label>
              <Select
                value={specialtyId}
                onValueChange={setSpecialtyId}
                required
              >
                <SelectTrigger id="service-specialty">
                  <SelectValue placeholder="Select specialty" />
                </SelectTrigger>
                <SelectContent>
                  {specialties.map((specialty) => (
                    <SelectItem
                      key={specialty.specialtyId}
                      value={specialty.specialtyId}
                    >
                      {specialty.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="service-code">Code</Label>
            <Input
              id="service-code"
              minLength={2}
              maxLength={64}
              pattern="[A-Za-z0-9][A-Za-z0-9-]+"
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="GENERAL-CONSULTATION"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="service-name">Patient-facing name</Label>
            <Input
              id="service-name"
              minLength={2}
              maxLength={200}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="grid gap-2 sm:max-w-48">
            <Label htmlFor="service-duration">Duration in minutes</Label>
            <Input
              id="service-duration"
              type="number"
              min={1}
              max={1440}
              step={1}
              required
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </div>
          <div className="flex items-start gap-3 rounded-lg border bg-muted/20 p-3">
            <Checkbox
              id="service-any"
              checked={allowsAny}
              onCheckedChange={(checked) => setAllowsAny(checked === true)}
            />
            <Label
              htmlFor="service-any"
              className="grid cursor-pointer gap-1 font-normal"
            >
              <span className="font-medium">
                Allow any eligible practitioner
              </span>
              <span className="text-xs leading-5 text-muted-foreground">
                Patients may choose any mode only after the service is active
                and has an active eligible practitioner.
              </span>
            </Label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                submitting ||
                !facilityId ||
                !specialtyId ||
                specialties.length === 0
              }
            >
              {submitting ? "Adding service" : "Add service"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditSpecialtyDialog({
  specialty,
  submitting,
  onClose,
  onSubmit,
}: {
  specialty: SchedulingSpecialty;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (name: string) => Promise<boolean>;
}) {
  const [name, setName] = useState(specialty.name);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await onSubmit(name)) onClose();
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form className="grid gap-5" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Rename specialty</DialogTitle>
            <DialogDescription>
              The specialty code remains unchanged.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="edit-specialty-name">Name</Label>
            <Input
              id="edit-specialty-name"
              minLength={2}
              maxLength={200}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving" : "Save name"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditServiceDialog({
  service,
  submitting,
  onClose,
  onSubmit,
}: {
  service: SchedulingService;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (input: {
    patientFacingName: string;
    allowsAnyPractitioner: boolean;
  }) => Promise<boolean>;
}) {
  const [name, setName] = useState(service.patientFacingName);
  const [allowsAny, setAllowsAny] = useState(service.allowsAnyPractitioner);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (
      await onSubmit({
        patientFacingName: name,
        allowsAnyPractitioner: allowsAny,
      })
    )
      onClose();
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form className="grid gap-5" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Edit service settings</DialogTitle>
            <DialogDescription>
              Facility, specialty, code, and duration remain unchanged in this
              catalogue workflow.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="edit-service-name">Patient-facing name</Label>
            <Input
              id="edit-service-name"
              minLength={2}
              maxLength={200}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex items-start gap-3 rounded-lg border p-3">
            <Checkbox
              id="edit-service-any"
              checked={allowsAny}
              onCheckedChange={(checked) => setAllowsAny(checked === true)}
            />
            <Label
              htmlFor="edit-service-any"
              className="grid cursor-pointer gap-1 font-normal"
            >
              <span className="font-medium">
                Allow any eligible practitioner
              </span>
              <span className="text-xs text-muted-foreground">
                Named practitioner selection remains available.
              </span>
            </Label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving" : "Save settings"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddFacilityDialog({
  practitioner,
  facilities,
  submitting,
  onClose,
  onSubmit,
}: {
  practitioner: SchedulingPractitioner;
  facilities: SchedulingContext["facilities"];
  submitting: boolean;
  onClose: () => void;
  onSubmit: (facilityId: string) => Promise<boolean>;
}) {
  const [facilityId, setFacilityId] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (facilityId && (await onSubmit(facilityId))) onClose();
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form className="grid gap-5" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add facility affiliation</DialogTitle>
            <DialogDescription>
              The new affiliation starts inactive and does not grant workforce
              access.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/30 p-3 text-sm font-medium">
            {practitioner.displayName}
          </div>
          {facilities.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This practitioner is already affiliated with every authorized
              facility.
            </p>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="additional-facility">Facility</Label>
              <Select value={facilityId} onValueChange={setFacilityId} required>
                <SelectTrigger id="additional-facility">
                  <SelectValue placeholder="Select facility" />
                </SelectTrigger>
                <SelectContent>
                  {facilities.map((facility) => (
                    <SelectItem
                      key={facility.facilityId}
                      value={facility.facilityId}
                    >
                      {facility.facilityName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting || !facilityId || facilities.length === 0}
            >
              {submitting ? "Adding affiliation" : "Add affiliation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddEligibilityDialog({
  service,
  options,
  submitting,
  onClose,
  onSubmit,
}: {
  service: SchedulingService;
  options: Array<{
    practitioner: SchedulingPractitioner;
    assignment: PractitionerFacilityAssignment;
  }>;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (assignmentId: string) => Promise<boolean>;
}) {
  const [assignmentId, setAssignmentId] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (assignmentId && (await onSubmit(assignmentId))) onClose();
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form className="grid gap-5" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add practitioner eligibility</DialogTitle>
            <DialogDescription>
              Choose an active practitioner affiliation at the service facility.
              New eligibility starts inactive.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="font-medium">{service.patientFacingName}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {service.facilityName}
            </p>
          </div>
          {options.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No additional active facility affiliation is eligible for this
              service.
            </p>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="eligible-practitioner">Practitioner</Label>
              <Select
                value={assignmentId}
                onValueChange={setAssignmentId}
                required
              >
                <SelectTrigger id="eligible-practitioner">
                  <SelectValue placeholder="Select practitioner" />
                </SelectTrigger>
                <SelectContent>
                  {options.map(({ practitioner, assignment }) => (
                    <SelectItem
                      key={assignment.assignmentId}
                      value={assignment.assignmentId}
                    >
                      {practitioner.displayName} ·{" "}
                      {practitioner.professionalTitle}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting || !assignmentId || options.length === 0}
            >
              {submitting ? "Adding eligibility" : "Add eligibility"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmationDialog({
  action,
  submitting,
  onClose,
}: {
  action: ConfirmationAction | null;
  submitting: boolean;
  onClose: () => void;
}) {
  const confirm = async () => {
    if (action && (await action.execute())) onClose();
  };
  return (
    <Dialog open={Boolean(action)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{action?.title}</DialogTitle>
          <DialogDescription>{action?.description}</DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border bg-muted/25 p-3 text-xs leading-5 text-muted-foreground">
          This command uses current database authorization and optimistic state
          checks. It does not delete scheduling evidence.
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant={action?.destructive ? "destructive" : "default"}
            onClick={() => void confirm()}
            disabled={submitting}
          >
            {submitting ? "Applying change" : action?.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
