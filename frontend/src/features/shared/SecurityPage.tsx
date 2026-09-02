/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  beginSecurityPasskey,
  finishSecurityPasskey,
  listExternalIdentities,
  listSecurityCredentials,
  listSecuritySessions,
  logoutAllSessions,
  regenerateRecoveryCodes,
  revokeExternalIdentity,
  revokeSecurityCredential,
  revokeSecuritySession,
  type ExternalIdentity,
  type SecurityCredential,
  type SecuritySession,
} from "../../api/security";
import { createPasskey } from "../../auth/webauthn";
import { useSession } from "../../auth/SessionProvider";
import {
  isRecentWebAuthnVerificationCancelled,
  useRecentWebAuthnStepUp,
} from "../../auth/useRecentWebAuthnStepUp";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import OneTimeSecretPanel from "../../components/OneTimeSecretPanel";
import PageBanner from "../../components/PageBanner";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import UiInput from "../../components/ui/UiInput";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { cx, uiMutedTextClass, uiPanelMutedClass } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { readStoredUser } from "../../utils/workspaces";
import { updateCurrentUser } from "../../api/users";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";

type LoadStatus = "loading" | "ready" | "error" | "verification_required";

type SectionState<T> = {
  data: T;
  status: LoadStatus;
  error: string | null;
};

type PendingConfirmation =
  | { kind: "revoke-credential"; credential: SecurityCredential }
  | { kind: "regenerate-codes" }
  | { kind: "revoke-identity"; identity: ExternalIdentity }
  | { kind: "revoke-session"; session: SecuritySession }
  | { kind: "logout-all" };

const loadingSection = <T,>(data: T): SectionState<T> => ({ data, status: "loading", error: null });

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function SecuritySectionState({
  status,
  error,
  loadingLabel,
  emptyLabel,
  isEmpty,
  onRetry,
  children,
}: {
  status: LoadStatus;
  error: string | null;
  loadingLabel: string;
  emptyLabel: string;
  isEmpty: boolean;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (status === "loading") {
    return <p className={cx("ui-body", uiMutedTextClass)} role="status">{loadingLabel}</p>;
  }
  if (status === "error") {
    return (
      <PageBanner tone="error">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>{error}</span>
          <UiButton variant="secondary" size="xs" onClick={onRetry}>Retry</UiButton>
        </div>
      </PageBanner>
    );
  }
  if (status === "verification_required") {
    return <p className={cx("ui-body", uiMutedTextClass)}>Passkey verification is required to unlock this section.</p>;
  }
  if (isEmpty) {
    return <p className={cx("ui-body", uiMutedTextClass)}>{emptyLabel}</p>;
  }
  return <>{children}</>;
}

export default function SecurityPage() {
  const { clear } = useSession();
  const storedUser = readStoredUser();
  const canChangePassword = storedUser?.has_local_password === true || storedUser?.authType === "password";
  const { generalSettings } = useGeneralSettings();
  const passkeyRequired = storedUser?.role === "ui_admin" || storedUser?.role === "ui_superadmin"
    ? Boolean(generalSettings.require_passkey_for_admins)
    : storedUser?.role === "ui_user" || storedUser?.role === "ui_none"
      ? Boolean(generalSettings.require_passkey_for_users)
      : false;
  const passkeyDescription = passkeyRequired
    ? "A passkey is required for your role and for sensitive actions."
    : "Passkeys are optional for your role. Once added, a passkey is required at sign-in and for sensitive actions.";
  const [credentials, setCredentials] = useState<SectionState<SecurityCredential[]>>(() => loadingSection([]));
  const [sessions, setSessions] = useState<SectionState<SecuritySession[]>>(() => loadingSection([]));
  const [identities, setIdentities] = useState<SectionState<ExternalIdentity[]>>(() => loadingSection([]));
  const [codes, setCodes] = useState<string[]>([]);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const {
    runWithStepUp,
    verificationDialog,
  } = useRecentWebAuthnStepUp();

  const loadCredentials = useCallback(async () => {
    setCredentials((current) => ({ ...current, status: "loading", error: null }));
    try {
      setCredentials({ data: await listSecurityCredentials(), status: "ready", error: null });
    } catch (error) {
      setCredentials({ data: [], status: "error", error: extractApiError(error, "Unable to load passkeys.") });
    }
  }, []);

  const loadSessions = useCallback(async () => {
    setSessions((current) => ({ ...current, status: "loading", error: null }));
    try {
      setSessions({ data: await listSecuritySessions(), status: "ready", error: null });
    } catch (error) {
      setSessions({ data: [], status: "error", error: extractApiError(error, "Unable to load sessions.") });
    }
  }, []);

  const loadIdentities = useCallback(async () => {
    setIdentities((current) => ({ ...current, status: "loading", error: null }));
    try {
      setIdentities({ data: await listExternalIdentities(), status: "ready", error: null });
    } catch (error) {
      setIdentities({ data: [], status: "error", error: extractApiError(error, "Unable to load external identities.") });
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadCredentials(), loadSessions(), loadIdentities()]);
  }, [loadCredentials, loadIdentities, loadSessions]);

  const runAction = useCallback(async (key: string, action: () => Promise<void>, successMessage?: string) => {
    setPendingAction(key);
    setActionError(null);
    setActionMessage(null);
    try {
      await runWithStepUp(action);
      if (successMessage) setActionMessage(successMessage);
    } catch (error) {
      if (!isRecentWebAuthnVerificationCancelled(error)) {
        setActionError(extractApiError(error, "Unable to update security settings."));
      }
      throw error;
    } finally {
      setPendingAction(null);
    }
  }, [runWithStepUp]);

  const signOut = useCallback(() => {
    clear();
    window.location.replace("/login");
  }, [clear]);

  const addPasskey = async () => {
    try {
      await runAction("add-passkey", async () => {
        const credential = await createPasskey(await beginSecurityPasskey());
        await finishSecurityPasskey(credential, "Passkey");
      });
      signOut();
    } catch {
      // runAction already exposes the actionable error.
    }
  };

  const confirmPendingAction = async () => {
    const pending = pendingConfirmation;
    if (!pending) return;
    try {
      if (pending.kind === "revoke-credential") {
        await runAction("confirm", () => revokeSecurityCredential(pending.credential.id), "Passkey revoked.");
        await loadCredentials();
      } else if (pending.kind === "regenerate-codes") {
        await runAction(
          "confirm",
          async () => setCodes(await regenerateRecoveryCodes()),
          "All sessions and API tokens were revoked. Save the new codes, then sign in again.",
        );
      } else if (pending.kind === "revoke-identity") {
        await runAction("confirm", () => revokeExternalIdentity(pending.identity.id));
        signOut();
      } else if (pending.kind === "revoke-session") {
        await runAction("confirm", () => revokeSecuritySession(pending.session.id), "Session revoked.");
        if (pending.session.current) signOut();
        else await loadSessions();
      } else if (pending.kind === "logout-all") {
        await runAction("confirm", logoutAllSessions);
        signOut();
      }
      setPendingConfirmation(null);
    } catch {
      // Keep the confirmation open so the user can retry or cancel.
    }
  };

  const handlePasswordSave = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordError(null);
    setPasswordMessage(null);
    if (!canChangePassword) return;
    if (!currentPassword || !newPassword) {
      setPasswordError("Enter the current password and the new password.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Password confirmation does not match.");
      return;
    }
    setPasswordSaving(true);
    try {
      await updateCurrentUser({ current_password: currentPassword, new_password: newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage("Password changed. Sign in again with the new password.");
      signOut();
    } catch (error) {
      setPasswordError(extractApiError(error, "Unable to change password."));
    } finally {
      setPasswordSaving(false);
    }
  };

  const confirmation = useMemo(() => {
    if (!pendingConfirmation) return null;
    if (pendingConfirmation.kind === "revoke-credential") {
      return {
        title: "Revoke passkey",
        description: "This passkey will no longer be accepted for sign-in or sensitive actions.",
        confirmLabel: "Revoke passkey",
        details: [{ label: "Passkey", value: pendingConfirmation.credential.name }],
      };
    }
    if (pendingConfirmation.kind === "regenerate-codes") {
      return {
        title: "Generate new recovery codes",
        description: "Generating a new set invalidates every previous code, session, and API token.",
        confirmLabel: "Generate codes",
        details: [],
      };
    }
    if (pendingConfirmation.kind === "revoke-identity") {
      return {
        title: "Revoke external identity",
        description: "The external identity will be unlinked and every active session will be signed out.",
        confirmLabel: "Revoke and sign out",
        details: [{ label: "Identity", value: `${pendingConfirmation.identity.provider_type}:${pendingConfirmation.identity.provider_id}` }],
      };
    }
    if (pendingConfirmation.kind === "logout-all") {
      return {
        title: "Log out everywhere",
        description: "Every active session, including this one, will be revoked.",
        confirmLabel: "Log out everywhere",
        details: [],
      };
    }
    const session = pendingConfirmation.session;
    return {
      title: "Revoke session",
      description: session.current
        ? "This is your current session. Revoking it will return you to the sign-in page."
        : "This session will lose access immediately.",
      confirmLabel: "Revoke session",
      details: [{ label: "Session", value: session.id }],
    };
  }, [pendingConfirmation]);
  const lastRequiredPasskey = passkeyRequired
    && credentials.status === "ready"
    && credentials.data.length === 1;

  return (
    <div className="space-y-4">
      {actionError ? <PageBanner tone="error">{actionError}</PageBanner> : null}
      {actionMessage ? <PageBanner tone="success">{actionMessage}</PageBanner> : null}

      <UiCard title="Password" description="Change the local password used to start your sign-in.">
        {!canChangePassword ? (
          <PageBanner tone="info">Password change is unavailable for this authentication mode.</PageBanner>
        ) : (
          <form className="space-y-4" onSubmit={handlePasswordSave}>
            <div className="grid gap-3 sm:grid-cols-3">
              <UiInput label="Current password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
              <UiInput label="New password" hint="At least 12 characters." type="password" minLength={12} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
              <UiInput label="Confirm password" type="password" minLength={12} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
            </div>
            {passwordError ? <UiInlineMessage tone="error">{passwordError}</UiInlineMessage> : null}
            {passwordMessage ? <UiInlineMessage tone="success">{passwordMessage}</UiInlineMessage> : null}
            <UiButton type="submit" size="sm" loading={passwordSaving}>Change password</UiButton>
          </form>
        )}
      </UiCard>

      <UiCard
        title="Passkeys"
        description={passkeyDescription}
        actions={<UiButton size="sm" onClick={() => void addPasskey()} loading={pendingAction === "add-passkey"}>Add passkey</UiButton>}
      >
        <SecuritySectionState
          status={credentials.status}
          error={credentials.error}
          loadingLabel="Loading passkeys..."
          emptyLabel="No passkeys registered."
          isEmpty={credentials.data.length === 0}
          onRetry={() => void loadCredentials()}
        >
          <ul className="space-y-2">
            {credentials.data.map((credential) => (
              <li key={credential.id} className={cx("flex flex-wrap items-center justify-between gap-3 px-3 py-2", uiPanelMutedClass)}>
                <span className="ui-body font-semibold text-[var(--ui-text)]">{credential.name}</span>
                <UiButton
                  variant="danger"
                  size="xs"
                  disabled={lastRequiredPasskey}
                  onClick={() => setPendingConfirmation({ kind: "revoke-credential", credential })}
                >
                  Revoke
                </UiButton>
              </li>
            ))}
          </ul>
        </SecuritySectionState>
        {lastRequiredPasskey ? (
          <UiInlineMessage tone="info" className="mt-3">
            Add another passkey before revoking this one because your role requires at least one.
          </UiInlineMessage>
        ) : null}
        {credentials.status === "ready" && credentials.data.length > 0 ? (
          <div className="mt-3">
            <UiButton variant="secondary" size="sm" onClick={() => setPendingConfirmation({ kind: "regenerate-codes" })}>
              Generate new recovery codes
            </UiButton>
          </div>
        ) : null}
        {codes.length > 0 ? (
          <OneTimeSecretPanel
            className="mt-4"
            title="Recovery codes"
            description="These codes are shown once. Store them securely before closing this panel."
            badge="Shown once"
            values={codes.map((code, index) => ({ label: `Code ${index + 1}`, value: code, copyLabel: "Copy" }))}
            actions={<UiButton variant="secondary" size="xs" onClick={signOut}>I saved them — sign in</UiButton>}
          />
        ) : null}
      </UiCard>

      <UiCard
        title="External identities"
        description={generalSettings.allow_user_external_identity_unlink
          ? "You can unlink an identity when another primary sign-in method remains."
          : "External identities are visible here and managed by an application administrator."}
      >
        <SecuritySectionState
          status={identities.status}
          error={identities.error}
          loadingLabel="Loading external identities..."
          emptyLabel="No external identities linked."
          isEmpty={identities.data.length === 0}
          onRetry={() => void loadIdentities()}
        >
          <ul className="space-y-2">
            {identities.data.map((identity) => (
              <li key={identity.id} className={cx("flex flex-wrap items-center justify-between gap-3 px-3 py-2", uiPanelMutedClass)}>
                <span className="ui-body">
                  <strong>{identity.provider_type}:{identity.provider_id}</strong><br />
                  <span className={uiMutedTextClass}>{identity.email ?? "No email claim"}</span>
                </span>
                {generalSettings.allow_user_external_identity_unlink ? (
                  <UiButton variant="danger" size="xs" onClick={() => setPendingConfirmation({ kind: "revoke-identity", identity })}>
                    Unlink and sign out
                  </UiButton>
                ) : null}
              </li>
            ))}
          </ul>
        </SecuritySectionState>
      </UiCard>

      <UiCard
        title="Sessions"
        actions={<UiButton variant="danger" size="xs" onClick={() => setPendingConfirmation({ kind: "logout-all" })}>Log out everywhere</UiButton>}
      >
        <SecuritySectionState
          status={sessions.status}
          error={sessions.error}
          loadingLabel="Loading sessions..."
          emptyLabel="No active sessions."
          isEmpty={sessions.data.length === 0}
          onRetry={() => void loadSessions()}
        >
          <ul className="space-y-2">
            {sessions.data.map((session) => (
              <li key={session.id} className={cx("flex flex-wrap items-start justify-between gap-3 px-3 py-2", uiPanelMutedClass)}>
                <span className="ui-body">
                  <strong>{session.current ? "Current session" : session.auth_type}</strong><br />
                  <span className={uiMutedTextClass}>{session.ip_address ?? "Unknown address"} · {formatDate(session.last_activity_at)}</span>
                </span>
                {!session.revoked_at ? (
                  <UiButton variant="danger" size="xs" onClick={() => setPendingConfirmation({ kind: "revoke-session", session })}>Revoke</UiButton>
                ) : null}
              </li>
            ))}
          </ul>
        </SecuritySectionState>
      </UiCard>

      {confirmation ? (
        <ConfirmActionDialog
          title={confirmation.title}
          description={confirmation.description}
          confirmLabel={confirmation.confirmLabel}
          details={confirmation.details}
          loading={pendingAction === "confirm"}
          onCancel={() => setPendingConfirmation(null)}
          onConfirm={() => void confirmPendingAction()}
        />
      ) : null}
      {verificationDialog}
    </div>
  );
}
