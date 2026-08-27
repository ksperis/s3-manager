/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  adminRevokeSession,
  beginSecurityPasskey,
  decideExternalLinkRequest,
  finishSecurityPasskey,
  listAdminSessions,
  listExternalIdentities,
  listExternalLinkRequests,
  listSecurityCredentials,
  listSecuritySessions,
  logoutAllSessions,
  regenerateRecoveryCodes,
  revokeExternalIdentity,
  revokeSecurityCredential,
  revokeSecuritySession,
  type ExternalIdentity,
  type ExternalLinkRequest,
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
import { cx, uiMutedTextClass, uiPanelMutedClass } from "../../components/ui/styles";
import { extractApiError, isRecentWebAuthnRequired } from "../../utils/apiError";
import { isSuperAdminRole } from "../../utils/workspaces";

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
  | { kind: "logout-all" }
  | { kind: "revoke-admin-session"; session: SecuritySession };

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
  const { user, clear } = useSession();
  const superAdmin = isSuperAdminRole(user?.role);
  const [credentials, setCredentials] = useState<SectionState<SecurityCredential[]>>(() => loadingSection([]));
  const [sessions, setSessions] = useState<SectionState<SecuritySession[]>>(() => loadingSection([]));
  const [adminSessions, setAdminSessions] = useState<SectionState<SecuritySession[]>>(() => loadingSection([]));
  const [identities, setIdentities] = useState<SectionState<ExternalIdentity[]>>(() => loadingSection([]));
  const [requests, setRequests] = useState<SectionState<ExternalLinkRequest[]>>(() => loadingSection([]));
  const [codes, setCodes] = useState<string[]>([]);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const {
    runWithStepUp,
    verificationDialog,
    verificationError,
    verifying,
    verifyNow,
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

  const loadAdminSessions = useCallback(async () => {
    if (!superAdmin) {
      setAdminSessions({ data: [], status: "ready", error: null });
      return;
    }
    setAdminSessions((current) => ({ ...current, status: "loading", error: null }));
    try {
      setAdminSessions({ data: await listAdminSessions(), status: "ready", error: null });
    } catch (error) {
      if (isRecentWebAuthnRequired(error)) {
        setAdminSessions({ data: [], status: "verification_required", error: null });
        return;
      }
      setAdminSessions({ data: [], status: "error", error: extractApiError(error, "Unable to load active sessions.") });
    }
  }, [superAdmin]);

  const loadRequests = useCallback(async () => {
    if (!superAdmin) {
      setRequests({ data: [], status: "ready", error: null });
      return;
    }
    setRequests((current) => ({ ...current, status: "loading", error: null }));
    try {
      setRequests({ data: await listExternalLinkRequests(), status: "ready", error: null });
    } catch (error) {
      if (isRecentWebAuthnRequired(error)) {
        setRequests({ data: [], status: "verification_required", error: null });
        return;
      }
      setRequests({ data: [], status: "error", error: extractApiError(error, "Unable to load identity link requests.") });
    }
  }, [superAdmin]);

  useEffect(() => {
    void Promise.all([loadCredentials(), loadSessions(), loadIdentities(), loadAdminSessions(), loadRequests()]);
  }, [loadAdminSessions, loadCredentials, loadIdentities, loadRequests, loadSessions]);

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

  const verificationRequired =
    adminSessions.status === "verification_required" || requests.status === "verification_required";

  const unlockProtectedSections = async () => {
    if (!(await verifyNow())) return;
    await Promise.all([loadAdminSessions(), loadRequests()]);
  };

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
      } else {
        await runAction("confirm", () => adminRevokeSession(pending.session.id), "Session revoked.");
        if (sessions.data.some((session) => session.id === pending.session.id && session.current)) signOut();
        else await loadAdminSessions();
      }
      setPendingConfirmation(null);
    } catch {
      // Keep the confirmation open so the user can retry or cancel.
    }
  };

  const decideRequest = async (request: ExternalLinkRequest, approve: boolean) => {
    try {
      await runAction(
        `request-${request.id}`,
        () => decideExternalLinkRequest(request.id, approve),
        approve ? "Identity link approved." : "Identity link rejected.",
      );
      await loadRequests();
    } catch {
      // runAction already exposes the actionable error.
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

  return (
    <div className="space-y-4">
      {verificationRequired ? (
        <PageBanner tone={verificationError ? "error" : "warning"}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{verificationError ?? "Sensitive security data is locked. Verify your identity with a passkey to continue."}</span>
            <UiButton
              variant="secondary"
              size="xs"
              onClick={() => void unlockProtectedSections()}
              loading={verifying}
            >
              Verify with passkey
            </UiButton>
          </div>
        </PageBanner>
      ) : null}
      {actionError ? <PageBanner tone="error">{actionError}</PageBanner> : null}
      {actionMessage ? <PageBanner tone="success">{actionMessage}</PageBanner> : null}

      <UiCard
        title="Passkeys"
        description="Passkeys require user verification for sensitive actions."
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
                <UiButton variant="danger" size="xs" onClick={() => setPendingConfirmation({ kind: "revoke-credential", credential })}>
                  Revoke
                </UiButton>
              </li>
            ))}
          </ul>
        </SecuritySectionState>
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
        description="Revoking an identity requires recent passkey verification and signs out every session."
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
                <UiButton variant="danger" size="xs" onClick={() => setPendingConfirmation({ kind: "revoke-identity", identity })}>
                  Revoke and sign out
                </UiButton>
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

      {superAdmin ? (
        <>
          <UiCard title="All active sessions" description="Review and revoke sessions across the platform.">
            <SecuritySectionState
              status={adminSessions.status}
              error={adminSessions.error}
              loadingLabel="Loading active sessions..."
              emptyLabel="No additional active sessions."
              isEmpty={adminSessions.data.length === 0}
              onRetry={() => void loadAdminSessions()}
            >
              <ul className="space-y-2">
                {adminSessions.data.map((session) => (
                  <li key={session.id} className={cx("flex flex-wrap items-start justify-between gap-3 px-3 py-2", uiPanelMutedClass)}>
                    <span className="ui-body">
                      <strong>{session.user_id ? `User #${session.user_id}` : `S3 session ${session.s3_session_id ?? session.id}`}</strong><br />
                      <span className={uiMutedTextClass}>{session.ip_address ?? "Unknown address"} · {formatDate(session.last_activity_at)}</span>
                    </span>
                    <UiButton variant="danger" size="xs" onClick={() => setPendingConfirmation({ kind: "revoke-admin-session", session })}>Revoke</UiButton>
                  </li>
                ))}
              </ul>
            </SecuritySectionState>
          </UiCard>

          <UiCard title="External identity link requests" description="Review pending manual matches before linking them to platform users.">
            <SecuritySectionState
              status={requests.status}
              error={requests.error}
              loadingLabel="Loading identity link requests..."
              emptyLabel="No pending identity link requests."
              isEmpty={requests.data.length === 0}
              onRetry={() => void loadRequests()}
            >
              <ul className="space-y-2">
                {requests.data.map((request) => (
                  <li key={request.id} className={cx("flex flex-wrap items-center justify-between gap-3 px-3 py-2", uiPanelMutedClass)}>
                    <span className="ui-body">{request.email} · {request.provider_type}:{request.provider_id}</span>
                    <span className="flex gap-2">
                      <UiButton size="xs" onClick={() => void decideRequest(request, true)} loading={pendingAction === `request-${request.id}`}>Approve</UiButton>
                      <UiButton variant="danger" size="xs" onClick={() => void decideRequest(request, false)} disabled={pendingAction === `request-${request.id}`}>Reject</UiButton>
                    </span>
                  </li>
                ))}
              </ul>
            </SecuritySectionState>
          </UiCard>
        </>
      ) : null}

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
