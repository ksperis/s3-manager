/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { listMinimalS3Accounts, type S3AccountSummary } from "../../api/accounts";
import { listMinimalUsers, type UserSummary } from "../../api/users";
import {
  addAdminPortalRequestMessage,
  approveAdminPortalRequest,
  listAdminPortalRequests,
  rejectAdminPortalRequest,
  type PortalAdminRequest,
  type PortalAdminRequestStatus,
  type PortalAdminRequestType,
} from "../../api/portalRequests";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import ListPageSection from "../../components/list/ListPageSection";
import PageBanner from "../../components/PageBanner";
import PageShell from "../../components/PageShell";
import UserAvatar from "../../components/UserAvatar";
import UiButton from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import {
  cx,
  uiDividerClass,
  uiInputClass,
  uiLabelClass,
  uiMutedTextClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import {
  formatPortalRequestDate,
  PortalRequestStatusBadge,
  portalRequestPayloadSummary,
  portalRequestReason,
  portalRequestTypeLabel,
} from "../shared/portalRequestsPresentation";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import { AssociationRoleTooltip, uiPrincipalRoleLabel } from "./AssociationSummary";
import { buildAdminPrincipalEditHref } from "./adminPrincipalEditLink";

type StatusFilter = PortalAdminRequestStatus | "all";
type TypeFilter = PortalAdminRequestType | "all";
type BusyAction = string | null;

export default function AdminPortalRequestsPage() {
  const [requests, setRequests] = useState<PortalAdminRequest[]>([]);
  const [accounts, setAccounts] = useState<S3AccountSummary[]>([]);
  const [requesters, setRequesters] = useState<UserSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [messageDrafts, setMessageDrafts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);

  useEffect(() => {
    let cancelled = false;
    listMinimalS3Accounts()
      .then((items) => {
        if (!cancelled) setAccounts(items);
      })
      .catch(() => {
        if (!cancelled) setAccounts([]);
      });
    listMinimalUsers()
      .then((items) => {
        if (!cancelled) setRequesters(items);
      })
      .catch(() => {
        if (!cancelled) setRequesters([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const requestersById = useMemo(
    () => new Map(requesters.map((requester) => [requester.id, requester])),
    [requesters],
  );

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listAdminPortalRequests({
        status: statusFilter,
        request_type: typeFilter,
        account_id: accountFilter === "all" ? "all" : Number(accountFilter),
        search,
        limit: 200,
      });
      setRequests(data);
      setExpandedId((current) => (current && data.some((request) => request.id === current) ? current : null));
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, "Unable to load Portal requests."));
    } finally {
      setLoading(false);
    }
  }, [accountFilter, search, statusFilter, typeFilter]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const updateRequest = (updated: PortalAdminRequest) => {
    setRequests((current) => current.map((request) => (request.id === updated.id ? updated : request)));
    setExpandedId(updated.id);
  };

  const runAction = useCallback(async (
    request: PortalAdminRequest,
    action: "approve" | "reject" | "message"
  ) => {
    const draft = messageDrafts[request.id]?.trim() || "";
    setBusy(`${action}:${request.id}`);
    setError(null);
    setNotice(null);
    try {
      const updated =
        action === "approve"
          ? await approveAdminPortalRequest(request.id, { message: draft || null })
          : action === "reject"
            ? await rejectAdminPortalRequest(request.id, { message: draft || null })
            : await addAdminPortalRequestMessage(request.id, { message: draft });
      updateRequest(updated);
      setMessageDrafts((current) => ({ ...current, [request.id]: "" }));
      setNotice("Request updated.");
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, "Unable to update Portal request."));
      await loadRequests();
    } finally {
      setBusy(null);
    }
  }, [loadRequests, messageDrafts]);

  const columns = useMemo<Array<DataTableColumn<PortalAdminRequest>>>(
    () => [
      {
        id: "request",
        label: "Request",
        primary: true,
        render: (request) => (
          <div className="min-w-0">
            <p className={cx("truncate ui-body", uiTitleTextClass)}>{portalRequestTypeLabel(request.request_type)}</p>
            <p className={cx("mt-1 truncate ui-caption", uiMutedTextClass)}>{portalRequestPayloadSummary(request)}</p>
          </div>
        ),
      },
      {
        id: "status",
        label: "Status",
        render: (request) => <PortalRequestStatusBadge status={request.status} />,
      },
      {
        id: "account",
        label: "Account",
        render: (request) => request.account_name ?? request.account_id,
      },
      {
        id: "requester",
        label: "Requester",
        render: (request) => {
          const requester = request.requester_user_id != null
            ? requestersById.get(request.requester_user_id)
            : undefined;
          const label = requester?.display_name || requester?.full_name || request.requester_email;
          const roleLabel = uiPrincipalRoleLabel(requester?.role);
          const badge = (
            <>
              <UserAvatar
                name={label}
                email={request.requester_email}
                avatar={requester?.avatar}
                size="sm"
                decorative
              />
              <span className="min-w-0 truncate">{request.requester_email}</span>
            </>
          );
          const classes = "inline-flex max-w-full items-center gap-2 rounded-full bg-slate-100 pr-2.5 ui-caption font-semibold text-slate-800 transition dark:bg-slate-800 dark:text-slate-100";
          if (request.requester_user_id == null) {
            return (
              <AssociationRoleTooltip
                label="Requester"
                entries={[{ key: request.requester_email, identity: `${label} · ${request.requester_email}`, roles: [roleLabel] }]}
                ariaLabel={`${request.requester_email}, role ${roleLabel}`}
                focusable
              >
                <span className={classes}>{badge}</span>
              </AssociationRoleTooltip>
            );
          }
          return (
            <AssociationRoleTooltip
              label="Requester"
              entries={[{ key: String(request.requester_user_id), identity: `${label} · ${request.requester_email}`, roles: [roleLabel] }]}
              ariaLabel={`${request.requester_email}, role ${roleLabel}`}
            >
              <a
                href={buildAdminPrincipalEditHref({
                  id: request.requester_user_id,
                  kind: "user",
                  search: request.requester_email,
                })}
                aria-label={`Edit UI user ${label}`}
                className={`${classes} hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50`}
              >
                {badge}
              </a>
            </AssociationRoleTooltip>
          );
        },
      },
      {
        id: "created",
        label: "Created",
        render: (request) => formatPortalRequestDate(request.created_at),
      },
      {
        id: "actions",
        label: "Actions",
        align: "right",
        mobileRole: "actions",
        render: (request) => (
          <div className="flex flex-wrap justify-end gap-2">
            <UiButton size="xs" variant="secondary" onClick={() => setExpandedId((current) => (current === request.id ? null : request.id))}>
              Details
            </UiButton>
            {request.status === "pending" ? (
              <>
                <UiButton
                  size="xs"
                  onClick={() => void runAction(request, "approve")}
                  loading={busy === `approve:${request.id}`}
                >
                  Approve
                </UiButton>
                <UiButton
                  size="xs"
                  variant="danger"
                  onClick={() => void runAction(request, "reject")}
                  loading={busy === `reject:${request.id}`}
                >
                  Reject
                </UiButton>
              </>
            ) : null}
          </div>
        ),
      },
    ],
    [busy, requestersById, runAction]
  );

  const tableStatus = resolveListTableStatus({ loading, error, rowCount: requests.length });

  return (
    <PageShell
      title="Portal requests"
      description="Review Portal user and quota requests submitted by storage workspace users."
      breadcrumbs={adminPageBreadcrumbs("portal-requests")}
    >
      {notice ? <PageBanner tone="success">{notice}</PageBanner> : null}
      {error ? <PageBanner tone="error">{error}</PageBanner> : null}

      <ListPageSection
          title="Request queue"
          showHeading
          countLabel={`${requests.length} request(s)`}
          search={
            <UiInput
              aria-label="Search Portal requests"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search requester, account, or payload"
              size="compact"
              fieldClassName="min-w-[220px]"
            />
          }
          filters={
            <>
              <UiSelect
                aria-label="Filter by status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                size="compact"
              >
                <option value="pending">Pending</option>
                <option value="processing">Processing</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="failed">Failed</option>
                <option value="all">All statuses</option>
              </UiSelect>
              <UiSelect
                aria-label="Filter by type"
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value as TypeFilter)}
                size="compact"
              >
                <option value="all">All types</option>
                <option value="portal_user_access">Add Portal user</option>
                <option value="portal_user_removal">Remove Portal user</option>
                <option value="account_quota_change">Storage quota</option>
              </UiSelect>
              <UiSelect
                aria-label="Filter by account"
                value={accountFilter}
                onChange={(event) => setAccountFilter(event.target.value)}
                size="compact"
              >
                <option value="all">All accounts</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.db_id ?? account.id}>
                    {account.name}
                  </option>
                ))}
              </UiSelect>
            </>
          }
          actions={
            <UiButton size="sm" variant="secondary" onClick={() => void loadRequests()} loading={loading}>
              Refresh
            </UiButton>
          }
      >
        <DataTableShell
          columns={columns}
          rows={requests}
          rowKey={(request) => request.id}
          status={tableStatus}
          loadingMessage="Loading Portal requests..."
          errorMessage={error ?? "Unable to load Portal requests."}
          emptyMessage="No Portal requests match the current filters."
          responsiveCards
          expandedRow={(request) =>
            expandedId === request.id ? (
              <AdminPortalRequestDetails
                request={request}
                draft={messageDrafts[request.id] ?? ""}
                busy={busy}
                onDraftChange={(value) => setMessageDrafts((current) => ({ ...current, [request.id]: value }))}
                onAction={(action) => void runAction(request, action)}
              />
            ) : null
          }
        />
      </ListPageSection>
    </PageShell>
  );
}

function AdminPortalRequestDetails({
  request,
  draft,
  busy,
  onDraftChange,
  onAction,
}: {
  request: PortalAdminRequest;
  draft: string;
  busy: BusyAction;
  onDraftChange: (value: string) => void;
  onAction: (action: "approve" | "reject" | "message") => void;
}) {
  const reason = portalRequestReason(request);
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-3">
        <DetailItem label="Type" value={portalRequestTypeLabel(request.request_type)} />
        <DetailItem label="Payload" value={portalRequestPayloadSummary(request)} />
        <DetailItem label="Decision" value={request.decided_by_email ? `${request.decided_by_email} · ${formatPortalRequestDate(request.decided_at)}` : "-"} />
      </div>
      {reason ? <DetailItem label="Reason" value={reason} /> : null}
      {request.error_message ? <PageBanner tone="error">{request.error_message}</PageBanner> : null}
      <div className={cx("border-t pt-3", uiDividerClass)}>
        <p className={uiLabelClass}>Messages</p>
        {request.messages.length > 0 ? (
          <div className="mt-2 grid gap-2">
            {request.messages.map((message) => (
              <div key={message.id}>
                <p className="ui-caption font-semibold text-[var(--ui-text)]">
                  {message.author_email} · {formatPortalRequestDate(message.created_at)}
                </p>
                <p className={cx("mt-1 ui-body", uiMutedTextClass)}>{message.message}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className={cx("mt-2 ui-body", uiMutedTextClass)}>No messages yet.</p>
        )}
      </div>
      <div className={cx("grid gap-3 border-t pt-3", uiDividerClass)}>
        <label className="grid gap-1">
          <span className={uiLabelClass}>Message</span>
          <textarea
            className={cx(uiInputClass, "min-h-[84px] px-3 py-2 ui-body")}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
          />
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <UiButton size="sm" variant="secondary" onClick={() => onAction("message")} disabled={!draft.trim()} loading={busy === `message:${request.id}`}>
            Send message
          </UiButton>
          {request.status === "pending" ? (
            <>
              <UiButton size="sm" onClick={() => onAction("approve")} loading={busy === `approve:${request.id}`}>
                Approve
              </UiButton>
              <UiButton size="sm" variant="danger" onClick={() => onAction("reject")} loading={busy === `reject:${request.id}`}>
                Reject
              </UiButton>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <p className={uiLabelClass}>{label}</p>
      <p className={cx("mt-1 break-words ui-body", uiTitleTextClass)}>{value}</p>
    </div>
  );
}
