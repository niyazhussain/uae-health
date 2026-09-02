import {
  CalendarCheckIcon,
  CheckCircleIcon,
  ClockIcon,
  InfoIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

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
  decideWorkforceAppointment,
  getSchedulingContexts,
  getWorkforceAppointmentQueue,
  WorkforceSchedulingApiError,
  type SchedulingContext,
  type WorkforceAppointmentDecision,
  type WorkforceAppointmentDeclineReason,
  type WorkforceAppointmentQueueItem,
  type WorkforceAppointmentStatus,
} from "@/lib/workforce-scheduling";

interface WorkforceAppointmentQueueProps {
  csrfToken: string;
  selectedOrganizationId?: string;
  onSelectedOrganizationChange: (organizationId: string) => void;
  onContextChange: (context: SchedulingContext) => void;
  onPageReady: () => void;
  onSessionExpired: () => void;
}

type QueueFilter = "live" | WorkforceAppointmentStatus;
type DecisionKind = "confirmed" | "declined";
type MutationAttempt = "success" | "definitive-error" | "uncertain";

interface DecisionDraft {
  appointment: WorkforceAppointmentQueueItem;
  kind: DecisionKind;
  reasonCode: WorkforceAppointmentDeclineReason;
  idempotencyKey: string;
  outcomeUncertain: boolean;
}

const declineReasons: Array<{
  value: WorkforceAppointmentDeclineReason;
  label: string;
}> = [
  {
    value: "appointment-request-provider-unavailable",
    label: "Provider unavailable",
  },
  {
    value: "appointment-request-service-unavailable",
    label: "Service unavailable",
  },
  {
    value: "appointment-request-scheduling-conflict",
    label: "Scheduling conflict",
  },
];

function newCommandKey(): string {
  return crypto.randomUUID();
}

function apiMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

function formatAppointmentTime(
  startsAt: string,
  endsAt: string,
  timezone: string,
): string {
  try {
    const date = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: timezone,
    }).format(new Date(startsAt));
    const time = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
    });
    return `${date}, ${time.format(new Date(startsAt))} to ${time.format(
      new Date(endsAt),
    )}`;
  } catch {
    return `${startsAt} to ${endsAt}`;
  }
}

function appointmentStatusBadge(status: WorkforceAppointmentStatus) {
  if (status === "requested") return <Badge variant="warning">Requested</Badge>;
  if (status === "confirmed") {
    return (
      <Badge variant="success">
        <CheckCircleIcon />
        Confirmed
      </Badge>
    );
  }
  if (status === "declined") {
    return <Badge variant="destructive">Declined</Badge>;
  }
  return <Badge variant="outline">Cancelled</Badge>;
}

function QueueSkeleton() {
  return (
    <div className="space-y-3 p-5" role="status">
      <span className="sr-only">Loading appointment requests</span>
      {[0, 1, 2].map((value) => (
        <div
          key={value}
          className="grid gap-4 rounded-lg border p-4 lg:grid-cols-5"
        >
          <Skeleton className="h-10 w-44" />
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-10 w-44" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-9 w-40 lg:justify-self-end" />
        </div>
      ))}
    </div>
  );
}

function StatePanel({
  icon,
  title,
  description,
  action,
  role,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  role?: "alert" | "status";
}) {
  return (
    <div
      className="grid min-h-72 place-items-center p-6 text-center"
      role={role}
    >
      <div className="grid max-w-lg justify-items-center gap-4">
        <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </span>
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
        {action}
      </div>
    </div>
  );
}

export function WorkforceAppointmentQueue({
  csrfToken,
  selectedOrganizationId,
  onSelectedOrganizationChange,
  onContextChange,
  onPageReady,
  onSessionExpired,
}: WorkforceAppointmentQueueProps) {
  const [contexts, setContexts] = useState<SchedulingContext[]>([]);
  const [activeOrganizationId, setActiveOrganizationId] = useState(
    selectedOrganizationId ?? "",
  );
  const [activeFacilityId, setActiveFacilityId] = useState("");
  const [filter, setFilter] = useState<QueueFilter>("live");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<WorkforceAppointmentQueueItem[]>([]);
  const [queueNow, setQueueNow] = useState(0);
  const [baseLoading, setBaseLoading] = useState(true);
  const [queueLoading, setQueueLoading] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [decision, setDecision] = useState<DecisionDraft | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<WorkforceAppointmentDecision | null>(
    null,
  );
  const [reloadVersion, setReloadVersion] = useState(0);
  const scopeToken = useRef(0);
  const resultHeading = useRef<HTMLHeadingElement>(null);

  const activeContext = contexts.find(
    (context) => context.organizationId === activeOrganizationId,
  );
  const activeFacility = activeContext?.facilities.find(
    (facility) => facility.facilityId === activeFacilityId,
  );

  const clearPatientState = () => {
    setItems([]);
    setTotal(0);
    setPage(1);
    setDecision(null);
    setResult(null);
    setConflict(null);
    setMutationError(null);
  };

  useEffect(() => {
    let cancelled = false;

    const loadContexts = async () => {
      setBaseLoading(true);
      setDenied(false);
      setError(null);
      try {
        const response = await getSchedulingContexts();
        if (cancelled) return;
        const nextContext =
          response.contexts.find(
            (context) => context.organizationId === selectedOrganizationId,
          ) ?? response.contexts[0];
        setContexts(response.contexts);
        if (!nextContext) {
          clearPatientState();
          setActiveOrganizationId("");
          setActiveFacilityId("");
          return;
        }
        setActiveOrganizationId(nextContext.organizationId);
        setActiveFacilityId(nextContext.facilities[0]?.facilityId ?? "");
        onSelectedOrganizationChange(nextContext.organizationId);
        onContextChange(nextContext);
      } catch (reason: unknown) {
        if (cancelled) return;
        clearPatientState();
        setContexts([]);
        if (
          reason instanceof WorkforceSchedulingApiError &&
          reason.status === 401
        ) {
          onSessionExpired();
          return;
        }
        setError(apiMessage(reason, "Scheduling scope could not be loaded."));
      } finally {
        if (!cancelled) setBaseLoading(false);
      }
    };

    void loadContexts();
    return () => {
      cancelled = true;
    };
  }, [
    onContextChange,
    onSelectedOrganizationChange,
    onSessionExpired,
    selectedOrganizationId,
  ]);

  useEffect(() => {
    if (!activeOrganizationId || !activeFacilityId || baseLoading) return;
    let cancelled = false;
    const requestToken = scopeToken.current;

    const loadQueue = async () => {
      setQueueLoading(true);
      setDenied(false);
      setError(null);
      try {
        const response = await getWorkforceAppointmentQueue({
          organizationId: activeOrganizationId,
          facilityId: activeFacilityId,
          ...(filter === "live" ? {} : { status: filter }),
          page,
          pageSize: 25,
        });
        if (cancelled || requestToken !== scopeToken.current) return;
        setItems(response.items);
        setTotal(response.total);
        setQueueNow(Date.now());
      } catch (reason: unknown) {
        if (cancelled || requestToken !== scopeToken.current) return;
        setItems([]);
        setTotal(0);
        if (reason instanceof WorkforceSchedulingApiError) {
          if (reason.status === 401) {
            onSessionExpired();
            return;
          }
          if (reason.status === 403) {
            clearPatientState();
            setDenied(true);
            return;
          }
        }
        setError(
          apiMessage(reason, "The appointment queue could not be loaded."),
        );
      } finally {
        if (!cancelled && requestToken === scopeToken.current) {
          setQueueLoading(false);
        }
      }
    };

    void loadQueue();
    return () => {
      cancelled = true;
    };
  }, [
    activeFacilityId,
    activeOrganizationId,
    baseLoading,
    filter,
    onSessionExpired,
    page,
    reloadVersion,
  ]);

  const loading = baseLoading || queueLoading;
  useEffect(() => {
    if (!loading) onPageReady();
  }, [loading, onPageReady]);

  useEffect(() => {
    if (result) resultHeading.current?.focus();
  }, [result]);

  const selectPractice = (organizationId: string) => {
    const context = contexts.find(
      (candidate) => candidate.organizationId === organizationId,
    );
    if (!context) return;
    scopeToken.current += 1;
    clearPatientState();
    setDenied(false);
    setFilter("live");
    setActiveOrganizationId(organizationId);
    setActiveFacilityId(context.facilities[0]?.facilityId ?? "");
    onSelectedOrganizationChange(organizationId);
    onContextChange(context);
  };

  const selectFacility = (facilityId: string) => {
    scopeToken.current += 1;
    clearPatientState();
    setDenied(false);
    setFilter("live");
    setActiveFacilityId(facilityId);
  };

  const openDecision = (
    appointment: WorkforceAppointmentQueueItem,
    kind: DecisionKind,
  ) => {
    setMutationError(null);
    setConflict(null);
    setDecision({
      appointment,
      kind,
      reasonCode: "appointment-request-provider-unavailable",
      idempotencyKey: newCommandKey(),
      outcomeUncertain: false,
    });
  };

  const submitDecision = async (): Promise<MutationAttempt> => {
    if (!decision) return "definitive-error";
    const requestToken = scopeToken.current;
    setSubmitting(true);
    setMutationError(null);
    try {
      const response = await decideWorkforceAppointment(
        csrfToken,
        decision.appointment,
        activeOrganizationId,
        activeFacilityId,
        decision.kind === "confirmed"
          ? { status: "confirmed" }
          : { status: "declined", reasonCode: decision.reasonCode },
        decision.idempotencyKey,
      );
      if (requestToken !== scopeToken.current) return "definitive-error";
      setDecision(null);
      setResult(response.appointment);
      setReloadVersion((value) => value + 1);
      return "success";
    } catch (reason: unknown) {
      if (requestToken !== scopeToken.current) return "definitive-error";
      if (reason instanceof WorkforceSchedulingApiError) {
        if (reason.status === 401) {
          setDecision(null);
          onSessionExpired();
          return "definitive-error";
        }
        if (reason.status === 403) {
          clearPatientState();
          setDenied(true);
          return "definitive-error";
        }
        if (reason.status === 404 || reason.status === 409) {
          setDecision(null);
          setConflict(
            reason.status === 409
              ? "This request changed before the decision completed. The latest queue is being loaded. Review it before deciding again."
              : "This appointment request is no longer available in the selected facility. The latest queue is being loaded.",
          );
          setReloadVersion((value) => value + 1);
          return "definitive-error";
        }
        if (reason.status >= 500) {
          setDecision((current) =>
            current ? { ...current, outcomeUncertain: true } : current,
          );
          setMutationError(
            "The decision outcome could not be confirmed. Retry the unchanged decision to reuse its safety key.",
          );
          return "uncertain";
        }
      }
      if (reason instanceof TypeError) {
        setDecision((current) =>
          current ? { ...current, outcomeUncertain: true } : current,
        );
        setMutationError(
          "The decision outcome could not be confirmed. Check the connection, then retry without changing the decision.",
        );
        return "uncertain";
      }
      setMutationError(apiMessage(reason, "The decision could not be saved."));
      setDecision((current) =>
        current
          ? {
              ...current,
              idempotencyKey: newCommandKey(),
              outcomeUncertain: false,
            }
          : current,
      );
      return "definitive-error";
    } finally {
      setSubmitting(false);
    }
  };

  const pageCount = Math.max(1, Math.ceil(total / 25));
  const queueTitle = filter === "live" ? "Live reservations" : "History";

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
              Appointment requests
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
              Review exact-facility requests, confirm operational capacity, or
              decline with an approved scheduling reason.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => setReloadVersion((value) => value + 1)}
            disabled={!activeFacility || loading}
          >
            Refresh queue
          </Button>
        </div>
      </section>

      {result && (
        <section
          className="mt-6 rounded-xl border border-success/30 bg-success/10 p-4"
          aria-labelledby="appointment-decision-result"
        >
          <p className="sr-only" role="status">
            Appointment request {result.status}. Version {result.version}.
          </p>
          <div className="flex items-start gap-3">
            <CheckCircleIcon className="mt-0.5 size-5 shrink-0 text-success" />
            <div className="min-w-0 flex-1">
              <h2
                ref={resultHeading}
                id="appointment-decision-result"
                className="font-semibold outline-none"
                tabIndex={-1}
              >
                Request {result.status}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Version {result.version}. The server preserved the exact
                appointment and provider evidence.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Appointment{" "}
                <bdi dir="ltr" className="font-mono">
                  {result.appointmentId}
                </bdi>
                {result.releasedSlotDisposition
                  ? ` · released slot: ${result.releasedSlotDisposition.replaceAll("_", " ")}`
                  : ""}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setResult(null)}>
              Dismiss
            </Button>
          </div>
        </section>
      )}

      {conflict && (
        <div
          className="mt-6 flex items-start gap-3 rounded-xl border border-warning/35 bg-warning/10 p-4 text-sm"
          role="alert"
        >
          <WarningCircleIcon className="mt-0.5 size-5 shrink-0 text-warning-foreground" />
          <div className="flex-1">
            <p className="font-medium">Review the latest request</p>
            <p className="mt-1 text-muted-foreground">{conflict}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setConflict(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <section
        className="mt-7 overflow-hidden rounded-xl border bg-card shadow-[0_10px_28px_rgba(30,73,79,0.06)]"
        aria-label="Workforce appointment requests"
      >
        <div className="grid gap-4 border-b bg-muted/20 p-4 sm:p-5 lg:grid-cols-3">
          <div className="grid content-start gap-2">
            <Label htmlFor="appointment-queue-practice">Practice</Label>
            <Select
              value={activeOrganizationId}
              onValueChange={selectPractice}
              disabled={baseLoading || contexts.length === 0}
            >
              <SelectTrigger id="appointment-queue-practice">
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
            <p className="flex min-h-5 items-center text-xs text-muted-foreground">
              Exact authorized scheduling scope
            </p>
          </div>
          <div className="grid content-start gap-2">
            <Label htmlFor="appointment-queue-facility">Facility</Label>
            <Select
              value={activeFacilityId}
              onValueChange={selectFacility}
              disabled={baseLoading || !activeContext?.facilities.length}
            >
              <SelectTrigger id="appointment-queue-facility">
                <SelectValue placeholder="Select a facility" />
              </SelectTrigger>
              <SelectContent>
                {activeContext?.facilities.map((facility) => (
                  <SelectItem
                    key={facility.facilityId}
                    value={facility.facilityId}
                  >
                    {facility.facilityName} · {facility.timezone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="flex min-h-5 items-center gap-1 text-xs text-muted-foreground">
              <ClockIcon className="size-4" />
              {activeFacility
                ? `Local appointment timezone: ${activeFacility.timezone}`
                : "Select an authorized facility"}
            </p>
          </div>
          <div className="grid content-start gap-2">
            <Label htmlFor="appointment-queue-status">Queue view</Label>
            <Select
              value={filter}
              onValueChange={(value) => {
                clearPatientState();
                setFilter(value as QueueFilter);
              }}
              disabled={!activeFacility || denied}
            >
              <SelectTrigger id="appointment-queue-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="live">Live reservations</SelectItem>
                <SelectItem value="requested">Requested only</SelectItem>
                <SelectItem value="confirmed">Confirmed history</SelectItem>
                <SelectItem value="declined">Declined history</SelectItem>
                <SelectItem value="cancelled">Cancelled history</SelectItem>
              </SelectContent>
            </Select>
            <p className="flex min-h-5 items-center text-xs text-muted-foreground">
              Live includes requested and confirmed reservations
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 border-b bg-info/10 px-4 py-3 text-sm sm:px-5">
          <InfoIcon className="mt-0.5 size-5 shrink-0 text-primary" />
          <p className="max-w-4xl leading-6 text-muted-foreground">
            This queue requires both scheduling and patient-read permission in
            the selected facility. Confirmation is an operational decision, not
            attendance or clinical evidence.
          </p>
        </div>

        {baseLoading || queueLoading ? (
          <QueueSkeleton />
        ) : error ? (
          <StatePanel
            icon={<WarningCircleIcon className="size-6" />}
            title="Appointment queue unavailable"
            description={error}
            role="alert"
            action={
              <Button
                variant="outline"
                onClick={() => setReloadVersion((value) => value + 1)}
              >
                Try again
              </Button>
            }
          />
        ) : denied ? (
          <StatePanel
            icon={<ShieldCheckIcon className="size-6" />}
            title="Appointment queue access denied"
            description="Scheduling-management and patient-read access are both required for this exact facility. No patient-identifying rows are retained in this page state."
            role="alert"
          />
        ) : contexts.length === 0 ? (
          <StatePanel
            icon={<ShieldCheckIcon className="size-6" />}
            title="No scheduling practices"
            description="No exact-practice scheduling scope is currently available."
          />
        ) : !activeFacility ? (
          <StatePanel
            icon={<CalendarCheckIcon className="size-6" />}
            title="No authorized facility"
            description="Appointment requests require one exact facility returned by the scheduling context."
          />
        ) : items.length === 0 ? (
          <StatePanel
            icon={<CalendarCheckIcon className="size-6" />}
            title={`No ${filter === "live" ? "live reservations" : `${filter} requests`}`}
            description="No appointment requests match this exact facility and queue view."
          />
        ) : (
          <>
            <div className="border-b px-5 py-3">
              <h2 className="font-semibold">{queueTitle}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {total} request{total === 1 ? "" : "s"} in this exact scope
              </p>
            </div>
            <div className="hidden grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(0,1fr)_8rem_13rem] gap-4 border-b bg-muted/35 px-5 py-2 text-xs font-semibold text-muted-foreground lg:grid">
              <span>Patient</span>
              <span>Service and practitioner</span>
              <span>Appointment time</span>
              <span>Status</span>
              <span className="text-end">Action</span>
            </div>
            <div className="divide-y">
              {items.map((appointment) => {
                const overdue =
                  appointment.status === "requested" &&
                  new Date(appointment.startsAt).getTime() <= queueNow;
                return (
                  <article
                    key={appointment.appointmentId}
                    className="grid gap-4 border-s-4 border-s-transparent px-5 py-4 transition-colors hover:border-s-primary/40 hover:bg-primary/[0.025] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(0,1fr)_8rem_13rem] lg:items-center"
                  >
                    <div className="min-w-0">
                      <span className="text-xs font-medium text-muted-foreground lg:hidden">
                        Patient
                      </span>
                      <p className="truncate font-medium">
                        {appointment.patientDisplayName}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Request{" "}
                        <bdi dir="ltr" className="font-mono">
                          {appointment.appointmentId}
                        </bdi>
                      </p>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-muted-foreground lg:hidden">
                        Service and practitioner
                      </span>
                      <p className="text-sm font-medium">
                        {appointment.serviceName}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {appointment.specialtyName} ·{" "}
                        {appointment.practitionerDisplayName}
                        {appointment.practitionerProfessionalTitle
                          ? `, ${appointment.practitionerProfessionalTitle}`
                          : ""}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-muted-foreground lg:hidden">
                        Appointment time
                      </span>
                      <p className="text-sm font-medium">
                        {formatAppointmentTime(
                          appointment.startsAt,
                          appointment.endsAt,
                          appointment.facilityTimezone,
                        )}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {appointment.facilityTimezone} · version{" "}
                        {appointment.version}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {overdue && (
                          <Badge variant="warning">Overdue decision</Badge>
                        )}
                        {appointment.withdrawalPending && (
                          <Badge variant="warning">Deferred withdrawal</Badge>
                        )}
                      </div>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-muted-foreground lg:hidden">
                        Status
                      </span>
                      <div className="mt-1 lg:mt-0">
                        {appointmentStatusBadge(appointment.status)}
                      </div>
                    </div>
                    {appointment.status === "requested" ? (
                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        <Button
                          size="sm"
                          className="min-w-24"
                          onClick={() => openDecision(appointment, "confirmed")}
                        >
                          <CheckCircleIcon />
                          Confirm
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="min-w-24 border-destructive/45 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => openDecision(appointment, "declined")}
                        >
                          <XCircleIcon />
                          Decline
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground lg:text-end">
                        Review only
                      </span>
                    )}
                  </article>
                );
              })}
            </div>
            <div className="flex flex-col gap-3 border-t px-5 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <p>
                Page {page} of {pageCount} · {total} requests
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => value - 1)}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= pageCount}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </section>

      {mutationError && !decision && (
        <div
          className="fixed inset-x-4 bottom-4 z-[70] flex items-start gap-3 rounded-xl border border-destructive/30 bg-card p-4 text-sm shadow-xl sm:start-auto sm:w-full sm:max-w-md"
          role="alert"
        >
          <WarningCircleIcon className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="flex-1">
            <p className="font-medium">Decision not confirmed</p>
            <p className="mt-1 text-muted-foreground">{mutationError}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setMutationError(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

      <Dialog
        open={decision !== null}
        onOpenChange={(open) => {
          if (!open && !submitting && !decision?.outcomeUncertain) {
            setDecision(null);
          }
        }}
      >
        <DialogContent
          showCloseButton={!submitting && !decision?.outcomeUncertain}
        >
          <DialogHeader>
            <DialogTitle>
              {decision?.kind === "confirmed"
                ? "Confirm appointment request"
                : "Decline appointment request"}
            </DialogTitle>
            <DialogDescription>
              {decision?.kind === "confirmed"
                ? "Confirmation preserves the exact patient, practitioner, service, facility, and slot. It is not attendance or clinical evidence."
                : "Declining releases provider capacity. A deferred-withdrawal slot is re-evaluated in the same transaction."}
            </DialogDescription>
          </DialogHeader>

          {decision && (
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="font-medium">
                {decision.appointment.patientDisplayName}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {decision.appointment.serviceName} ·{" "}
                {decision.appointment.practitionerDisplayName}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatAppointmentTime(
                  decision.appointment.startsAt,
                  decision.appointment.endsAt,
                  decision.appointment.facilityTimezone,
                )}
              </p>
            </div>
          )}

          {decision?.kind === "declined" && (
            <div className="grid gap-2">
              <Label htmlFor="decline-reason">Operational reason</Label>
              <Select
                value={decision.reasonCode}
                onValueChange={(reasonCode) =>
                  setDecision((current) =>
                    current
                      ? {
                          ...current,
                          reasonCode:
                            reasonCode as WorkforceAppointmentDeclineReason,
                          idempotencyKey: newCommandKey(),
                          outcomeUncertain: false,
                        }
                      : current,
                  )
                }
                disabled={submitting || decision.outcomeUncertain}
              >
                <SelectTrigger id="decline-reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {declineReasons.map((reason) => (
                    <SelectItem key={reason.value} value={reason.value}>
                      {reason.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs leading-5 text-muted-foreground">
                Only this approved reason code is stored. No free-text patient
                or clinical information is accepted.
              </p>
            </div>
          )}

          {mutationError && (
            <p className="text-sm text-destructive" role="alert">
              {mutationError}
            </p>
          )}

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              disabled={submitting || decision?.outcomeUncertain}
              onClick={() => setDecision(null)}
            >
              Keep current status
            </Button>
            <Button
              type="button"
              variant={
                decision?.kind === "declined" ? "destructive" : "default"
              }
              disabled={submitting}
              onClick={() => void submitDecision()}
            >
              {submitting
                ? "Applying…"
                : decision?.kind === "confirmed"
                  ? "Confirm request"
                  : "Decline request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
