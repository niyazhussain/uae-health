import {
  ArrowClockwiseIcon,
  CalendarPlusIcon,
  CalendarXIcon,
  CheckCircleIcon,
  ClockIcon,
  WarningCircleIcon,
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
  cancelPatientAppointment,
  getPatientAppointmentAvailability,
  getPatientAppointments,
  PatientAppointmentsApiError,
  reschedulePatientAppointment,
  type PatientAppointment,
  type PatientAppointmentAvailabilityResponse,
  type PatientAppointmentsResponse,
} from "@/lib/patient-appointments";

interface PatientAppointmentsPageProps {
  csrfToken: string;
  practiceName: string;
  onRequestAppointment: () => void;
  onSessionExpired: () => void;
}

type AppointmentDialog =
  | { kind: "cancel"; appointment: PatientAppointment }
  | { kind: "reschedule"; appointment: PatientAppointment }
  | null;

function formatAppointmentTime(
  startsAt: string,
  endsAt: string,
  timezone: string,
): string {
  try {
    const formatter = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    });

    return `${formatter.format(new Date(startsAt))} to ${new Intl.DateTimeFormat(
      undefined,
      { timeStyle: "short", timeZone: timezone },
    ).format(new Date(endsAt))}`;
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(startsAt));
  }
}

function appointmentStatus(appointment: PatientAppointment) {
  if (appointment.status === "cancelled") {
    return <Badge variant="outline">Cancelled</Badge>;
  }

  return <Badge variant="warning">Appointment requested</Badge>;
}

export function PatientAppointmentsPage({
  csrfToken,
  practiceName,
  onRequestAppointment,
  onSessionExpired,
}: PatientAppointmentsPageProps) {
  const [appointments, setAppointments] =
    useState<PatientAppointmentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [dialog, setDialog] = useState<AppointmentDialog>(null);
  const [availability, setAvailability] =
    useState<PatientAppointmentAvailabilityResponse | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(
    null,
  );
  const [availabilityReloadVersion, setAvailabilityReloadVersion] = useState(0);
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [commandSuccess, setCommandSuccess] = useState<string | null>(null);
  const idempotencyKeys = useRef(new Map<string, string>());

  useEffect(() => {
    let cancelled = false;

    const loadAppointments = async () => {
      setLoading(true);
      setError(null);

      try {
        const result = await getPatientAppointments();
        if (!cancelled) setAppointments(result);
      } catch (reason: unknown) {
        if (cancelled) return;

        if (
          reason instanceof PatientAppointmentsApiError &&
          reason.status === 401
        ) {
          onSessionExpired();
          return;
        }

        setError(
          reason instanceof Error
            ? reason.message
            : "Appointments could not be loaded.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadAppointments();

    return () => {
      cancelled = true;
    };
  }, [onSessionExpired, reloadVersion]);

  useEffect(() => {
    if (dialog?.kind !== "reschedule") return;

    let cancelled = false;

    const loadAvailability = async () => {
      setAvailabilityLoading(true);
      setAvailabilityError(null);
      setAvailability(null);
      setSelectedSlotId("");

      try {
        const result = await getPatientAppointmentAvailability();
        if (!cancelled) setAvailability(result);
      } catch (reason: unknown) {
        if (cancelled) return;

        if (
          reason instanceof PatientAppointmentsApiError &&
          reason.status === 401
        ) {
          onSessionExpired();
          return;
        }

        setAvailabilityError(
          reason instanceof Error
            ? reason.message
            : "Available times could not be loaded.",
        );
      } finally {
        if (!cancelled) setAvailabilityLoading(false);
      }
    };

    void loadAvailability();

    return () => {
      cancelled = true;
    };
  }, [
    availabilityReloadVersion,
    dialog?.kind,
    dialog?.appointment.appointmentId,
    onSessionExpired,
  ]);

  const closeDialog = () => {
    if (submitting) return;
    setDialog(null);
    setAvailability(null);
    setAvailabilityError(null);
    setSelectedSlotId("");
    setCommandError(null);
  };

  const handleCommandError = (reason: unknown) => {
    if (
      reason instanceof PatientAppointmentsApiError &&
      reason.status === 401
    ) {
      onSessionExpired();
      return;
    }

    if (
      reason instanceof PatientAppointmentsApiError &&
      [403, 404].includes(reason.status)
    ) {
      setCommandError(
        "This appointment is no longer available in the selected practice.",
      );
      setReloadVersion((value) => value + 1);
      return;
    }

    if (
      reason instanceof PatientAppointmentsApiError &&
      reason.status === 409
    ) {
      setCommandError(
        "This appointment changed before your request was completed. The latest appointments are being loaded.",
      );
      setReloadVersion((value) => value + 1);
      return;
    }

    setCommandError(
      reason instanceof Error
        ? reason.message
        : "The appointment could not be updated.",
    );
  };

  const cancelAppointment = async () => {
    if (!dialog || dialog.kind !== "cancel" || submitting) return;

    const appointment = dialog.appointment;
    const key = `cancel:${appointment.appointmentId}:${appointment.version}`;
    const idempotencyKey =
      idempotencyKeys.current.get(key) ?? globalThis.crypto.randomUUID();
    idempotencyKeys.current.set(key, idempotencyKey);
    setSubmitting(true);
    setCommandError(null);

    try {
      await cancelPatientAppointment(
        csrfToken,
        appointment.appointmentId,
        appointment.version,
        idempotencyKey,
      );
      setDialog(null);
      setCommandSuccess("Your appointment request was cancelled.");
      setReloadVersion((value) => value + 1);
    } catch (reason: unknown) {
      handleCommandError(reason);
    } finally {
      setSubmitting(false);
    }
  };

  const rescheduleAppointment = async () => {
    if (
      !dialog ||
      dialog.kind !== "reschedule" ||
      !selectedSlotId ||
      submitting
    ) {
      return;
    }

    const appointment = dialog.appointment;
    const key = `reschedule:${appointment.appointmentId}:${appointment.version}:${selectedSlotId}`;
    const idempotencyKey =
      idempotencyKeys.current.get(key) ?? globalThis.crypto.randomUUID();
    idempotencyKeys.current.set(key, idempotencyKey);
    setSubmitting(true);
    setCommandError(null);

    try {
      await reschedulePatientAppointment(
        csrfToken,
        appointment.appointmentId,
        selectedSlotId,
        appointment.version,
        idempotencyKey,
      );
      setDialog(null);
      setCommandSuccess("Your appointment request was updated.");
      setReloadVersion((value) => value + 1);
    } catch (reason: unknown) {
      handleCommandError(reason);
    } finally {
      setSubmitting(false);
    }
  };

  const timezone = appointments?.timezone ?? "UTC";
  const appointmentItems = appointments?.appointments ?? [];

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
      <section className="border-b pb-8 sm:pb-10" aria-labelledby="appointments-title">
        <div className="flex items-center gap-2 text-sm font-semibold text-primary">
          <CalendarPlusIcon aria-hidden="true" className="size-5" />
          {practiceName}
        </div>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1
              id="appointments-title"
              className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl"
            >
              Your appointments
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
              View and manage appointment requests for this practice only.
            </p>
          </div>
          <Button onClick={onRequestAppointment}>
            <CalendarPlusIcon aria-hidden="true" />
            Request appointment
          </Button>
        </div>
      </section>

      {commandSuccess && (
        <section
          className="mt-6 flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 p-4"
          role="status"
        >
          <CheckCircleIcon
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-success"
            weight="fill"
          />
          <p className="text-sm leading-6 text-foreground">{commandSuccess}</p>
        </section>
      )}

      {loading ? (
        <section className="mt-7 grid gap-4" aria-label="Loading appointments">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </section>
      ) : error ? (
        <section
          className="mt-7 rounded-xl border border-destructive/30 bg-destructive/10 p-5 sm:p-6"
          role="alert"
        >
          <div className="flex items-start gap-3">
            <WarningCircleIcon
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-destructive"
            />
            <div>
              <h2 className="font-semibold">Appointments are unavailable</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {error}
              </p>
              <Button
                className="mt-4"
                size="sm"
                variant="outline"
                onClick={() => setReloadVersion((value) => value + 1)}
              >
                <ArrowClockwiseIcon aria-hidden="true" />
                Try again
              </Button>
            </div>
          </div>
        </section>
      ) : appointmentItems.length === 0 ? (
        <section className="mt-7 rounded-xl border bg-card p-5 sm:p-6">
          <h2 className="text-lg font-semibold">No appointments yet</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Request an appointment when you are ready. It will appear here for
            this practice only.
          </p>
          <Button className="mt-5" onClick={onRequestAppointment}>
            <CalendarPlusIcon aria-hidden="true" />
            Request appointment
          </Button>
        </section>
      ) : (
        <section className="mt-7 grid gap-4" aria-label="Appointments">
          {appointmentItems.map((appointment) => (
            <article
              key={appointment.appointmentId}
              className="rounded-xl border bg-card p-5 sm:p-6"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground">
                    <ClockIcon aria-hidden="true" className="size-5" weight="bold" />
                  </span>
                  <div>
                    <h2 className="font-semibold">
                      {formatAppointmentTime(
                        appointment.startsAt,
                        appointment.endsAt,
                        timezone,
                      )}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Times shown in {timezone}
                    </p>
                  </div>
                </div>
                {appointmentStatus(appointment)}
              </div>

              {(appointment.canCancel || appointment.canReschedule) && (
                <div className="mt-5 flex flex-wrap gap-2 border-t pt-4">
                  {appointment.canReschedule && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setCommandError(null);
                        setCommandSuccess(null);
                        setDialog({ kind: "reschedule", appointment });
                      }}
                    >
                      Choose a different time
                    </Button>
                  )}
                  {appointment.canCancel && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setCommandError(null);
                        setCommandSuccess(null);
                        setDialog({ kind: "cancel", appointment });
                      }}
                    >
                      <CalendarXIcon aria-hidden="true" />
                      Cancel appointment
                    </Button>
                  )}
                </div>
              )}
            </article>
          ))}
        </section>
      )}

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          {dialog?.kind === "cancel" ? (
            <>
              <DialogHeader>
                <DialogTitle>Cancel this appointment?</DialogTitle>
                <DialogDescription>
                  Your appointment request for {formatAppointmentTime(
                    dialog.appointment.startsAt,
                    dialog.appointment.endsAt,
                    timezone,
                  )} will be cancelled for {practiceName}.
                </DialogDescription>
              </DialogHeader>
              {commandError && (
                <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">
                  {commandError}
                </p>
              )}
              <DialogFooter>
                <Button variant="outline" disabled={submitting} onClick={closeDialog}>
                  Keep appointment
                </Button>
                <Button
                  variant="destructive"
                  disabled={submitting}
                  onClick={() => void cancelAppointment()}
                >
                  {submitting ? "Cancelling…" : "Cancel appointment"}
                </Button>
              </DialogFooter>
            </>
          ) : dialog?.kind === "reschedule" ? (
            <>
              <DialogHeader>
                <DialogTitle>Choose a different time</DialogTitle>
                <DialogDescription>
                  Select a new available time for your appointment request at {practiceName}.
                </DialogDescription>
              </DialogHeader>
              {availabilityLoading ? (
                <div className="grid gap-3" aria-label="Loading available times">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : availabilityError ? (
                <div className="grid gap-3" role="alert">
                  <p className="text-sm text-destructive">{availabilityError}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setAvailabilityReloadVersion((value) => value + 1)
                    }
                  >
                    <ArrowClockwiseIcon aria-hidden="true" />
                    Try again
                  </Button>
                </div>
              ) : availability?.slots.length === 0 ? (
                <p className="rounded-lg bg-muted p-3 text-sm leading-6 text-muted-foreground">
                  No other times are available right now. Keep your current appointment or try again later.
                </p>
              ) : (
                <div className="grid gap-2">
                  <Label htmlFor="reschedule-slot">Available time</Label>
                  <Select
                    value={selectedSlotId}
                    onValueChange={setSelectedSlotId}
                    disabled={submitting}
                  >
                    <SelectTrigger id="reschedule-slot" className="min-h-11">
                      <SelectValue placeholder="Select a time" />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {availability?.slots.map((slot) => (
                        <SelectItem key={slot.slotId} value={slot.slotId}>
                          {formatAppointmentTime(
                            slot.startsAt,
                            slot.endsAt,
                            availability.timezone,
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {commandError && (
                <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">
                  {commandError}
                </p>
              )}
              <DialogFooter>
                <Button variant="outline" disabled={submitting} onClick={closeDialog}>
                  Keep current time
                </Button>
                <Button
                  disabled={
                    submitting ||
                    availabilityLoading ||
                    Boolean(availabilityError) ||
                    !selectedSlotId
                  }
                  onClick={() => void rescheduleAppointment()}
                >
                  {submitting ? "Updating…" : "Update appointment"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  );
}
