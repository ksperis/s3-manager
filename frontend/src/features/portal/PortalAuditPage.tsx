/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import { PortalAuditLogEntry, listPortalAuditLogs } from "../../api/portal";
import { usePortalAccountContext } from "./PortalAccountContext";

function RoleBadge({ role }: { role: string }) {
  const base = "inline-flex items-center rounded-full px-2 py-0.5 ui-caption font-semibold";
  if (role === "ui_admin") {
    return <span className={`${base} bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200`}>Admin</span>;
  }
  if (role === "ui_user") {
    return <span className={`${base} bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100`}>User</span>;
  }
  return <span className={`${base} bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-200`}>{role}</span>;
}

function MetadataPreview({ metadata }: { metadata?: Record<string, unknown> | null }) {
  if (!metadata || Object.keys(metadata).length === 0) {
    return <span className="ui-caption text-slate-500 dark:text-slate-400">-</span>;
  }
  return (
    <pre className="max-h-36 overflow-auto rounded-lg bg-slate-50 px-3 py-2 ui-caption leading-relaxed text-slate-700 dark:bg-slate-900/60 dark:text-slate-200">
      {JSON.stringify(metadata, null, 2)}
    </pre>
  );
}

export default function PortalAuditPage() {
  const { accountIdForApi, portalContext } = usePortalAccountContext();
  const [logs, setLogs] = useState<PortalAuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [nextCursor, setNextCursor] = useState<number | null>(null);

  const canView = portalContext?.permissions?.includes("portal.audit.view") ?? false;

  const fetchLogs = useCallback(
    async ({ append = false, cursor }: { append?: boolean; cursor?: number | null } = {}) => {
      if (!accountIdForApi || !canView) return;
      const response = await listPortalAuditLogs(accountIdForApi, {
        limit: 100,
        cursor: cursor ?? undefined,
        search: searchTerm.trim() || undefined,
      });
      if (append) {
        setLogs((prev) => [...prev, ...response.logs]);
      } else {
        setLogs(response.logs);
      }
      setNextCursor(response.next_cursor ?? null);
    },
    [accountIdForApi, canView, searchTerm]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        setLogs([]);
        setNextCursor(null);
        await fetchLogs({ append: false });
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          setError("Unable to load audit logs.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchLogs]);

  const handleLoadMore = async () => {
    if (!nextCursor || !accountIdForApi) return;
    try {
      setLoadingMore(true);
      await fetchLogs({ append: true, cursor: nextCursor });
    } catch (err) {
      console.error(err);
      setError("Unable to load older logs.");
    } finally {
      setLoadingMore(false);
    }
  };

  const hasMore = Boolean(nextCursor);
  const isEmpty = !loading && logs.length === 0;

  const filters = useMemo(
    () => (
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search by actor, action, target, or message"
          className="min-w-[220px] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 ui-body text-slate-700 shadow-sm transition focus:border-primary focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        <button
          type="button"
          onClick={() => fetchLogs({ append: false })}
          disabled={loading || !canView}
          className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Refresh
        </button>
      </div>
    ),
    [fetchLogs, loading, searchTerm, canView]
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Audit" description="Account-scoped portal audit trail." rightContent={filters} />

      {!canView && <PageBanner tone="warning">You do not have permission to view audit logs.</PageBanner>}
      {error && <PageBanner tone="error">{error}</PageBanner>}
      {loading && <PageBanner tone="info">Loading…</PageBanner>}
      {isEmpty && canView && <PageBanner tone="info">No audit logs found.</PageBanner>}

      {logs.length > 0 && (
        <div className="space-y-3">
          {logs.map((log) => (
            <div
              key={log.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <RoleBadge role={log.user_role} />
                  <span className="ui-caption font-semibold text-slate-700 dark:text-slate-200">{log.user_email}</span>
                  <span className="ui-caption text-slate-500 dark:text-slate-400">•</span>
                  <span className="ui-caption font-semibold text-slate-700 dark:text-slate-200">{log.action}</span>
                  {log.entity_type && (
                    <>
                      <span className="ui-caption text-slate-500 dark:text-slate-400">•</span>
                      <span className="ui-caption text-slate-600 dark:text-slate-300">
                        {log.entity_type}:{log.entity_id ?? "-"}
                      </span>
                    </>
                  )}
                </div>
                <div className="ui-caption text-slate-500 dark:text-slate-400">{new Date(log.created_at).toLocaleString()}</div>
              </div>
              {log.message && <div className="mt-2 ui-body text-slate-700 dark:text-slate-200">{log.message}</div>}
              <div className="mt-3">
                <MetadataPreview metadata={log.metadata} />
              </div>
            </div>
          ))}
          {hasMore && (
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="inline-flex w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 ui-caption font-semibold text-slate-700 shadow-sm transition hover:border-primary/60 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100 dark:hover:text-primary-200"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

