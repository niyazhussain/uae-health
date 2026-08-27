import {
  BuildingsIcon,
  CalendarDotsIcon,
  LockKeyIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";

import {
  PatientInvitationStatusCard,
  type PatientInvitationStatus,
} from "@/components/patient-invitation-status";
import { PatientPracticeSwitcher } from "@/components/patient-practice-switcher";
import { Button } from "@/components/ui/button";
import type {
  PatientAppointmentOnboardingPractice,
  PatientPracticeChoice,
  PatientSessionContext,
} from "@/lib/cognito-session";

interface PatientPortalHomePageProps {
  username: string;
  context: PatientSessionContext;
  availablePractices: PatientPracticeChoice[];
  appointmentOnboardingPractices: PatientAppointmentOnboardingPractice[];
  invitationStatus: PatientInvitationStatus;
  contextChangePending: boolean;
  contextChangeError: string | null;
  onRetryInvitation: () => void;
  onSelectPractice: (portalProfileId: string | null) => Promise<boolean>;
  onSelectAppointmentOnboardingPractice: (
    appointmentRelationshipId: string,
  ) => Promise<boolean>;
  onFindPractice: () => void;
  onViewAppointments: () => void;
}

export function PatientPortalHomePage({
  username,
  context,
  availablePractices,
  appointmentOnboardingPractices,
  invitationStatus,
  contextChangePending,
  contextChangeError,
  onRetryInvitation,
  onSelectPractice,
  onSelectAppointmentOnboardingPractice,
  onFindPractice,
  onViewAppointments,
}: PatientPortalHomePageProps) {
  const selectedPractice =
    context.kind === "onboarding" ? null : context.practiceName;
  const hasAppointmentContext = context.kind !== "onboarding";

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
      <section className="border-b pb-8 sm:pb-10" aria-labelledby="patient-home-title">
        <p className="text-sm font-semibold text-primary">Your portal</p>
        <div className="mt-3 grid gap-5 lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-end">
          <div>
            <h1
              id="patient-home-title"
              className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl"
            >
              Hello, {username}
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
              {selectedPractice
                ? `You are using ${selectedPractice}. Your appointment activity stays within this practice until you choose another one.`
                : "Find a practice when you are ready, then choose it before you request an appointment."}
            </p>
          </div>
          <div className="rounded-xl bg-secondary p-4 text-sm text-secondary-foreground">
            <p className="font-medium">Current practice</p>
            <p className="mt-1 leading-6">
              {selectedPractice ?? "No practice selected"}
            </p>
          </div>
        </div>
      </section>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <section id="practice-access" aria-labelledby="practice-access-title">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground">
              <BuildingsIcon
                aria-hidden="true"
                className="size-5"
                weight="bold"
              />
            </span>
            <div>
              <h2 id="practice-access-title" className="text-xl font-semibold">
                Practice access
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                Choose one practice at a time. Other practice relationships stay
                separate.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-5">
            <PatientInvitationStatusCard
              status={invitationStatus}
              onRetry={onRetryInvitation}
            />

            {appointmentOnboardingPractices.length > 0 && (
              <section
                className="rounded-xl border bg-card p-5 sm:p-6"
                aria-labelledby="pending-appointment-title"
              >
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground">
                    <CalendarDotsIcon
                      aria-hidden="true"
                      className="size-5"
                      weight="bold"
                    />
                  </span>
                  <div>
                    <h3 id="pending-appointment-title" className="text-lg font-semibold">
                      Appointment requests in progress
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      Continue with one practice to request or review only its
                      appointments.
                    </p>
                  </div>
                </div>
                <div className="mt-5 grid gap-3">
                  {appointmentOnboardingPractices.map((practice) => {
                    const current =
                      context.kind === "appointment-onboarding" &&
                      context.appointmentRelationshipId ===
                        practice.appointmentRelationshipId;

                    return (
                      <div
                        key={practice.appointmentRelationshipId}
                        className="flex flex-col gap-3 rounded-lg border bg-background p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <p className="font-medium">{practice.practiceName}</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {current
                              ? "Current appointment practice"
                              : "Appointment request available"}
                          </p>
                        </div>
                        <Button
                          className="self-start sm:self-auto"
                          size="sm"
                          variant={current ? "outline" : "default"}
                          disabled={contextChangePending}
                          onClick={() => {
                            if (current) {
                              onViewAppointments();
                              return;
                            }

                            void onSelectAppointmentOnboardingPractice(
                              practice.appointmentRelationshipId,
                            ).then((changed) => {
                              if (changed) onViewAppointments();
                            });
                          }}
                        >
                          {current
                            ? "View appointments"
                            : contextChangePending
                              ? "Opening…"
                              : "Continue"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
                {contextChangeError &&
                  (context.kind === "appointment-onboarding" ||
                    availablePractices.length === 0) && (
                    <p
                      className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                      role="alert"
                    >
                      {contextChangeError}
                    </p>
                  )}
              </section>
            )}

            {availablePractices.length > 0 ? (
              <PatientPracticeSwitcher
                key={
                  context.kind === "practice"
                    ? context.portalProfileId
                    : context.kind === "appointment-onboarding"
                      ? context.appointmentRelationshipId
                      : "onboarding"
                }
                availablePractices={availablePractices}
                context={context}
                pending={contextChangePending}
                error={contextChangeError}
                onSelectPractice={onSelectPractice}
              />
            ) : (
              <section className="rounded-xl border bg-card p-5 sm:p-6">
                <h3 className="text-lg font-semibold">No linked practices yet</h3>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  You can find a bookable practice and begin an appointment
                  request. A practice invitation is still required for broader
                  portal access.
                </p>
                <Button className="mt-5" onClick={onFindPractice}>
                  <MagnifyingGlassIcon aria-hidden="true" />
                  Find a practice
                </Button>
              </section>
            )}

            {context.kind === "onboarding" && availablePractices.length > 0 && (
              <section className="rounded-xl border bg-card p-5 sm:p-6">
                <h3 className="text-lg font-semibold">Find a practice</h3>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  You can start an appointment request with a bookable practice
                  without changing your other practice relationships.
                </p>
                <Button className="mt-5" onClick={onFindPractice}>
                  <MagnifyingGlassIcon aria-hidden="true" />
                  Find a practice
                </Button>
              </section>
            )}

            {hasAppointmentContext && (
              <section className="rounded-xl border bg-card p-5 sm:p-6">
                <h3 className="text-lg font-semibold">Appointments</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Review or request appointments only for {selectedPractice}.
                </p>
                <Button className="mt-5" onClick={onViewAppointments}>
                  <CalendarDotsIcon aria-hidden="true" />
                  View appointments
                </Button>
              </section>
            )}
          </div>
        </section>

        <aside className="border-s ps-5 text-sm text-muted-foreground">
          <LockKeyIcon
            aria-hidden="true"
            className="size-5 text-primary"
            weight="bold"
          />
          <h2 className="mt-3 font-semibold text-foreground">Your privacy</h2>
          <p className="mt-2 leading-6">
            A selected practice cannot reveal information from your other
            practice relationships.
          </p>
        </aside>
      </div>
    </main>
  );
}
