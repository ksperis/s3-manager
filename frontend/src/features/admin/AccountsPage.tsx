/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AccountUserLink,
  ImportS3AccountPayload,
  S3Account,
  S3AccountSummary,
  createS3Account,
  deleteS3Account,
  getS3Account,
  importS3Accounts,
  listMinimalS3Accounts,
  unlinkS3Account,
  updateS3Account,
} from "../../api/accounts";
import { listStorageEndpoints, StorageEndpoint } from "../../api/storageEndpoints";
import { listMinimalUsers, UserSummary } from "../../api/users";
import Modal from "../../components/Modal";
import PageHeader from "../../components/PageHeader";
import PaginationControls from "../../components/PaginationControls";
import StorageUsageCard from "../../components/StorageUsageCard";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { useManagerStats } from "../manager/useManagerStats";

type SortField = "name" | "rgw_account_id";

export default function S3AccountsPage() {
  const [accounts, setS3Accounts] = useState<S3AccountSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState<string>("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importMode, setImportMode] = useState<"tenant" | "keys">("tenant");
  const [importKeysForm, setImportKeysForm] = useState({
    name: "",
    email: "",
    rgw_account_id: "",
    access_key: "",
    secret_key: "",
  });
  const [sort, setSort] = useState<{ field: SortField; direction: "asc" | "desc" }>({
    field: "name",
    direction: "asc",
  });
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [form, setForm] = useState({
    name: "",
    email: "",
    quota_max_size_gb: "",
    quota_max_objects: "",
    storage_endpoint_id: "",
  });
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [storageEndpoints, setStorageEndpoints] = useState<StorageEndpoint[]>([]);
  const [loadingEndpoints, setLoadingEndpoints] = useState(false);
  const [importTenantEndpointId, setImportTenantEndpointId] = useState<string>("");
  const [importKeysEndpointId, setImportKeysEndpointId] = useState<string>("");
  const [editingS3Account, setEditingS3Account] = useState<S3Account | null>(null);
  const [editForm, setEditForm] = useState({
    quota_max_size_gb: "",
    quota_max_objects: "",
    user_links: [] as AccountUserLink[],
  });
  const [deletingS3AccountId, setDeletingS3AccountId] = useState<number | null>(null);
  const [accountToDelete, setS3AccountToDelete] = useState<S3Account | null>(null);
  const [deleteFromRgw, setDeleteFromRgw] = useState(false);
  const [accountToUnlink, setS3AccountToUnlink] = useState<S3Account | null>(null);
  const [unlinkingS3AccountId, setUnlinkingS3AccountId] = useState<number | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [userRoleChoice, setUserRoleChoice] = useState<Record<number, AccountUserLink["account_role"]>>({});
  const [userAdminChoice, setUserAdminChoice] = useState<Record<number, boolean>>({});
  const MAX_LINK_OPTIONS = 10;
  const editingAccountId = editingS3Account?.db_id ?? null;
  const {
    stats: editingUsageStats,
    loading: editingUsageLoading,
    error: editingUsageError,
  } = useManagerStats(editingAccountId ?? null, Boolean(editingAccountId));
  const accountAdminFor = (userId: number): boolean =>
    Boolean(editForm.user_links.find((link) => link.user_id === userId)?.account_admin);

  const cephEndpoints = useMemo(
    () => storageEndpoints.filter((ep) => ep.provider === "ceph"),
    [storageEndpoints]
  );

  const resolveS3AccountType = (
    account: Pick<S3Account, "rgw_account_id" | "rgw_user_uid"> | (S3AccountSummary & { rgw_user_uid?: string | null })
  ): "tenant" | "rgw_user" => {
    if (account.rgw_account_id) {
      return "tenant";
    }
    const maybeUserUid = (account as Partial<S3Account>).rgw_user_uid;
    if (typeof maybeUserUid === "string" && maybeUserUid.trim()) {
      return "rgw_user";
    }
    return "rgw_user";
  };

  const renderS3AccountTypeBadge = (account: S3Account | S3AccountSummary) => {
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
      const data = await listMinimalS3Accounts();
      setS3Accounts(data);
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
  }, []);

  const currentUser = useMemo(() => {
    const raw = localStorage.getItem("user");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as { role?: string | null };
    } catch {
      return null;
    }
  }, []);

  const isSuperAdmin = currentUser?.role === "ui_admin";
  const userOptions = useMemo(() => users.map((u) => ({ id: u.id, label: u.email })), [users]);
  const userLabelById = useMemo(() => {
    const map = new Map<number, string>();
    users.forEach((u) => map.set(u.id, u.email));
    return map;
  }, [users]);
  const assignedUsers = useMemo(() => {
    const selectedIds = new Set(editForm.user_links.map((link) => link.user_id));
    return userOptions.filter((u) => selectedIds.has(u.id)).map((u) => {
      const role = editForm.user_links.find((link) => link.user_id === u.id)?.account_role ?? "portal_none";
      return { ...u, role };
    });
  }, [editForm.user_links, userOptions]);
  const availableUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    const selectedIds = new Set(editForm.user_links.map((link) => link.user_id));
    return userOptions.filter(
      (u) => !selectedIds.has(u.id) && (!query || u.label.toLowerCase().includes(query))
    );
  }, [editForm.user_links, userOptions, userSearch]);
  const visibleAvailableUsers = useMemo(
    () => availableUsers.slice(0, MAX_LINK_OPTIONS),
    [availableUsers]
  );

  const filteredS3Accounts = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const items = query
      ? accounts.filter(
          (acc) =>
            acc.name.toLowerCase().includes(query) ||
            (acc.rgw_account_id ?? acc.id).toLowerCase().includes(query)
        )
      : accounts;
    const sorted = [...items].sort((a, b) => {
      const direction = sort.direction === "asc" ? 1 : -1;
      const valueA =
        sort.field === "rgw_account_id"
          ? (a.rgw_account_id ?? a.id).toLowerCase()
          : (a.name ?? "").toLowerCase();
      const valueB =
        sort.field === "rgw_account_id"
          ? (b.rgw_account_id ?? b.id).toLowerCase()
          : (b.name ?? "").toLowerCase();
      if (valueA < valueB) return -1 * direction;
      if (valueA > valueB) return 1 * direction;
      return 0;
    });
    return sorted;
  }, [accounts, filter, sort]);

  const totalAccounts = filteredS3Accounts.length;
  const pagedS3Accounts = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredS3Accounts.slice(start, start + pageSize);
  }, [filteredS3Accounts, page, pageSize]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(totalAccounts / pageSize));
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, pageSize, totalAccounts]);

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

  const handlePageChange = (nextPage: number) => {
    if (nextPage === page) return;
    setPage(Math.max(1, nextPage));
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  useEffect(() => {
    fetchS3Accounts();
    const fetchUsersList = async () => {
      setLoadingUsers(true);
      try {
        const data = await listMinimalUsers();
        setUsers(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingUsers(false);
      }
    };
    fetchUsersList();
    const fetchEndpoints = async () => {
      setLoadingEndpoints(true);
      try {
        const data = await listStorageEndpoints();
        setStorageEndpoints(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingEndpoints(false);
      }
    };
    fetchEndpoints();
  }, [fetchS3Accounts]);

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

  useEffect(() => {
    if (storageEndpoints.length === 0) return;
    const defaultCeph = cephEndpoints.find((ep) => ep.is_default) || cephEndpoints[0];
    const firstCephId = defaultCeph ? String(defaultCeph.id) : "";
    const defaultAny = storageEndpoints.find((ep) => ep.is_default) || storageEndpoints[0];
    const firstAnyId = defaultAny ? String(defaultAny.id) : "";

    setForm((prev) => ({
      ...prev,
      storage_endpoint_id: prev.storage_endpoint_id || firstCephId,
    }));
    setImportTenantEndpointId((prev) => prev || firstCephId);
    setImportKeysEndpointId((prev) => prev || firstAnyId);
  }, [storageEndpoints, cephEndpoints]);

  const loadAccountDetail = useCallback(
    async (account: S3AccountSummary) => {
      const targetId = accountDbId(account);
      if (targetId == null || Number.isNaN(targetId)) {
        setActionError("Unable to resolve the account identifier.");
        return null;
      }
      try {
        const detail = await getS3Account(targetId, { includeUsage: false });
        return detail;
      } catch (err) {
        setActionError(extractError(err));
        return null;
      }
    },
    [extractError]
  );

  const columns: { label: string; field?: SortField | null; align?: "left" | "right" }[] = [
    { label: "Name", field: "name" },
    { label: "RGW ID", field: "rgw_account_id" },
    { label: "Endpoint", field: null },
    { label: "UI Users", field: null },
    { label: "Actions", field: null, align: "right" },
  ];

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
    setCreating(true);
    setActionError(null);
    setActionMessage(null);
    try {
      await createS3Account({
        name: form.name.trim(),
        email: form.email.trim() || undefined,
        quota_max_size_gb: form.quota_max_size_gb ? Number(form.quota_max_size_gb) : undefined,
        quota_max_objects: form.quota_max_objects ? Number(form.quota_max_objects) : undefined,
        storage_endpoint_id: form.storage_endpoint_id ? Number(form.storage_endpoint_id) : undefined,
      });
      setActionMessage("S3Account created");
      const defaultCeph = cephEndpoints.find((ep) => ep.is_default) || cephEndpoints[0];
      setForm({
        name: "",
        email: "",
        quota_max_size_gb: "",
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
    return (account.user_ids ?? []).map((id) => ({ user_id: id, account_role: null, account_admin: false }));
  };

  const deleteModalHasResources =
    accountToDelete != null &&
    ((accountToDelete.bucket_count ?? 0) > 0 ||
      (accountToDelete.rgw_user_count ?? 0) > 0 ||
      (accountToDelete.rgw_topic_count ?? 0) > 0);
  const deleteModalBusy = accountToDelete ? deletingS3AccountId === accountDbId(accountToDelete) : false;
  const accountUnlinkModalBusy = accountToUnlink ? unlinkingS3AccountId === accountDbId(accountToUnlink) : false;
  const importDisabled =
    importBusy ||
    (importMode === "tenant"
      ? !importText.trim() || !importTenantEndpointId
      : !importKeysForm.name.trim() || !importKeysForm.access_key.trim() || !importKeysForm.secret_key.trim() || !importKeysEndpointId);

  const startEditS3Account = async (account: S3AccountSummary) => {
    setActionError(null);
    setActionMessage(null);
    setUserRoleChoice({});
    setUserAdminChoice({});
    const detail = await loadAccountDetail(account);
    if (!detail) return;
    setEditingS3Account(detail);
    setEditForm({
      quota_max_size_gb: detail.quota_max_size_gb != null ? String(detail.quota_max_size_gb) : "",
      quota_max_objects: detail.quota_max_objects != null ? String(detail.quota_max_objects) : "",
      user_links:
        detail.user_links?.map((link) => ({
          user_id: link.user_id,
          account_role: link.account_role ?? "portal_none",
          account_admin: Boolean(link.account_admin),
        })) ?? [],
    });
    setUserSearch("");
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
      await updateS3Account(targetId, {
        quota_max_size_gb: editForm.quota_max_size_gb !== "" ? Number(editForm.quota_max_size_gb) : null,
        quota_max_objects: editForm.quota_max_objects !== "" ? Number(editForm.quota_max_objects) : null,
        user_links: editForm.user_links,
      });
      setEditingS3Account(null);
      await fetchS3Accounts();
      setActionMessage("S3Account updated");
    } catch (err) {
      setActionError(extractError(err));
    }
  };

  const openDeleteS3AccountModal = async (account: S3AccountSummary) => {
    setActionError(null);
    setActionMessage(null);
    const detail = await loadAccountDetail(account);
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

  const openUnlinkS3AccountModal = async (account: S3AccountSummary) => {
    setActionError(null);
    setActionMessage(null);
    const detail = await loadAccountDetail(account);
    if (!detail) return;
    setS3AccountToUnlink(detail);
  };

  const closeUnlinkModal = () => {
    setS3AccountToUnlink(null);
    setUnlinkingS3AccountId(null);
    setActionError(null);
  };

  const confirmUnlinkS3Account = async () => {
    if (!accountToUnlink) return;
    const targetId = accountDbId(accountToUnlink);
    if (targetId == null || Number.isNaN(targetId)) {
      setActionError("Missing account identifier.");
      return;
    }
    setUnlinkingS3AccountId(targetId);
    setActionError(null);
    setActionMessage(null);
    try {
      await unlinkS3Account(targetId);
      await fetchS3Accounts();
      closeUnlinkModal();
    } catch (err) {
      setActionError(extractError(err));
    } finally {
      setUnlinkingS3AccountId(null);
    }
  };


  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounts"
        description="Provision Ceph RGW accounts (tenants), quotas, and root users."
        breadcrumbs={[{ label: "Admin" }, { label: "Accounts" }]}
        actions={
          isSuperAdmin
            ? [
                {
                  label: "Import",
                  onClick: () => {
                    setImportText("");
                    setImportError(null);
                    setImportMessage(null);
                    setImportMode("tenant");
                    setImportKeysForm({
                      name: "",
                      email: "",
                      rgw_account_id: "",
                      access_key: "",
                      secret_key: "",
                    });
                    setShowImportModal(true);
                  },
                  variant: "ghost",
                },
                { label: "Create account", onClick: () => setShowCreateModal(true) },
              ]
            : []
        }
      />

      {isSuperAdmin && showCreateModal && (
        <Modal title="Create an account" onClose={() => setShowCreateModal(false)}>
          <p className="mb-3 text-sm text-slate-500">
            Super-admin only. Provision an RGW account (server-side generated <code>account_id</code>) with optional quotas.
          </p>
          {actionError && (
            <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/50 dark:text-rose-200">
              {actionError}
            </div>
          )}
          {actionMessage && (
            <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/50 dark:text-emerald-200">
              {actionMessage}
            </div>
          )}
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-200">S3Account name *</label>
              <input
                className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Email contact</label>
              <input
                type="email"
                className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="contact@example.com"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Storage endpoint (Ceph) *</label>
              <select
                className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                value={form.storage_endpoint_id}
                onChange={(e) => setForm((f) => ({ ...f, storage_endpoint_id: e.target.value }))}
                required
                disabled={loadingEndpoints || cephEndpoints.length === 0}
              >
                <option value="" disabled>
                  {loadingEndpoints ? "Loading..." : "No Ceph endpoint"}
                </option>
                {cephEndpoints.map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    {ep.name} {ep.is_default ? "(default)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Capacity quota (GB)</label>
              <input
                type="number"
                min="0"
                className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                value={form.quota_max_size_gb}
                onChange={(e) => setForm((f) => ({ ...f, quota_max_size_gb: e.target.value }))}
                placeholder="e.g. 500"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Object quota (count)</label>
              <input
                type="number"
                min="0"
                className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                value={form.quota_max_objects}
                onChange={(e) => setForm((f) => ({ ...f, quota_max_objects: e.target.value }))}
                placeholder="e.g. 1000000"
              />
            </div>
            <div className="flex items-center justify-end gap-3 md:col-span-2">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-sky-500 disabled:opacity-60"
              >
                {creating ? "Creating..." : "Create account"}
              </button>
            </div>
          </form>
      </Modal>
    )}

      {isSuperAdmin && accountToUnlink && (
        <Modal title={`Unlink ${accountToUnlink.name}`} onClose={closeUnlinkModal}>
          <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
            This removes the account from the admin interface and detaches assigned UI users while keeping the RGW tenant and its data.
            The root user{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">
              {(accountToUnlink.rgw_account_id ?? accountToUnlink.id) + "-admin"}
            </code>{" "}
            will be deleted to revoke its access keys.
          </p>
          {actionError && (
            <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/50 dark:text-rose-200">
              {actionError}
            </div>
          )}
          <div className="mb-4 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            RGW tenant preserved:{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">
              {accountToUnlink.rgw_account_id ?? accountToUnlink.id}
            </code>
          </div>
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={closeUnlinkModal}
              className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmUnlinkS3Account}
              disabled={accountUnlinkModalBusy}
              className="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 disabled:opacity-60"
            >
              {accountUnlinkModalBusy ? "Unlinking..." : "Unlink account"}
            </button>
          </div>
        </Modal>
      )}


      {isSuperAdmin && accountToDelete && (
        <Modal title={`Delete ${accountToDelete.name}`} onClose={closeDeleteModal}>
          <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
            Removing this account deletes the UI entry. Optionally delete the backing RGW tenant if it no longer contains resources.
          </p>
          {actionError && (
            <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/50 dark:text-rose-200">
              {actionError}
            </div>
          )}
          {deleteModalHasResources && (
            <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/50 dark:text-amber-100">
              This RGW tenant still has attached resources. Remove buckets and RGW users (excluding the admin user) before deleting it from RGW.
              <div className="mt-1 text-xs font-semibold">
                Buckets: {accountToDelete.bucket_count ?? "unknown"} · RGW users (excl. admin):{" "}
                {accountToDelete.rgw_user_count ?? "unknown"} · RGW topics:{" "}
                {accountToDelete.rgw_topic_count ?? "unknown"}
              </div>
              {accountToDelete.rgw_user_uids && accountToDelete.rgw_user_uids.length > 0 && (
                <div className="mt-2 rounded-lg border border-amber-200/40 bg-white/60 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/40 dark:text-amber-50">
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
                <div className="mt-2 rounded-lg border border-amber-200/40 bg-white/60 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/40 dark:text-amber-50">
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
            className={`mb-4 flex items-start gap-3 rounded-lg border px-3 py-2 text-sm ${
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
              <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">
                {accountToDelete.rgw_account_id ?? accountToDelete.id}
              </code>
            </span>
          </label>
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={closeDeleteModal}
              className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDeleteS3Account}
              disabled={deleteModalBusy}
              className="rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:opacity-60"
            >
              {deleteModalBusy ? "Deleting..." : "Delete account"}
            </button>
          </div>
        </Modal>
      )}

      {isSuperAdmin && showImportModal && (
        <Modal title="Import accounts" onClose={() => setShowImportModal(false)}>
          <div className="mb-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setImportMode("tenant");
                setImportError(null);
                setImportMessage(null);
              }}
              className={`rounded-md border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                importMode === "tenant"
                  ? "border-primary bg-primary/10 text-primary-700 dark:border-primary/60 dark:text-primary-100"
                  : "border-slate-200 text-slate-600 hover:border-primary hover:text-primary-700 dark:border-slate-700 dark:text-slate-300"
              }`}
            >
              Tenant IDs
            </button>
            <button
              type="button"
              onClick={() => {
                setImportMode("keys");
                setImportError(null);
                setImportMessage(null);
              }}
              className={`rounded-md border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                importMode === "keys"
                  ? "border-primary bg-primary/10 text-primary-700 dark:border-primary/60 dark:text-primary-100"
                  : "border-slate-200 text-slate-600 hover:border-primary hover:text-primary-700 dark:border-slate-700 dark:text-slate-300"
              }`}
            >
              Access keys
            </button>
          </div>
          <p className="mb-3 text-sm text-slate-500">
            {importMode === "tenant"
              ? "Enter RGW tenant IDs (RGWXXXXXXXXXXXXXXX) one per line. The platform will ensure a root user exists and retrieve keys."
              : "Use this mode when the Ceph admin API is unavailable but you already have the account credentials. Tenant ID remains optional."}
          </p>
          {importError && (
            <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/50 dark:text-rose-200">
              {importError}
            </div>
          )}
          {importMessage && (
            <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/50 dark:text-emerald-200">
              {importMessage}
            </div>
          )}
          {importMode === "tenant" ? (
            <>
              <textarea
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                rows={6}
                placeholder="RGW00000000000000001"
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
              />
              <label className="mt-3 flex flex-col gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                Ceph endpoint
                <select
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  value={importTenantEndpointId}
                  onChange={(e) => setImportTenantEndpointId(e.target.value)}
                  disabled={cephEndpoints.length === 0}
                  required
                >
                  <option value="" disabled>
                    {cephEndpoints.length === 0 ? "No Ceph endpoint" : "Select"}
                  </option>
                  {cephEndpoints.map((ep) => (
                    <option key={ep.id} value={ep.id}>
                      {ep.name} {ep.is_default ? "(default)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Account name *</label>
                <input
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  value={importKeysForm.name}
                  onChange={(e) => setImportKeysForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Customer account name"
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-200">RGW tenant ID (optional)</label>
                <input
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  value={importKeysForm.rgw_account_id}
                  onChange={(e) => setImportKeysForm((prev) => ({ ...prev, rgw_account_id: e.target.value }))}
                  placeholder="RGW00000000000000001"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Contact email</label>
                <input
                  type="email"
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  value={importKeysForm.email}
                  onChange={(e) => setImportKeysForm((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="owner@example.com"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Access key *</label>
                <input
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  value={importKeysForm.access_key}
                  onChange={(e) => setImportKeysForm((prev) => ({ ...prev, access_key: e.target.value }))}
                  placeholder="AKIA..."
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Secret key *</label>
                <input
                  type="password"
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  value={importKeysForm.secret_key}
                  onChange={(e) => setImportKeysForm((prev) => ({ ...prev, secret_key: e.target.value }))}
                  placeholder="••••••••"
                />
              </div>
              <div className="flex flex-col gap-1 md:col-span-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Storage endpoint</label>
                <select
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  value={importKeysEndpointId}
                  onChange={(e) => setImportKeysEndpointId(e.target.value)}
                  disabled={storageEndpoints.length === 0}
                  required
                >
                  <option value="" disabled>
                    {storageEndpoints.length === 0 ? "No endpoint" : "Select"}
                  </option>
                  {storageEndpoints.map((ep) => (
                    <option key={ep.id} value={ep.id}>
                      {ep.name} {ep.is_default ? "(default)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          <div className="mt-4 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowImportModal(false)}
              className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={importDisabled}
              onClick={async () => {
                if (importMode === "tenant") {
                  const raw = importText
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .filter(Boolean);
                  if (raw.length === 0) {
                    setImportError("Enter at least one entry.");
                    setImportMessage(null);
                    return;
                  }
                  try {
                    setImportBusy(true);
                    setImportError(null);
                    setImportMessage(null);
                    const invalid = raw.filter((id) => !/^RGW\d{17}$/.test(id));
                    if (invalid.length > 0) {
                      setImportError(`Invalid identifiers: ${invalid.join(", ")}`);
                      return;
                    }
                    await importS3Accounts(
                      raw.map((id) => ({
                        rgw_account_id: id,
                        storage_endpoint_id: importTenantEndpointId ? Number(importTenantEndpointId) : undefined,
                      }))
                    );
                    setImportMessage("S3Accounts imported.");
                    setImportText("");
                    await fetchS3Accounts();
                  } catch (err) {
                    setImportError(extractError(err));
                  } finally {
                    setImportBusy(false);
                  }
                  return;
                }

                const name = importKeysForm.name.trim();
                const accessKey = importKeysForm.access_key.trim();
                const secretKey = importKeysForm.secret_key.trim();
                const rgwAccountId = importKeysForm.rgw_account_id.trim();
                const email = importKeysForm.email.trim();
                if (!name || !accessKey || !secretKey) {
                  setImportError("Name, access key, and secret key are required.");
                  setImportMessage(null);
                  return;
                }
                const payload: ImportS3AccountPayload[] = [
                  {
                    name,
                    rgw_account_id: rgwAccountId || undefined,
                    email: email || undefined,
                    access_key: accessKey,
                    secret_key: secretKey,
                    storage_endpoint_id: importKeysEndpointId ? Number(importKeysEndpointId) : undefined,
                  },
                ];
                try {
                  setImportBusy(true);
                  setImportError(null);
                  setImportMessage(null);
                  await importS3Accounts(payload);
                  setImportMessage("S3Account imported.");
                  setImportKeysForm({
                    name: "",
                    email: "",
                    rgw_account_id: "",
                    access_key: "",
                    secret_key: "",
                  });
                  await fetchS3Accounts();
                } catch (err) {
                  setImportError(extractError(err));
                } finally {
                  setImportBusy(false);
                }
              }}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-sky-500 disabled:opacity-60"
            >
              {importBusy ? "Importing..." : "Import"}
            </button>
          </div>
        </Modal>
      )}

      {isSuperAdmin && editingS3Account && (
        <Modal title={`Edit ${editingS3Account.name}`} onClose={() => setEditingS3Account(null)}>
          {actionError && (
            <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/50 dark:text-rose-200">
              {actionError}
            </div>
          )}
          <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100">
            Storage endpoint:{" "}
            <span title={editingS3Account.storage_endpoint_url || undefined}>
              {editingS3Account.storage_endpoint_name ?? "—"}
            </span>
          </div>
          <div className="space-y-4">
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
              metricsDisabled={false}
              errorMessage={editingUsageError}
            />
            <form onSubmit={submitEditS3Account} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Max quota (GB)</label>
                  <input
                    type="number"
                    min={0}
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    value={editForm.quota_max_size_gb}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, quota_max_size_gb: e.target.value }))}
                    placeholder="Leave empty to disable"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Object quota</label>
                  <input
                    type="number"
                    min={0}
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    value={editForm.quota_max_objects}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, quota_max_objects: e.target.value }))}
                    placeholder="Leave empty to disable"
                  />
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Linked UI users</label>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {assignedUsers.length} selected{loadingUsers ? " · loading..." : ""}
                  </span>
                </div>
                {assignedUsers.length === 0 && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">No linked users yet. Add one below.</p>
                )}
                {assignedUsers.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {assignedUsers.map((u) => (
                      <div
                        key={u.id}
                        className="flex flex-wrap items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-100"
                      >
                        {u.label}
                        <select
                          className="rounded-full border border-slate-200 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                          value={u.role}
                          onChange={(e) =>
                            setEditForm((prev) => ({
                              ...prev,
                              user_links: prev.user_links.map((link) =>
                                link.user_id === u.id
                                  ? { ...link, account_role: e.target.value }
                                  : link
                              ),
                            }))
                          }
                        >
                          <option value="portal_user">Portal user</option>
                          <option value="portal_manager">Portal manager</option>
                          <option value="portal_none">No portal access</option>
                        </select>
                        <label className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={accountAdminFor(u.id)}
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
                      </div>
                    ))}
                  </div>
                )}
                <div className="space-y-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/50">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Add a UI user</label>
                      <span className="text-xs text-slate-500 dark:text-slate-400">(filter by email)</span>
                    </div>
                    <input
                      type="text"
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      placeholder="Search..."
                      className="w-44 rounded-md border border-slate-200 px-2 py-1 text-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                    {availableUsers.length === 0 && (
                      <p className="text-xs text-slate-500 dark:text-slate-400">No results.</p>
                    )}
                    {visibleAvailableUsers.map((u) => (
                      <div key={u.id} className="flex items-center justify-between rounded-md px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800/60">
                        <span className="text-sm text-slate-700 dark:text-slate-200">{u.label}</span>
                        <div className="flex items-center gap-2">
                          <select
                            className="rounded-full border border-slate-200 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                            value={userRoleChoice[u.id] ?? "portal_none"}
                            onChange={(e) => {
                              const nextRole = e.target.value as AccountUserLink["account_role"];
                              setUserRoleChoice((prev) => ({
                                ...prev,
                                [u.id]: nextRole,
                              }));
                              setUserAdminChoice((prev) => ({
                                ...prev,
                                [u.id]: prev[u.id] ?? nextRole === "portal_manager",
                              }));
                            }}
                          >
                            <option value="portal_user">Portal user</option>
                            <option value="portal_manager">Portal manager</option>
                            <option value="portal_none">No portal access</option>
                          </select>
                          <label className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                            <input
                              type="checkbox"
                              checked={Boolean(userAdminChoice[u.id] ?? false)}
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
                          <button
                            type="button"
                            onClick={() =>
                              setEditForm((prev) => ({
                                ...prev,
                                user_links: [
                                  ...prev.user_links,
                                  {
                                    user_id: u.id,
                                    account_role: userRoleChoice[u.id] ?? "portal_none",
                                    account_admin:
                                      userAdminChoice[u.id] ??
                                      (userRoleChoice[u.id] ?? "portal_none") === "portal_manager",
                                  },
                                ],
                              }))
                            }
                            className={tableActionButtonClasses}
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    ))}
                    {availableUsers.length > MAX_LINK_OPTIONS && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Showing first {MAX_LINK_OPTIONS} matches. Refine your search to see more.
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingS3Account(null)}
                  className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-sky-500 disabled:opacity-60"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}

      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-4 dark:border-slate-800">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">S3Accounts</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">RGW tenants, quotas, and root users.</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {totalAccounts} account{totalAccounts === 1 ? "" : "s"}
                </span>
                <div className="flex items-center gap-2 sm:justify-end">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Filter</span>
                  <input
                    type="text"
                    value={filter}
                    onChange={(e) => handleFilterChange(e.target.value)}
                    placeholder="Search by name or RGW ID"
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:w-64 md:w-72"
                  />
                </div>
              </div>
            </div>
            {error && !loading && (
              <span className="rounded-md bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 dark:bg-rose-900/40 dark:text-rose-100">
                {error}
              </span>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
          <thead className="bg-slate-50 dark:bg-slate-900/50">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.label}
                  onClick={col.field ? () => toggleSort(col.field) : undefined}
                  className={`px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${
                    col.field ? "cursor-pointer hover:text-primary-700 dark:hover:text-primary-100" : col.align === "right" ? "text-right" : ""
                  }`}
                >
                  <div className={`flex items-center ${col.align === "right" ? "justify-end" : "gap-1"}`}>
                    <span>{col.label}</span>
                    {col.field && sort.field === col.field && (
                      <span className="text-[10px]">{sort.direction === "asc" ? "▲" : "▼"}</span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading && (
                <tr>
                  <td colSpan={columns.length} className="px-6 py-4 text-sm text-slate-500 dark:text-slate-400">
                    Loading accounts...
                  </td>
                </tr>
              )}
              {error && !loading && (
                <tr>
                  <td colSpan={columns.length} className="px-6 py-4 text-sm text-rose-600 dark:text-rose-200">
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && accounts.length === 0 && (
                <tr>
                  <td colSpan={columns.length} className="px-6 py-4 text-sm text-slate-500 dark:text-slate-400">
                    No accounts yet.
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                pagedS3Accounts.map((account) => {
                  const summaryDbId = accountDbId(account);
                  const unlinkBusy = summaryDbId != null && unlinkingS3AccountId === summaryDbId;
                  const deleteBusy = summaryDbId != null && deletingS3AccountId === summaryDbId;
                  const accountUserLinks = resolveAccountUserLinks(account);
                  return (
                    <tr key={account.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {isSuperAdmin ? (
                        <button
                          type="button"
                          onClick={() => startEditS3Account(account)}
                          className="text-left text-sm font-semibold text-slate-900 transition hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:text-slate-100 dark:hover:text-primary-100"
                        >
                          {account.name}
                        </button>
                      ) : (
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{account.name}</span>
                      )}
                      {renderS3AccountTypeBadge(account)}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-200">
                    {account.rgw_account_id ?? account.id}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-200">
                    <span title={account.storage_endpoint_url || undefined}>
                      {account.storage_endpoint_name || "—"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300">
                    {accountUserLinks.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {accountUserLinks.map((link) => {
                          const role = link.account_role ?? "portal_none";
                          const showPortalBadge = role !== "portal_none";
                          const roleLabel = role === "portal_manager" ? "Portal manager" : "Portal user";
                          const tone =
                            role === "portal_manager"
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-100"
                              : "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-100";
                          const isAccountAdmin = Boolean(link.account_admin);
                          return (
                            <span
                              key={`${account.id}-${link.user_id}-${role}-${isAccountAdmin ? "admin" : "user"}`}
                              className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-100"
                            >
                              <span>{userLabelById.get(link.user_id) ?? `User #${link.user_id}`}</span>
                              {showPortalBadge && (
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone}`}>
                                  {roleLabel}
                                </span>
                              )}
                              {isAccountAdmin && (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
                                  Admin
                                </span>
                              )}
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500 dark:text-slate-400">None</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {isSuperAdmin ? (
                      <div className="flex justify-end gap-2">
                        <button onClick={() => startEditS3Account(account)} className={tableActionButtonClasses}>
                          Edit
                        </button>
                        <button
                          onClick={() => openUnlinkS3AccountModal(account)}
                          className={tableActionButtonClasses}
                          disabled={unlinkBusy}
                        >
                          {unlinkBusy ? "Unlinking..." : "Unlink"}
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
                      <span className="text-xs text-slate-500 dark:text-slate-400">-</span>
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
