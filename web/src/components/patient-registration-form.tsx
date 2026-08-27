import { CheckCircleIcon, EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { type FormEvent, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PatientRegistrationInput } from "@/lib/patient-onboarding";

interface PatientRegistrationFormProps {
  onRegister: (
    input: PatientRegistrationInput,
    idempotencyKey: string,
  ) => Promise<void>;
  onReturnToSignIn: () => void;
}

type RegistrationStatus = "idle" | "submitting" | "success" | "error";

export function PatientRegistrationForm({
  onRegister,
  onReturnToSignIn,
}: PatientRegistrationFormProps) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<RegistrationStatus>("idle");
  const idempotencyKey = useRef<string | null>(null);

  const updateDisplayName = (value: string) => {
    setDisplayName(value);
    idempotencyKey.current = null;
    if (status === "error") setStatus("idle");
  };

  const updateEmail = (value: string) => {
    setEmail(value);
    idempotencyKey.current = null;
    if (status === "error") setStatus("idle");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status === "submitting") return;

    const key = idempotencyKey.current ?? globalThis.crypto.randomUUID();
    idempotencyKey.current = key;
    setStatus("submitting");

    try {
      await onRegister(
        { displayName: displayName.trim(), email: email.trim() },
        key,
      );
      setStatus("success");
    } catch {
      setStatus("error");
    }
  };

  if (status === "success") {
    return (
      <div className="mt-6 grid gap-5">
        <div
          className="rounded-lg border border-success/30 bg-success/10 p-4"
          role="status"
        >
          <CheckCircleIcon
            aria-hidden="true"
            className="size-5 text-success"
            weight="fill"
          />
          <p className="mt-3 font-medium text-foreground">Check your email</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Check your email for a temporary password, then return here to sign
            in and choose a new password. For privacy, this confirmation does
            not reveal whether an account already existed.
          </p>
        </div>
        <Button type="button" onClick={onReturnToSignIn}>
          Return to sign in
        </Button>
      </div>
    );
  }

  return (
    <form className="mt-6 grid gap-5" onSubmit={submit}>
      <p className="text-sm leading-6 text-muted-foreground">
        Enter your name and email. UAE Health will send a temporary password if
        registration can proceed. You will choose your own password when you
        first sign in.
      </p>
      <div className="grid gap-2">
        <Label htmlFor="patient-registration-name">Full name</Label>
        <Input
          id="patient-registration-name"
          name="displayName"
          autoComplete="name"
          minLength={2}
          maxLength={200}
          required
          disabled={status === "submitting"}
          value={displayName}
          onChange={(event) => updateDisplayName(event.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="patient-registration-email">Email address</Label>
        <Input
          id="patient-registration-email"
          name="email"
          type="email"
          autoComplete="email"
          maxLength={320}
          required
          disabled={status === "submitting"}
          value={email}
          onChange={(event) => updateEmail(event.target.value)}
        />
      </div>
      {status === "error" && (
        <p
          className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          Registration could not be submitted. Please try again.
        </p>
      )}
      <Button type="submit" disabled={status === "submitting"}>
        <EnvelopeSimpleIcon aria-hidden="true" />
        {status === "submitting" ? "Submitting…" : "Send temporary password"}
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={status === "submitting"}
        onClick={onReturnToSignIn}
      >
        Back to sign in
      </Button>
    </form>
  );
}
