import {
  HeartbeatIcon,
  ListIcon,
  SignOutIcon,
  UserCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";

import { SignInPanel } from "@/components/sign-in-panel";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { useCognitoSession } from "@/lib/cognito-session";
import type { WorkforceDirectoryContext } from "@/lib/workforce-directory";

const WorkforceDirectory = lazy(async () => {
  const module = await import("@/components/workforce-directory");
  return { default: module.WorkforceDirectory };
});

const WorkforceRoleCatalogue = lazy(async () => {
  const module = await import("@/components/workforce-role-catalogue");
  return { default: module.WorkforceRoleCatalogue };
});

type MainModuleId =
  | "dashboard"
  | "patients"
  | "scheduling"
  | "clinical"
  | "operations"
  | "revenue"
  | "administration";

interface NavigationPage {
  id: string;
  label: string;
  path: string;
  implemented?: boolean;
}

interface MainModule {
  id: MainModuleId;
  label: string;
  pages: NavigationPage[];
}

interface ApplicationRoute {
  module: MainModule;
  page: NavigationPage;
}

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

  const navigateToModule = useCallback(
    (module: MainModule) => navigate(module, module.pages[0]),
    [navigate],
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
      {navigationOpen && (
        <MobileNavigation
          activeModule={route.module}
          onClose={() => setNavigationOpen(false)}
          onNavigate={navigateToModule}
        />
      )}
      <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
        <div className="flex min-h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="lg:hidden"
            onClick={() => setNavigationOpen(true)}
            aria-label="Open main navigation"
          >
            <ListIcon />
          </Button>
          <div className="min-w-0 shrink-0">
            <p className="truncate text-sm font-semibold">UAE Health</p>
            <p className="max-w-44 truncate text-xs text-muted-foreground xl:max-w-56">
              {currentContext
                ? `${currentContext.organizationName} · ${currentContext.tenantName}`
                : "Current practice not selected"}
            </p>
          </div>
          <MainNavigation
            activeModule={route.module}
            onNavigate={navigateToModule}
          />
          <div className="ms-auto flex items-center gap-2">
            <ThemeToggle />
            <span className="hidden items-center gap-2 text-sm text-muted-foreground 2xl:flex">
              <UserCircleIcon className="size-5" />
              {session.step.username}
            </span>
            <Button size="sm" variant="outline" onClick={signOut}>
              <SignOutIcon />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
        <SubNavigation route={route} onNavigate={navigate} />
        {isNavigating && <NavigationLoader label={route.page.label} />}
      </header>

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

function MainNavigation({
  activeModule,
  onNavigate,
}: {
  activeModule: MainModule;
  onNavigate: (module: MainModule) => void;
}) {
  return (
    <nav
      className="hidden min-w-0 items-center gap-0.5 overflow-x-auto lg:flex"
      aria-label="Main navigation"
    >
      {modules.map((module) => {
        const active = module.id === activeModule.id;

        return (
          <button
            key={module.id}
            type="button"
            className={`min-h-9 shrink-0 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:px-3 xl:text-sm ${
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
            aria-current={active ? "page" : undefined}
            onClick={() => onNavigate(module)}
          >
            {module.label}
          </button>
        );
      })}
    </nav>
  );
}

function SubNavigation({
  route,
  onNavigate,
}: {
  route: ApplicationRoute;
  onNavigate: (module: MainModule, page: NavigationPage) => void;
}) {
  return (
    <div className="border-t bg-background/70">
      <nav
        className="mx-auto flex w-full max-w-7xl items-center gap-1 overflow-x-auto px-4 py-2 sm:px-6 lg:px-8"
        aria-label={`${route.module.label} navigation`}
      >
        <span className="me-2 shrink-0 text-xs font-medium text-muted-foreground">
          {route.module.label}
        </span>
        {route.module.pages.map((page) => {
          const active = page.id === route.page.id;

          return (
            <button
              key={page.id}
              type="button"
              className={`min-h-8 shrink-0 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                active
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              aria-current={active ? "page" : undefined}
              onClick={() => onNavigate(route.module, page)}
            >
              {page.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function NavigationLoader({ label }: { label: string }) {
  return (
    <div className="h-1 overflow-hidden bg-primary/15" role="status">
      <div className="h-full w-1/2 animate-pulse bg-primary" />
      <span className="sr-only">Loading {label}</span>
    </div>
  );
}

function MobileNavigation({
  activeModule,
  onClose,
  onNavigate,
}: {
  activeModule: MainModule;
  onClose: () => void;
  onNavigate: (module: MainModule) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button
        type="button"
        className="absolute inset-0 bg-foreground/20"
        aria-label="Close main navigation"
        onClick={onClose}
      />
      <aside className="relative flex h-full w-80 flex-col border-e bg-card p-3 shadow-xl">
        <div className="flex min-h-10 items-center justify-between gap-3 px-2">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-md bg-primary text-primary-foreground">
              <HeartbeatIcon aria-hidden="true" className="size-5" weight="bold" />
            </span>
            <span className="text-sm font-semibold">UAE Health</span>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onClose}
            aria-label="Close main navigation"
          >
            <XIcon />
          </Button>
        </div>
        <nav className="mt-8 grid gap-1" aria-label="Main navigation">
          {modules.map((module) => {
            const active = module.id === activeModule.id;

            return (
              <button
                key={module.id}
                type="button"
                className={`flex min-h-11 items-center rounded-lg px-3 text-start text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                aria-current={active ? "page" : undefined}
                onClick={() => onNavigate(module)}
              >
                {module.label}
              </button>
            );
          })}
        </nav>
      </aside>
    </div>
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
