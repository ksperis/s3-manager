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
} from "../../api/s3Users";
import { listMinimalGroups, type UiGroupSummary } from "../../api/groups";
import { getStorageEndpoint, listStorageEndpoints, StorageEndpoint } from "../../api/storageEndpoints";
import { listMinimalUsers, UserSummary } from "../../api/users";
import ListToolbar from "../../components/ListToolbar";
import PageHeader from "../../components/PageHeader";
import { adminBreadcrumbs } from "./adminBreadcrumbs";
import Modal from "../../components/Modal";
import PageBanner from "../../components/PageBanner";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import StorageUsageCard from "../../components/StorageUsageCard";
import UiTagBadgeList from "../../components/UiTagBadgeList";
import UiTagEditor from "../../components/UiTagEditor";
import UiButton from "../../components/ui/UiButton";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import { cx, uiPanelMutedClass } from "../../components/ui/styles";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { toolbarCompactInputClasses } from "../../components/toolbarControlClasses";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { useTagCatalog } from "../../hooks/useTagCatalog";
import { extractApiError } from "../../utils/apiError";
import { stableSignature } from "../../utils/stableSignature";
import { buildUiTagItems, extractUiTagLabels, normalizeUiTags, type UiTagDefinition } from "../../utils/uiTags";
import { isAdminLikeRole, readStoredUser } from "../../utils/workspaces";
import AdminModalTabs from "./AdminModalTabs";
import {
  AdminAssociationPickerPanel,
  AdminAssociationSectionHeader,
  adminAssociationCheckboxClass,
  adminAssociationOptionLabelClass,
  adminAssociationOptionRowClass,
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
import AssociationSummary, { AssociationChips, type AssociationChipItem } from "./AssociationSummary";
import { useAdminS3UserStats } from "./useAdminS3UserStats";

type TextMatchMode = "contains" | "exact";
type SortField = "name" | "uid";
type EditTab = "general" | "users" | "groups" | "privileged";

export default function S3UsersPage() {
  const resolveQuotaForEdit = (quotaGb?: number | null) => {
    if (quotaGb == null) {
      return { value: "", unit: "GiB" as const };
    }
    if (quotaGb > 0 && quotaGb < 1) {
      return { value: String(Math.round(quotaGb * 1024)), unit: "MiB" as const };
    }
    return { value: String(quotaGb), unit: "GiB" as const };
  };

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
    user_ids: [] as number[],
    group_ids: [] as number[],
    quota_max_size_gb: "",
    quota_max_size_unit: "GiB",
    quota_max_objects: "",
    storage_endpoint_id: "",
    allow_manager_bucket_quota: false,
    allow_manager_ceph_s3_user_keys: false,
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

        const needle = quick.toLowerCase();
        const exactMatches = allMatches.filter((user) => {
          const candidates = [user.name, user.rgw_user_uid, user.email ?? "", ...extractUiTagLabels(user.tags)];
          return candidates.some((candidate) => candidate.trim().toLowerCase() === needle);
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
    () => users.some((user) => (user.user_ids?.length ?? 0) > 0),
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
    const userItems: AssociationChipItem[] = (user.user_ids ?? []).map((id) => ({
      id,
      label: portalUserLabelById.get(id) ?? `User #${id}`,
    }));
    const groupItems: AssociationChipItem[] = (user.group_details && user.group_details.length > 0
      ? user.group_details.map((group) => ({ id: group.id, label: group.name }))
      : (user.group_ids ?? []).map((id) => ({ id, label: `Group #${id}` })));
    if (userItems.length === 0 && groupItems.length === 0) {
      return <span className="ui-caption text-slate-400">None</span>;
    }
    return (
      <AssociationSummary
        sections={[
          { label: "Users", value: <AssociationChips items={userItems} />, visible: userItems.length > 0 },
          { label: "Groups", value: <AssociationChips items={groupItems} />, visible: groupItems.length > 0 },
        ]}
      />
    );
  };
  const availablePortalUsers = useMemo(() => {
    const query = portalUserSearch.trim().toLowerCase();
    return portalUserOptions.filter(
      (opt) => !editForm.user_ids.includes(opt.id) && (!query || opt.label.toLowerCase().includes(query))
    );
  }, [portalUserOptions, editForm.user_ids, portalUserSearch]);
  const availableGroups = useMemo(() => {
    const query = groupSearch.trim().toLowerCase();
    return uiGroups.filter(
      (group) => !editForm.group_ids.includes(group.id) && (!query || group.name.toLowerCase().includes(query))
    );
  }, [editForm.group_ids, groupSearch, uiGroups]);
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
    if (!editForm.storage_endpoint_id && firstCephId) {
      setEditForm((prev) => ({ ...prev, storage_endpoint_id: firstCephId }));
    }
  }, [adminCephEndpoints, editForm.storage_endpoint_id]);

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
        const quota = resolveQuotaForEdit(detail.quota_max_size_gb);
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
    const quota = resolveQuotaForEdit(user.quota_max_size_gb);
    const nextEditForm = {
      name: user.name,
      email: user.email ?? "",
      tags: normalizeUiTags(user.tags),
      user_ids: user.user_ids ?? [],
      group_ids: user.group_ids ?? [],
      quota_max_size_gb: quota.value,
      quota_max_size_unit: quota.unit,
      quota_max_objects: user.quota_max_objects != null ? String(user.quota_max_objects) : "",
      storage_endpoint_id: user.storage_endpoint_id ? String(user.storage_endpoint_id) : "",
      allow_manager_bucket_quota: Boolean(user.allow_manager_bucket_quota),
      allow_manager_ceph_s3_user_keys: Boolean(user.allow_manager_ceph_s3_user_keys),
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
    if (!editingUser.storage_endpoint_id) {
      setEditError("Storage endpoint is missing for this user.");
      return;
    }
    setEditBusy(true);
    setEditError(null);
    try {
      const payload: UpdateS3UserPayload = {
        name: editForm.name || undefined,
        email: editForm.email || undefined,
        tags: normalizeUiTags(editForm.tags),
        user_ids: editForm.user_ids,
        group_ids: editForm.group_ids,
      };
      if (canManagePrivilegedTargets) {
        payload.allow_manager_bucket_quota = editForm.allow_manager_bucket_quota;
        payload.allow_manager_ceph_s3_user_keys = editForm.allow_manager_ceph_s3_user_keys;
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
        storage_endpoint_id: createForm.storage_endpoint_id ? Number(createForm.storage_endpoint_id) : undefined,
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
      cellClassName: "min-w-[240px] max-w-[360px] align-top",
      render: (user) => {
        const tagItems = buildUiTagItems(user.tags);
        return (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              onClick={() => openEditModal(user)}
              className="min-w-0 flex-1 truncate text-left transition hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:hover:text-primary-100"
            >
              {user.name}
            </button>
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
      cellClassName: "min-w-[176px] align-top",
      render: (user) => user.rgw_user_uid,
    },
    {
      id: "endpoint",
      label: "Endpoint",
      cellClassName: "min-w-[160px] align-top",
      render: (user) => (
        <span title={user.storage_endpoint_url || undefined}>
          {user.storage_endpoint_name || "—"}
        </span>
      ),
    },
    {
      id: "associations",
      label: "UI Users / Groups",
      cellClassName: "min-w-[224px] max-w-[416px] align-top",
      render: renderUserAssociations,
    },
    {
      id: "actions",
      label: "Actions",
      align: "right",
      mobileRole: "actions",
      cellClassName: "min-w-[176px] align-top",
      render: (user) => {
        const deleteBusy = deleteBusyId === user.id;
        return (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={() => openEditModal(user)} className={tableActionButtonClasses}>
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
    <div className="space-y-4">
      <PageHeader
        title="Users"
        description="Persist RGW standalone users for direct manager access (no IAM)."
        breadcrumbs={adminBreadcrumbs({ label: "Users" })}
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

      <div className="ui-surface-card">
        <ListToolbar
          title="Users"
          description="Search matches all records."
          showHeading={false}
          countLabel={`${totalUsers} entr${totalUsers === 1 ? "y" : "ies"}`}
          search={
            <div className="flex items-center gap-2">
              <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Filter
              </span>
              <div className="relative w-full sm:w-64">
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => handleFilterChange(e.target.value)}
                  placeholder="Search by name, UID, email, group, or tag"
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
      </div>

      {showCreateModal && (
        <Modal title="Create user" onClose={createCloseGuard.requestClose}>
          {createError && (
            <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/50 dark:text-rose-200">
              {createError}
            </div>
          )}
          <form onSubmit={submitCreate} className="space-y-4">
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
                {createForm.storage_endpoint_id && (
                  <div className="flex flex-col gap-1">
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
                <UiInput
                  label="Email"
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="user@example.com"
                />
                <div className={cx("flex flex-col gap-2 px-3 py-2", uiPanelMutedClass)}>
                  <div className="flex flex-col gap-1">
                    <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Quota max size</label>
                    <div className="flex gap-2">
                      <UiInput
                        aria-label="Quota max size"
                        type="number"
                        min={0}
                        step="any"
                        fieldClassName="w-full"
                        value={createForm.quota_max_size_gb}
                        onChange={(e) => setCreateForm((prev) => ({ ...prev, quota_max_size_gb: e.target.value }))}
                        placeholder="e.g. 500"
                      />
                      <UiSelect
                        aria-label="Quota max size unit"
                        value={createForm.quota_max_size_unit}
                        onChange={(e) => setCreateForm((prev) => ({ ...prev, quota_max_size_unit: e.target.value }))}
                        disabled={!createForm.quota_max_size_gb}
                      >
                        {["MiB", "GiB", "TiB"].map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </UiSelect>
                    </div>
                  </div>
                  <UiInput
                    label="Quota max objects"
                    type="number"
                    min={0}
                    step={1}
                    value={createForm.quota_max_objects}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, quota_max_objects: e.target.value }))}
                    placeholder="e.g. 1000000"
                  />
                </div>
            {adminTagCatalogError && <PageBanner tone="warning">{adminTagCatalogError}</PageBanner>}
            <UiTagEditor
              label="Tags"
              tags={createForm.tags}
              catalog={adminTagCatalog}
              onChange={(tags) => setCreateForm((prev) => ({ ...prev, tags }))}
              placeholder="Add a tag for this RGW user"
              hint={adminTagCatalogLoading ? "Loading existing tag catalog..." : undefined}
            />
            <div className="flex items-center justify-end gap-3">
              <UiButton variant="secondary" onClick={createCloseGuard.requestClose}>
                Cancel
              </UiButton>
              <UiButton
                type="submit"
                disabled={creating || createPermissionLoading || !createEndpointCanWrite}
              >
                {creating ? "Creating..." : "Create user"}
              </UiButton>
            </div>
            {createCloseGuard.confirmationDialog}
          </form>
        </Modal>
      )}

      {showImportModal && (
        <Modal title="Import users" onClose={importCloseGuard.requestClose}>
          <p className="mb-3 ui-body text-slate-500">Enter RGW user IDs, one per line. The platform will fetch or generate keys.</p>
          {importError && (
            <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/50 dark:text-rose-200">
              {importError}
            </div>
          )}
          {importMessage && (
            <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 ui-body text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/50 dark:text-emerald-200">
              {importMessage}
            </div>
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
        </Modal>
      )}

      {editingUser && (
        <Modal
          title={`Edit ${editingUser.name}`}
          onClose={editCloseGuard.requestClose}
        >
          {editError && (
            <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/50 dark:text-rose-200">
              {editError}
            </div>
          )}
          <form onSubmit={submitEdit} className="space-y-4">
            <AdminModalTabs<EditTab>
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
              tabs={[
                { id: "general", label: "General" },
                { id: "users", label: "Linked UI users" },
                { id: "groups", label: "Linked UI groups" },
                { id: "privileged", label: "Privileged access", visible: canManagePrivilegedTargets },
              ]}
            />

            {showEditGeneralTab && (
              <>
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
                <div className="space-y-3">
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
                <UiSelect
                  label="Ceph endpoint (locked)"
                  value={editForm.storage_endpoint_id}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, storage_endpoint_id: e.target.value }))}
                  disabled
                  required
                >
                  <option value="" disabled>
                    {loadingEndpoints ? "Loading..." : cephEndpoints.length === 0 ? "No Ceph endpoint" : "Select"}
                  </option>
                  {cephEndpoints.map((ep) => (
                    <option key={ep.id} value={ep.id}>
                      {ep.name} {ep.is_default ? "(default)" : ""}
                    </option>
                  ))}
                </UiSelect>
                <div className={cx("flex flex-col gap-2 px-3 py-2", uiPanelMutedClass)}>
                  <div className="flex flex-col gap-1">
                    <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Quota max size</label>
                    <div className="flex gap-2">
                      <UiInput
                        aria-label="Quota max size"
                        type="number"
                        min={0}
                        step="any"
                        fieldClassName="w-full"
                        value={editForm.quota_max_size_gb}
                        disabled={!allowUserQuotaUpdates}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, quota_max_size_gb: e.target.value }))}
                        placeholder="e.g. 500"
                      />
                      <UiSelect
                        aria-label="Quota max size unit"
                        value={editForm.quota_max_size_unit}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, quota_max_size_unit: e.target.value }))}
                        disabled={!allowUserQuotaUpdates || !editForm.quota_max_size_gb}
                      >
                        {["MiB", "GiB", "TiB"].map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </UiSelect>
                    </div>
                  </div>
                  <UiInput
                    label="Quota max objects"
                    type="number"
                    min={0}
                    step={1}
                    value={editForm.quota_max_objects}
                    disabled={!allowUserQuotaUpdates}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, quota_max_objects: e.target.value }))}
                    placeholder="e.g. 1000000"
                  />
                </div>
              </>
            )}

            {showEditUsersTab && (
              <div className={cx("space-y-3 px-3 py-2", uiPanelMutedClass)}>
                <AdminAssociationSectionHeader
                  title="Linked UI users"
                  countLabel={`${editForm.user_ids.length} linked`}
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
                      {editForm.user_ids.length === 0 ? (
                        <tr>
                          <td colSpan={2} className={adminAssociationTableEmptyCellClass}>
                            No linked users yet.
                          </td>
                        </tr>
                      ) : (
                        editForm.user_ids.map((id) => (
                          <tr key={id}>
                            <td className={adminAssociationTableLabelCellClass}>
                              {portalUserLabelById.get(id) ?? `User #${id}`}
                            </td>
                            <td className={adminAssociationTableActionCellClass}>
                              <button
                                type="button"
                                onClick={() =>
                                  setEditForm((prev) => ({
                                    ...prev,
                                    user_ids: prev.user_ids.filter((uid) => uid !== id),
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
                        user_ids: [...prev.user_ids, ...editPortalUserSelections],
                      }));
                      setEditPortalUserSelections([]);
                      setPortalUserSearch("");
                      setShowEditPortalUserPanel(false);
                    }}
                    addDisabled={editPortalUserSelections.length === 0}
                  >
                      {visiblePortalUsers.map((option) => {
                        const isSelected = editPortalUserSelections.includes(option.id);
                        return (
                          <div
                            key={option.id}
                            className={adminAssociationOptionRowClass(isSelected)}
                          >
                            <label className={adminAssociationOptionLabelClass}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleEditPortalUserSelection(option.id)}
                                className={adminAssociationCheckboxClass}
                              />
                              <span>{option.label}</span>
                            </label>
                          </div>
                        );
                      })}
                  </AdminAssociationPickerPanel>
                )}
              </div>
            )}

            {showEditGroupsTab && (
              <div className={cx("space-y-3 px-3 py-2", uiPanelMutedClass)}>
                <AdminAssociationSectionHeader
                  title="Linked UI groups"
                  countLabel={`${editForm.group_ids.length} linked${uiGroupsLoading ? " · loading..." : ""}`}
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
                      {editForm.group_ids.length === 0 ? (
                        <tr>
                          <td colSpan={2} className={adminAssociationTableEmptyCellClass}>
                            No linked groups yet.
                          </td>
                        </tr>
                      ) : (
                        editForm.group_ids.map((id) => (
                          <tr key={id}>
                            <td className={adminAssociationTableLabelCellClass}>
                              {groupLabelById.get(id) ?? `Group #${id}`}
                            </td>
                            <td className={adminAssociationTableActionCellClass}>
                              <button
                                type="button"
                                onClick={() =>
                                  setEditForm((prev) => ({
                                    ...prev,
                                    group_ids: prev.group_ids.filter((groupId) => groupId !== id),
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
                        group_ids: [...prev.group_ids, ...editGroupSelections],
                      }));
                      setEditGroupSelections([]);
                      setGroupSearch("");
                      setShowEditGroupPanel(false);
                    }}
                    addDisabled={editGroupSelections.length === 0}
                  >
                      {visibleGroups.map((group) => {
                        const isSelected = editGroupSelections.includes(group.id);
                        return (
                          <div
                            key={group.id}
                            className={adminAssociationOptionRowClass(isSelected)}
                          >
                            <label className={adminAssociationOptionLabelClass}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleEditGroupSelection(group.id)}
                                className={adminAssociationCheckboxClass}
                              />
                              <span>{group.name}</span>
                            </label>
                          </div>
                        );
                      })}
                  </AdminAssociationPickerPanel>
                )}
              </div>
            )}

            {showEditPrivilegedTab && (
              <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <UiCheckboxField
                  className="items-start gap-3"
                  checkboxClassName="mt-1"
                    checked={editForm.allow_manager_bucket_quota}
                    onChange={(e) =>
                      setEditForm((prev) => ({
                        ...prev,
                        allow_manager_bucket_quota: e.target.checked,
                      }))
                    }
                >
                  <span>
                    <span className="block ui-body font-medium text-slate-800 dark:text-slate-100">
                      Bucket quota management
                    </span>
                  </span>
                </UiCheckboxField>
                <UiCheckboxField
                  className="items-start gap-3"
                  checkboxClassName="mt-1"
                    checked={editForm.allow_manager_ceph_s3_user_keys}
                    onChange={(e) =>
                      setEditForm((prev) => ({
                        ...prev,
                        allow_manager_ceph_s3_user_keys: e.target.checked,
                      }))
                    }
                >
                  <span>
                    <span className="block ui-body font-medium text-slate-800 dark:text-slate-100">
                      Ceph S3 User keys
                    </span>
                  </span>
                </UiCheckboxField>
              </div>
            )}

            <div className="flex items-center justify-end gap-3">
              <UiButton variant="secondary" onClick={editCloseGuard.requestClose}>
                Cancel
              </UiButton>
              <UiButton
                type="submit"
                disabled={editBusy}
              >
                {editBusy ? "Saving..." : "Save changes"}
              </UiButton>
            </div>
            {editCloseGuard.confirmationDialog}
          </form>
        </Modal>
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
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/50 dark:text-rose-200">
                {deleteModalError}
              </div>
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
