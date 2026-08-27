import {
  ArrowClockwiseIcon,
  CalendarCheckIcon,
  CaretLeftIcon,
  CheckCircleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

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
  createPatientAppointment,
  getPatientAppointmentAvailability,
  PatientAppointmentsApiError,
  type PatientAppointmentAvailabilityResponse,
} from "@/lib/patient-appointments";

interface PatientAppointmentRequestPageProps {
  csrfToken: string;
  practiceName: string;
  onBackToAppointments: () => void;
  onSessionExpired: () => void;
}

function formatAppointmentTime(
  startsAt: string,
  endsAt: string,
  timezone: string,
): string {
  try {
    const dateFormatter = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeZone: timezone,
    });
    const timeFormatter = new Intl.DateTimeFormat(undefined, {
      timeStyle: "short",
      timeZone: timezone,
    });

    return `${dateFormatter.format(new Date(startsAt))}, ${timeFormatter.format(
      new Date(startsAt),
    )} to ${timeFormatter.format(new Date(endsAt))}`;
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(startsAt));
  }
}

export function PatientAppointmentRequestPage({
  csrfToken,
  practiceName,
  onBackToAppointments,
  onSessionExpired,
}: PatientAppointmentRequestPageProps) {
  const [availability, setAvailability] =
    useState<PatientAppointmentAvailabilityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const idempotencyKey = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadAvailability = async () => {
      setLoading(true);
      setError(null);

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

        setError(
          reason instanceof Error
            ? reason.message
            : "Available appointment times could not be loaded.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadAvailability();

    return () => {
      cancelled = true;
    };
  }, [onSessionExpired, reloadVersion]);

  const selectedSlot = availability?.slots.find(
    (slot) => slot.slotId === selectedSlotId,
  );

  const selectSlot = (slotId: string) => {
    setSelectedSlotId(slotId);
    idempotencyKey.current = null;
    setError(null);
  };

  const submitAppointmentRequest = async () => {
    if (!selectedSlot || submitting) return;

    const key = idempotencyKey.current ?? globalThis.crypto.randomUUID();
    idempotencyKey.current = key;
    setSubmitting(true);
    setError(null);

    try {
      await createPatientAppointment(csrfToken, selectedSlot.slotId, key);
      setConfirming(false);
      setSuccess(true);
    } catch (reason: unknown) {
      if (
        reason instanceof PatientAppointmentsApiError &&
        reason.status === 401
      ) {
        onSessionExpired();
        return;
      }

      if (
        reason instanceof PatientAppointmentsApiError &&
        [403, 404, 409].includes(reason.status)
      ) {
        setConfirming(false);
        setSelectedSlotId("");
        setError(
          "That time is no longer available. Choose another available time.",
        );
        setReloadVersion((value) => value + 1);
        return;
      }

      setError(
        reason instanceof Error
          ? reason.message
          : "The appointment request could not be sent.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
      <Button size="sm" variant="ghost" onClick={onBackToAppointments}>
        <CaretLeftIcon aria-hidden="true" />
        Back to appointments
      </Button>

      <section className="mt-5 border-b pb-8 sm:pb-10" aria-labelledby="request-appointment-title">
        <p className="text-sm font-semibold text-primary">{practiceName}</p>
        <h1
          id="request-appointment-title"
          className="mt-3 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl"
        >
          Request an appointment
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
          Select an available time, then review your appointment request before
          sending it.
        </p>
      </section>

      {success ? (
        <section
          className="mt-7 rounded-xl border border-success/30 bg-success/10 p-5 sm:p-6"
          role="status"
        >
          <CheckCircleIcon
            aria-hidden="true"
            className="size-5 text-success"
            weight="fill"
          />
          <h2 className="mt-3 text-lg font-semibold">Appointment requested</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Your request is now listed only under {practiceName}.
          </p>
          <Button className="mt-5" onClick={onBackToAppointments}>
            View appointments
          </Button>
        </section>
      ) : loading ? (
        <section className="mt-7 grid gap-4" aria-label="Loading available times">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-20 w-full" />
        </section>
      ) : error && !availability ? (
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
              <h2 className="font-semibold">Times are unavailable</h2>
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
      ) : availability?.slots.length === 0 ? (
        <section className="mt-7 rounded-xl border bg-card p-5 sm:p-6">
          <h2 className="text-lg font-semibold">No times are available</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Try again later, or choose another practice for a separate
            appointment request.
          </p>
        </section>
      ) : (
        <form
          className="mt-7 rounded-xl border bg-card p-5 sm:p-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (selectedSlot) setConfirming(true);
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="appointment-slot">Available time</Label>
            <Select value={selectedSlotId} onValueChange={selectSlot}>
              <SelectTrigger id="appointment-slot" className="min-h-11">
                <SelectValue placeholder="Select an available time" />
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
            <p className="text-xs leading-5 text-muted-foreground">
              Times are shown in {availability?.timezone ?? "the practice time zone"}.
            </p>
          </div>

          {error && (
            <p
              className="mt-5 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          )}

          <Button className="mt-6" type="submit" disabled={!selectedSlot}>
            <CalendarCheckIcon aria-hidden="true" />
            Review appointment request
          </Button>
        </form>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send this appointment request?</DialogTitle>
            <DialogDescription>
              {selectedSlot && availability
                ? `${formatAppointmentTime(
                    selectedSlot.startsAt,
                    selectedSlot.endsAt,
                    availability.timezone,
                  )} at ${practiceName}.`
                : "Choose a time before sending your appointment request."}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={submitting} onClick={() => setConfirming(false)}>
              Review time
            </Button>
            <Button
              disabled={!selectedSlot || submitting}
              onClick={() => void submitAppointmentRequest()}
            >
              {submitting ? "Sending…" : "Send request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
