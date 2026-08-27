import {
  CheckCircleIcon,
  CopyIcon,
  LinkSimpleIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ApplicationPracticeContext } from "@/components/application-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  createPatientPortalInvitation,
  getPatientPortalInvitationContexts,
  PatientOnboardingApiError,
  type PatientPortalInvitationContext,
  type PatientPortalInvitationResponse,
} from "@/lib/patient-onboarding";

const patientPortalInvitationReasons = [
  {
    value: "patient-portal-onboarding",
    label: "Patient portal onboarding",
    description: "Use when a practice is helping a patient begin portal access.",
  },
  {
    value: "patient-requested-access",
    label: "Patient requested access",
    description: "Use when a patient has asked the practice for portal access.",
  },
  {
    value: "staff-assisted-enrolment",
    label: "Staff-assisted enrolment",
    description: "Use when staff are assisting a patient with enrolment.",
  },
] as const;

type PatientPortalInvitationReason =
  (typeof patientPortalInvitationReasons)[number]["value"];

const defaultPatientPortalInvitationReason: PatientPortalInvitationReason =
  "patient-portal-onboarding";

interface PatientPortalInvitationPageProps {
  csrfToken: string;
  selectedOrganizationId?: string;
  onSelectedOrganizationChange: (organizationId: string) => void;
  onContextChange: (context: ApplicationPracticeContext) => void;
  onPageReady: () => void;
  onSessionExpired: () => void;
}

export function PatientPortalInvitationPage({
  csrfToken,
  selectedOrganizationId,
  onSelectedOrganizationChange,
  onContextChange,
  onPageReady,
  onSessionExpired,
}: PatientPortalInvitationPageProps) {
  const [contexts, setContexts] = useState<PatientPortalInvitationContext[]>([]);
  const [activeOrganizationId, setActiveOrganizationId] = useState(
    selectedOrganizationId ?? "",
  );
  const [reason, setReason] = useState<PatientPortalInvitationReason>(
    defaultPatientPortalInvitationReason,
  );
  const [invitation, setInvitation] =
    useState<PatientPortalInvitationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<
    "idle" | "copied" | "manual"
  >("idle");
  const [reloadVersion, setReloadVersion] = useState(0);
  const preferredOrganizationId = useRef(selectedOrganizationId);

  useEffect(() => {
    let cancelled = false;

    const loadContexts = async () => {
      setLoading(true);
      setError(null);

      try {
        const result = await getPatientPortalInvitationContexts();
        if (cancelled) return;

        setContexts(result.contexts);
        const preferred = result.contexts.find(
          (context) =>
            context.organizationId === preferredOrganizationId.current,
        );
        setActiveOrganizationId(
          preferred?.organizationId ?? result.contexts[0]?.organizationId ?? "",
        );
      } catch (reason: unknown) {
        if (cancelled) return;

        if (
          reason instanceof PatientOnboardingApiError &&
          reason.status === 401
        ) {
          onSessionExpired();
          return;
        }

        setError(
          reason instanceof Error
            ? reason.message
            : "Patient invitation access could not be loaded.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadContexts();

    return () => {
      cancelled = true;
    };
  }, [onSessionExpired, reloadVersion]);

  const activeContext = useMemo(
    () =>
      contexts.find(
        (context) => context.organizationId === activeOrganizationId,
      ),
    [activeOrganizationId, contexts],
  );

  useEffect(() => {
    if (!activeContext) return;

    onSelectedOrganizationChange(activeContext.organizationId);
    onContextChange(activeContext);
  }, [activeContext, onContextChange, onSelectedOrganizationChange]);

  useEffect(() => {
    if (!loading) onPageReady();
  }, [loading, onPageReady]);

  const selectContext = (organizationId: string) => {
    setActiveOrganizationId(organizationId);
    setInvitation(null);
    setCopyStatus("idle");
    setError(null);
  };

  const submitInvitation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeContext) {
      setError("Select a practice before creating an invitation link.");
      return;
    }

    setSubmitting(true);
    setInvitation(null);
    setCopyStatus("idle");
    setError(null);

    try {
      const result = await createPatientPortalInvitation(csrfToken, {
        organizationId: activeContext.organizationId,
        reason,
      });
      setInvitation(result);
      setReason(defaultPatientPortalInvitationReason);
    } catch (reason: unknown) {
      if (
        reason instanceof PatientOnboardingApiError &&
        reason.status === 401
      ) {
        onSessionExpired();
        return;
      }

      setError(
        reason instanceof Error
          ? reason.message
          : "The patient invitation could not be created.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const copyInvitation = async () => {
    if (!invitation) return;

    try {
      await navigator.clipboard.writeText(invitation.invitationUrl);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("manual");
    }
  };

  const formattedExpiry = invitation?.expiresAt
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(invitation.expiresAt))
    : null;

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="border-b pb-7">
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <ShieldCheckIcon aria-hidden="true" className="size-5" />
          Patient portal administration
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
          Patient portal invitations
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          Create one secure, one-time link for the selected practice. The link
          is not assigned to a name or email and does not reveal any existing
          patient or practice relationship.
        </p>
      </section>

      {loading ? (
        <section
          className="mt-6 grid max-w-3xl gap-4"
          aria-label="Loading invitation access"
        >
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-64 w-full" />
        </section>
      ) : error && contexts.length === 0 ? (
        <section
          className="mt-6 max-w-3xl rounded-xl border border-destructive/30 bg-destructive/10 p-5"
          role="alert"
        >
          <div className="flex items-start gap-3">
            <WarningCircleIcon
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-destructive"
            />
            <div>
              <h2 className="font-semibold">Invitation access unavailable</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {error}
              </p>
              <Button
                className="mt-4"
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setReloadVersion((value) => value + 1)}
              >
                Try again
              </Button>
            </div>
          </div>
        </section>
      ) : contexts.length === 0 ? (
        <section className="mt-6 max-w-3xl rounded-xl border bg-card p-5 sm:p-6">
          <h2 className="font-semibold">No authorized practices</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Your current roles do not allow patient portal invitations for a
            practice.
          </p>
        </section>
      ) : (
        <div className="mt-6 grid max-w-3xl gap-6">
          <form
            className="grid gap-5 rounded-xl border bg-card p-5 sm:p-6"
            onSubmit={submitInvitation}
          >
            <div>
              <h2 className="text-lg font-semibold">Create invitation link</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Share the link through an approved channel. Anyone who receives
                it must still sign in to a patient account before acceptance.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="patient-invitation-practice">Practice</Label>
              <Select
                value={activeOrganizationId}
                onValueChange={selectContext}
                disabled={submitting}
              >
                <SelectTrigger
                  id="patient-invitation-practice"
                  className="min-h-11"
                >
                  <SelectValue placeholder="Select a practice" />
                </SelectTrigger>
                <SelectContent position="popper">
                  {contexts.map((context) => (
                    <SelectItem
                      key={context.organizationId}
                      value={context.organizationId}
                    >
                      {context.organizationName} · {context.tenantName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="patient-invitation-reason">
                Invitation purpose
              </Label>
              <Select
                value={reason}
                onValueChange={(value) =>
                  setReason(value as PatientPortalInvitationReason)
                }
                disabled={submitting}
              >
                <SelectTrigger
                  id="patient-invitation-reason"
                  className="min-h-11"
                  aria-describedby="patient-invitation-reason-help"
                >
                  <SelectValue placeholder="Select an invitation purpose" />
                </SelectTrigger>
                <SelectContent position="popper">
                  {patientPortalInvitationReasons.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p
                id="patient-invitation-reason-help"
                className="text-xs leading-5 text-muted-foreground"
              >
                {
                  patientPortalInvitationReasons.find(
                    (option) => option.value === reason,
                  )?.description
                }{" "}
                This standard purpose is stored in the audit trail without
                patient details.
              </p>
            </div>

            {error && (
              <p
                className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
                role="alert"
              >
                {error}
              </p>
            )}

            <Button
              className="sm:justify-self-start"
              type="submit"
              disabled={submitting}
            >
              <LinkSimpleIcon aria-hidden="true" />
              {submitting ? "Creating link…" : "Create one-time link"}
            </Button>
          </form>

          {invitation && (
            <section
              className="rounded-xl border border-success/30 bg-success/10 p-5 sm:p-6"
              aria-labelledby="patient-invitation-created-title"
            >
              <div className="flex items-start gap-3">
                <CheckCircleIcon
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0 text-success"
                  weight="fill"
                />
                <div>
                  <h2
                    id="patient-invitation-created-title"
                    className="font-semibold text-foreground"
                  >
                    One-time invitation created
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Copy this link now. It is shown only in this response and
                    cannot be retrieved later.
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <Label className="sr-only" htmlFor="patient-invitation-link">
                  Patient portal invitation link
                </Label>
                <Input
                  id="patient-invitation-link"
                  readOnly
                  value={invitation.invitationUrl}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button type="button" variant="outline" onClick={copyInvitation}>
                  <CopyIcon aria-hidden="true" />
                  Copy link
                </Button>
              </div>

              <div
                className="mt-3 text-xs leading-5 text-muted-foreground"
                role="status"
              >
                {copyStatus === "copied"
                  ? "Invitation link copied."
                  : copyStatus === "manual"
                    ? "Automatic copy is unavailable. Select and copy the link manually."
                    : formattedExpiry
                      ? `Expires ${formattedExpiry}.`
                      : "Share the link through an approved channel."}
              </div>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
