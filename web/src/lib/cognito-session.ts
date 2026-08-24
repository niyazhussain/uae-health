import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
  type CognitoUserSession,
  type IAuthenticationCallback,
  type ICognitoStorage,
} from "amazon-cognito-identity-js";
import { useCallback, useMemo, useRef, useState } from "react";

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
      accessToken: string;
      expiresAt: Date;
      username: string;
    }
  | { kind: "error"; message: string };

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Authentication could not be completed. Please try again.";
}

export function useCognitoSession() {
  const [step, setStep] = useState<SessionStep>({ kind: "signed-out" });
  const activeUser = useRef<CognitoUser | null>(null);
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

  const finishAuthentication = useCallback(
    (session: CognitoUserSession) => {
      const token = session.getAccessToken();
      const authenticatedUser = activeUser.current;
      const username = authenticatedUser?.getUsername() ?? "Workforce user";

      // Discard the CognitoUser object because its completed session also
      // contains ID and refresh tokens. The access token below is the only
      // credential retained by application state.
      authenticatedUser?.signOut();
      activeUser.current = null;
      storage.clear();

      setStep({
        kind: "signed-in",
        accessToken: token.getJwtToken(),
        expiresAt: new Date(token.getExpiration() * 1000),
        username,
      });
    },
    [storage],
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
    activeUser.current?.signOut();
    activeUser.current = null;
    storage.clear();
    setStep({ kind: "signed-out" });
  }, [storage]);

  return {
    step,
    configured: pool !== null,
    signIn,
    completeNewPassword,
    verifyTotpSetup,
    submitTotp,
    signOut,
  };
}
