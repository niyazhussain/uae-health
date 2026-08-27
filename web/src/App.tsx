import { HeartbeatIcon } from "@phosphor-icons/react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";

import {
  ApplicationHeader,
  type ApplicationRoute,
  type MainModule,
  type NavigationPage,
} from "@/components/application-header";
import { SignInPanel } from "@/components/sign-in-panel";
import { useCognitoSession } from "@/lib/cognito-session";
import type { WorkforceDirectoryContext } from "@/lib/workforce-directory";

const WorkforceDirectory = lazy(async () => {
  const module = await import("@/pages/administration/workforce/page");
  return { default: module.WorkforceDirectory };
});

const WorkforceRoleCatalogue = lazy(async () => {
  const module = await import("@/pages/administration/roles/page");
  return { default: module.WorkforceRoleCatalogue };
});


const modules: MainModule[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    pages: [{ id: "overview", label: "Overview", path: "/dashboard" }],
  },
  {
    id: "patients",
    label: "Patients",
    pages: [
      { id: "directory", label: "Directory", path: "/patients" },
      { id: "registration", label: "Registration", path: "/patients/register" },
    ],
  },
  {
    id: "scheduling",
    label: "Scheduling",
    pages: [
      { id: "appointments", label: "Appointments", path: "/scheduling" },
      { id: "calendar", label: "Calendar", path: "/scheduling/calendar" },
    ],
  },
  {
    id: "clinical",
    label: "Clinical",
    pages: [
      { id: "encounters", label: "Encounters", path: "/clinical" },
      { id: "documentation", label: "Documentation", path: "/clinical/documentation" },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    pages: [
      { id: "admissions", label: "Admissions", path: "/operations" },
      { id: "facilities", label: "Facilities", path: "/operations/facilities" },
    ],
  },
  {
    id: "revenue",
    label: "Revenue",
    pages: [
      { id: "billing", label: "Billing", path: "/revenue" },
      { id: "insurance", label: "Insurance", path: "/revenue/insurance" },
    ],
  },
  {
    id: "administration",
    label: "Administration",
    pages: [
      { id: "workforce", label: "Workforce", path: "/", implemented: true },
      { id: "roles", label: "Roles & permissions", path: "/roles", implemented: true },
    ],
  },
];

function routeFromLocation(): ApplicationRoute {
  const currentPath = window.location.pathname.replace(/\/$/, "") || "/";

  for (const module of modules) {
    const page = module.pages.find((candidate) => candidate.path === currentPath);
    if (page) return { module, page };
  }

  const administration = modules.find(
    (module) => module.id === "administration",
  )!;

  return { module: administration, page: administration.pages[0] };
}

function App() {
  const session = useCognitoSession();
  const [route, setRoute] = useState<ApplicationRoute>(routeFromLocation);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string>();
  const [currentContext, setCurrentContext] =
    useState<WorkforceDirectoryContext>();

  useEffect(() => {
    const updateRoute = () => setRoute(routeFromLocation());
    window.addEventListener("popstate", updateRoute);

    return () => window.removeEventListener("popstate", updateRoute);
  }, []);

  const navigate = useCallback(
    (module: MainModule, page: NavigationPage) => {
      if (route.module.id === module.id && route.page.id === page.id) return;

      if (window.location.pathname !== page.path) {
        window.history.pushState({}, "", page.path);
      }

      setIsNavigating(true);
      setRoute({ module, page });
      setNavigationOpen(false);
    },
    [route.module.id, route.page.id],
  );

  const updateOrganization = useCallback((organizationId: string) => {
    setSelectedOrganizationId(organizationId);
  }, []);

  const updateContext = useCallback((context: WorkforceDirectoryContext) => {
    setCurrentContext(context);
  }, []);

  const finishNavigation = useCallback(() => {
    setIsNavigating(false);
  }, []);

  const signOut = useCallback(() => {
    setCurrentContext(undefined);
    setSelectedOrganizationId(undefined);
    session.signOut();
  }, [session]);

  if (session.step.kind !== "signed-in") {
    return (
      <div className="min-h-[100dvh] bg-background">
        <UnauthenticatedHeader />
        <SignInPanel
          configured={session.configured}
          step={session.step}
          onSignIn={session.signIn}
          onCompleteNewPassword={session.completeNewPassword}
          onVerifyTotpSetup={session.verifyTotpSetup}
          onSubmitTotp={session.submitTotp}
          onReset={signOut}
        />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      <ApplicationHeader
        modules={modules}
        route={route}
        currentContext={currentContext}
        username={session.step.username}
        isNavigating={isNavigating}
        navigationOpen={navigationOpen}
        onNavigationOpenChange={setNavigationOpen}
        onNavigate={navigate}
        onSignOut={signOut}
      />

      <Suspense
        fallback={
          <main
            className="mx-auto w-full max-w-7xl px-4 py-10 text-sm text-muted-foreground sm:px-6 lg:px-8"
            role="status"
          >
            Loading application…
          </main>
        }
      >
        {route.page.implemented && route.page.id === "roles" ? (
          <WorkforceRoleCatalogue
            selectedOrganizationId={selectedOrganizationId}
            onSelectedOrganizationChange={updateOrganization}
            onContextChange={updateContext}
            onPageReady={finishNavigation}
            onSessionExpired={session.handleUnauthorized}
          />
        ) : route.page.implemented && route.page.id === "workforce" ? (
          <WorkforceDirectory
            csrfToken={session.step.csrfToken}
            selectedOrganizationId={selectedOrganizationId}
            onSelectedOrganizationChange={updateOrganization}
            onContextChange={updateContext}
            onPageReady={finishNavigation}
            onSessionExpired={session.handleUnauthorized}
          />
        ) : (
          <UnavailableModule route={route} onPageReady={finishNavigation} />
        )}
      </Suspense>
    </div>
  );
}

function UnauthenticatedHeader() {
  return (
    <header className="border-b bg-card/95">
      <div className="mx-auto flex min-h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <span className="grid size-10 place-items-center rounded-md bg-primary text-primary-foreground">
          <HeartbeatIcon aria-hidden="true" className="size-5" weight="bold" />
        </span>
        <div>
          <p className="text-sm font-semibold">UAE Health</p>
          <p className="text-xs text-muted-foreground">Workforce administration</p>
        </div>
      </div>
    </header>
  );
}

function UnavailableModule({
  route,
  onPageReady,
}: {
  route: ApplicationRoute;
  onPageReady: () => void;
}) {
  useEffect(() => {
    const completionTimer = window.setTimeout(onPageReady, 200);

    return () => window.clearTimeout(completionTimer);
  }, [onPageReady, route.page.id]);

  return (
    <main className="mx-auto grid w-full max-w-7xl place-items-center px-4 py-16 sm:px-6 lg:px-8">
      <section className="w-full max-w-xl rounded-xl border bg-card p-6 shadow-[0_12px_35px_rgba(30,73,79,0.06)] sm:p-8">
        <p className="text-sm font-medium text-primary">Planned module</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.025em]">
          {route.page.label}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {route.module.label} is part of the approved application structure,
          but this capability has not been released yet.
        </p>
        <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          No clinical, patient, operational, or financial data was requested or
          displayed.
        </p>
      </section>
    </main>
  );
}

export default App;
