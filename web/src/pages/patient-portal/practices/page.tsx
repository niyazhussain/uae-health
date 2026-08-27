import {
  ArrowClockwiseIcon,
  BuildingsIcon,
  CalendarPlusIcon,
  MagnifyingGlassIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  createPatientAppointmentRelationship,
  getBookablePatientPractices,
  PatientAppointmentsApiError,
  type PatientAppointmentRelationship,
  type BookablePatientPractice,
} from "@/lib/patient-appointments";

interface PatientPracticeDiscoveryPageProps {
  csrfToken: string;
  onSessionExpired: () => void;
  onRelationshipReady: (
    relationship: PatientAppointmentRelationship,
  ) => Promise<boolean>;
}

export function PatientPracticeDiscoveryPage({
  csrfToken,
  onSessionExpired,
  onRelationshipReady,
}: PatientPracticeDiscoveryPageProps) {
  const [bookablePractices, setBookablePractices] = useState<
    BookablePatientPractice[]
  >([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [creatingPracticeId, setCreatingPracticeId] = useState<string | null>(
    null,
  );
  const idempotencyKeys = useRef(new Map<string, string>());

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchInput.trim().toLocaleLowerCase());
    }, 200);

    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;

    const loadBookablePractices = async () => {
      setLoading(true);
      setError(null);

      try {
        const result = await getBookablePatientPractices();
        if (!cancelled) setBookablePractices(result.bookablePractices);
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
            : "Bookable practices could not be loaded.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadBookablePractices();

    return () => {
      cancelled = true;
    };
  }, [onSessionExpired, reloadVersion]);

  const visiblePractices = useMemo(() => {
    if (!search) return bookablePractices;

    return bookablePractices.filter((practice) =>
      [practice.practiceName, practice.timezone ?? ""]
        .join(" ")
        .toLocaleLowerCase()
        .includes(search),
    );
  }, [bookablePractices, search]);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSearch(searchInput.trim().toLocaleLowerCase());
  };

  const beginAppointmentRequest = async (practice: BookablePatientPractice) => {
    if (creatingPracticeId) return;

    const idempotencyKey =
      idempotencyKeys.current.get(practice.bookablePracticeId) ??
      globalThis.crypto.randomUUID();
    idempotencyKeys.current.set(practice.bookablePracticeId, idempotencyKey);
    setCreatingPracticeId(practice.bookablePracticeId);
    setError(null);

    try {
      const relationship = await createPatientAppointmentRelationship(
        csrfToken,
        practice.bookablePracticeId,
        idempotencyKey,
      );
      const changed = await onRelationshipReady(relationship);

      if (!changed) {
        setError(
          "The appointment request could not be prepared. Your portal access was not changed.",
        );
      }
    } catch (reason: unknown) {
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
          : "The appointment request could not be prepared.",
      );
    } finally {
      setCreatingPracticeId(null);
    }
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
      <section className="border-b pb-8 sm:pb-10" aria-labelledby="practice-discovery-title">
        <div className="flex items-center gap-2 text-sm font-semibold text-primary">
          <MagnifyingGlassIcon aria-hidden="true" className="size-5" />
          Find a practice
        </div>
        <h1
          id="practice-discovery-title"
          className="mt-3 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl"
        >
          Request an appointment with a practice
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
          Choose a bookable practice. You will review an available time before
          an appointment request is sent.
        </p>
      </section>

      <form
        className="mt-7 grid gap-2 sm:max-w-xl"
        onSubmit={submitSearch}
        role="search"
      >
        <Label htmlFor="bookable-practice-search">Search practices</Label>
        <div className="flex gap-2">
          <Input
            id="bookable-practice-search"
            type="search"
            placeholder="Search by practice name"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            disabled={loading || creatingPracticeId !== null}
          />
          <Button type="submit" variant="outline" disabled={loading}>
            Search
          </Button>
        </div>
      </form>

      {loading ? (
        <section className="mt-7 grid gap-4" aria-label="Loading bookable practices">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </section>
      ) : error && bookablePractices.length === 0 ? (
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
              <h2 className="font-semibold">Practices are unavailable</h2>
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
      ) : visiblePractices.length === 0 ? (
        <section className="mt-7 rounded-xl border bg-card p-5 sm:p-6">
          <h2 className="text-lg font-semibold">No bookable practices found</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Try a different practice name, or return later to see updated
            appointment options.
          </p>
        </section>
      ) : (
        <section className="mt-7 grid gap-4" aria-label="Bookable practices">
          {error && (
            <p
              className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          )}
          {visiblePractices.map((practice) => {
            const creating = creatingPracticeId === practice.bookablePracticeId;

            return (
              <article
                key={practice.bookablePracticeId}
                className="flex flex-col gap-4 rounded-xl border bg-card p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground">
                    <BuildingsIcon
                      aria-hidden="true"
                      className="size-5"
                      weight="bold"
                    />
                  </span>
                  <div>
                    <h2 className="text-lg font-semibold">{practice.practiceName}</h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {practice.timezone
                        ? `Appointment times are shown in ${practice.timezone}.`
                        : "Review available appointment times after choosing this practice."}
                    </p>
                  </div>
                </div>
                <Button
                  className="self-start whitespace-nowrap sm:self-auto"
                  disabled={creatingPracticeId !== null}
                  onClick={() => void beginAppointmentRequest(practice)}
                >
                  <CalendarPlusIcon aria-hidden="true" />
                  {creating ? "Preparing request…" : "Request appointment"}
                </Button>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
