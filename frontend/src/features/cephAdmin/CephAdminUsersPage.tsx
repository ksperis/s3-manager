/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ActiveFiltersBar from "../../components/ActiveFiltersBar";
import ListToolbar from "../../components/ListToolbar";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import ColumnVisibilityPicker from "../../components/ColumnVisibilityPicker";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { toolbarCompactButtonClasses } from "../../components/toolbarControlClasses";
import { cx, uiButtonBaseClass, uiButtonVariants } from "../../components/ui/styles";
import UiButton from "../../components/ui/UiButton";
import { CephAdminRgwUser, CephAdminRgwUserDetail, listCephAdminUsers, streamCephAdminUsers } from "../../api/cephAdmin";
import { tableActionMenuItemClasses, tableCompactIconActionButtonClasses } from "../../components/tableActionClasses";
import CephAdminUserCreateModal from "./CephAdminUserCreateModal";
import CephAdminUserEditModal from "./CephAdminUserEditModal";
import { useCephAdminEndpoint } from "./CephAdminEndpointContext";
import {
  FILTER_COST_LABEL,
  INACTIVE_ADVANCED_PROGRESS,
  advancedFilterBackdropClass,
  advancedFilterBodyClass,
  advancedFilterDrawerClass,
  advancedFilterFooterClass,
  advancedFilterHeaderClass,
  advancedFilterMatchModeButtonClass,
  advancedFilterRootClass,
  advancedFilterSectionClass,
  advancedFilterSummaryChipClass,
  advancedFilterSummaryClass,
  advancedFilterSyncBadgeClass,
  advancedFilterToolbarButtonClass,
  buildTextFieldRules,
  formatAdvancedFilterSyncLabel,
  formatQuickFilterMatchModeTitle,
  formatTextMatchModeSymbol,
  formatTextFilterSummary,
  isCancelledError,
  parseExactListInput,
  progressFromAdvancedSearchEvent,
  quickFilterMatchModeButtonClass,
  renderAdvancedSearchProgress,
  renderFilterCostIndicator,
  type FilterCostLevel,
  type TextMatchMode,
} from "./filtering/advancedFilterShared";
import { extractApiError } from "../../utils/apiError";
import { readClientJsonFromKey, writeClientJsonToKey } from "../../utils/clientStorage";
import { formatBytes, formatNumber } from "../../utils/format";

const extractError = (err: unknown): string => {
  return extractApiError(err, "Unexpected error");
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
  const parsed = readClientJsonFromKey<unknown>(COLUMNS_STORAGE_KEY);
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
};

const persistVisibleColumns = (value: ColumnId[]) => {
  writeClientJsonToKey(COLUMNS_STORAGE_KEY, value);
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
  const [advancedProgress, setAdvancedProgress] = useState(INACTIVE_ADVANCED_PROGRESS);
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
  const requestAbortRef = useRef<AbortController | null>(null);

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
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
      setItems([]);
      setTotal(0);
      setLoading(false);
      setLoadingDetails(false);
      setAdvancedProgress(INACTIVE_ADVANCED_PROGRESS);
      return;
    }

    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;
    requestAbortRef.current?.abort();
    const requestAbort = new AbortController();
    requestAbortRef.current = requestAbort;

    const load = async () => {
      setLoading(true);
      setLoadingDetails(false);
      setAdvancedProgress(INACTIVE_ADVANCED_PROGRESS);
      setError(null);
      setItems([]);
      setTotal(0);
      try {
        const baseParams = {
          page,
          page_size: pageSize,
          search: effectiveSearchValue || undefined,
          advanced_filter: advancedFilterParam,
          sort_by: sort.field,
          sort_dir: sort.direction,
        };
        const canUseAdvancedStream = typeof advancedFilterParam === "string" && advancedFilterParam.trim().startsWith("{");

        let baseResponse;
        if (canUseAdvancedStream) {
          setAdvancedProgress({
            active: true,
            determinate: true,
            percent: 0,
            stage: "prepare",
            message: "Preparing advanced search...",
            processed: 0,
            total: 0,
          });
          try {
            baseResponse = await streamCephAdminUsers(selectedEndpointId, baseParams, {
              signal: requestAbort.signal,
              onProgress: (event) => {
                if (requestId !== requestSeqRef.current || requestAbort.signal.aborted) return;
                setAdvancedProgress(progressFromAdvancedSearchEvent(event));
              },
            });
          } catch (streamErr) {
            if (isCancelledError(streamErr)) return;
            if (requestId !== requestSeqRef.current) return;
            setAdvancedProgress({
              active: true,
              determinate: false,
              percent: 0,
              stage: "fallback",
              message: "Advanced search in progress...",
              processed: 0,
              total: 0,
            });
            baseResponse = await listCephAdminUsers(selectedEndpointId, baseParams, { signal: requestAbort.signal });
          }
        } else {
          baseResponse = await listCephAdminUsers(selectedEndpointId, baseParams, { signal: requestAbort.signal });
        }
        if (requestAbort.signal.aborted) return;
        if (requestId !== requestSeqRef.current) return;

        const baseItems = baseResponse.items ?? [];
        setItems(baseItems);
        setTotal(baseResponse.total ?? 0);
        setLoading(false);
        setAdvancedProgress(INACTIVE_ADVANCED_PROGRESS);

        if (includeParams.length === 0 || baseItems.length === 0) return;

        setLoadingDetails(true);
        try {
          if (requestAbort.signal.aborted) return;
          const detailResponse = await listCephAdminUsers(selectedEndpointId, {
            page,
            page_size: pageSize,
            search: effectiveSearchValue || undefined,
            advanced_filter: advancedFilterParam,
            sort_by: sort.field,
            sort_dir: sort.direction,
            include: includeParams,
          }, { signal: requestAbort.signal });
          if (requestAbort.signal.aborted) return;
          if (requestId !== requestSeqRef.current) return;

          const detailsByKey = new Map((detailResponse.items ?? []).map((user) => [rowKey(user), user]));
          setItems(baseItems.map((user) => detailsByKey.get(rowKey(user)) ?? user));
        } finally {
          if (requestId === requestSeqRef.current) {
            setLoadingDetails(false);
          }
        }
      } catch (err) {
        if (isCancelledError(err)) return;
        if (requestId !== requestSeqRef.current) return;
        setError(extractError(err));
        setItems([]);
        setTotal(0);
        setLoading(false);
        setLoadingDetails(false);
        setAdvancedProgress(INACTIVE_ADVANCED_PROGRESS);
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

  useEffect(() => {
    return () => {
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
    };
  }, []);

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
  const advancedFilterCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showAdvancedFilter && hasPendingAdvancedChanges,
    onClose: closeAdvancedFilterDrawer,
    zIndexClass: "z-[70]",
  });

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
  const advancedDraftDirectTextCount = Number(tenantDraftValue.length > 0);
  const advancedDraftEnrichedTextCount =
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
    if (advancedDraftEnrichedTextCount > 0) return "medium";
    if (advancedDraftDirectTextCount > 0) return "low";
    return "none";
  }, [advancedDraftDirectTextCount, advancedDraftEnrichedTextCount, advancedDraftNumericCount]);
  const advancedDraftGlobalCostTooltip = useMemo(() => {
    if (advancedDraftGlobalCostLevel === "high") {
      return `${FILTER_COST_LABEL.high}: many numeric filters are active and may increase stats processing.`;
    }
    if (advancedDraftGlobalCostLevel === "medium") {
      if (advancedDraftEnrichedTextCount > 0 && advancedDraftNumericCount === 0) {
        return `${FILTER_COST_LABEL.medium}: enriched identity/status filters require per-user detail lookups.`;
      }
      return `${FILTER_COST_LABEL.medium}: numeric filters are active and rely on limits/quota counters.`;
    }
    if (advancedDraftGlobalCostLevel === "low") {
      return `${FILTER_COST_LABEL.low}: direct metadata filters are active.`;
    }
    return FILTER_COST_LABEL.none;
  }, [advancedDraftEnrichedTextCount, advancedDraftGlobalCostLevel, advancedDraftNumericCount]);

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

  type ColumnDef = DataTableColumn<CephAdminRgwUser, SortField>;

  const detailPlaceholder = loadingDetails ? "Loading..." : "-";

  const userTableColumns: ColumnDef[] = (() => {
    const cols: ColumnDef[] = [
      {
        id: "uid",
        label: "UID",
        field: "uid",
        primary: true,
        headerClassName: "min-w-[12rem] max-w-[20rem]",
        cellClassName: "min-w-[12rem] max-w-[20rem]",
        render: (user) => user.uid,
      },
    ];

    const visible = new Set(visibleColumns);
    if (visible.has("tenant")) {
      cols.push({
        id: "tenant",
        label: "Tenant",
        field: "tenant",
        headerClassName: "min-w-[10rem] max-w-[16rem]",
        cellClassName: "min-w-[10rem] max-w-[16rem]",
        render: (user) => user.tenant ?? "-",
      });
    }
    if (visible.has("account_name")) {
      cols.push({
        id: "account_name",
        label: "Account",
        field: "account_name",
        headerClassName: "min-w-[12rem] max-w-[18rem]",
        cellClassName: "min-w-[12rem] max-w-[18rem]",
        render: (user) => user.account_name ?? user.account_id ?? detailPlaceholder,
      });
    }
    if (visible.has("full_name")) {
      cols.push({
        id: "full_name",
        label: "Full name",
        field: "full_name",
        headerClassName: "min-w-[12rem] max-w-[18rem]",
        cellClassName: "min-w-[12rem] max-w-[18rem]",
        render: (user) => user.full_name ?? detailPlaceholder,
      });
    }
    if (visible.has("email")) {
      cols.push({
        id: "email",
        label: "Email",
        field: "email",
        headerClassName: "min-w-[14rem] max-w-[22rem]",
        cellClassName: "min-w-[14rem] max-w-[22rem]",
        render: (user) => user.email ?? detailPlaceholder,
      });
    }
    if (visible.has("suspended")) {
      cols.push({
        id: "suspended",
        label: "Suspended",
        field: "suspended",
        headerClassName: "min-w-[8rem]",
        cellClassName: "min-w-[8rem]",
        render: (user) => renderSuspended(user.suspended),
      });
    }
    if (visible.has("max_buckets")) {
      cols.push({
        id: "max_buckets",
        label: "Max buckets",
        field: "max_buckets",
        align: "right",
        headerClassName: "min-w-[8rem]",
        cellClassName: "min-w-[8rem]",
        render: (user) => (user.max_buckets == null ? detailPlaceholder : formatNumber(user.max_buckets)),
      });
    }
    if (visible.has("quota_max_size_bytes")) {
      cols.push({
        id: "quota_max_size_bytes",
        label: "Quota (size)",
        field: "quota_max_size_bytes",
        align: "right",
        headerClassName: "min-w-[9rem]",
        cellClassName: "min-w-[9rem]",
        render: (user) => (user.quota_max_size_bytes == null ? detailPlaceholder : formatBytes(user.quota_max_size_bytes)),
      });
    }
    if (visible.has("quota_max_objects")) {
      cols.push({
        id: "quota_max_objects",
        label: "Quota (objects)",
        field: "quota_max_objects",
        align: "right",
        headerClassName: "min-w-[10rem]",
        cellClassName: "min-w-[10rem]",
        render: (user) => (user.quota_max_objects == null ? detailPlaceholder : formatNumber(user.quota_max_objects)),
      });
    }

    cols.push({
      id: "actions",
      label: "Act.",
      field: null,
      align: "right",
      mobileRole: "actions",
      headerClassName: "w-16",
      cellClassName: "!py-1.5",
      render: (user) => (
        <div className="inline-flex items-center">
            <details className="relative">
              <summary
                className={`${tableCompactIconActionButtonClasses} list-none [&::-webkit-details-marker]:hidden`}
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
            showHeading={false}
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
                  className={quickFilterMatchModeButtonClass(
                    quickFilterModeForDisplay,
                    quickFilterPending,
                    quickFilterDraftForcesExact
                  )}
                  title={formatQuickFilterMatchModeTitle(quickFilterModeForDisplay, quickFilterDraftForcesExact)}
                  aria-label="Toggle quick filter match mode"
                >
                  {formatTextMatchModeSymbol(quickFilterModeForDisplay)}
                </button>
              </div>
            }
            filters={
              <button
                type="button"
                onClick={() => setShowAdvancedFilter(true)}
                className={advancedFilterToolbarButtonClass(showAdvancedFilter || advancedFilterActive)}
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
                    className={toolbarCompactButtonClasses}
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
                  className={cx(uiButtonBaseClass, uiButtonVariants.danger, "px-2.5 py-1.5 ui-caption")}
                >
                  Reset Columns
                </button>
              </>
            }
            secondaryContent={
              showActiveFiltersCard || showAdvancedFilter ? (
              <>
                <ActiveFiltersBar
                  items={
                    showActiveFiltersCard
                      ? activeFilterSummaryItems.map((item) => ({
                          id: item.id,
                          label: item.label,
                          onRemove: () => removeActiveFilterItem(item.remove),
                          removeLabel: `Remove ${item.label}`,
                        }))
                      : []
                  }
                  onClearAll={resetAllFilters}
                />

                {showAdvancedFilter && (
                  <div className={advancedFilterRootClass}>
                    <button
                      type="button"
                      onClick={advancedFilterCloseGuard.requestClose}
                      className={advancedFilterBackdropClass}
                      aria-label="Close advanced filter drawer"
                    />
                    <div className={advancedFilterDrawerClass}>
                      <div className={advancedFilterHeaderClass}>
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
                              <span className={advancedFilterSyncBadgeClass(hasPendingAdvancedChanges)}>
                                {formatAdvancedFilterSyncLabel(hasPendingAdvancedChanges)}
                              </span>
                            </div>
                          </div>
                          <UiButton variant="secondary" size="sm" onClick={advancedFilterCloseGuard.requestClose}>
                            Close
                          </UiButton>
                        </div>
                      </div>

                      <div className={advancedFilterBodyClass}>
                        <div className="space-y-4">
                          <section className={advancedFilterSummaryClass}>
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
                                    className={advancedFilterSummaryChipClass}
                                  >
                                    {item.label}
                                  </span>
                                ))}
                              </div>
                            )}
                          </section>

                          <section className={advancedFilterSectionClass}>
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
                                  costLevel: "low" as const,
                                  costTooltip: "Low cost: tenant filters run on direct user metadata.",
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
                                  costLevel: "medium" as const,
                                  costTooltip: "Medium cost: account ID filters require per-user account details.",
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
                                  costLevel: "medium" as const,
                                  costTooltip: "Medium cost: account name filters require account lookups.",
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
                                  costLevel: "medium" as const,
                                  costTooltip: "Medium cost: full name filters require per-user profile lookups.",
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
                                  costLevel: "medium" as const,
                                  costTooltip: "Medium cost: email filters require per-user profile lookups.",
                                },
                              ].map((field) => (
                                <div key={field.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                                  <div className="flex items-center justify-between gap-2">
                                    <label
                                      className={`ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${field.fieldState.labelClass}`}
                                    >
                                      <span className="inline-flex items-center gap-1">
                                        <span>{field.label}</span>
                                        {renderFilterCostIndicator(field.costLevel, field.costTooltip)}
                                      </span>
                                    </label>
                                    <div className="inline-flex items-center gap-1">
                                      <button
                                        type="button"
                                        disabled={field.locked}
                                        onClick={() => field.setMode("contains")}
                                        className={advancedFilterMatchModeButtonClass(field.mode === "contains", field.locked)}
                                      >
                                        Contains
                                      </button>
                                      <button
                                        type="button"
                                        disabled={field.locked}
                                        onClick={() => field.setMode("exact")}
                                        className={advancedFilterMatchModeButtonClass(field.mode === "exact", field.locked)}
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
                                    {renderFilterCostIndicator("medium", "Medium cost: status filters require per-user status details.")}
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

                          <section className={advancedFilterSectionClass}>
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

                      <div className={advancedFilterFooterClass}>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <UiButton
                            variant="secondary"
                            size="sm"
                            onClick={resetAdvancedFilter}
                            disabled={!hasAnyAdvancedToClear}
                          >
                            Clear
                          </UiButton>
                          <UiButton size="sm" onClick={applyAdvancedFilter}>
                            Apply filter
                          </UiButton>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
              ) : null
            }
          />

          {renderAdvancedSearchProgress(advancedProgress)}

          <DataTableShell
            columns={userTableColumns}
            rows={items}
            rowKey={rowKey}
            status={tableStatus}
            loadingMessage="Loading users..."
            errorMessage="Unable to load users."
            emptyMessage="No users."
            primaryColumnId="uid"
            overflowXHidden={showAdvancedFilter}
            responsiveCards
            sort={{ field: sort.field, direction: sort.direction, onSort: toggleSort }}
            pagination={{
              page,
              pageSize,
              total,
              onPageChange: setPage,
              onPageSizeChange: (size) => {
                setPageSize(size);
                setPage(1);
              },
              disabled: loading || !selectedEndpointId,
            }}
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
      {advancedFilterCloseGuard.confirmationDialog}
    </div>
  );
}
