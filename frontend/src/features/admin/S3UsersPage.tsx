/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";
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
} from "../../api/s3Users";
import { getStorageEndpoint, listStorageEndpoints, StorageEndpoint } from "../../api/storageEndpoints";
import { listMinimalUsers, UserSummary } from "../../api/users";
import PageHeader from "../../components/PageHeader";
import Modal from "../../components/Modal";
import PageBanner from "../../components/PageBanner";
import TableEmptyState from "../../components/TableEmptyState";
import PaginationControls from "../../components/PaginationControls";
import StorageUsageCard from "../../components/StorageUsageCard";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { toolbarCompactInputClasses } from "../../components/toolbarControlClasses";
import { useAdminS3UserStats } from "./useAdminS3UserStats";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalUsers, setTotalUsers] = useState(0);
  const [filter, setFilter] = useState("");
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
    quota_max_size_gb: "",
    quota_max_size_unit: "GiB",
    quota_max_objects: "",
    storage_endpoint_id: "",
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importEndpointId, setImportEndpointId] = useState("");

  const [editingUser, setEditingUser] = useState<S3User | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    user_ids: [] as number[],
    quota_max_size_gb: "",
    quota_max_size_unit: "GiB",
    quota_max_objects: "",
    storage_endpoint_id: "",
  });
  const [editError, setEditError] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [portalUserSearch, setPortalUserSearch] = useState("");
  const [showEditPortalUserPanel, setShowEditPortalUserPanel] = useState(false);
  const [editPortalUserSelections, setEditPortalUserSelections] = useState<number[]>([]);
  const handleFilterChange = (value: string) => {
    setFilter(value);
    setPage(1);
  };
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

  const extractError = (err: unknown) => {
    if (axios.isAxiosError(err)) {
      return (
        (err.response?.data as { detail?: string })?.detail ||
        err.message ||
        "Unexpected error"
      );
    }
    return err instanceof Error ? err.message : "Unexpected error";
  };

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await listS3Users({
        page,
        page_size: pageSize,
        search: filter.trim() || undefined,
        include_quota: false,
      });
      const totalPages = Math.max(1, Math.ceil((response.total || 0) / pageSize));
      if (response.total > 0 && page > totalPages) {
        setPage(totalPages);
        return;
      }
      setUsers(response.items);
      setTotalUsers(response.total);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  }, [filter, page, pageSize]);

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
  const availablePortalUsers = useMemo(() => {
    const query = portalUserSearch.trim().toLowerCase();
    return portalUserOptions.filter(
      (opt) => !editForm.user_ids.includes(opt.id) && (!query || opt.label.toLowerCase().includes(query))
    );
  }, [portalUserOptions, editForm.user_ids, portalUserSearch]);
  const visiblePortalUsers = useMemo(
    () => availablePortalUsers.slice(0, MAX_LINK_OPTIONS),
    [availablePortalUsers]
  );
  const cephEndpoints = useMemo(() => storageEndpoints.filter((ep) => ep.provider === "ceph"), [storageEndpoints]);
  const adminCephEndpoints = useMemo(
    () => cephEndpoints.filter((ep) => Boolean(ep.capabilities?.admin)),
    [cephEndpoints]
  );
  const editingEndpoint = useMemo(() => {
    if (!editingUser?.storage_endpoint_id) return null;
    return storageEndpoints.find((endpoint) => endpoint.id === editingUser.storage_endpoint_id) ?? null;
  }, [editingUser?.storage_endpoint_id, storageEndpoints]);
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
    void loadEndpointsIfNeeded();
    const quota = resolveQuotaForEdit(user.quota_max_size_gb);
    setEditingUser(user);
    setEditForm({
      name: user.name,
      email: user.email ?? "",
      user_ids: user.user_ids ?? [],
      quota_max_size_gb: quota.value,
      quota_max_size_unit: quota.unit,
      quota_max_objects: user.quota_max_objects != null ? String(user.quota_max_objects) : "",
      storage_endpoint_id: user.storage_endpoint_id ? String(user.storage_endpoint_id) : "",
    });
    setEditError(null);
    setPortalUserSearch("");
    setShowEditPortalUserPanel(false);
    setEditPortalUserSelections([]);
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
      const payload: {
        name?: string;
        email?: string;
        user_ids?: number[];
        quota_max_size_gb?: number | null;
        quota_max_size_unit?: string | null;
        quota_max_objects?: number | null;
      } = {
        name: editForm.name || undefined,
        email: editForm.email || undefined,
        user_ids: editForm.user_ids,
      };
      if (allowUserQuotaUpdates) {
        payload.quota_max_size_gb = editForm.quota_max_size_gb !== "" ? Number(editForm.quota_max_size_gb) : null;
        payload.quota_max_size_unit = editForm.quota_max_size_gb !== "" ? editForm.quota_max_size_unit : null;
        payload.quota_max_objects = editForm.quota_max_objects !== "" ? Number(editForm.quota_max_objects) : null;
      }
      await updateS3User(editingUser.id, payload);
      await fetchUsers();
      setEditingUser(null);
      setPortalUserSearch("");
      setShowEditPortalUserPanel(false);
      setEditPortalUserSelections([]);
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
        breadcrumbs={[{ label: "Admin" }, { label: "Users" }]}
        rightContent={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setShowImportModal(true);
                void loadEndpointsIfNeeded();
              }}
              className="inline-flex items-center justify-center rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-200"
            >
              Import
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCreateModal(true);
                void loadEndpointsIfNeeded();
              }}
              className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Create user
            </button>
          </div>
        }
      />

      {error && <PageBanner tone="warning">{error}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}

      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Users</p>
            <p className="ui-caption text-slate-500 dark:text-slate-400">
              {totalUsers} entr{totalUsers === 1 ? "y" : "ies"} · search matches all records
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Filter
            </span>
            <input
              type="text"
              value={filter}
              onChange={(e) => handleFilterChange(e.target.value)}
              placeholder="Search by name, UID, or email"
              className={`${toolbarCompactInputClasses} w-full sm:w-64`}
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="compact-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr>
                {["Name", "UID", "Storage", "UI Users", "Actions"].map((label) => (
                  <th key={label} className="px-6 py-3 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading && (
                <tr>
                  <td colSpan={5} className="px-6 py-4 ui-body text-slate-500 dark:text-slate-400">
                    Loading users...
                  </td>
                </tr>
              )}
              {!loading && users.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-4">
                    <TableEmptyState title="No users" description="Import or create standalone RGW users to expose them to managers." />
                  </td>
                </tr>
              )}
              {!loading &&
                users.map((user) => {
                  const deleteBusy = deleteBusyId === user.id;
                  return (
                    <tr key={user.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-6 py-4 ui-body font-semibold text-slate-900 dark:text-slate-100">{user.name}</td>
                      <td className="px-6 py-4 ui-body text-slate-600 dark:text-slate-300">{user.rgw_user_uid}</td>
                      <td className="px-6 py-4 ui-body text-slate-700 dark:text-slate-200">
                        <span title={user.storage_endpoint_url || undefined}>
                          {user.storage_endpoint_name || "—"}
                        </span>
                      </td>
                      <td className="px-6 py-4 ui-body text-slate-600 dark:text-slate-300">
                        {user.user_ids && user.user_ids.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {user.user_ids.map((id) => (
                              <span key={id} className="rounded-full bg-slate-100 px-2 py-1 ui-caption font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                                {portalUsers.find((u) => u.id === id)?.email ?? `User #${id}`}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="ui-caption text-slate-400">None</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button onClick={() => openEditModal(user)} className={tableActionButtonClasses}>
                            Edit
                          </button>
                          <Link to={`/admin/s3-users/${user.id}/keys`} className={tableActionButtonClasses}>
                            Keys
                          </Link>
                          <button onClick={() => startDeleteUser(user)} className={tableDeleteActionClasses} disabled={deleteBusy}>
                            {deleteBusy ? "Deleting..." : "Delete"}
                          </button>
                        </div>
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
          total={totalUsers}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          disabled={loading}
        />
      </div>

      {showCreateModal && (
        <Modal title="Create user" onClose={() => setShowCreateModal(false)}>
          {createError && (
            <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/50 dark:text-rose-200">
              {createError}
            </div>
          )}
          <form onSubmit={submitCreate} className="space-y-3">
            <div className="flex flex-col gap-1">
              <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Display name *</label>
              <input
                className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                value={createForm.name}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="ui-body font-medium text-slate-700 dark:text-slate-200">UID (optional)</label>
              <input
                className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                value={createForm.uid}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, uid: e.target.value }))}
                placeholder="user-123"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Ceph endpoint *</label>
              <select
                className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
              </select>
            </div>
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
            <div className="flex flex-col gap-1">
              <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Email</label>
              <input
                type="email"
                className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                value={createForm.email}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="user@example.com"
              />
            </div>
            <div className="flex flex-col gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/50">
              <div className="flex flex-col gap-1">
                <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Quota max size</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={0}
                    step="any"
                    className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    value={createForm.quota_max_size_gb}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, quota_max_size_gb: e.target.value }))}
                    placeholder="e.g. 500"
                  />
                  <select
                    className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    value={createForm.quota_max_size_unit}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, quota_max_size_unit: e.target.value }))}
                    disabled={!createForm.quota_max_size_gb}
                  >
                    {["MiB", "GiB", "TiB"].map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Quota max objects</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  value={createForm.quota_max_objects}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, quota_max_objects: e.target.value }))}
                  placeholder="e.g. 1000000"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded-md border border-slate-200 px-4 py-2 ui-body font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating || createPermissionLoading || !createEndpointCanWrite}
                className="rounded-md bg-primary px-4 py-2 ui-body font-medium text-white shadow-sm transition hover:bg-sky-500 disabled:opacity-60"
              >
                {creating ? "Creating..." : "Create user"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showImportModal && (
        <Modal title="Import users" onClose={() => setShowImportModal(false)}>
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
            className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            rows={6}
            placeholder="user-alpha"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          <div className="mt-3 flex flex-col gap-1">
            <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Ceph endpoint *</label>
            <select
              className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
            </select>
          </div>
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
            <button
              type="button"
              onClick={() => setShowImportModal(false)}
              className="rounded-md border border-slate-200 px-4 py-2 ui-body font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={importBusy || importPermissionLoading || !importEndpointCanWrite || !importText.trim() || !importEndpointId}
              onClick={submitImport}
              className="rounded-md bg-primary px-4 py-2 ui-body font-medium text-white shadow-sm transition hover:bg-sky-500 disabled:opacity-60"
            >
              {importBusy ? "Importing..." : "Import"}
            </button>
          </div>
        </Modal>
      )}

      {editingUser && (
        <Modal
          title={`Edit ${editingUser.name}`}
          onClose={() => {
            setEditingUser(null);
            setPortalUserSearch("");
            setShowEditPortalUserPanel(false);
            setEditPortalUserSelections([]);
          }}
        >
          {editError && (
            <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/50 dark:text-rose-200">
              {editError}
            </div>
          )}
          <div className="space-y-4">
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
          <form onSubmit={submitEdit} className="space-y-4">
            <div className="flex flex-col gap-1">
              <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Display name</label>
              <input
                className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                value={editForm.name}
                onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Email</label>
              <input
                type="email"
                className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                value={editForm.email}
                onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Ceph endpoint (locked)</label>
              <select
                className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
              </select>
            </div>
            <div className="flex flex-col gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/50">
              <div className="flex flex-col gap-1">
                <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Quota max size</label>
                <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  step="any"
                  className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800/60 dark:disabled:text-slate-500"
                  value={editForm.quota_max_size_gb}
                  disabled={!allowUserQuotaUpdates}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, quota_max_size_gb: e.target.value }))}
                  placeholder="e.g. 500"
                />
                <select
                  className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800/60 dark:disabled:text-slate-500"
                  value={editForm.quota_max_size_unit}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, quota_max_size_unit: e.target.value }))}
                  disabled={!allowUserQuotaUpdates || !editForm.quota_max_size_gb}
                >
                  {["MiB", "GiB", "TiB"].map((u) => (
                    <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Quota max objects</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800/60 dark:disabled:text-slate-500"
                  value={editForm.quota_max_objects}
                  disabled={!allowUserQuotaUpdates}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, quota_max_objects: e.target.value }))}
                  placeholder="e.g. 1000000"
                />
              </div>
            </div>
            <div className="space-y-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/50">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Linked UI users</label>
                  <span className="ui-caption text-slate-500 dark:text-slate-400">
                    {editForm.user_ids.length} linked
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowEditPortalUserPanel((prev) => !prev)}
                  className={tableActionButtonClasses}
                >
                  {showEditPortalUserPanel ? "Close" : "Add UI users"}
                </button>
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="compact-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
                  <thead className="bg-slate-50 dark:bg-slate-900/50">
                    <tr>
                      <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        User
                      </th>
                      <th className="px-3 py-2 text-right ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {editForm.user_ids.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="px-3 py-3 ui-body text-slate-500 dark:text-slate-400">
                          No linked users yet.
                        </td>
                      </tr>
                    ) : (
                      editForm.user_ids.map((id) => (
                        <tr key={id}>
                          <td className="px-3 py-2 ui-body text-slate-700 dark:text-slate-200">
                            {portalUserLabelById.get(id) ?? `User #${id}`}
                          </td>
                          <td className="px-3 py-2 text-right">
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
                <div className="space-y-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/30">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Add UI users</label>
                      <span className="ui-caption text-slate-500 dark:text-slate-400">(filter by email)</span>
                    </div>
                    <input
                      type="text"
                      value={portalUserSearch}
                      onChange={(e) => setPortalUserSearch(e.target.value)}
                      placeholder="Search..."
                      className="w-44 rounded-md border border-slate-200 px-2 py-1 ui-caption focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                    {availablePortalUsers.length === 0 && (
                      <p className="ui-caption text-slate-500 dark:text-slate-400">No results.</p>
                    )}
                    {visiblePortalUsers.map((option) => {
                      const isSelected = editPortalUserSelections.includes(option.id);
                      return (
                        <div
                          key={option.id}
                          className={`flex items-center justify-between rounded-md px-2 py-1 ${
                            isSelected
                              ? "bg-slate-50 dark:bg-slate-800/60"
                              : "hover:bg-slate-100 dark:hover:bg-slate-800/60"
                          }`}
                        >
                          <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleEditPortalUserSelection(option.id)}
                              className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
                            />
                            <span>{option.label}</span>
                          </label>
                        </div>
                      );
                    })}
                    {availablePortalUsers.length > MAX_LINK_OPTIONS && (
                      <p className="ui-caption text-slate-500 dark:text-slate-400">
                        Showing first {MAX_LINK_OPTIONS} matches. Refine your search to see more.
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="ui-caption text-slate-500 dark:text-slate-400">
                      {editPortalUserSelections.length} selected
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowEditPortalUserPanel(false);
                          setEditPortalUserSelections([]);
                          setPortalUserSearch("");
                        }}
                        className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={editPortalUserSelections.length === 0}
                        onClick={() => {
                          if (editPortalUserSelections.length === 0) return;
                          setEditForm((prev) => ({
                            ...prev,
                            user_ids: [...prev.user_ids, ...editPortalUserSelections],
                          }));
                          setEditPortalUserSelections([]);
                          setPortalUserSearch("");
                          setShowEditPortalUserPanel(false);
                        }}
                        className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-sky-500 disabled:opacity-60"
                      >
                        Add selected
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setEditingUser(null);
                  setPortalUserSearch("");
                  setShowEditPortalUserPanel(false);
                  setEditPortalUserSelections([]);
                }}
                className="rounded-md border border-slate-200 px-4 py-2 ui-body font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={editBusy}
                className="rounded-md bg-primary px-4 py-2 ui-body font-medium text-white shadow-sm transition hover:bg-sky-500 disabled:opacity-60"
              >
                {editBusy ? "Saving..." : "Save changes"}
              </button>
            </div>
          </form>
          </div>
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
