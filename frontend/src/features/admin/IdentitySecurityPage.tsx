/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useMemo, useState } from "react";

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
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import ListPageSection from "../../components/list/ListPageSection";
import PageBanner from "../../components/PageBanner";
import PageControlStrip from "../../components/PageControlStrip";
import PageShell from "../../components/PageShell";
import PageTabs from "../../components/PageTabs";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import { cx, type UiTone, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { extractApiError, isRecentWebAuthnRequired } from "../../utils/apiError";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import { uiPrincipalRoleLabel } from "./AssociationSummary";

type PendingLinkDecision = {
  request: ExternalLinkRequest;
  approve: boolean;
};

type IdentitySecurityView = "requests" | "sessions";

const AUTH_TYPE_LABELS: Record<string, string> = {
  ldap: "LDAP",
  oidc: "OIDC",
  passkey: "Passkey",
  password: "Password",
  s3: "S3 access key",
  s3_session: "S3 access key",
  webauthn: "Passkey",
};

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function roleTone(role?: string | null): UiTone {
  if (role === "ui_superadmin" || role === "ui_admin") return "primary";
  if (role === "ui_none") return "warning";
  return "neutral";
}

function authenticationLabel(authType: string): string {
  return AUTH_TYPE_LABELS[authType.toLowerCase()] ?? authType.replaceAll("_", " ");
}

function providerLabel(providerType: string): string {
  const normalized = providerType.toLowerCase();
  if (normalized === "oidc") return "OIDC";
  if (normalized === "ldap") return "LDAP";
  return providerType.toUpperCase();
}

function sessionPrincipalLabel(session: AdminSecuritySession): string {
  if (session.user_full_name) return session.user_full_name;
  if (session.user_email) return session.user_email;
  if (session.user_id) return `User #${session.user_id}`;
  return "S3 session";
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export default function IdentitySecurityPage() {
  const [activeView, setActiveView] = useState<IdentitySecurityView>("requests");
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

  const requestColumns = useMemo<Array<DataTableColumn<ExternalLinkRequest>>>(
    () => [
      {
        id: "account",
        label: "Local account",
        primary: true,
        render: (request) => (
          <div className="min-w-0 space-y-1">
            <p className={cx("break-all", uiTitleTextClass)}>{request.user_email}</p>
            <UiBadge tone={roleTone(request.user_role)}>{uiPrincipalRoleLabel(request.user_role)}</UiBadge>
          </div>
        ),
      },
      {
        id: "provider",
        label: "Provider",
        render: (request) => (
          <div className="min-w-0 space-y-1">
            <UiBadge tone="info">{providerLabel(request.provider_type)}</UiBadge>
            <p className={cx("break-all ui-caption", uiMutedTextClass)}>{request.provider_id}</p>
          </div>
        ),
      },
      {
        id: "claimed-email",
        label: "Claimed email",
        render: (request) => <span className="break-all">{request.email}</span>,
      },
      {
        id: "expires",
        label: "Expires",
        render: (request) => <time dateTime={request.expires_at}>{formatDate(request.expires_at)}</time>,
      },
      {
        id: "actions",
        label: "Actions",
        align: "right",
        mobileRole: "actions",
        render: (request) => (
          <div className="flex flex-wrap justify-end gap-2">
            <UiButton
              size="xs"
              disabled={busy === request.id}
              onClick={() => setPendingLinkDecision({ request, approve: true })}
            >
              Approve
            </UiButton>
            <UiButton
              size="xs"
              variant="danger"
              disabled={busy === request.id}
              onClick={() => setPendingLinkDecision({ request, approve: false })}
            >
              Reject
            </UiButton>
          </div>
        ),
      },
    ],
    [busy],
  );

  const sessionColumns = useMemo<Array<DataTableColumn<AdminSecuritySession>>>(
    () => [
      {
        id: "user",
        label: "User",
        primary: true,
        render: (session) => (
          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p className={cx("truncate", uiTitleTextClass)}>{sessionPrincipalLabel(session)}</p>
              {session.current ? <UiBadge tone="success">Current</UiBadge> : null}
            </div>
            <p className={cx("break-all ui-caption", uiMutedTextClass)}>
              {session.user_full_name && session.user_email
                ? session.user_email
                : session.s3_session_id ?? session.user_email ?? session.id}
            </p>
          </div>
        ),
      },
      {
        id: "authentication",
        label: "Authentication",
        mobileLabel: "Auth method",
        render: (session) => (
          <span className="inline-flex justify-self-start">
            <UiBadge tone="info">{authenticationLabel(session.auth_type)}</UiBadge>
          </span>
        ),
      },
      {
        id: "role",
        label: "Role",
        render: (session) => session.user_role
          ? (
              <span className="inline-flex justify-self-start">
                <UiBadge tone={roleTone(session.user_role)}>{uiPrincipalRoleLabel(session.user_role)}</UiBadge>
              </span>
            )
          : <span className={uiMutedTextClass}>Not applicable</span>,
      },
      {
        id: "network",
        label: "Network",
        render: (session) => session.ip_address ?? <span className={uiMutedTextClass}>Unknown</span>,
      },
      {
        id: "activity",
        label: "Last activity",
        render: (session) => <time dateTime={session.last_activity_at}>{formatDate(session.last_activity_at)}</time>,
      },
      {
        id: "actions",
        label: "Actions",
        align: "right",
        mobileRole: "actions",
        render: (session) => session.revoked_at
          ? <UiBadge>Revoked</UiBadge>
          : <UiButton size="xs" variant="danger" onClick={() => setPendingSession(session)}>Revoke</UiButton>,
      },
    ],
    [],
  );

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
      title="Identity Security"
      description="Review external identity link requests and manage active platform sessions within your administrative scope."
      breadcrumbs={adminPageBreadcrumbs("identity-security")}
      rightContent={(
        <UiButton size="xs" variant="secondary" loading={loading} onClick={() => void load()}>
          Refresh
        </UiButton>
      )}
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
          <PageControlStrip
            className="max-sm:hidden"
            label="Administrative scope"
            title="Identity and session overview"
            description="Counts include only the users and sessions your administrator role is allowed to manage."
            items={[
              { label: "Pending link requests", value: requests.length, tone: requests.length > 0 ? "warning" : "success" },
              { label: "Active sessions", value: sessions.length },
              {
                label: "Privileged sessions",
                value: sessions.filter((session) => session.user_role === "ui_admin" || session.user_role === "ui_superadmin").length,
                tone: "primary",
              },
              {
                label: "S3 sessions",
                value: sessions.filter((session) => session.principal_type === "s3" || session.s3_session_id).length,
              },
            ]}
          />

          <PageTabs
            activeTab={activeView}
            onChange={(view) => setActiveView(view as IdentitySecurityView)}
            variant="line"
            ariaLabel="Identity security views"
            idPrefix="identity-security"
            tabs={[
              {
                id: "requests",
                label: `Link requests (${requests.length})`,
                content: (
                  <ListPageSection
                    title="External identity link requests"
                    description="Decide only when the external identity and local account have been verified through a trusted channel."
                    countLabel={countLabel(requests.length, "pending request")}
                    showHeading
                  >
                    <DataTableShell
                      columns={requestColumns}
                      rows={requests}
                      rowKey={(request) => request.id}
                      status={resolveListTableStatus({ loading, error, rowCount: requests.length })}
                      loadingMessage="Loading identity link requests..."
                      errorMessage="Unable to load identity link requests."
                      emptyMessage="No pending identity link requests."
                      primaryColumnId="account"
                      responsiveCards
                      tableClassName="compact-table"
                      rowClassName="bg-white/80 hover:bg-slate-50 dark:bg-transparent dark:hover:bg-slate-900/50"
                    />
                  </ListPageSection>
                ),
              },
              {
                id: "sessions",
                label: `Active sessions (${sessions.length})`,
                content: (
                  <ListPageSection
                    title="Platform sessions"
                    description="Revoke a session to remove its access immediately. Only sessions inside your administrative scope are shown."
                    countLabel={countLabel(sessions.length, "active session")}
                    showHeading
                  >
                    <DataTableShell
                      columns={sessionColumns}
                      rows={sessions}
                      rowKey={(session) => session.id}
                      status={resolveListTableStatus({ loading, error, rowCount: sessions.length })}
                      loadingMessage="Loading platform sessions..."
                      errorMessage="Unable to load platform sessions."
                      emptyMessage="No active sessions."
                      primaryColumnId="user"
                      responsiveCards
                      tableClassName="compact-table"
                      rowClassName="bg-white/80 hover:bg-slate-50 dark:bg-transparent dark:hover:bg-slate-900/50"
                    />
                  </ListPageSection>
                ),
              },
            ]}
          />
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
