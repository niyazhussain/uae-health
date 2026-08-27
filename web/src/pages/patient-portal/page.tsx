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
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { usePatientPortalCognitoSession } from "@/lib/cognito-session";
import {
  acceptPatientPortalInvitation,
  PatientOnboardingApiError,
  registerPatient,
} from "@/lib/patient-onboarding";
import { PatientAuthGate } from "@/pages/patient-portal/patient-auth-gate";

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
        <PatientAuthGate
          configured={configured}
          step={step}
          onSignIn={signIn}
          onCompleteNewPassword={completeNewPassword}
          onVerifyTotpSetup={verifyTotpSetup}
          onSubmitTotp={submitTotp}
          onReset={signOut}
          onRegister={registerPatient}
          invitationPending={invitationToken !== null}
          invitationUnavailable={invitationStatus === "unavailable"}
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
      <PatientPortalHeader
        selectedPractice={selectedPractice}
        pending={contextChangePending}
        onSignOut={signOut}
      />

      <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
        <section
          id="patient-overview"
          className="border-b pb-8 sm:pb-10"
          aria-labelledby="patient-overview-title"
        >
          <p className="text-sm font-semibold text-primary">Your access</p>
          <div className="mt-3 grid gap-5 lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-end">
            <div>
              <h1
                id="patient-overview-title"
                className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl"
              >
                Hello, {step.username}
              </h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
                {selectedPractice
                  ? `You are using ${selectedPractice}. Your activity stays within this practice until you choose another one.`
                  : "Choose a linked practice when you are ready. You decide which practice to use for each visit."}
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
                  Select the practice you want to use. This choice does not
                  reveal information from another practice.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-5">
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
                  <h3 className="text-lg font-semibold">No linked practices yet</h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                    Your account is ready. When a practice gives you a secure
                    invitation, open the link while signed in. You will choose
                    that practice yourself before it becomes active in your
                    portal.
                  </p>
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
              Patient and workforce accounts are separate. A practice is added
              only after you accept its invitation.
            </p>
          </aside>
        </div>
      </main>
    </div>
  );
}

function PatientPortalHeader({
  selectedPractice,
  pending = false,
  onSignOut,
}: {
  selectedPractice?: string | null;
  pending?: boolean;
  onSignOut?: () => void;
}) {
  const patientHomePath = isLocalHost(window.location.hostname)
    ? "/patient-portal"
    : "/";
  const practiceAccessHref = onSignOut ? "#practice-access" : "#patient-account";

  return (
    <header className="border-b bg-card/95">
      <div className="mx-auto flex min-h-16 w-full max-w-5xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <a href={patientHomePath} className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
            <HeartbeatIcon aria-hidden="true" className="size-5" weight="bold" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">UAE Health</span>
            <span className="block max-w-40 truncate text-xs text-muted-foreground sm:max-w-56">
              {selectedPractice ?? "Patient portal"}
            </span>
          </span>
        </a>
        <nav
          className="ms-auto flex items-center gap-1 sm:gap-2"
          aria-label="Patient portal"
        >
          <a
            href={practiceAccessHref}
            className="hidden rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
          >
            Practice access
          </a>
          <ThemeToggle />
          {onSignOut && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={onSignOut}
            >
              <SignOutIcon />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          )}
        </nav>
      </div>
    </header>
  );
}
