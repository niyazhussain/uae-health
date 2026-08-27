import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
  type CognitoUserSession,
  type IAuthenticationCallback,
  type ICognitoStorage,
} from "amazon-cognito-identity-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

class MemoryStorage implements ICognitoStorage {
  private readonly values = new Map<string, string>();

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  clear() {
    this.values.clear();
  }
}

export interface PatientPracticeChoice {
  portalProfileId: string;
  practiceName: string;
}

export type PatientSessionContext =
  | { kind: "onboarding" }
  | {
      kind: "practice";
      portalProfileId: string;
      practiceName: string;
    };

interface SignedInSessionBase {
  kind: "signed-in";
  expiresAt: Date;
  absoluteExpiresAt: Date;
  username: string;
  csrfToken: string;
}

export type SessionStep =
  | { kind: "signed-out" }
  | { kind: "submitting"; message: string }
  | { kind: "new-password" }
  | { kind: "totp-setup"; secret: string; username: string }
  | { kind: "totp-challenge" }
  | (SignedInSessionBase & { audience: "workforce" })
  | (SignedInSessionBase & {
      audience: "patient";
      context: PatientSessionContext;
      availablePractices: PatientPracticeChoice[];
    })
  | { kind: "error"; message: string };

type SignedInSessionStep = Extract<SessionStep, { kind: "signed-in" }>;

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Authentication could not be completed. Please try again.";
}

interface ServerSessionResponse {
  username?: string;
  displayName?: string;
  context?: unknown;
  availablePractices?: unknown;
  csrfToken: string;
  expiresAt: string;
  absoluteExpiresAt: string;
}

class SessionApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SessionApiError";
    this.status = status;
  }
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

interface CognitoSessionOptions {
  userPoolId?: string;
  clientId?: string;
  sessionPath: string;
  logoutPath: string;
  contextPath?: string;
  fallbackUsername: string;
  unavailableMessage: string;
  toSignedInStep: (
    session: ServerSessionResponse,
    fallbackUsername: string,
  ) => SignedInSessionStep;
}

function patientSessionContext(value: unknown): PatientSessionContext {
  if (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "onboarding"
  ) {
    return { kind: "onboarding" };
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "practice" &&
    "portalProfileId" in value &&
    typeof value.portalProfileId === "string" &&
    "practiceName" in value &&
    typeof value.practiceName === "string"
  ) {
    return {
      kind: "practice",
      portalProfileId: value.portalProfileId,
      practiceName: value.practiceName,
    };
  }

  throw new Error("The patient session returned an invalid practice context.");
}

function patientPracticeChoices(value: unknown): PatientPracticeChoice[] {
  if (!Array.isArray(value)) {
    throw new Error("The patient session returned an invalid practice list.");
  }

  return value.map((practice) => {
    if (
      typeof practice !== "object" ||
      practice === null ||
      !("portalProfileId" in practice) ||
      typeof practice.portalProfileId !== "string" ||
      !("practiceName" in practice) ||
      typeof practice.practiceName !== "string"
    ) {
      throw new Error("The patient session returned an invalid practice list.");
    }

    return {
      portalProfileId: practice.portalProfileId,
      practiceName: practice.practiceName,
    };
  });
}

function toWorkforceSignedInStep(
  session: ServerSessionResponse,
  fallbackUsername: string,
): SignedInSessionStep {
  return {
    kind: "signed-in",
    audience: "workforce",
    expiresAt: new Date(session.expiresAt),
    absoluteExpiresAt: new Date(session.absoluteExpiresAt),
    username: session.username ?? fallbackUsername,
    csrfToken: session.csrfToken,
  };
}

function toPatientSignedInStep(
  session: ServerSessionResponse,
  fallbackUsername: string,
): SignedInSessionStep {
  return {
    kind: "signed-in",
    audience: "patient",
    expiresAt: new Date(session.expiresAt),
    absoluteExpiresAt: new Date(session.absoluteExpiresAt),
    username: session.displayName ?? fallbackUsername,
    csrfToken: session.csrfToken,
    context: patientSessionContext(session.context),
    availablePractices: patientPracticeChoices(session.availablePractices),
  };
}

async function sessionRequest(
  path: string,
  init?: RequestInit,
): Promise<ServerSessionResponse> {
  const response = await fetch(new URL(path, apiBaseUrl), {
    credentials: "include",
    ...init,
  });

  if (!response.ok) {
    throw new SessionApiError(
      response.status === 401
        ? "The secure session has expired. Sign in again."
        : `Secure session request failed (${response.status}).`,
      response.status,
    );
  }

  return (await response.json()) as ServerSessionResponse;
}

function useConfiguredCognitoSession({
  userPoolId,
  clientId,
  sessionPath,
  logoutPath,
  contextPath,
  fallbackUsername,
  unavailableMessage,
  toSignedInStep,
}: CognitoSessionOptions) {
  const [step, setStep] = useState<SessionStep>({
    kind: "submitting",
    message: "Restoring secure session…",
  });
  const activeUser = useRef<CognitoUser | null>(null);
  const csrfToken = useRef<string | null>(null);
  const contextChangeInFlight = useRef(false);
  const [contextChangePending, setContextChangePending] = useState(false);
  const [contextChangeError, setContextChangeError] = useState<string | null>(
    null,
  );
  const storage = useMemo(() => new MemoryStorage(), []);
  const pool = useMemo(() => {
    if (!userPoolId || !clientId) {
      return null;
    }

    return new CognitoUserPool({
      UserPoolId: userPoolId,
      ClientId: clientId,
      Storage: storage,
    });
  }, [clientId, storage, userPoolId]);

  const applyServerSession = useCallback(
    (session: ServerSessionResponse, fallbackDisplayName?: string) => {
      const signedInStep = toSignedInStep(
        session,
        fallbackDisplayName ?? fallbackUsername,
      );
      csrfToken.current = session.csrfToken;
      setContextChangeError(null);
      setStep(signedInStep);
    },
    [fallbackUsername, toSignedInStep],
  );

  const clearProviderCredentials = useCallback(() => {
    activeUser.current?.signOut();
    activeUser.current = null;
    storage.clear();
  }, [storage]);

  const clearLocalSession = useCallback(() => {
    clearProviderCredentials();
    csrfToken.current = null;
    contextChangeInFlight.current = false;
    setContextChangePending(false);
    setContextChangeError(null);
    setStep({ kind: "signed-out" });
  }, [clearProviderCredentials]);

  const refreshSession = useCallback(async () => {
    try {
      const session = await sessionRequest(sessionPath);
      applyServerSession(session);
    } catch (error: unknown) {
      if (error instanceof SessionApiError && error.status === 401) {
        clearLocalSession();
      }
      throw error;
    }
  }, [applyServerSession, clearLocalSession, sessionPath]);

  useEffect(() => {
    const controller = new AbortController();

    sessionRequest(sessionPath, { signal: controller.signal })
      .then((session) => {
        if (!controller.signal.aborted) applyServerSession(session);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof SessionApiError && error.status === 401) {
          clearLocalSession();
          return;
        }
        setStep({ kind: "error", message: errorMessage(error) });
      });

    return () => controller.abort();
  }, [applyServerSession, clearLocalSession, sessionPath]);

  const finishAuthentication = useCallback(
    (session: CognitoUserSession) => {
      const authenticatedUser = activeUser.current;
      const username = authenticatedUser?.getUsername() ?? fallbackUsername;
      let accessToken = session.getAccessToken().getJwtToken();
      setStep({
        kind: "submitting",
        message: "Establishing secure session…",
      });

      void (async () => {
        try {
          const serverSession = await sessionRequest(sessionPath, {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}` },
          });

          accessToken = "";
          clearProviderCredentials();
          applyServerSession(serverSession, username);
        } catch (error: unknown) {
          clearProviderCredentials();
          setStep({ kind: "error", message: errorMessage(error) });
        } finally {
          accessToken = "";
          clearProviderCredentials();
        }
      })();
    },
    [applyServerSession, clearProviderCredentials, fallbackUsername, sessionPath],
  );

  const callbacks = useCallback((): IAuthenticationCallback => {
    return {
      onSuccess: finishAuthentication,
      onFailure: (error: unknown) => {
        setStep({ kind: "error", message: errorMessage(error) });
      },
      newPasswordRequired: () => {
        setStep({ kind: "new-password" });
      },
      totpRequired: () => {
        setStep({ kind: "totp-challenge" });
      },
      mfaSetup: () => {
        activeUser.current?.associateSoftwareToken({
          associateSecretCode: (secret) => {
            setStep({
              kind: "totp-setup",
              secret,
              username: activeUser.current?.getUsername() ?? fallbackUsername,
            });
          },
          onFailure: (error: unknown) => {
            setStep({ kind: "error", message: errorMessage(error) });
          },
        });
      },
    };
  }, [fallbackUsername, finishAuthentication]);

  const signIn = useCallback(
    (email: string, password: string) => {
      if (!pool) {
        setStep({
          kind: "error",
          message: unavailableMessage,
        });
        return;
      }

      setStep({ kind: "submitting", message: "Checking your credentials…" });
      const user = new CognitoUser({
        Username: email.trim(),
        Pool: pool,
        Storage: storage,
      });
      activeUser.current = user;
      user.authenticateUser(
        new AuthenticationDetails({
          Username: email.trim(),
          Password: password,
        }),
        callbacks(),
      );
    },
    [callbacks, pool, storage, unavailableMessage],
  );

  const completeNewPassword = useCallback(
    (password: string) => {
      if (!activeUser.current) return;
      setStep({ kind: "submitting", message: "Setting your new password…" });
      activeUser.current.completeNewPasswordChallenge(
        password,
        {},
        callbacks(),
      );
    },
    [callbacks],
  );

  const verifyTotpSetup = useCallback(
    (code: string) => {
      if (!activeUser.current) return;
      setStep({ kind: "submitting", message: "Verifying authenticator…" });
      activeUser.current.verifySoftwareToken(code, "UAE Health", {
        onSuccess: finishAuthentication,
        onFailure: (error) => {
          setStep({ kind: "error", message: errorMessage(error) });
        },
      });
    },
    [finishAuthentication],
  );

  const submitTotp = useCallback(
    (code: string) => {
      if (!activeUser.current) return;
      setStep({ kind: "submitting", message: "Verifying sign-in…" });
      activeUser.current.sendMFACode(code, callbacks(), "SOFTWARE_TOKEN_MFA");
    },
    [callbacks],
  );

  const signOut = useCallback(() => {
    const currentCsrfToken = csrfToken.current;

    if (!currentCsrfToken) {
      clearLocalSession();
      return;
    }

    void fetch(new URL(logoutPath, apiBaseUrl), {
      method: "POST",
      credentials: "include",
      headers: { "X-CSRF-Token": currentCsrfToken },
    }).finally(clearLocalSession);
  }, [clearLocalSession, logoutPath]);

  const selectPatientPractice = useCallback(
    async (portalProfileId: string | null) => {
      if (contextChangeInFlight.current) return false;

      const currentCsrfToken = csrfToken.current;

      if (!contextPath || !currentCsrfToken) {
        setContextChangeError(
          "The secure session cannot change practice right now. Sign in again.",
        );
        return false;
      }

      contextChangeInFlight.current = true;
      setContextChangePending(true);
      setContextChangeError(null);

      try {
        const serverSession = await sessionRequest(contextPath, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": currentCsrfToken,
          },
          body: JSON.stringify({ portalProfileId }),
        });
        applyServerSession(serverSession);
        return true;
      } catch (error: unknown) {
        if (error instanceof SessionApiError && error.status === 401) {
          clearLocalSession();
          return false;
        }

        if (error instanceof SessionApiError && error.status === 403) {
          setContextChangeError(
            "That practice is no longer available for this patient account.",
          );
          return false;
        }

        try {
          const restoredSession = await sessionRequest(sessionPath);
          applyServerSession(restoredSession);
          setContextChangeError(
            "The practice request could not be confirmed. The current secure session was restored.",
          );
        } catch {
          clearLocalSession();
        }
        return false;
      } finally {
        contextChangeInFlight.current = false;
        setContextChangePending(false);
      }
    },
    [applyServerSession, clearLocalSession, contextPath, sessionPath],
  );

  return {
    step,
    configured: pool !== null,
    signIn,
    completeNewPassword,
    verifyTotpSetup,
    submitTotp,
    signOut,
    refreshSession,
    selectPatientPractice,
    contextChangePending,
    contextChangeError,
    handleUnauthorized: clearLocalSession,
  };
}

export function useCognitoSession() {
  return useConfiguredCognitoSession({
    userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
    clientId: import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID,
    sessionPath: "/v1/auth/session",
    logoutPath: "/v1/auth/logout",
    fallbackUsername: "Workforce user",
    unavailableMessage: "Workforce identity configuration is unavailable.",
    toSignedInStep: toWorkforceSignedInStep,
  });
}

export function usePatientPortalCognitoSession() {
  return useConfiguredCognitoSession({
    userPoolId: import.meta.env.VITE_PATIENT_COGNITO_USER_POOL_ID,
    clientId: import.meta.env.VITE_PATIENT_COGNITO_USER_POOL_CLIENT_ID,
    sessionPath: "/v1/patient-auth/session",
    logoutPath: "/v1/patient-auth/logout",
    contextPath: "/v1/patient-auth/session/context",
    fallbackUsername: "Patient",
    unavailableMessage: "Patient portal identity configuration is unavailable.",
    toSignedInStep: toPatientSignedInStep,
  });
}
