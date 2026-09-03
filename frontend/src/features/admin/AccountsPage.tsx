/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { uiCheckboxClass } from "../../components/ui/styles";
import UiButton from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
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
import {
  defaultAccountAccessGrant,
  getAccountAccessRequiredMessage,
  hasAccountAccessRole,
  type AccountAccessGrant,
} from "../../api/accountAccess";
import type { PortalSettingsAdminUpdate, PortalSettingsOverride } from "../../api/appSettings";
import type { PortalAccountSettings } from "../../api/portal";
import { getStorageEndpoint, listStorageEndpoints, StorageEndpoint } from "../../api/storageEndpoints";
import { listMinimalGroups, type UiGroupSummary } from "../../api/groups";
import { listMinimalUsers, UserSummary } from "../../api/users";
import ActiveFiltersBar from "../../components/ActiveFiltersBar";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import Modal from "../../components/Modal";
import WorkflowPage, {
  WorkflowActions,
  WorkflowMetadata,
  WorkflowSection,
  workflowPageHostClass,
} from "../../components/WorkflowPage";
import WorkflowTabs from "../../components/WorkflowTabs";
import ListPageSection from "../../components/list/ListPageSection";
import PageHeader from "../../components/PageHeader";
import ToolbarSearchInput from "../../components/ToolbarSearchInput";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import PageBanner from "../../components/PageBanner";
import AccountAccessRoleSelectors, {
  AccountAccessRoleValidationMessage,
  ManagerAccountRoleSelect,
  PortalAccountRoleSelect,
} from "./AccountAccessRoleSelectors";
import { PortalSettingsItem, PortalSettingsSection } from "../../components/PortalSettingsLayout";
import StorageUsageCard from "../../components/StorageUsageCard";
import DataTableShell, {
  dataTableDefaultActionProps,
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import UiTagBadgeList from "../../components/UiTagBadgeList";
import UiTagEditor from "../../components/UiTagEditor";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { useTagCatalog } from "../../hooks/useTagCatalog";
import { useAdminAccountStats } from "./useAdminAccountStats";
import {
  AssociationPrincipalStack,
  type AssociationPrincipalItem,
} from "./AssociationSummary";
import { AdminAccessToggleSection } from "./AdminAccessSections";
import AdminQuotaFields from "./AdminQuotaFields";
import { buildAdminQuotaSizeEditorValue } from "./adminQuotaForm";
import {
  AdminAssociationPickerPanel,
  AdminAssociationSectionHeader,
  adminAssociationAccountOptionRowClass,
  adminAssociationCheckboxClass,
  adminAssociationOptionLabelClass,
  adminAssociationTableClass as associationTableClass,
  adminAssociationTableActionCellClass,
  adminAssociationTableContainerClass as associationTableContainerClass,
  adminAssociationTableControlCellClass,
  adminAssociationTableEmptyCellClass,
  adminAssociationTableBodyClass,
  adminAssociationTableHeaderClass,
  adminAssociationTableHeadClass,
  adminAssociationTableHeaderRightClass,
  adminAssociationTableLabelCellClass,
} from "./AdminAssociationPicker";
import AdminAssociationAdvancedSettings from "./AdminAssociationAdvancedSettings";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";
import { extractApiError } from "../../utils/apiError";
import { stableSignature } from "../../utils/stableSignature";
import { nextSortState } from "../../utils/sortValues";
import { matchesExactTextCandidate, type TextMatchMode } from "../../utils/textMatch";
import { isAdminLikeRole, readStoredUser } from "../../utils/workspaces";
import { buildUiTagItems, extractUiTagLabels, normalizeUiTags, type UiTagDefinition } from "../../utils/uiTags";

type SortField = "name" | "rgw_account_id";
type EditTab = "general" | "users" | "groups" | "privileged" | "portal";
type TriState = "inherit" | "enabled" | "disabled";
type PortalOverrideFormSnapshot = {
  delegatedToPortalManagers: boolean;
  browserAccess: TriState;
  bucketCreate: TriState;
  namedBucketCreate: TriState;
  accessKeyCreate: TriState;
  serverAccessLogging: TriState;
  versionCleanup: TriState;
  versioning: TriState;
  lifecycle: TriState;
  noncurrentExpirationOverride: boolean;
  noncurrentExpirationDays: string;
  cors: TriState;
  corsOriginsOverride: boolean;
  corsOriginsText: string;
};

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

export default function S3AccountsPage() {
  const { generalSettings } = useGeneralSettings();
  const portalOverrideConfirmation = useConfirmActionDialog();
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
    allow_bucket_quota_management: false,
  });
  const [editInitialSignature, setEditInitialSignature] = useState("");
  const [portalInitialSignature, setPortalInitialSignature] = useState("");
  const [editTab, setEditTab] = useState<EditTab>("general");
  const [portalAccountSettings, setPortalAccountSettings] = useState<PortalAccountSettings | null>(null);
  const [portalSettingsLoading, setPortalSettingsLoading] = useState(false);
  const [portalSettingsError, setPortalSettingsError] = useState<string | null>(null);
  const [portalSettingsSaving, setPortalSettingsSaving] = useState(false);
  const [portalSettingsMessage, setPortalSettingsMessage] = useState<string | null>(null);
  const [portalSettingsDelegated, setPortalSettingsDelegated] = useState(false);
  const [adminPortalBrowserAccessOverride, setAdminPortalBrowserAccessOverride] = useState<TriState>("inherit");
  const [adminPortalBucketCreateOverride, setAdminPortalBucketCreateOverride] = useState<TriState>("inherit");
  const [adminPortalNamedBucketCreateOverride, setAdminPortalNamedBucketCreateOverride] = useState<TriState>("inherit");
  const [adminPortalAccessKeyCreateOverride, setAdminPortalAccessKeyCreateOverride] = useState<TriState>("inherit");
  const [adminPortalServerAccessLoggingOverride, setAdminPortalServerAccessLoggingOverride] = useState<TriState>("inherit");
  const [adminPortalVersionCleanupOverride, setAdminPortalVersionCleanupOverride] = useState<TriState>("inherit");
  const [adminBucketVersioningOverride, setAdminBucketVersioningOverride] = useState<TriState>("inherit");
  const [adminBucketLifecycleOverride, setAdminBucketLifecycleOverride] = useState<TriState>("inherit");
  const [adminBucketNoncurrentExpirationOverride, setAdminBucketNoncurrentExpirationOverride] = useState(false);
  const [adminBucketNoncurrentExpirationDays, setAdminBucketNoncurrentExpirationDays] = useState("");
  const [adminBucketCorsOverride, setAdminBucketCorsOverride] = useState<TriState>("inherit");
  const [adminBucketCorsOriginsOverride, setAdminBucketCorsOriginsOverride] = useState(false);
  const [adminBucketCorsOriginsText, setAdminBucketCorsOriginsText] = useState("");
  const [deletingS3AccountId, setDeletingS3AccountId] = useState<number | null>(null);
  const [accountToDelete, setS3AccountToDelete] = useState<S3Account | null>(null);
  const [deleteFromRgw, setDeleteFromRgw] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
  const [showUserPanel, setShowUserPanel] = useState(false);
  const [showGroupPanel, setShowGroupPanel] = useState(false);
  const [userSelections, setUserSelections] = useState<number[]>([]);
  const [groupSelections, setGroupSelections] = useState<number[]>([]);
  const [userAccountAccessChoice, setUserAccountAccessChoice] = useState<
    Record<number, AccountAccessGrant>
  >({});
  const [groupAccountAccessChoice, setGroupAccountAccessChoice] = useState<
    Record<number, AccountAccessGrant>
  >({});
  const MAX_LINK_OPTIONS = 10;
  const currentUser = useMemo(() => readStoredUser(), []);
  const isSuperAdmin = isAdminLikeRole(currentUser?.role);
  const canManagePrivilegedTargets = isAdminLikeRole(currentUser?.role);
  const editingAccountId = editingS3Account?.id ?? null;
  const editingCapabilities = editingS3Account?.storage_endpoint_capabilities ?? null;
  const editingEndpointId = editingS3Account?.storage_endpoint_id ?? null;
  const editingEndpointCanWrite = editingEndpointId ? endpointAccountsWrite[editingEndpointId] === true : false;
  const usageEnabled = Boolean(editingCapabilities?.usage);
  const adminEnabled = Boolean(editingCapabilities?.admin);
  const hasUsageIdentity = Boolean(editingS3Account?.rgw_account_id);
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
  const defaultAccountEndpointId = useMemo(() => {
    const endpoint = accountCephEndpoints.find((candidate) => candidate.is_default) ?? accountCephEndpoints[0];
    return endpoint ? String(endpoint.id) : "";
  }, [accountCephEndpoints]);
  const buildCreateSignature = useCallback(
    (value: typeof form) =>
      stableSignature({
        form: {
          ...value,
          tags: normalizeUiTags(value.tags),
          storage_endpoint_id:
            value.storage_endpoint_id === defaultAccountEndpointId ? "" : value.storage_endpoint_id,
        },
      }),
    [defaultAccountEndpointId]
  );
  const buildImportSignature = useCallback(
    (value: { importText: string; importTenantEndpointId: string }) =>
      stableSignature({
        ...value,
        importTenantEndpointId:
          value.importTenantEndpointId === defaultAccountEndpointId ? "" : value.importTenantEndpointId,
      }),
    [defaultAccountEndpointId]
  );

  const extractError = useCallback((err: unknown) => extractApiError(err, "Unexpected error"), []);

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

        const exactMatches = allMatches.filter((account) => {
          const candidates = [
            account.name,
            account.rgw_account_id,
            ...(account.user_links ?? []).flatMap((link) => [link.user_email, link.user_full_name]),
            ...(account.group_links ?? []).map((link) => link.group_name),
            ...extractUiTagLabels(account.tags),
          ];
          return matchesExactTextCandidate(candidates, quick);
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
  }, [extractError, filter, quickFilterMode, page, pageSize, sort.direction, sort.field]);

  const userOptions = useMemo(() => users.map((u) => ({ id: u.id, label: u.email })), [users]);
  const userLabelById = useMemo(() => {
    const map = new Map<number, string>();
    users.forEach((u) => map.set(u.id, u.email));
    return map;
  }, [users]);
  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const groupLabelById = useMemo(() => {
    const map = new Map<number, string>();
    groups.forEach((group) => map.set(group.id, group.name));
    return map;
  }, [groups]);
  const groupsById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const assignedUsers = useMemo(() => {
    return editForm.user_links.map((link) => ({
      id: link.user_id,
      label: link.user_email ?? userLabelById.get(link.user_id) ?? `User #${link.user_id}`,
      manager_role: link.manager_role,
      portal_role: link.portal_role,
      allow_manager_browser_data_access: Boolean(link.allow_manager_browser_data_access),
    }));
  }, [editForm.user_links, userLabelById]);
  const assignedGroups = useMemo(() => {
    return editForm.group_links.map((link) => ({
      id: link.group_id,
      label: link.group_name ?? groupLabelById.get(link.group_id) ?? `Group #${link.group_id}`,
      manager_role: link.manager_role,
      portal_role: link.portal_role,
      allow_manager_browser_data_access: Boolean(link.allow_manager_browser_data_access),
    }));
  }, [editForm.group_links, groupLabelById]);
  const showUserPortalRoleColumn = portalEnabled;
  const showGroupPortalRoleColumn = portalEnabled;
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
      setPortalSettingsDelegated(false);
      setAdminPortalBrowserAccessOverride("inherit");
      setAdminPortalBucketCreateOverride("inherit");
      setAdminPortalNamedBucketCreateOverride("inherit");
      setAdminPortalAccessKeyCreateOverride("inherit");
      setAdminPortalServerAccessLoggingOverride("inherit");
      setAdminPortalVersionCleanupOverride("inherit");
      setAdminBucketVersioningOverride("inherit");
      setAdminBucketLifecycleOverride("inherit");
      setAdminBucketNoncurrentExpirationOverride(false);
      setAdminBucketNoncurrentExpirationDays("");
      setAdminBucketCorsOverride("inherit");
      setAdminBucketCorsOriginsOverride(false);
      setAdminBucketCorsOriginsText("");
      return;
    }
    const override = portalAccountSettings.admin_override;
    const effective = portalAccountSettings.effective;
    const delegatedToPortalManagers = portalAccountSettings.delegated_to_portal_managers;
    const browserAccess = resolveTriState(override.browser_access_enabled);
    const bucketCreate = resolveTriState(override.allow_private_storage_space_create);
    const namedBucketCreate = resolveTriState(override.allow_portal_named_bucket_create);
    const accessKeyCreate = resolveTriState(override.allow_portal_user_access_key_create);
    const serverAccessLogging = resolveTriState(override.server_access_logging_enabled);
    const versionCleanup = resolveTriState(override.storage_space_version_cleanup_enabled);
    const bucketDefaultsOverride = override.bucket_defaults;
    const versioning = resolveTriState(bucketDefaultsOverride?.versioning);
    const lifecycle = resolveTriState(bucketDefaultsOverride?.enable_lifecycle);
    const noncurrentExpirationOverride = bucketDefaultsOverride?.noncurrent_version_expiration_days != null;
    const noncurrentExpirationDays = String(
      bucketDefaultsOverride?.noncurrent_version_expiration_days ??
        effective.bucket_defaults.noncurrent_version_expiration_days
    );
    const cors = resolveTriState(bucketDefaultsOverride?.enable_cors);
    const corsOriginsOverride = Boolean(bucketDefaultsOverride && bucketDefaultsOverride.cors_allowed_origins != null);
    const corsOriginsText = corsOriginsOverride
      ? (bucketDefaultsOverride?.cors_allowed_origins ?? []).join("\n")
      : (effective.bucket_defaults.cors_allowed_origins || []).join("\n");

    setPortalSettingsDelegated(delegatedToPortalManagers);
    setAdminPortalBrowserAccessOverride(browserAccess);
    setAdminPortalBucketCreateOverride(bucketCreate);
    setAdminPortalNamedBucketCreateOverride(namedBucketCreate);
    setAdminPortalAccessKeyCreateOverride(accessKeyCreate);
    setAdminPortalServerAccessLoggingOverride(serverAccessLogging);
    setAdminPortalVersionCleanupOverride(versionCleanup);
    setAdminBucketVersioningOverride(versioning);
    setAdminBucketLifecycleOverride(lifecycle);
    setAdminBucketNoncurrentExpirationOverride(noncurrentExpirationOverride);
    setAdminBucketNoncurrentExpirationDays(noncurrentExpirationDays);
    setAdminBucketCorsOverride(cors);
    setAdminBucketCorsOriginsOverride(corsOriginsOverride);
    setAdminBucketCorsOriginsText(corsOriginsText);
    setPortalInitialSignature(
      buildPortalOverrideFormSignature({
        delegatedToPortalManagers,
        browserAccess,
        bucketCreate,
        namedBucketCreate,
        accessKeyCreate,
        serverAccessLogging,
        versionCleanup,
        versioning,
        lifecycle,
        noncurrentExpirationOverride,
        noncurrentExpirationDays: noncurrentExpirationOverride ? noncurrentExpirationDays : "",
        cors,
        corsOriginsOverride,
        corsOriginsText,
      })
    );
  }, [portalAccountSettings]);

  const toggleSort = (field: SortField) => {
    setSort((current) => nextSortState(current, field, "desc"));
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
    [endpointPermissionLoading, extractError]
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
    async (account: S3Account | S3AccountSummary, options?: { includeUsage?: boolean }) => {
      try {
        const detail = await getS3Account(account.id, { includeUsage: options?.includeUsage });
        return detail;
      } catch (err) {
        setActionError(extractError(err));
        return null;
      }
    },
    [extractError]
  );

  const accountTableColumns: Array<DataTableColumn<S3Account, SortField>> = [
    {
      id: "name",
      label: "Name",
      field: "name",
      primary: true,
      cellClassName: "min-w-[240px] max-w-[360px]",
      render: (account) => {
        const tagItems = buildUiTagItems(account.tags);
        return (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 flex-1 truncate">{account.name}</span>
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
        );
      },
    },
    {
      id: "rgw-id",
      label: "RGW ID",
      field: "rgw_account_id",
      cellClassName: "min-w-[176px]",
      render: (account) => account.rgw_account_id,
    },
    {
      id: "endpoint",
      label: "Endpoint",
      cellClassName: "min-w-[160px]",
      render: (account) => (
        <span title={account.storage_endpoint_url || undefined}>
          {account.storage_endpoint_name || "—"}
        </span>
      ),
    },
    {
      id: "associations",
      label: "UI Users / Groups",
      cellClassName: "min-w-[180px] max-w-[240px] align-middle",
      render: (account) => renderAccountAssociations(account),
    },
    {
      id: "actions",
      label: "Actions",
      align: "right",
      mobileRole: "actions",
      cellClassName: "min-w-[144px]",
      render: (account) => {
        const deleteBusy = deletingS3AccountId === account.id;
        return isSuperAdmin ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => startEditS3Account(account)}
              className={tableActionButtonClasses}
              {...dataTableDefaultActionProps}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => openDeleteS3AccountModal(account)}
              className={tableDeleteActionClasses}
              disabled={deleteBusy}
            >
              {deleteBusy ? "Deleting..." : "Delete"}
            </button>
          </div>
        ) : (
          <span className="ui-caption text-slate-500 dark:text-slate-400">-</span>
        );
      },
    },
  ];
  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: accounts.length,
  });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name) {
      setActionError("Account name is required");
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
        storage_endpoint_id: Number(form.storage_endpoint_id),
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

  const renderAccountAssociations = (account: S3Account | S3AccountSummary) => {
    const userItems: AssociationPrincipalItem[] = account.user_links.map((link) => {
      const user = usersById.get(link.user_id);
      return {
        id: link.user_id,
        kind: "user",
        label: link.user_full_name || user?.full_name || link.user_email || user?.email || `User #${link.user_id}`,
        email: link.user_email || user?.email,
        avatar: link.user_avatar || user?.avatar,
        manager_role: link.manager_role,
        portal_role: link.portal_role,
      };
    });
    const groupItems: AssociationPrincipalItem[] = account.group_links.map((link) => {
      const group = groupsById.get(link.group_id);
      return {
        id: link.group_id,
        kind: "group",
        label: link.group_name || group?.name || `Group #${link.group_id}`,
        avatar: link.group_avatar || group?.avatar,
        manager_role: link.manager_role,
        portal_role: link.portal_role,
      };
    });
    return <AssociationPrincipalStack items={[...userItems, ...groupItems]} />;
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
  const deleteModalBusy = accountToDelete ? deletingS3AccountId === accountToDelete.id : false;
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
    () => buildCreateSignature(form),
    [buildCreateSignature, form]
  );
  const createCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: Boolean(createInitialSignature) && createCurrentSignature !== createInitialSignature,
    disabled: creating,
    onClose: () => setShowCreateModal(false),
  });
  const importCurrentSignature = useMemo(
    () => buildImportSignature({ importText, importTenantEndpointId }),
    [buildImportSignature, importTenantEndpointId, importText]
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
    setUserAccountAccessChoice({});
    setGroupAccountAccessChoice({});
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
        delegatedToPortalManagers: portalSettingsDelegated,
        browserAccess: adminPortalBrowserAccessOverride,
        bucketCreate: adminPortalBucketCreateOverride,
        namedBucketCreate: adminPortalNamedBucketCreateOverride,
        accessKeyCreate: adminPortalAccessKeyCreateOverride,
        serverAccessLogging: adminPortalServerAccessLoggingOverride,
        versionCleanup: adminPortalVersionCleanupOverride,
        versioning: adminBucketVersioningOverride,
        lifecycle: adminBucketLifecycleOverride,
        noncurrentExpirationOverride: adminBucketNoncurrentExpirationOverride,
        noncurrentExpirationDays: adminBucketNoncurrentExpirationOverride
          ? adminBucketNoncurrentExpirationDays
          : "",
        cors: adminBucketCorsOverride,
        corsOriginsOverride: adminBucketCorsOriginsOverride,
        corsOriginsText: adminBucketCorsOriginsText,
      }),
    [
      adminBucketCorsOriginsOverride,
      adminBucketCorsOriginsText,
      adminBucketCorsOverride,
      adminBucketLifecycleOverride,
      adminBucketNoncurrentExpirationDays,
      adminBucketNoncurrentExpirationOverride,
      adminBucketVersioningOverride,
      adminPortalBrowserAccessOverride,
      adminPortalNamedBucketCreateOverride,
      adminPortalAccessKeyCreateOverride,
      adminPortalBucketCreateOverride,
      adminPortalServerAccessLoggingOverride,
      adminPortalVersionCleanupOverride,
      portalSettingsDelegated,
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

  const startEditS3Account = async (account: S3Account | S3AccountSummary) => {
    setActionError(null);
    setActionMessage(null);
    setUserAccountAccessChoice({});
    setGroupAccountAccessChoice({});
    void loadUsersIfNeeded();
    void loadGroupsIfNeeded();
    void loadEndpointsIfNeeded();
    const detail = await loadAccountDetail(account);
    if (!detail) return;
    const quota = buildAdminQuotaSizeEditorValue(detail.quota_max_size_gb);
    const nextEditForm = {
      tags: normalizeUiTags(detail.tags),
      quota_max_size_gb: quota.value,
      quota_max_size_unit: quota.unit,
      quota_max_objects: detail.quota_max_objects != null ? String(detail.quota_max_objects) : "",
      allow_bucket_quota_management: Boolean(detail.allow_bucket_quota_management),
      user_links:
        detail.user_links?.map((link) => ({
          user_id: link.user_id,
          manager_role: link.manager_role,
          portal_role: link.portal_role,
          user_email: link.user_email ?? undefined,
          allow_manager_browser_data_access: Boolean(link.allow_manager_browser_data_access),
        })) ?? [],
      group_links:
        detail.group_links?.map((link) => ({
          group_id: link.group_id,
          group_name: link.group_name ?? undefined,
          manager_role: link.manager_role,
          portal_role: link.portal_role,
          allow_manager_browser_data_access: Boolean(link.allow_manager_browser_data_access),
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
    const invalidUserLink = editForm.user_links.some(
      (link) => !hasAccountAccessRole(link),
    );
    const invalidGroupLink = editForm.group_links.some(
      (link) => !hasAccountAccessRole(link),
    );
    if (invalidUserLink || invalidGroupLink) {
      setEditTab(invalidUserLink ? "users" : "groups");
      setActionError(getAccountAccessRequiredMessage(portalEnabled));
      setActionMessage(null);
      return;
    }
    const targetId = editingS3Account.id;
    setActionError(null);
    setActionMessage(null);
    try {
      const payload = {
        user_links: editForm.user_links,
        group_links: editForm.group_links,
        tags: normalizeUiTags(editForm.tags),
        ...(canManagePrivilegedTargets
          ? { allow_bucket_quota_management: editForm.allow_bucket_quota_management }
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

  const buildAdminPortalOverridePayload = (): PortalSettingsAdminUpdate => {
    const payload: PortalSettingsAdminUpdate = {
      delegated_to_portal_managers: portalSettingsDelegated,
    };
    const browserAccessValue = toOverrideValue(adminPortalBrowserAccessOverride);
    if (browserAccessValue !== undefined) {
      payload.browser_access_enabled = browserAccessValue;
    }
    const allowBucketCreateValue = toOverrideValue(adminPortalBucketCreateOverride);
    if (allowBucketCreateValue !== undefined) {
      payload.allow_private_storage_space_create = allowBucketCreateValue;
    }
    const allowNamedBucketCreateValue = toOverrideValue(adminPortalNamedBucketCreateOverride);
    if (allowNamedBucketCreateValue !== undefined) {
      payload.allow_portal_named_bucket_create = allowNamedBucketCreateValue;
    }
    const allowAccessKeyCreateValue = toOverrideValue(adminPortalAccessKeyCreateOverride);
    if (allowAccessKeyCreateValue !== undefined) {
      payload.allow_portal_user_access_key_create = allowAccessKeyCreateValue;
    }
    const serverAccessLoggingValue = toOverrideValue(adminPortalServerAccessLoggingOverride);
    if (serverAccessLoggingValue !== undefined) {
      payload.server_access_logging_enabled = serverAccessLoggingValue;
    }
    const versionCleanupValue = toOverrideValue(adminPortalVersionCleanupOverride);
    if (versionCleanupValue !== undefined) {
      payload.storage_space_version_cleanup_enabled = versionCleanupValue;
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
    if (adminBucketNoncurrentExpirationOverride) {
      bucketDefaults.noncurrent_version_expiration_days = Number(adminBucketNoncurrentExpirationDays);
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

    return payload;
  };

  const handleSaveAdminOverrides = async () => {
    if (!editingAccountId || !portalAccountSettings || portalSettingsSaving) return;
    if (adminBucketNoncurrentExpirationOverride) {
      const expirationDays = Number(adminBucketNoncurrentExpirationDays);
      if (!Number.isInteger(expirationDays) || expirationDays < 1) {
        setPortalSettingsMessage(null);
        setPortalSettingsError("Version history retention must be a positive integer.");
        return;
      }
    }
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

  const resetAdminOverrides = async () => {
    if (!editingAccountId || portalSettingsSaving) return;
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

  const handleResetAdminOverrides = () => {
    if (!editingS3Account || portalSettingsSaving) return;
    portalOverrideConfirmation.requestConfirmation({
      title: "Reset Portal overrides?",
      description: "Remove the account-specific Portal settings for this RGW account.",
      confirmLabel: "Reset overrides",
      details: [{ label: "RGW account", value: editingS3Account.name }],
      impacts: ["The inherited platform Portal settings will take effect for this account."],
      onConfirm: resetAdminOverrides,
    });
  };

  const openDeleteS3AccountModal = async (account: S3Account | S3AccountSummary) => {
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
    const targetId = accountToDelete.id;
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
    <div className={workflowPageHostClass(Boolean(editingS3Account))}>
      <PageHeader
        title="RGW Accounts"
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
                    setImportInitialSignature(buildImportSignature({ importText: "", importTenantEndpointId }));
                    setShowImportModal(true);
                    void loadEndpointsIfNeeded();
                  },
                  variant: "ghost",
                },
                {
                  label: "Create account",
                  onClick: () => {
                    setCreateInitialSignature(buildCreateSignature(form));
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
                <UiInput
                  label="Account name *"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                />
                <UiInput
                  label="Email contact"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="contact@example.com"
                />
                <UiSelect
                  label="Storage endpoint (Ceph) *"
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
                </UiSelect>
                <div className="flex flex-col gap-1">
                  <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Capacity quota</label>
                  <div className="flex gap-2">
                    <UiInput
                      aria-label="Capacity quota"
                      type="number"
                      min="0"
                      step="any"
                      fieldClassName="flex-1"
                      value={form.quota_max_size_gb}
                      onChange={(e) => setForm((f) => ({ ...f, quota_max_size_gb: e.target.value }))}
                      placeholder="e.g. 500"
                    />
                    <UiSelect
                      aria-label="Capacity quota unit"
                      fieldClassName="w-24"
                      value={form.quota_max_size_unit}
                      onChange={(e) => setForm((f) => ({ ...f, quota_max_size_unit: e.target.value }))}
                    >
                      <option value="MiB">MiB</option>
                      <option value="GiB">GiB</option>
                      <option value="TiB">TiB</option>
                    </UiSelect>
                  </div>
                </div>
                <UiInput
                  label="Object quota (count)"
                  type="number"
                  min="0"
                  value={form.quota_max_objects}
                  onChange={(e) => setForm((f) => ({ ...f, quota_max_objects: e.target.value }))}
                  placeholder="e.g. 1000000"
                />
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
              <UiButton variant="secondary" onClick={createCloseGuard.requestClose}>
                Cancel
              </UiButton>
              <UiButton
                type="submit"
                disabled={creating || createPermissionLoading || !createEndpointCanWrite}
              >
                {creating ? "Creating..." : "Create account"}
              </UiButton>
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
        <Modal
          title="Import RGW accounts"
          onClose={importCloseGuard.requestClose}
          maxWidthClass="max-w-xl"
        >
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
              className="ui-control min-h-32"
              rows={6}
              placeholder="RGW00000000000000001"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <UiSelect
              label="Ceph endpoint"
              fieldClassName="mt-3"
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
            </UiSelect>
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
            <UiButton variant="secondary" onClick={importCloseGuard.requestClose}>
              Cancel
            </UiButton>
            <UiButton
              disabled={importDisabled}
              onClick={async () => {
                try {
                  if (!importTenantEndpointId) {
                    setImportError("Select a Ceph endpoint to import accounts.");
                    setImportMessage(null);
                    return;
                  }
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
                    storage_endpoint_id: Number(importTenantEndpointId),
                  }));
                  await importS3Accounts(payload);
                  setImportMessage("S3Accounts imported.");
                  setImportText("");
                  setImportInitialSignature(buildImportSignature({ importText: "", importTenantEndpointId }));
                  await fetchS3Accounts();
                } catch (err) {
                  setImportError(extractError(err));
                } finally {
                  setImportBusy(false);
                }
              }}
            >
              {importBusy ? "Importing..." : "Import"}
            </UiButton>
          </div>
          {importCloseGuard.confirmationDialog}
        </Modal>
      )}

      {isSuperAdmin && editingS3Account && (
        <WorkflowPage
          title={`Edit ${editingS3Account.name}`}
          description="Manage quotas, usage, UI associations, privileged access, and Portal overrides for this account."
          breadcrumbs={adminPageBreadcrumbs("accounts", { label: "Edit" })}
          backLabel="Back to accounts"
          onBack={editCloseGuard.requestClose}
          contentVariant="plain"
          width="wide"
          metaContent={
            <WorkflowMetadata
              items={[
                {
                  label: "RGW ID",
                  value: editingS3Account.rgw_account_id,
                },
                {
                  label: "Endpoint",
                  value: editingS3Account.storage_endpoint_name ?? "—",
                  title: editingS3Account.storage_endpoint_url || undefined,
                },
              ]}
            />
          }
        >
          {actionError && (
            <PageBanner tone="error" className="mb-3">
              {actionError}
            </PageBanner>
          )}
          <form onSubmit={submitEditS3Account} className="space-y-4">
            <WorkflowTabs<EditTab>
              activeTab={editTab}
              onTabChange={(tab) => {
                if (tab === "users") {
                  void loadUsersIfNeeded();
                }
                if (tab === "groups") {
                  void loadGroupsIfNeeded();
                }
                setEditTab(tab);
              }}
              ariaLabel="RGW account configuration sections"
              idPrefix="admin-rgw-account-edit"
              tabs={[
                { id: "general", label: "General" },
                { id: "users", label: "Linked UI users" },
                { id: "groups", label: "Linked UI groups" },
                { id: "privileged", label: "Privileged access", visible: canManagePrivilegedTargets },
                { id: "portal", label: "Portal overrides", visible: portalEnabled },
              ]}
            >
            {showGeneralTab && (
                <>
                  <WorkflowSection
                    title="Account details"
                    description="Use administrative tags to make this account easier to find and organize."
                  >
                    {adminTagCatalogError && <PageBanner tone="warning">{adminTagCatalogError}</PageBanner>}
                    <UiTagEditor
                      label="Tags"
                      tags={editForm.tags}
                      catalog={adminTagCatalog}
                      onChange={(tags) => setEditForm((prev) => ({ ...prev, tags }))}
                      placeholder="Add a tag for this account"
                      hint={adminTagCatalogLoading ? "Loading existing tag catalog..." : undefined}
                    />
                  </WorkflowSection>
                  <StorageUsageCard
                    accountName={editingS3Account.name}
                    storage={{
                      used: editingUsageStats?.total_bytes ?? null,
                      quotaBytes:
                        editingS3Account.quota_max_size_gb != null
                          ? editingS3Account.quota_max_size_gb * 1024 ** 3
                          : null,
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
                  <AdminQuotaFields
                    storageValue={editForm.quota_max_size_gb}
                    storageUnit={editForm.quota_max_size_unit}
                    objectValue={editForm.quota_max_objects}
                    disabled={!allowQuotaUpdates}
                    onStorageValueChange={(value) =>
                      setEditForm((prev) => ({ ...prev, quota_max_size_gb: value }))
                    }
                    onStorageUnitChange={(value) =>
                      setEditForm((prev) => ({ ...prev, quota_max_size_unit: value }))
                    }
                    onObjectValueChange={(value) =>
                      setEditForm((prev) => ({ ...prev, quota_max_objects: value }))
                    }
                  />
                </>
              )}
              {showUsersTab && (
                <div className="space-y-3">
                  <AdminAssociationSectionHeader
                    title="Linked UI users"
                    countLabel={`${assignedUsers.length} linked${loadingUsers ? " · loading..." : ""}`}
                    actionLabel={showUserPanel ? "Close" : "Add UI users"}
                    onAction={() => {
                      if (!showUserPanel) {
                        void loadUsersIfNeeded();
                      }
                      setShowUserPanel((prev) => !prev);
                    }}
                  />
                  <div className={associationTableContainerClass}>
                    <table className={associationTableClass}>
                      <thead className={adminAssociationTableHeadClass}>
                        <tr>
                          <th className={adminAssociationTableHeaderClass}>
                            User
                          </th>
                          <th className={adminAssociationTableHeaderClass}>Manager role</th>
                          {showUserPortalRoleColumn ? (
                            <th className={adminAssociationTableHeaderClass}>
                              Portal role
                            </th>
                          ) : null}
                          <th className={adminAssociationTableHeaderRightClass}>
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className={adminAssociationTableBodyClass}>
                        {assignedUsers.length === 0 ? (
                          <tr>
                            <td
                              colSpan={3 + Number(showUserPortalRoleColumn)}
                              className={adminAssociationTableEmptyCellClass}
                            >
                              No linked users yet.
                            </td>
                          </tr>
                        ) : (
                          assignedUsers.map((u) => {
                            const accessErrorId = `account-user-access-${u.id}-error`;
                            const invalid = !hasAccountAccessRole(u);
                            const updateAccess = (value: AccountAccessGrant) =>
                              setEditForm((prev) => ({
                                ...prev,
                                user_links: prev.user_links.map((link) =>
                                  link.user_id === u.id ? { ...link, ...value } : link
                                ),
                              }));
                            return (
                              <tr key={u.id}>
                                <td className={adminAssociationTableLabelCellClass}>
                                  {u.label}
                                  <AccountAccessRoleValidationMessage
                                    id={accessErrorId}
                                    value={u}
                                    portalEnabled={portalEnabled}
                                  />
                                </td>
                                <td className={adminAssociationTableControlCellClass}>
                                  <ManagerAccountRoleSelect
                                    label={u.label}
                                    portalEnabled={portalEnabled}
                                    value={u}
                                    onChange={updateAccess}
                                    showLabel={false}
                                    invalid={invalid}
                                    describedBy={invalid ? accessErrorId : undefined}
                                  />
                                </td>
                                {showUserPortalRoleColumn ? (
                                  <td className={adminAssociationTableControlCellClass}>
                                    <PortalAccountRoleSelect
                                      label={u.label}
                                      portalEnabled={portalEnabled}
                                      value={u}
                                      onChange={updateAccess}
                                      showLabel={false}
                                      invalid={invalid}
                                      describedBy={invalid ? accessErrorId : undefined}
                                    />
                                  </td>
                                ) : null}
                                <td className={adminAssociationTableActionCellClass}>
                                  {u.manager_role ? (
                                    <AdminAssociationAdvancedSettings
                                      targetLabel={u.label}
                                      associationKind="account"
                                      allowManagerBrowserDataAccess={
                                        u.allow_manager_browser_data_access
                                      }
                                      onApply={(allowed) =>
                                        setEditForm((prev) => ({
                                          ...prev,
                                          user_links: prev.user_links.map((link) =>
                                            link.user_id === u.id
                                              ? {
                                                  ...link,
                                                  allow_manager_browser_data_access: allowed,
                                                }
                                              : link,
                                          ),
                                        }))
                                      }
                                    />
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditForm((prev) => ({
                                        ...prev,
                                        user_links: prev.user_links.filter(
                                          (link) => link.user_id !== u.id,
                                        ),
                                      }))
                                    }
                                    className={tableDeleteActionClasses}
                                  >
                                    Remove
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                  {showUserPanel && (
                    <AdminAssociationPickerPanel
                      title="Add UI users"
                      hint="(filter by email)"
                      search={userSearch}
                      onSearchChange={setUserSearch}
                      searchAriaLabel="Search UI users"
                      loading={loadingUsers}
                      availableCount={availableUsers.length}
                      maxVisibleOptions={MAX_LINK_OPTIONS}
                      selectedCount={userSelections.length}
                      loadingLabel="Loading UI users..."
                      onCancel={() => {
                        setShowUserPanel(false);
                        setUserSelections([]);
                        setUserSearch("");
                      }}
                      onAdd={() => {
                        if (userSelections.length === 0) return;
                        const toAdd = userSelections.map((id) => ({
                          user_id: id,
                          ...(userAccountAccessChoice[id] ??
                            defaultAccountAccessGrant(portalEnabled)),
                          user_email: userLabelById.get(id) ?? undefined,
                          allow_manager_browser_data_access: false,
                        }));
                        setEditForm((prev) => ({
                          ...prev,
                          user_links: [...prev.user_links, ...toAdd],
                        }));
                        setShowUserPanel(false);
                        setUserSelections([]);
                        setUserSearch("");
                      }}
                      addDisabled={
                        userSelections.length === 0 ||
                        userSelections.some(
                          (id) =>
                            !hasAccountAccessRole(
                              userAccountAccessChoice[id] ??
                                defaultAccountAccessGrant(portalEnabled),
                            ),
                        )
                      }
                    >
                        {visibleAvailableUsers.map((u) => {
                          const isSelected = userSelections.includes(u.id);
                          const access =
                            userAccountAccessChoice[u.id] ??
                            defaultAccountAccessGrant(portalEnabled);
                          return (
                            <div
                              key={u.id}
                              className={adminAssociationAccountOptionRowClass(isSelected)}
                            >
                              <label className={adminAssociationOptionLabelClass}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleUserSelection(u.id)}
                                  className={adminAssociationCheckboxClass}
                                />
                                <span>{u.label}</span>
                              </label>
                              <div className="flex flex-wrap items-center gap-2">
                                <AccountAccessRoleSelectors
                                  label={u.label}
                                  portalEnabled={portalEnabled}
                                  value={access}
                                  onChange={(value) =>
                                    setUserAccountAccessChoice((prev) => ({
                                      ...prev,
                                      [u.id]: value,
                                    }))
                                  }
                                />
                              </div>
                            </div>
                          );
                        })}
                    </AdminAssociationPickerPanel>
                  )}
                </div>
              )}
              {showGroupsTab && (
                <div className="space-y-3">
                  <AdminAssociationSectionHeader
                    title="Linked UI groups"
                    countLabel={`${assignedGroups.length} linked${loadingGroups ? " · loading..." : ""}`}
                    actionLabel={showGroupPanel ? "Close" : "Add UI groups"}
                    onAction={() => {
                      if (!showGroupPanel) {
                        void loadGroupsIfNeeded();
                      }
                      setShowGroupPanel((prev) => !prev);
                    }}
                  />
                  <div className={associationTableContainerClass}>
                    <table className={associationTableClass}>
                      <thead className={adminAssociationTableHeadClass}>
                        <tr>
                          <th className={adminAssociationTableHeaderClass}>
                            Group
                          </th>
                          <th className={adminAssociationTableHeaderClass}>Manager role</th>
                          {showGroupPortalRoleColumn ? (
                            <th className={adminAssociationTableHeaderClass}>
                              Portal role
                            </th>
                          ) : null}
                          <th className={adminAssociationTableHeaderRightClass}>
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className={adminAssociationTableBodyClass}>
                        {assignedGroups.length === 0 ? (
                          <tr>
                            <td
                              colSpan={3 + Number(showGroupPortalRoleColumn)}
                              className={adminAssociationTableEmptyCellClass}
                            >
                              No linked groups yet.
                            </td>
                          </tr>
                        ) : (
                          assignedGroups.map((group) => {
                            const accessErrorId = `account-group-access-${group.id}-error`;
                            const invalid = !hasAccountAccessRole(group);
                            const updateAccess = (value: AccountAccessGrant) =>
                              setEditForm((prev) => ({
                                ...prev,
                                group_links: prev.group_links.map((link) =>
                                  link.group_id === group.id ? { ...link, ...value } : link
                                ),
                              }));
                            return (
                              <tr key={group.id}>
                                <td className={adminAssociationTableLabelCellClass}>
                                  {group.label}
                                  <AccountAccessRoleValidationMessage
                                    id={accessErrorId}
                                    value={group}
                                    portalEnabled={portalEnabled}
                                  />
                                </td>
                                <td className={adminAssociationTableControlCellClass}>
                                  <ManagerAccountRoleSelect
                                    label={group.label}
                                    portalEnabled={portalEnabled}
                                    value={group}
                                    onChange={updateAccess}
                                    showLabel={false}
                                    invalid={invalid}
                                    describedBy={invalid ? accessErrorId : undefined}
                                  />
                                </td>
                                {showGroupPortalRoleColumn ? (
                                  <td className={adminAssociationTableControlCellClass}>
                                    <PortalAccountRoleSelect
                                      label={group.label}
                                      portalEnabled={portalEnabled}
                                      value={group}
                                      onChange={updateAccess}
                                      showLabel={false}
                                      invalid={invalid}
                                      describedBy={invalid ? accessErrorId : undefined}
                                    />
                                  </td>
                                ) : null}
                                <td className={adminAssociationTableActionCellClass}>
                                  {group.manager_role ? (
                                    <AdminAssociationAdvancedSettings
                                      targetLabel={group.label}
                                      associationKind="account"
                                      allowManagerBrowserDataAccess={
                                        group.allow_manager_browser_data_access
                                      }
                                      onApply={(allowed) =>
                                        setEditForm((prev) => ({
                                          ...prev,
                                          group_links: prev.group_links.map((link) =>
                                            link.group_id === group.id
                                              ? {
                                                  ...link,
                                                  allow_manager_browser_data_access: allowed,
                                                }
                                              : link,
                                          ),
                                        }))
                                      }
                                    />
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditForm((prev) => ({
                                        ...prev,
                                        group_links: prev.group_links.filter(
                                          (link) => link.group_id !== group.id,
                                        ),
                                      }))
                                    }
                                    className={tableDeleteActionClasses}
                                  >
                                    Remove
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                  {showGroupPanel && (
                    <AdminAssociationPickerPanel
                      title="Add UI groups"
                      hint="(filter by name)"
                      search={groupSearch}
                      onSearchChange={setGroupSearch}
                      searchAriaLabel="Search UI groups"
                      loading={loadingGroups}
                      availableCount={availableGroups.length}
                      maxVisibleOptions={MAX_LINK_OPTIONS}
                      selectedCount={groupSelections.length}
                      loadingLabel="Loading UI groups..."
                      onCancel={() => {
                        setShowGroupPanel(false);
                        setGroupSelections([]);
                        setGroupSearch("");
                      }}
                      onAdd={() => {
                        if (groupSelections.length === 0) return;
                        const toAdd = groupSelections.map((id) => ({
                          group_id: id,
                          group_name: groupLabelById.get(id) ?? undefined,
                          allow_manager_browser_data_access: false,
                          ...(groupAccountAccessChoice[id] ??
                            defaultAccountAccessGrant(portalEnabled)),
                        }));
                        setEditForm((prev) => ({
                          ...prev,
                          group_links: [...prev.group_links, ...toAdd],
                        }));
                        setShowGroupPanel(false);
                        setGroupSelections([]);
                        setGroupSearch("");
                      }}
                      addDisabled={
                        groupSelections.length === 0 ||
                        groupSelections.some(
                          (id) =>
                            !hasAccountAccessRole(
                              groupAccountAccessChoice[id] ??
                                defaultAccountAccessGrant(portalEnabled),
                            ),
                        )
                      }
                    >
                        {visibleAvailableGroups.map((group) => {
                          const isSelected = groupSelections.includes(group.id);
                          const access =
                            groupAccountAccessChoice[group.id] ??
                            defaultAccountAccessGrant(portalEnabled);
                          return (
                            <div
                              key={group.id}
                              className={adminAssociationAccountOptionRowClass(isSelected)}
                            >
                              <label className={adminAssociationOptionLabelClass}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleGroupSelection(group.id)}
                                  className={adminAssociationCheckboxClass}
                                />
                                <span>{group.name}</span>
                              </label>
                              <div className="flex flex-wrap items-center gap-2">
                                <AccountAccessRoleSelectors
                                  label={group.name}
                                  portalEnabled={portalEnabled}
                                  value={access}
                                  onChange={(value) =>
                                    setGroupAccountAccessChoice((prev) => ({
                                      ...prev,
                                      [group.id]: value,
                                    }))
                                  }
                                />
                              </div>
                            </div>
                          );
                        })}
                    </AdminAssociationPickerPanel>
                  )}
                </div>
              )}
              {canManagePrivilegedTargets && showPrivilegedTab && (
                <AdminAccessToggleSection
                  title="Privileged Ceph access"
                  description="Ceph admin-API actions granted directly to this account outside the Ceph Admin workspace."
                  items={[
                    {
                      title: "Bucket quota management",
                      description: "Allow Ceph bucket quota updates for this S3 Account in Manager.",
                      ariaLabel: "Bucket quota management",
                      checked: editForm.allow_bucket_quota_management,
                      onChange: (checked) =>
                        setEditForm((prev) => ({
                          ...prev,
                          allow_bucket_quota_management: checked,
                        })),
                    },
                  ]}
                />
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
                        <PortalSettingsSection title="DELEGATION" layout="grid">
                          <PortalSettingsItem
                            title="Portal manager settings"
                            description="Allow Portal managers for this project to edit the shared Portal overrides from Portal settings."
                            action={
                              <label className="inline-flex items-center gap-2 ui-caption font-semibold text-slate-700 dark:text-slate-200">
                                <input
                                  type="checkbox"
                                  checked={portalSettingsDelegated}
                                  onChange={(event) => setPortalSettingsDelegated(event.target.checked)}
                                  className={uiCheckboxClass}
                                  disabled={portalSettingsLoading || portalSettingsSaving}
                                  aria-label="Delegate Portal overrides to Portal managers"
                                />
                                <span>{portalSettingsDelegated ? "Delegated" : "Administrator only"}</span>
                              </label>
                            }
                          />
                        </PortalSettingsSection>

                        <PortalSettingsSection title="UI" layout="grid">
                          <PortalSettingsItem
                            title="Browser workspace access"
                            description={`Effective for this project: ${
                              effectivePortalSettings.browser_access_enabled ? "enabled" : "disabled"
                            }`}
                            action={
                              <select
                                value={adminPortalBrowserAccessOverride}
                                onChange={(e) => setAdminPortalBrowserAccessOverride(e.target.value as TriState)}
                                className="rounded-md border border-slate-200 px-2 py-1 ui-caption font-semibold text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                disabled={portalSettingsLoading || portalSettingsSaving}
                                aria-label="Browser workspace access override"
                              >
                                <option value="inherit">Inherit</option>
                                <option value="enabled">Enable</option>
                                <option value="disabled">Disable</option>
                              </select>
                            }
                          />
                          <PortalSettingsItem
                            title="Private Storage Space creation"
                            description={`Effective for Portal users and managers: ${
                              effectivePortalSettings.allow_private_storage_space_create ? "enabled" : "disabled"
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
                          <PortalSettingsItem
                            title="Server access logging"
                            description={`Effective for storage spaces: ${
                              effectivePortalSettings.server_access_logging_enabled ? "enabled" : "disabled"
                            }. Disabled means no exhaustive object audit.`}
                            action={
                              <select
                                value={adminPortalServerAccessLoggingOverride}
                                onChange={(e) => setAdminPortalServerAccessLoggingOverride(e.target.value as TriState)}
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
                            title="Storage Space history cleanup"
                            description={`Effective for storage spaces: ${
                              effectivePortalSettings.storage_space_version_cleanup_enabled ? "enabled" : "disabled"
                            }`}
                            action={
                              <select
                                value={adminPortalVersionCleanupOverride}
                                onChange={(e) => setAdminPortalVersionCleanupOverride(e.target.value as TriState)}
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
                            title="Version history retention"
                            description={`Effective for new Storage Spaces: ${effectivePortalSettings.bucket_defaults.noncurrent_version_expiration_days} days. Existing buckets are unchanged.`}
                            action={
                              <label className="inline-flex items-center gap-2 ui-caption font-semibold text-slate-700 dark:text-slate-200">
                                <input
                                  type="checkbox"
                                  checked={adminBucketNoncurrentExpirationOverride}
                                  onChange={(e) => setAdminBucketNoncurrentExpirationOverride(e.target.checked)}
                                  className={uiCheckboxClass}
                                  disabled={portalSettingsLoading || portalSettingsSaving}
                                  aria-label="Override version history retention"
                                />
                                <span>Override</span>
                              </label>
                            }
                          >
                            <UiInput
                              type="number"
                              min={1}
                              step={1}
                              value={adminBucketNoncurrentExpirationDays}
                              onChange={(e) => setAdminBucketNoncurrentExpirationDays(e.target.value)}
                              className="mt-2 w-28"
                              size="compact"
                              disabled={
                                !adminBucketNoncurrentExpirationOverride ||
                                portalSettingsLoading ||
                                portalSettingsSaving
                              }
                              aria-label="Account version history retention days"
                            />
                          </PortalSettingsItem>
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
            </WorkflowTabs>
            <WorkflowActions>
              <UiButton variant="secondary" onClick={editCloseGuard.requestClose}>
                Cancel
              </UiButton>
              <UiButton type="submit">
                Save changes
              </UiButton>
            </WorkflowActions>
            {editCloseGuard.confirmationDialog}
            {portalOverrideConfirmation.confirmationDialog}
          </form>
        </WorkflowPage>
      )}

      <ListPageSection
          title="RGW Accounts"
          description="Search matches all records."
          countLabel={`${totalAccounts} entr${totalAccounts === 1 ? "y" : "ies"}`}
          search={
            <ToolbarSearchInput
              value={filter}
              onChange={handleFilterChange}
              placeholder="Search by name, RGW ID, user email, group, or tag"
              className="w-full sm:w-64 md:w-72"
              active={quickFilterActive}
              matchMode={quickFilterMode}
              onToggleMatchMode={toggleQuickFilterMode}
            />
          }
          secondaryContent={
            quickFilterActive ? (
              <ActiveFiltersBar
                label="Active filters summary"
                items={[
                  {
                    id: "search",
                    label: `Search ${quickFilterMode === "exact" ? "exact" : "contains"}: ${filter.trim()}`,
                  },
                ]}
                onClearAll={clearAllFilters}
              />
            ) : null
          }
      >
        <DataTableShell
          columns={accountTableColumns}
          rows={accounts}
          rowKey={(account) => account.id}
          status={tableStatus}
          loadingMessage="Loading accounts..."
          errorMessage="Unable to load accounts."
          emptyMessage="No accounts."
          sort={{ field: sort.field, direction: sort.direction, onSort: toggleSort }}
          primaryColumnId="name"
          responsiveCards
          tableClassName="compact-table"
          pagination={{
            page,
            pageSize,
            total: totalAccounts,
            onPageChange: handlePageChange,
            onPageSizeChange: handlePageSizeChange,
            disabled: loading,
          }}
        />
      </ListPageSection>
    </div>
  );
}
