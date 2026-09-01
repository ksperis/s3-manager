/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useState } from "react";

import {
  adminRevokeSession,
  decideExternalLinkRequest,
  listAdminSessions,
  listExternalLinkRequests,
  type AdminSecuritySession,
  type ExternalLinkRequest,
} from "../../api/security";
import { useRecentWebAuthnStepUp } from "../../auth/useRecentWebAuthnStepUp";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import PageBanner from "../../components/PageBanner";
import PageShell from "../../components/PageShell";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import { cx, uiMutedTextClass, uiPanelMutedClass } from "../../components/ui/styles";
import { extractApiError, isRecentWebAuthnRequired } from "../../utils/apiError";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";

type PendingLinkDecision = {
  request: ExternalLinkRequest;
  approve: boolean;
};

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export default function IdentitySecurityPage() {
  const [sessions, setSessions] = useState<AdminSecuritySession[]>([]);
  const [requests, setRequests] = useState<ExternalLinkRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingLinkDecision, setPendingLinkDecision] = useState<PendingLinkDecision | null>(null);
  const [pendingSession, setPendingSession] = useState<AdminSecuritySession | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { runWithStepUp, verificationDialog, verifyNow, verifying, verificationError } = useRecentWebAuthnStepUp();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextSessions, nextRequests] = await Promise.all([
        listAdminSessions(),
        listExternalLinkRequests(),
      ]);
      setSessions(nextSessions);
      setRequests(nextRequests);
      setLocked(false);
    } catch (loadError) {
      if (isRecentWebAuthnRequired(loadError)) {
        setLocked(true);
      } else {
        setError(extractApiError(loadError, "Unable to load identity security data."));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const unlock = async () => {
    if (await verifyNow()) await load();
  };

  const decide = async () => {
    if (!pendingLinkDecision) return;
    const { request, approve } = pendingLinkDecision;
    setBusy(request.id);
    setError(null);
    try {
      await runWithStepUp(() => decideExternalLinkRequest(request.id, approve));
      setPendingLinkDecision(null);
      setMessage(approve ? "Identity link approved." : "Identity link rejected.");
      await load();
    } catch (actionError) {
      setError(extractApiError(actionError, "Unable to update the identity request."));
    } finally {
      setBusy(null);
    }
  };

  const showData = !loading && !locked && !error;

  const revokeSession = async () => {
    if (!pendingSession) return;
    setBusy(pendingSession.id);
    setError(null);
    try {
      await runWithStepUp(() => adminRevokeSession(pendingSession.id));
      setPendingSession(null);
      setMessage("Session revoked.");
      await load();
    } catch (actionError) {
      setError(extractApiError(actionError, "Unable to revoke the session."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <PageShell
      title="Identity security"
      description="Review external identity matches and active sessions within your administrative scope."
      breadcrumbs={adminPageBreadcrumbs("identity-security")}
    >
      {locked ? (
        <PageBanner tone={verificationError ? "error" : "warning"}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{verificationError ?? "Verify with a passkey to view sensitive identity and session data."}</span>
            <UiButton size="xs" variant="secondary" loading={verifying} onClick={() => void unlock()}>
              Verify with passkey
            </UiButton>
          </div>
        </PageBanner>
      ) : null}
      {error ? (
        <PageBanner tone="error">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <UiButton size="xs" variant="secondary" onClick={() => void load()}>Retry</UiButton>
          </div>
        </PageBanner>
      ) : null}
      {message ? <PageBanner tone="success">{message}</PageBanner> : null}
      {loading ? <PageBanner tone="info">Loading identity security data...</PageBanner> : null}

      {showData ? (
        <>
          <UiCard title="External identity link requests" description="Manual decisions are used when an identity cannot be linked safely by policy.">
            {requests.length === 0 ? <p className={uiMutedTextClass}>No pending identity link requests.</p> : null}
            <ul className="space-y-2">
              {requests.map((request) => (
                <li key={request.id} className={cx("flex flex-wrap items-start justify-between gap-3 px-3 py-2", uiPanelMutedClass)}>
                  <span className="ui-body">
                    <strong>{request.user_email}</strong><br />
                    <span className={uiMutedTextClass}>
                      {request.provider_type}:{request.provider_id} · {request.user_role}<br />
                      Claimed email: {request.email} · Expires: {formatDate(request.expires_at)}
                    </span>
                  </span>
                  <span className="flex gap-2">
                    <UiButton size="xs" disabled={busy === request.id} onClick={() => setPendingLinkDecision({ request, approve: true })}>Approve</UiButton>
                    <UiButton size="xs" variant="danger" disabled={busy === request.id} onClick={() => setPendingLinkDecision({ request, approve: false })}>Reject</UiButton>
                  </span>
                </li>
              ))}
            </ul>
          </UiCard>

          <UiCard title="Platform sessions" description="Only sessions belonging to users inside your administrative scope are shown.">
            {sessions.length === 0 ? <p className={uiMutedTextClass}>No active sessions.</p> : null}
            <ul className="space-y-2">
              {sessions.map((session) => (
                <li key={session.id} className={cx("flex flex-wrap items-start justify-between gap-3 px-3 py-2", uiPanelMutedClass)}>
                  <span className="ui-body">
                    <strong>{session.user_full_name || session.user_email || (session.user_id ? `User #${session.user_id}` : `S3 session ${session.s3_session_id ?? session.id}`)}</strong><br />
                    <span className={uiMutedTextClass}>
                      {[session.user_full_name ? session.user_email : null, session.user_role, session.ip_address ?? "Unknown address", formatDate(session.last_activity_at)]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {!session.revoked_at ? <UiButton size="xs" variant="danger" onClick={() => setPendingSession(session)}>Revoke</UiButton> : null}
                </li>
              ))}
            </ul>
          </UiCard>
        </>
      ) : null}

      {pendingLinkDecision ? (
        <ConfirmActionDialog
          title={pendingLinkDecision.approve ? "Approve identity link" : "Reject identity link request"}
          description={pendingLinkDecision.approve
            ? "This external identity will be linked to the selected local account."
            : "This request will be closed without linking the external identity."}
          confirmLabel={pendingLinkDecision.approve ? "Approve link" : "Reject request"}
          tone={pendingLinkDecision.approve ? "primary" : "danger"}
          loading={busy === pendingLinkDecision.request.id}
          details={[
            { label: "Local account", value: pendingLinkDecision.request.user_email },
            { label: "Provider", value: `${pendingLinkDecision.request.provider_type}:${pendingLinkDecision.request.provider_id}` },
            { label: "Claimed email", value: pendingLinkDecision.request.email },
          ]}
          onCancel={() => setPendingLinkDecision(null)}
          onConfirm={() => void decide()}
        />
      ) : null}

      {pendingSession ? (
        <ConfirmActionDialog
          title="Revoke session"
          description="This session will lose access immediately."
          confirmLabel="Revoke session"
          loading={busy === pendingSession.id}
          details={[{ label: "Session", value: pendingSession.id }]}
          onCancel={() => setPendingSession(null)}
          onConfirm={() => void revokeSession()}
        />
      ) : null}
      {verificationDialog}
    </PageShell>
  );
}
