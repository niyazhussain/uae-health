import {
  CalendarDotsIcon,
  HeartbeatIcon,
  HouseIcon,
  MagnifyingGlassIcon,
  SignOutIcon,
} from "@phosphor-icons/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { PatientInvitationStatus } from "@/components/patient-invitation-status";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { usePatientPortalCognitoSession } from "@/lib/cognito-session";
import type { PatientAppointmentRelationship } from "@/lib/patient-appointments";
import {
  acceptPatientPortalInvitation,
  PatientOnboardingApiError,
  registerPatient,
} from "@/lib/patient-onboarding";
import { PatientAppointmentsPage } from "@/pages/patient-portal/appointments/page";
import { PatientAppointmentRequestPage } from "@/pages/patient-portal/appointments/request/page";
import { PatientPortalHomePage } from "@/pages/patient-portal/home/page";
import { PatientAuthGate } from "@/pages/patient-portal/patient-auth-gate";
import { PatientPracticeDiscoveryPage } from "@/pages/patient-portal/practices/page";

const invitationTokenPattern = /^[A-Za-z0-9_-]{32,256}$/;

type PatientPortalRoute =
  | "home"
  | "practices"
  | "appointments"
  | "appointment-request";

function isLocalHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

function patientPortalPath(route: PatientPortalRoute): string {
  const localPrefix = isLocalHost(window.location.hostname)
    ? "/patient-portal"
    : "";

  switch (route) {
    case "practices":
      return `${localPrefix}/practices`;
    case "appointments":
      return `${localPrefix}/appointments`;
    case "appointment-request":
      return `${localPrefix}/appointments/request`;
    default:
      return localPrefix || "/";
  }
}

function patientPortalRouteFromLocation(): PatientPortalRoute {
  const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
  const localPrefix = isLocalHost(window.location.hostname)
    ? "/patient-portal"
    : "";
  const routePath = localPrefix
    ? pathname.slice(localPrefix.length) || "/"
    : pathname;

  if (routePath === "/practices") return "practices";
  if (routePath === "/appointments") return "appointments";
  if (routePath === "/appointments/request") return "appointment-request";

  return "home";
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
    selectPatientAppointmentOnboardingPractice,
    contextChangePending,
    contextChangeError,
    handleUnauthorized,
  } = usePatientPortalCognitoSession();
  const [route, setRoute] = useState<PatientPortalRoute>(
    patientPortalRouteFromLocation,
  );
  const [capturedInvitation, setCapturedInvitation] =
    useState(captureInvitation);
  const invitationToken = capturedInvitation.token;
  const invitationRequestInFlight = useRef(false);
  const [invitationStatus, setInvitationStatus] =
    useState<PatientInvitationStatus>(() => {
      if (capturedInvitation.token) return "waiting";
      return capturedInvitation.inviteRoute ? "unavailable" : "none";
    });

  const navigate = useCallback((nextRoute: PatientPortalRoute) => {
    const nextPath = patientPortalPath(nextRoute);

    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath);
    }

    setRoute(nextRoute);
  }, []);

  useEffect(() => {
    const updateRoute = () => setRoute(patientPortalRouteFromLocation());
    window.addEventListener("popstate", updateRoute);

    return () => window.removeEventListener("popstate", updateRoute);
  }, []);

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

    if (step.context.kind !== "onboarding") {
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
        navigate("home");

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
    invitationStatus,
    invitationToken,
    navigate,
    refreshSession,
    selectPatientPractice,
    step,
  ]);

  const prepareAppointmentRelationship = useCallback(
    async (relationship: PatientAppointmentRelationship) => {
      const changed = await selectPatientAppointmentOnboardingPractice(
        relationship.appointmentRelationshipId,
      );

      if (changed) navigate("appointment-request");
      return changed;
    },
    [navigate, selectPatientAppointmentOnboardingPractice],
  );

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

  if (step.audience !== "patient") return null;

  const selectedPractice =
    step.context.kind === "onboarding" ? null : step.context.practiceName;
  const hasAppointmentContext = step.context.kind !== "onboarding";

  return (
    <div className="min-h-[100dvh] bg-background">
      <PatientPortalHeader
        selectedPractice={selectedPractice}
        route={route}
        pending={contextChangePending}
        onNavigate={navigate}
        onSignOut={signOut}
      />

      {route === "home" ? (
        <PatientPortalHomePage
          username={step.username}
          context={step.context}
          availablePractices={step.availablePractices}
          appointmentOnboardingPractices={step.appointmentOnboardingPractices}
          invitationStatus={invitationStatus}
          contextChangePending={contextChangePending}
          contextChangeError={contextChangeError}
          onRetryInvitation={retryInvitation}
          onSelectPractice={selectPatientPractice}
          onSelectAppointmentOnboardingPractice={
            selectPatientAppointmentOnboardingPractice
          }
          onFindPractice={() => navigate("practices")}
          onViewAppointments={() => navigate("appointments")}
        />
      ) : route === "practices" ? (
        <PatientPracticeDiscoveryPage
          csrfToken={step.csrfToken}
          onSessionExpired={handleUnauthorized}
          onRelationshipReady={prepareAppointmentRelationship}
        />
      ) : !hasAppointmentContext || !selectedPractice ? (
        <PatientAppointmentAccessRequired
          onFindPractice={() => navigate("practices")}
          onReturnHome={() => navigate("home")}
        />
      ) : route === "appointments" ? (
        <PatientAppointmentsPage
          csrfToken={step.csrfToken}
          practiceName={selectedPractice}
          onRequestAppointment={() => navigate("appointment-request")}
          onSessionExpired={handleUnauthorized}
        />
      ) : (
        <PatientAppointmentRequestPage
          csrfToken={step.csrfToken}
          practiceName={selectedPractice}
          onBackToAppointments={() => navigate("appointments")}
          onSessionExpired={handleUnauthorized}
        />
      )}
    </div>
  );
}

function PatientAppointmentAccessRequired({
  onFindPractice,
  onReturnHome,
}: {
  onFindPractice: () => void;
  onReturnHome: () => void;
}) {
  return (
    <main className="mx-auto grid w-full max-w-3xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
      <section className="rounded-xl border bg-card p-6 sm:p-8">
        <p className="text-sm font-semibold text-primary">Appointments</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.025em]">
          Choose a practice first
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          Find a bookable practice, then continue with that practice before you
          review or request appointments.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button onClick={onFindPractice}>
            <MagnifyingGlassIcon aria-hidden="true" />
            Find a practice
          </Button>
          <Button variant="outline" onClick={onReturnHome}>
            Return home
          </Button>
        </div>
      </section>
    </main>
  );
}

function PatientPortalHeader({
  selectedPractice,
  route = "home",
  pending = false,
  onNavigate,
  onSignOut,
}: {
  selectedPractice?: string | null;
  route?: PatientPortalRoute;
  pending?: boolean;
  onNavigate?: (route: PatientPortalRoute) => void;
  onSignOut?: () => void;
}) {
  const patientHomePath = patientPortalPath("home");

  const navigateHome = () => {
    onNavigate?.("home");
  };

  return (
    <header className="border-b bg-card/95">
      <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:px-8">
        {onNavigate ? (
          <button
            className="flex min-w-0 items-center gap-3 rounded-lg text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            type="button"
            onClick={navigateHome}
          >
            <PatientPortalBrand selectedPractice={selectedPractice} />
          </button>
        ) : (
          <a
            href={patientHomePath}
            className="flex min-w-0 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <PatientPortalBrand selectedPractice={selectedPractice} />
          </a>
        )}

        {onNavigate && (
          <nav
            className="ms-auto flex min-w-0 items-center gap-1"
            aria-label="Patient portal"
          >
            <PatientHeaderNavigationButton
              active={route === "home"}
              icon={<HouseIcon aria-hidden="true" className="size-4" />}
              label="Home"
              onClick={() => onNavigate("home")}
            />
            <PatientHeaderNavigationButton
              active={route === "practices"}
              icon={
                <MagnifyingGlassIcon aria-hidden="true" className="size-4" />
              }
              label="Find a practice"
              onClick={() => onNavigate("practices")}
            />
            <PatientHeaderNavigationButton
              active={
                route === "appointments" || route === "appointment-request"
              }
              icon={<CalendarDotsIcon aria-hidden="true" className="size-4" />}
              label="Appointments"
              onClick={() => onNavigate("appointments")}
            />
          </nav>
        )}

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <ThemeToggle />
          {onSignOut && (
            <Button
              aria-label="Sign out"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={onSignOut}
            >
              <SignOutIcon aria-hidden="true" />
              <span className="hidden lg:inline">Sign out</span>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

function PatientPortalBrand({
  selectedPractice,
}: {
  selectedPractice?: string | null;
}) {
  return (
    <>
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
        <HeartbeatIcon aria-hidden="true" className="size-5" weight="bold" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">UAE Health</span>
        <span className="block max-w-24 truncate text-xs text-muted-foreground sm:max-w-40">
          {selectedPractice ?? "Patient portal"}
        </span>
      </span>
    </>
  );
}

function PatientHeaderNavigationButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-current={active ? "page" : undefined}
      aria-label={label}
      className="gap-1.5 px-2 text-xs sm:px-2.5 sm:text-sm"
      size="sm"
      type="button"
      variant={active ? "secondary" : "ghost"}
      onClick={onClick}
    >
      {icon}
      <span className="hidden xl:inline">{label}</span>
    </Button>
  );
}
