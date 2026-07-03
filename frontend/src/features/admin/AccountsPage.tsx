/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { uiCheckboxClass } from "../../components/ui/styles";
import {
  AccountGroupLink,
  AccountUserLink,
  ImportS3AccountPayload,
  S3Account,
  S3AccountSummary,
  createS3Account,
  deleteS3Account,
  fetchAccountPortalSettings,
  getS3Account,
  importS3Accounts,
  listS3Accounts,
  updateAccountPortalSettings,
  updateS3Account,
} from "../../api/accounts";
import type { PortalSettingsOverride } from "../../api/appSettings";
import type { PortalAccountSettings } from "../../api/portal";
import { getStorageEndpoint, listStorageEndpoints, StorageEndpoint } from "../../api/storageEndpoints";
import { listMinimalGroups, type UiGroupSummary } from "../../api/groups";
import { listMinimalUsers, UserSummary } from "../../api/users";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import Modal from "../../components/Modal";
import ListToolbar from "../../components/ListToolbar";
import PageHeader from "../../components/PageHeader";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import PageBanner from "../../components/PageBanner";
import PaginationControls from "../../components/PaginationControls";
import { PortalSettingsItem, PortalSettingsSection } from "../../components/PortalSettingsLayout";
import StorageUsageCard from "../../components/StorageUsageCard";
import TableEmptyState from "../../components/TableEmptyState";
import UiTagBadgeList from "../../components/UiTagBadgeList";
import UiTagEditor from "../../components/UiTagEditor";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { toolbarCompactInputClasses } from "../../components/toolbarControlClasses";
import { useTagCatalog } from "../../hooks/useTagCatalog";
import { useAdminAccountStats } from "./useAdminAccountStats";
import AssociationSummary, {
  AccountAssociationChips,
  type AssociationAccountItem,
} from "./AssociationSummary";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { extractApiError } from "../../utils/apiError";
import { confirmAction } from "../../utils/confirm";
import { stableSignature } from "../../utils/stableSignature";
import { isAdminLikeRole, readStoredUser } from "../../utils/workspaces";
import { buildUiTagItems, extractUiTagLabels, normalizeUiTags, type UiTagDefinition } from "../../utils/uiTags";

type SortField = "name" | "rgw_account_id";
type EditTab = "general" | "users" | "groups" | "privileged" | "portal";
type TriState = "inherit" | "enabled" | "disabled";
type PolicyMode = "inherit" | "actions";
type TextMatchMode = "contains" | "exact";
type PortalAccountRole = "portal_none" | "portal_user" | "portal_manager";
type PortalOverrideFormSnapshot = {
  bucketCreate: TriState;
  namedBucketCreate: TriState;
  accessKeyCreate: TriState;
  versioning: TriState;
  lifecycle: TriState;
  cors: TriState;
  corsOriginsOverride: boolean;
  corsOriginsText: string;
  managerPolicyMode: PolicyMode;
  managerPolicyActionsText: string;
  userPolicyMode: PolicyMode;
  userPolicyActionsText: string;
  bucketPolicyMode: PolicyMode;
  bucketPolicyActionsText: string;
};

const hasOwn = (value: Record<string, unknown> | null | undefined, key: string) =>
  Boolean(value && Object.prototype.hasOwnProperty.call(value, key));

const normalizeListInput = (value: string): string[] =>
  value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const resolveTriState = (value?: boolean | null): TriState => {
  if (value == null) return "inherit";
  return value ? "enabled" : "disabled";
};

const toOverrideValue = (value: TriState): boolean | undefined => {
  if (value === "inherit") return undefined;
  return value === "enabled";
};

const buildPortalOverrideFormSignature = (snapshot: PortalOverrideFormSnapshot) =>
  stableSignature({ portalOverrides: snapshot });

const PORTAL_ROLE_OPTIONS: { value: PortalAccountRole; label: string }[] = [
  { value: "portal_none", label: "No portal access" },
  { value: "portal_user", label: "Portal user" },
  { value: "portal_manager", label: "Portal manager" },
];

function normalizePortalRole(value?: string | null): PortalAccountRole {
  if (value === "portal_user" || value === "portal_manager") return value;
  return "portal_none";
}

export default function S3AccountsPage() {
  const { generalSettings } = useGeneralSettings();
  const portalEnabled = generalSettings.portal_enabled;
  const [accounts, setS3Accounts] = useState<S3Account[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [totalAccounts, setTotalAccounts] = useState(0);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState<string>("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [sort, setSort] = useState<{ field: SortField; direction: "asc" | "desc" }>({
    field: "name",
    direction: "asc",
  });
  const [filter, setFilter] = useState("");
  const [quickFilterMode, setQuickFilterMode] = useState<TextMatchMode>("contains");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [form, setForm] = useState({
    name: "",
    email: "",
    tags: [] as UiTagDefinition[],
    quota_max_size_gb: "",
    quota_max_size_unit: "GiB",
    quota_max_objects: "",
    storage_endpoint_id: "",
  });
  const [createInitialSignature, setCreateInitialSignature] = useState("");
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [groups, setGroups] = useState<UiGroupSummary[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [storageEndpoints, setStorageEndpoints] = useState<StorageEndpoint[]>([]);
  const [loadingEndpoints, setLoadingEndpoints] = useState(false);
  const [endpointsLoaded, setEndpointsLoaded] = useState(false);
  const [endpointAccountsWrite, setEndpointAccountsWrite] = useState<Record<number, boolean>>({});
  const [endpointPermissionLoading, setEndpointPermissionLoading] = useState<Record<number, boolean>>({});
  const [endpointPermissionErrors, setEndpointPermissionErrors] = useState<Record<number, string | null>>({});
  const [importTenantEndpointId, setImportTenantEndpointId] = useState<string>("");
  const [importInitialSignature, setImportInitialSignature] = useState("");
  const [editingS3Account, setEditingS3Account] = useState<S3Account | null>(null);
  const [editForm, setEditForm] = useState({
    tags: [] as UiTagDefinition[],
    quota_max_size_gb: "",
    quota_max_size_unit: "GiB",
    quota_max_objects: "",
    user_links: [] as AccountUserLink[],
    group_links: [] as AccountGroupLink[],
    allow_manager_bucket_quota: false,
  });
  const [editInitialSignature, setEditInitialSignature] = useState("");
  const [portalInitialSignature, setPortalInitialSignature] = useState("");
  const [editTab, setEditTab] = useState<EditTab>("general");
  const [portalAccountSettings, setPortalAccountSettings] = useState<PortalAccountSettings | null>(null);
  const [portalSettingsLoading, setPortalSettingsLoading] = useState(false);
  const [portalSettingsError, setPortalSettingsError] = useState<string | null>(null);
  const [portalSettingsSaving, setPortalSettingsSaving] = useState(false);
  const [portalSettingsMessage, setPortalSettingsMessage] = useState<string | null>(null);
  const [adminPortalBucketCreateOverride, setAdminPortalBucketCreateOverride] = useState<TriState>("inherit");
  const [adminPortalNamedBucketCreateOverride, setAdminPortalNamedBucketCreateOverride] = useState<TriState>("inherit");
  const [adminPortalAccessKeyCreateOverride, setAdminPortalAccessKeyCreateOverride] = useState<TriState>("inherit");
  const [adminBucketVersioningOverride, setAdminBucketVersioningOverride] = useState<TriState>("inherit");
  const [adminBucketLifecycleOverride, setAdminBucketLifecycleOverride] = useState<TriState>("inherit");
  const [adminBucketCorsOverride, setAdminBucketCorsOverride] = useState<TriState>("inherit");
  const [adminBucketCorsOriginsOverride, setAdminBucketCorsOriginsOverride] = useState(false);
  const [adminBucketCorsOriginsText, setAdminBucketCorsOriginsText] = useState("");
  const [adminManagerPolicyMode, setAdminManagerPolicyMode] = useState<PolicyMode>("inherit");
  const [adminManagerPolicyActionsText, setAdminManagerPolicyActionsText] = useState("");
  const [adminUserPolicyMode, setAdminUserPolicyMode] = useState<PolicyMode>("inherit");
  const [adminUserPolicyActionsText, setAdminUserPolicyActionsText] = useState("");
  const [adminBucketPolicyMode, setAdminBucketPolicyMode] = useState<PolicyMode>("inherit");
  const [adminBucketPolicyActionsText, setAdminBucketPolicyActionsText] = useState("");
  const [deletingS3AccountId, setDeletingS3AccountId] = useState<number | null>(null);
  const [accountToDelete, setS3AccountToDelete] = useState<S3Account | null>(null);
  const [deleteFromRgw, setDeleteFromRgw] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
  const [showUserPanel, setShowUserPanel] = useState(false);
  const [showGroupPanel, setShowGroupPanel] = useState(false);
  const [userSelections, setUserSelections] = useState<number[]>([]);
  const [groupSelections, setGroupSelections] = useState<number[]>([]);
  const [userAdminChoice, setUserAdminChoice] = useState<Record<number, boolean>>({});
  const [groupAdminChoice, setGroupAdminChoice] = useState<Record<number, boolean>>({});
  const MAX_LINK_OPTIONS = 10;
  const currentUser = useMemo(() => {
    return readStoredUser() as { role?: string | null } | null;
  }, []);
  const isSuperAdmin = isAdminLikeRole(currentUser?.role);
  const canManagePrivilegedTargets = isAdminLikeRole(currentUser?.role);
  const editingAccountId = editingS3Account?.db_id ?? null;
  const editingEndpoint = useMemo(() => {
    if (!editingS3Account?.storage_endpoint_id) return null;
    return storageEndpoints.find((endpoint) => endpoint.id === editingS3Account.storage_endpoint_id) ?? null;
  }, [editingS3Account?.storage_endpoint_id, storageEndpoints]);
  const editingCapabilities =
    editingS3Account?.storage_endpoint_capabilities ?? editingEndpoint?.capabilities ?? null;
  const editingEndpointId = editingS3Account?.storage_endpoint_id ?? null;
  const editingEndpointCanWrite = editingEndpointId ? endpointAccountsWrite[editingEndpointId] === true : false;
  const usageEnabled = Boolean(editingCapabilities?.usage);
  const adminEnabled = Boolean(editingCapabilities?.admin);
  const hasUsageIdentity = Boolean(editingS3Account?.rgw_account_id || editingS3Account?.rgw_user_uid);
  const allowUsageStats = usageEnabled && hasUsageIdentity;
  const allowQuotaUpdates =
    adminEnabled &&
    editingEndpointCanWrite &&
    Boolean(editingS3Account?.rgw_account_id);
  const effectivePortalSettings = portalAccountSettings?.effective ?? null;
  const showGeneralTab = editTab === "general";
  const showUsersTab = editTab === "users";
  const showGroupsTab = editTab === "groups";
  const showPrivilegedTab = editTab === "privileged";
  const showPortalTab = portalEnabled && editTab === "portal";
  const {
    catalog: adminTagCatalog,
    loading: adminTagCatalogLoading,
    error: adminTagCatalogError,
  } = useTagCatalog(
    { kind: "admin", domain: "admin_managed" },
    Boolean(isSuperAdmin && (showCreateModal || editingS3Account))
  );
  const {
    stats: editingUsageStats,
    loading: editingUsageLoading,
    error: editingUsageError,
  } = useAdminAccountStats(editingAccountId, Boolean(editingAccountId && isSuperAdmin && allowUsageStats));
  const toggleUserSelection = (userId: number) => {
    setUserSelections((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };
  const toggleGroupSelection = (groupId: number) => {
    setGroupSelections((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  };

  const cephEndpoints = useMemo(
    () => storageEndpoints.filter((ep) => ep.provider === "ceph"),
    [storageEndpoints]
  );
  const accountCephEndpoints = useMemo(
    () => cephEndpoints.filter((ep) => Boolean(ep.capabilities?.account)),
    [cephEndpoints]
  );

  const resolveS3AccountType = (
    account:
      | Pick<S3Account, "rgw_account_id" | "rgw_user_uid" | "is_s3_user">
      | (S3AccountSummary & { rgw_user_uid?: string | null })
  ): "tenant" | "rgw_user" => {
    if (typeof account.is_s3_user === "boolean") {
      return account.is_s3_user ? "rgw_user" : "tenant";
    }
    if (account.rgw_account_id) {
      return "tenant";
    }
    const maybeUserUid = (account as Partial<S3Account>).rgw_user_uid;
    if (typeof maybeUserUid === "string" && maybeUserUid.trim()) {
      return "rgw_user";
    }
    return "rgw_user";
  };

  const resolveQuotaForEdit = (quotaGb?: number | null) => {
    if (quotaGb == null) {
      return { value: "", unit: "GiB" as const };
    }
    if (quotaGb > 0 && quotaGb < 1) {
      return { value: String(Math.round(quotaGb * 1024)), unit: "MiB" as const };
    }
    return { value: String(quotaGb), unit: "GiB" as const };
  };

  const renderS3AccountTypeBadge = (account: S3Account) => {
    if (resolveS3AccountType(account) !== "rgw_user") {
      return null;
    }
    return (
      <span
        className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-amber-700 shadow-sm dark:bg-amber-900/40 dark:text-amber-100"
        title="Standalone RGW user"
      >
        👤
      </span>
    );
  };

  const fetchS3Accounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const quick = filter.trim();
      if (quick && quickFilterMode === "exact") {
        const allMatches: S3Account[] = [];
        let nextPage = 1;
        while (true) {
          const response = await listS3Accounts({
            page: nextPage,
            page_size: 200,
            search: quick,
            sort_by: sort.field,
            sort_dir: sort.direction,
            include_quota: false,
            include_rgw_details: false,
          });
          allMatches.push(...response.items);
          if (!response.has_next) break;
          nextPage += 1;
        }

        const needle = quick.toLowerCase();
        const exactMatches = allMatches.filter((account) => {
          const candidates = [account.name, account.rgw_account_id ?? "", account.id ?? "", ...extractUiTagLabels(account.tags)];
          return candidates.some((candidate) => candidate.trim().toLowerCase() === needle);
        });
        const totalExact = exactMatches.length;
        const totalPages = Math.max(1, Math.ceil(totalExact / pageSize));
        if (totalExact > 0 && page > totalPages) {
          setPage(totalPages);
          return;
        }
        const start = (page - 1) * pageSize;
        setS3Accounts(exactMatches.slice(start, start + pageSize));
        setTotalAccounts(totalExact);
      } else {
        const response = await listS3Accounts({
          page,
          page_size: pageSize,
          search: quick || undefined,
          sort_by: sort.field,
          sort_dir: sort.direction,
          include_quota: false,
          include_rgw_details: false,
        });
        const totalPages = Math.max(1, Math.ceil((response.total || 0) / pageSize));
        if (response.total > 0 && page > totalPages) {
          setPage(totalPages);
          return;
        }
        setS3Accounts(response.items);
        setTotalAccounts(response.total);
      }
    } catch (err) {
      console.error(err);
      const msg = extractError(err);
      if (msg.toLowerCase().includes("not authorized") || msg.includes("403")) {
        setError("Access restricted to super-admin.");
      } else {
        setError("Unable to load accounts.");
      }
    } finally {
      setLoading(false);
    }
  }, [filter, quickFilterMode, page, pageSize, sort.direction, sort.field]);

  const userOptions = useMemo(() => users.map((u) => ({ id: u.id, label: u.email })), [users]);
  const userLabelById = useMemo(() => {
    const map = new Map<number, string>();
    users.forEach((u) => map.set(u.id, u.email));
    return map;
  }, [users]);
  const groupLabelById = useMemo(() => {
    const map = new Map<number, string>();
    groups.forEach((group) => map.set(group.id, group.name));
    return map;
  }, [groups]);
  const assignedUsers = useMemo(() => {
    return editForm.user_links.map((link) => ({
      id: link.user_id,
      label: link.user_email ?? userLabelById.get(link.user_id) ?? `User #${link.user_id}`,
      account_admin: Boolean(link.account_admin),
      account_role: normalizePortalRole(link.account_role),
    }));
  }, [editForm.user_links, userLabelById]);
  const assignedGroups = useMemo(() => {
    return editForm.group_links.map((link) => ({
      id: link.group_id,
      label: link.group_name ?? groupLabelById.get(link.group_id) ?? `Group #${link.group_id}`,
      account_admin: Boolean(link.account_admin),
      account_role: normalizePortalRole(link.account_role),
    }));
  }, [editForm.group_links, groupLabelById]);
  const availableUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    const selectedIds = new Set(editForm.user_links.map((link) => link.user_id));
    return userOptions.filter(
      (u) => !selectedIds.has(u.id) && (!query || u.label.toLowerCase().includes(query))
    );
  }, [editForm.user_links, userOptions, userSearch]);
  const availableGroups = useMemo(() => {
    const query = groupSearch.trim().toLowerCase();
    const selectedIds = new Set(editForm.group_links.map((link) => link.group_id));
    return groups.filter(
      (group) => !selectedIds.has(group.id) && (!query || group.name.toLowerCase().includes(query))
    );
  }, [editForm.group_links, groupSearch, groups]);
  const visibleAvailableUsers = useMemo(
    () => availableUsers.slice(0, MAX_LINK_OPTIONS),
    [availableUsers]
  );
  const visibleAvailableGroups = useMemo(
    () => availableGroups.slice(0, MAX_LINK_OPTIONS),
    [availableGroups]
  );

  useEffect(() => {
    setPortalAccountSettings(null);
    setPortalSettingsError(null);
    setPortalSettingsMessage(null);
    setPortalSettingsLoading(false);
    setPortalInitialSignature("");
    if (!editingAccountId || !portalEnabled) return;
    setPortalSettingsLoading(true);
    fetchAccountPortalSettings(editingAccountId)
      .then((data) => setPortalAccountSettings(data))
      .catch((err) => {
        console.error(err);
        setPortalSettingsError(extractApiError(err, "Unable to load portal overrides."));
      })
      .finally(() => setPortalSettingsLoading(false));
  }, [editingAccountId, portalEnabled]);

  useEffect(() => {
    if (!portalEnabled && editTab === "portal") {
      setEditTab("general");
    }
  }, [editTab, portalEnabled]);

  useEffect(() => {
    if (!portalAccountSettings) {
      setAdminPortalBucketCreateOverride("inherit");
      setAdminPortalNamedBucketCreateOverride("inherit");
      setAdminPortalAccessKeyCreateOverride("inherit");
      setAdminBucketVersioningOverride("inherit");
      setAdminBucketLifecycleOverride("inherit");
      setAdminBucketCorsOverride("inherit");
      setAdminBucketCorsOriginsOverride(false);
      setAdminBucketCorsOriginsText("");
      setAdminManagerPolicyMode("inherit");
      setAdminManagerPolicyActionsText("");
      setAdminUserPolicyMode("inherit");
      setAdminUserPolicyActionsText("");
      setAdminBucketPolicyMode("inherit");
      setAdminBucketPolicyActionsText("");
      return;
    }
    const override = portalAccountSettings.admin_override;
    const effective = portalAccountSettings.effective;
    const bucketCreate = resolveTriState(override.allow_portal_user_bucket_create);
    const namedBucketCreate = resolveTriState(override.allow_portal_named_bucket_create);
    const accessKeyCreate = resolveTriState(override.allow_portal_user_access_key_create);
    const bucketDefaultsOverride = override.bucket_defaults;
    const versioning = resolveTriState(bucketDefaultsOverride?.versioning);
    const lifecycle = resolveTriState(bucketDefaultsOverride?.enable_lifecycle);
    const cors = resolveTriState(bucketDefaultsOverride?.enable_cors);
    const corsOriginsOverride = Boolean(bucketDefaultsOverride && bucketDefaultsOverride.cors_allowed_origins != null);
    const corsOriginsText = corsOriginsOverride
      ? (bucketDefaultsOverride?.cors_allowed_origins ?? []).join("\n")
      : (effective.bucket_defaults.cors_allowed_origins || []).join("\n");

    const managerOverride = override.iam_group_manager_policy;
    const managerHasActions = hasOwn(managerOverride as Record<string, unknown> | null, "actions");
    const managerPolicyMode: PolicyMode = managerHasActions ? "actions" : "inherit";
    const managerPolicyActionsText = (
      managerOverride?.actions ?? (effective.iam_group_manager_policy.actions || [])
    ).join("\n");

    const userOverride = override.iam_group_user_policy;
    const userHasActions = hasOwn(userOverride as Record<string, unknown> | null, "actions");
    const userPolicyMode: PolicyMode = userHasActions ? "actions" : "inherit";
    const userPolicyActionsText = (userOverride?.actions ?? (effective.iam_group_user_policy.actions || [])).join("\n");

    const bucketOverride = override.bucket_access_policy;
    const bucketHasActions = hasOwn(bucketOverride as Record<string, unknown> | null, "actions");
    const bucketPolicyMode: PolicyMode = bucketHasActions ? "actions" : "inherit";
    const bucketPolicyActionsText = (bucketOverride?.actions ?? (effective.bucket_access_policy.actions || [])).join("\n");

    setAdminPortalBucketCreateOverride(bucketCreate);
    setAdminPortalNamedBucketCreateOverride(namedBucketCreate);
    setAdminPortalAccessKeyCreateOverride(accessKeyCreate);
    setAdminBucketVersioningOverride(versioning);
    setAdminBucketLifecycleOverride(lifecycle);
    setAdminBucketCorsOverride(cors);
    setAdminBucketCorsOriginsOverride(corsOriginsOverride);
    setAdminBucketCorsOriginsText(corsOriginsText);
    setAdminManagerPolicyMode(managerPolicyMode);
    setAdminManagerPolicyActionsText(managerPolicyActionsText);
    setAdminUserPolicyMode(userPolicyMode);
    setAdminUserPolicyActionsText(userPolicyActionsText);
    setAdminBucketPolicyMode(bucketPolicyMode);
    setAdminBucketPolicyActionsText(bucketPolicyActionsText);
    setPortalInitialSignature(
      buildPortalOverrideFormSignature({
        bucketCreate,
        namedBucketCreate,
        accessKeyCreate,
        versioning,
        lifecycle,
        cors,
        corsOriginsOverride,
        corsOriginsText,
        managerPolicyMode,
        managerPolicyActionsText,
        userPolicyMode,
        userPolicyActionsText,
        bucketPolicyMode,
        bucketPolicyActionsText,
      })
    );
  }, [portalAccountSettings]);

  const toggleSort = (field: SortField) => {
    setSort((prev) => {
      if (prev.field === field) {
        return { field, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { field, direction: "desc" };
    });
    setPage(1);
  };

  const handleFilterChange = (value: string) => {
    setFilter(value);
    setPage(1);
  };
  const clearAllFilters = () => {
    setFilter("");
    setQuickFilterMode("contains");
    setPage(1);
  };
  const toggleQuickFilterMode = () => {
    setQuickFilterMode((prev) => (prev === "contains" ? "exact" : "contains"));
    setPage(1);
  };
  const quickFilterActive = filter.trim().length > 0;

  const handlePageChange = (nextPage: number) => {
    if (nextPage === page) return;
    setPage(Math.max(1, nextPage));
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const loadUsersIfNeeded = useCallback(async () => {
    if (usersLoaded || loadingUsers) return;
    setLoadingUsers(true);
    try {
      const data = await listMinimalUsers();
      setUsers(data);
      setUsersLoaded(true);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingUsers(false);
    }
  }, [loadingUsers, usersLoaded]);

  const loadGroupsIfNeeded = useCallback(async () => {
    if (groupsLoaded || loadingGroups) return;
    setLoadingGroups(true);
    try {
      const data = await listMinimalGroups();
      setGroups(data);
      setGroupsLoaded(true);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingGroups(false);
    }
  }, [groupsLoaded, loadingGroups]);

  const loadEndpointsIfNeeded = useCallback(async () => {
    if (endpointsLoaded || loadingEndpoints) return;
    setLoadingEndpoints(true);
    try {
      const data = await listStorageEndpoints();
      setStorageEndpoints(data);
      setEndpointsLoaded(true);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingEndpoints(false);
    }
  }, [endpointsLoaded, loadingEndpoints]);

  useEffect(() => {
    fetchS3Accounts();
  }, [fetchS3Accounts]);

  const extractError = (err: unknown) => extractApiError(err, "Unexpected error");

  const fetchEndpointAccountsWritePermission = useCallback(
    async (endpointId: number) => {
      if (!Number.isFinite(endpointId) || endpointId <= 0) return;
      if (endpointPermissionLoading[endpointId]) return;
      setEndpointPermissionLoading((prev) => ({ ...prev, [endpointId]: true }));
      try {
        const endpoint = await getStorageEndpoint(endpointId, { include_admin_ops_permissions: true });
        setEndpointAccountsWrite((prev) => ({
          ...prev,
          [endpointId]: Boolean(endpoint.admin_ops_permissions?.accounts_write),
        }));
        setEndpointPermissionErrors((prev) => ({ ...prev, [endpointId]: null }));
      } catch (err) {
        setEndpointAccountsWrite((prev) => ({ ...prev, [endpointId]: false }));
        setEndpointPermissionErrors((prev) => ({ ...prev, [endpointId]: extractError(err) }));
      } finally {
        setEndpointPermissionLoading((prev) => ({ ...prev, [endpointId]: false }));
      }
    },
    [endpointPermissionLoading]
  );

  useEffect(() => {
    if (storageEndpoints.length === 0) return;
    const defaultCeph =
      accountCephEndpoints.find((ep) => ep.is_default) || accountCephEndpoints[0];
    const firstCephId = defaultCeph ? String(defaultCeph.id) : "";

    setForm((prev) => ({
      ...prev,
      storage_endpoint_id: accountCephEndpoints.some(
        (endpoint) => String(endpoint.id) === prev.storage_endpoint_id
      )
        ? prev.storage_endpoint_id
        : firstCephId,
    }));
    setImportTenantEndpointId((prev) =>
      accountCephEndpoints.some((endpoint) => String(endpoint.id) === prev) ? prev : firstCephId
    );
  }, [storageEndpoints, accountCephEndpoints]);

  useEffect(() => {
    if (!showCreateModal) return;
    if (!form.storage_endpoint_id) return;
    const endpointId = Number(form.storage_endpoint_id);
    if (!Number.isFinite(endpointId) || endpointId <= 0) return;
    if (Object.prototype.hasOwnProperty.call(endpointAccountsWrite, endpointId)) return;
    void fetchEndpointAccountsWritePermission(endpointId);
  }, [showCreateModal, form.storage_endpoint_id, endpointAccountsWrite, fetchEndpointAccountsWritePermission]);

  useEffect(() => {
    if (!showImportModal) return;
    if (!importTenantEndpointId) return;
    const endpointId = Number(importTenantEndpointId);
    if (!Number.isFinite(endpointId) || endpointId <= 0) return;
    if (Object.prototype.hasOwnProperty.call(endpointAccountsWrite, endpointId)) return;
    void fetchEndpointAccountsWritePermission(endpointId);
  }, [showImportModal, importTenantEndpointId, endpointAccountsWrite, fetchEndpointAccountsWritePermission]);

  useEffect(() => {
    if (!editingEndpointId) return;
    if (Object.prototype.hasOwnProperty.call(endpointAccountsWrite, editingEndpointId)) return;
    void fetchEndpointAccountsWritePermission(editingEndpointId);
  }, [editingEndpointId, endpointAccountsWrite, fetchEndpointAccountsWritePermission]);

  const loadAccountDetail = useCallback(
    async (account: S3AccountSummary, options?: { includeUsage?: boolean }) => {
      const targetId = accountDbId(account);
      if (targetId == null || Number.isNaN(targetId)) {
        setActionError("Unable to resolve the account identifier.");
        return null;
      }
      try {
        const detail = await getS3Account(targetId, { includeUsage: options?.includeUsage });
        return detail;
      } catch (err) {
        setActionError(extractError(err));
        return null;
      }
    },
    [extractError]
  );

  const columns: { label: string; field: SortField | null; align?: "left" | "right" }[] = [
    { label: "Name", field: "name" },
    { label: "RGW ID", field: "rgw_account_id" },
    { label: "Endpoint", field: null },
    { label: "UI Users / Groups", field: null },
    { label: "Actions", field: null, align: "right" },
  ];
  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: accounts.length,
  });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name) {
      setActionError("S3Account name is required");
      return;
    }
    if (!form.storage_endpoint_id) {
      setActionError("Select a Ceph endpoint to create an account.");
      return;
    }
    if (createPermissionLoading) {
      setActionError("Checking endpoint permissions. Please wait.");
      return;
    }
    if (!createEndpointCanWrite) {
      setActionError("Selected endpoint does not allow this operation (missing accounts=write).");
      return;
    }
    setCreating(true);
    setActionError(null);
    setActionMessage(null);
    try {
      await createS3Account({
        name: form.name.trim(),
        email: form.email.trim() || undefined,
        tags: normalizeUiTags(form.tags),
        quota_max_size_gb: form.quota_max_size_gb ? Number(form.quota_max_size_gb) : undefined,
        quota_max_size_unit: form.quota_max_size_gb ? form.quota_max_size_unit : undefined,
        quota_max_objects: form.quota_max_objects ? Number(form.quota_max_objects) : undefined,
        storage_endpoint_id: form.storage_endpoint_id ? Number(form.storage_endpoint_id) : undefined,
      });
      setActionMessage("S3Account created");
      const defaultCeph =
        accountCephEndpoints.find((ep) => ep.is_default) || accountCephEndpoints[0];
      setForm({
        name: "",
        email: "",
        tags: [],
        quota_max_size_gb: "",
        quota_max_size_unit: "GiB",
        quota_max_objects: "",
        storage_endpoint_id: defaultCeph ? String(defaultCeph.id) : "",
      });
      await fetchS3Accounts();
      setShowCreateModal(false);
    } catch (err) {
      setActionError(extractError(err));
    } finally {
      setCreating(false);
    }
  };

  const accountDbId = (account: S3Account | S3AccountSummary) => {
    if (account.db_id != null) {
      return Number(account.db_id);
    }
    const numericId = Number(account.id);
    return Number.isNaN(numericId) ? null : numericId;
  };

  const resolveAccountUserLinks = (account: S3Account | S3AccountSummary): AccountUserLink[] => {
    if (account.user_links && account.user_links.length > 0) {
      return account.user_links;
    }
    return (account.user_ids ?? []).map((id) => ({ user_id: id, account_admin: false, account_role: "portal_none" }));
  };
  const resolveAccountGroupLinks = (account: S3Account | S3AccountSummary): AccountGroupLink[] => {
    if (account.group_links && account.group_links.length > 0) {
      return account.group_links;
    }
    return (account.group_ids ?? []).map((id) => ({ group_id: id, account_admin: false, account_role: "portal_none" }));
  };
  const renderAccountAssociations = (account: S3Account | S3AccountSummary) => {
    const userItems: AssociationAccountItem[] = resolveAccountUserLinks(account).map((link) => ({
      id: link.user_id,
      label: link.user_email ?? userLabelById.get(link.user_id) ?? `User #${link.user_id}`,
      account_admin: link.account_admin,
      account_role: link.account_role,
    }));
    const groupItems: AssociationAccountItem[] = resolveAccountGroupLinks(account).map((link) => ({
      id: link.group_id,
      label: link.group_name ?? `Group #${link.group_id}`,
      account_admin: link.account_admin,
      account_role: link.account_role,
    }));
    if (userItems.length === 0 && groupItems.length === 0) {
      return <span className="ui-caption text-slate-500 dark:text-slate-400">None</span>;
    }
    return (
      <AssociationSummary
        sections={[
          {
            label: "Users",
            value: <AccountAssociationChips accounts={userItems} showPortalRole={portalEnabled} />,
            visible: userItems.length > 0,
          },
          {
            label: "Groups",
            value: <AccountAssociationChips accounts={groupItems} showPortalRole={portalEnabled} />,
            visible: groupItems.length > 0,
          },
        ]}
      />
    );
  };

  const deleteModalUnknownResources =
    accountToDelete != null &&
    (accountToDelete.bucket_count == null ||
      accountToDelete.rgw_user_count == null ||
      accountToDelete.rgw_topic_count == null);
  const deleteModalHasLinkedResources =
    accountToDelete != null &&
    ((accountToDelete.bucket_count ?? 0) > 0 ||
      (accountToDelete.rgw_user_count ?? 0) > 0 ||
      (accountToDelete.rgw_topic_count ?? 0) > 0);
  const deleteModalHasResources = deleteModalUnknownResources || deleteModalHasLinkedResources;
  const deleteModalBusy = accountToDelete ? deletingS3AccountId === accountDbId(accountToDelete) : false;
  const selectedCreateEndpointId = form.storage_endpoint_id ? Number(form.storage_endpoint_id) : null;
  const selectedImportEndpointId = importTenantEndpointId ? Number(importTenantEndpointId) : null;
  const createPermissionLoading = selectedCreateEndpointId ? Boolean(endpointPermissionLoading[selectedCreateEndpointId]) : false;
  const importPermissionLoading = selectedImportEndpointId ? Boolean(endpointPermissionLoading[selectedImportEndpointId]) : false;
  const createEndpointCanWrite = selectedCreateEndpointId ? endpointAccountsWrite[selectedCreateEndpointId] === true : false;
  const importEndpointCanWrite = selectedImportEndpointId ? endpointAccountsWrite[selectedImportEndpointId] === true : false;
  const createPermissionError = selectedCreateEndpointId ? endpointPermissionErrors[selectedCreateEndpointId] ?? null : null;
  const importPermissionError = selectedImportEndpointId ? endpointPermissionErrors[selectedImportEndpointId] ?? null : null;
  const importDisabled =
    importBusy ||
    !importText.trim() ||
    !importTenantEndpointId ||
    importPermissionLoading ||
    !importEndpointCanWrite;
  const createCurrentSignature = useMemo(
    () => stableSignature({ form: { ...form, tags: normalizeUiTags(form.tags) } }),
    [form]
  );
  const createCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: Boolean(createInitialSignature) && createCurrentSignature !== createInitialSignature,
    disabled: creating,
    onClose: () => setShowCreateModal(false),
  });
  const importCurrentSignature = useMemo(
    () => stableSignature({ importText, importTenantEndpointId }),
    [importTenantEndpointId, importText]
  );
  const importCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: Boolean(importInitialSignature) && importCurrentSignature !== importInitialSignature,
    disabled: importBusy,
    onClose: () => setShowImportModal(false),
  });
  const closeEditS3AccountModal = () => {
    setEditingS3Account(null);
    setEditTab("general");
    setUserSearch("");
    setGroupSearch("");
    setShowUserPanel(false);
    setShowGroupPanel(false);
    setUserSelections([]);
    setGroupSelections([]);
    setGroupAdminChoice({});
    setEditInitialSignature("");
    setPortalInitialSignature("");
  };
  const editCurrentSignature = useMemo(
    () => stableSignature({ editForm: { ...editForm, tags: normalizeUiTags(editForm.tags) } }),
    [editForm]
  );
  const portalCurrentSignature = useMemo(
    () =>
      buildPortalOverrideFormSignature({
        bucketCreate: adminPortalBucketCreateOverride,
        namedBucketCreate: adminPortalNamedBucketCreateOverride,
        accessKeyCreate: adminPortalAccessKeyCreateOverride,
        versioning: adminBucketVersioningOverride,
        lifecycle: adminBucketLifecycleOverride,
        cors: adminBucketCorsOverride,
        corsOriginsOverride: adminBucketCorsOriginsOverride,
        corsOriginsText: adminBucketCorsOriginsText,
        managerPolicyMode: adminManagerPolicyMode,
        managerPolicyActionsText: adminManagerPolicyActionsText,
        userPolicyMode: adminUserPolicyMode,
        userPolicyActionsText: adminUserPolicyActionsText,
        bucketPolicyMode: adminBucketPolicyMode,
        bucketPolicyActionsText: adminBucketPolicyActionsText,
      }),
    [
      adminBucketCorsOriginsOverride,
      adminBucketCorsOriginsText,
      adminBucketCorsOverride,
      adminBucketLifecycleOverride,
      adminBucketPolicyActionsText,
      adminBucketPolicyMode,
      adminBucketVersioningOverride,
      adminPortalNamedBucketCreateOverride,
      adminManagerPolicyActionsText,
      adminManagerPolicyMode,
      adminPortalAccessKeyCreateOverride,
      adminPortalBucketCreateOverride,
      adminUserPolicyActionsText,
      adminUserPolicyMode,
    ]
  );
  const editCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: Boolean(
      editingS3Account &&
        ((editInitialSignature && editCurrentSignature !== editInitialSignature) ||
          (portalEnabled && portalInitialSignature && portalCurrentSignature !== portalInitialSignature))
    ),
    onClose: closeEditS3AccountModal,
  });

  const startEditS3Account = async (account: S3AccountSummary) => {
    setActionError(null);
    setActionMessage(null);
    setUserAdminChoice({});
    setGroupAdminChoice({});
    void loadUsersIfNeeded();
    void loadGroupsIfNeeded();
    void loadEndpointsIfNeeded();
    const detail = await loadAccountDetail(account);
    if (!detail) return;
    const quota = resolveQuotaForEdit(detail.quota_max_size_gb);
    const nextEditForm = {
      tags: normalizeUiTags(detail.tags),
      quota_max_size_gb: quota.value,
      quota_max_size_unit: quota.unit,
      quota_max_objects: detail.quota_max_objects != null ? String(detail.quota_max_objects) : "",
      allow_manager_bucket_quota: Boolean(detail.allow_manager_bucket_quota),
      user_links:
        detail.user_links?.map((link) => ({
          user_id: link.user_id,
          account_admin: Boolean(link.account_admin),
          account_role: normalizePortalRole(link.account_role),
          user_email: link.user_email ?? undefined,
        })) ?? [],
      group_links:
        detail.group_links?.map((link) => ({
          group_id: link.group_id,
          group_name: link.group_name ?? undefined,
          account_admin: Boolean(link.account_admin),
          account_role: normalizePortalRole(link.account_role),
        })) ?? [],
    };
    setEditingS3Account(detail);
    setEditForm(nextEditForm);
    setEditInitialSignature(stableSignature({ editForm: { ...nextEditForm, tags: normalizeUiTags(nextEditForm.tags) } }));
    setUserSearch("");
    setGroupSearch("");
    setShowUserPanel(false);
    setShowGroupPanel(false);
    setUserSelections([]);
    setGroupSelections([]);
    setEditTab("general");
  };

  const submitEditS3Account = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingS3Account) return;
    const targetId = accountDbId(editingS3Account);
    if (targetId == null || Number.isNaN(targetId)) {
      setActionError("Unable to resolve the account identifier.");
      return;
    }
    setActionError(null);
    setActionMessage(null);
    try {
      const payload = {
        user_links: editForm.user_links,
        group_links: editForm.group_links,
        tags: normalizeUiTags(editForm.tags),
        ...(canManagePrivilegedTargets
          ? { allow_manager_bucket_quota: editForm.allow_manager_bucket_quota }
          : {}),
        ...(allowQuotaUpdates
          ? {
              quota_max_size_gb: editForm.quota_max_size_gb !== "" ? Number(editForm.quota_max_size_gb) : null,
              quota_max_size_unit: editForm.quota_max_size_gb !== "" ? editForm.quota_max_size_unit : null,
              quota_max_objects: editForm.quota_max_objects !== "" ? Number(editForm.quota_max_objects) : null,
            }
          : {}),
      };
      await updateS3Account(targetId, payload);
      closeEditS3AccountModal();
      await fetchS3Accounts();
      setActionMessage("S3Account updated");
    } catch (err) {
      setActionError(extractError(err));
    }
  };

  const buildAdminPortalOverridePayload = (): PortalSettingsOverride => {
    const payload: PortalSettingsOverride = {};
    const allowBucketCreateValue = toOverrideValue(adminPortalBucketCreateOverride);
    if (allowBucketCreateValue !== undefined) {
      payload.allow_portal_user_bucket_create = allowBucketCreateValue;
    }
    const allowNamedBucketCreateValue = toOverrideValue(adminPortalNamedBucketCreateOverride);
    if (allowNamedBucketCreateValue !== undefined) {
      payload.allow_portal_named_bucket_create = allowNamedBucketCreateValue;
    }
    const allowAccessKeyCreateValue = toOverrideValue(adminPortalAccessKeyCreateOverride);
    if (allowAccessKeyCreateValue !== undefined) {
      payload.allow_portal_user_access_key_create = allowAccessKeyCreateValue;
    }

    const bucketDefaults: NonNullable<PortalSettingsOverride["bucket_defaults"]> = {};
    const versioningValue = toOverrideValue(adminBucketVersioningOverride);
    if (versioningValue !== undefined) {
      bucketDefaults.versioning = versioningValue;
    }
    const lifecycleValue = toOverrideValue(adminBucketLifecycleOverride);
    if (lifecycleValue !== undefined) {
      bucketDefaults.enable_lifecycle = lifecycleValue;
    }
    const corsValue = toOverrideValue(adminBucketCorsOverride);
    if (corsValue !== undefined) {
      bucketDefaults.enable_cors = corsValue;
    }
    if (adminBucketCorsOriginsOverride) {
      bucketDefaults.cors_allowed_origins = normalizeListInput(adminBucketCorsOriginsText);
    }
    if (Object.keys(bucketDefaults).length > 0) {
      payload.bucket_defaults = bucketDefaults;
    }

    if (adminManagerPolicyMode === "actions") {
      payload.iam_group_manager_policy = { actions: normalizeListInput(adminManagerPolicyActionsText) };
    }
    if (adminUserPolicyMode === "actions") {
      payload.iam_group_user_policy = { actions: normalizeListInput(adminUserPolicyActionsText) };
    }
    if (adminBucketPolicyMode === "actions") {
      payload.bucket_access_policy = { actions: normalizeListInput(adminBucketPolicyActionsText) };
    }
    return payload;
  };

  const handleSaveAdminOverrides = async () => {
    if (!editingAccountId || !portalAccountSettings || portalSettingsSaving) return;
    setPortalSettingsSaving(true);
    setPortalSettingsError(null);
    setPortalSettingsMessage(null);
    try {
      const updated = await updateAccountPortalSettings(editingAccountId, buildAdminPortalOverridePayload());
      setPortalAccountSettings(updated);
      setPortalSettingsMessage("Portal overrides saved.");
    } catch (err) {
      console.error(err);
      setPortalSettingsError(extractApiError(err, "Unable to save portal overrides."));
    } finally {
      setPortalSettingsSaving(false);
    }
  };

  const handleResetAdminOverrides = async () => {
    if (!editingAccountId || portalSettingsSaving) return;
    if (!confirmAction("Reset portal overrides for this account?")) return;
    setPortalSettingsSaving(true);
    setPortalSettingsError(null);
    setPortalSettingsMessage(null);
    try {
      const updated = await updateAccountPortalSettings(editingAccountId, {});
      setPortalAccountSettings(updated);
      setPortalSettingsMessage("Portal overrides reset.");
    } catch (err) {
      console.error(err);
      setPortalSettingsError(extractApiError(err, "Unable to reset portal overrides."));
    } finally {
      setPortalSettingsSaving(false);
    }
  };

  const openDeleteS3AccountModal = async (account: S3AccountSummary) => {
    setActionError(null);
    setActionMessage(null);
    const detail = await loadAccountDetail(account, { includeUsage: true });
    if (!detail) return;
    setS3AccountToDelete(detail);
    setDeleteFromRgw(false);
  };

  const closeDeleteModal = () => {
    setS3AccountToDelete(null);
    setDeleteFromRgw(false);
    setActionError(null);
  };

  const confirmDeleteS3Account = async () => {
    if (!accountToDelete) return;
    const targetId = accountDbId(accountToDelete);
    if (targetId == null || Number.isNaN(targetId)) {
      setActionError("Missing account identifier.");
      return;
    }
    setDeletingS3AccountId(targetId);
    setActionError(null);
    setActionMessage(null);
    try {
      await deleteS3Account(targetId, { deleteRgw: deleteFromRgw });
      await fetchS3Accounts();
      setActionMessage("S3Account deleted");
      closeDeleteModal();
    } catch (err) {
      setActionError(extractError(err));
    } finally {
      setDeletingS3AccountId(null);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Accounts"
        description="Provision Ceph RGW accounts (tenants), quotas, and root users."
        breadcrumbs={adminPageBreadcrumbs("accounts")}
        actions={
          isSuperAdmin
            ? [
                {
                  label: "Import",
                  onClick: () => {
                    setImportText("");
                    setImportError(null);
                    setImportMessage(null);
                    setImportInitialSignature(stableSignature({ importText: "", importTenantEndpointId }));
                    setShowImportModal(true);
                    void loadEndpointsIfNeeded();
                  },
                  variant: "ghost",
                },
                {
                  label: "Create account",
                  onClick: () => {
                    setCreateInitialSignature(stableSignature({ form: { ...form, tags: normalizeUiTags(form.tags) } }));
                    setShowCreateModal(true);
                    void loadEndpointsIfNeeded();
                  },
                },
              ]
            : []
        }
      />

      {error && <PageBanner tone="error">{error}</PageBanner>}

      {isSuperAdmin && showCreateModal && (
        <Modal title="Create an account" onClose={createCloseGuard.requestClose}>
          <p className="mb-3 ui-body text-slate-500">
            Super-admin only. Provision an RGW account (server-side generated <code>account_id</code>) with optional quotas.
          </p>
          {actionError && (
            <PageBanner tone="error" className="mb-3">
              {actionError}
            </PageBanner>
          )}
          {actionMessage && (
            <PageBanner tone="success" className="mb-3">
              {actionMessage}
            </PageBanner>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label className="ui-body font-medium text-slate-700 dark:text-slate-200">S3Account name *</label>
                  <input
                    className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    required
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Email contact</label>
                  <input
                    type="email"
                    className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="contact@example.com"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Storage endpoint (Ceph) *</label>
                  <select
                    className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    value={form.storage_endpoint_id}
                    onChange={(e) => setForm((f) => ({ ...f, storage_endpoint_id: e.target.value }))}
                    required
                    disabled={loadingEndpoints || accountCephEndpoints.length === 0}
                  >
                    <option value="" disabled>
                      {loadingEndpoints ? "Loading..." : "No Ceph endpoint with account API enabled"}
                    </option>
                    {accountCephEndpoints.map((ep) => (
                      <option key={ep.id} value={ep.id}>
                        {ep.name} {ep.is_default ? "(default)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Capacity quota</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      className="flex-1 rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      value={form.quota_max_size_gb}
                      onChange={(e) => setForm((f) => ({ ...f, quota_max_size_gb: e.target.value }))}
                      placeholder="e.g. 500"
                    />
                    <select
                      className="w-24 rounded-md border border-slate-200 px-2 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      value={form.quota_max_size_unit}
                      onChange={(e) => setForm((f) => ({ ...f, quota_max_size_unit: e.target.value }))}
                    >
                      <option value="MiB">MiB</option>
                      <option value="GiB">GiB</option>
                      <option value="TiB">TiB</option>
                    </select>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Object quota (count)</label>
                  <input
                    type="number"
                    min="0"
                    className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    value={form.quota_max_objects}
                    onChange={(e) => setForm((f) => ({ ...f, quota_max_objects: e.target.value }))}
                    placeholder="e.g. 1000000"
                  />
                </div>
                {form.storage_endpoint_id && (
                  <div className="md:col-span-2">
                    {createPermissionLoading ? (
                      <PageBanner tone="info">Checking endpoint permissions...</PageBanner>
                    ) : createPermissionError ? (
                      <PageBanner tone="warning">
                        {createPermissionError}. Validation is disabled until permissions can be verified.
                      </PageBanner>
                    ) : !createEndpointCanWrite ? (
                      <PageBanner tone="warning">
                        Selected endpoint does not allow this operation: missing <code>accounts=write</code>.
                      </PageBanner>
                    ) : null}
                  </div>
                )}
                <div className="md:col-span-2 space-y-3">
                  {adminTagCatalogError && <PageBanner tone="warning">{adminTagCatalogError}</PageBanner>}
                  <UiTagEditor
                    label="Tags"
                    tags={form.tags}
                    catalog={adminTagCatalog}
                    onChange={(tags) => setForm((current) => ({ ...current, tags }))}
                    placeholder="Add a tag for this account"
                    hint={adminTagCatalogLoading ? "Loading existing tag catalog..." : undefined}
                  />
                </div>
              </div>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={createCloseGuard.requestClose}
                className="rounded-md border border-slate-200 px-4 py-2 ui-body font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating || createPermissionLoading || !createEndpointCanWrite}
                className="rounded-md bg-primary px-4 py-2 ui-body font-medium text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
              >
                {creating ? "Creating..." : "Create account"}
              </button>
            </div>
            {createCloseGuard.confirmationDialog}
          </form>
        </Modal>
      )}

      {isSuperAdmin && accountToDelete && (
        <Modal title={`Delete ${accountToDelete.name}`} onClose={closeDeleteModal}>
          <p className="mb-3 ui-body text-slate-500 dark:text-slate-400">
            Removing this account deletes the UI entry. Optionally delete the backing RGW tenant if it no longer contains resources.
          </p>
          {actionError && (
            <PageBanner tone="error" className="mb-3">
              {actionError}
            </PageBanner>
          )}
          {deleteModalHasResources && (
            <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 ui-body text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/50 dark:text-amber-100">
              {deleteModalUnknownResources
                ? "Unable to verify linked RGW resources. RGW deletion is disabled until counts are available."
                : "This RGW tenant still has attached resources. Remove buckets and RGW users (excluding the admin user) before deleting it from RGW."}
              <div className="mt-1 ui-caption font-semibold">
                Buckets: {accountToDelete.bucket_count ?? "unknown"} · IAM users (excl. admin):{" "}
                {accountToDelete.rgw_user_count ?? "unknown"} · RGW topics:{" "}
                {accountToDelete.rgw_topic_count ?? "unknown"}
              </div>
              {accountToDelete.rgw_user_uids && accountToDelete.rgw_user_uids.length > 0 && (
                <div className="mt-2 rounded-lg border border-amber-200/40 bg-white/60 px-3 py-2 ui-caption text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/40 dark:text-amber-50">
                  <p className="font-semibold">RGW users to remove:</p>
                  <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto">
                    {accountToDelete.rgw_user_uids.map((uid) => (
                      <li key={uid} className="truncate">
                        {uid}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {accountToDelete.rgw_topics && accountToDelete.rgw_topics.length > 0 && (
                <div className="mt-2 rounded-lg border border-amber-200/40 bg-white/60 px-3 py-2 ui-caption text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/40 dark:text-amber-50">
                  <p className="font-semibold">Notification topics to remove:</p>
                  <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto">
                    {accountToDelete.rgw_topics.map((topic) => (
                      <li key={topic} className="truncate">
                        {topic}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <label
            className={`mb-4 flex items-start gap-3 rounded-lg border px-3 py-2 ui-body ${
              deleteModalHasResources
                ? "border-slate-200 text-slate-400 dark:border-slate-700 dark:text-slate-500"
                : "border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-100"
            }`}
          >
            <input
              type="checkbox"
              className="mt-1"
              checked={deleteFromRgw}
              disabled={deleteModalHasResources}
              onChange={(e) => setDeleteFromRgw(e.target.checked)}
            />
            <span>
              Also delete RGW tenant{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 ui-caption dark:bg-slate-800">
                {accountToDelete.rgw_account_id ?? accountToDelete.id}
              </code>
            </span>
          </label>
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={closeDeleteModal}
              className="rounded-md border border-slate-200 px-4 py-2 ui-body font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDeleteS3Account}
              disabled={deleteModalBusy}
              className="rounded-md bg-rose-600 px-4 py-2 ui-body font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:opacity-60"
            >
              {deleteModalBusy ? "Deleting..." : "Delete account"}
            </button>
          </div>
        </Modal>
      )}

      {isSuperAdmin && showImportModal && (
        <Modal title="Import accounts" onClose={importCloseGuard.requestClose}>
          <p className="mb-3 ui-body text-slate-500">
            Enter RGW tenant IDs (RGWXXXXXXXXXXXXXXX) one per line. The platform will ensure a root user exists and retrieve keys.
          </p>
          {importError && (
            <PageBanner tone="error" className="mb-3">
              {importError}
            </PageBanner>
          )}
          {importMessage && (
            <PageBanner tone="success" className="mb-3">
              {importMessage}
            </PageBanner>
          )}
          <>
            <textarea
              className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              rows={6}
              placeholder="RGW00000000000000001"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <label className="mt-3 flex flex-col gap-1 ui-body font-medium text-slate-700 dark:text-slate-200">
              Ceph endpoint
              <select
                className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                value={importTenantEndpointId}
                onChange={(e) => setImportTenantEndpointId(e.target.value)}
                disabled={accountCephEndpoints.length === 0}
                required
              >
                <option value="" disabled>
                  {accountCephEndpoints.length === 0 ? "No Ceph endpoint with account API enabled" : "Select"}
                </option>
                {accountCephEndpoints.map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    {ep.name} {ep.is_default ? "(default)" : ""}
                  </option>
                ))}
              </select>
            </label>
            {importTenantEndpointId && (
              <>
                {importPermissionLoading ? (
                  <PageBanner tone="info" className="mt-3">
                    Checking endpoint permissions...
                  </PageBanner>
                ) : importPermissionError ? (
                  <PageBanner tone="warning" className="mt-3">
                    {importPermissionError}. Validation is disabled until permissions can be verified.
                  </PageBanner>
                ) : !importEndpointCanWrite ? (
                  <PageBanner tone="warning" className="mt-3">
                    Selected endpoint does not allow this operation: missing <code>accounts=write</code>.
                  </PageBanner>
                ) : null}
              </>
            )}
          </>
          <div className="mt-4 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={importCloseGuard.requestClose}
              className="rounded-md border border-slate-200 px-4 py-2 ui-body font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={importDisabled}
              onClick={async () => {
                try {
                  if (!importEndpointCanWrite) {
                    setImportError("Selected endpoint does not allow this operation (missing accounts=write).");
                    setImportMessage(null);
                    return;
                  }
                  setImportBusy(true);
                  setImportError(null);
                  setImportMessage(null);
                  const raw = importText
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .filter(Boolean);
                  if (raw.length === 0) {
                    setImportError("Enter at least one entry.");
                    setImportMessage(null);
                    return;
                  }
                  const invalid = raw.filter((id) => !/^RGW\d{17}$/.test(id));
                  if (invalid.length > 0) {
                    setImportError(`Invalid identifiers: ${invalid.join(", ")}`);
                    return;
                  }
                  const payload: ImportS3AccountPayload[] = raw.map((id) => ({
                    rgw_account_id: id,
                    storage_endpoint_id: importTenantEndpointId ? Number(importTenantEndpointId) : undefined,
                  }));
                  await importS3Accounts(payload);
                  setImportMessage("S3Accounts imported.");
                  setImportText("");
                  setImportInitialSignature(stableSignature({ importText: "", importTenantEndpointId }));
                  await fetchS3Accounts();
                } catch (err) {
                  setImportError(extractError(err));
                } finally {
                  setImportBusy(false);
                }
              }}
              className="rounded-md bg-primary px-4 py-2 ui-body font-medium text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
            >
              {importBusy ? "Importing..." : "Import"}
            </button>
          </div>
          {importCloseGuard.confirmationDialog}
        </Modal>
      )}

      {isSuperAdmin && editingS3Account && (
        <Modal
          title={`Edit ${editingS3Account.name}`}
          onClose={editCloseGuard.requestClose}
        >
          {actionError && (
            <PageBanner tone="error" className="mb-3">
              {actionError}
            </PageBanner>
          )}
          <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 ui-caption font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100">
            Storage endpoint:{" "}
            <span title={editingS3Account.storage_endpoint_url || undefined}>
              {editingS3Account.storage_endpoint_name ?? "—"}
            </span>
          </div>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-900/60">
              <button
                type="button"
                onClick={() => setEditTab("general")}
                className={`rounded-md px-3 py-1.5 ui-caption font-semibold transition ${
                  editTab === "general"
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100"
                    : "text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                }`}
              >
                General
              </button>
              <button
                type="button"
                onClick={() => {
                  void loadUsersIfNeeded();
                  setEditTab("users");
                }}
                className={`rounded-md px-3 py-1.5 ui-caption font-semibold transition ${
                  editTab === "users"
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100"
                    : "text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                }`}
              >
                Linked UI users
              </button>
              <button
                type="button"
                onClick={() => {
                  void loadGroupsIfNeeded();
                  setEditTab("groups");
                }}
                className={`rounded-md px-3 py-1.5 ui-caption font-semibold transition ${
                  editTab === "groups"
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100"
                    : "text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                }`}
              >
                Linked UI groups
              </button>
              {canManagePrivilegedTargets && (
                <button
                  type="button"
                  onClick={() => setEditTab("privileged")}
                  className={`rounded-md px-3 py-1.5 ui-caption font-semibold transition ${
                    editTab === "privileged"
                      ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100"
                      : "text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                  }`}
                >
                  Privileged access
                </button>
              )}
              {portalEnabled && (
                <button
                  type="button"
                  onClick={() => setEditTab("portal")}
                  className={`rounded-md px-3 py-1.5 ui-caption font-semibold transition ${
                    editTab === "portal"
                      ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100"
                      : "text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                  }`}
                >
                  Portal overrides
                </button>
              )}
            </div>
            {showGeneralTab && (
              <StorageUsageCard
                accountName={editingS3Account.name}
                storage={{
                  used: editingUsageStats?.total_bytes ?? null,
                  quotaBytes:
                    editingS3Account.quota_max_size_gb != null ? editingS3Account.quota_max_size_gb * 1024 ** 3 : null,
                }}
                objects={{
                  used: editingUsageStats?.total_objects ?? null,
                  quota: editingS3Account.quota_max_objects ?? null,
                }}
                bucketOverview={editingUsageStats?.bucket_overview}
                loading={editingUsageLoading}
                metricsDisabled={!allowUsageStats}
                errorMessage={editingUsageError}
              />
            )}
            <form onSubmit={submitEditS3Account} className="space-y-4">
              {showGeneralTab && (
                <>
                  <div className="space-y-3">
                    {adminTagCatalogError && <PageBanner tone="warning">{adminTagCatalogError}</PageBanner>}
                    <UiTagEditor
                      label="Tags"
                      tags={editForm.tags}
                      catalog={adminTagCatalog}
                      onChange={(tags) => setEditForm((prev) => ({ ...prev, tags }))}
                      placeholder="Add a tag for this account"
                      hint={adminTagCatalogLoading ? "Loading existing tag catalog..." : undefined}
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Max quota</label>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          className="flex-1 rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800/60 dark:disabled:text-slate-500"
                          value={editForm.quota_max_size_gb}
                          disabled={!allowQuotaUpdates}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, quota_max_size_gb: e.target.value }))}
                          placeholder="Leave empty to disable"
                        />
                        <select
                          className="w-24 rounded-md border border-slate-200 px-2 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800/60 dark:disabled:text-slate-500"
                          value={editForm.quota_max_size_unit}
                          disabled={!allowQuotaUpdates}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, quota_max_size_unit: e.target.value }))}
                        >
                          <option value="MiB">MiB</option>
                          <option value="GiB">GiB</option>
                          <option value="TiB">TiB</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Object quota</label>
                      <input
                        type="number"
                        min={0}
                        className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800/60 dark:disabled:text-slate-500"
                        value={editForm.quota_max_objects}
                        disabled={!allowQuotaUpdates}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, quota_max_objects: e.target.value }))}
                        placeholder="Leave empty to disable"
                      />
                    </div>
                  </div>
                </>
              )}
              {showUsersTab && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Linked UI users</label>
                      <span className="ui-caption text-slate-500 dark:text-slate-400">
                        {assignedUsers.length} linked{loadingUsers ? " · loading..." : ""}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (!showUserPanel) {
                          void loadUsersIfNeeded();
                        }
                        setShowUserPanel((prev) => !prev);
                      }}
                      className={tableActionButtonClasses}
                    >
                      {showUserPanel ? "Close" : "Add UI users"}
                    </button>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                    <table className="compact-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
                      <thead className="bg-slate-50 dark:bg-slate-900/50">
                        <tr>
                          <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            User
                          </th>
                          <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Admin
                          </th>
                          {portalEnabled && (
                            <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Portal role
                            </th>
                          )}
                          <th className="px-3 py-2 text-right ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {assignedUsers.length === 0 ? (
                          <tr>
                            <td colSpan={portalEnabled ? 4 : 3} className="px-3 py-3 ui-body text-slate-500 dark:text-slate-400">
                              No linked users yet.
                            </td>
                          </tr>
                        ) : (
                          assignedUsers.map((u) => (
                            <tr key={u.id}>
                              <td className="px-3 py-2 ui-body text-slate-700 dark:text-slate-200">{u.label}</td>
                              <td className="px-3 py-2">
                                <label className="flex items-center gap-2 ui-caption font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                                  <input
                                    type="checkbox"
                                    checked={u.account_admin}
                                    onChange={(e) =>
                                      setEditForm((prev) => ({
                                        ...prev,
                                        user_links: prev.user_links.map((link) =>
                                          link.user_id === u.id ? { ...link, account_admin: e.target.checked } : link
                                        ),
                                      }))
                                    }
                                    className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
                                  />
                                  Admin
                                </label>
                              </td>
                              {portalEnabled && (
                                <td className="px-3 py-2">
                                  <select
                                    value={u.account_role}
                                    onChange={(e) =>
                                      setEditForm((prev) => ({
                                        ...prev,
                                        user_links: prev.user_links.map((link) =>
                                          link.user_id === u.id
                                            ? { ...link, account_role: normalizePortalRole(e.target.value) }
                                            : link
                                        ),
                                      }))
                                    }
                                    className="w-44 rounded-md border border-slate-200 px-2 py-1 ui-caption text-slate-700 shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                  >
                                    {PORTAL_ROLE_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                              )}
                              <td className="px-3 py-2 text-right">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditForm((prev) => ({
                                      ...prev,
                                      user_links: prev.user_links.filter((link) => link.user_id !== u.id),
                                    }))
                                  }
                                  className={tableDeleteActionClasses}
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  {showUserPanel && (
                    <div className="space-y-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/50">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Add UI users</label>
                          <span className="ui-caption text-slate-500 dark:text-slate-400">(filter by email)</span>
                        </div>
                        <input
                          type="text"
                          value={userSearch}
                          onChange={(e) => setUserSearch(e.target.value)}
                          placeholder="Search..."
                          className="w-44 rounded-md border border-slate-200 px-2 py-1 ui-caption focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        />
                      </div>
                      <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                        {availableUsers.length === 0 && (
                          <p className="ui-caption text-slate-500 dark:text-slate-400">No results.</p>
                        )}
                        {visibleAvailableUsers.map((u) => {
                          const isSelected = userSelections.includes(u.id);
                          const adminChecked = userAdminChoice[u.id] ?? false;
                          return (
                            <div
                              key={u.id}
                              className={`flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1 ${
                                isSelected
                                  ? "bg-slate-50 dark:bg-slate-800/60"
                                  : "hover:bg-slate-100 dark:hover:bg-slate-800/60"
                              }`}
                            >
                              <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleUserSelection(u.id)}
                                  className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
                                />
                                <span>{u.label}</span>
                              </label>
                              <label className="flex items-center gap-1 ui-caption font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                                <input
                                  type="checkbox"
                                  checked={Boolean(adminChecked)}
                                  onChange={(e) =>
                                    setUserAdminChoice((prev) => ({
                                      ...prev,
                                      [u.id]: e.target.checked,
                                    }))
                                  }
                                  className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
                                />
                                Admin
                              </label>
                            </div>
                          );
                        })}
                        {availableUsers.length > MAX_LINK_OPTIONS && (
                          <p className="ui-caption text-slate-500 dark:text-slate-400">
                            Showing first {MAX_LINK_OPTIONS} matches. Refine your search to see more.
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="ui-caption text-slate-500 dark:text-slate-400">
                          {userSelections.length} selected
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setShowUserPanel(false);
                              setUserSelections([]);
                              setUserSearch("");
                            }}
                            className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={userSelections.length === 0}
                            onClick={() => {
                              if (userSelections.length === 0) return;
                              const toAdd = userSelections.map((id) => ({
                                user_id: id,
                                account_admin: userAdminChoice[id] ?? false,
                                account_role: "portal_none" as PortalAccountRole,
                                user_email: userLabelById.get(id) ?? undefined,
                              }));
                              setEditForm((prev) => ({
                                ...prev,
                                user_links: [...prev.user_links, ...toAdd],
                              }));
                              setShowUserPanel(false);
                              setUserSelections([]);
                              setUserSearch("");
                            }}
                            className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
                          >
                            Add selected
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {showGroupsTab && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Linked UI groups</label>
                      <span className="ui-caption text-slate-500 dark:text-slate-400">
                        {assignedGroups.length} linked{loadingGroups ? " · loading..." : ""}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (!showGroupPanel) {
                          void loadGroupsIfNeeded();
                        }
                        setShowGroupPanel((prev) => !prev);
                      }}
                      className={tableActionButtonClasses}
                    >
                      {showGroupPanel ? "Close" : "Add UI groups"}
                    </button>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                    <table className="compact-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
                      <thead className="bg-slate-50 dark:bg-slate-900/50">
                        <tr>
                          <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Group
                          </th>
                          <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Admin
                          </th>
                          {portalEnabled && (
                            <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Portal role
                            </th>
                          )}
                          <th className="px-3 py-2 text-right ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {assignedGroups.length === 0 ? (
                          <tr>
                            <td colSpan={portalEnabled ? 4 : 3} className="px-3 py-3 ui-body text-slate-500 dark:text-slate-400">
                              No linked groups yet.
                            </td>
                          </tr>
                        ) : (
                          assignedGroups.map((group) => (
                            <tr key={group.id}>
                              <td className="px-3 py-2 ui-body text-slate-700 dark:text-slate-200">{group.label}</td>
                              <td className="px-3 py-2">
                                <label className="flex items-center gap-2 ui-caption font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                                  <input
                                    type="checkbox"
                                    checked={group.account_admin}
                                    onChange={(e) =>
                                      setEditForm((prev) => ({
                                        ...prev,
                                        group_links: prev.group_links.map((link) =>
                                          link.group_id === group.id ? { ...link, account_admin: e.target.checked } : link
                                        ),
                                      }))
                                    }
                                    className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
                                  />
                                  Admin
                                </label>
                              </td>
                              {portalEnabled && (
                                <td className="px-3 py-2">
                                  <select
                                    value={group.account_role}
                                    onChange={(e) =>
                                      setEditForm((prev) => ({
                                        ...prev,
                                        group_links: prev.group_links.map((link) =>
                                          link.group_id === group.id
                                            ? { ...link, account_role: normalizePortalRole(e.target.value) }
                                            : link
                                        ),
                                      }))
                                    }
                                    className="w-44 rounded-md border border-slate-200 px-2 py-1 ui-caption text-slate-700 shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                  >
                                    {PORTAL_ROLE_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                              )}
                              <td className="px-3 py-2 text-right">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditForm((prev) => ({
                                      ...prev,
                                      group_links: prev.group_links.filter((link) => link.group_id !== group.id),
                                    }))
                                  }
                                  className={tableDeleteActionClasses}
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  {showGroupPanel && (
                    <div className="space-y-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/50">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Add UI groups</label>
                          <span className="ui-caption text-slate-500 dark:text-slate-400">(filter by name)</span>
                        </div>
                        <input
                          type="text"
                          value={groupSearch}
                          onChange={(e) => setGroupSearch(e.target.value)}
                          placeholder="Search..."
                          className="w-44 rounded-md border border-slate-200 px-2 py-1 ui-caption focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        />
                      </div>
                      <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                        {availableGroups.length === 0 && (
                          <p className="ui-caption text-slate-500 dark:text-slate-400">No results.</p>
                        )}
                        {visibleAvailableGroups.map((group) => {
                          const isSelected = groupSelections.includes(group.id);
                          const adminChecked = groupAdminChoice[group.id] ?? false;
                          return (
                            <div
                              key={group.id}
                              className={`flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1 ${
                                isSelected
                                  ? "bg-slate-50 dark:bg-slate-800/60"
                                  : "hover:bg-slate-100 dark:hover:bg-slate-800/60"
                              }`}
                            >
                              <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleGroupSelection(group.id)}
                                  className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
                                />
                                <span>{group.name}</span>
                              </label>
                              <label className="flex items-center gap-1 ui-caption font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                                <input
                                  type="checkbox"
                                  checked={Boolean(adminChecked)}
                                  onChange={(e) =>
                                    setGroupAdminChoice((prev) => ({
                                      ...prev,
                                      [group.id]: e.target.checked,
                                    }))
                                  }
                                  className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
                                />
                                Admin
                              </label>
                            </div>
                          );
                        })}
                        {availableGroups.length > MAX_LINK_OPTIONS && (
                          <p className="ui-caption text-slate-500 dark:text-slate-400">
                            Showing first {MAX_LINK_OPTIONS} matches. Refine your search to see more.
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="ui-caption text-slate-500 dark:text-slate-400">
                          {groupSelections.length} selected
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setShowGroupPanel(false);
                              setGroupSelections([]);
                              setGroupSearch("");
                            }}
                            className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={groupSelections.length === 0}
                            onClick={() => {
                              if (groupSelections.length === 0) return;
                              const toAdd = groupSelections.map((id) => ({
                                group_id: id,
                                group_name: groupLabelById.get(id) ?? undefined,
                                account_admin: groupAdminChoice[id] ?? false,
                                account_role: "portal_none" as PortalAccountRole,
                              }));
                              setEditForm((prev) => ({
                                ...prev,
                                group_links: [...prev.group_links, ...toAdd],
                              }));
                              setShowGroupPanel(false);
                              setGroupSelections([]);
                              setGroupSearch("");
                            }}
                            className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
                          >
                            Add selected
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {canManagePrivilegedTargets && showPrivilegedTab && (
                <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                      checked={editForm.allow_manager_bucket_quota}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          allow_manager_bucket_quota: e.target.checked,
                        }))
                      }
                    />
                    <span>
                      <span className="block ui-body font-medium text-slate-800 dark:text-slate-100">
                        Bucket quota management
                      </span>
                    </span>
                  </label>
                </div>
              )}
              {showPortalTab && (
                <div className="ui-surface-card p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">Portal overrides</p>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">
                        Force Portal settings for this account.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleResetAdminOverrides}
                        disabled={!portalAccountSettings || portalSettingsSaving}
                        className="rounded-md border border-slate-200 px-3 py-2 ui-caption font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200"
                      >
                        Reset overrides
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveAdminOverrides}
                        disabled={!portalAccountSettings || portalSettingsSaving}
                        className="rounded-md bg-primary px-3 py-2 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
                      >
                        {portalSettingsSaving ? "Saving..." : "Save overrides"}
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 space-y-3">
                    {portalSettingsError && <PageBanner tone="error">{portalSettingsError}</PageBanner>}
                    {portalSettingsMessage && <PageBanner tone="success">{portalSettingsMessage}</PageBanner>}
                    {portalSettingsLoading && !portalSettingsError && (
                      <PageBanner tone="info">Loading portal settings...</PageBanner>
                    )}
                    {portalAccountSettings && effectivePortalSettings && (
                      <div className="space-y-4">
                        <PortalSettingsSection title="UI" layout="grid">
                          <PortalSettingsItem
                            title="Portal user Storage Space creation"
                            description={`Effective for portal users: ${
                              effectivePortalSettings.allow_portal_user_bucket_create ? "enabled" : "disabled"
                            }`}
                            action={
                              <select
                                value={adminPortalBucketCreateOverride}
                                onChange={(e) => setAdminPortalBucketCreateOverride(e.target.value as TriState)}
                                className="rounded-md border border-slate-200 px-2 py-1 ui-caption font-semibold text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                disabled={portalSettingsLoading || portalSettingsSaving}
                              >
                                <option value="inherit">Inherit</option>
                                <option value="enabled">Enable</option>
                                <option value="disabled">Disable</option>
                              </select>
                            }
                          />
                          <PortalSettingsItem
                            title="Named bucket creation"
                            description={`Effective for portal users: ${
                              effectivePortalSettings.allow_portal_named_bucket_create ? "enabled" : "disabled"
                            }`}
                            action={
                              <select
                                value={adminPortalNamedBucketCreateOverride}
                                onChange={(e) => setAdminPortalNamedBucketCreateOverride(e.target.value as TriState)}
                                className="rounded-md border border-slate-200 px-2 py-1 ui-caption font-semibold text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                disabled={portalSettingsLoading || portalSettingsSaving}
                              >
                                <option value="inherit">Inherit</option>
                                <option value="enabled">Enable</option>
                                <option value="disabled">Disable</option>
                              </select>
                            }
                          />
                          <PortalSettingsItem
                            title="Access key management"
                            description={`Effective for portal users: ${
                              effectivePortalSettings.allow_portal_user_access_key_create ? "enabled" : "disabled"
                            }`}
                            action={
                              <select
                                value={adminPortalAccessKeyCreateOverride}
                                onChange={(e) => setAdminPortalAccessKeyCreateOverride(e.target.value as TriState)}
                                className="rounded-md border border-slate-200 px-2 py-1 ui-caption font-semibold text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                disabled={portalSettingsLoading || portalSettingsSaving}
                              >
                                <option value="inherit">Inherit</option>
                                <option value="enabled">Enable</option>
                                <option value="disabled">Disable</option>
                              </select>
                            }
                          />
                        </PortalSettingsSection>

                        <PortalSettingsSection title="IAM POLICIES" layout="stack">
                          <PortalSettingsItem
                            title="Policy portal-manager"
                            description={`Mode: ${adminManagerPolicyMode}`}
                            action={
                              <select
                                value={adminManagerPolicyMode}
                                onChange={(e) => {
                                  const mode = e.target.value as PolicyMode;
                                  setAdminManagerPolicyMode(mode);
                                  if (mode === "actions" && !adminManagerPolicyActionsText) {
                                    setAdminManagerPolicyActionsText(
                                      (effectivePortalSettings.iam_group_manager_policy.actions || []).join("\n")
                                    );
                                  }
                                }}
                                className="rounded-md border border-slate-200 px-2 py-1 ui-caption font-semibold text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                disabled={portalSettingsLoading || portalSettingsSaving}
                              >
                                <option value="inherit">Inherit</option>
                                <option value="actions">Actions</option>
                              </select>
                            }
                          >
                            {adminManagerPolicyMode === "actions" && (
                              <textarea
                                value={adminManagerPolicyActionsText}
                                onChange={(e) => setAdminManagerPolicyActionsText(e.target.value)}
                                className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                rows={4}
                                disabled={portalSettingsLoading || portalSettingsSaving}
                              />
                            )}
                          </PortalSettingsItem>

                          <PortalSettingsItem
                            title="Policy portal-user"
                            description={`Mode: ${adminUserPolicyMode}`}
                            action={
                              <select
                                value={adminUserPolicyMode}
                                onChange={(e) => {
                                  const mode = e.target.value as PolicyMode;
                                  setAdminUserPolicyMode(mode);
                                  if (mode === "actions" && !adminUserPolicyActionsText) {
                                    setAdminUserPolicyActionsText(
                                      (effectivePortalSettings.iam_group_user_policy.actions || []).join("\n")
                                    );
                                  }
                                }}
                                className="rounded-md border border-slate-200 px-2 py-1 ui-caption font-semibold text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                disabled={portalSettingsLoading || portalSettingsSaving}
                              >
                                <option value="inherit">Inherit</option>
                                <option value="actions">Actions</option>
                              </select>
                            }
                          >
                            {adminUserPolicyMode === "actions" && (
                              <textarea
                                value={adminUserPolicyActionsText}
                                onChange={(e) => setAdminUserPolicyActionsText(e.target.value)}
                                className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                rows={4}
                                disabled={portalSettingsLoading || portalSettingsSaving}
                              />
                            )}
                          </PortalSettingsItem>

                          <PortalSettingsItem
                            title="Policy bucket access"
                            description={`Mode: ${adminBucketPolicyMode}`}
                            action={
                              <select
                                value={adminBucketPolicyMode}
                                onChange={(e) => {
                                  const mode = e.target.value as PolicyMode;
                                  setAdminBucketPolicyMode(mode);
                                  if (mode === "actions" && !adminBucketPolicyActionsText) {
                                    setAdminBucketPolicyActionsText(
                                      (effectivePortalSettings.bucket_access_policy.actions || []).join("\n")
                                    );
                                  }
                                }}
                                className="rounded-md border border-slate-200 px-2 py-1 ui-caption font-semibold text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                disabled={portalSettingsLoading || portalSettingsSaving}
                              >
                                <option value="inherit">Inherit</option>
                                <option value="actions">Actions</option>
                              </select>
                            }
                          >
                            {adminBucketPolicyMode === "actions" && (
                              <textarea
                                value={adminBucketPolicyActionsText}
                                onChange={(e) => setAdminBucketPolicyActionsText(e.target.value)}
                                className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                rows={4}
                                disabled={portalSettingsLoading || portalSettingsSaving}
                              />
                            )}
                          </PortalSettingsItem>
                        </PortalSettingsSection>

                        <PortalSettingsSection title="BUCKET DEFAULTS" layout="grid">
                          <PortalSettingsItem
                            title="Versioning"
                            description={`Effective: ${effectivePortalSettings.bucket_defaults.versioning ? "enabled" : "disabled"}`}
                            action={
                              <select
                                value={adminBucketVersioningOverride}
                                onChange={(e) => setAdminBucketVersioningOverride(e.target.value as TriState)}
                                className="rounded-md border border-slate-200 px-2 py-1 ui-caption font-semibold text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                disabled={portalSettingsLoading || portalSettingsSaving}
                              >
                                <option value="inherit">Inherit</option>
                                <option value="enabled">Enable</option>
                                <option value="disabled">Disable</option>
                              </select>
                            }
                          />
                          <PortalSettingsItem
                            title="Lifecycle"
                            description={`Effective: ${
                              effectivePortalSettings.bucket_defaults.enable_lifecycle ? "enabled" : "disabled"
                            }`}
                            action={
                              <select
                                value={adminBucketLifecycleOverride}
                                onChange={(e) => setAdminBucketLifecycleOverride(e.target.value as TriState)}
                                className="rounded-md border border-slate-200 px-2 py-1 ui-caption font-semibold text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                disabled={portalSettingsLoading || portalSettingsSaving}
                              >
                                <option value="inherit">Inherit</option>
                                <option value="enabled">Enable</option>
                                <option value="disabled">Disable</option>
                              </select>
                            }
                          />
                          <PortalSettingsItem
                            title="CORS"
                            description={`Effective: ${
                              effectivePortalSettings.bucket_defaults.enable_cors ? "enabled" : "disabled"
                            }`}
                            action={
                              <select
                                value={adminBucketCorsOverride}
                                onChange={(e) => setAdminBucketCorsOverride(e.target.value as TriState)}
                                className="rounded-md border border-slate-200 px-2 py-1 ui-caption font-semibold text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                disabled={portalSettingsLoading || portalSettingsSaving}
                              >
                                <option value="inherit">Inherit</option>
                                <option value="enabled">Enable</option>
                                <option value="disabled">Disable</option>
                              </select>
                            }
                          />
                          <PortalSettingsItem
                            title="CORS origins"
                            description={adminBucketCorsOriginsOverride ? "Override active" : "Inherits defaults"}
                            className="md:col-span-2"
                            action={
                              <label className="inline-flex items-center gap-2 ui-caption font-semibold text-slate-700 dark:text-slate-200">
                                <input
                                  type="checkbox"
                                  checked={adminBucketCorsOriginsOverride}
                                  onChange={(e) => setAdminBucketCorsOriginsOverride(e.target.checked)}
                                  className={uiCheckboxClass}
                                  disabled={portalSettingsLoading || portalSettingsSaving}
                                />
                                <span>Override</span>
                              </label>
                            }
                          >
                            <textarea
                              value={adminBucketCorsOriginsText}
                              onChange={(e) => setAdminBucketCorsOriginsText(e.target.value)}
                              className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                              rows={3}
                              placeholder="https://portal.example.com"
                              disabled={!adminBucketCorsOriginsOverride || portalSettingsLoading || portalSettingsSaving}
                            />
                          </PortalSettingsItem>
                        </PortalSettingsSection>
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={editCloseGuard.requestClose}
                  className="rounded-md border border-slate-200 px-4 py-2 ui-body font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-primary px-4 py-2 ui-body font-medium text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
                >
                  Save
                </button>
              </div>
              {editCloseGuard.confirmationDialog}
            </form>
          </div>
        </Modal>
      )}

      <div className="ui-surface-card">
        <ListToolbar
          title="Accounts"
          description="Search matches all records."
          showHeading={false}
          countLabel={`${totalAccounts} entr${totalAccounts === 1 ? "y" : "ies"}`}
          search={
            <div className="flex items-center gap-2">
              <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Filter</span>
              <div className="relative w-full sm:w-64 md:w-72">
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => handleFilterChange(e.target.value)}
                  placeholder="Search by name, RGW ID, group, or tag"
                  className={`${toolbarCompactInputClasses} w-full pr-9 ${quickFilterActive ? "border-primary/50 bg-primary/5 dark:bg-primary/10" : ""}`}
                />
                <button
                  type="button"
                  onClick={toggleQuickFilterMode}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded border border-slate-200 bg-white px-1 py-0 ui-caption font-semibold text-slate-500 hover:border-primary hover:text-primary dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500 dark:hover:text-primary-100"
                  title={`Filter mode: ${quickFilterMode === "contains" ? "contains" : "exact"}`}
                  aria-label="Toggle filter match mode"
                >
                  {quickFilterMode === "contains" ? "~" : "="}
                </button>
              </div>
            </div>
          }
          secondaryContent={
            quickFilterActive ? (
              <div>
                <div className="inline-flex items-center gap-2">
                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Active filters summary
                  </p>
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 ui-caption font-semibold text-rose-700 hover:border-rose-300 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100"
                  >
                    Clear all
                  </button>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 ui-caption font-semibold text-primary-700 dark:border-primary-400/40 dark:bg-primary-500/15 dark:text-primary-100">
                    Search {quickFilterMode === "exact" ? "exact" : "contains"}: {filter.trim()}
                  </span>
                </div>
              </div>
            ) : null
          }
        />
        <div className="overflow-x-auto">
          <table className="compact-table !table-auto !w-max min-w-full divide-y divide-slate-200 dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr>
                {columns.map((col, idx) => (
                  <th
                    key={col.label}
                    onClick={col.field ? () => toggleSort(col.field as SortField) : undefined}
                    className={`px-6 py-3 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${
                      idx === 0
                        ? "sticky left-0 z-20 min-w-[16rem] bg-slate-50 shadow-[inset_-1px_0_0_rgba(100,116,139,0.45),12px_0_16px_-12px_rgba(15,23,42,0.45)] dark:bg-slate-900 dark:shadow-[inset_-1px_0_0_rgba(51,65,85,0.9),12px_0_16px_-12px_rgba(2,6,23,0.85)]"
                        : idx === 1
                          ? "w-56 min-w-[11rem]"
                          : idx === 2
                            ? "w-48 min-w-[10rem]"
                            : idx === 3
                              ? "w-[22rem] min-w-[18rem] max-w-[30rem]"
                              : "w-44 min-w-[9rem]"
                    } ${
                      col.field ? "cursor-pointer hover:text-primary-700 dark:hover:text-primary-100" : col.align === "right" ? "text-right" : ""
                    }`}
                  >
                    <div className={`flex items-center ${col.align === "right" ? "justify-end" : "gap-1"}`}>
                      <span>{col.label}</span>
                      {col.field && sort.field === col.field && (
                        <span className="ui-caption">{sort.direction === "asc" ? "▲" : "▼"}</span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {tableStatus === "loading" && <TableEmptyState colSpan={columns.length} message="Loading accounts..." />}
              {tableStatus === "error" && <TableEmptyState colSpan={columns.length} message="Unable to load accounts." tone="error" />}
              {tableStatus === "empty" && <TableEmptyState colSpan={columns.length} message="No accounts." />}
              {accounts.map((account) => {
                  const summaryDbId = accountDbId(account);
                  const deleteBusy = summaryDbId != null && deletingS3AccountId === summaryDbId;
                  const tagItems = buildUiTagItems(account.tags);
                  return (
                    <tr key={account.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="sticky left-0 z-10 min-w-[16rem] bg-white px-6 py-4 ui-body font-semibold text-slate-900 shadow-[inset_-1px_0_0_rgba(100,116,139,0.45),12px_0_16px_-12px_rgba(15,23,42,0.45)] dark:bg-slate-900 dark:text-slate-100 dark:shadow-[inset_-1px_0_0_rgba(51,65,85,0.9),12px_0_16px_-12px_rgba(2,6,23,0.85)]">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        {isSuperAdmin ? (
                          <button
                            type="button"
                            onClick={() => startEditS3Account(account)}
                            className="min-w-0 truncate text-left transition hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:hover:text-primary-100"
                          >
                            {account.name}
                          </button>
                        ) : (
                          <span className="min-w-0 truncate">{account.name}</span>
                        )}
                        {renderS3AccountTypeBadge(account)}
                      </div>
                      {tagItems.length > 0 && (
                        <UiTagBadgeList
                          items={tagItems}
                          variant="listing-compact"
                          layout="inline-compact"
                          className="ml-auto max-w-full"
                          maxVisible={4}
                        />
                      )}
                    </div>
                  </td>
                  <td className="w-56 min-w-[11rem] px-6 py-4 ui-body text-slate-700 dark:text-slate-200">
                    {account.rgw_account_id ?? account.id}
                  </td>
                  <td className="w-48 min-w-[10rem] px-6 py-4 ui-body text-slate-700 dark:text-slate-200">
                    <span title={account.storage_endpoint_url || undefined}>
                      {account.storage_endpoint_name || "—"}
                    </span>
                  </td>
                  <td className="w-[22rem] min-w-[18rem] max-w-[30rem] px-6 py-4 ui-body text-slate-600 dark:text-slate-300">
                    {renderAccountAssociations(account)}
                  </td>
                  <td className="w-44 min-w-[9rem] px-6 py-4 text-right">
                    {isSuperAdmin ? (
                      <div className="flex justify-end gap-2">
                        <button onClick={() => startEditS3Account(account)} className={tableActionButtonClasses}>
                          Edit
                        </button>
                        <button
                          onClick={() => openDeleteS3AccountModal(account)}
                          className={tableDeleteActionClasses}
                          disabled={deleteBusy}
                        >
                          {deleteBusy ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    ) : (
                      <span className="ui-caption text-slate-500 dark:text-slate-400">-</span>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <PaginationControls
          page={page}
          pageSize={pageSize}
          total={totalAccounts}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          disabled={loading}
        />
      </div>
    </div>
  );
}
