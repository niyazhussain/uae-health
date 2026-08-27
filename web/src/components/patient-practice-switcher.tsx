import { BuildingsIcon, ShieldCheckIcon } from "@phosphor-icons/react";
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

  const selectionChanged =
    selectedPortalProfileId !== undefined &&
    selectedPortalProfileId !== currentPortalProfileId;

  return (
    <section
      className="rounded-xl border bg-card p-5 sm:p-6"
      aria-labelledby="practice-context-title"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-secondary text-secondary-foreground">
          <BuildingsIcon aria-hidden="true" className="size-5" weight="bold" />
        </span>
        <div>
          <h2 id="practice-context-title" className="text-lg font-semibold">
            {context.kind === "practice"
              ? "Change active practice"
              : "Choose a practice"}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            Only the selected practice is active in this session. Information is
            never combined across practices.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="grid gap-2">
          <Label htmlFor="patient-practice">Practice</Label>
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
        <Button
          className="min-h-11 whitespace-nowrap"
          disabled={!selectionChanged || pending}
          onClick={() => {
            if (selectedPortalProfileId) {
              void onSelectPractice(selectedPortalProfileId);
            }
          }}
        >
          {pending
            ? "Changing practice…"
            : context.kind === "practice"
              ? "Change practice"
              : "Continue"}
        </Button>
      </div>

      {context.kind === "practice" && (
        <div className="mt-5 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-sm leading-6 text-muted-foreground">
            <ShieldCheckIcon
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-primary"
              weight="bold"
            />
            Exit this practice to return to restricted portal access.
          </p>
          <Button
            className="self-start whitespace-nowrap"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => void onSelectPractice(null)}
          >
            Exit practice
          </Button>
        </div>
      )}

      {error && (
        <p
          className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}
    </section>
  );
}
