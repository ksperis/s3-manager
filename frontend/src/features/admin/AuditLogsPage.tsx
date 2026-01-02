/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AuditLogEntry, listAuditLogs } from "../../api/audit";
import PageHeader from "../../components/PageHeader";

type RoleFilter = "all" | "ui_admin" | "ui_user" | "ui_none";
type ScopeFilter = "all" | "admin" | "manager" | "portal";

const roleLabels: Record<RoleFilter, string> = {
  all: "All actors",
  ui_admin: "Admin",
  ui_user: "User",
  ui_none: "No access",
};

const scopeLabels: Record<ScopeFilter, string> = {
  all: "All scopes",
  admin: "Admin area",
  manager: "Manager area",
  portal: "Portal area",
};

function RoleBadge({ role }: { role: string }) {
  const base = "inline-flex items-center rounded-full px-2 py-0.5 ui-caption font-semibold";
  if (role === "ui_admin") {
    return <span className={`${base} bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200`}>Admin</span>;
  }
  if (role === "ui_user") {
    return (
      <span className={`${base} bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100`}>User</span>
    );
  }
  if (role === "ui_none") {
    return (
      <span className={`${base} bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-200`}>No access</span>
    );
  }
  return <span className={`${base} bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-200`}>{role}</span>;
}

function ScopeBadge({ scope }: { scope: string }) {
  const base = "inline-flex items-center rounded-full px-2 py-0.5 ui-caption font-semibold";
  let styles = "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100";
  let label = "Manager UI";
  if (scope === "admin") {
    styles = "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200";
    label = "Admin UI";
  } else if (scope === "portal") {
    styles = "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-100";
    label = "Portal UI";
  }
  return <span className={`${base} ${styles}`}>{label}</span>;
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

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchLogs = useCallback(
    async ({ append = false, cursor }: { append?: boolean; cursor?: number | null } = {}) => {
      const params = {
        limit: 100,
        role: roleFilter !== "all" ? roleFilter : undefined,
        scope: scopeFilter !== "all" ? scopeFilter : undefined,
        cursor: cursor ?? undefined,
      };
      const response = await listAuditLogs(params);
      if (append) {
        setLogs((prev) => [...prev, ...response.logs]);
      } else {
        setLogs(response.logs);
      }
      setNextCursor(response.next_cursor ?? null);
    },
    [roleFilter, scopeFilter]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
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

  const handleRefresh = async () => {
    try {
      setLoading(true);
      setError(null);
      await fetchLogs({ append: false });
    } catch (err) {
      console.error(err);
      setError("Unable to refresh audit logs.");
    } finally {
      setLoading(false);
    }
  };

  const handleLoadMore = async () => {
    if (!nextCursor) return;
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
      <div className="flex flex-wrap gap-3">
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 ui-body text-slate-700 shadow-sm transition focus:border-primary focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          {Object.entries(roleLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={scopeFilter}
          onChange={(e) => setScopeFilter(e.target.value as ScopeFilter)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 ui-body text-slate-700 shadow-sm transition focus:border-primary focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          {Object.entries(scopeLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
    ),
    [roleFilter, scopeFilter]
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit trail"
        description="Last administrative actions performed through the UI."
        breadcrumbs={[{ label: "Admin" }, { label: "Governance" }, { label: "Audit trail" }]}
        inlineContent={filters}
        actions={[
          {
            label: loading ? "Refreshing…" : "Refresh",
            variant: "ghost",
            onClick: handleRefresh,
          },
        ]}
      />

      <div className="rounded-2xl border border-slate-200/80 bg-white/95 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        {error && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 ui-body text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            {error}
          </div>
        )}

        {loading && logs.length === 0 ? (
          <div className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">Loading audit data…</div>
        ) : isEmpty ? (
          <div className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">No audit entries found.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
            <table className="compact-table min-w-full divide-y divide-slate-200 text-left ui-body text-slate-700 dark:divide-slate-800 dark:text-slate-200">
                <thead className="bg-slate-50 ui-caption uppercase tracking-wide text-slate-500 dark:bg-slate-900/70 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Time</th>
                    <th className="px-4 py-3 font-semibold">Actor</th>
                    <th className="px-4 py-3 font-semibold">Scope</th>
                    <th className="px-4 py-3 font-semibold">Action</th>
                    <th className="px-4 py-3 font-semibold">Target</th>
                    <th className="px-4 py-3 font-semibold">S3Account/User</th>
                    <th className="px-4 py-3 font-semibold">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {logs.map((log) => (
                    <tr key={log.id} className="bg-white/80 hover:bg-slate-50 dark:bg-transparent dark:hover:bg-slate-900/50">
                      <td className="px-4 py-3 align-top ui-caption text-slate-500 dark:text-slate-400">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-col gap-1">
                          <span className="font-semibold">{log.user_email}</span>
                          <RoleBadge role={log.user_role} />
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <ScopeBadge scope={log.scope} />
                      </td>
                      <td className="px-4 py-3 align-top font-mono ui-caption">{log.action}</td>
                      <td className="px-4 py-3 align-top">
                        <div className="ui-caption text-slate-600 dark:text-slate-300">{log.entity_type || "-"}</div>
                        <div className="ui-body font-medium text-slate-900 dark:text-white">{log.entity_id || "—"}</div>
                      </td>
                      <td className="px-4 py-3 align-top ui-body">
                        {log.account_name ? (
                          <div className="font-medium text-slate-900 dark:text-white">{log.account_name}</div>
                        ) : log.account_id ? (
                          <div className="text-slate-600 dark:text-slate-300">S3Account #{log.account_id}</div>
                        ) : (
                          <span className="text-slate-500 dark:text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <MetadataPreview metadata={log.metadata as Record<string, unknown> | undefined} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 ui-body dark:border-slate-800">
              <span className="text-slate-500 dark:text-slate-400">
                Showing {logs.length} entr{logs.length === 1 ? "y" : "ies"}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleRefresh}
                  className="inline-flex items-center rounded-lg border border-slate-200 px-3 py-1.5 ui-caption font-medium text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-200"
                  disabled={loading}
                >
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={!hasMore || loadingMore}
                  className="inline-flex items-center rounded-lg border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-200"
                >
                  {loadingMore ? "Loading…" : hasMore ? "Load older" : "No more"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
