/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import ListToolbar from "../../components/ListToolbar";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import TableEmptyState from "../../components/TableEmptyState";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import PaginationControls from "../../components/PaginationControls";
import SortableHeader from "../../components/SortableHeader";
import ColumnVisibilityPicker from "../../components/ColumnVisibilityPicker";
import { CephAdminRgwUser, CephAdminRgwUserDetail, listCephAdminUsers } from "../../api/cephAdmin";
import { tableActionMenuItemClasses } from "../../components/tableActionClasses";
import CephAdminUserCreateModal from "./CephAdminUserCreateModal";
import CephAdminUserEditModal from "./CephAdminUserEditModal";
import { useCephAdminEndpoint } from "./CephAdminEndpointContext";
import {
  FILTER_COST_LABEL,
  buildTextFieldRules,
  formatTextFilterSummary,
  parseExactListInput,
  renderFilterCostIndicator,
  type FilterCostLevel,
  type TextMatchMode,
} from "./filtering/advancedFilterShared";
import { extractApiError } from "../../utils/apiError";

const extractError = (err: unknown): string => {
  return extractApiError(err, "Unexpected error");
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
  tenantMatchMode: TextMatchMode;
  accountId: string;
  accountIdMatchMode: TextMatchMode;
  accountName: string;
  accountNameMatchMode: TextMatchMode;
  fullName: string;
  fullNameMatchMode: TextMatchMode;
  email: string;
  emailMatchMode: TextMatchMode;
  minMaxBuckets: string;
  maxMaxBuckets: string;
  minQuotaBytes: string;
  maxQuotaBytes: string;
  minQuotaObjects: string;
  maxQuotaObjects: string;
  minQuotaUsageSizePercent: string;
  maxQuotaUsageSizePercent: string;
  minQuotaUsageObjectPercent: string;
  maxQuotaUsageObjectPercent: string;
  suspended: AdvancedStatusFilter;
};

type AdvancedTextField = "tenant" | "accountId" | "accountName" | "fullName" | "email";
type AdvancedNumericField =
  | "minMaxBuckets"
  | "maxMaxBuckets"
  | "minQuotaBytes"
  | "maxQuotaBytes"
  | "minQuotaObjects"
  | "maxQuotaObjects"
  | "minQuotaUsageSizePercent"
  | "maxQuotaUsageSizePercent"
  | "minQuotaUsageObjectPercent"
  | "maxQuotaUsageObjectPercent";
type AdvancedField = AdvancedTextField | AdvancedNumericField | "suspended";
type ActiveFilterRemoveAction = { type: "quick" } | { type: "advanced"; field: AdvancedField };
type ActiveFilterSummaryItem = {
  id: string;
  label: string;
  remove: ActiveFilterRemoveAction;
};

const COLUMNS_STORAGE_KEY = "ceph-admin.user_list.columns.v2";
const defaultVisibleColumns: ColumnId[] = ["tenant"];
const DEFAULT_SORT: { field: SortField; direction: "asc" | "desc" } = { field: "uid", direction: "asc" };
const USER_COLUMN_GROUPS: Array<{ id: string; label: string; options: Array<{ id: ColumnId; label: string }> }> = [
  {
    id: "identity",
    label: "Identity",
    options: [
      { id: "tenant", label: "Tenant" },
      { id: "account_name", label: "Account name" },
      { id: "full_name", label: "Full name" },
      { id: "email", label: "Email" },
      { id: "suspended", label: "Suspended" },
    ],
  },
  {
    id: "limits_quotas",
    label: "Limits & quotas",
    options: [
      { id: "max_buckets", label: "Max buckets" },
      { id: "quota_max_size_bytes", label: "Quota (size)" },
      { id: "quota_max_objects", label: "Quota (objects)" },
    ],
  },
];

const defaultAdvancedFilter: AdvancedFilterState = {
  tenant: "",
  tenantMatchMode: "contains",
  accountId: "",
  accountIdMatchMode: "contains",
  accountName: "",
  accountNameMatchMode: "contains",
  fullName: "",
  fullNameMatchMode: "contains",
  email: "",
  emailMatchMode: "contains",
  minMaxBuckets: "",
  maxMaxBuckets: "",
  minQuotaBytes: "",
  maxQuotaBytes: "",
  minQuotaObjects: "",
  maxQuotaObjects: "",
  minQuotaUsageSizePercent: "",
  maxQuotaUsageSizePercent: "",
  minQuotaUsageObjectPercent: "",
  maxQuotaUsageObjectPercent: "",
  suspended: "any",
};

const hasAdvancedFilters = (advanced: AdvancedFilterState | null, allowUsageFilters: boolean) => {
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
      (allowUsageFilters &&
        (advanced.minQuotaUsageSizePercent.trim() ||
          advanced.maxQuotaUsageSizePercent.trim() ||
          advanced.minQuotaUsageObjectPercent.trim() ||
          advanced.maxQuotaUsageObjectPercent.trim())) ||
      advanced.suspended !== "any"
  );
};

const buildAdvancedFilterPayload = (
  advanced: AdvancedFilterState | null,
  quickSearch: string,
  quickMatchMode: TextMatchMode,
  allowUsageFilters: boolean
) => {
  const rules: Array<Record<string, unknown>> = [];
  const addNumericRule = (field: string, op: "gte" | "lte", raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;
    rules.push({ field, op, value: parsed });
  };

  const quickParsed = parseExactListInput(quickSearch);
  if (quickParsed.values.length > 0 && (quickMatchMode === "exact" || quickParsed.listProvided)) {
    rules.push(...buildTextFieldRules("uid", quickSearch, "exact"));
  }

  if (advanced) {
    rules.push(...buildTextFieldRules("tenant", advanced.tenant, advanced.tenantMatchMode));
    rules.push(...buildTextFieldRules("account_id", advanced.accountId, advanced.accountIdMatchMode));
    rules.push(...buildTextFieldRules("account_name", advanced.accountName, advanced.accountNameMatchMode));
    rules.push(...buildTextFieldRules("full_name", advanced.fullName, advanced.fullNameMatchMode));
    rules.push(...buildTextFieldRules("email", advanced.email, advanced.emailMatchMode));
    addNumericRule("max_buckets", "gte", advanced.minMaxBuckets);
    addNumericRule("max_buckets", "lte", advanced.maxMaxBuckets);
    addNumericRule("quota_max_size_bytes", "gte", advanced.minQuotaBytes);
    addNumericRule("quota_max_size_bytes", "lte", advanced.maxQuotaBytes);
    addNumericRule("quota_max_objects", "gte", advanced.minQuotaObjects);
    addNumericRule("quota_max_objects", "lte", advanced.maxQuotaObjects);
    if (allowUsageFilters) {
      addNumericRule("quota_usage_size_percent", "gte", advanced.minQuotaUsageSizePercent);
      addNumericRule("quota_usage_size_percent", "lte", advanced.maxQuotaUsageSizePercent);
      addNumericRule("quota_usage_object_percent", "gte", advanced.minQuotaUsageObjectPercent);
      addNumericRule("quota_usage_object_percent", "lte", advanced.maxQuotaUsageObjectPercent);
    }

    if (advanced.suspended === "active") {
      rules.push({ field: "suspended", op: "eq", value: false });
    } else if (advanced.suspended === "suspended") {
      rules.push({ field: "suspended", op: "eq", value: true });
    }
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
  const canViewMetrics = Boolean(selectedEndpointAccess?.can_metrics) && (selectedEndpoint?.capabilities?.metrics !== false);
  const [items, setItems] = useState<CephAdminRgwUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingTarget, setEditingTarget] = useState<CephAdminRgwUser | null>(null);
  const [filter, setFilter] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [quickFilterMode, setQuickFilterMode] = useState<TextMatchMode>("contains");
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
    setQuickFilterMode("contains");
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

  const quickFilterDraftParsed = useMemo(() => parseExactListInput(filter), [filter]);
  const quickFilterAppliedParsed = useMemo(() => parseExactListInput(searchValue), [searchValue]);
  const quickFilterDraftForcesExact = quickFilterDraftParsed.listProvided && quickFilterDraftParsed.values.length > 0;
  const quickFilterAppliedForcesExact = quickFilterAppliedParsed.listProvided && quickFilterAppliedParsed.values.length > 0;
  const quickFilterModeForDisplay: TextMatchMode = quickFilterDraftForcesExact ? "exact" : quickFilterMode;
  const effectiveQuickFilterMode: TextMatchMode = quickFilterAppliedForcesExact ? "exact" : quickFilterMode;
  const effectiveSearchValue = effectiveQuickFilterMode === "contains" ? searchValue : "";
  const advancedFilterParam = useMemo(
    () => buildAdvancedFilterPayload(advancedApplied, searchValue, effectiveQuickFilterMode, canViewMetrics),
    [advancedApplied, searchValue, effectiveQuickFilterMode, canViewMetrics]
  );

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
          search: effectiveSearchValue || undefined,
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
            search: effectiveSearchValue || undefined,
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
    effectiveSearchValue,
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
  const modeToggleBaseClass =
    "absolute right-1 top-1 rounded border px-1 py-0 ui-caption font-semibold transition focus:outline-none focus:ring-2 focus:ring-offset-0";
  const modeToggleClass = (mode: TextMatchMode, isPending: boolean, locked: boolean = false) => {
    if (locked) {
      return `${modeToggleBaseClass} cursor-not-allowed border-primary-400 bg-primary-100 text-primary-700 opacity-80 dark:border-primary-400/60 dark:bg-primary-500/20 dark:text-primary-100`;
    }
    if (isPending) {
      return `${modeToggleBaseClass} border-amber-400 bg-amber-100 text-amber-700 focus:ring-amber-300 dark:border-amber-400/60 dark:bg-amber-500/20 dark:text-amber-200`;
    }
    if (mode === "exact") {
      return `${modeToggleBaseClass} border-primary-400 bg-primary-100 text-primary-700 focus:ring-primary/35 dark:border-primary-400/60 dark:bg-primary-500/20 dark:text-primary-100`;
    }
    return `${modeToggleBaseClass} border-slate-200 bg-white text-slate-500 hover:border-primary hover:text-primary focus:ring-primary/30 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500 dark:hover:text-primary-100`;
  };
  const matchModeButtonClass = (active: boolean, locked: boolean = false) => {
    if (locked) {
      if (active) {
        return "cursor-not-allowed rounded-md border border-primary-300 bg-primary-100 px-2 py-1 ui-caption font-semibold text-primary-700 opacity-80 dark:border-primary-500/50 dark:bg-primary-500/20 dark:text-primary-100";
      }
      return "cursor-not-allowed rounded-md border border-slate-200 bg-white px-2 py-1 ui-caption font-semibold text-slate-400 opacity-70 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500";
    }
    if (active) {
      return "rounded-md border border-primary-300 bg-primary-100 px-2 py-1 ui-caption font-semibold text-primary-700 dark:border-primary-500/50 dark:bg-primary-500/20 dark:text-primary-100";
    }
    return "rounded-md border border-slate-200 bg-white px-2 py-1 ui-caption font-semibold text-slate-600 hover:border-primary hover:text-primary dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500 dark:hover:text-primary-100";
  };
  const activeFieldClass =
    "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-200/70 dark:border-emerald-400/70 dark:bg-emerald-500/15 dark:ring-emerald-500/25";
  const activeLabelClass = "text-emerald-700 dark:text-emerald-200";
  const pendingFieldClass =
    "border-amber-400 bg-amber-50 ring-2 ring-amber-300/70 dark:border-amber-400/70 dark:bg-amber-500/20 dark:ring-amber-500/25";
  const pendingLabelClass = "text-amber-700 dark:text-amber-300";
  const fieldHighlight = (isApplied: boolean, isPending: boolean) => {
    if (isPending) return { labelClass: pendingLabelClass, fieldClass: pendingFieldClass };
    if (isApplied) return { labelClass: activeLabelClass, fieldClass: activeFieldClass };
    return { labelClass: "", fieldClass: "" };
  };

  const quickDraftValue = filter.trim();
  const quickAppliedValue = searchValue.trim();
  const quickFilterPending = quickDraftValue !== quickAppliedValue;
  const quickFilterFieldState = fieldHighlight(quickAppliedValue.length > 0, quickFilterPending);

  const tenantAppliedValue = (advancedApplied?.tenant ?? "").trim();
  const accountIdAppliedValue = (advancedApplied?.accountId ?? "").trim();
  const accountNameAppliedValue = (advancedApplied?.accountName ?? "").trim();
  const fullNameAppliedValue = (advancedApplied?.fullName ?? "").trim();
  const emailAppliedValue = (advancedApplied?.email ?? "").trim();
  const tenantDraftValue = advancedDraft.tenant.trim();
  const accountIdDraftValue = advancedDraft.accountId.trim();
  const accountNameDraftValue = advancedDraft.accountName.trim();
  const fullNameDraftValue = advancedDraft.fullName.trim();
  const emailDraftValue = advancedDraft.email.trim();

  const tenantAppliedParsed = parseExactListInput(advancedApplied?.tenant ?? "");
  const tenantDraftParsed = parseExactListInput(advancedDraft.tenant);
  const accountIdAppliedParsed = parseExactListInput(advancedApplied?.accountId ?? "");
  const accountIdDraftParsed = parseExactListInput(advancedDraft.accountId);
  const accountNameAppliedParsed = parseExactListInput(advancedApplied?.accountName ?? "");
  const accountNameDraftParsed = parseExactListInput(advancedDraft.accountName);
  const fullNameAppliedParsed = parseExactListInput(advancedApplied?.fullName ?? "");
  const fullNameDraftParsed = parseExactListInput(advancedDraft.fullName);
  const emailAppliedParsed = parseExactListInput(advancedApplied?.email ?? "");
  const emailDraftParsed = parseExactListInput(advancedDraft.email);

  const tenantDraftForcesExact = tenantDraftParsed.listProvided && tenantDraftParsed.values.length > 0;
  const accountIdDraftForcesExact = accountIdDraftParsed.listProvided && accountIdDraftParsed.values.length > 0;
  const accountNameDraftForcesExact = accountNameDraftParsed.listProvided && accountNameDraftParsed.values.length > 0;
  const fullNameDraftForcesExact = fullNameDraftParsed.listProvided && fullNameDraftParsed.values.length > 0;
  const emailDraftForcesExact = emailDraftParsed.listProvided && emailDraftParsed.values.length > 0;

  const tenantAppliedMode: TextMatchMode = tenantAppliedParsed.listProvided && tenantAppliedParsed.values.length > 0 ? "exact" : (advancedApplied?.tenantMatchMode ?? "contains");
  const accountIdAppliedMode: TextMatchMode =
    accountIdAppliedParsed.listProvided && accountIdAppliedParsed.values.length > 0 ? "exact" : (advancedApplied?.accountIdMatchMode ?? "contains");
  const accountNameAppliedMode: TextMatchMode =
    accountNameAppliedParsed.listProvided && accountNameAppliedParsed.values.length > 0 ? "exact" : (advancedApplied?.accountNameMatchMode ?? "contains");
  const fullNameAppliedMode: TextMatchMode =
    fullNameAppliedParsed.listProvided && fullNameAppliedParsed.values.length > 0 ? "exact" : (advancedApplied?.fullNameMatchMode ?? "contains");
  const emailAppliedMode: TextMatchMode = emailAppliedParsed.listProvided && emailAppliedParsed.values.length > 0 ? "exact" : (advancedApplied?.emailMatchMode ?? "contains");
  const tenantDraftMode: TextMatchMode = tenantDraftForcesExact ? "exact" : advancedDraft.tenantMatchMode;
  const accountIdDraftMode: TextMatchMode = accountIdDraftForcesExact ? "exact" : advancedDraft.accountIdMatchMode;
  const accountNameDraftMode: TextMatchMode = accountNameDraftForcesExact ? "exact" : advancedDraft.accountNameMatchMode;
  const fullNameDraftMode: TextMatchMode = fullNameDraftForcesExact ? "exact" : advancedDraft.fullNameMatchMode;
  const emailDraftMode: TextMatchMode = emailDraftForcesExact ? "exact" : advancedDraft.emailMatchMode;

  const tenantPending = tenantDraftValue !== tenantAppliedValue || (tenantDraftValue.length > 0 && tenantDraftMode !== tenantAppliedMode);
  const accountIdPending =
    accountIdDraftValue !== accountIdAppliedValue || (accountIdDraftValue.length > 0 && accountIdDraftMode !== accountIdAppliedMode);
  const accountNamePending =
    accountNameDraftValue !== accountNameAppliedValue || (accountNameDraftValue.length > 0 && accountNameDraftMode !== accountNameAppliedMode);
  const fullNamePending = fullNameDraftValue !== fullNameAppliedValue || (fullNameDraftValue.length > 0 && fullNameDraftMode !== fullNameAppliedMode);
  const emailPending = emailDraftValue !== emailAppliedValue || (emailDraftValue.length > 0 && emailDraftMode !== emailAppliedMode);

  const tenantFieldState = fieldHighlight(Boolean(tenantAppliedValue), tenantPending);
  const accountIdFieldState = fieldHighlight(Boolean(accountIdAppliedValue), accountIdPending);
  const accountNameFieldState = fieldHighlight(Boolean(accountNameAppliedValue), accountNamePending);
  const fullNameFieldState = fieldHighlight(Boolean(fullNameAppliedValue), fullNamePending);
  const emailFieldState = fieldHighlight(Boolean(emailAppliedValue), emailPending);

  const suspendedAppliedValue = advancedApplied?.suspended ?? "any";
  const suspendedDraftValue = advancedDraft.suspended;
  const suspendedPending = suspendedDraftValue !== suspendedAppliedValue;
  const suspendedFieldState = fieldHighlight(suspendedAppliedValue !== "any", suspendedPending);

  const numericFields: Array<{ key: AdvancedNumericField; label: string }> = [
    { key: "minMaxBuckets", label: "Max buckets >=" },
    { key: "maxMaxBuckets", label: "Max buckets <=" },
    { key: "minQuotaBytes", label: "Quota bytes >=" },
    { key: "maxQuotaBytes", label: "Quota bytes <=" },
    { key: "minQuotaObjects", label: "Quota objects >=" },
    { key: "maxQuotaObjects", label: "Quota objects <=" },
  ];
  const usageNumericFields: Array<{ key: AdvancedNumericField; label: string; format: "percent" }> = [
    { key: "minQuotaUsageSizePercent", label: "Quota usage size % >=", format: "percent" },
    { key: "maxQuotaUsageSizePercent", label: "Quota usage size % <=", format: "percent" },
    { key: "minQuotaUsageObjectPercent", label: "Quota usage objects % >=", format: "percent" },
    { key: "maxQuotaUsageObjectPercent", label: "Quota usage objects % <=", format: "percent" },
  ];
  const numericFieldStates = useMemo(() => {
    const states = {} as Record<AdvancedNumericField, { labelClass: string; fieldClass: string }>;
    [...numericFields, ...usageNumericFields].forEach(({ key }) => {
      const draft = (advancedDraft[key] as string).trim();
      const applied = (advancedApplied?.[key] as string | undefined)?.trim() ?? "";
      states[key] = fieldHighlight(Boolean(applied), draft !== applied);
    });
    return states;
  }, [advancedDraft, advancedApplied, numericFields, usageNumericFields]);

  const toggleQuickFilterMode = () => {
    if (quickFilterDraftForcesExact) return;
    setQuickFilterMode((prev) => (prev === "contains" ? "exact" : "contains"));
    setPage(1);
  };
  const updateAdvancedMatchMode = (
    field:
      | "tenantMatchMode"
      | "accountIdMatchMode"
      | "accountNameMatchMode"
      | "fullNameMatchMode"
      | "emailMatchMode",
    value: TextMatchMode
  ) => {
    setAdvancedDraft((prev) => ({ ...prev, [field]: value }));
  };

  const applyAdvancedFilter = () => {
    setAdvancedApplied(advancedDraft);
    setShowAdvancedFilter(false);
    setPage(1);
  };

  const resetAdvancedFilter = () => {
    setAdvancedDraft(defaultAdvancedFilter);
    setAdvancedApplied(null);
    setPage(1);
  };
  const closeAdvancedFilterDrawer = () => {
    setShowAdvancedFilter(false);
  };
  const advancedAppliedPayload = useMemo(
    () => buildAdvancedFilterPayload(advancedApplied, "", "contains", canViewMetrics),
    [advancedApplied, canViewMetrics]
  );
  const advancedDraftPayload = useMemo(
    () => buildAdvancedFilterPayload(advancedDraft, "", "contains", canViewMetrics),
    [advancedDraft, canViewMetrics]
  );
  const hasPendingAdvancedChanges = advancedDraftPayload !== advancedAppliedPayload;
  const hasAnyAdvancedToClear = advancedDraftPayload !== undefined || advancedAppliedPayload !== undefined;

  const resetAllFilters = () => {
    setFilter("");
    setSearchValue("");
    setQuickFilterMode("contains");
    setAdvancedDraft(defaultAdvancedFilter);
    setAdvancedApplied(null);
    setShowAdvancedFilter(false);
    setPage(1);
  };
  const clearAdvancedField = (field: AdvancedField) => {
    if (field === "suspended") {
      setAdvancedDraft((prev) => ({ ...prev, suspended: "any" }));
      setAdvancedApplied((prev) => (prev ? { ...prev, suspended: "any" } : prev));
      setPage(1);
      return;
    }
    setAdvancedDraft((prev) => ({ ...prev, [field]: "" }));
    setAdvancedApplied((prev) => (prev ? { ...prev, [field]: "" } : prev));
    setPage(1);
  };
  const removeActiveFilterItem = (action: ActiveFilterRemoveAction) => {
    if (action.type === "quick") {
      setFilter("");
      setSearchValue("");
      setPage(1);
      return;
    }
    clearAdvancedField(action.field);
  };

  const advancedFilterActive = hasAdvancedFilters(advancedApplied, canViewMetrics);
  const quickFilterActive = quickAppliedValue.length > 0;
  const activeFilterSummaryItems = useMemo(() => {
    const items: ActiveFilterSummaryItem[] = [];
    if (quickFilterActive) {
      const label = formatTextFilterSummary("UID", searchValue, effectiveQuickFilterMode);
      if (label) items.push({ id: "quick", label, remove: { type: "quick" } });
    }
    if (advancedApplied && hasAdvancedFilters(advancedApplied, canViewMetrics)) {
      const tenantLabel = formatTextFilterSummary("Tenant", advancedApplied.tenant, tenantAppliedMode);
      if (tenantLabel) items.push({ id: "tenant", label: tenantLabel, remove: { type: "advanced", field: "tenant" } });
      const accountIdLabel = formatTextFilterSummary("Account ID", advancedApplied.accountId, accountIdAppliedMode);
      if (accountIdLabel) items.push({ id: "accountId", label: accountIdLabel, remove: { type: "advanced", field: "accountId" } });
      const accountNameLabel = formatTextFilterSummary("Account name", advancedApplied.accountName, accountNameAppliedMode);
      if (accountNameLabel) items.push({ id: "accountName", label: accountNameLabel, remove: { type: "advanced", field: "accountName" } });
      const fullNameLabel = formatTextFilterSummary("Full name", advancedApplied.fullName, fullNameAppliedMode);
      if (fullNameLabel) items.push({ id: "fullName", label: fullNameLabel, remove: { type: "advanced", field: "fullName" } });
      const emailLabel = formatTextFilterSummary("Email", advancedApplied.email, emailAppliedMode);
      if (emailLabel) items.push({ id: "email", label: emailLabel, remove: { type: "advanced", field: "email" } });
      if (advancedApplied.suspended !== "any") {
        items.push({
          id: "suspended",
          label: `Status: ${advancedApplied.suspended === "active" ? "Active" : "Suspended"}`,
          remove: { type: "advanced", field: "suspended" },
        });
      }
      numericFields.forEach(({ key, label }) => {
        const raw = (advancedApplied[key] as string).trim();
        if (!raw) return;
        const numeric = Number(raw);
        const display = Number.isFinite(numeric) ? formatNumber(numeric) : raw;
        items.push({ id: `num-${key}`, label: `${label} ${display}`, remove: { type: "advanced", field: key } });
      });
      if (canViewMetrics) {
        usageNumericFields.forEach(({ key, label }) => {
          const raw = (advancedApplied[key] as string).trim();
          if (!raw) return;
          const numeric = Number(raw);
          const display = Number.isFinite(numeric) ? `${numeric}%` : raw;
          items.push({ id: `num-${key}`, label: `${label} ${display}`, remove: { type: "advanced", field: key } });
        });
      }
    }
    return items;
  }, [
    quickFilterActive,
    searchValue,
    effectiveQuickFilterMode,
    advancedApplied,
    canViewMetrics,
    tenantAppliedMode,
    accountIdAppliedMode,
    accountNameAppliedMode,
    fullNameAppliedMode,
    emailAppliedMode,
    numericFields,
    usageNumericFields,
  ]);
  const showActiveFiltersCard =
    activeFilterSummaryItems.length > 0 &&
    !(
      activeFilterSummaryItems.length === 1 &&
      quickFilterActive &&
      !advancedFilterActive &&
      !quickFilterAppliedParsed.listProvided
    );

  const advancedDraftSummaryItems = useMemo(() => {
    const items: Array<{ id: string; label: string }> = [];
    const tenantLabel = formatTextFilterSummary("Tenant", advancedDraft.tenant, tenantDraftMode);
    if (tenantLabel) items.push({ id: "draft-tenant", label: tenantLabel });
    const accountIdLabel = formatTextFilterSummary("Account ID", advancedDraft.accountId, accountIdDraftMode);
    if (accountIdLabel) items.push({ id: "draft-accountId", label: accountIdLabel });
    const accountNameLabel = formatTextFilterSummary("Account name", advancedDraft.accountName, accountNameDraftMode);
    if (accountNameLabel) items.push({ id: "draft-accountName", label: accountNameLabel });
    const fullNameLabel = formatTextFilterSummary("Full name", advancedDraft.fullName, fullNameDraftMode);
    if (fullNameLabel) items.push({ id: "draft-fullName", label: fullNameLabel });
    const emailLabel = formatTextFilterSummary("Email", advancedDraft.email, emailDraftMode);
    if (emailLabel) items.push({ id: "draft-email", label: emailLabel });
    if (advancedDraft.suspended !== "any") {
      items.push({
        id: "draft-suspended",
        label: `Status: ${advancedDraft.suspended === "active" ? "Active" : "Suspended"}`,
      });
    }
    numericFields.forEach(({ key, label }) => {
      const raw = (advancedDraft[key] as string).trim();
      if (!raw) return;
      const numeric = Number(raw);
      const display = Number.isFinite(numeric) ? formatNumber(numeric) : raw;
      items.push({ id: `draft-${key}`, label: `${label} ${display}` });
    });
    if (canViewMetrics) {
      usageNumericFields.forEach(({ key, label }) => {
        const raw = (advancedDraft[key] as string).trim();
        if (!raw) return;
        const numeric = Number(raw);
        const display = Number.isFinite(numeric) ? `${numeric}%` : raw;
        items.push({ id: `draft-${key}`, label: `${label} ${display}` });
      });
    }
    return items;
  }, [
    advancedDraft,
    canViewMetrics,
    tenantDraftMode,
    accountIdDraftMode,
    accountNameDraftMode,
    fullNameDraftMode,
    emailDraftMode,
    numericFields,
    usageNumericFields,
  ]);

  const advancedDraftTextCount =
    Number(tenantDraftValue.length > 0) +
    Number(accountIdDraftValue.length > 0) +
    Number(accountNameDraftValue.length > 0) +
    Number(fullNameDraftValue.length > 0) +
    Number(emailDraftValue.length > 0) +
    Number(suspendedDraftValue !== "any");
  const advancedDraftNumericCount =
    numericFields.filter(({ key }) => (advancedDraft[key] as string).trim().length > 0).length +
    (canViewMetrics
      ? usageNumericFields.filter(({ key }) => (advancedDraft[key] as string).trim().length > 0).length
      : 0);
  const advancedDraftActiveCount = advancedDraftTextCount + advancedDraftNumericCount;
  const advancedDraftGlobalCostLevel: FilterCostLevel = useMemo(() => {
    if (advancedDraftNumericCount >= 4) return "high";
    if (advancedDraftNumericCount > 0) return "medium";
    if (advancedDraftTextCount > 0) return "low";
    return "none";
  }, [advancedDraftNumericCount, advancedDraftTextCount]);
  const advancedDraftGlobalCostTooltip = useMemo(() => {
    if (advancedDraftGlobalCostLevel === "high") {
      return `${FILTER_COST_LABEL.high}: many numeric filters are active and may increase stats processing.`;
    }
    if (advancedDraftGlobalCostLevel === "medium") {
      return `${FILTER_COST_LABEL.medium}: numeric filters are active and rely on limits/quota counters.`;
    }
    if (advancedDraftGlobalCostLevel === "low") {
      return `${FILTER_COST_LABEL.low}: text/status filters are active.`;
    }
    return FILTER_COST_LABEL.none;
  }, [advancedDraftGlobalCostLevel]);

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
      label: "Act.",
      field: null,
      align: "right",
      headerClassName: "w-16",
      cellClassName: "!py-1.5",
      render: (user) => (
        <div className="inline-flex items-center">
          <details className="relative">
            <summary
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-300 bg-white text-sm font-semibold text-slate-600 transition hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500 dark:hover:text-primary-100 list-none [&::-webkit-details-marker]:hidden"
              aria-label="More actions"
              title="More actions"
            >
              ⋮
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-40 rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
              <button
                type="button"
                className={`${tableActionMenuItemClasses} !px-2 !py-1 !text-[11px]`}
                onClick={(event) => {
                  event.preventDefault();
                  setEditingTarget(user);
                  const parent = event.currentTarget.closest("details");
                  if (parent) parent.removeAttribute("open");
                }}
              >
                Configure
              </button>
              <button
                type="button"
                className={`${tableActionMenuItemClasses} !px-2 !py-1 !text-[11px]`}
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
  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: items.length,
  });

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
      {error && <PageBanner tone="error">{error}</PageBanner>}

      {!selectedEndpointId ? (
        <PageEmptyState
          title="Select a Ceph endpoint before listing RGW users"
          description="RGW user administration is endpoint-scoped. Choose an endpoint to load users, filters, and identity details."
          primaryAction={{ label: "Return to Ceph Admin", to: "/ceph-admin" }}
          tone="warning"
        />
      ) : (
        <div className="ui-surface-card">
          <ListToolbar
            title="Users"
            description="Complete RGW user inventory with tenant, account, and quota details."
            countLabel={`${total} result(s)`}
            search={
              <div className="relative w-full sm:w-72">
                <textarea
                  aria-label="Quick filter"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                  placeholder="UID(s)"
                  rows={1}
                  className={`w-full resize-y rounded-md border bg-white px-2.5 py-1.5 pr-9 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:bg-slate-900 dark:text-slate-100 ${
                    quickFilterFieldState.fieldClass || "border-slate-200 dark:border-slate-700"
                  }`}
                />
                <button
                  type="button"
                  onClick={toggleQuickFilterMode}
                  disabled={quickFilterDraftForcesExact}
                  className={modeToggleClass(quickFilterModeForDisplay, quickFilterPending, quickFilterDraftForcesExact)}
                  title={
                    quickFilterDraftForcesExact
                      ? "Quick filter mode: exact (locked by list input)"
                      : `Quick filter mode: ${quickFilterModeForDisplay === "contains" ? "contains" : "exact"}`
                  }
                  aria-label="Toggle quick filter match mode"
                >
                  {quickFilterModeForDisplay === "contains" ? "~" : "="}
                </button>
              </div>
            }
            filters={
              <button
                type="button"
                onClick={() => setShowAdvancedFilter(true)}
                className={`rounded-md border px-2.5 py-1.5 ui-caption font-semibold ${
                  showAdvancedFilter || advancedFilterActive
                    ? "border-primary/40 bg-primary-50 text-primary-700 dark:border-primary-400/40 dark:bg-primary-500/10 dark:text-primary-100"
                    : "border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                Advanced filter{advancedFilterActive ? " · Active" : ""}
              </button>
            }
            columns={
              <>
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
                      <ColumnVisibilityPicker
                        selectedCount={visibleColumns.length}
                        onReset={resetColumns}
                        coreGroups={USER_COLUMN_GROUPS.map((group) => ({
                          id: group.id,
                          label: group.label,
                          options: group.options.map((option) => ({
                            id: option.id,
                            label: option.label,
                            checked: visibleColumns.includes(option.id),
                            onToggle: () => toggleColumn(option.id),
                          })),
                        }))}
                      />
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
              </>
            }
            secondaryContent={
              <>
                {showActiveFiltersCard && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="ui-caption font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-200">
                        ACTIVE FILTERS
                      </p>
                      {activeFilterSummaryItems.map((item) => (
                        <span
                          key={item.id}
                          className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 ui-caption font-semibold text-primary-700 dark:border-primary-400/40 dark:bg-primary-500/15 dark:text-primary-100"
                        >
                          <span>{item.label}</span>
                          <button
                            type="button"
                            onClick={() => removeActiveFilterItem(item.remove)}
                            className="rounded-full px-1 leading-none opacity-70 hover:opacity-100"
                            title="Remove filter"
                            aria-label={`Remove ${item.label}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      <button
                        type="button"
                        onClick={resetAllFilters}
                        className="rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 ui-caption font-semibold text-rose-700 hover:border-rose-300 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100"
                      >
                        Clear all
                      </button>
                    </div>
                  </div>
                )}

                {showAdvancedFilter && (
                  <div className="fixed inset-x-0 bottom-0 top-14 z-40">
                    <button
                      type="button"
                      onClick={closeAdvancedFilterDrawer}
                      className="absolute inset-0 bg-slate-950/45 backdrop-blur-[1px]"
                      aria-label="Close advanced filter drawer"
                    />
                    <div className="absolute inset-y-0 right-0 flex w-full max-w-3xl flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                      <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Advanced filter</p>
                            <p className="ui-caption text-slate-500 dark:text-slate-400">RGW Users listing</p>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 ui-caption font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                                {advancedDraftActiveCount} rule{advancedDraftActiveCount > 1 ? "s" : ""}
                              </span>
                              <span
                                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 ui-caption font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                                title={advancedDraftGlobalCostTooltip}
                              >
                                Global draft cost
                                {renderFilterCostIndicator(advancedDraftGlobalCostLevel, advancedDraftGlobalCostTooltip)}
                              </span>
                              <span
                                className={`rounded-full border px-2 py-0.5 ui-caption font-semibold ${
                                  hasPendingAdvancedChanges
                                    ? "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-500/50 dark:bg-amber-500/20 dark:text-amber-200"
                                    : "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-500/50 dark:bg-emerald-500/20 dark:text-emerald-200"
                                }`}
                              >
                                {hasPendingAdvancedChanges ? "Unsaved changes" : "In sync"}
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={closeAdvancedFilterDrawer}
                            className="rounded-md border border-slate-200 px-2.5 py-1.5 ui-caption font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                          >
                            Close
                          </button>
                        </div>
                      </div>

                      <div className="flex-1 overflow-y-auto px-4 py-4">
                        <div className="space-y-4">
                          <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-800/40">
                            <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Draft summary
                            </p>
                            {advancedDraftSummaryItems.length === 0 ? (
                              <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">No advanced rule in draft.</p>
                            ) : (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {advancedDraftSummaryItems.map((item) => (
                                  <span
                                    key={item.id}
                                    className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 ui-caption font-semibold text-primary-700 dark:border-primary-400/40 dark:bg-primary-500/15 dark:text-primary-100"
                                  >
                                    {item.label}
                                  </span>
                                ))}
                              </div>
                            )}
                          </section>

                          <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                            <p className="mb-3 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Identity
                            </p>
                            <div className="grid gap-3 md:grid-cols-2">
                              {[
                                {
                                  id: "tenant" as const,
                                  label: "Tenant",
                                  value: advancedDraft.tenant,
                                  setMode: (value: TextMatchMode) => updateAdvancedMatchMode("tenantMatchMode", value),
                                  mode: tenantDraftMode,
                                  locked: tenantDraftForcesExact,
                                  fieldState: tenantFieldState,
                                  placeholder: "tenant-a, tenant-b",
                                },
                                {
                                  id: "accountId" as const,
                                  label: "Account ID",
                                  value: advancedDraft.accountId,
                                  setMode: (value: TextMatchMode) => updateAdvancedMatchMode("accountIdMatchMode", value),
                                  mode: accountIdDraftMode,
                                  locked: accountIdDraftForcesExact,
                                  fieldState: accountIdFieldState,
                                  placeholder: "RGW123..., RGW456...",
                                },
                                {
                                  id: "accountName" as const,
                                  label: "Account name",
                                  value: advancedDraft.accountName,
                                  setMode: (value: TextMatchMode) => updateAdvancedMatchMode("accountNameMatchMode", value),
                                  mode: accountNameDraftMode,
                                  locked: accountNameDraftForcesExact,
                                  fieldState: accountNameFieldState,
                                  placeholder: "Backup, Analytics",
                                },
                                {
                                  id: "fullName" as const,
                                  label: "Full name",
                                  value: advancedDraft.fullName,
                                  setMode: (value: TextMatchMode) => updateAdvancedMatchMode("fullNameMatchMode", value),
                                  mode: fullNameDraftMode,
                                  locked: fullNameDraftForcesExact,
                                  fieldState: fullNameFieldState,
                                  placeholder: "John Doe",
                                },
                                {
                                  id: "email" as const,
                                  label: "Email",
                                  value: advancedDraft.email,
                                  setMode: (value: TextMatchMode) => updateAdvancedMatchMode("emailMatchMode", value),
                                  mode: emailDraftMode,
                                  locked: emailDraftForcesExact,
                                  fieldState: emailFieldState,
                                  placeholder: "user@example.com",
                                },
                              ].map((field) => (
                                <div key={field.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                                  <div className="flex items-center justify-between gap-2">
                                    <label
                                      className={`ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${field.fieldState.labelClass}`}
                                    >
                                      <span className="inline-flex items-center gap-1">
                                        <span>{field.label}</span>
                                        {renderFilterCostIndicator("low", "Low cost: text-based identity filter.")}
                                      </span>
                                    </label>
                                    <div className="inline-flex items-center gap-1">
                                      <button
                                        type="button"
                                        disabled={field.locked}
                                        onClick={() => field.setMode("contains")}
                                        className={matchModeButtonClass(field.mode === "contains", field.locked)}
                                      >
                                        Contains
                                      </button>
                                      <button
                                        type="button"
                                        disabled={field.locked}
                                        onClick={() => field.setMode("exact")}
                                        className={matchModeButtonClass(field.mode === "exact", field.locked)}
                                      >
                                        Exact
                                      </button>
                                    </div>
                                  </div>
                                  <textarea
                                    value={field.value}
                                    onChange={(e) => updateAdvancedField(field.id, e.target.value)}
                                    onKeyDown={(event) => event.stopPropagation()}
                                    placeholder={field.placeholder}
                                    rows={2}
                                    className={`mt-2 w-full resize-y rounded-md border border-slate-200 px-2 py-1.5 ui-caption font-normal text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${field.fieldState.fieldClass}`}
                                  />
                                </div>
                              ))}

                              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                                <label
                                  className={`ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${suspendedFieldState.labelClass}`}
                                >
                                  <span className="inline-flex items-center gap-1">
                                    <span>Status</span>
                                    {renderFilterCostIndicator("low", "Low cost: boolean status filter.")}
                                  </span>
                                </label>
                                <select
                                  value={advancedDraft.suspended}
                                  onChange={(e) => updateAdvancedField("suspended", e.target.value as AdvancedStatusFilter)}
                                  className={`mt-2 w-full rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${suspendedFieldState.fieldClass}`}
                                >
                                  <option value="any">Any</option>
                                  <option value="active">Active</option>
                                  <option value="suspended">Suspended</option>
                                </select>
                              </div>
                            </div>
                          </section>

                          <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                            <p className="mb-3 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Limits and Quotas
                            </p>
                            <div className="grid gap-2 sm:grid-cols-2">
                              {numericFields.map((field) => (
                                <label
                                  key={field.key}
                                  className={`flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200 ${numericFieldStates[field.key].labelClass}`}
                                >
                                  <span className="inline-flex items-center gap-1">
                                    <span>{field.label}</span>
                                    {renderFilterCostIndicator("medium", "Medium cost: numeric filters rely on limits/quota counters.")}
                                  </span>
                                  <input
                                    type="number"
                                    value={advancedDraft[field.key]}
                                    onChange={(e) => updateAdvancedField(field.key, e.target.value)}
                                    className={`rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${numericFieldStates[field.key].fieldClass}`}
                                  />
                                </label>
                              ))}
                            </div>
                            {canViewMetrics && (
                              <div className="mt-4">
                                <p className="mb-3 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  Quota usage %
                                </p>
                                <div className="grid gap-2 sm:grid-cols-2">
                                  {usageNumericFields.map((field) => (
                                    <label
                                      key={field.key}
                                      className={`flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200 ${numericFieldStates[field.key].labelClass}`}
                                    >
                                      <span className="inline-flex items-center gap-1">
                                        <span>{field.label}</span>
                                        {renderFilterCostIndicator("medium", "Medium cost: usage percentage filters require bucket metrics aggregation.")}
                                      </span>
                                      <input
                                        type="number"
                                        min="0"
                                        value={advancedDraft[field.key]}
                                        onChange={(e) => updateAdvancedField(field.key, e.target.value)}
                                        className={`rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${numericFieldStates[field.key].fieldClass}`}
                                      />
                                    </label>
                                  ))}
                                </div>
                              </div>
                            )}
                          </section>
                        </div>
                      </div>

                      <div className="border-t border-slate-200 px-4 py-3 dark:border-slate-800">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={resetAdvancedFilter}
                            disabled={!hasAnyAdvancedToClear}
                            className={`rounded-md border px-2.5 py-1.5 ui-caption font-semibold ${
                              hasAnyAdvancedToClear
                                ? "border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                                : "cursor-not-allowed border-slate-200 text-slate-400 dark:border-slate-700 dark:text-slate-500"
                            }`}
                          >
                            Clear
                          </button>
                          <button
                            type="button"
                            onClick={applyAdvancedFilter}
                            className="rounded-md bg-primary px-2.5 py-1.5 ui-caption font-semibold text-white shadow-sm hover:bg-primary-600"
                          >
                            Apply filter
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            }
          />

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
                {tableStatus === "loading" && <TableEmptyState colSpan={userTableColumns.length} message="Loading users..." />}
                {tableStatus === "error" && (
                  <TableEmptyState colSpan={userTableColumns.length} message="Unable to load users." tone="error" />
                )}
                {tableStatus === "empty" && <TableEmptyState colSpan={userTableColumns.length} message="No users found." />}
                {items.map((user) => (
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
      )}

      {selectedEndpointId && editingTarget && (
        <CephAdminUserEditModal
          endpointId={selectedEndpointId}
          endpointUrl={selectedEndpoint?.endpoint_url ?? null}
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
          endpointUrl={selectedEndpoint?.endpoint_url ?? null}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setReloadNonce((prev) => prev + 1);
          }}
        />
      )}
    </div>
  );
}
