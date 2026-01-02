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
  importS3Users,
  listS3Users,
  unlinkS3User,
  updateS3User,
} from "../../api/s3Users";
import { listStorageEndpoints, StorageEndpoint } from "../../api/storageEndpoints";
import { listMinimalUsers, UserSummary } from "../../api/users";
import PageHeader from "../../components/PageHeader";
import Modal from "../../components/Modal";
import PageBanner from "../../components/PageBanner";
import TableEmptyState from "../../components/TableEmptyState";
import PaginationControls from "../../components/PaginationControls";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";

export default function S3UsersPage() {
  const [users, setUsers] = useState<S3User[]>([]);
  const [portalUsers, setPortalUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalUsers, setTotalUsers] = useState(0);
  const [filter, setFilter] = useState("");
  const MAX_LINK_OPTIONS = 10;
  const [storageEndpoints, setStorageEndpoints] = useState<StorageEndpoint[]>([]);
  const [loadingEndpoints, setLoadingEndpoints] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", uid: "", email: "", storage_endpoint_id: "" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importEndpointId, setImportEndpointId] = useState("");

  const [editingUser, setEditingUser] = useState<S3User | null>(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", user_ids: [] as number[], storage_endpoint_id: "" });
  const [editError, setEditError] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [portalUserSearch, setPortalUserSearch] = useState("");
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
  const [userToUnlink, setUserToUnlink] = useState<S3User | null>(null);
  const [unlinkingUserId, setUnlinkingUserId] = useState<number | null>(null);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  const unlinkModalBusy = userToUnlink ? unlinkingUserId === userToUnlink.id : false;

  const [userToDelete, setUserToDelete] = useState<S3User | null>(null);
  const [deleteFromRgw, setDeleteFromRgw] = useState(false);
  const [deleteModalError, setDeleteModalError] = useState<string | null>(null);

  const closeUserUnlinkModal = () => {
    if (unlinkModalBusy) {
      return;
    }
    setUserToUnlink(null);
    setUnlinkError(null);
  };

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

  useEffect(() => {
    const loadPortalUsers = async () => {
      try {
        const data = await listMinimalUsers();
        setPortalUsers(data);
      } catch {
        setPortalUsers([]);
      }
    };
    loadPortalUsers();
    const loadEndpoints = async () => {
      setLoadingEndpoints(true);
      try {
        const data = await listStorageEndpoints();
        setStorageEndpoints(data);
      } catch {
        setStorageEndpoints([]);
      } finally {
        setLoadingEndpoints(false);
      }
    };
    loadEndpoints();
  }, []);

  const portalUserOptions = useMemo(() => portalUsers.map((u) => ({ id: u.id, label: u.email })), [portalUsers]);
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

  useEffect(() => {
    const defaultCeph = cephEndpoints.find((ep) => ep.is_default) || cephEndpoints[0];
    const firstCephId = defaultCeph ? String(defaultCeph.id) : "";
    setCreateForm((prev) => ({ ...prev, storage_endpoint_id: prev.storage_endpoint_id || firstCephId }));
    setImportEndpointId((prev) => prev || firstCephId);
    if (!editForm.storage_endpoint_id && firstCephId) {
      setEditForm((prev) => ({ ...prev, storage_endpoint_id: firstCephId }));
    }
  }, [cephEndpoints, editForm.storage_endpoint_id]);

  const openEditModal = (user: S3User) => {
    setEditingUser(user);
    setEditForm({
      name: user.name,
      email: user.email ?? "",
      user_ids: user.user_ids ?? [],
      storage_endpoint_id: user.storage_endpoint_id ? String(user.storage_endpoint_id) : "",
    });
    setEditError(null);
  };

  const submitEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    if (!editForm.storage_endpoint_id) {
      setEditError("Select a Ceph endpoint.");
      return;
    }
    setEditBusy(true);
    setEditError(null);
    try {
      await updateS3User(editingUser.id, {
        name: editForm.name || undefined,
        email: editForm.email || undefined,
        user_ids: editForm.user_ids,
        storage_endpoint_id: editForm.storage_endpoint_id ? Number(editForm.storage_endpoint_id) : undefined,
      });
      await fetchUsers();
      setEditingUser(null);
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
    setCreating(true);
    setCreateError(null);
    try {
      await createS3User({
        name: createForm.name.trim(),
        uid: createForm.uid.trim() || undefined,
        email: createForm.email.trim() || undefined,
        storage_endpoint_id: createForm.storage_endpoint_id ? Number(createForm.storage_endpoint_id) : undefined,
      });
      setShowCreateModal(false);
      setCreateForm({ name: "", uid: "", email: "", storage_endpoint_id: createForm.storage_endpoint_id });
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

  const startDeleteUser = (user: S3User) => {
    setUserToDelete(user);
    setDeleteFromRgw(false);
    setDeleteModalError(null);
    setActionMessage(null);
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

  const startUnlinkUser = (user: S3User) => {
    setUserToUnlink(user);
    setUnlinkError(null);
  };

  const confirmUnlinkUser = async () => {
    if (!userToUnlink) return;
    setUnlinkingUserId(userToUnlink.id);
    setUnlinkError(null);
    setActionMessage(null);
    try {
      await unlinkS3User(userToUnlink.id);
      await fetchUsers();
      setActionMessage(`Unlinked ${userToUnlink.name}.`);
      setUserToUnlink(null);
    } catch (err) {
      setUnlinkError(extractError(err));
    } finally {
      setUnlinkingUserId(null);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Users"
        description="Persist RGW standalone users for direct manager access (no IAM)."
        breadcrumbs={[{ label: "Admin" }, { label: "Users" }]}
        actions={[
          { label: "Import", onClick: () => setShowImportModal(true), variant: "ghost" },
          { label: "Create user", onClick: () => setShowCreateModal(true) },
        ]}
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
              className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:w-64"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="compact-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr>
                {["Name", "UID", "Storage", "Email", "UI Users", "Actions"].map((label) => (
                  <th key={label} className="px-6 py-3 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading && (
                <tr>
                  <td colSpan={6} className="px-6 py-4 ui-body text-slate-500 dark:text-slate-400">
                    Loading users...
                  </td>
                </tr>
              )}
              {!loading && users.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-4">
                    <TableEmptyState title="No users" description="Import or create standalone RGW users to expose them to managers." />
                  </td>
                </tr>
              )}
              {!loading &&
                users.map((user) => {
                  const unlinkBusy = unlinkingUserId === user.id;
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
                      <td className="px-6 py-4 ui-body text-slate-600 dark:text-slate-300">{user.email ?? "-"}</td>
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
                          <button
                            onClick={() => startUnlinkUser(user)}
                            className={tableActionButtonClasses}
                            disabled={unlinkBusy}
                          >
                            {unlinkBusy ? "Unlinking..." : "Unlink"}
                          </button>
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
                disabled={loadingEndpoints || cephEndpoints.length === 0}
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
                disabled={creating}
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
              disabled={loadingEndpoints || cephEndpoints.length === 0}
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
              disabled={importBusy || !importText.trim() || !importEndpointId}
              onClick={submitImport}
              className="rounded-md bg-primary px-4 py-2 ui-body font-medium text-white shadow-sm transition hover:bg-sky-500 disabled:opacity-60"
            >
              {importBusy ? "Importing..." : "Import"}
            </button>
          </div>
        </Modal>
      )}

      {editingUser && (
        <Modal title={`Edit ${editingUser.name}`} onClose={() => setEditingUser(null)}>
          {editError && (
            <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/50 dark:text-rose-200">
              {editError}
            </div>
          )}
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
              <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Ceph endpoint *</label>
              <select
                className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                value={editForm.storage_endpoint_id}
                onChange={(e) => setEditForm((prev) => ({ ...prev, storage_endpoint_id: e.target.value }))}
                disabled={loadingEndpoints || cephEndpoints.length === 0}
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
            <div className="space-y-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/50">
              <div className="flex items-center justify-between">
                <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Linked UI users</label>
                <span className="ui-caption text-slate-500 dark:text-slate-400">{editForm.user_ids.length} selected</span>
              </div>
              {editForm.user_ids.length === 0 ? (
                <p className="ui-caption text-slate-500 dark:text-slate-400">No linked users yet. Add one below.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {editForm.user_ids.map((id) => (
                    <span key={id} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 ui-caption font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                      {portalUserOptions.find((opt) => opt.id === id)?.label ?? `User #${id}`}
                      <button
                        type="button"
                        onClick={() => setEditForm((prev) => ({ ...prev, user_ids: prev.user_ids.filter((uid) => uid !== id) }))}
                        className={tableDeleteActionClasses}
                      >
                        Remove
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="space-y-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/30">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Add a UI user</label>
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
                  {visiblePortalUsers.map((option) => (
                    <div key={option.id} className="flex items-center justify-between rounded-md px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800/60">
                      <span className="ui-body text-slate-700 dark:text-slate-200">{option.label}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setEditForm((prev) => ({
                            ...prev,
                            user_ids: prev.user_ids.includes(option.id) ? prev.user_ids : [...prev.user_ids, option.id],
                          }))
                        }
                        className={tableActionButtonClasses}
                      >
                        Add
                      </button>
                    </div>
                  ))}
                  {availablePortalUsers.length > MAX_LINK_OPTIONS && (
                    <p className="ui-caption text-slate-500 dark:text-slate-400">
                      Showing first {MAX_LINK_OPTIONS} matches. Refine your search to see more.
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditingUser(null)}
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
        </Modal>
      )}

      {userToDelete && (
        <Modal title={`Delete ${userToDelete.name}`} onClose={closeDeleteModal}>
          <div className="space-y-3 ui-body text-slate-600 dark:text-slate-300">
            <p>
              This removes the standalone RGW user from the UI. You can also delete the underlying RGW user to revoke all access keys and data associated with it.
            </p>
            <label className="flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-2 ui-body dark:border-slate-700">
              <input
                type="checkbox"
                className="mt-1"
                checked={deleteFromRgw}
                onChange={(e) => setDeleteFromRgw(e.target.checked)}
                disabled={deleteModalBusy}
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

      {userToUnlink && (
        <Modal title={`Unlink ${userToUnlink.name}`} onClose={closeUserUnlinkModal}>
          {unlinkError && (
            <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/50 dark:text-rose-200">
              {unlinkError}
            </div>
          )}
          <div className="space-y-3 ui-body text-slate-600 dark:text-slate-300">
            <p>
              This removes the UI-managed user entry and deletes the access key used by this console. The underlying RGW user and any of its data are left untouched.
            </p>
            <ul className="list-disc space-y-1 pl-5 ui-caption text-slate-500 dark:text-slate-400">
              <li>Linked UI users will lose access to this standalone user.</li>
              <li>The RGW user credentials outside this interface remain valid.</li>
            </ul>
          </div>
          <div className="mt-5 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={closeUserUnlinkModal}
              className="rounded-md border border-slate-200 px-4 py-2 ui-body font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmUnlinkUser}
              disabled={unlinkModalBusy}
              className="rounded-md bg-amber-500 px-4 py-2 ui-body font-semibold text-white shadow-sm transition hover:bg-amber-600 disabled:opacity-60"
            >
              {unlinkModalBusy ? "Unlinking..." : "Unlink user"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
