import {
  CheckCircleIcon,
  LinkBreakIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";

export type PatientInvitationStatus =
  | "none"
  | "waiting"
  | "accepted"
  | "error"
  | "unavailable";

interface PatientInvitationStatusProps {
  status: PatientInvitationStatus;
  onRetry: () => void;
}

export function PatientInvitationStatusCard({
  status,
  onRetry,
}: PatientInvitationStatusProps) {
  if (status === "none") return null;

  if (status === "accepted") {
    return (
      <section
        className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 p-5 sm:p-6"
        role="status"
      >
        <CheckCircleIcon
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-success"
          weight="fill"
        />
        <div>
          <h2 className="font-semibold text-foreground">
            Practice invitation accepted
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            The practice now appears in your linked practices. Choose it below
            when you are ready; it was not selected automatically.
          </p>
        </div>
      </section>
    );
  }

  if (status === "unavailable") {
    return (
      <section
        className="flex items-start gap-3 rounded-xl border bg-card p-5 sm:p-6"
        role="alert"
      >
        <LinkBreakIcon
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-muted-foreground"
        />
        <div>
          <h2 className="font-semibold text-foreground">
            Invitation unavailable
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            This invitation cannot be used. It may have expired or already been
            accepted. Ask the practice for a new link if you still need access.
          </p>
        </div>
      </section>
    );
  }

  if (status === "error") {
    return (
      <section
        className="flex flex-col gap-4 rounded-xl border border-destructive/30 bg-destructive/10 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"
        role="alert"
      >
        <div className="flex items-start gap-3">
          <WarningCircleIcon
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-destructive"
          />
          <div>
            <h2 className="font-semibold text-foreground">
              Invitation could not be accepted
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Your current access has not changed. Try the invitation again.
            </p>
          </div>
        </div>
        <Button type="button" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </section>
    );
  }

  return (
    <section
      className="flex items-start gap-3 rounded-xl border bg-card p-5 sm:p-6"
      role="status"
      aria-live="polite"
    >
      <SpinnerGapIcon
        aria-hidden="true"
        className="mt-0.5 size-5 shrink-0 animate-spin text-primary"
      />
      <div>
        <h2 className="font-semibold text-foreground">
          Reviewing practice invitation
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          The practice will be linked only after the secure invitation and your
          patient session are verified.
        </p>
      </div>
    </section>
  );
}
