import {
  BuildingsIcon,
  HeartbeatIcon,
  LockKeyIcon,
  SignOutIcon,
} from "@phosphor-icons/react";

import { PatientPracticeSwitcher } from "@/components/patient-practice-switcher";
import { SignInPanel } from "@/components/sign-in-panel";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { usePatientPortalCognitoSession } from "@/lib/cognito-session";

export function PatientPortalPage() {
  const session = usePatientPortalCognitoSession();

  if (session.step.kind !== "signed-in") {
    return (
      <div className="min-h-[100dvh] bg-background">
        <PatientPortalHeader />
        <SignInPanel
          audience="patient"
          configured={session.configured}
          step={session.step}
          onSignIn={session.signIn}
          onCompleteNewPassword={session.completeNewPassword}
          onVerifyTotpSetup={session.verifyTotpSetup}
          onSubmitTotp={session.submitTotp}
          onReset={session.signOut}
        />
      </div>
    );
  }

  if (session.step.audience !== "patient") {
    return null;
  }

  const selectedPractice =
    session.step.context.kind === "practice"
      ? session.step.context.practiceName
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
              disabled={session.contextChangePending}
              onClick={session.signOut}
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
            Welcome, {session.step.username}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
            {selectedPractice
              ? `Your session is limited to ${selectedPractice}. Appointment access is the next POC capability.`
              : "Choose one linked practice to continue, or remain in restricted portal access."}
          </p>
        </div>

        <div className="mt-8 grid gap-6">
          {session.step.availablePractices.length > 0 ? (
            <PatientPracticeSwitcher
              key={
                session.step.context.kind === "practice"
                  ? session.step.context.portalProfileId
                  : "onboarding"
              }
              availablePractices={session.step.availablePractices}
              context={session.step.context}
              pending={session.contextChangePending}
              error={session.contextChangeError}
              onSelectPractice={session.selectPatientPractice}
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
                    appointment information. Practice discovery, invitations,
                    and booking with a new practice are included in the next POC
                    tasks.
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
