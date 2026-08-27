import {
  BuildingsIcon,
  HeartbeatIcon,
  KeyIcon,
  LockKeyIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

import { PatientRegistrationForm } from "@/components/patient-registration-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SessionStep } from "@/lib/cognito-session";
import type { PatientRegistrationInput } from "@/lib/patient-onboarding";

interface PatientAuthGateProps {
  configured: boolean;
  step: SessionStep;
  onSignIn: (email: string, password: string) => void;
  onCompleteNewPassword: (password: string) => void;
  onVerifyTotpSetup: (code: string) => void;
  onSubmitTotp: (code: string) => void;
  onReset: () => void;
  onRegister: (
    input: PatientRegistrationInput,
    idempotencyKey: string,
  ) => Promise<void>;
  invitationPending: boolean;
  invitationUnavailable: boolean;
}

export function PatientAuthGate({
  configured,
  step,
  onSignIn,
  onCompleteNewPassword,
  onVerifyTotpSetup,
  onSubmitTotp,
  onReset,
  onRegister,
  invitationPending,
  invitationUnavailable,
}: PatientAuthGateProps) {
  const [view, setView] = useState<"sign-in" | "registration">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmationPassword, setConfirmationPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const showingRegistration =
    view === "registration" &&
    (step.kind === "signed-out" || step.kind === "error");
  const totpUri =
    step.kind === "totp-setup"
      ? `otpauth://totp/${encodeURIComponent("UAE Health patient portal")}:${encodeURIComponent(step.username)}?secret=${encodeURIComponent(step.secret)}&issuer=${encodeURIComponent("UAE Health patient portal")}&algorithm=SHA1&digits=6&period=30`
      : null;

  const returnToSignIn = () => {
    setView("sign-in");
    if (step.kind === "error") onReset();
  };

  const submitSignIn = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    onSignIn(email, password);
  };

  const submitNewPassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (newPassword !== confirmationPassword) {
      setFormError("The password confirmation does not match.");
      return;
    }

    setFormError(null);
    onCompleteNewPassword(newPassword);
  };

  const submitTotp = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = totp.replace(/\s/g, "");

    if (!/^\d{6}$/.test(normalized)) {
      setFormError("Enter the six-digit code from your authenticator app.");
      return;
    }

    setFormError(null);
    if (step.kind === "totp-setup") onVerifyTotpSetup(normalized);
    else onSubmitTotp(normalized);
  };

  const title = showingRegistration
    ? "Create your patient account"
    : step.kind === "new-password"
      ? "Create your personal password"
      : step.kind === "totp-setup"
        ? "Set up account protection"
        : step.kind === "totp-challenge"
          ? "Verify your identity"
          : "Sign in to your portal";

  return (
    <main
      id="patient-account"
      className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-5xl items-center px-4 py-10 sm:px-6 lg:px-8"
    >
      <div className="mx-auto w-full max-w-xl">
        <section className="text-center" aria-labelledby="patient-access-title">
          <span className="mx-auto grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground shadow-[0_12px_28px_rgba(30,73,79,0.18)]">
            <HeartbeatIcon aria-hidden="true" className="size-6" weight="bold" />
          </span>
          <p className="mt-5 text-sm font-semibold text-primary">
            UAE Health patient portal
          </p>
          <h1
            id="patient-access-title"
            className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl"
          >
            Manage your patient portal access.
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-base leading-7 text-muted-foreground">
            Sign in with your patient account, then choose the practice you
            want to use.
          </p>
        </section>

        <section
          className="mt-8 rounded-2xl border bg-card p-5 shadow-[0_16px_48px_rgba(30,73,79,0.1)] sm:p-7"
          aria-labelledby="patient-authentication-title"
        >
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground">
              <LockKeyIcon aria-hidden="true" className="size-5" weight="bold" />
            </span>
            <div>
              <h2 id="patient-authentication-title" className="text-xl font-semibold">
                {title}
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {showingRegistration
                  ? "Set up a personal sign-in without connecting to a practice record."
                  : "Your patient sign-in is separate from workforce access."}
              </p>
            </div>
          </div>

          {!configured && !showingRegistration && (
            <p
              className="mt-5 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm leading-6 text-warning-foreground"
              role="alert"
            >
              Patient portal sign-in is not configured yet. Please try again
              later.
            </p>
          )}

          {step.kind === "error" && !showingRegistration && (
            <div
              className="mt-5 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
              role="alert"
            >
              <p>{step.message}</p>
              <Button
                className="mt-3"
                size="sm"
                variant="outline"
                onClick={onReset}
              >
                Try again
              </Button>
            </div>
          )}

          {step.kind === "submitting" && (
            <p className="mt-6 text-sm text-muted-foreground" role="status">
              {step.message}
            </p>
          )}

          {invitationPending && (
            <div className="mt-5 flex items-start gap-3 rounded-lg bg-secondary p-4 text-sm leading-6 text-secondary-foreground">
              <BuildingsIcon
                aria-hidden="true"
                className="mt-0.5 size-5 shrink-0 text-primary"
                weight="bold"
              />
              <p>
                Sign in to review this practice invitation. You can create a
                patient account first if you do not have one.
              </p>
            </div>
          )}

          {invitationUnavailable && (
            <p
              className="mt-5 rounded-lg bg-muted p-4 text-sm leading-6 text-muted-foreground"
              role="alert"
            >
              This invitation cannot be used. Ask the practice for a new link,
              or continue to sign in without it.
            </p>
          )}

          {(step.kind === "signed-out" || step.kind === "error") &&
            (showingRegistration ? (
              <PatientRegistrationForm
                onRegister={onRegister}
                onReturnToSignIn={returnToSignIn}
              />
            ) : (
              <>
                <form className="mt-6 grid gap-5" onSubmit={submitSignIn}>
                  <div className="grid gap-2">
                    <Label htmlFor="patient-email">Email address</Label>
                    <Input
                      id="patient-email"
                      name="email"
                      type="email"
                      autoComplete="username"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="patient-password">Password</Label>
                    <Input
                      id="patient-password"
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </div>
                  <Button disabled={!configured} type="submit">
                    Sign in
                  </Button>
                </form>

                <div className="mt-6 border-t pt-5 text-center">
                  <p className="text-sm text-muted-foreground">
                    New to the patient portal?
                  </p>
                  <Button
                    className="mt-1"
                    type="button"
                    variant="link"
                    onClick={() => setView("registration")}
                  >
                    Create a patient account
                  </Button>
                </div>
              </>
            ))}

          {step.kind === "new-password" && (
            <form className="mt-6 grid gap-5" onSubmit={submitNewPassword}>
              <p className="text-sm leading-6 text-muted-foreground">
                Replace the temporary password from your email before you can
                continue.
              </p>
              <div className="grid gap-2">
                <Label htmlFor="patient-new-password">New password</Label>
                <Input
                  id="patient-new-password"
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  minLength={14}
                  required
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Use at least 14 characters, including uppercase, lowercase,
                  a number, and a symbol.
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="patient-confirm-password">
                  Confirm new password
                </Label>
                <Input
                  id="patient-confirm-password"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  minLength={14}
                  required
                  value={confirmationPassword}
                  onChange={(event) =>
                    setConfirmationPassword(event.target.value)
                  }
                />
              </div>
              <Button type="submit">Set password</Button>
            </form>
          )}

          {step.kind === "totp-setup" && (
            <form className="mt-6 grid gap-5" onSubmit={submitTotp}>
              <p className="text-sm leading-6 text-muted-foreground">
                Scan this QR code with an authenticator app, then enter the
                code it creates to protect your account.
              </p>
              <div className="mx-auto rounded-xl border bg-white p-4 text-[#10272c] shadow-sm">
                <QRCodeSVG
                  value={totpUri ?? ""}
                  size={184}
                  level="M"
                  bgColor="#ffffff"
                  fgColor="#10272c"
                  title="Patient portal authenticator setup QR code"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="patient-setup-code">Six-digit code</Label>
                <Input
                  id="patient-setup-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  value={totp}
                  onChange={(event) => setTotp(event.target.value)}
                />
              </div>
              <Button type="submit">Verify account protection</Button>
            </form>
          )}

          {step.kind === "totp-challenge" && (
            <form className="mt-6 grid gap-5" onSubmit={submitTotp}>
              <p className="text-sm leading-6 text-muted-foreground">
                Enter the current code from your authenticator app.
              </p>
              <div className="grid gap-2">
                <Label htmlFor="patient-sign-in-code">Six-digit code</Label>
                <Input
                  id="patient-sign-in-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  value={totp}
                  onChange={(event) => setTotp(event.target.value)}
                />
              </div>
              <Button type="submit">Verify and sign in</Button>
            </form>
          )}

          {formError && (
            <p className="mt-5 text-sm text-destructive" role="alert">
              {formError}
            </p>
          )}
        </section>

        <section
          className="mt-6 grid gap-4 border-t pt-6 text-sm text-muted-foreground sm:grid-cols-2"
          aria-label="Patient access safeguards"
        >
          <div className="flex items-start gap-3">
            <ShieldCheckIcon
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-primary"
              weight="bold"
            />
            <p>
              Your patient account stays separate from workforce access.
            </p>
          </div>
          <div className="flex items-start gap-3">
            <KeyIcon
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-primary"
              weight="bold"
            />
            <p>You choose one linked practice when you are ready to use it.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
