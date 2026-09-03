/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useState } from "react";

import {
  addAdminExternalIdentity,
  getAdminUserSecurity,
  resetAdminUserMfa,
  restoreAdminExternalIdentity,
  revokeAdminExternalIdentity,
  revokeAdminUserSession,
  setAdminUserPassword,
  type AdminExternalIdentity,
  type AdminUserSecurity,
  type SecuritySession,
} from "../../api/security";
import {
  isRecentWebAuthnVerificationCancelled,
  useRecentWebAuthnStepUp,
} from "../../auth/useRecentWebAuthnStepUp";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import PageBanner from "../../components/PageBanner";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import UiInput from "../../components/ui/UiInput";
import { cx, uiMutedTextClass, uiPanelMutedClass } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";

type PendingAction =
  | { kind: "reset-mfa" }
  | { kind: "revoke-identity"; identity: AdminExternalIdentity }
  | { kind: "restore-identity"; identity: AdminExternalIdentity }
  | { kind: "revoke-session"; session: SecuritySession };

export default function UserAuthenticationPanel({ userId, canMutate }: { userId: number; canMutate: boolean }) {
  const [security, setSecurity] = useState<AdminUserSecurity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [providerType, setProviderType] = useState<"oidc" | "ldap">("oidc");
  const [providerId, setProviderId] = useState("");
  const [subject, setSubject] = useState("");
  const [identityEmail, setIdentityEmail] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const { runWithStepUp, verificationDialog } = useRecentWebAuthnStepUp();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSecurity(await getAdminUserSecurity(userId));
    } catch (loadError) {
      setError(extractApiError(loadError, "Unable to load authentication details."));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const runAction = async (action: () => Promise<void>, success: string, requiresStepUp = true) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (requiresStepUp) await runWithStepUp(action);
      else await action();
      setMessage(success);
      await load();
    } catch (actionError) {
      if (!isRecentWebAuthnVerificationCancelled(actionError)) {
        setError(extractApiError(actionError, "Unable to update authentication settings."));
      }
      throw actionError;
    } finally {
      setBusy(false);
    }
  };

  const savePassword = async () => {
    if (!password || password !== passwordConfirmation) {
      setError("Enter the same new password in both fields.");
      return;
    }
    try {
      await runAction(() => setAdminUserPassword(userId, password), "Local password updated and user sessions revoked.");
      setPassword("");
      setPasswordConfirmation("");
    } catch {
      // Error is displayed by runAction.
    }
  };

  const addIdentity = async () => {
    if (!providerId.trim() || !subject.trim()) {
      setError("Provider ID and immutable subject are required.");
      return;
    }
    try {
      await runAction(
        async () => { await addAdminExternalIdentity(userId, {
          provider_type: providerType,
          provider_id: providerId,
          subject,
          email: identityEmail || null,
          email_verified: providerType === "oidc" && Boolean(identityEmail),
        }); },
        "External identity linked.",
      );
      setProviderId("");
      setSubject("");
      setIdentityEmail("");
    } catch {
      // Error is displayed by runAction.
    }
  };

  const confirmPending = async () => {
    if (!pending) return;
    try {
      if (pending.kind === "reset-mfa") {
        await runAction(() => resetAdminUserMfa(userId), "MFA reset completed. Sessions and API tokens were revoked.");
      } else if (pending.kind === "revoke-identity") {
        await runAction(() => revokeAdminExternalIdentity(userId, pending.identity.id), "External identity revoked.");
      } else if (pending.kind === "restore-identity") {
        await runAction(() => restoreAdminExternalIdentity(userId, pending.identity.id), "External identity restored.");
      } else {
        await runAction(() => revokeAdminUserSession(userId, pending.session.id), "Session revoked.", false);
      }
      setPending(null);
    } catch {
      // Keep the confirmation open for retry.
    }
  };

  return (
    <div className="space-y-4">
      {loading ? <PageBanner tone="info">Loading authentication details...</PageBanner> : null}
      {error ? (
        <PageBanner tone="error">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <UiButton size="xs" variant="secondary" disabled={loading || busy} onClick={() => void load()}>Retry</UiButton>
          </div>
        </PageBanner>
      ) : null}
      {message ? <PageBanner tone="success">{message}</PageBanner> : null}
      <PageBanner tone="info">
        {canMutate
          ? "Authentication changes in this tab are applied immediately; there is no separate user-form save step."
          : "Use your personal Security page to manage your own authentication methods."}
      </PageBanner>

      <UiCard
        title="Passkeys and MFA"
        description={security?.passkey_required ? "A passkey is required for this user's role." : "Passkey enrollment is optional for this user's role."}
        actions={canMutate ? <UiButton size="xs" variant="danger" disabled={busy} onClick={() => setPending({ kind: "reset-mfa" })}>Reset MFA</UiButton> : undefined}
      >
        {security && security.passkeys.length === 0 ? <p className={uiMutedTextClass}>No passkeys registered.</p> : null}
        <ul className="space-y-2">
          {security?.passkeys.map((passkey) => (
            <li key={passkey.id} className={cx("px-3 py-2 ui-body", uiPanelMutedClass)}>
              <strong>{passkey.name}</strong> · {passkey.revoked_at ? "Revoked" : "Active"}
            </li>
          ))}
        </ul>
      </UiCard>

      <UiCard title="Local password" description={security?.has_local_password ? "A local password is configured." : "No local password is configured."}>
        {canMutate ? (
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <UiInput label="New password" hint="At least 12 characters." type="password" minLength={12} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
            <UiInput label="Confirm password" type="password" minLength={12} autoComplete="new-password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} />
            <UiButton size="sm" loading={busy} onClick={() => void savePassword()}>Set password</UiButton>
          </div>
        ) : null}
      </UiCard>

      <UiCard title="External identities" description="Active and revoked immutable provider subjects are managed here.">
        <ul className="space-y-2">
          {security?.external_identities.map((identity) => (
            <li key={identity.id} className={cx("flex flex-wrap items-start justify-between gap-3 px-3 py-2", uiPanelMutedClass)}>
              <span className="ui-body min-w-0">
                <strong>{identity.provider_type}:{identity.provider_id}</strong><br />
                <code className="break-all text-xs">{identity.subject}</code><br />
                <span className={uiMutedTextClass}>{identity.revoked_at ? "Revoked" : "Active"} · {identity.link_source}</span>
              </span>
              {canMutate ? (
                identity.revoked_at
                  ? <UiButton size="xs" variant="secondary" disabled={busy} onClick={() => setPending({ kind: "restore-identity", identity })}>Restore</UiButton>
                  : <UiButton size="xs" variant="danger" disabled={busy} onClick={() => setPending({ kind: "revoke-identity", identity })}>Revoke</UiButton>
              ) : null}
            </li>
          ))}
        </ul>
        {security && security.external_identities.length === 0 ? <p className={uiMutedTextClass}>No external identities.</p> : null}
        {canMutate ? (
          <div className="mt-4 grid gap-3 border-t border-[color:var(--ui-border)] pt-4 md:grid-cols-2">
            <label className="ui-body font-medium">Provider type
              <select className="ui-control mt-1 w-full" value={providerType} onChange={(event) => setProviderType(event.target.value as "oidc" | "ldap")}>
                <option value="oidc">OIDC</option><option value="ldap">LDAP</option>
              </select>
            </label>
            <UiInput label="Provider ID" value={providerId} onChange={(event) => setProviderId(event.target.value)} />
            <UiInput label="Immutable subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
            <UiInput label="Claimed email (optional)" type="email" value={identityEmail} onChange={(event) => setIdentityEmail(event.target.value)} />
            <div><UiButton size="sm" loading={busy} onClick={() => void addIdentity()}>Link identity</UiButton></div>
          </div>
        ) : null}
      </UiCard>

      <UiCard title="User sessions">
        <ul className="space-y-2">
          {security?.sessions.map((session) => (
            <li key={session.id} className={cx("flex flex-wrap items-center justify-between gap-3 px-3 py-2", uiPanelMutedClass)}>
              <span className="ui-body">{session.auth_type} · {session.ip_address ?? "Unknown address"}</span>
              {canMutate && !session.revoked_at ? <UiButton size="xs" variant="danger" disabled={busy} onClick={() => setPending({ kind: "revoke-session", session })}>Revoke</UiButton> : null}
            </li>
          ))}
        </ul>
        {security && security.sessions.length === 0 ? <p className={uiMutedTextClass}>No sessions.</p> : null}
      </UiCard>

      {pending ? (
        <ConfirmActionDialog
          title={pending.kind === "reset-mfa" ? "Reset user MFA" : pending.kind === "revoke-session" ? "Revoke user session" : pending.kind === "restore-identity" ? "Restore external identity" : "Revoke external identity"}
          description={pending.kind === "reset-mfa" ? "Passkeys, recovery codes and authentication challenges will be removed. All sessions and API tokens will be revoked." : "This security change revokes the user's active sessions."}
          confirmLabel={pending.kind === "reset-mfa" ? "Reset MFA" : pending.kind === "restore-identity" ? "Restore identity" : "Confirm"}
          loading={busy}
          onCancel={() => setPending(null)}
          onConfirm={() => void confirmPending()}
        />
      ) : null}
      {verificationDialog}
    </div>
  );
}
