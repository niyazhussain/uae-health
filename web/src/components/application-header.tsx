import {
  HeartbeatIcon,
  ListIcon,
  SignOutIcon,
  UserCircleIcon,
  XIcon,
} from "@phosphor-icons/react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

export interface ApplicationPracticeContext {
  organizationName: string;
  tenantName: string;
}

export type MainModuleId =
  | "dashboard"
  | "patients"
  | "scheduling"
  | "clinical"
  | "operations"
  | "revenue"
  | "administration";

export interface NavigationPage {
  id: string;
  label: string;
  path: string;
  implemented?: boolean;
}

export interface MainModule {
  id: MainModuleId;
  label: string;
  pages: NavigationPage[];
}

export interface ApplicationRoute {
  module: MainModule;
  page: NavigationPage;
}

interface ApplicationHeaderProps {
  modules: MainModule[];
  route: ApplicationRoute;
  currentContext?: ApplicationPracticeContext;
  username: string;
  isNavigating: boolean;
  navigationOpen: boolean;
  onNavigationOpenChange: (isOpen: boolean) => void;
  onNavigate: (module: MainModule, page: NavigationPage) => void;
  onSignOut: () => void;
}

export function ApplicationHeader({
  modules,
  route,
  currentContext,
  username,
  isNavigating,
  navigationOpen,
  onNavigationOpenChange,
  onNavigate,
  onSignOut,
}: ApplicationHeaderProps) {
  const navigateToModule = (module: MainModule) =>
    onNavigate(module, module.pages[0]);

  return (
    <>
      {navigationOpen && (
        <MobileNavigation
          modules={modules}
          activeModule={route.module}
          onClose={() => onNavigationOpenChange(false)}
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
            onClick={() => onNavigationOpenChange(true)}
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
            modules={modules}
            activeModule={route.module}
            onNavigate={navigateToModule}
          />
          <div className="ms-auto flex items-center gap-2">
            <ThemeToggle />
            <span className="hidden items-center gap-2 text-sm text-muted-foreground 2xl:flex">
              <UserCircleIcon className="size-5" />
              {username}
            </span>
            <Button size="sm" variant="outline" onClick={onSignOut}>
              <SignOutIcon />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
        <SubNavigation route={route} onNavigate={onNavigate} />
        {isNavigating && <NavigationLoader label={route.page.label} />}
      </header>
    </>
  );
}

function MainNavigation({
  modules,
  activeModule,
  onNavigate,
}: {
  modules: MainModule[];
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
  modules,
  activeModule,
  onClose,
  onNavigate,
}: {
  modules: MainModule[];
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
