import {
  HeartbeatIcon,
  SignOutIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";
import { SignInPanel } from "@/components/sign-in-panel";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { WorkforceDirectory } from "@/components/workforce-directory";
import { useCognitoSession } from "@/lib/cognito-session";

function App() {
  const session = useCognitoSession();

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="border-b bg-card/95">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
              <HeartbeatIcon
                aria-hidden="true"
                className="size-5"
                weight="bold"
              />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">UAE Health</p>
              <p className="truncate text-xs text-muted-foreground">
                Workforce administration · Staging
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {session.step.kind === "signed-in" && (
              <>
                <span className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex">
                  <UserCircleIcon className="size-5" />
                  {session.step.username}
                </span>
                <Button size="sm" variant="outline" onClick={session.signOut}>
                  <SignOutIcon />
                  Sign out
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {session.step.kind === "signed-in" ? (
        <WorkforceDirectory onSessionExpired={session.handleUnauthorized} />
      ) : (
        <SignInPanel
          configured={session.configured}
          step={session.step}
          onSignIn={session.signIn}
          onCompleteNewPassword={session.completeNewPassword}
          onVerifyTotpSetup={session.verifyTotpSetup}
          onSubmitTotp={session.submitTotp}
          onReset={session.signOut}
        />
      )}
    </div>
  );
}

export default App;
