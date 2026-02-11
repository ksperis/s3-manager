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
import TableEmptyState from "../../components/TableEmptyState";
import PaginationControls from "../../components/PaginationControls";
import SortableHeader from "../../components/SortableHeader";
import { CephAdminRgwUser, CephAdminRgwUserDetail, listCephAdminUsers } from "../../api/cephAdmin";
import { tableActionMenuItemClasses, tableIconActionButtonClasses } from "../../components/tableActionClasses";
import CephAdminUserCreateModal from "./CephAdminUserCreateModal";
import CephAdminUserEditModal from "./CephAdminUserEditModal";
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

function ConfigureIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z" />
      <path d="m19.4 15.2 1.1 1.9-1.9 3.3-2.3-.5a7.9 7.9 0 0 1-1.7 1l-.6 2.2H10l-.6-2.2a7.9 7.9 0 0 1-1.7-1l-2.3.5-1.9-3.3 1.1-1.9a8.3 8.3 0 0 1 0-2.4L3.5 11l1.9-3.3 2.3.5c.5-.4 1.1-.7 1.7-1L10 5h3.8l.6 2.2c.6.3 1.2.6 1.7 1l2.3-.5 1.9 3.3-1.1 1.8c.1.8.1 1.6 0 2.4Z" />
    </svg>
  );
}

function MoreIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <circle cx="5" cy="12" r="1.9" />
      <circle cx="12" cy="12" r="1.9" />
      <circle cx="19" cy="12" r="1.9" />
    </svg>
  );
}

type ColumnId =
  | "tenant"
  | "account_name"
  | "full_name"
  | "email"
  | "suspended"
  | "max_buckets"
  | "quota_max_size_bytes"
  | "quota_max_objects";

type SortField =
  | "uid"
  | "tenant"
  | "account_name"
  | "full_name"
  | "email"
  | "suspended"
  | "max_buckets"
  | "quota_max_size_bytes"
  | "quota_max_objects";

type AdvancedStatusFilter = "any" | "active" | "suspended";

type AdvancedFilterState = {
  tenant: string;
  accountId: string;
  accountName: string;
  fullName: string;
  email: string;
  minMaxBuckets: string;
  maxMaxBuckets: string;
  minQuotaBytes: string;
  maxQuotaBytes: string;
  minQuotaObjects: string;
  maxQuotaObjects: string;
  suspended: AdvancedStatusFilter;
};

const COLUMNS_STORAGE_KEY = "ceph-admin.user_list.columns.v2";
const defaultVisibleColumns: ColumnId[] = ["tenant"];
const DEFAULT_SORT: { field: SortField; direction: "asc" | "desc" } = { field: "uid", direction: "asc" };

const defaultAdvancedFilter: AdvancedFilterState = {
  tenant: "",
  accountId: "",
  accountName: "",
  fullName: "",
  email: "",
  minMaxBuckets: "",
  maxMaxBuckets: "",
  minQuotaBytes: "",
  maxQuotaBytes: "",
  minQuotaObjects: "",
  maxQuotaObjects: "",
  suspended: "any",
};

const hasAdvancedFilters = (advanced: AdvancedFilterState | null) => {
  if (!advanced) return false;
  return Boolean(
    advanced.tenant.trim() ||
      advanced.accountId.trim() ||
      advanced.accountName.trim() ||
      advanced.fullName.trim() ||
      advanced.email.trim() ||
      advanced.minMaxBuckets.trim() ||
      advanced.maxMaxBuckets.trim() ||
      advanced.minQuotaBytes.trim() ||
      advanced.maxQuotaBytes.trim() ||
      advanced.minQuotaObjects.trim() ||
      advanced.maxQuotaObjects.trim() ||
      advanced.suspended !== "any"
  );
};

const buildAdvancedFilterPayload = (advanced: AdvancedFilterState | null) => {
  if (!advanced) return undefined;
  const rules: Array<Record<string, unknown>> = [];
  const addTextRule = (field: string, raw: string) => {
    const value = raw.trim();
    if (!value) return;
    rules.push({ field, op: "contains", value });
  };
  const addNumericRule = (field: string, op: "gte" | "lte", raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;
    rules.push({ field, op, value: parsed });
  };

  addTextRule("tenant", advanced.tenant);
  addTextRule("account_id", advanced.accountId);
  addTextRule("account_name", advanced.accountName);
  addTextRule("full_name", advanced.fullName);
  addTextRule("email", advanced.email);
  addNumericRule("max_buckets", "gte", advanced.minMaxBuckets);
  addNumericRule("max_buckets", "lte", advanced.maxMaxBuckets);
  addNumericRule("quota_max_size_bytes", "gte", advanced.minQuotaBytes);
  addNumericRule("quota_max_size_bytes", "lte", advanced.maxQuotaBytes);
  addNumericRule("quota_max_objects", "gte", advanced.minQuotaObjects);
  addNumericRule("quota_max_objects", "lte", advanced.maxQuotaObjects);

  if (advanced.suspended === "active") {
    rules.push({ field: "suspended", op: "eq", value: false });
  } else if (advanced.suspended === "suspended") {
    rules.push({ field: "suspended", op: "eq", value: true });
  }

  if (rules.length === 0) return undefined;
  return JSON.stringify({ match: "all", rules });
};

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

const rowKey = (user: CephAdminRgwUser) => `${user.tenant ?? ""}:${user.uid}`;
const bucketOwnerFilterForUser = (user: CephAdminRgwUser) => {
  const uid = user.uid.trim();
  if (!uid) return null;
  const tenant = (user.tenant ?? "").trim();
  return tenant ? `${tenant}$${uid}` : uid;
};

export default function CephAdminUsersPage() {
  const navigate = useNavigate();
  const { selectedEndpointId, selectedEndpoint, selectedEndpointAccess } = useCephAdminEndpoint();
  const canViewMetrics = Boolean(selectedEndpointAccess?.can_metrics) && (selectedEndpoint?.capabilities?.usage !== false);
  const [items, setItems] = useState<CephAdminRgwUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingTarget, setEditingTarget] = useState<CephAdminRgwUser | null>(null);
  const [filter, setFilter] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [showAdvancedFilter, setShowAdvancedFilter] = useState(false);
  const [advancedDraft, setAdvancedDraft] = useState<AdvancedFilterState>(defaultAdvancedFilter);
  const [advancedApplied, setAdvancedApplied] = useState<AdvancedFilterState | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState<{ field: SortField; direction: "asc" | "desc" }>(DEFAULT_SORT);
  const [visibleColumns, setVisibleColumns] = useState<ColumnId[]>(loadVisibleColumns);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const columnPickerRef = useRef<HTMLDivElement | null>(null);
  const requestSeqRef = useRef(0);

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

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearchValue(filter.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [filter]);

  useEffect(() => {
    setPage(1);
    setSearchValue("");
    setFilter("");
    setAdvancedApplied(null);
    setAdvancedDraft(defaultAdvancedFilter);
    setSort(DEFAULT_SORT);
    setShowCreateModal(false);
    setEditingTarget(null);
  }, [selectedEndpointId]);

  const includeParams = useMemo(() => {
    const include = new Set<string>();
    if (visibleColumns.includes("account_name")) include.add("account");
    if (visibleColumns.includes("full_name") || visibleColumns.includes("email")) include.add("profile");
    if (visibleColumns.includes("suspended")) include.add("status");
    if (visibleColumns.includes("max_buckets")) include.add("limits");
    if (visibleColumns.includes("quota_max_size_bytes") || visibleColumns.includes("quota_max_objects")) include.add("quota");
    return Array.from(include.values());
  }, [visibleColumns]);

  const advancedFilterParam = useMemo(() => buildAdvancedFilterPayload(advancedApplied), [advancedApplied]);

  useEffect(() => {
    if (!selectedEndpointId) {
      setItems([]);
      setTotal(0);
      setLoading(false);
      setLoadingDetails(false);
      return;
    }

    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;

    const load = async () => {
      setLoading(true);
      setLoadingDetails(false);
      setError(null);
      try {
        const baseResponse = await listCephAdminUsers(selectedEndpointId, {
          page,
          page_size: pageSize,
          search: searchValue || undefined,
          advanced_filter: advancedFilterParam,
          sort_by: sort.field,
          sort_dir: sort.direction,
        });
        if (requestId !== requestSeqRef.current) return;

        const baseItems = baseResponse.items ?? [];
        setItems(baseItems);
        setTotal(baseResponse.total ?? 0);
        setLoading(false);

        if (includeParams.length === 0 || baseItems.length === 0) return;

        setLoadingDetails(true);
        try {
          const detailResponse = await listCephAdminUsers(selectedEndpointId, {
            page,
            page_size: pageSize,
            search: searchValue || undefined,
            advanced_filter: advancedFilterParam,
            sort_by: sort.field,
            sort_dir: sort.direction,
            include: includeParams,
          });
          if (requestId !== requestSeqRef.current) return;

          const detailsByKey = new Map((detailResponse.items ?? []).map((user) => [rowKey(user), user]));
          setItems(baseItems.map((user) => detailsByKey.get(rowKey(user)) ?? user));
        } finally {
          if (requestId === requestSeqRef.current) {
            setLoadingDetails(false);
          }
        }
      } catch (err) {
        if (requestId !== requestSeqRef.current) return;
        setError(extractError(err));
        setItems([]);
        setTotal(0);
        setLoading(false);
        setLoadingDetails(false);
      }
    };

    void load();
  }, [
    selectedEndpointId,
    page,
    pageSize,
    searchValue,
    advancedFilterParam,
    sort.field,
    sort.direction,
    includeParams.join(","),
    reloadNonce,
  ]);

  const toggleColumn = (id: ColumnId) => {
    setVisibleColumns((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };

  const resetColumns = () => {
    setVisibleColumns(defaultVisibleColumns);
  };

  const toggleSort = (field: SortField) => {
    setSort((prev) => {
      if (prev.field === field) {
        return { field, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { field, direction: "asc" };
    });
    setPage(1);
  };

  const updateAdvancedField = (field: keyof AdvancedFilterState, value: string) => {
    setAdvancedDraft((prev) => ({ ...prev, [field]: value }));
  };

  const applyAdvancedFilter = () => {
    setAdvancedApplied(advancedDraft);
    setPage(1);
  };

  const resetAdvancedFilter = () => {
    setAdvancedDraft(defaultAdvancedFilter);
    setAdvancedApplied(null);
    setPage(1);
  };

  const resetAllFilters = () => {
    setFilter("");
    setSearchValue("");
    setAdvancedDraft(defaultAdvancedFilter);
    setAdvancedApplied(null);
    setShowAdvancedFilter(false);
    setPage(1);
  };

  const advancedFilterActive = hasAdvancedFilters(advancedApplied);
  const quickFilterActive = searchValue.trim().length > 0;
  const filtersActive = quickFilterActive || advancedFilterActive;
  const columnsCustomized = useMemo(() => {
    if (visibleColumns.length !== defaultVisibleColumns.length) return true;
    const current = new Set(visibleColumns);
    return defaultVisibleColumns.some((column) => !current.has(column));
  }, [visibleColumns]);

  const renderSuspended = (value?: boolean | null) => {
    if (value === null || value === undefined) {
      return <span className="ui-body text-slate-500 dark:text-slate-400">{loadingDetails ? "Loading..." : "-"}</span>;
    }
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

  const applyUpdatedUser = (updated: CephAdminRgwUserDetail) => {
    setItems((prev) =>
      prev.map((user) => {
        const sameUid = user.uid === updated.uid;
        const sameTenant = (user.tenant ?? null) === (updated.tenant ?? null);
        if (!sameUid || !sameTenant) {
          return user;
        }
        return {
          ...user,
          account_id: updated.account_id ?? null,
          account_name: updated.account_name ?? null,
          full_name: updated.display_name ?? null,
          email: updated.email ?? null,
          suspended: updated.suspended ?? null,
          max_buckets: updated.max_buckets ?? null,
          quota_max_size_bytes: updated.quota?.max_size_bytes ?? null,
          quota_max_objects: updated.quota?.max_objects ?? null,
        };
      })
    );
  };

  type ColumnDef = {
    id: string;
    label: string;
    field: SortField | null;
    align?: "left" | "right";
    headerClassName?: string;
    render: (user: CephAdminRgwUser) => ReactNode;
  };

  const detailPlaceholder = loadingDetails ? "Loading..." : "-";

  const userTableColumns: ColumnDef[] = (() => {
    const cols: ColumnDef[] = [
      {
        id: "uid",
        label: "UID",
        field: "uid",
        render: (user) => user.uid,
      },
    ];

    const visible = new Set(visibleColumns);
    if (visible.has("tenant")) {
      cols.push({
        id: "tenant",
        label: "Tenant",
        field: "tenant",
        render: (user) => user.tenant ?? "-",
      });
    }
    if (visible.has("account_name")) {
      cols.push({
        id: "account_name",
        label: "Account",
        field: "account_name",
        render: (user) => user.account_name ?? user.account_id ?? detailPlaceholder,
      });
    }
    if (visible.has("full_name")) {
      cols.push({
        id: "full_name",
        label: "Full name",
        field: "full_name",
        render: (user) => user.full_name ?? detailPlaceholder,
      });
    }
    if (visible.has("email")) {
      cols.push({
        id: "email",
        label: "Email",
        field: "email",
        render: (user) => user.email ?? detailPlaceholder,
      });
    }
    if (visible.has("suspended")) {
      cols.push({
        id: "suspended",
        label: "Suspended",
        field: "suspended",
        render: (user) => renderSuspended(user.suspended),
      });
    }
    if (visible.has("max_buckets")) {
      cols.push({
        id: "max_buckets",
        label: "Max buckets",
        field: "max_buckets",
        align: "right",
        render: (user) => (user.max_buckets == null ? detailPlaceholder : formatNumber(user.max_buckets)),
      });
    }
    if (visible.has("quota_max_size_bytes")) {
      cols.push({
        id: "quota_max_size_bytes",
        label: "Quota (size)",
        field: "quota_max_size_bytes",
        align: "right",
        render: (user) => (user.quota_max_size_bytes == null ? detailPlaceholder : formatBytes(user.quota_max_size_bytes)),
      });
    }
    if (visible.has("quota_max_objects")) {
      cols.push({
        id: "quota_max_objects",
        label: "Quota (objects)",
        field: "quota_max_objects",
        align: "right",
        render: (user) => (user.quota_max_objects == null ? detailPlaceholder : formatNumber(user.quota_max_objects)),
      });
    }

    cols.push({
      id: "actions",
      label: "Actions",
      field: null,
      align: "right",
      render: (user) => (
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            className={tableIconActionButtonClasses}
            onClick={() => setEditingTarget(user)}
            aria-label="Configure user"
            title="Configure"
          >
            <ConfigureIcon />
          </button>
          <details className="relative">
            <summary
              className={`${tableIconActionButtonClasses} list-none [&::-webkit-details-marker]:hidden`}
              aria-label="More actions"
              title="More actions"
            >
              <MoreIcon />
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900">
              <button
                type="button"
                className={tableActionMenuItemClasses}
                onClick={(event) => {
                  event.preventDefault();
                  const owner = bucketOwnerFilterForUser(user);
                  if (!owner) return;
                  navigate(`/ceph-admin/buckets?owner=${encodeURIComponent(owner)}`);
                  const parent = event.currentTarget.closest("details");
                  if (parent) parent.removeAttribute("open");
                }}
              >
                Owner buckets
              </button>
            </div>
          </details>
        </div>
      ),
    });

    return cols;
  })();

  return (
    <div className="space-y-4">
      <PageHeader
        title="RGW Users"
        description="Complete list of RGW users (admin ops)."
        breadcrumbs={[{ label: "Ceph Admin", to: "/ceph-admin" }, { label: "Users" }]}
        actions={
          selectedEndpointId
            ? [
                {
                  label: "Create user",
                  onClick: () => setShowCreateModal(true),
                },
              ]
            : []
        }
      />

      {!selectedEndpointId && <PageBanner tone="warning">Select a Ceph endpoint first.</PageBanner>}
      {selectedEndpoint && (
        <PageBanner tone="info">
          Endpoint: <span className="font-semibold">{selectedEndpoint.name}</span>
        </PageBanner>
      )}
      {error && <PageBanner tone="error">{error}</PageBanner>}

      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-4 dark:border-slate-800">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">Users</p>
              <p className="ui-caption text-slate-500 dark:text-slate-400">{total} result(s)</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <div className="relative" ref={columnPickerRef}>
                <button
                  type="button"
                  onClick={() => setShowColumnPicker((prev) => !prev)}
                  className="rounded-md border border-slate-200 px-2.5 py-1.5 ui-caption font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
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
              <button
                type="button"
                onClick={resetColumns}
                disabled={!columnsCustomized}
                className={`rounded-md border px-2.5 py-1.5 ui-caption font-semibold ${
                  columnsCustomized
                    ? "border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100"
                    : "cursor-not-allowed border-slate-200 text-slate-400 dark:border-slate-700 dark:text-slate-500"
                }`}
              >
                Reset Columns
              </button>
            </div>
          </div>
        </div>

        <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-4 dark:border-slate-800 dark:bg-slate-900/40">
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Filters</p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">Quick filter + Advanced filter</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowAdvancedFilter((prev) => !prev)}
                  className={`rounded-md border px-2.5 py-1.5 ui-caption font-semibold ${
                    showAdvancedFilter || advancedFilterActive
                      ? "border-primary/40 bg-primary-50 text-primary-700 dark:border-primary-400/40 dark:bg-primary-500/10 dark:text-primary-100"
                      : "border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                  }`}
                >
                  Advanced filter{advancedFilterActive ? " · Active" : ""}
                </button>
                <button
                  type="button"
                  onClick={resetAllFilters}
                  disabled={!filtersActive}
                  className={`rounded-md border px-2.5 py-1.5 ui-caption font-semibold ${
                    filtersActive
                      ? "border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100"
                      : "cursor-not-allowed border-slate-200 text-slate-400 dark:border-slate-700 dark:text-slate-500"
                  }`}
                >
                  Clear all filters
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <input
                  type="text"
                  aria-label="Quick filter"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Search by UID or tenant"
                  className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            {showAdvancedFilter && (
              <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                <div className="grid gap-3 lg:grid-cols-3">
                  <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
                    Tenant contains
                    <input
                      type="text"
                      value={advancedDraft.tenant}
                      onChange={(e) => updateAdvancedField("tenant", e.target.value)}
                      className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </label>
                  <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
                    Account ID contains
                    <input
                      type="text"
                      value={advancedDraft.accountId}
                      onChange={(e) => updateAdvancedField("accountId", e.target.value)}
                      className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </label>
                  <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
                    Account name contains
                    <input
                      type="text"
                      value={advancedDraft.accountName}
                      onChange={(e) => updateAdvancedField("accountName", e.target.value)}
                      className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </label>
                  <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
                    Full name contains
                    <input
                      type="text"
                      value={advancedDraft.fullName}
                      onChange={(e) => updateAdvancedField("fullName", e.target.value)}
                      className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </label>
                  <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
                    Email contains
                    <input
                      type="text"
                      value={advancedDraft.email}
                      onChange={(e) => updateAdvancedField("email", e.target.value)}
                      className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </label>
                  <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
                    Status
                    <select
                      value={advancedDraft.suspended}
                      onChange={(e) => updateAdvancedField("suspended", e.target.value as AdvancedStatusFilter)}
                      className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      <option value="any">Any</option>
                      <option value="active">Active</option>
                      <option value="suspended">Suspended</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
                    Max buckets min
                    <input
                      type="number"
                      value={advancedDraft.minMaxBuckets}
                      onChange={(e) => updateAdvancedField("minMaxBuckets", e.target.value)}
                      className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </label>
                  <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
                    Max buckets max
                    <input
                      type="number"
                      value={advancedDraft.maxMaxBuckets}
                      onChange={(e) => updateAdvancedField("maxMaxBuckets", e.target.value)}
                      className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </label>
                  <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
                    Quota bytes min
                    <input
                      type="number"
                      value={advancedDraft.minQuotaBytes}
                      onChange={(e) => updateAdvancedField("minQuotaBytes", e.target.value)}
                      className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </label>
                  <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
                    Quota bytes max
                    <input
                      type="number"
                      value={advancedDraft.maxQuotaBytes}
                      onChange={(e) => updateAdvancedField("maxQuotaBytes", e.target.value)}
                      className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </label>
                  <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
                    Quota objects min
                    <input
                      type="number"
                      value={advancedDraft.minQuotaObjects}
                      onChange={(e) => updateAdvancedField("minQuotaObjects", e.target.value)}
                      className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </label>
                  <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
                    Quota objects max
                    <input
                      type="number"
                      value={advancedDraft.maxQuotaObjects}
                      onChange={(e) => updateAdvancedField("maxQuotaObjects", e.target.value)}
                      className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </label>
                </div>
                <div className="mt-3 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={resetAdvancedFilter}
                    className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption font-semibold text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-600"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={applyAdvancedFilter}
                    className="rounded-md bg-primary px-2 py-1.5 ui-caption font-semibold text-white shadow-sm hover:bg-primary-600"
                  >
                    Apply filter
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="manager-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr>
                {userTableColumns.map((col) =>
                  col.field ? (
                    <SortableHeader
                      key={col.id}
                      label={col.label}
                      field={col.field}
                      activeField={sort.field}
                      direction={sort.direction}
                      align={col.align ?? (col.id === "actions" ? "right" : "left")}
                      onSort={(field) => toggleSort(field as SortField)}
                    />
                  ) : (
                    <th
                      key={col.id}
                      className={`px-6 py-3 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${
                        col.align === "right" ? "text-right" : "text-left"
                      } ${col.headerClassName ?? ""}`}
                    >
                      {col.label}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading && <TableEmptyState colSpan={userTableColumns.length} message="Loading users..." />}
              {!loading && !error && items.length === 0 && (
                <TableEmptyState colSpan={userTableColumns.length} message="No users found." />
              )}
              {!loading &&
                items.map((user) => (
                  <tr key={rowKey(user)} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    {userTableColumns.map((col) => {
                      const align = col.align ?? (col.id === "actions" ? "right" : "left");
                      const cellBase = align === "right" ? "px-6 py-4 text-right" : "px-6 py-4";
                      const textClass =
                        col.id === "uid"
                          ? "manager-table-cell ui-body font-semibold text-slate-900 dark:text-slate-100"
                          : "ui-body text-slate-600 dark:text-slate-300";
                      return (
                        <td key={`${rowKey(user)}:${col.id}`} className={`${cellBase} ${textClass}`}>
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

      {selectedEndpointId && editingTarget && (
        <CephAdminUserEditModal
          endpointId={selectedEndpointId}
          uid={editingTarget.uid}
          tenant={editingTarget.tenant}
          canViewMetrics={canViewMetrics}
          onClose={() => setEditingTarget(null)}
          onSaved={applyUpdatedUser}
        />
      )}
      {selectedEndpointId && showCreateModal && (
        <CephAdminUserCreateModal
          endpointId={selectedEndpointId}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setReloadNonce((prev) => prev + 1);
          }}
        />
      )}
    </div>
  );
}
