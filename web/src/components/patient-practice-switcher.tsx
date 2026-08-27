import {
  BuildingsIcon,
  CheckCircleIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  PatientPracticeChoice,
  PatientSessionContext,
} from "@/lib/cognito-session";

interface PatientPracticeSwitcherProps {
  availablePractices: PatientPracticeChoice[];
  context: PatientSessionContext;
  pending: boolean;
  error: string | null;
  onSelectPractice: (portalProfileId: string | null) => Promise<boolean>;
}

export function PatientPracticeSwitcher({
  availablePractices,
  context,
  pending,
  error,
  onSelectPractice,
}: PatientPracticeSwitcherProps) {
  const currentPortalProfileId =
    context.kind === "practice" ? context.portalProfileId : undefined;
  const [selectedPortalProfileId, setSelectedPortalProfileId] = useState<
    string | undefined
  >(currentPortalProfileId);
  const useNamedChoices = availablePractices.length <= 5;
  const selectionChanged =
    selectedPortalProfileId !== undefined &&
    selectedPortalProfileId !== currentPortalProfileId;

  return (
    <section
      className="rounded-xl border bg-card p-5 sm:p-6"
      aria-labelledby="practice-context-title"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground">
          <BuildingsIcon aria-hidden="true" className="size-5" weight="bold" />
        </span>
        <div>
          <h3 id="practice-context-title" className="text-lg font-semibold">
            {context.kind === "onboarding"
              ? "Choose a practice"
              : "Choose a different practice"}
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            You will use only the practice you select. Your other practice
            relationships stay separate.
          </p>
        </div>
      </div>

      {useNamedChoices ? (
        <div className="mt-5 grid gap-3" aria-label="Linked practices">
          {availablePractices.map((practice) => {
            const selected = practice.portalProfileId === selectedPortalProfileId;
            const current = practice.portalProfileId === currentPortalProfileId;

            return (
              <button
                key={practice.portalProfileId}
                className={`flex w-full items-center gap-3 rounded-xl border p-4 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  selected
                    ? "border-primary bg-secondary"
                    : "border-border bg-background hover:bg-muted"
                }`}
                type="button"
                aria-pressed={selected}
                disabled={pending}
                onClick={() => setSelectedPortalProfileId(practice.portalProfileId)}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-card text-primary shadow-sm">
                  <BuildingsIcon aria-hidden="true" className="size-4" weight="bold" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-foreground">
                    {practice.practiceName}
                  </span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">
                    {current ? "Current practice" : "Linked practice"}
                  </span>
                </span>
                {selected && (
                  <CheckCircleIcon
                    aria-label="Selected"
                    className="size-5 shrink-0 text-primary"
                    weight="fill"
                  />
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mt-5 grid gap-2">
          <Label htmlFor="patient-practice">Linked practice</Label>
          <Select
            value={selectedPortalProfileId}
            onValueChange={setSelectedPortalProfileId}
            disabled={pending}
          >
            <SelectTrigger id="patient-practice" className="min-h-11">
              <SelectValue placeholder="Select a linked practice" />
            </SelectTrigger>
            <SelectContent position="popper">
              {availablePractices.map((practice) => (
                <SelectItem
                  key={practice.portalProfileId}
                  value={practice.portalProfileId}
                >
                  {practice.practiceName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="mt-5 flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2 text-sm leading-6 text-muted-foreground">
          <ShieldCheckIcon
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-primary"
            weight="bold"
          />
          Your choice is confirmed by UAE Health before this practice becomes
          active.
        </p>
        <Button
          className="self-start whitespace-nowrap"
          disabled={!selectionChanged || pending}
          onClick={() => {
            if (selectedPortalProfileId) {
              void onSelectPractice(selectedPortalProfileId);
            }
          }}
        >
          {pending
            ? "Updating access…"
            : context.kind === "onboarding"
              ? "Use this practice"
              : "Use selected practice"}
        </Button>
      </div>

      {context.kind !== "onboarding" && (
        <div className="mt-5 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-6 text-muted-foreground">
            Return to your account without a practice selected.
          </p>
          <Button
            className="self-start whitespace-nowrap"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => void onSelectPractice(null)}
          >
            Return to account access
          </Button>
        </div>
      )}

      {error && (
        <p
          className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}
    </section>
  );
}
