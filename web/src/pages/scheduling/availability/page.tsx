import {
  ArrowClockwiseIcon,
  BuildingsIcon,
  CalendarCheckIcon,
  CalendarXIcon,
  CaretRightIcon,
  CheckCircleIcon,
  ClockIcon,
  InfoIcon,
  PauseIcon,
  PencilSimpleIcon,
  PlayIcon,
  PlusIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

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
  cancelSchedulingAvailabilityException,
  changeSchedulingAvailabilityTemplateStatus,
  changeSchedulingServiceDuration,
  createSchedulingAvailabilityException,
  createSchedulingAvailabilityTemplate,
  getSchedulingAvailabilityExceptions,
  getSchedulingAvailabilitySlots,
  getSchedulingAvailabilityTemplates,
  getSchedulingContexts,
  getSchedulingPractitioners,
  getSchedulingServices,
  materializeSchedulingAvailabilityTemplate,
  replaceSchedulingAvailabilityTemplate,
  WorkforceSchedulingApiError,
  type AvailabilityMaterializationSummary,
  type SchedulingAvailabilityException,
  type SchedulingAvailabilitySlot,
  type SchedulingAvailabilityTemplate,
  type SchedulingContext,
  type SchedulingPractitioner,
  type SchedulingService,
} from "@/lib/workforce-scheduling";

type AvailabilityView = "weekly" | "exceptions" | "slots";
type MutationAttempt = "success" | "definitive-error" | "uncertain";

interface SchedulingAvailabilityProps {
  csrfToken: string;
  selectedOrganizationId?: string;
  onSelectedOrganizationChange: (organizationId: string) => void;
  onContextChange: (context: SchedulingContext) => void;
  onPageReady: () => void;
  onSessionExpired: () => void;
}

interface EligibilityOption {
  assignmentId: string;
  practitionerName: string;
  serviceName: string;
  serviceStatus: "active" | "inactive";
}

interface FacilityPractitionerOption {
  assignmentId: string;
  practitionerName: string;
}

interface ReconciliationResult {
  title: string;
  description: string;
  summary: AvailabilityMaterializationSummary;
}

interface ConfirmationAction {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  idempotencyKey: string;
  execute: (idempotencyKey: string) => Promise<MutationAttempt>;
}

const DAY_MS = 86_400_000;
const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

const availabilityViews: Array<{
  id: AvailabilityView;
  label: string;
  description: string;
}> = [
  {
    id: "weekly",
    label: "Weekly schedules",
    description: "Recurring facility-local working hours",
  },
  {
    id: "exceptions",
    label: "Exceptions",
    description: "Closures and practitioner time away",
  },
  {
    id: "slots",
    label: "Published slots",
    description: "Materialized operational capacity",
  },
];

function newCommandKey(): string {
  return crypto.randomUUID();
}

function apiMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

function localDateInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function addCalendarDays(localDate: string, days: number): string {
  const [year, month, day] = localDate.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return [
    String(value.getUTCFullYear()).padStart(4, "0"),
    String(value.getUTCMonth() + 1).padStart(2, "0"),
    String(value.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function minuteToTime(minute: number): string {
  if (minute === 1440) return "24:00";
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(
    minute % 60,
  ).padStart(2, "0")}`;
}

function timeToMinute(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function canonicalLocalDateTime(date: string, time: string): string {
  return `${date}T${time}:00`;
}

function canonicalLocalDateTimeFromInstant(
  instant: string,
  timezone: string,
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    numberingSystem: "latn",
  }).formatToParts(new Date(instant));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  const hour = value("hour");
  const minute = value("minute");

  if (!year || !month || !day || !hour || !minute) {
    throw new Error("The slot time could not be represented in this facility.");
  }

  return `${year}-${month}-${day}T${hour}:${minute}:00`;
}

function formatLocalEvidence(value: string): string {
  return value.replace("T", " ").replace(/:00$/, "");
}

function formatSlotRange(
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

function templateStatusBadge(status: "active" | "inactive") {
  return status === "active" ? (
    <Badge variant="success">
      <CheckCircleIcon />
      Active
    </Badge>
  ) : (
    <Badge variant="warning">Inactive</Badge>
  );
}

function exceptionStatusBadge(status: "active" | "cancelled") {
  return status === "active" ? (
    <Badge variant="warning">Active exception</Badge>
  ) : (
    <Badge variant="outline">Cancelled</Badge>
  );
}

function slotState(slot: SchedulingAvailabilitySlot): {
  label: string;
  variant: "success" | "warning" | "info" | "outline";
} {
  if (slot.status === "withdrawn") {
    return { label: "Withdrawn", variant: "outline" };
  }
  if (slot.withdrawalPending) {
    return { label: "Deferred withdrawal", variant: "warning" };
  }
  if (slot.hasLiveAppointment) {
    return { label: "Live reserved", variant: "info" };
  }
  return { label: "Available", variant: "success" };
}

export function SchedulingAvailability({
  csrfToken,
  selectedOrganizationId,
  onSelectedOrganizationChange,
  onContextChange,
  onPageReady,
  onSessionExpired,
}: SchedulingAvailabilityProps) {
  const [contexts, setContexts] = useState<SchedulingContext[]>([]);
  const [activeOrganizationId, setActiveOrganizationId] = useState(
    selectedOrganizationId ?? "",
  );
  const [activeFacilityId, setActiveFacilityId] = useState("");
  const [practitioners, setPractitioners] = useState<SchedulingPractitioner[]>(
    [],
  );
  const [services, setServices] = useState<SchedulingService[]>([]);
  const [templates, setTemplates] = useState<SchedulingAvailabilityTemplate[]>(
    [],
  );
  const [exceptions, setExceptions] = useState<
    SchedulingAvailabilityException[]
  >([]);
  const [slots, setSlots] = useState<SchedulingAvailabilitySlot[]>([]);
  const [totals, setTotals] = useState({
    templates: 0,
    exceptions: 0,
    slots: 0,
  });
  const [templatePage, setTemplatePage] = useState(1);
  const [templateServiceFilter, setTemplateServiceFilter] =
    useState<string>("all");
  const [templateStatusFilter, setTemplateStatusFilter] = useState<
    "all" | "active" | "inactive"
  >("all");
  const [exceptionPage, setExceptionPage] = useState(1);
  const [slotPage, setSlotPage] = useState(1);
  const [slotRangeDays, setSlotRangeDays] = useState<7 | 14 | 28>(14);
  const [slotStatus, setSlotStatus] = useState<
    "all" | "available" | "withdrawn"
  >("all");
  const [view, setView] = useState<AvailabilityView>("weekly");
  const [baseLoading, setBaseLoading] = useState(true);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [result, setResult] = useState<ReconciliationResult | null>(null);
  const [createTemplateOpen, setCreateTemplateOpen] = useState(false);
  const [editTemplate, setEditTemplate] =
    useState<SchedulingAvailabilityTemplate | null>(null);
  const [createExceptionOpen, setCreateExceptionOpen] = useState(false);
  const [durationService, setDurationService] =
    useState<SchedulingService | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationAction | null>(
    null,
  );
  const scopeToken = useRef(0);

  const clearScopedData = () => {
    setPractitioners([]);
    setServices([]);
    setTemplates([]);
    setExceptions([]);
    setSlots([]);
    setTotals({ templates: 0, exceptions: 0, slots: 0 });
    setTemplatePage(1);
    setTemplateServiceFilter("all");
    setTemplateStatusFilter("all");
    setExceptionPage(1);
    setSlotPage(1);
    setResult(null);
    setMutationError(null);
    setConflict(null);
    setCreateTemplateOpen(false);
    setEditTemplate(null);
    setCreateExceptionOpen(false);
    setDurationService(null);
    setConfirmation(null);
    setAvailabilityLoading(false);
  };

  useEffect(() => {
    let cancelled = false;

    const loadBase = async () => {
      setBaseLoading(true);
      setDenied(false);
      setError(null);
      try {
        const response = await getSchedulingContexts();
        if (cancelled) return;
        const nextContext =
          response.contexts.find(
            (context) => context.organizationId === activeOrganizationId,
          ) ??
          response.contexts.find(
            (context) => context.organizationId === selectedOrganizationId,
          ) ??
          response.contexts[0];
        setContexts(response.contexts);
        if (!nextContext) {
          clearScopedData();
          setActiveFacilityId("");
          return;
        }
        if (nextContext.organizationId !== activeOrganizationId) {
          scopeToken.current += 1;
          setActiveOrganizationId(nextContext.organizationId);
        }
        onSelectedOrganizationChange(nextContext.organizationId);
        onContextChange(nextContext);

        const [practitionerPage, servicePage] = await Promise.all([
          getSchedulingPractitioners(nextContext.organizationId),
          getSchedulingServices(nextContext.organizationId),
        ]);
        if (cancelled) return;
        setPractitioners(practitionerPage.items);
        setServices(servicePage.items);
        setDurationService((current) =>
          current
            ? (servicePage.items.find(
                (service) =>
                  service.appointmentServiceId === current.appointmentServiceId,
              ) ?? null)
            : null,
        );
        setActiveFacilityId((current) =>
          nextContext.facilities.some(
            (facility) => facility.facilityId === current,
          )
            ? current
            : (() => {
                const nextFacilityId =
                  nextContext.facilities[0]?.facilityId ?? "";
                if (nextFacilityId !== current) scopeToken.current += 1;
                return nextFacilityId;
              })(),
        );
      } catch (reason: unknown) {
        if (cancelled) return;
        clearScopedData();
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
        setError(apiMessage(reason, "Availability scope could not be loaded."));
      } finally {
        if (!cancelled) setBaseLoading(false);
      }
    };

    void loadBase();
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
    if (!activeOrganizationId || !activeFacilityId || denied) {
      return;
    }
    let cancelled = false;

    const loadAvailability = async () => {
      setAvailabilityLoading(true);
      setError(null);
      const startsAt = new Date();
      const endsAt = new Date(startsAt.getTime() + slotRangeDays * DAY_MS);
      try {
        const [templateResponse, exceptionResponse, slotResponse] =
          await Promise.all([
            getSchedulingAvailabilityTemplates(
              activeOrganizationId,
              activeFacilityId,
              templatePage,
              {
                ...(templateServiceFilter === "all"
                  ? {}
                  : { appointmentServiceId: templateServiceFilter }),
                ...(templateStatusFilter === "all"
                  ? {}
                  : { status: templateStatusFilter }),
              },
            ),
            getSchedulingAvailabilityExceptions(
              activeOrganizationId,
              activeFacilityId,
              exceptionPage,
            ),
            getSchedulingAvailabilitySlots({
              organizationId: activeOrganizationId,
              facilityId: activeFacilityId,
              startsAt: startsAt.toISOString(),
              endsAt: endsAt.toISOString(),
              page: slotPage,
              ...(slotStatus === "all" ? {} : { status: slotStatus }),
            }),
          ]);
        if (cancelled) return;
        setTemplates(templateResponse.items);
        setEditTemplate((current) =>
          current
            ? (templateResponse.items.find(
                (template) =>
                  template.availabilityTemplateId ===
                  current.availabilityTemplateId,
              ) ?? null)
            : null,
        );
        setExceptions(exceptionResponse.items);
        setSlots(slotResponse.items);
        setTotals({
          templates: templateResponse.total,
          exceptions: exceptionResponse.total,
          slots: slotResponse.total,
        });
      } catch (reason: unknown) {
        if (cancelled) return;
        setTemplates([]);
        setExceptions([]);
        setSlots([]);
        setTotals({ templates: 0, exceptions: 0, slots: 0 });
        if (reason instanceof WorkforceSchedulingApiError) {
          if (reason.status === 401) {
            onSessionExpired();
            return;
          }
          if (reason.status === 403) {
            clearScopedData();
            setDenied(true);
            return;
          }
        }
        setError(apiMessage(reason, "Availability data could not be loaded."));
      } finally {
        if (!cancelled) setAvailabilityLoading(false);
      }
    };

    void loadAvailability();
    return () => {
      cancelled = true;
    };
  }, [
    activeFacilityId,
    activeOrganizationId,
    denied,
    exceptionPage,
    reloadVersion,
    slotPage,
    slotRangeDays,
    slotStatus,
    templatePage,
    templateServiceFilter,
    templateStatusFilter,
    onSessionExpired,
  ]);

  const loading = baseLoading || availabilityLoading;
  useEffect(() => {
    if (!loading) onPageReady();
  }, [loading, onPageReady]);

  const activeContext = contexts.find(
    (context) => context.organizationId === activeOrganizationId,
  );
  const activeFacility = activeContext?.facilities.find(
    (facility) => facility.facilityId === activeFacilityId,
  );
  const selectedServices = services.filter(
    (service) => service.facilityId === activeFacilityId,
  );

  const eligibilityOptions = useMemo<EligibilityOption[]>(() => {
    return practitioners.flatMap((practitioner) => {
      if (practitioner.status !== "active") return [];
      const activeFacilityAssignments = practitioner.facilityAssignments.filter(
        (assignment) =>
          assignment.facilityId === activeFacilityId &&
          assignment.status === "active",
      );
      return practitioner.serviceAssignments.flatMap((assignment) => {
        const facilityAssignment = activeFacilityAssignments.find(
          (candidate) =>
            candidate.assignmentId ===
            assignment.practitionerFacilityAssignmentId,
        );
        const service = services.find(
          (candidate) =>
            candidate.appointmentServiceId ===
              assignment.appointmentServiceId &&
            candidate.facilityId === activeFacilityId,
        );
        if (!facilityAssignment || !service || assignment.status !== "active") {
          return [];
        }
        return [
          {
            assignmentId: assignment.assignmentId,
            practitionerName: practitioner.displayName,
            serviceName: service.patientFacingName,
            serviceStatus: service.status,
          },
        ];
      });
    });
  }, [activeFacilityId, practitioners, services]);

  const facilityPractitioners = useMemo<FacilityPractitionerOption[]>(() => {
    return practitioners.flatMap((practitioner) =>
      practitioner.status === "active"
        ? practitioner.facilityAssignments
            .filter(
              (assignment) =>
                assignment.facilityId === activeFacilityId &&
                assignment.status === "active",
            )
            .map((assignment) => ({
              assignmentId: assignment.assignmentId,
              practitionerName: practitioner.displayName,
            }))
        : [],
    );
  }, [activeFacilityId, practitioners]);

  const selectPractice = (organizationId: string) => {
    scopeToken.current += 1;
    clearScopedData();
    setBaseLoading(true);
    setActiveFacilityId("");
    setActiveOrganizationId(organizationId);
    onSelectedOrganizationChange(organizationId);
  };

  const selectFacility = (facilityId: string) => {
    scopeToken.current += 1;
    clearScopedData();
    setBaseLoading(true);
    setAvailabilityLoading(true);
    setActiveFacilityId(facilityId);
    setReloadVersion((value) => value + 1);
  };

  const retry = () => {
    setError(null);
    setDenied(false);
    setReloadVersion((value) => value + 1);
  };

  const runMutation = async (
    command: () => Promise<{
      materialization: AvailabilityMaterializationSummary;
    }>,
    title: string,
    description: string,
  ): Promise<MutationAttempt> => {
    const commandScopeToken = scopeToken.current;
    setSubmitting(true);
    setMutationError(null);
    setConflict(null);
    try {
      const response = await command();
      if (commandScopeToken !== scopeToken.current) {
        return "definitive-error";
      }
      setResult({ title, description, summary: response.materialization });
      setReloadVersion((value) => value + 1);
      return "success";
    } catch (reason: unknown) {
      if (reason instanceof WorkforceSchedulingApiError) {
        if (reason.status === 401) {
          onSessionExpired();
          return "definitive-error";
        }
        if (commandScopeToken !== scopeToken.current) {
          return "definitive-error";
        }
        if (reason.status === 403) {
          clearScopedData();
          setDenied(true);
          return "definitive-error";
        }
        if (reason.status === 409 || reason.status === 404) {
          setConflict(
            reason.status === 409
              ? "Availability changed before this command completed. The latest server state is being loaded. Review it before trying again."
              : "The selected availability target is no longer available. The latest server state is being loaded.",
          );
          setReloadVersion((value) => value + 1);
          return "definitive-error";
        }
        if (reason.status >= 500) {
          setMutationError(
            "The command outcome could not be confirmed. Retry the unchanged command to reuse its safety key.",
          );
          return "uncertain";
        }
      }
      if (commandScopeToken !== scopeToken.current) {
        return "definitive-error";
      }
      if (reason instanceof TypeError) {
        setMutationError(
          "The command outcome could not be confirmed. Check the connection, then retry without changing the form.",
        );
        return "uncertain";
      }
      setMutationError(
        apiMessage(reason, "The availability change could not be completed."),
      );
      return "definitive-error";
    } finally {
      setSubmitting(false);
    }
  };

  const askTemplateStatus = (template: SchedulingAvailabilityTemplate) => {
    const nextStatus = template.status === "active" ? "inactive" : "active";
    setConfirmation({
      title: `${nextStatus === "active" ? "Publish" : "Deactivate"} weekly schedule`,
      description:
        nextStatus === "active"
          ? `Publish ${template.practitionerDisplayName}'s ${WEEKDAYS[template.isoWeekday - 1]} schedule and reconcile the server-owned eight-week horizon.`
          : "Future unbooked capacity from this definition may be withdrawn. Live referenced slots are preserved and reported for staff resolution.",
      confirmLabel:
        nextStatus === "active" ? "Publish schedule" : "Deactivate schedule",
      destructive: nextStatus === "inactive",
      idempotencyKey: newCommandKey(),
      execute: (idempotencyKey) =>
        runMutation(
          () =>
            changeSchedulingAvailabilityTemplateStatus(
              csrfToken,
              template,
              activeOrganizationId,
              nextStatus,
              idempotencyKey,
            ),
          `Weekly schedule ${nextStatus === "active" ? "published" : "deactivated"}`,
          "The server reconciled the bounded publication horizon.",
        ),
    });
  };

  const askRegenerate = (template: SchedulingAvailabilityTemplate) => {
    setConfirmation({
      title: `Regenerate slots for ${template.practitionerDisplayName}`,
      description:
        "Rebuild the next eight weeks from all active schedules for this practitioner in the selected facility. Obsolete unbooked slots may be withdrawn and live slots remain preserved.",
      confirmLabel: "Regenerate slots",
      idempotencyKey: newCommandKey(),
      execute: (idempotencyKey) =>
        runMutation(
          () =>
            materializeSchedulingAvailabilityTemplate(
              csrfToken,
              template,
              activeOrganizationId,
              idempotencyKey,
            ),
          "Published slots regenerated",
          "The deterministic slot horizon now reflects the current schedule and exceptions.",
        ),
    });
  };

  const askCancelException = (exception: SchedulingAvailabilityException) => {
    setConfirmation({
      title: "Cancel availability exception",
      description:
        "Cancellation is terminal. Capacity is restored only where no other active exception or preserved live overlap blocks it.",
      confirmLabel: "Cancel exception",
      idempotencyKey: newCommandKey(),
      execute: (idempotencyKey) =>
        runMutation(
          () =>
            cancelSchedulingAvailabilityException(
              csrfToken,
              exception,
              activeOrganizationId,
              idempotencyKey,
            ),
          "Availability exception cancelled",
          "The server reconciled capacity against all remaining active exceptions.",
        ),
    });
  };

  const askBlockSlot = (slot: SchedulingAvailabilitySlot) => {
    if (!activeFacility) return;

    const practitioner = practitioners.find(
      (candidate) => candidate.practitionerId === slot.practitionerId,
    );
    const service = services.find(
      (candidate) =>
        candidate.appointmentServiceId === slot.appointmentServiceId,
    );

    let localStartsAt: string;
    let localEndsAt: string;
    try {
      localStartsAt = canonicalLocalDateTimeFromInstant(
        slot.startsAt,
        activeFacility.timezone,
      );
      localEndsAt = canonicalLocalDateTimeFromInstant(
        slot.endsAt,
        activeFacility.timezone,
      );
    } catch (reason) {
      setMutationError(
        apiMessage(
          reason,
          "The slot time could not be converted to the facility timezone.",
        ),
      );
      return;
    }

    setConfirmation({
      title: `Block this time for ${practitioner?.displayName ?? "this practitioner"}`,
      description: `${formatSlotRange(slot.startsAt, slot.endsAt, activeFacility.timezone)} will become a practitioner-unavailability exception. It may also block overlapping services for this practitioner. Slot and live request evidence will be retained.`,
      confirmLabel: "Block this time",
      destructive: true,
      idempotencyKey: newCommandKey(),
      execute: (idempotencyKey) =>
        runMutation(
          () =>
            createSchedulingAvailabilityException(
              csrfToken,
              {
                organizationId: activeOrganizationId,
                facilityId: activeFacility.facilityId,
                practitionerFacilityAssignmentId:
                  slot.practitionerFacilityAssignmentId,
                kind: "practitioner_unavailable",
                isAllDay: false,
                localStartsAt,
                localEndsAt,
              },
              idempotencyKey,
            ),
          "Time blocked",
          `${service?.patientFacingName ?? "The scheduled service"} is now covered by an active practitioner-unavailability exception. Scheduling evidence was retained.`,
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
              Availability
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
              Manage facility-local weekly hours, closures, practitioner time
              away, and the server-owned eight-week publication horizon.
            </p>
          </div>
          {view === "weekly" && activeFacility && (
            <Button
              onClick={() => setCreateTemplateOpen(true)}
              disabled={eligibilityOptions.length === 0}
            >
              <PlusIcon />
              Add weekly schedule
            </Button>
          )}
          {view === "exceptions" && activeFacility && (
            <Button onClick={() => setCreateExceptionOpen(true)}>
              <PlusIcon />
              Add exception
            </Button>
          )}
          {view === "slots" && activeFacility && (
            <Button variant="outline" onClick={retry}>
              <ArrowClockwiseIcon />
              Refresh slots
            </Button>
          )}
        </div>
      </section>

      {result && (
        <ReconciliationPanel
          result={result}
          onDismiss={() => setResult(null)}
        />
      )}

      {conflict &&
        !createTemplateOpen &&
        !editTemplate &&
        !createExceptionOpen &&
        !durationService && (
          <div
            className="mt-6 flex items-start gap-3 rounded-xl border border-warning/35 bg-warning/10 p-4 text-sm"
            role="alert"
          >
            <WarningCircleIcon className="mt-0.5 size-5 shrink-0 text-warning-foreground" />
            <div className="flex-1">
              <p className="font-medium">Review the latest availability</p>
              <p className="mt-1 text-muted-foreground">{conflict}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConflict(null)}
            >
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
            <p className="font-medium">Change not confirmed</p>
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

      <section
        className="mt-7 overflow-hidden rounded-xl border bg-card shadow-[0_10px_28px_rgba(30,73,79,0.06)]"
        aria-label="Workforce availability"
      >
        <div className="border-b bg-muted/20 p-4 sm:p-5">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="grid content-start gap-2">
              <Label htmlFor="availability-practice">Practice</Label>
              <Select
                value={activeOrganizationId}
                onValueChange={selectPractice}
                disabled={baseLoading || contexts.length === 0}
              >
                <SelectTrigger id="availability-practice">
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
              <Label htmlFor="availability-facility">Facility</Label>
              <Select
                value={activeFacilityId}
                onValueChange={selectFacility}
                disabled={
                  baseLoading || (activeContext?.facilities.length ?? 0) === 0
                }
              >
                <SelectTrigger id="availability-facility">
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
              {activeFacility && (
                <p className="flex min-h-5 items-center gap-1 text-xs text-muted-foreground">
                  <ClockIcon className="size-4" />
                  Local schedule timezone: {activeFacility.timezone}
                </p>
              )}
              {!activeFacility && <span className="min-h-5" aria-hidden />}
            </div>
          </div>
        </div>

        <div
          className="border-b px-3 pt-3 sm:px-5"
          role="tablist"
          aria-label="Availability view"
        >
          <div className="flex gap-1 overflow-x-auto">
            {availabilityViews.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                role="tab"
                aria-selected={view === candidate.id}
                tabIndex={view === candidate.id ? 0 : -1}
                aria-controls={`availability-panel-${candidate.id}`}
                id={`availability-tab-${candidate.id}`}
                className={`min-h-11 shrink-0 rounded-t-md border-b-2 px-3 text-start text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:px-4 ${
                  view === candidate.id
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setView(candidate.id)}
                onKeyDown={(event) => {
                  const currentIndex = availabilityViews.findIndex(
                    (item) => item.id === candidate.id,
                  );
                  const nextIndex =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? availabilityViews.length - 1
                        : event.key === "ArrowRight"
                          ? (currentIndex + 1) % availabilityViews.length
                          : event.key === "ArrowLeft"
                            ? (currentIndex - 1 + availabilityViews.length) %
                              availabilityViews.length
                            : -1;
                  if (nextIndex < 0) return;
                  event.preventDefault();
                  const nextView = availabilityViews[nextIndex];
                  setView(nextView.id);
                  document
                    .getElementById(`availability-tab-${nextView.id}`)
                    ?.focus();
                }}
              >
                <span className="block">{candidate.label}</span>
                <span className="hidden text-xs font-normal text-muted-foreground sm:block">
                  {candidate.description}
                </span>
              </button>
            ))}
          </div>
        </div>

        <AvailabilityGuidance view={view} />

        <div
          id={`availability-panel-${view}`}
          role="tabpanel"
          aria-labelledby={`availability-tab-${view}`}
          tabIndex={0}
          className="outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {baseLoading || availabilityLoading ? (
            <AvailabilitySkeleton />
          ) : denied ? (
            <StatePanel
              icon={<ShieldCheckIcon className="size-6" />}
              title="Availability access unavailable"
              description="Current scheduling authorization does not permit this practice or facility. No previous facility data is displayed."
              action={<Button onClick={retry}>Try again</Button>}
            />
          ) : error ? (
            <StatePanel
              icon={<WarningCircleIcon className="size-6" />}
              title="Availability could not be loaded"
              description={error}
              action={
                <Button variant="outline" onClick={retry}>
                  <ArrowClockwiseIcon />
                  Try again
                </Button>
              }
            />
          ) : contexts.length === 0 ? (
            <StatePanel
              icon={<BuildingsIcon className="size-6" />}
              title="No scheduling practices"
              description="No exact-practice scheduling context is currently available."
            />
          ) : !activeFacility ? (
            <StatePanel
              icon={<BuildingsIcon className="size-6" />}
              title="No authorized facilities"
              description="Availability requires an exact facility in the current scheduling scope."
            />
          ) : view === "weekly" ? (
            <WeeklyPanel
              templates={templates}
              total={totals.templates}
              page={templatePage}
              services={selectedServices}
              practitioners={practitioners}
              timezone={activeFacility.timezone}
              serviceFilter={templateServiceFilter}
              statusFilter={templateStatusFilter}
              onPageChange={setTemplatePage}
              onServiceFilterChange={(serviceId) => {
                setTemplatePage(1);
                setTemplateServiceFilter(serviceId);
              }}
              onStatusFilterChange={(status) => {
                setTemplatePage(1);
                setTemplateStatusFilter(status);
              }}
              onEdit={setEditTemplate}
              onChangeStatus={askTemplateStatus}
              onRegenerate={askRegenerate}
              onChangeDuration={setDurationService}
            />
          ) : view === "exceptions" ? (
            <ExceptionsPanel
              exceptions={exceptions}
              total={totals.exceptions}
              page={exceptionPage}
              currentTimezone={activeFacility.timezone}
              onPageChange={setExceptionPage}
              onCancel={askCancelException}
            />
          ) : (
            <SlotsPanel
              slots={slots}
              total={totals.slots}
              page={slotPage}
              rangeDays={slotRangeDays}
              status={slotStatus}
              services={services}
              practitioners={practitioners}
              currentTimezone={activeFacility.timezone}
              onPageChange={setSlotPage}
              onRangeDaysChange={(days) => {
                setSlotPage(1);
                setSlotRangeDays(days);
              }}
              onStatusChange={(status) => {
                setSlotPage(1);
                setSlotStatus(status);
              }}
              onBlockTime={askBlockSlot}
            />
          )}
        </div>
      </section>

      {createTemplateOpen && (
        <TemplateDialog
          open
          onOpenChange={setCreateTemplateOpen}
          timezone={activeFacility?.timezone ?? "UTC"}
          effectiveFrom={
            activeFacility
              ? localDateInTimezone(new Date(), activeFacility.timezone)
              : ""
          }
          eligibilityOptions={eligibilityOptions}
          conflictMessage={conflict}
          submitting={submitting}
          onSubmit={(input, idempotencyKey) =>
            runMutation(
              () =>
                createSchedulingAvailabilityTemplate(
                  csrfToken,
                  { organizationId: activeOrganizationId, ...input },
                  idempotencyKey,
                ),
              "Inactive weekly schedule created",
              "Review the definition, then publish it explicitly to generate future slots.",
            )
          }
        />
      )}

      {editTemplate && (
        <TemplateDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditTemplate(null);
          }}
          timezone={activeFacility?.timezone ?? editTemplate.sourceTimezone}
          effectiveFrom={editTemplate.effectiveFrom}
          eligibilityOptions={eligibilityOptions}
          conflictMessage={conflict}
          template={editTemplate}
          submitting={submitting}
          onSubmit={(input, idempotencyKey) =>
            runMutation(
              () =>
                replaceSchedulingAvailabilityTemplate(
                  csrfToken,
                  editTemplate,
                  {
                    organizationId: activeOrganizationId,
                    ...input,
                    status: editTemplate.status,
                  },
                  idempotencyKey,
                ),
              "Weekly schedule replaced",
              editTemplate.status === "active"
                ? "The active replacement and bounded future capacity were reconciled atomically."
                : "The immutable definition was replaced and remains inactive.",
            )
          }
        />
      )}

      {createExceptionOpen && (
        <ExceptionDialog
          open
          onOpenChange={setCreateExceptionOpen}
          timezone={activeFacility?.timezone ?? "UTC"}
          localToday={
            activeFacility
              ? localDateInTimezone(new Date(), activeFacility.timezone)
              : ""
          }
          practitionerOptions={facilityPractitioners}
          conflictMessage={conflict}
          submitting={submitting}
          onSubmit={(input, idempotencyKey) =>
            runMutation(
              () =>
                createSchedulingAvailabilityException(
                  csrfToken,
                  {
                    organizationId: activeOrganizationId,
                    facilityId: activeFacilityId,
                    ...input,
                  },
                  idempotencyKey,
                ),
              "Availability exception applied",
              "The exception is active and the bounded future capacity was reconciled immediately.",
            )
          }
        />
      )}

      {durationService && (
        <DurationDialog
          open
          onOpenChange={(open) => {
            if (!open) setDurationService(null);
          }}
          service={durationService}
          conflictMessage={conflict}
          submitting={submitting}
          onSubmit={(durationMinutes, idempotencyKey) =>
            runMutation(
              () =>
                changeSchedulingServiceDuration(
                  csrfToken,
                  durationService,
                  activeOrganizationId,
                  durationMinutes,
                  idempotencyKey,
                ),
              "Service duration changed",
              "Future unbooked capacity was regenerated while referenced slot evidence remained unchanged.",
            )
          }
        />
      )}

      <ConfirmationDialog
        action={confirmation}
        submitting={submitting}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
        onConfirm={async () => {
          if (!confirmation) return;
          const attempt = await confirmation.execute(
            confirmation.idempotencyKey,
          );
          if (attempt === "success" || attempt === "definitive-error") {
            setConfirmation(null);
          }
        }}
      />
    </main>
  );
}

function InfoTip({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-grid size-5 shrink-0 place-items-center rounded-full text-primary/75 outline-none hover:bg-info/15 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Help: ${label}`}
        >
          <InfoIcon className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  );
}

function AvailabilityGuidance({ view }: { view: AvailabilityView }) {
  const guidance: Record<AvailabilityView, string> = {
    weekly:
      "Weekly hours use the selected facility's local timezone. New definitions remain inactive until published. Overnight hours require two templates.",
    exceptions:
      "Closures and practitioner time away apply immediately. They subtract capacity and preserve live appointment evidence for staff resolution.",
    slots:
      "This rolling view retains durable slot evidence. Use Block this time to create an audited practitioner exception. Rows are withdrawn rather than deleted.",
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

function AvailabilitySkeleton() {
  return (
    <div className="space-y-4 p-5" role="status">
      <span className="sr-only">Loading availability</span>
      {[0, 1, 2].map((value) => (
        <div
          key={value}
          className="grid gap-3 rounded-lg border p-4 sm:grid-cols-4"
        >
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-9 w-32 sm:justify-self-end" />
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
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-72 place-items-center p-6 text-center">
      <div className="grid max-w-lg gap-4 justify-items-center">
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

function ReconciliationPanel({
  result,
  onDismiss,
}: {
  result: ReconciliationResult;
  onDismiss: () => void;
}) {
  const summary = result.summary;
  const warning =
    summary.preservedLiveSlotCount > 0 || summary.skippedOverlapCount > 0;
  return (
    <section
      className={`mt-6 rounded-xl border p-4 ${
        warning
          ? "border-warning/35 bg-warning/10"
          : "border-success/30 bg-success/10"
      }`}
      aria-labelledby="availability-result-title"
    >
      <p className="sr-only" role="status">
        {result.title}. {summary.createdSlotCount} slots created,{" "}
        {summary.reactivatedSlotCount} reactivated, {summary.withdrawnSlotCount}{" "}
        withdrawn, and {summary.affectedAppointmentCount} live requests
        affected.
      </p>
      <div className="flex items-start gap-3">
        {warning ? (
          <WarningCircleIcon className="mt-0.5 size-5 shrink-0 text-warning-foreground" />
        ) : (
          <CheckCircleIcon className="mt-0.5 size-5 shrink-0 text-success" />
        )}
        <div className="min-w-0 flex-1">
          <h2 id="availability-result-title" className="font-semibold">
            {result.title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {result.description}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Horizon {summary.horizonStartsOn} to before{" "}
            {summary.horizonEndsBefore}
            {" · "}
            {summary.sourceTimezone}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      <dl className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Created", summary.createdSlotCount],
          ["Reactivated", summary.reactivatedSlotCount],
          ["Withdrawn", summary.withdrawnSlotCount],
          ["Live preserved", summary.preservedLiveSlotCount],
          ["Overlaps skipped", summary.skippedOverlapCount],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border bg-card/70 px-3 py-2">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {summary.affectedAppointmentCount > 0 && (
        <details className="mt-4 rounded-lg border bg-card/70 p-3">
          <summary className="cursor-pointer text-sm font-medium">
            {summary.affectedAppointmentCount} live request
            {summary.affectedAppointmentCount === 1 ? "" : "s"} need review
          </summary>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Only opaque request identifiers are shown here. Patient details and
            resolution belong in the dual-permission appointment queue.
          </p>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {summary.affectedAppointmentIds.map((appointmentId) => (
              <li
                key={appointmentId}
                className="break-all rounded-md bg-muted px-2 py-1 font-mono text-xs"
              >
                {appointmentId}
              </li>
            ))}
          </ul>
          {summary.affectedAppointmentIdsTruncated && (
            <p className="mt-2 text-xs font-medium text-warning-foreground">
              More affected requests exist. Use the appointment queue for the
              complete paginated workflow.
            </p>
          )}
        </details>
      )}
    </section>
  );
}

function WeeklyPanel({
  templates,
  total,
  page,
  services,
  practitioners,
  timezone,
  serviceFilter,
  statusFilter,
  onPageChange,
  onServiceFilterChange,
  onStatusFilterChange,
  onEdit,
  onChangeStatus,
  onRegenerate,
  onChangeDuration,
}: {
  templates: SchedulingAvailabilityTemplate[];
  total: number;
  page: number;
  services: SchedulingService[];
  practitioners: SchedulingPractitioner[];
  timezone: string;
  serviceFilter: string;
  statusFilter: "all" | "active" | "inactive";
  onPageChange: (page: number) => void;
  onServiceFilterChange: (serviceId: string) => void;
  onStatusFilterChange: (status: "all" | "active" | "inactive") => void;
  onEdit: (template: SchedulingAvailabilityTemplate) => void;
  onChangeStatus: (template: SchedulingAvailabilityTemplate) => void;
  onRegenerate: (template: SchedulingAvailabilityTemplate) => void;
  onChangeDuration: (service: SchedulingService) => void;
}) {
  const [collapsedPractitioners, setCollapsedPractitioners] = useState<
    Set<string>
  >(() => new Set());
  const practitionerGroups = Array.from(
    templates
      .reduce((groups, template) => {
        const group = groups.get(template.practitionerId) ?? [];
        group.push(template);
        groups.set(template.practitionerId, group);
        return groups;
      }, new Map<string, SchedulingAvailabilityTemplate[]>())
      .values(),
  );
  const activeServices = services.filter(
    (service) => service.status === "active",
  );
  const inactiveServices = services.filter(
    (service) => service.status === "inactive",
  );
  const filtersActive = serviceFilter !== "all" || statusFilter !== "all";
  const clearFilters = () => {
    onServiceFilterChange("all");
    onStatusFilterChange("all");
  };

  return (
    <>
      <section
        className="border-b p-5"
        aria-labelledby="service-duration-title"
      >
        <div>
          <div className="flex items-center gap-1.5">
            <h2 id="service-duration-title" className="font-semibold">
              Service duration
            </h2>
            <InfoTip label="Referenced slots retain their original time and provider evidence when a service duration changes." />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Duration divides each weekly window into concrete slots. Changes
            regenerate future unbooked capacity.
          </p>
        </div>
        {services.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No services are configured at this facility.
          </p>
        ) : (
          <>
            {activeServices.length === 0 ? (
              <p className="mt-4 rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
                No active services are publishing capacity at this facility.
                Inactive service settings are retained below.
              </p>
            ) : (
              <ServiceDurationRows
                className="mt-4"
                services={activeServices}
                onChangeDuration={onChangeDuration}
              />
            )}
            {inactiveServices.length > 0 && (
              <details className="group/disclosure mt-3 rounded-lg border bg-muted/15">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                  <CaretRightIcon className="size-4 shrink-0 transition-transform group-open/disclosure:rotate-90" />
                  <span>
                    Inactive service settings ({inactiveServices.length})
                  </span>
                </summary>
                <p className="border-t px-4 py-3 text-xs leading-5 text-muted-foreground">
                  These durations are retained configuration. They do not create
                  bookable capacity while the service is inactive.
                </p>
                <ServiceDurationRows
                  className="rounded-none border-x-0 border-b-0"
                  services={inactiveServices}
                  onChangeDuration={onChangeDuration}
                />
              </details>
            )}
          </>
        )}
      </section>

      <section
        className="border-b bg-muted/10 p-5"
        aria-labelledby="weekly-filters-title"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 id="weekly-filters-title" className="font-semibold">
              Weekly schedule filters
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Narrow the server-backed list by service or lifecycle status.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[36rem]">
            <div className="grid gap-1.5">
              <Label htmlFor="weekly-service-filter">Service</Label>
              <Select
                value={serviceFilter}
                onValueChange={onServiceFilterChange}
              >
                <SelectTrigger id="weekly-service-filter">
                  <SelectValue placeholder="All services" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All services</SelectItem>
                  {services.map((service) => (
                    <SelectItem
                      key={service.appointmentServiceId}
                      value={service.appointmentServiceId}
                    >
                      {service.patientFacingName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="weekly-status-filter">Status</Label>
              <Select
                value={statusFilter}
                onValueChange={(value) =>
                  onStatusFilterChange(value as "all" | "active" | "inactive")
                }
              >
                <SelectTrigger id="weekly-status-filter">
                  <SelectValue placeholder="All definitions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All definitions</SelectItem>
                  <SelectItem value="active">Active definitions</SelectItem>
                  <SelectItem value="inactive">Inactive history</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <div className="mt-3 flex min-h-9 flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {total} matching weekly schedule{total === 1 ? "" : "s"}
          </p>
          {filtersActive && (
            <Button size="sm" variant="ghost" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </div>
      </section>

      {templates.length === 0 ? (
        <StatePanel
          icon={<CalendarCheckIcon className="size-6" />}
          title={
            filtersActive
              ? "No matching weekly schedules"
              : "No weekly schedules"
          }
          description={
            filtersActive
              ? "Change or clear the filters to review other retained definitions."
              : "Add an inactive weekly definition, review its local time and effective dates, then publish it explicitly."
          }
          action={
            filtersActive ? (
              <Button variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="divide-y">
          {practitionerGroups.map((group) => {
            const activeTemplates = group.filter(
              (template) => template.status === "active",
            );
            const inactiveTemplates = group.filter(
              (template) => template.status === "inactive",
            );
            const readiness = new Map(
              group.map((template) => [
                template.availabilityTemplateId,
                weeklyScheduleReadiness(template, services, practitioners),
              ]),
            );
            const regeneratableTemplate = activeTemplates.find(
              (template) =>
                readiness.get(template.availabilityTemplateId)?.ready,
            );
            const blockedReasons = Array.from(
              new Set(
                activeTemplates
                  .map(
                    (template) =>
                      readiness.get(template.availabilityTemplateId)?.reason,
                  )
                  .filter((reason): reason is string => Boolean(reason)),
              ),
            );
            const practitionerName = group[0].practitionerDisplayName;
            const practitionerId = group[0].practitionerId;
            const groupPanelId = `weekly-practitioner-${practitionerId}`;
            const collapsed = collapsedPractitioners.has(practitionerId);

            return (
              <section
                key={practitionerId}
                className="border-s-4 border-s-transparent p-5 transition-colors hover:border-s-primary/40 hover:bg-primary/[0.025]"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <button
                    type="button"
                    className="group flex min-h-10 items-start gap-2 rounded-md text-start outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-expanded={!collapsed}
                    aria-controls={groupPanelId}
                    onClick={() =>
                      setCollapsedPractitioners((current) => {
                        const next = new Set(current);
                        if (next.has(practitionerId))
                          next.delete(practitionerId);
                        else next.add(practitionerId);
                        return next;
                      })
                    }
                  >
                    <CaretRightIcon
                      className={`mt-0.5 size-5 shrink-0 transition-transform ${
                        collapsed ? "" : "rotate-90"
                      }`}
                      aria-hidden="true"
                    />
                    <span>
                      <span className="block font-semibold group-hover:text-primary">
                        {practitionerName}
                      </span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {activeTemplates.length} current schedule
                        {activeTemplates.length === 1 ? "" : "s"}
                        {inactiveTemplates.length > 0
                          ? `, ${inactiveTemplates.length} retained inactive`
                          : ""}
                      </span>
                    </span>
                  </button>
                  {activeTemplates.length > 0 && (
                    <div className="flex items-center gap-1 lg:justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-primary/35 bg-primary/5 text-primary hover:bg-primary/10 hover:text-primary"
                        disabled={!regeneratableTemplate}
                        aria-label={`Regenerate published slots for ${practitionerName}`}
                        onClick={() =>
                          regeneratableTemplate &&
                          onRegenerate(regeneratableTemplate)
                        }
                      >
                        <ArrowClockwiseIcon />
                        Regenerate slots
                      </Button>
                    </div>
                  )}
                </div>

                <div id={groupPanelId} hidden={collapsed}>
                  {blockedReasons.length > 0 && (
                    <div className="mt-4 flex items-start gap-2 rounded-lg border border-warning/35 bg-warning/10 p-3 text-sm">
                      <WarningCircleIcon className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
                      <div>
                        <p className="font-medium text-warning-foreground">
                          Some current schedules are blocked
                        </p>
                        <p className="mt-1 text-muted-foreground">
                          {blockedReasons.join(" ")} No new slots can be
                          published until the catalogue prerequisites are active
                          again.
                        </p>
                      </div>
                    </div>
                  )}

                  {activeTemplates.length === 0 ? (
                    <p className="mt-4 rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
                      No current weekly schedules. Inactive definitions are
                      retained below for history and possible reuse.
                    </p>
                  ) : (
                    <div className="mt-4 overflow-hidden rounded-lg border">
                      <div className="hidden grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_7rem_17rem] gap-4 border-b bg-muted/35 px-4 py-2 text-xs font-semibold text-muted-foreground lg:grid">
                        <span>Service</span>
                        <span>Weekly time</span>
                        <span>Status</span>
                        <span className="text-end">Actions</span>
                      </div>
                      {activeTemplates.map((template) => (
                        <WeeklyScheduleRow
                          key={template.availabilityTemplateId}
                          template={template}
                          readiness={readiness.get(
                            template.availabilityTemplateId,
                          )}
                          timezone={timezone}
                          onEdit={onEdit}
                          onChangeStatus={onChangeStatus}
                        />
                      ))}
                    </div>
                  )}

                  {inactiveTemplates.length > 0 && (
                    <details
                      key={`${practitionerId}-${statusFilter}`}
                      className="group/disclosure mt-4 rounded-lg border bg-muted/15"
                      open={statusFilter === "inactive" ? true : undefined}
                    >
                      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                        <CaretRightIcon className="size-4 shrink-0 transition-transform group-open/disclosure:rotate-90" />
                        <span>
                          Retained inactive schedules (
                          {inactiveTemplates.length})
                        </span>
                      </summary>
                      <p className="border-t px-4 py-3 text-xs leading-5 text-muted-foreground">
                        These definitions do not publish capacity. They remain
                        visible as scheduling history and can be published only
                        after their catalogue prerequisites are active.
                      </p>
                      <div className="border-t">
                        <div className="hidden grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_7rem_17rem] gap-4 border-b bg-muted/35 px-4 py-2 text-xs font-semibold text-muted-foreground lg:grid">
                          <span>Service</span>
                          <span>Weekly time</span>
                          <span>Status</span>
                          <span className="text-end">Actions</span>
                        </div>
                        {inactiveTemplates.map((template) => (
                          <WeeklyScheduleRow
                            key={template.availabilityTemplateId}
                            template={template}
                            readiness={readiness.get(
                              template.availabilityTemplateId,
                            )}
                            timezone={timezone}
                            onEdit={onEdit}
                            onChangeStatus={onChangeStatus}
                          />
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
      <Pagination
        page={page}
        pageSize={50}
        total={total}
        label="weekly schedules"
        onPageChange={onPageChange}
      />
    </>
  );
}

function ServiceDurationRows({
  services,
  onChangeDuration,
  className = "",
}: {
  services: SchedulingService[];
  onChangeDuration: (service: SchedulingService) => void;
  className?: string;
}) {
  return (
    <div className={`overflow-hidden rounded-lg border ${className}`}>
      <div className="hidden grid-cols-[minmax(0,1fr)_8rem_12rem] gap-4 border-b bg-muted/35 px-4 py-2 text-xs font-semibold text-muted-foreground sm:grid">
        <span>Service</span>
        <span>Duration</span>
        <span className="text-end">Action</span>
      </div>
      <ul className="divide-y">
        {services.map((service) => (
          <li
            key={service.appointmentServiceId}
            className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_8rem_12rem] sm:items-center"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {service.patientFacingName}
              </p>
              <p className="text-xs text-muted-foreground">
                {service.specialtyName} · {service.status}
              </p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground sm:hidden">
                Duration
              </span>
              <p className="text-sm tabular-nums">
                {service.durationMinutes} minutes
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-fit border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 hover:text-primary sm:w-full"
              aria-label={`Change duration for ${service.patientFacingName}`}
              onClick={() => onChangeDuration(service)}
            >
              <ClockIcon />
              Change duration
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function weeklyScheduleReadiness(
  template: SchedulingAvailabilityTemplate,
  services: SchedulingService[],
  practitioners: SchedulingPractitioner[],
): { ready: boolean; reason?: string } {
  const service = services.find(
    (candidate) =>
      candidate.appointmentServiceId === template.appointmentServiceId,
  );
  if (!service || service.status !== "active") {
    return { ready: false, reason: "The service is inactive." };
  }

  const practitioner = practitioners.find(
    (candidate) => candidate.practitionerId === template.practitionerId,
  );
  if (!practitioner || practitioner.status !== "active") {
    return { ready: false, reason: "The practitioner is inactive." };
  }

  const facilityAssignment = practitioner.facilityAssignments.find(
    (assignment) =>
      assignment.assignmentId === template.practitionerFacilityAssignmentId,
  );
  if (!facilityAssignment || facilityAssignment.status !== "active") {
    return { ready: false, reason: "The facility affiliation is inactive." };
  }

  const serviceAssignment = practitioner.serviceAssignments.find(
    (assignment) =>
      assignment.assignmentId === template.practitionerServiceAssignmentId,
  );
  if (!serviceAssignment || serviceAssignment.status !== "active") {
    return { ready: false, reason: "The service eligibility is inactive." };
  }

  if (!service.publishable) {
    return { ready: false, reason: "A service prerequisite is inactive." };
  }

  return { ready: true };
}

function WeeklyScheduleRow({
  template,
  readiness,
  timezone,
  onEdit,
  onChangeStatus,
}: {
  template: SchedulingAvailabilityTemplate;
  readiness?: { ready: boolean; reason?: string };
  timezone: string;
  onEdit: (template: SchedulingAvailabilityTemplate) => void;
  onChangeStatus: (template: SchedulingAvailabilityTemplate) => void;
}) {
  const timezoneChanged = template.sourceTimezone !== timezone;
  const blocked = readiness?.ready === false;
  const definitionLabel = `${template.practitionerDisplayName}'s ${WEEKDAYS[template.isoWeekday - 1]} ${template.serviceName} schedule`;

  return (
    <article className="border-b px-4 py-4 transition-colors last:border-b-0 hover:bg-muted/15">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_7rem_17rem] lg:items-center">
        <div className="min-w-0">
          <span className="text-xs font-medium text-muted-foreground lg:hidden">
            Service
          </span>
          <p className="text-sm font-medium">{template.serviceName}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {template.durationMinutes} minutes
          </p>
        </div>
        <div>
          <span className="text-xs font-medium text-muted-foreground lg:hidden">
            Weekly time
          </span>
          <p className="text-sm font-medium">
            {WEEKDAYS[template.isoWeekday - 1]},{" "}
            {minuteToTime(template.localStartMinute)} to{" "}
            {template.localEndMinute === 1440
              ? "midnight next day"
              : minuteToTime(template.localEndMinute)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Effective {template.effectiveFrom} through{" "}
            {template.effectiveUntil ?? "no configured end"} ·{" "}
            {template.sourceTimezone}
          </p>
          {timezoneChanged && (
            <p className="mt-1 text-xs font-medium text-warning-foreground">
              Historical timezone differs from the facility's current timezone.
            </p>
          )}
        </div>
        <div>
          <span className="text-xs font-medium text-muted-foreground lg:hidden">
            Status
          </span>
          <div className="mt-1 flex flex-wrap gap-2 lg:mt-0">
            {templateStatusBadge(template.status)}
            {template.status === "active" && blocked && (
              <Badge variant="warning">Blocked</Badge>
            )}
          </div>
          {blocked && readiness?.reason && (
            <p className="mt-1 text-xs text-warning-foreground">
              {readiness.reason}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Button
            size="sm"
            variant="outline"
            disabled={blocked}
            aria-label={`Replace ${definitionLabel}`}
            onClick={() => onEdit(template)}
          >
            <PencilSimpleIcon />
            Replace
          </Button>
          <Button
            size="sm"
            aria-label={`${template.status === "active" ? "Deactivate" : "Publish"} ${definitionLabel}`}
            variant={template.status === "active" ? "outline" : "default"}
            className={
              template.status === "active"
                ? "border-destructive/45 text-destructive hover:bg-destructive/10 hover:text-destructive"
                : undefined
            }
            disabled={template.status === "inactive" && blocked}
            onClick={() => onChangeStatus(template)}
          >
            {template.status === "active" ? <PauseIcon /> : <PlayIcon />}
            {template.status === "active" ? "Deactivate" : "Publish"}
          </Button>
        </div>
      </div>
    </article>
  );
}

function ExceptionsPanel({
  exceptions,
  total,
  page,
  currentTimezone,
  onPageChange,
  onCancel,
}: {
  exceptions: SchedulingAvailabilityException[];
  total: number;
  page: number;
  currentTimezone: string;
  onPageChange: (page: number) => void;
  onCancel: (exception: SchedulingAvailabilityException) => void;
}) {
  if (exceptions.length === 0) {
    return (
      <StatePanel
        icon={<CalendarCheckIcon className="size-6" />}
        title="No availability exceptions"
        description="Add a facility closure or practitioner time-away period when normal weekly capacity should be removed."
      />
    );
  }
  return (
    <>
      <div>
        <div className="hidden grid-cols-[minmax(0,0.9fr)_minmax(0,1.15fr)_9rem_11rem] gap-4 border-b bg-muted/35 px-5 py-2 text-xs font-semibold text-muted-foreground lg:grid">
          <span>Exception</span>
          <span>Local interval</span>
          <span>Status</span>
          <span className="text-end">Action</span>
        </div>
        <div className="divide-y">
          {exceptions.map((exception) => {
            const timezoneChanged =
              exception.sourceTimezone !== currentTimezone;
            return (
              <article
                key={exception.availabilityExceptionId}
                className="p-5 transition-colors hover:bg-muted/15"
              >
                <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.15fr)_9rem_11rem] lg:items-center">
                  <div>
                    <span className="text-xs font-medium text-muted-foreground lg:hidden">
                      Exception
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold">
                        {exception.kind === "facility_closed"
                          ? "Facility closure"
                          : "Practitioner unavailable"}
                      </h2>
                      {exception.isAllDay && (
                        <Badge variant="info">All day</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {exception.practitionerDisplayName ??
                        exception.facilityName}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-muted-foreground lg:hidden">
                      Local interval
                    </span>
                    <p className="text-sm font-medium">
                      {formatLocalEvidence(exception.localStartsAt)} to{" "}
                      {formatLocalEvidence(exception.localEndsAt)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {exception.sourceTimezone}
                    </p>
                    {timezoneChanged && (
                      <p className="mt-1 text-xs font-medium text-warning-foreground">
                        Historical source timezone differs from the facility's
                        current timezone.
                      </p>
                    )}
                  </div>
                  <div>
                    <span className="text-xs font-medium text-muted-foreground lg:hidden">
                      Status
                    </span>
                    <div className="mt-1 lg:mt-0">
                      {exceptionStatusBadge(exception.status)}
                    </div>
                  </div>
                  {exception.status === "active" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-fit border-destructive/45 text-destructive hover:bg-destructive/10 hover:text-destructive lg:w-full"
                      aria-label={`Cancel ${exception.kind === "facility_closed" ? "facility closure" : `${exception.practitionerDisplayName ?? "practitioner"} unavailability`} from ${formatLocalEvidence(exception.localStartsAt)} to ${formatLocalEvidence(exception.localEndsAt)}`}
                      onClick={() => onCancel(exception)}
                    >
                      Cancel exception
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground lg:text-end">
                      No action available
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
      <Pagination
        page={page}
        pageSize={50}
        total={total}
        label="exceptions"
        onPageChange={onPageChange}
      />
    </>
  );
}

function SlotsPanel({
  slots,
  total,
  page,
  rangeDays,
  status,
  services,
  practitioners,
  currentTimezone,
  onPageChange,
  onRangeDaysChange,
  onStatusChange,
  onBlockTime,
}: {
  slots: SchedulingAvailabilitySlot[];
  total: number;
  page: number;
  rangeDays: 7 | 14 | 28;
  status: "all" | "available" | "withdrawn";
  services: SchedulingService[];
  practitioners: SchedulingPractitioner[];
  currentTimezone: string;
  onPageChange: (page: number) => void;
  onRangeDaysChange: (days: 7 | 14 | 28) => void;
  onStatusChange: (status: "all" | "available" | "withdrawn") => void;
  onBlockTime: (slot: SchedulingAvailabilitySlot) => void;
}) {
  return (
    <>
      <div className="grid gap-4 border-b bg-muted/20 p-4 sm:grid-cols-2 sm:p-5">
        <div className="grid gap-2">
          <Label htmlFor="slot-range">Rolling UTC range</Label>
          <Select
            value={String(rangeDays)}
            onValueChange={(value) =>
              onRangeDaysChange(Number(value) as 7 | 14 | 28)
            }
          >
            <SelectTrigger id="slot-range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Next 7 days</SelectItem>
              <SelectItem value="14">Next 14 days</SelectItem>
              <SelectItem value="28">Next 28 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="slot-status">Slot status</Label>
          <Select value={status} onValueChange={onStatusChange}>
            <SelectTrigger id="slot-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All states</SelectItem>
              <SelectItem value="available">Available rows</SelectItem>
              <SelectItem value="withdrawn">Withdrawn rows</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-start gap-3 border-b bg-info/10 px-4 py-3 text-sm sm:px-5">
        <InfoIcon className="mt-0.5 size-5 shrink-0 text-primary" />
        <p className="max-w-4xl leading-6 text-muted-foreground">
          Slots are never deleted. Removing capacity marks an unbooked row as
          Withdrawn. A row with a live request is retained as Deferred
          withdrawal until that request is resolved.
        </p>
      </div>
      {slots.length === 0 ? (
        <StatePanel
          icon={<ClockIcon className="size-6" />}
          title="No published slots in this range"
          description="Publish an active weekly schedule or change the rolling range. The server remains the authority for the full eight-week horizon."
        />
      ) : (
        <div>
          <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_9rem_12rem] gap-4 border-b bg-muted/35 px-5 py-2 text-xs font-semibold text-muted-foreground lg:grid">
            <span>Local time</span>
            <span>Practitioner and service</span>
            <span>Status</span>
            <span className="text-end">Action</span>
          </div>
          <div className="divide-y">
            {slots.map((slot) => {
              const service = services.find(
                (candidate) =>
                  candidate.appointmentServiceId === slot.appointmentServiceId,
              );
              const practitioner = practitioners.find(
                (candidate) => candidate.practitionerId === slot.practitionerId,
              );
              const state = slotState(slot);
              const timezoneChanged = slot.sourceTimezone !== currentTimezone;
              return (
                <article
                  key={slot.appointmentSlotId}
                  className="p-5 transition-colors hover:bg-muted/15"
                >
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_9rem_12rem] lg:items-center">
                    <div>
                      <span className="text-xs font-medium text-muted-foreground lg:hidden">
                        Local time
                      </span>
                      <p className="font-medium">
                        {formatSlotRange(
                          slot.startsAt,
                          slot.endsAt,
                          slot.sourceTimezone,
                        )}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {slot.sourceTimezone} · source date{" "}
                        {slot.sourceLocalDate}
                      </p>
                      {timezoneChanged && (
                        <p className="mt-1 text-xs font-medium text-warning-foreground">
                          Source timezone differs from the current facility
                          timezone.
                        </p>
                      )}
                    </div>
                    <div>
                      <span className="text-xs font-medium text-muted-foreground lg:hidden">
                        Practitioner and service
                      </span>
                      <p className="text-sm font-medium">
                        {practitioner?.displayName ?? "Scheduled practitioner"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {service?.patientFacingName ?? "Scheduled service"}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-muted-foreground lg:hidden">
                        Status
                      </span>
                      <Badge variant={state.variant} className="w-fit">
                        {state.label}
                      </Badge>
                    </div>
                    {slot.status === "available" && !slot.withdrawalPending ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-fit border-warning/50 bg-warning/5 text-foreground hover:bg-warning/15 lg:w-full"
                        aria-label={`Block ${practitioner?.displayName ?? "scheduled practitioner"}'s ${service?.patientFacingName ?? "scheduled service"} time ${formatSlotRange(slot.startsAt, slot.endsAt, slot.sourceTimezone)}`}
                        onClick={() => onBlockTime(slot)}
                      >
                        <CalendarXIcon />
                        Block this time
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground lg:text-end">
                        No action available
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
      <Pagination
        page={page}
        pageSize={100}
        total={total}
        label="published slots"
        onPageChange={onPageChange}
      />
    </>
  );
}

function Pagination({
  page,
  pageSize,
  total,
  label,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  label: string;
  onPageChange: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-col gap-3 border-t px-5 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <p>
        Page {page} of {pageCount} · {total} {label}
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          aria-label={`Previous page of ${label}`}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <Button
          size="sm"
          variant="outline"
          aria-label={`Next page of ${label}`}
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

function TemplateDialog({
  open,
  onOpenChange,
  timezone,
  effectiveFrom,
  eligibilityOptions,
  conflictMessage,
  template,
  submitting,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timezone: string;
  effectiveFrom: string;
  eligibilityOptions: EligibilityOption[];
  conflictMessage: string | null;
  template?: SchedulingAvailabilityTemplate;
  submitting: boolean;
  onSubmit: (
    input: {
      practitionerServiceAssignmentId: string;
      isoWeekday: number;
      localStartMinute: number;
      localEndMinute: number;
      effectiveFrom: string;
      effectiveUntil?: string;
    },
    idempotencyKey: string,
  ) => Promise<MutationAttempt>;
}) {
  const [assignmentId, setAssignmentId] = useState(
    template?.practitionerServiceAssignmentId ??
      eligibilityOptions[0]?.assignmentId ??
      "",
  );
  const [weekday, setWeekday] = useState(String(template?.isoWeekday ?? 1));
  const [startTime, setStartTime] = useState(
    minuteToTime(template?.localStartMinute ?? 540),
  );
  const [endTime, setEndTime] = useState(
    template?.localEndMinute === 1440
      ? "17:00"
      : minuteToTime(template?.localEndMinute ?? 1020),
  );
  const [endsAtMidnight, setEndsAtMidnight] = useState(
    template?.localEndMinute === 1440,
  );
  const [startsOn, setStartsOn] = useState(
    template?.effectiveFrom ?? effectiveFrom,
  );
  const [endsOn, setEndsOn] = useState(template?.effectiveUntil ?? "");
  const [validation, setValidation] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(newCommandKey);

  const payloadChanged = () => {
    setValidation(null);
    setIdempotencyKey(newCommandKey());
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const localStartMinute = timeToMinute(startTime);
    const localEndMinute = endsAtMidnight ? 1440 : timeToMinute(endTime);
    if (!assignmentId) {
      setValidation("Select one eligible practitioner and service.");
      return;
    }
    if (localEndMinute <= localStartMinute) {
      setValidation(
        "End time must be after start time. Split overnight hours into two weekly schedules.",
      );
      return;
    }
    if (!startsOn || (endsOn && endsOn < startsOn)) {
      setValidation(
        "Effective-through must be the same as or later than effective-from.",
      );
      return;
    }
    const attempt = await onSubmit(
      {
        practitionerServiceAssignmentId: assignmentId,
        isoWeekday: Number(weekday),
        localStartMinute,
        localEndMinute,
        effectiveFrom: startsOn,
        ...(endsOn ? { effectiveUntil: endsOn } : {}),
      },
      idempotencyKey,
    );
    if (attempt === "success") onOpenChange(false);
    if (attempt === "definitive-error") setIdempotencyKey(newCommandKey());
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && submitting) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-2xl" showCloseButton={!submitting}>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {template ? "Replace weekly schedule" : "Add weekly schedule"}
            </DialogTitle>
            <DialogDescription>
              Times are canonical local values in {timezone}. New schedules
              start inactive. Effective-through is inclusive.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2 sm:col-span-2">
              {template ? (
                <>
                  <p className="text-sm font-medium">
                    Practitioner and service
                  </p>
                  <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm">
                    <p className="font-medium">
                      {template.practitionerDisplayName}
                    </p>
                    <p className="text-muted-foreground">
                      {template.serviceName}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Immutable replacements retain the original eligibility.
                  </p>
                </>
              ) : (
                <>
                  <Label htmlFor="template-eligibility">
                    Practitioner and service
                  </Label>
                  <Select
                    value={assignmentId}
                    onValueChange={(value) => {
                      setAssignmentId(value);
                      payloadChanged();
                    }}
                  >
                    <SelectTrigger id="template-eligibility">
                      <SelectValue placeholder="Select eligibility" />
                    </SelectTrigger>
                    <SelectContent>
                      {eligibilityOptions.map((option) => (
                        <SelectItem
                          key={option.assignmentId}
                          value={option.assignmentId}
                        >
                          {option.practitionerName} · {option.serviceName}
                          {option.serviceStatus === "inactive"
                            ? " (service inactive)"
                            : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="template-weekday">Weekday</Label>
              <Select
                value={weekday}
                onValueChange={(value) => {
                  setWeekday(value);
                  payloadChanged();
                }}
              >
                <SelectTrigger id="template-weekday">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((day, index) => (
                    <SelectItem key={day} value={String(index + 1)}>
                      {day}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">{timezone}</p>
              <p className="mt-1">
                Overnight hours require one template before midnight and one
                after midnight.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="template-start-time">Start time</Label>
              <Input
                id="template-start-time"
                type="time"
                required
                value={startTime}
                onChange={(event) => {
                  setStartTime(event.target.value);
                  payloadChanged();
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="template-end-time">End time</Label>
              <Input
                id="template-end-time"
                type="time"
                required={!endsAtMidnight}
                disabled={endsAtMidnight}
                value={endTime}
                onChange={(event) => {
                  setEndTime(event.target.value);
                  payloadChanged();
                }}
              />
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  checked={endsAtMidnight}
                  onCheckedChange={(checked) => {
                    setEndsAtMidnight(checked === true);
                    payloadChanged();
                  }}
                />
                Ends at midnight next day (24:00)
              </label>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="template-effective-from">Effective from</Label>
              <Input
                id="template-effective-from"
                type="date"
                required
                value={startsOn}
                onChange={(event) => {
                  setStartsOn(event.target.value);
                  payloadChanged();
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="template-effective-until">
                Effective through (optional)
              </Label>
              <Input
                id="template-effective-until"
                type="date"
                value={endsOn}
                onChange={(event) => {
                  setEndsOn(event.target.value);
                  payloadChanged();
                }}
              />
            </div>
          </div>
          {template?.status === "active" && (
            <p className="mt-4 rounded-lg border border-warning/35 bg-warning/10 p-3 text-sm text-muted-foreground">
              Replacing this active definition reconciles capacity immediately.
              Live referenced slots remain preserved for staff resolution.
            </p>
          )}
          {template && template.sourceTimezone !== timezone && (
            <p className="mt-4 rounded-lg border border-warning/35 bg-warning/10 p-3 text-sm text-muted-foreground">
              The historical schedule used {template.sourceTimezone}. This
              replacement creates a new definition in the facility's current
              timezone, {timezone}.
            </p>
          )}
          {conflictMessage && (
            <p className="mt-4 text-sm text-warning-foreground" role="alert">
              {conflictMessage} Your draft is preserved; review it before
              submitting again.
            </p>
          )}
          {validation && (
            <p className="mt-4 text-sm text-destructive" role="alert">
              {validation}
            </p>
          )}
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !assignmentId}>
              {submitting
                ? "Saving…"
                : template?.status === "active"
                  ? "Replace and reconcile"
                  : template
                    ? "Replace schedule"
                    : "Create inactive schedule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ExceptionDialog({
  open,
  onOpenChange,
  timezone,
  localToday,
  practitionerOptions,
  conflictMessage,
  submitting,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timezone: string;
  localToday: string;
  practitionerOptions: FacilityPractitionerOption[];
  conflictMessage: string | null;
  submitting: boolean;
  onSubmit: (
    input: {
      practitionerFacilityAssignmentId?: string;
      kind: "facility_closed" | "practitioner_unavailable";
      isAllDay: boolean;
      localStartsAt: string;
      localEndsAt: string;
    },
    idempotencyKey: string,
  ) => Promise<MutationAttempt>;
}) {
  const [kind, setKind] = useState<
    "facility_closed" | "practitioner_unavailable"
  >("facility_closed");
  const [assignmentId, setAssignmentId] = useState(
    practitionerOptions[0]?.assignmentId ?? "",
  );
  const [allDay, setAllDay] = useState(true);
  const [date, setDate] = useState(localToday);
  const [startDate, setStartDate] = useState(localToday);
  const [startTime, setStartTime] = useState("09:00");
  const [endDate, setEndDate] = useState(localToday);
  const [endTime, setEndTime] = useState("17:00");
  const [validation, setValidation] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(newCommandKey);

  const payloadChanged = () => {
    setValidation(null);
    setIdempotencyKey(newCommandKey());
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (kind === "practitioner_unavailable" && !assignmentId) {
      setValidation("Select one practitioner affiliation.");
      return;
    }
    const localStartsAt = allDay
      ? canonicalLocalDateTime(date, "00:00")
      : canonicalLocalDateTime(startDate, startTime);
    const localEndsAt = allDay
      ? canonicalLocalDateTime(addCalendarDays(date, 1), "00:00")
      : canonicalLocalDateTime(endDate, endTime);
    if (!date || localEndsAt <= localStartsAt) {
      setValidation("Exception end must be after its local start.");
      return;
    }
    const attempt = await onSubmit(
      {
        kind,
        isAllDay: allDay,
        ...(kind === "practitioner_unavailable"
          ? { practitionerFacilityAssignmentId: assignmentId }
          : {}),
        localStartsAt,
        localEndsAt,
      },
      idempotencyKey,
    );
    if (attempt === "success") onOpenChange(false);
    if (attempt === "definitive-error") setIdempotencyKey(newCommandKey());
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && submitting) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-2xl" showCloseButton={!submitting}>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add availability exception</DialogTitle>
            <DialogDescription>
              This active exception applies immediately in {timezone} and
              reconciles future capacity. No free-text reason is stored.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="exception-kind">Exception type</Label>
              <Select
                value={kind}
                onValueChange={(value) => {
                  setKind(
                    value as "facility_closed" | "practitioner_unavailable",
                  );
                  payloadChanged();
                }}
              >
                <SelectTrigger id="exception-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="facility_closed">
                    Facility closure
                  </SelectItem>
                  <SelectItem value="practitioner_unavailable">
                    Practitioner unavailable
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {kind === "practitioner_unavailable" && (
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="exception-practitioner">Practitioner</Label>
                <Select
                  value={assignmentId}
                  onValueChange={(value) => {
                    setAssignmentId(value);
                    payloadChanged();
                  }}
                >
                  <SelectTrigger id="exception-practitioner">
                    <SelectValue placeholder="Select practitioner" />
                  </SelectTrigger>
                  <SelectContent>
                    {practitionerOptions.map((option) => (
                      <SelectItem
                        key={option.assignmentId}
                        value={option.assignmentId}
                      >
                        {option.practitionerName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Checkbox
                checked={allDay}
                onCheckedChange={(checked) => {
                  setAllDay(checked === true);
                  payloadChanged();
                }}
              />
              All-day local exception
            </label>
            {allDay ? (
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="exception-date">Local date</Label>
                <Input
                  id="exception-date"
                  type="date"
                  required
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value);
                    payloadChanged();
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Midnight through the following local midnight in {timezone}.
                </p>
              </div>
            ) : (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="exception-start-date">Start date</Label>
                  <Input
                    id="exception-start-date"
                    type="date"
                    required
                    value={startDate}
                    onChange={(event) => {
                      setStartDate(event.target.value);
                      payloadChanged();
                    }}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="exception-start-time">Start time</Label>
                  <Input
                    id="exception-start-time"
                    type="time"
                    required
                    value={startTime}
                    onChange={(event) => {
                      setStartTime(event.target.value);
                      payloadChanged();
                    }}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="exception-end-date">End date</Label>
                  <Input
                    id="exception-end-date"
                    type="date"
                    required
                    value={endDate}
                    onChange={(event) => {
                      setEndDate(event.target.value);
                      payloadChanged();
                    }}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="exception-end-time">End time</Label>
                  <Input
                    id="exception-end-time"
                    type="time"
                    required
                    value={endTime}
                    onChange={(event) => {
                      setEndTime(event.target.value);
                      payloadChanged();
                    }}
                  />
                </div>
              </>
            )}
          </div>
          <p className="mt-4 rounded-lg border border-warning/35 bg-warning/10 p-3 text-sm text-muted-foreground">
            Applying this exception may withdraw unbooked slots. Live referenced
            slots remain reserved and are reported with opaque request IDs.
          </p>
          {conflictMessage && (
            <p className="mt-4 text-sm text-warning-foreground" role="alert">
              {conflictMessage} Your draft is preserved; review it before
              submitting again.
            </p>
          )}
          {validation && (
            <p className="mt-4 text-sm text-destructive" role="alert">
              {validation}
            </p>
          )}
          <DialogFooter className="mt-6">
            <Button
              type="button"
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
                (kind === "practitioner_unavailable" && !assignmentId)
              }
            >
              {submitting ? "Applying…" : "Apply exception"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DurationDialog({
  open,
  onOpenChange,
  service,
  conflictMessage,
  submitting,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service: SchedulingService | null;
  conflictMessage: string | null;
  submitting: boolean;
  onSubmit: (
    durationMinutes: number,
    idempotencyKey: string,
  ) => Promise<MutationAttempt>;
}) {
  const [duration, setDuration] = useState(
    service ? String(service.durationMinutes) : "",
  );
  const [validation, setValidation] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(newCommandKey);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = Number(duration);
    if (!Number.isInteger(value) || value < 1 || value > 1440) {
      setValidation("Duration must be a whole number from 1 to 1440 minutes.");
      return;
    }
    if (value === service?.durationMinutes) {
      setValidation("Choose a duration different from the current value.");
      return;
    }
    const attempt = await onSubmit(value, idempotencyKey);
    if (attempt === "success") onOpenChange(false);
    if (attempt === "definitive-error") setIdempotencyKey(newCommandKey());
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && submitting) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent showCloseButton={!submitting}>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Change service duration</DialogTitle>
            <DialogDescription>
              {service?.patientFacingName} currently uses{" "}
              {service?.durationMinutes}
              -minute slots. Changing it regenerates all active weekly schedules
              for this service.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-5 grid gap-2">
            <Label htmlFor="service-duration">Duration in minutes</Label>
            <Input
              id="service-duration"
              type="number"
              min={1}
              max={1440}
              required
              value={duration}
              onChange={(event) => {
                setDuration(event.target.value);
                setValidation(null);
                setIdempotencyKey(newCommandKey());
              }}
            />
          </div>
          <p className="mt-4 rounded-lg border border-warning/35 bg-warning/10 p-3 text-sm text-muted-foreground">
            Obsolete unbooked slots may be withdrawn. Referenced slots retain
            their original time and provider evidence.
          </p>
          {conflictMessage && (
            <p className="mt-4 text-sm text-warning-foreground" role="alert">
              {conflictMessage} Your draft is preserved; review it before
              submitting again.
            </p>
          )}
          {validation && (
            <p className="mt-4 text-sm text-destructive" role="alert">
              {validation}
            </p>
          )}
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Regenerating…" : "Change and regenerate"}
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
  onOpenChange,
  onConfirm,
}: {
  action: ConfirmationAction | null;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <Dialog
      open={action !== null}
      onOpenChange={(open) => {
        if (!open && submitting) return;
        onOpenChange(open);
      }}
    >
      <DialogContent showCloseButton={!submitting}>
        <DialogHeader>
          <DialogTitle>{action?.title}</DialogTitle>
          <DialogDescription>{action?.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-6">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Keep current state
          </Button>
          <Button
            type="button"
            variant={action?.destructive ? "destructive" : "default"}
            disabled={submitting}
            onClick={() => void onConfirm()}
          >
            {submitting ? "Applying…" : action?.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
