import { CheckCircleIcon, KeyIcon, LockKeyIcon } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SessionStep } from "@/lib/cognito-session";

interface SignInPanelProps {
  audience?: "workforce" | "patient";
  configured: boolean;
  step: SessionStep;
  onSignIn: (email: string, password: string) => void;
  onCompleteNewPassword: (password: string) => void;
  onVerifyTotpSetup: (code: string) => void;
  onSubmitTotp: (code: string) => void;
  onReset: () => void;
}

export function SignInPanel({
  audience = "workforce",
  configured,
  step,
  onSignIn,
  onCompleteNewPassword,
  onVerifyTotpSetup,
  onSubmitTotp,
  onReset,
}: SignInPanelProps) {
  const isPatientPortal = audience === "patient";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmationPassword, setConfirmationPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const totpUri =
    step.kind === "totp-setup"
      ? `otpauth://totp/${encodeURIComponent("UAE Health")}:${encodeURIComponent(step.username)}?secret=${encodeURIComponent(step.secret)}&issuer=${encodeURIComponent("UAE Health")}&algorithm=SHA1&digits=6&period=30`
      : null;

  const submitSignIn = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    onSignIn(email, password);
  };

  const submitNewPassword = (event: FormEvent) => {
    event.preventDefault();

    if (newPassword !== confirmationPassword) {
      setFormError("The password confirmation does not match.");
      return;
    }

    setFormError(null);
    onCompleteNewPassword(newPassword);
  };

  const submitTotp = (event: FormEvent) => {
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

  return (
    <main className="mx-auto grid min-h-[calc(100dvh-4rem)] w-full max-w-6xl items-center gap-10 px-4 py-10 lg:grid-cols-[minmax(0,1fr)_26rem] lg:px-8">
      <section className="max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">
          {isPatientPortal ? "Patient portal" : "Workforce access"}
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-balance sm:text-5xl">
          {isPatientPortal
            ? "A secure place to manage your appointments."
            : "Secure access for every practice you serve."}
        </h1>
        <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
          {isPatientPortal
            ? "Sign in with your patient portal email. Choose one practice context after identity verification."
            : "Sign in with your real work email. Practice access, roles, and approval limits are evaluated by UAE Health after identity verification."}
        </p>
        <div className="mt-8 grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
          <span className="flex items-center gap-2">
            <CheckCircleIcon className="size-5 text-success" /> {isPatientPortal
              ? "Separate patient access"
              : "No public sign-up"}
          </span>
          <span className="flex items-center gap-2">
            <LockKeyIcon className="size-5 text-primary" /> {isPatientPortal
              ? "One practice at a time"
              : "TOTP required"}
          </span>
          <span className="flex items-center gap-2">
            <KeyIcon className="size-5 text-info" /> {isPatientPortal
              ? "No clinical records"
              : "30-minute idle timeout"}
          </span>
        </div>
      </section>

      <section
        className="rounded-2xl border bg-card p-6 shadow-[0_20px_60px_rgba(30,73,79,0.12)] sm:p-7"
        aria-labelledby="sign-in-title"
      >
        <h2 id="sign-in-title" className="text-xl font-semibold">
          {step.kind === "new-password"
            ? "Choose a new password"
            : step.kind === "totp-setup"
              ? "Set up your authenticator"
              : step.kind === "totp-challenge"
                ? "Enter authenticator code"
                : "Sign in"}
        </h2>

        {!configured && (
          <p className="mt-4 rounded-md bg-warning-soft p-3 text-sm text-warning">
            {isPatientPortal
              ? "Patient portal identity configuration is missing from the web environment."
              : "Workforce identity configuration is missing from the web environment."}
          </p>
        )}

        {step.kind === "error" && (
          <div
            className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
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
          <p className="mt-5 text-sm text-muted-foreground" role="status">
            {step.message}
          </p>
        )}

        {(step.kind === "signed-out" || step.kind === "error") && (
          <form className="mt-6 grid gap-5" onSubmit={submitSignIn}>
            <div className="grid gap-2">
              <Label htmlFor="email">
                {isPatientPortal ? "Email address" : "Work email"}
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <Button disabled={!configured} type="submit">
              Continue securely
            </Button>
          </form>
        )}

        {step.kind === "new-password" && (
          <form className="mt-6 grid gap-5" onSubmit={submitNewPassword}>
            <p className="text-sm leading-6 text-muted-foreground">
              Your temporary password must be replaced before access is granted.
            </p>
            <div className="grid gap-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                minLength={14}
                required
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                At least 14 characters with uppercase, lowercase, number, and
                symbol.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
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
              Scan this QR code with Google Authenticator, Microsoft
              Authenticator, or another compatible app. Then enter the generated
              code.
            </p>
            <div className="mx-auto rounded-xl border bg-white p-4 text-[#10272c] shadow-sm">
              <QRCodeSVG
                value={totpUri ?? ""}
                size={184}
                level="M"
                bgColor="#ffffff"
                fgColor="#10272c"
                title="UAE Health authenticator setup QR code"
              />
            </div>
            <p className="text-center text-xs text-muted-foreground">
              Cannot scan it? Enter the setup key manually.
            </p>
            <div
              className="rounded-md bg-muted p-4 font-mono text-sm break-all"
              aria-label="Authenticator setup key"
            >
              {step.secret}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="setup-code">Six-digit code</Label>
              <Input
                id="setup-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                value={totp}
                onChange={(event) => setTotp(event.target.value)}
              />
            </div>
            <Button type="submit">Verify authenticator</Button>
          </form>
        )}

        {step.kind === "totp-challenge" && (
          <form className="mt-6 grid gap-5" onSubmit={submitTotp}>
            <p className="text-sm leading-6 text-muted-foreground">
              Enter the current code from your authenticator app.
            </p>
            <div className="grid gap-2">
              <Label htmlFor="sign-in-code">Six-digit code</Label>
              <Input
                id="sign-in-code"
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
          <p className="mt-4 text-sm text-destructive" role="alert">
            {formError}
          </p>
        )}
      </section>
    </main>
  );
}
