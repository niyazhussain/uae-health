import {
  BuildingsIcon,
  HeartbeatIcon,
  LockKeyIcon,
  SignOutIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  PatientInvitationStatusCard,
  type PatientInvitationStatus,
} from "@/components/patient-invitation-status";
import { PatientPracticeSwitcher } from "@/components/patient-practice-switcher";
import { SignInPanel } from "@/components/sign-in-panel";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { usePatientPortalCognitoSession } from "@/lib/cognito-session";
import {
  acceptPatientPortalInvitation,
  PatientOnboardingApiError,
  registerPatient,
} from "@/lib/patient-onboarding";

const invitationTokenPattern = /^[A-Za-z0-9_-]{32,256}$/;

function isLocalHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

function captureInvitation(): {
  inviteRoute: boolean;
  token: string | null;
} {
  const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
  const inviteRoute = isLocalHost(window.location.hostname)
    ? pathname === "/patient-portal/invite"
    : pathname === "/invite";
  const fragment = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : "";

  return {
    inviteRoute,
    token:
      inviteRoute && invitationTokenPattern.test(fragment) ? fragment : null,
  };
}

function removeInvitationFragment(): void {
  if (!window.location.hash) return;

  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
}

function finishInvitationRoute(): void {
  const path = isLocalHost(window.location.hostname) ? "/patient-portal" : "/";
  window.history.replaceState(window.history.state, "", path);
}

export function PatientPortalPage() {
  const {
    step,
    configured,
    signIn,
    completeNewPassword,
    verifyTotpSetup,
    submitTotp,
    signOut,
    refreshSession,
    selectPatientPractice,
    contextChangePending,
    contextChangeError,
    handleUnauthorized,
  } = usePatientPortalCognitoSession();
  const [capturedInvitation, setCapturedInvitation] =
    useState(captureInvitation);
  const invitationToken = capturedInvitation.token;
  const invitationRequestInFlight = useRef(false);
  const [invitationStatus, setInvitationStatus] =
    useState<PatientInvitationStatus>(() => {
      if (capturedInvitation.token) return "waiting";
      return capturedInvitation.inviteRoute ? "unavailable" : "none";
    });

  useEffect(() => {
    if (capturedInvitation.inviteRoute) removeInvitationFragment();
  }, [capturedInvitation.inviteRoute]);

  const retryInvitation = useCallback(() => {
    if (invitationToken) setInvitationStatus("waiting");
    else setInvitationStatus("unavailable");
  }, [invitationToken]);

  useEffect(() => {
    if (
      invitationStatus !== "waiting" ||
      !invitationToken ||
      invitationRequestInFlight.current ||
      step.kind !== "signed-in" ||
      step.audience !== "patient" ||
      contextChangePending
    ) {
      return;
    }

    if (step.context.kind === "practice") {
      invitationRequestInFlight.current = true;
      void selectPatientPractice(null)
        .then((changed) => {
          setInvitationStatus(changed ? "waiting" : "error");
        })
        .finally(() => {
          invitationRequestInFlight.current = false;
        });
      return;
    }

    invitationRequestInFlight.current = true;

    void acceptPatientPortalInvitation(step.csrfToken, invitationToken)
      .then(async () => {
        setCapturedInvitation((current) => ({ ...current, token: null }));
        finishInvitationRoute();

        try {
          await refreshSession();
        } catch {
          window.location.reload();
          return;
        }
        setInvitationStatus("accepted");
      })
      .catch((reason: unknown) => {
        if (reason instanceof PatientOnboardingApiError) {
          if (reason.status === 401) {
            handleUnauthorized();
            setInvitationStatus("waiting");
            return;
          }

          if ([400, 404, 410].includes(reason.status)) {
            setCapturedInvitation((current) => ({ ...current, token: null }));
            setInvitationStatus("unavailable");
            return;
          }
        }

        setInvitationStatus("error");
      })
      .finally(() => {
        invitationRequestInFlight.current = false;
      });
  }, [
    contextChangePending,
    handleUnauthorized,
    invitationToken,
    invitationStatus,
    refreshSession,
    selectPatientPractice,
    step,
  ]);

  if (step.kind !== "signed-in") {
    return (
      <div className="min-h-[100dvh] bg-background">
        <PatientPortalHeader />
        <SignInPanel
          audience="patient"
          configured={configured}
          step={step}
          onSignIn={signIn}
          onCompleteNewPassword={completeNewPassword}
          onVerifyTotpSetup={verifyTotpSetup}
          onSubmitTotp={submitTotp}
          onReset={signOut}
          onRegisterPatient={registerPatient}
          patientInvitationPending={invitationToken !== null}
          patientInvitationUnavailable={invitationStatus === "unavailable"}
        />
      </div>
    );
  }

  if (step.audience !== "patient") {
    return null;
  }

  const selectedPractice =
    step.context.kind === "practice"
      ? step.context.practiceName
      : null;

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="border-b bg-card/95">
        <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6 lg:px-8">
          <span className="grid size-10 place-items-center rounded-md bg-primary text-primary-foreground">
            <HeartbeatIcon aria-hidden="true" className="size-5" weight="bold" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">UAE Health</p>
            <p className="max-w-48 truncate text-xs text-muted-foreground sm:max-w-72">
              {selectedPractice ?? "Patient portal"}
            </p>
          </div>
          <div className="ms-auto flex items-center gap-2">
            <ThemeToggle />
            <Button
              size="sm"
              variant="outline"
              disabled={contextChangePending}
              onClick={signOut}
            >
              <SignOutIcon />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold text-primary">Patient portal</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
            Welcome, {step.username}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
            {selectedPractice
              ? `Your session is limited to ${selectedPractice}. Appointment access is the next POC capability.`
              : "Choose one linked practice to continue, or remain in restricted portal access."}
          </p>
        </div>

        <div className="mt-8 grid gap-6">
          <PatientInvitationStatusCard
            status={invitationStatus}
            onRetry={retryInvitation}
          />

          {step.availablePractices.length > 0 ? (
            <PatientPracticeSwitcher
              key={
                step.context.kind === "practice"
                  ? step.context.portalProfileId
                  : "onboarding"
              }
              availablePractices={step.availablePractices}
              context={step.context}
              pending={contextChangePending}
              error={contextChangeError}
              onSelectPractice={selectPatientPractice}
            />
          ) : (
            <section className="rounded-xl border bg-card p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-md bg-secondary text-secondary-foreground">
                  <BuildingsIcon
                    aria-hidden="true"
                    className="size-5"
                    weight="bold"
                  />
                </span>
                <div>
                  <h2 className="text-lg font-semibold">
                    No practice is linked yet
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                    This restricted session cannot access private practice or
                    appointment information. Open a practice invitation link to
                    add an approved practice. Practice discovery and booking
                    with a new practice are included in the next POC task.
                  </p>
                </div>
              </div>
            </section>
          )}

          <section className="flex items-start gap-3 rounded-xl bg-muted/55 p-5 text-sm text-muted-foreground sm:p-6">
            <LockKeyIcon
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-primary"
              weight="bold"
            />
            <div>
              <h2 className="font-semibold text-foreground">
                Separate and restricted access
              </h2>
              <p className="mt-1 max-w-2xl leading-6">
                Patient access is separate from workforce access. Practices are
                linked explicitly, never by matching an email address or phone
                number, and this POC does not retrieve clinical records.
              </p>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function PatientPortalHeader() {
  return (
    <header className="border-b bg-card/95">
      <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <span className="grid size-10 place-items-center rounded-md bg-primary text-primary-foreground">
          <HeartbeatIcon aria-hidden="true" className="size-5" weight="bold" />
        </span>
        <div>
          <p className="text-sm font-semibold">UAE Health</p>
          <p className="text-xs text-muted-foreground">Patient portal</p>
        </div>
      </div>
    </header>
  );
}
