/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  S3User,
  createS3User,
  deleteS3User,
  getS3User,
  getS3UserWithBuckets,
  importS3Users,
  listS3Users,
  updateS3User,
  type UpdateS3UserPayload,
  type S3UserGroupLink,
  type S3UserUserLink,
} from "../../api/s3Users";
import { listMinimalGroups, type UiGroupSummary } from "../../api/groups";
import { getStorageEndpoint, listStorageEndpoints, StorageEndpoint } from "../../api/storageEndpoints";
import { listMinimalUsers, type UserSummary } from "../../api/users";
import ActiveFiltersBar from "../../components/ActiveFiltersBar";
import ListPageSection from "../../components/list/ListPageSection";
import PageHeader from "../../components/PageHeader";
import ToolbarSearchInput from "../../components/ToolbarSearchInput";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import Modal from "../../components/Modal";
import WorkflowPage, {
  WorkflowActions,
  WorkflowMetadata,
  WorkflowSection,
  workflowPageHostClass,
} from "../../components/WorkflowPage";
import WorkflowTabs from "../../components/WorkflowTabs";
import PageBanner from "../../components/PageBanner";
import DataTableShell, {
  dataTableDefaultActionProps,
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import StorageUsageCard from "../../components/StorageUsageCard";
import UiTagBadgeList from "../../components/UiTagBadgeList";
import UiTagEditor from "../../components/UiTagEditor";
import UiButton from "../../components/ui/UiButton";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import { cx, uiPanelMutedClass } from "../../components/ui/styles";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { useTagCatalog } from "../../hooks/useTagCatalog";
import { extractApiError } from "../../utils/apiError";
import { stableSignature } from "../../utils/stableSignature";
import { matchesExactTextCandidate, type TextMatchMode } from "../../utils/textMatch";
import { buildUiTagItems, extractUiTagLabels, normalizeUiTags, type UiTagDefinition } from "../../utils/uiTags";
import { isAdminLikeRole, readStoredUser } from "../../utils/workspaces";
import {
  AdminAssociationCheckboxOptions,
  AdminAssociationPickerPanel,
  AdminAssociationSectionHeader,
  adminAssociationTableClass as associationTableClass,
  adminAssociationTableActionCellClass,
  adminAssociationTableBodyClass,
  adminAssociationTableContainerClass as associationTableContainerClass,
  adminAssociationTableEmptyCellClass,
  adminAssociationTableHeaderClass,
  adminAssociationTableHeadClass,
  adminAssociationTableHeaderRightClass,
  adminAssociationTableLabelCellClass,
} from "./AdminAssociationPicker";
import AdminAssociationAdvancedSettings from "./AdminAssociationAdvancedSettings";
import { AdminAccessToggleSection } from "./AdminAccessSections";
import AdminQuotaFields from "./AdminQuotaFields";
import { buildAdminQuotaSizeEditorValue } from "./adminQuotaForm";
import { AssociationPrincipalStack, type AssociationPrincipalItem } from "./AssociationSummary";
import { useAdminS3UserStats } from "./useAdminS3UserStats";

type SortField = "name" | "uid";
type EditTab = "general" | "users" | "groups" | "privileged";

function getS3UserSearchCandidates(user: S3User): Array<string | number | null | undefined> {
  return [
    user.name,
    user.rgw_user_uid,
    user.email,
    ...(user.user_links ?? []).flatMap((link) => [
      link.user_email,
      link.user_full_name,
    ]),
    ...(user.group_links ?? []).map((link) => link.group_name),
    ...extractUiTagLabels(user.tags),
  ];
}

export default function S3UsersPage() {
  const [users, setUsers] = useState<S3User[]>([]);
  const [portalUsers, setPortalUsers] = useState<UserSummary[]>([]);
  const [portalUsersLoaded, setPortalUsersLoaded] = useState(false);
  const [uiGroups, setUiGroups] = useState<UiGroupSummary[]>([]);
  const [uiGroupsLoaded, setUiGroupsLoaded] = useState(false);
  const [uiGroupsLoading, setUiGroupsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalUsers, setTotalUsers] = useState(0);
  const [filter, setFilter] = useState("");
  const [quickFilterMode, setQuickFilterMode] = useState<TextMatchMode>("contains");
  const [sort, setSort] = useState<{ field: SortField; direction: "asc" | "desc" }>({
    field: "name",
    direction: "asc",
  });
  const MAX_LINK_OPTIONS = 10;
  const [storageEndpoints, setStorageEndpoints] = useState<StorageEndpoint[]>([]);
  const [loadingEndpoints, setLoadingEndpoints] = useState(false);
  const [endpointsLoaded, setEndpointsLoaded] = useState(false);
  const [endpointUsersWrite, setEndpointUsersWrite] = useState<Record<number, boolean>>({});
  const [endpointPermissionLoading, setEndpointPermissionLoading] = useState<Record<number, boolean>>({});
  const [endpointPermissionErrors, setEndpointPermissionErrors] = useState<Record<number, string | null>>({});

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "",
    uid: "",
    email: "",
    tags: [] as UiTagDefinition[],
    quota_max_size_gb: "",
    quota_max_size_unit: "GiB",
    quota_max_objects: "",
    storage_endpoint_id: "",
  });
  const [createInitialSignature, setCreateInitialSignature] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importEndpointId, setImportEndpointId] = useState("");
  const [importInitialSignature, setImportInitialSignature] = useState("");

  const [editingUser, setEditingUser] = useState<S3User | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    tags: [] as UiTagDefinition[],
    user_links: [] as S3UserUserLink[],
    group_links: [] as S3UserGroupLink[],
    quota_max_size_gb: "",
    quota_max_size_unit: "GiB",
    quota_max_objects: "",
    allow_bucket_quota_management: false,
    allow_access_key_management: false,
    allow_managed_private_connection_provisioning: false,
  });
  const [editInitialSignature, setEditInitialSignature] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editTab, setEditTab] = useState<EditTab>("general");
  const [portalUserSearch, setPortalUserSearch] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
  const [showEditPortalUserPanel, setShowEditPortalUserPanel] = useState(false);
  const [showEditGroupPanel, setShowEditGroupPanel] = useState(false);
  const [editPortalUserSelections, setEditPortalUserSelections] = useState<number[]>([]);
  const [editGroupSelections, setEditGroupSelections] = useState<number[]>([]);
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
  const toggleSort = (field: SortField) => {
    setSort((prev) => {
      if (prev.field === field) {
        return { field, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { field, direction: "desc" };
    });
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

  const [deleteBusyId, setDeleteBusyId] = useState<number | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const [userToDelete, setUserToDelete] = useState<S3User | null>(null);
  const [deleteFromRgw, setDeleteFromRgw] = useState(false);
  const [deleteModalError, setDeleteModalError] = useState<string | null>(null);
  const deleteModalHasResources =
    userToDelete != null && (userToDelete.bucket_count == null || userToDelete.bucket_count > 0);
  const editingUserId = editingUser?.id ?? null;
  const {
    stats: editingUsageStats,
    loading: editingUsageLoading,
    error: editingUsageError,
  } = useAdminS3UserStats(editingUserId, Boolean(editingUserId));
  const showEditGeneralTab = editTab === "general";
  const showEditUsersTab = editTab === "users";
  const showEditGroupsTab = editTab === "groups";
  const currentUser = useMemo(() => readStoredUser(), []);
  const canManagePrivilegedTargets = isAdminLikeRole(currentUser?.role);
  const showEditPrivilegedTab = canManagePrivilegedTargets && editTab === "privileged";
  const {
    catalog: adminTagCatalog,
    loading: adminTagCatalogLoading,
    error: adminTagCatalogError,
  } = useTagCatalog(
    { kind: "admin", domain: "admin_managed" },
    Boolean(showCreateModal || editingUser)
  );

  const extractError = (err: unknown) => extractApiError(err, "Unexpected error");

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const quick = filter.trim();
      if (quick && quickFilterMode === "exact") {
        const allMatches: S3User[] = [];
        let nextPage = 1;
        while (true) {
          const response = await listS3Users({
            page: nextPage,
            page_size: 200,
            search: quick,
            sort_by: sort.field,
            sort_dir: sort.direction,
            include_quota: false,
          });
          allMatches.push(...response.items);
          if (!response.has_next) break;
          nextPage += 1;
        }

        const exactMatches = allMatches.filter((user) => {
          return matchesExactTextCandidate(getS3UserSearchCandidates(user), quick);
        });
        const totalExact = exactMatches.length;
        const totalPages = Math.max(1, Math.ceil(totalExact / pageSize));
        if (totalExact > 0 && page > totalPages) {
          setPage(totalPages);
          return;
        }
        const start = (page - 1) * pageSize;
        setUsers(exactMatches.slice(start, start + pageSize));
        setTotalUsers(totalExact);
      } else {
        const response = await listS3Users({
          page,
          page_size: pageSize,
          search: quick || undefined,
          sort_by: sort.field,
          sort_dir: sort.direction,
          include_quota: false,
        });
        const totalPages = Math.max(1, Math.ceil((response.total || 0) / pageSize));
        if (response.total > 0 && page > totalPages) {
          setPage(totalPages);
          return;
        }
        setUsers(response.items);
        setTotalUsers(response.total);
      }
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  }, [filter, quickFilterMode, page, pageSize, sort.direction, sort.field]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const loadPortalUsersIfNeeded = useCallback(async () => {
    if (portalUsersLoaded) return;
    try {
      const data = await listMinimalUsers();
      setPortalUsers(data);
      setPortalUsersLoaded(true);
    } catch {
      setPortalUsers([]);
    }
  }, [portalUsersLoaded]);

  const loadGroupsIfNeeded = useCallback(async () => {
    if (uiGroupsLoaded || uiGroupsLoading) return;
    setUiGroupsLoading(true);
    try {
      const data = await listMinimalGroups();
      setUiGroups(data);
      setUiGroupsLoaded(true);
    } catch {
      setUiGroups([]);
    } finally {
      setUiGroupsLoading(false);
    }
  }, [uiGroupsLoaded, uiGroupsLoading]);

  const loadEndpointsIfNeeded = useCallback(async () => {
    if (endpointsLoaded || loadingEndpoints) return;
    setLoadingEndpoints(true);
    try {
      const data = await listStorageEndpoints();
      setStorageEndpoints(data);
      setEndpointsLoaded(true);
    } catch {
      setStorageEndpoints([]);
    } finally {
      setLoadingEndpoints(false);
    }
  }, [endpointsLoaded, loadingEndpoints]);

  const hasLinkedPortalUsers = useMemo(
    () => users.some((user) => (user.user_links?.length ?? 0) > 0),
    [users]
  );

  useEffect(() => {
    if (!hasLinkedPortalUsers) return;
    void loadPortalUsersIfNeeded();
  }, [hasLinkedPortalUsers, loadPortalUsersIfNeeded]);

  const fetchEndpointUsersWritePermission = useCallback(
    async (endpointId: number) => {
      if (!Number.isFinite(endpointId) || endpointId <= 0) return;
      if (endpointPermissionLoading[endpointId]) return;
      setEndpointPermissionLoading((prev) => ({ ...prev, [endpointId]: true }));
      try {
        const endpoint = await getStorageEndpoint(endpointId, { include_admin_ops_permissions: true });
        setEndpointUsersWrite((prev) => ({ ...prev, [endpointId]: Boolean(endpoint.admin_ops_permissions?.users_write) }));
        setEndpointPermissionErrors((prev) => ({ ...prev, [endpointId]: null }));
      } catch (err) {
        setEndpointUsersWrite((prev) => ({ ...prev, [endpointId]: false }));
        setEndpointPermissionErrors((prev) => ({ ...prev, [endpointId]: extractError(err) }));
      } finally {
        setEndpointPermissionLoading((prev) => ({ ...prev, [endpointId]: false }));
      }
    },
    [endpointPermissionLoading]
  );

  const portalUserOptions = useMemo(() => portalUsers.map((u) => ({ id: u.id, label: u.email })), [portalUsers]);
  const portalUserLabelById = useMemo(() => {
    const map = new Map<number, string>();
    portalUsers.forEach((u) => map.set(u.id, u.email));
    return map;
  }, [portalUsers]);
  const groupLabelById = useMemo(() => {
    const map = new Map<number, string>();
    uiGroups.forEach((group) => map.set(group.id, group.name));
    return map;
  }, [uiGroups]);
  const renderUserAssociations = (user: S3User) => {
    const userItems: AssociationPrincipalItem[] = (user.user_links ?? []).map((link) => {
      return {
        id: link.user_id,
        kind: "user",
        label: link.user_full_name || link.user_email || `User #${link.user_id}`,
        email: link.user_email,
        avatar: link.user_avatar,
      };
    });
    const groupItems: AssociationPrincipalItem[] = (user.group_links ?? []).map((link) => ({
      id: link.group_id,
      kind: "group" as const,
      label: link.group_name || `Group #${link.group_id}`,
      avatar: link.group_avatar,
    }));
    return <AssociationPrincipalStack items={[...userItems, ...groupItems]} />;
  };
  const availablePortalUsers = useMemo(() => {
    const query = portalUserSearch.trim().toLowerCase();
    return portalUserOptions.filter(
      (opt) => !editForm.user_links.some((link) => link.user_id === opt.id) && (!query || opt.label.toLowerCase().includes(query))
    );
  }, [portalUserOptions, editForm.user_links, portalUserSearch]);
  const availableGroups = useMemo(() => {
    const query = groupSearch.trim().toLowerCase();
    return uiGroups.filter(
      (group) => !editForm.group_links.some((link) => link.group_id === group.id) && (!query || group.name.toLowerCase().includes(query))
    );
  }, [editForm.group_links, groupSearch, uiGroups]);
  const visiblePortalUsers = useMemo(
    () => availablePortalUsers.slice(0, MAX_LINK_OPTIONS),
    [availablePortalUsers]
  );
  const visibleGroups = useMemo(
    () => availableGroups.slice(0, MAX_LINK_OPTIONS),
    [availableGroups]
  );
  const cephEndpoints = useMemo(() => storageEndpoints.filter((ep) => ep.provider === "ceph"), [storageEndpoints]);
  const adminCephEndpoints = useMemo(
    () => cephEndpoints.filter((ep) => Boolean(ep.capabilities?.admin)),
    [cephEndpoints]
  );
  const editingEndpointId = editingUser?.storage_endpoint_id ?? null;
  const allowUserQuotaUpdates = editingEndpointId ? endpointUsersWrite[editingEndpointId] === true : false;

  useEffect(() => {
    const defaultCeph =
      adminCephEndpoints.find((ep) => ep.is_default) || adminCephEndpoints[0];
    const firstCephId = defaultCeph ? String(defaultCeph.id) : "";
    setCreateForm((prev) => ({
      ...prev,
      storage_endpoint_id: adminCephEndpoints.some((endpoint) => String(endpoint.id) === prev.storage_endpoint_id)
        ? prev.storage_endpoint_id
        : firstCephId,
    }));
    setImportEndpointId((prev) =>
      adminCephEndpoints.some((endpoint) => String(endpoint.id) === prev) ? prev : firstCephId
    );
  }, [adminCephEndpoints]);

  useEffect(() => {
    if (!showCreateModal) return;
    if (!createForm.storage_endpoint_id) return;
    const endpointId = Number(createForm.storage_endpoint_id);
    if (!Number.isFinite(endpointId) || endpointId <= 0) return;
    if (Object.prototype.hasOwnProperty.call(endpointUsersWrite, endpointId)) return;
    void fetchEndpointUsersWritePermission(endpointId);
  }, [showCreateModal, createForm.storage_endpoint_id, endpointUsersWrite, fetchEndpointUsersWritePermission]);

  useEffect(() => {
    if (!showImportModal) return;
    if (!importEndpointId) return;
    const endpointId = Number(importEndpointId);
    if (!Number.isFinite(endpointId) || endpointId <= 0) return;
    if (Object.prototype.hasOwnProperty.call(endpointUsersWrite, endpointId)) return;
    void fetchEndpointUsersWritePermission(endpointId);
  }, [showImportModal, importEndpointId, endpointUsersWrite, fetchEndpointUsersWritePermission]);

  useEffect(() => {
    if (!editingEndpointId) return;
    if (Object.prototype.hasOwnProperty.call(endpointUsersWrite, editingEndpointId)) return;
    void fetchEndpointUsersWritePermission(editingEndpointId);
  }, [editingEndpointId, endpointUsersWrite, fetchEndpointUsersWritePermission]);

  const toggleEditPortalUserSelection = (userId: number) => {
    setEditPortalUserSelections((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };
  const toggleEditGroupSelection = (groupId: number) => {
    setEditGroupSelections((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  };

  const loadEditQuota = async (userId: number) => {
    try {
      const detail = await getS3User(userId, { include_quota: true });
      setEditingUser((prev) => (prev && prev.id === userId ? { ...prev, ...detail } : prev));
      setEditForm((prev) => {
        if (prev.quota_max_size_gb !== "" || prev.quota_max_objects !== "") {
          return prev;
        }
        const quota = buildAdminQuotaSizeEditorValue(detail.quota_max_size_gb);
        return {
          ...prev,
          quota_max_size_gb: quota.value,
          quota_max_size_unit: quota.unit,
          quota_max_objects: detail.quota_max_objects != null ? String(detail.quota_max_objects) : "",
        };
      });
    } catch {
      // Quota is optional for editing; ignore load failures.
    }
  };

  const openEditModal = (user: S3User) => {
    void loadPortalUsersIfNeeded();
    void loadGroupsIfNeeded();
    void loadEndpointsIfNeeded();
    const quota = buildAdminQuotaSizeEditorValue(user.quota_max_size_gb);
    const nextEditForm = {
      name: user.name,
      email: user.email ?? "",
      tags: normalizeUiTags(user.tags),
      user_links: (user.user_links ?? []).map((link) => ({
        ...link,
        allow_manager_browser_data_access: Boolean(link.allow_manager_browser_data_access),
      })),
      group_links: (user.group_links ?? []).map((link) => ({
        ...link,
        allow_manager_browser_data_access: Boolean(link.allow_manager_browser_data_access),
      })),
      quota_max_size_gb: quota.value,
      quota_max_size_unit: quota.unit,
      quota_max_objects: user.quota_max_objects != null ? String(user.quota_max_objects) : "",
      allow_bucket_quota_management: Boolean(user.allow_bucket_quota_management),
      allow_access_key_management: Boolean(user.allow_access_key_management),
      allow_managed_private_connection_provisioning: Boolean(
        user.allow_managed_private_connection_provisioning
      ),
    };
    setEditingUser(user);
    setEditForm(nextEditForm);
    setEditInitialSignature(stableSignature({ editForm: { ...nextEditForm, tags: normalizeUiTags(nextEditForm.tags) } }));
    setEditError(null);
    setEditTab("general");
    setPortalUserSearch("");
    setGroupSearch("");
    setShowEditPortalUserPanel(false);
    setShowEditGroupPanel(false);
    setEditPortalUserSelections([]);
    setEditGroupSelections([]);
    if (user.quota_max_size_gb == null && user.quota_max_objects == null) {
      void loadEditQuota(user.id);
    }
  };

  const submitEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setEditBusy(true);
    setEditError(null);
    try {
      const payload: UpdateS3UserPayload = {
        name: editForm.name || undefined,
        email: editForm.email || undefined,
        tags: normalizeUiTags(editForm.tags),
        user_links: editForm.user_links,
        group_links: editForm.group_links,
      };
      if (canManagePrivilegedTargets) {
        payload.allow_bucket_quota_management = editForm.allow_bucket_quota_management;
        payload.allow_access_key_management = editForm.allow_access_key_management;
        payload.allow_managed_private_connection_provisioning =
          editForm.allow_managed_private_connection_provisioning;
      }
      if (allowUserQuotaUpdates) {
        payload.quota_max_size_gb = editForm.quota_max_size_gb !== "" ? Number(editForm.quota_max_size_gb) : null;
        payload.quota_max_size_unit = editForm.quota_max_size_gb !== "" ? editForm.quota_max_size_unit : null;
        payload.quota_max_objects = editForm.quota_max_objects !== "" ? Number(editForm.quota_max_objects) : null;
      }
      await updateS3User(editingUser.id, payload);
      await fetchUsers();
      closeEditModal();
      setActionMessage("User updated.");
    } catch (err) {
      setEditError(extractError(err));
    } finally {
      setEditBusy(false);
    }
  };

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!createForm.name.trim()) {
      setCreateError("Name is required");
      return;
    }
    if (!createForm.storage_endpoint_id) {
      setCreateError("Select a Ceph endpoint.");
      return;
    }
    if (createPermissionLoading) {
      setCreateError("Checking endpoint permissions. Please wait.");
      return;
    }
    if (!createEndpointCanWrite) {
      setCreateError("Selected endpoint does not allow this operation (missing users=write).");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await createS3User({
        name: createForm.name.trim(),
        uid: createForm.uid.trim() || undefined,
        email: createForm.email.trim() || undefined,
        tags: normalizeUiTags(createForm.tags),
        quota_max_size_gb: createForm.quota_max_size_gb ? Number(createForm.quota_max_size_gb) : undefined,
        quota_max_size_unit: createForm.quota_max_size_gb ? createForm.quota_max_size_unit : undefined,
        quota_max_objects: createForm.quota_max_objects ? Number(createForm.quota_max_objects) : undefined,
        storage_endpoint_id: Number(createForm.storage_endpoint_id),
      });
      setShowCreateModal(false);
      setCreateForm((prev) => ({
        ...prev,
        name: "",
        uid: "",
        email: "",
        tags: [],
        quota_max_size_gb: "",
        quota_max_objects: "",
      }));
      setActionMessage("User created.");
      await fetchUsers();
    } catch (err) {
      setCreateError(extractError(err));
    } finally {
      setCreating(false);
    }
  };

  const submitImport = async () => {
    const entries = importText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (entries.length === 0) {
      setImportError("Enter at least one uid.");
      setImportMessage(null);
      return;
    }
    if (!importEndpointId) {
      setImportError("Select a Ceph endpoint.");
      setImportMessage(null);
      return;
    }
    if (importPermissionLoading) {
      setImportError("Checking endpoint permissions. Please wait.");
      setImportMessage(null);
      return;
    }
    if (!importEndpointCanWrite) {
      setImportError("Selected endpoint does not allow this operation (missing users=write).");
      setImportMessage(null);
      return;
    }
    try {
      setImportBusy(true);
      setImportError(null);
      setImportMessage(null);
      const payload = entries.map((line) => {
        const uid = (line.includes("/") ? line.split("/", 2)[1] : line).trim();
        if (!uid) {
          throw new Error(`Invalid entry "${line}" (missing uid).`);
        }
        return { uid, storage_endpoint_id: Number(importEndpointId) };
      });
      await importS3Users(payload);
      setImportMessage("Users imported.");
      setImportText("");
      setImportInitialSignature(stableSignature({ importText: "", importEndpointId }));
      await fetchUsers();
    } catch (err) {
      setImportError(extractError(err));
    } finally {
      setImportBusy(false);
    }
  };

  const startDeleteUser = async (user: S3User) => {
    setDeleteModalError(null);
    setActionMessage(null);
    try {
      const detail = await getS3UserWithBuckets(user.id);
      setUserToDelete(detail);
      setDeleteFromRgw(false);
    } catch (err) {
      setUserToDelete(user);
      setDeleteFromRgw(false);
      setDeleteModalError(extractError(err));
    }
  };

  const closeDeleteModal = () => {
    if (deleteModalBusy) {
      return;
    }
    setUserToDelete(null);
    setDeleteFromRgw(false);
    setDeleteModalError(null);
  };

  const deleteModalBusy = userToDelete ? deleteBusyId === userToDelete.id : false;
  const selectedCreateEndpointId = createForm.storage_endpoint_id ? Number(createForm.storage_endpoint_id) : null;
  const selectedImportEndpointId = importEndpointId ? Number(importEndpointId) : null;
  const createPermissionLoading = selectedCreateEndpointId ? Boolean(endpointPermissionLoading[selectedCreateEndpointId]) : false;
  const importPermissionLoading = selectedImportEndpointId ? Boolean(endpointPermissionLoading[selectedImportEndpointId]) : false;
  const createEndpointCanWrite = selectedCreateEndpointId ? endpointUsersWrite[selectedCreateEndpointId] === true : false;
  const importEndpointCanWrite = selectedImportEndpointId ? endpointUsersWrite[selectedImportEndpointId] === true : false;
  const createPermissionError = selectedCreateEndpointId ? endpointPermissionErrors[selectedCreateEndpointId] ?? null : null;
  const importPermissionError = selectedImportEndpointId ? endpointPermissionErrors[selectedImportEndpointId] ?? null : null;
  const createCurrentSignature = useMemo(
    () => stableSignature({ createForm: { ...createForm, tags: normalizeUiTags(createForm.tags) } }),
    [createForm]
  );
  const createCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: Boolean(createInitialSignature) && createCurrentSignature !== createInitialSignature,
    disabled: creating,
    onClose: () => setShowCreateModal(false),
  });
  const importCurrentSignature = useMemo(
    () => stableSignature({ importText, importEndpointId }),
    [importEndpointId, importText]
  );
  const importCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: Boolean(importInitialSignature) && importCurrentSignature !== importInitialSignature,
    disabled: importBusy,
    onClose: () => setShowImportModal(false),
  });
  const closeEditModal = () => {
    setEditingUser(null);
    setEditTab("general");
    setPortalUserSearch("");
    setGroupSearch("");
    setShowEditPortalUserPanel(false);
    setShowEditGroupPanel(false);
    setEditPortalUserSelections([]);
    setEditGroupSelections([]);
    setEditInitialSignature("");
  };
  const editCurrentSignature = useMemo(
    () => stableSignature({ editForm: { ...editForm, tags: normalizeUiTags(editForm.tags) } }),
    [editForm]
  );
  const editCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: Boolean(editingUser && editInitialSignature && editCurrentSignature !== editInitialSignature),
    disabled: editBusy,
    onClose: closeEditModal,
  });
  const userTableColumns: Array<DataTableColumn<S3User, SortField>> = [
    {
      id: "name",
      label: "Name",
      field: "name",
      primary: true,
      cellClassName: "min-w-[240px] max-w-[360px]",
      render: (user) => {
        const tagItems = buildUiTagItems(user.tags);
        return (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 flex-1 truncate">{user.name}</span>
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
      id: "uid",
      label: "UID",
      field: "uid",
      cellClassName: "min-w-[176px]",
      render: (user) => user.rgw_user_uid,
    },
    {
      id: "endpoint",
      label: "Endpoint",
      cellClassName: "min-w-[160px]",
      render: (user) => (
        <span title={user.storage_endpoint_url || undefined}>
          {user.storage_endpoint_name}
        </span>
      ),
    },
    {
      id: "associations",
      label: "UI Users / Groups",
      cellClassName: "min-w-[180px] max-w-[240px] align-middle",
      render: renderUserAssociations,
    },
    {
      id: "actions",
      label: "Actions",
      align: "right",
      mobileRole: "actions",
      cellClassName: "min-w-[176px]",
      render: (user) => {
        const deleteBusy = deleteBusyId === user.id;
        return (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => openEditModal(user)}
              className={tableActionButtonClasses}
              {...dataTableDefaultActionProps}
            >
              Edit
            </button>
            <Link to={`/admin/s3-users/${user.id}/keys`} className={tableActionButtonClasses}>
              Keys
            </Link>
            <button type="button" onClick={() => startDeleteUser(user)} className={tableDeleteActionClasses} disabled={deleteBusy}>
              {deleteBusy ? "Deleting..." : "Delete"}
            </button>
          </div>
        );
      },
    },
  ];
  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: users.length,
  });

  const confirmDeleteUser = async () => {
    if (!userToDelete) return;
    setDeleteBusyId(userToDelete.id);
    setDeleteModalError(null);
    setActionMessage(null);
    try {
      await deleteS3User(userToDelete.id, { deleteRgw: deleteFromRgw });
      await fetchUsers();
      setActionMessage(`Deleted ${userToDelete.name}.`);
      setUserToDelete(null);
      setDeleteFromRgw(false);
    } catch (err) {
      setDeleteModalError(extractError(err));
    } finally {
      setDeleteBusyId(null);
    }
  };

  return (
    <div className={workflowPageHostClass(showImportModal || Boolean(editingUser))}>
      <PageHeader
        title="RGW Users"
        description="Manage standalone RGW users for direct access to Manager."
        breadcrumbs={adminPageBreadcrumbs("rgw-users")}
        actions={[
          {
            label: "Import",
            onClick: () => {
              setImportInitialSignature(stableSignature({ importText, importEndpointId }));
              setShowImportModal(true);
              void loadEndpointsIfNeeded();
            },
            variant: "ghost",
          },
          {
            label: "Create user",
            onClick: () => {
              setCreateInitialSignature(stableSignature({ createForm: { ...createForm, tags: normalizeUiTags(createForm.tags) } }));
              setShowCreateModal(true);
              void loadEndpointsIfNeeded();
            },
          },
        ]}
      />

      {error && <PageBanner tone="error">{error}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}

      <ListPageSection
          title="RGW Users"
          description="Search matches all records."
          countLabel={`${totalUsers} entr${totalUsers === 1 ? "y" : "ies"}`}
          search={
            <ToolbarSearchInput
              value={filter}
              onChange={handleFilterChange}
              placeholder="Search by name, UID, email, group, or tag"
              className="w-full sm:w-64"
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
          columns={userTableColumns}
          rows={users}
          rowKey={(user) => user.id}
          status={tableStatus}
          loadingMessage="Loading users..."
          errorMessage="Unable to load users."
          emptyMessage="No users."
          sort={{ field: sort.field, direction: sort.direction, onSort: toggleSort }}
          primaryColumnId="name"
          responsiveCards
          tableClassName="compact-table"
          pagination={{
            page,
            pageSize,
            total: totalUsers,
            onPageChange: handlePageChange,
            onPageSizeChange: handlePageSizeChange,
            disabled: loading,
          }}
        />
      </ListPageSection>

      {showCreateModal && (
        <Modal title="Create user" onClose={createCloseGuard.requestClose}>
          {createError && (
            <UiInlineMessage tone="error" className="mb-3">
              {createError}
            </UiInlineMessage>
          )}
          <form onSubmit={submitCreate} className="space-y-4">
            <WorkflowSection
              title="User details"
              description="Define the RGW identity, endpoint, contact, and administrative tags."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <UiInput
                  label="Display name *"
                  value={createForm.name}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))}
                  required
                />
                <UiInput
                  label="UID (optional)"
                  value={createForm.uid}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, uid: e.target.value }))}
                  placeholder="user-123"
                />
                <UiSelect
                  label="Ceph endpoint *"
                  value={createForm.storage_endpoint_id}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, storage_endpoint_id: e.target.value }))}
                  disabled={loadingEndpoints || adminCephEndpoints.length === 0}
                  required
                >
                  <option value="" disabled>
                    {loadingEndpoints
                      ? "Loading..."
                      : adminCephEndpoints.length === 0
                        ? "No Ceph endpoint with admin enabled"
                        : "Select"}
                  </option>
                  {adminCephEndpoints.map((ep) => (
                    <option key={ep.id} value={ep.id}>
                      {ep.name} {ep.is_default ? "(default)" : ""}
                    </option>
                  ))}
                </UiSelect>
                <UiInput
                  label="Email"
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="user@example.com"
                />
                {createForm.storage_endpoint_id && (
                  <div className="flex flex-col gap-1 md:col-span-2">
                    {createPermissionLoading ? (
                      <PageBanner tone="info">Checking endpoint permissions...</PageBanner>
                    ) : createPermissionError ? (
                      <PageBanner tone="warning">
                        {createPermissionError}. Validation is disabled until permissions can be verified.
                      </PageBanner>
                    ) : !createEndpointCanWrite ? (
                      <PageBanner tone="warning">
                        Selected endpoint does not allow this operation: missing <code>users=write</code>.
                      </PageBanner>
                    ) : null}
                  </div>
                )}
                <div className="md:col-span-2">
                  {adminTagCatalogError && <PageBanner tone="warning">{adminTagCatalogError}</PageBanner>}
                  <UiTagEditor
                    label="Tags"
                    tags={createForm.tags}
                    catalog={adminTagCatalog}
                    onChange={(tags) => setCreateForm((prev) => ({ ...prev, tags }))}
                    placeholder="Add a tag for this RGW user"
                    hint={adminTagCatalogLoading ? "Loading existing tag catalog..." : undefined}
                  />
                </div>
              </div>
            </WorkflowSection>
            <AdminQuotaFields
              storageValue={createForm.quota_max_size_gb}
              storageUnit={createForm.quota_max_size_unit}
              objectValue={createForm.quota_max_objects}
              disabled={false}
              onStorageValueChange={(value) =>
                setCreateForm((prev) => ({ ...prev, quota_max_size_gb: value }))
              }
              onStorageUnitChange={(value) =>
                setCreateForm((prev) => ({ ...prev, quota_max_size_unit: value }))
              }
              onObjectValueChange={(value) =>
                setCreateForm((prev) => ({ ...prev, quota_max_objects: value }))
              }
            />
            <WorkflowActions>
              <UiButton variant="secondary" onClick={createCloseGuard.requestClose}>
                Cancel
              </UiButton>
              <UiButton
                type="submit"
                disabled={creating || createPermissionLoading || !createEndpointCanWrite}
              >
                {creating ? "Creating..." : "Create user"}
              </UiButton>
            </WorkflowActions>
            {createCloseGuard.confirmationDialog}
          </form>
        </Modal>
      )}

      {showImportModal && (
        <WorkflowPage
          title="Import RGW users"
          description="Import multiple RGW users, validate endpoint access, and review generated keys."
          breadcrumbs={adminPageBreadcrumbs("rgw-users", { label: "Import" })}
          backLabel="Back to RGW users"
          onBack={importCloseGuard.requestClose}
          width="standard"
        >
          <p className="mb-3 ui-body text-slate-500">Enter RGW user IDs, one per line. The platform will fetch or generate keys.</p>
          {importError && (
            <UiInlineMessage tone="error" className="mb-3">
              {importError}
            </UiInlineMessage>
          )}
          {importMessage && (
            <UiInlineMessage tone="success" className="mb-3">
              {importMessage}
            </UiInlineMessage>
          )}
          <textarea
            className="ui-control min-h-32"
            rows={6}
            placeholder="user-alpha"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          <UiSelect
            label="Ceph endpoint *"
            fieldClassName="mt-3"
            value={importEndpointId}
            onChange={(e) => setImportEndpointId(e.target.value)}
            disabled={loadingEndpoints || adminCephEndpoints.length === 0}
            required
          >
            <option value="" disabled>
              {loadingEndpoints
                ? "Loading..."
                : adminCephEndpoints.length === 0
                  ? "No Ceph endpoint with admin enabled"
                  : "Select"}
            </option>
            {adminCephEndpoints.map((ep) => (
              <option key={ep.id} value={ep.id}>
                {ep.name} {ep.is_default ? "(default)" : ""}
              </option>
            ))}
          </UiSelect>
          {importEndpointId && (
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
                  Selected endpoint does not allow this operation: missing <code>users=write</code>.
                </PageBanner>
              ) : null}
            </>
          )}
          <div className="mt-4 flex items-center justify-end gap-3">
            <UiButton variant="secondary" onClick={importCloseGuard.requestClose}>
              Cancel
            </UiButton>
            <UiButton
              disabled={importBusy || importPermissionLoading || !importEndpointCanWrite || !importText.trim() || !importEndpointId}
              onClick={submitImport}
            >
              {importBusy ? "Importing..." : "Import"}
            </UiButton>
          </div>
          {importCloseGuard.confirmationDialog}
        </WorkflowPage>
      )}

      {editingUser && (
        <WorkflowPage
          title={`Edit ${editingUser.name}`}
          description="Manage quotas, UI associations, and privileged access for this RGW user."
          breadcrumbs={adminPageBreadcrumbs("rgw-users", { label: "Edit" })}
          backLabel="Back to RGW users"
          onBack={editCloseGuard.requestClose}
          contentVariant="plain"
          width="wide"
          metaContent={
            <WorkflowMetadata
              items={[
                {
                  label: "UID",
                  value: editingUser.rgw_user_uid,
                },
                {
                  label: "Endpoint",
                  value: editingUser.storage_endpoint_name,
                  title: editingUser.storage_endpoint_url,
                },
              ]}
            />
          }
        >
          {editError && (
            <UiInlineMessage tone="error" className="mb-3">
              {editError}
            </UiInlineMessage>
          )}
          <form onSubmit={submitEdit} className="space-y-4">
            <WorkflowTabs<EditTab>
              activeTab={editTab}
              onTabChange={(tab) => {
                if (tab === "users") {
                  void loadPortalUsersIfNeeded();
                }
                if (tab === "groups") {
                  void loadGroupsIfNeeded();
                }
                setEditTab(tab);
              }}
              ariaLabel="RGW user configuration sections"
              idPrefix="admin-rgw-user-edit"
              tabs={[
                { id: "general", label: "General" },
                { id: "users", label: "Linked UI users" },
                { id: "groups", label: "Linked UI groups" },
                { id: "privileged", label: "Privileged access", visible: canManagePrivilegedTargets },
              ]}
            >

            {showEditGeneralTab && (
              <>
                <WorkflowSection
                  title="User details"
                  description="Update the display information and administrative tags for this RGW user."
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <UiInput
                      label="Display name"
                      value={editForm.name}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                    />
                    <UiInput
                      label="Email"
                      type="email"
                      value={editForm.email}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))}
                    />
                    <div className="md:col-span-2">
                      {adminTagCatalogError && <PageBanner tone="warning">{adminTagCatalogError}</PageBanner>}
                      <UiTagEditor
                        label="Tags"
                        tags={editForm.tags}
                        catalog={adminTagCatalog}
                        onChange={(tags) => setEditForm((prev) => ({ ...prev, tags }))}
                        placeholder="Add a tag for this RGW user"
                        hint={adminTagCatalogLoading ? "Loading existing tag catalog..." : undefined}
                      />
                    </div>
                  </div>
                </WorkflowSection>
                <StorageUsageCard
                  accountName={editingUser.name}
                  storage={{
                    used: editingUsageStats?.total_bytes ?? null,
                    quotaBytes:
                      editingUser.quota_max_size_gb != null ? editingUser.quota_max_size_gb * 1024 ** 3 : null,
                  }}
                  objects={{
                    used: editingUsageStats?.total_objects ?? null,
                    quota: editingUser.quota_max_objects ?? null,
                  }}
                  bucketOverview={editingUsageStats?.bucket_overview}
                  loading={editingUsageLoading}
                  metricsDisabled={false}
                  errorMessage={editingUsageError}
                />
                <AdminQuotaFields
                  storageValue={editForm.quota_max_size_gb}
                  storageUnit={editForm.quota_max_size_unit}
                  objectValue={editForm.quota_max_objects}
                  disabled={!allowUserQuotaUpdates}
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

            {showEditUsersTab && (
              <div className={cx("space-y-3 px-3 py-2", uiPanelMutedClass)}>
                <AdminAssociationSectionHeader
                  title="Linked UI users"
                  countLabel={`${editForm.user_links.length} linked`}
                  actionLabel={showEditPortalUserPanel ? "Close" : "Add UI users"}
                  onAction={() => setShowEditPortalUserPanel((prev) => !prev)}
                />
                <div className={associationTableContainerClass}>
                  <table className={associationTableClass}>
                    <thead className={adminAssociationTableHeadClass}>
                      <tr>
                        <th className={adminAssociationTableHeaderClass}>
                          User
                        </th>
                        <th className={adminAssociationTableHeaderRightClass}>
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className={adminAssociationTableBodyClass}>
                      {editForm.user_links.length === 0 ? (
                        <tr>
                          <td colSpan={2} className={adminAssociationTableEmptyCellClass}>
                            No linked users yet.
                          </td>
                        </tr>
                      ) : (
                        editForm.user_links.map((link) => (
                          <tr key={link.user_id}>
                            <td className={adminAssociationTableLabelCellClass}>
                              {portalUserLabelById.get(link.user_id) ?? `User #${link.user_id}`}
                            </td>
                            <td className={adminAssociationTableActionCellClass}>
                              <AdminAssociationAdvancedSettings
                                targetLabel={portalUserLabelById.get(link.user_id) ?? `User #${link.user_id}`}
                                associationKind="rgw_user"
                                allowManagerBrowserDataAccess={Boolean(link.allow_manager_browser_data_access)}
                                onApply={(allowed) =>
                                  setEditForm((prev) => ({
                                    ...prev,
                                    user_links: prev.user_links.map((item) =>
                                      item.user_id === link.user_id
                                        ? { ...item, allow_manager_browser_data_access: allowed }
                                        : item
                                    ),
                                  }))
                                }
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setEditForm((prev) => ({
                                    ...prev,
                                    user_links: prev.user_links.filter((item) => item.user_id !== link.user_id),
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
                {showEditPortalUserPanel && (
                  <AdminAssociationPickerPanel
                    title="Add UI users"
                    hint="(filter by email)"
                    search={portalUserSearch}
                    onSearchChange={setPortalUserSearch}
                    searchAriaLabel="Search UI users"
                    loading={false}
                    availableCount={availablePortalUsers.length}
                    maxVisibleOptions={MAX_LINK_OPTIONS}
                    selectedCount={editPortalUserSelections.length}
                    loadingLabel="Loading UI users..."
                    onCancel={() => {
                      setShowEditPortalUserPanel(false);
                      setEditPortalUserSelections([]);
                      setPortalUserSearch("");
                    }}
                    onAdd={() => {
                      if (editPortalUserSelections.length === 0) return;
                      setEditForm((prev) => ({
                        ...prev,
                        user_links: [
                          ...prev.user_links,
                          ...editPortalUserSelections.map((userId) => ({
                            user_id: userId,
                            allow_manager_browser_data_access: false,
                          })),
                        ],
                      }));
                      setEditPortalUserSelections([]);
                      setPortalUserSearch("");
                      setShowEditPortalUserPanel(false);
                    }}
                    addDisabled={editPortalUserSelections.length === 0}
                  >
                    <AdminAssociationCheckboxOptions
                      options={visiblePortalUsers}
                      selectedIds={editPortalUserSelections}
                      onToggle={toggleEditPortalUserSelection}
                      getLabel={(option) => option.label}
                    />
                  </AdminAssociationPickerPanel>
                )}
              </div>
            )}

            {showEditGroupsTab && (
              <div className={cx("space-y-3 px-3 py-2", uiPanelMutedClass)}>
                <AdminAssociationSectionHeader
                  title="Linked UI groups"
                  countLabel={`${editForm.group_links.length} linked${uiGroupsLoading ? " · loading..." : ""}`}
                  actionLabel={showEditGroupPanel ? "Close" : "Add UI groups"}
                  onAction={() => {
                    if (!showEditGroupPanel) {
                      void loadGroupsIfNeeded();
                    }
                    setShowEditGroupPanel((prev) => !prev);
                  }}
                />
                <div className={associationTableContainerClass}>
                  <table className={associationTableClass}>
                    <thead className={adminAssociationTableHeadClass}>
                      <tr>
                        <th className={adminAssociationTableHeaderClass}>
                          Group
                        </th>
                        <th className={adminAssociationTableHeaderRightClass}>
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className={adminAssociationTableBodyClass}>
                      {editForm.group_links.length === 0 ? (
                        <tr>
                          <td colSpan={2} className={adminAssociationTableEmptyCellClass}>
                            No linked groups yet.
                          </td>
                        </tr>
                      ) : (
                        editForm.group_links.map((link) => (
                          <tr key={link.group_id}>
                            <td className={adminAssociationTableLabelCellClass}>
                              {groupLabelById.get(link.group_id) ?? `Group #${link.group_id}`}
                            </td>
                            <td className={adminAssociationTableActionCellClass}>
                              <AdminAssociationAdvancedSettings
                                targetLabel={groupLabelById.get(link.group_id) ?? `Group #${link.group_id}`}
                                associationKind="rgw_user"
                                allowManagerBrowserDataAccess={Boolean(link.allow_manager_browser_data_access)}
                                onApply={(allowed) =>
                                  setEditForm((prev) => ({
                                    ...prev,
                                    group_links: prev.group_links.map((item) =>
                                      item.group_id === link.group_id
                                        ? { ...item, allow_manager_browser_data_access: allowed }
                                        : item
                                    ),
                                  }))
                                }
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setEditForm((prev) => ({
                                    ...prev,
                                    group_links: prev.group_links.filter((item) => item.group_id !== link.group_id),
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
                {showEditGroupPanel && (
                  <AdminAssociationPickerPanel
                    title="Add UI groups"
                    hint="(filter by name)"
                    search={groupSearch}
                    onSearchChange={setGroupSearch}
                    searchAriaLabel="Search UI groups"
                    loading={uiGroupsLoading}
                    availableCount={availableGroups.length}
                    maxVisibleOptions={MAX_LINK_OPTIONS}
                    selectedCount={editGroupSelections.length}
                    loadingLabel="Loading UI groups..."
                    onCancel={() => {
                      setShowEditGroupPanel(false);
                      setEditGroupSelections([]);
                      setGroupSearch("");
                    }}
                    onAdd={() => {
                      if (editGroupSelections.length === 0) return;
                      setEditForm((prev) => ({
                        ...prev,
                        group_links: [
                          ...prev.group_links,
                          ...editGroupSelections.map((groupId) => ({
                            group_id: groupId,
                            allow_manager_browser_data_access: false,
                          })),
                        ],
                      }));
                      setEditGroupSelections([]);
                      setGroupSearch("");
                      setShowEditGroupPanel(false);
                    }}
                    addDisabled={editGroupSelections.length === 0}
                  >
                    <AdminAssociationCheckboxOptions
                      options={visibleGroups}
                      selectedIds={editGroupSelections}
                      onToggle={toggleEditGroupSelection}
                      getLabel={(group) => group.name}
                    />
                  </AdminAssociationPickerPanel>
                )}
              </div>
            )}

            {showEditPrivilegedTab && (
              <AdminAccessToggleSection
                title="Privileged Ceph access"
                description="Ceph admin-API actions granted directly to this RGW user outside the Ceph Admin workspace."
                items={[
                  {
                    title: "Bucket quota management",
                    description: "Allow Ceph bucket quota updates for this RGW User in Manager.",
                    ariaLabel: "Bucket quota management",
                    checked: editForm.allow_bucket_quota_management,
                    onChange: (checked) =>
                      setEditForm((prev) => ({
                        ...prev,
                        allow_bucket_quota_management: checked,
                      })),
                  },
                  {
                    title: "Ceph S3 User keys",
                    description: "Allow access to Manager > Ceph > Access keys.",
                    ariaLabel: "Ceph S3 User keys",
                    checked: editForm.allow_access_key_management,
                    onChange: (checked) =>
                      setEditForm((prev) => ({
                        ...prev,
                        allow_access_key_management: checked,
                      })),
                  },
                  {
                    title: "Managed private connection provisioning",
                    description: "Allow Manager to provision a dedicated private Browser connection for this RGW User.",
                    ariaLabel: "Managed private connection provisioning",
                    checked: editForm.allow_managed_private_connection_provisioning,
                    onChange: (checked) =>
                      setEditForm((prev) => ({
                        ...prev,
                        allow_managed_private_connection_provisioning: checked,
                      })),
                  },
                ]}
              />
            )}
            </WorkflowTabs>

            <WorkflowActions>
              <UiButton variant="secondary" onClick={editCloseGuard.requestClose}>
                Cancel
              </UiButton>
              <UiButton
                type="submit"
                disabled={editBusy}
              >
                {editBusy ? "Saving..." : "Save changes"}
              </UiButton>
            </WorkflowActions>
            {editCloseGuard.confirmationDialog}
          </form>
        </WorkflowPage>
      )}

      {userToDelete && (
        <Modal title={`Delete ${userToDelete.name}`} onClose={closeDeleteModal}>
          <div className="space-y-3 ui-body text-slate-600 dark:text-slate-300">
            <p>
              This removes the standalone RGW user from the UI and deletes the access key used by this interface. You can also delete the underlying RGW user once it no longer owns buckets.
            </p>
            {deleteModalHasResources && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 ui-body text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/50 dark:text-amber-100">
                This RGW user still has linked resources. Remove owned buckets before deleting it from RGW.
                <div className="mt-1 ui-caption font-semibold">Buckets: {userToDelete.bucket_count ?? "unknown"}</div>
              </div>
            )}
            <label
              className={`flex items-start gap-3 rounded-lg border px-3 py-2 ui-body ${
                deleteModalHasResources
                  ? "border-slate-200 text-slate-400 dark:border-slate-700 dark:text-slate-500"
                  : "border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-100"
              }`}
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={deleteFromRgw}
                onChange={(e) => setDeleteFromRgw(e.target.checked)}
                disabled={deleteModalBusy || deleteModalHasResources}
              />
              <span>
                Also delete RGW user{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 ui-caption dark:bg-slate-800">{userToDelete.rgw_user_uid}</code>
              </span>
            </label>
            {deleteModalError && (
              <UiInlineMessage tone="error">
                {deleteModalError}
              </UiInlineMessage>
            )}
          </div>
          <div className="mt-5 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={closeDeleteModal}
              disabled={deleteModalBusy}
              className="rounded-md border border-slate-200 px-4 py-2 ui-body font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDeleteUser}
              disabled={deleteModalBusy}
              className="rounded-md bg-rose-600 px-4 py-2 ui-body font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:opacity-60"
            >
              {deleteModalBusy ? "Deleting..." : "Delete user"}
            </button>
          </div>
        </Modal>
      )}

    </div>
  );
}
