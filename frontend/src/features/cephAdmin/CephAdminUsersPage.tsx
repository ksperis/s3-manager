/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import Modal from "../../components/Modal";
import TableEmptyState from "../../components/TableEmptyState";
import PaginationControls from "../../components/PaginationControls";
import { CephAdminRgwUser, assumeCephAdminUser, listCephAdminUsers } from "../../api/cephAdmin";
import { tableActionButtonClasses } from "../../components/tableActionClasses";
import { useCephAdminEndpoint } from "./CephAdminEndpointContext";

const extractError = (err: unknown): string => {
  if (axios.isAxiosError(err)) {
    return ((err.response?.data as { detail?: string } | undefined)?.detail || err.message || "Unexpected error");
  }
  return err instanceof Error ? err.message : "Unexpected error";
};

const formatBytes = (value?: number | null) => {
  if (value === undefined || value === null) return "-";
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let size = value;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  const decimals = size >= 10 || idx === 0 ? 0 : 1;
  return `${size.toFixed(decimals)} ${units[idx]}`;
};

const formatNumber = (value?: number | null) => {
  if (value === undefined || value === null) return "-";
  return value.toLocaleString();
};

type ColumnId =
  | "tenant"
  | "account_name"
  | "full_name"
  | "email"
  | "suspended"
  | "max_buckets"
  | "quota_max_size_bytes"
  | "quota_max_objects";

const COLUMNS_STORAGE_KEY = "ceph-admin.user_list.columns.v1";
const defaultVisibleColumns: ColumnId[] = ["account_name", "full_name", "email"];

const loadVisibleColumns = (): ColumnId[] => {
  if (typeof window === "undefined") return defaultVisibleColumns;
  const raw = localStorage.getItem(COLUMNS_STORAGE_KEY);
  if (!raw) return defaultVisibleColumns;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return defaultVisibleColumns;
    const allowed = new Set<ColumnId>([
      "tenant",
      "account_name",
      "full_name",
      "email",
      "suspended",
      "max_buckets",
      "quota_max_size_bytes",
      "quota_max_objects",
    ]);
    const cleaned = parsed.filter((v) => typeof v === "string" && allowed.has(v as ColumnId)) as ColumnId[];
    return cleaned.length > 0 ? cleaned : defaultVisibleColumns;
  } catch {
    return defaultVisibleColumns;
  }
};

const persistVisibleColumns = (value: ColumnId[]) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(value));
};

export default function CephAdminUsersPage() {
  const navigate = useNavigate();
  const { selectedEndpointId, selectedEndpoint } = useCephAdminEndpoint();
  const stsEnabled = Boolean(selectedEndpoint?.capabilities?.sts);
  const [items, setItems] = useState<CephAdminRgwUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assumeTarget, setAssumeTarget] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<CephAdminRgwUser | null>(null);
  const [filter, setFilter] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [visibleColumns, setVisibleColumns] = useState<ColumnId[]>(loadVisibleColumns);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const columnPickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    persistVisibleColumns(visibleColumns);
  }, [visibleColumns]);

  useEffect(() => {
    if (!showColumnPicker) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (!columnPickerRef.current) return;
      if (!columnPickerRef.current.contains(target)) {
        setShowColumnPicker(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [showColumnPicker]);

  const includeParams = useMemo(() => {
    const include = new Set<string>();
    if (visibleColumns.includes("account_name")) include.add("account");
    if (visibleColumns.includes("full_name") || visibleColumns.includes("email")) include.add("profile");
    if (visibleColumns.includes("suspended")) include.add("status");
    if (visibleColumns.includes("max_buckets")) include.add("limits");
    if (visibleColumns.includes("quota_max_size_bytes") || visibleColumns.includes("quota_max_objects")) include.add("quota");
    return Array.from(include.values());
  }, [visibleColumns]);

  useEffect(() => {
    if (!selectedEndpointId) {
      setItems([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    setError(null);
    listCephAdminUsers(selectedEndpointId, {
      page,
      page_size: pageSize,
      search: searchValue || undefined,
      include: includeParams,
    })
      .then((data) => {
        setItems(data.items ?? []);
        setTotal(data.total ?? 0);
      })
      .catch((err) => {
        setError(extractError(err));
        setItems([]);
        setTotal(0);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [selectedEndpointId, page, pageSize, searchValue, includeParams.join(",")]);

  useEffect(() => {
    setPage(1);
  }, [selectedEndpointId]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearchValue(filter.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [filter]);

  const toggleColumn = (id: ColumnId) => {
    setVisibleColumns((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };

  const resetColumns = () => {
    setVisibleColumns(defaultVisibleColumns);
  };

  type ColumnDef = {
    id: string;
    label: string;
    align?: "left" | "right";
    render: (user: CephAdminRgwUser) => ReactNode;
  };

  const renderSuspended = (value?: boolean | null) => {
    if (value === null || value === undefined) return <span className="ui-body text-slate-500 dark:text-slate-400">-</span>;
    return (
      <span
        className={`rounded-full px-2 py-0.5 ui-caption font-semibold ${
          value
            ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-100"
            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100"
        }`}
      >
        {value ? "Suspended" : "Active"}
      </span>
    );
  };

  const userTableColumns: ColumnDef[] = (() => {
    const cols: ColumnDef[] = [
      {
        id: "uid",
        label: "UID",
        render: (user) => user.uid,
      },
    ];

    const visible = new Set(visibleColumns);
    if (visible.has("tenant")) {
      cols.push({
        id: "tenant",
        label: "Tenant",
        render: (user) => user.tenant ?? "-",
      });
    }
    if (visible.has("account_name")) {
      cols.push({
        id: "account_name",
        label: "Account",
        render: (user) => user.account_name ?? user.account_id ?? "-",
      });
    }
    if (visible.has("full_name")) {
      cols.push({
        id: "full_name",
        label: "Full name",
        render: (user) => user.full_name ?? "-",
      });
    }
    if (visible.has("email")) {
      cols.push({
        id: "email",
        label: "Email",
        render: (user) => user.email ?? "-",
      });
    }
    if (visible.has("suspended")) {
      cols.push({
        id: "suspended",
        label: "Suspended",
        render: (user) => renderSuspended(user.suspended),
      });
    }
    if (visible.has("max_buckets")) {
      cols.push({
        id: "max_buckets",
        label: "Max buckets",
        align: "right",
        render: (user) => formatNumber(user.max_buckets),
      });
    }
    if (visible.has("quota_max_size_bytes")) {
      cols.push({
        id: "quota_max_size_bytes",
        label: "Quota (size)",
        align: "right",
        render: (user) => formatBytes(user.quota_max_size_bytes),
      });
    }
    if (visible.has("quota_max_objects")) {
      cols.push({
        id: "quota_max_objects",
        label: "Quota (objects)",
        align: "right",
        render: (user) => formatNumber(user.quota_max_objects),
      });
    }

    cols.push({
      id: "actions",
      label: "Actions",
      align: "right",
      render: (user) => (
        <button
          type="button"
          className={tableActionButtonClasses}
          disabled={!selectedEndpointId || !stsEnabled || assumeTarget === user.uid || Boolean(user.tenant)}
          title={
            user.tenant
              ? "Tenant users are not supported for assume-role."
              : !stsEnabled
                ? "STS is disabled for this endpoint."
                : undefined
          }
          onClick={() => setConfirmTarget(user)}
        >
          {assumeTarget === user.uid ? "Assuming…" : "Assume in manager"}
        </button>
      ),
    });

    return cols;
  })();

  return (
    <div className="space-y-4">
      <PageHeader
        title="RGW Users"
        description="Liste complète des utilisateurs RGW (admin ops)."
        breadcrumbs={[{ label: "Ceph Admin", to: "/ceph-admin" }, { label: "Users" }]}
      />

      {!selectedEndpointId && <PageBanner tone="warning">Select a Ceph endpoint first.</PageBanner>}
      {selectedEndpoint && (
        <PageBanner tone="info">
          Endpoint: <span className="font-semibold">{selectedEndpoint.name}</span>
        </PageBanner>
      )}
      {selectedEndpoint && !stsEnabled && (
        <PageBanner tone="warning">STS is disabled for this endpoint. Assume role is unavailable.</PageBanner>
      )}
      {error && <PageBanner tone="error">{error}</PageBanner>}
      {loading && <PageBanner tone="info">Loading users…</PageBanner>}

      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-4 dark:border-slate-800">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">Users</p>
              <p className="ui-caption text-slate-500 dark:text-slate-400">{total} result(s)</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <div className="flex items-center gap-2">
                <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Filter</span>
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Search by uid or tenant"
                  className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:w-64"
                />
              </div>
              <div className="relative" ref={columnPickerRef}>
                <button
                  type="button"
                  onClick={() => setShowColumnPicker((prev) => !prev)}
                  className="rounded-md border border-slate-200 px-3 py-2 ui-body font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  Columns
                </button>
                {showColumnPicker && (
                  <div className="absolute right-0 z-30 mt-2 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-center justify-between gap-2">
                      <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Visible columns</p>
                      <button
                        type="button"
                        onClick={resetColumns}
                        className="rounded-md border border-slate-200 px-2 py-1 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                      >
                        Reset
                      </button>
                    </div>

                    <div className="mt-3 space-y-3">
                      <div className="space-y-2">
                        <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Identity
                        </p>
                        {[
                          { id: "tenant" as const, label: "Tenant" },
                          { id: "account_name" as const, label: "Account name" },
                          { id: "full_name" as const, label: "Full name" },
                          { id: "email" as const, label: "Email" },
                          { id: "suspended" as const, label: "Suspended" },
                        ].map((opt) => (
                          <label key={opt.id} className="flex items-center justify-between ui-body text-slate-700 dark:text-slate-200">
                            <span>{opt.label}</span>
                            <input
                              type="checkbox"
                              checked={visibleColumns.includes(opt.id)}
                              onChange={() => toggleColumn(opt.id)}
                              className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                            />
                          </label>
                        ))}
                      </div>

                      <div className="space-y-2">
                        <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Limits & quotas
                        </p>
                        {[
                          { id: "max_buckets" as const, label: "Max buckets" },
                          { id: "quota_max_size_bytes" as const, label: "Quota (size)" },
                          { id: "quota_max_objects" as const, label: "Quota (objects)" },
                        ].map((opt) => (
                          <label key={opt.id} className="flex items-center justify-between ui-body text-slate-700 dark:text-slate-200">
                            <span>{opt.label}</span>
                            <input
                              type="checkbox"
                              checked={visibleColumns.includes(opt.id)}
                              onChange={() => toggleColumn(opt.id)}
                              className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="manager-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr>
                {userTableColumns.map((col) => (
                  <th
                    key={col.id}
                    className={`px-4 py-3 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${
                      col.align === "right" ? "text-right" : "text-left"
                    }`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {items.length === 0 && <TableEmptyState colSpan={userTableColumns.length} message="No users found." />}
              {items.map((user) => (
                <tr key={`${user.tenant ?? ""}:${user.uid}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  {userTableColumns.map((col) => {
                    const align = col.align ?? (col.id === "actions" ? "right" : "left");
                    const cellBase = align === "right" ? "px-6 py-4 text-right" : "px-6 py-4";
                    const textClass =
                      col.id === "uid"
                        ? "manager-table-cell ui-body font-semibold text-slate-900 dark:text-slate-100"
                        : "ui-body text-slate-600 dark:text-slate-300";
                    return (
                      <td key={`${user.uid}:${col.id}`} className={`${cellBase} ${textClass}`}>
                        {col.render(user)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PaginationControls
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          disabled={loading || !selectedEndpointId}
        />
      </div>
      {confirmTarget && (
        <Modal title="Assume in manager" onClose={() => setConfirmTarget(null)} maxWidthClass="max-w-lg">
          <div className="space-y-4">
            <p className="ui-body text-slate-700 dark:text-slate-200">
              This will create a temporary connection and STS key for:
              <span className="font-semibold"> {confirmTarget.uid}</span>.
            </p>
            <p className="ui-caption text-slate-500 dark:text-slate-400">
              The connection will expire automatically and be cleaned up by the server.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-full border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:text-slate-200"
                onClick={() => setConfirmTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={tableActionButtonClasses}
                disabled={!selectedEndpointId || assumeTarget === confirmTarget.uid}
                onClick={async () => {
                  if (!selectedEndpointId) return;
                  setAssumeTarget(confirmTarget.uid);
                  setError(null);
                  try {
                    const result = await assumeCephAdminUser(selectedEndpointId, confirmTarget.uid);
                    setConfirmTarget(null);
                    navigate(`/manager?ctx=${encodeURIComponent(result.context_id)}`);
                  } catch (err) {
                    setError(extractError(err));
                  } finally {
                    setAssumeTarget(null);
                  }
                }}
              >
                {assumeTarget === confirmTarget.uid ? "Assuming…" : "Confirm"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
