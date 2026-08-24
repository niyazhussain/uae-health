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

export type SessionStep =
  | { kind: "signed-out" }
  | { kind: "submitting"; message: string }
  | { kind: "new-password" }
  | { kind: "totp-setup"; secret: string; username: string }
  | { kind: "totp-challenge" }
  | {
      kind: "signed-in";
      expiresAt: Date;
      absoluteExpiresAt: Date;
      username: string;
      csrfToken: string;
    }
  | { kind: "error"; message: string };

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Authentication could not be completed. Please try again.";
}

interface ServerSessionResponse {
  subject: string;
  username?: string;
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

export function useCognitoSession() {
  const [step, setStep] = useState<SessionStep>({
    kind: "submitting",
    message: "Restoring secure session…",
  });
  const activeUser = useRef<CognitoUser | null>(null);
  const csrfToken = useRef<string | null>(null);
  const storage = useMemo(() => new MemoryStorage(), []);
  const pool = useMemo(() => {
    const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID;
    const clientId = import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID;

    if (!userPoolId || !clientId) {
      return null;
    }

    return new CognitoUserPool({
      UserPoolId: userPoolId,
      ClientId: clientId,
      Storage: storage,
    });
  }, [storage]);

  const applyServerSession = useCallback(
    (session: ServerSessionResponse, fallbackUsername?: string) => {
      csrfToken.current = session.csrfToken;
      setStep({
        kind: "signed-in",
        expiresAt: new Date(session.expiresAt),
        absoluteExpiresAt: new Date(session.absoluteExpiresAt),
        username: session.username ?? fallbackUsername ?? "Workforce user",
        csrfToken: session.csrfToken,
      });
    },
    [],
  );

  const clearProviderCredentials = useCallback(() => {
    activeUser.current?.signOut();
    activeUser.current = null;
    storage.clear();
  }, [storage]);

  const clearLocalSession = useCallback(() => {
    clearProviderCredentials();
    csrfToken.current = null;
    setStep({ kind: "signed-out" });
  }, [clearProviderCredentials]);

  useEffect(() => {
    const controller = new AbortController();

    sessionRequest("/v1/auth/session", { signal: controller.signal })
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
  }, [applyServerSession, clearLocalSession]);

  const finishAuthentication = useCallback(
    (session: CognitoUserSession) => {
      const token = session.getAccessToken();
      const authenticatedUser = activeUser.current;
      const username = authenticatedUser?.getUsername() ?? "Workforce user";
      const accessToken = token.getJwtToken();
      setStep({
        kind: "submitting",
        message: "Establishing secure session…",
      });

      void sessionRequest("/v1/auth/session", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      })
        .then((serverSession) => {
          clearProviderCredentials();
          applyServerSession(serverSession, username);
        })
        .catch((error: unknown) => {
          clearProviderCredentials();
          setStep({ kind: "error", message: errorMessage(error) });
        });
    },
    [applyServerSession, clearProviderCredentials],
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
              username: activeUser.current?.getUsername() ?? "workforce-user",
            });
          },
          onFailure: (error: unknown) => {
            setStep({ kind: "error", message: errorMessage(error) });
          },
        });
      },
    };
  }, [finishAuthentication]);

  const signIn = useCallback(
    (email: string, password: string) => {
      if (!pool) {
        setStep({
          kind: "error",
          message: "Staging Cognito configuration is unavailable.",
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
    [callbacks, pool, storage],
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

    void fetch(new URL("/v1/auth/logout", apiBaseUrl), {
      method: "POST",
      credentials: "include",
      headers: { "X-CSRF-Token": currentCsrfToken },
    }).finally(clearLocalSession);
  }, [clearLocalSession]);

  return {
    step,
    configured: pool !== null,
    signIn,
    completeNewPassword,
    verifyTotpSetup,
    submitTotp,
    signOut,
    handleUnauthorized: clearLocalSession,
  };
}
