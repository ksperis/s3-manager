/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  CreateUserPayload,
  UpdateUserPayload,
  User,
  assignUserToS3Account,
  createUser,
  deleteUser,
  listUsers,
  updateUser,
} from "../../api/users";
import { S3AccountSummary, listMinimalS3Accounts, updateS3Account } from "../../api/accounts";
import { S3UserSummary, listMinimalS3Users } from "../../api/s3Users";
import Modal from "../../components/Modal";
import PageHeader from "../../components/PageHeader";
import PaginationControls from "../../components/PaginationControls";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";

export default function UsersPage() {
  type SortField = "email" | "role" | "accounts" | "last_login_at";

  const MAX_VISIBLE_OPTIONS = 10;
  const [users, setUsers] = useState<User[]>([]);
  const [accounts, setS3Accounts] = useState<S3AccountSummary[]>([]);
  const [s3Users, setS3Users] = useState<S3UserSummary[]>([]);
  const [s3UsersLoaded, setS3UsersLoaded] = useState(false);
  const [s3UsersLoading, setS3UsersLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const createFormTemplate = (): CreateUserPayload => ({
    email: "",
    password: "",
    role: "ui_user",
    rgw_access_key: "",
    rgw_secret_key: "",
  });
  const [form, setForm] = useState<CreateUserPayload>(() => createFormTemplate());
  const [createUseCustomKeys, setCreateUseCustomKeys] = useState(false);
  const [createSelectedS3Accounts, setCreateSelectedS3Accounts] = useState<{ id: number; role: string; account_admin?: boolean }[]>([]);
  const [createSelectedS3Users, setCreateSelectedS3Users] = useState<number[]>([]);
  const [createAccountRoleChoice, setCreateAccountRoleChoice] = useState<Record<number, string>>({});
  const [createAccountAdminChoice, setCreateAccountAdminChoice] = useState<Record<number, boolean>>({});
  const [createS3AccountSearch, setCreateS3AccountSearch] = useState("");
  const [createS3Search, setCreateS3Search] = useState("");
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState<UpdateUserPayload>({});
  const [editUseCustomKeys, setEditUseCustomKeys] = useState(false);
  const [editSelectedS3Accounts, setEditSelectedS3Accounts] = useState<{ id: number; role: string; account_admin?: boolean }[]>([]);
  const [editSelectedS3Users, setEditSelectedS3Users] = useState<number[]>([]);
  const [editAccountRoleChoice, setEditAccountRoleChoice] = useState<Record<number, string>>({});
  const [editAccountAdminChoice, setEditAccountAdminChoice] = useState<Record<number, boolean>>({});
  const [editS3AccountSearch, setEditS3AccountSearch] = useState("");
  const [editS3Search, setEditS3Search] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ field: SortField; direction: "asc" | "desc" }>({
    field: "email",
    direction: "asc",
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalUsers, setTotalUsers] = useState(0);
  const accountDbId = (account: S3AccountSummary) => account.db_id ?? Number(account.id);
  const accountOptions = useMemo(
    () =>
      accounts
        .map((a) => ({ id: accountDbId(a), label: a.name }))
        .filter((a) => !Number.isNaN(Number(a.id))),
    [accounts]
  );
  const accountOptionsById = useMemo(() => {
    const map = new Map<number, S3AccountSummary>();
    accounts.forEach((a) => {
      const idNum = Number(a.db_id ?? a.id);
      if (!Number.isNaN(idNum)) {
        map.set(idNum, a);
      }
    });
    return map;
  }, [accounts]);
  const s3UserOptions = useMemo(() => s3Users.map((u) => ({ id: u.id, label: u.name })), [s3Users]);
  const s3UserLabelById = useMemo(() => {
    const map = new Map<number, string>();
    s3Users.forEach((u) => map.set(u.id, u.name));
    return map;
  }, [s3Users]);
  const availableCreateS3Accounts = useMemo(() => {
    const query = createS3AccountSearch.trim().toLowerCase();
    const selectedIds = new Set(createSelectedS3Accounts.map((a) => Number(a.id)));
    return accountOptions.filter(
      (a) => !selectedIds.has(Number(a.id)) && (!query || a.label.toLowerCase().includes(query))
    );
  }, [accountOptions, createS3AccountSearch, createSelectedS3Accounts]);
  const availableEditS3Accounts = useMemo(() => {
    const query = editS3AccountSearch.trim().toLowerCase();
    const selectedIds = new Set(editSelectedS3Accounts.map((a) => Number(a.id)));
    return accountOptions.filter(
      (a) => !selectedIds.has(Number(a.id)) && (!query || a.label.toLowerCase().includes(query))
    );
  }, [accountOptions, editS3AccountSearch, editSelectedS3Accounts]);
  const availableCreateS3Users = useMemo(() => {
    const query = createS3Search.trim().toLowerCase();
    return s3UserOptions.filter(
      (opt) => !createSelectedS3Users.includes(opt.id) && (!query || opt.label.toLowerCase().includes(query))
    );
  }, [s3UserOptions, createSelectedS3Users, createS3Search]);
  const availableEditS3Users = useMemo(() => {
    const query = editS3Search.trim().toLowerCase();
    return s3UserOptions.filter(
      (opt) => !editSelectedS3Users.includes(opt.id) && (!query || opt.label.toLowerCase().includes(query))
    );
  }, [s3UserOptions, editSelectedS3Users, editS3Search]);
  const limitedOptions = <T,>(options: T[]) => options.slice(0, MAX_VISIBLE_OPTIONS);
  const visibleCreateS3Accounts = limitedOptions(availableCreateS3Accounts);
  const visibleEditS3Accounts = limitedOptions(availableEditS3Accounts);
  const visibleCreateS3Users = limitedOptions(availableCreateS3Users);
  const visibleEditS3Users = limitedOptions(availableEditS3Users);
  const normalizeUiRoleValue = (role?: string | null): string => {
    const value = (role || "").toLowerCase();
    if (value === "ui_admin" || value === "super_admin" || value === "account_admin") return "ui_admin";
    if (value === "ui_none" || value === "none") return "ui_none";
    return "ui_user";
  };
  const displayUiRole = (role?: string | null) => {
    const value = (role || "").toLowerCase();
    if (value === "ui_admin" || value === "super_admin" || value === "account_admin") return "Admin";
    if (value === "ui_user" || value === "account_user") return "User";
    if (value === "ui_none" || value === "none") return "No access";
    return role || "-";
  };
  const renderS3UserChips = useCallback(
    (user: User) => {
      const labels =
        user.s3_user_details && user.s3_user_details.length > 0
          ? user.s3_user_details.map((entry) => entry.name || `User #${entry.id}`)
          : (user.s3_users ?? []).map((id) => s3UserLabelById.get(Number(id)) ?? `User #${id}`);
      if (labels.length === 0) return null;
      return (
        <div className="flex flex-wrap gap-2">
          {labels.map((label, index) => (
            <span
              key={`${label}-${index}`}
              className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-2 py-0.5 ui-caption font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-100"
            >
              {label}
            </span>
          ))}
        </div>
      );
    },
    [s3UserLabelById]
  );
  const editRoleValue = editForm.role ?? editingUser?.role ?? "ui_user";

  const formatLastLogin = (value?: string | null) => {
    if (!value) return "-";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }
    return parsed.toLocaleString();
  };

  const renderAccountChips = (user: User) => {
    if (!user.accounts || user.accounts.length === 0) return null;
    const roleByAccountId = new Map<number, string | null>(
      (user.account_links ?? []).map((link) => [Number(link.account_id), link.account_role ?? null])
    );
    const adminByAccountId = new Map<number, boolean>(
      (user.account_links ?? []).map((link) => [Number(link.account_id), Boolean(link.account_admin)])
    );
    return (
      <div className="flex flex-wrap gap-2">
        {user.accounts.map((id) => {
          const label = accountOptionsById.get(Number(id))?.name ?? `Account #${id}`;
          const role = roleByAccountId.get(Number(id)) ?? "portal_none";
          const isAccountAdmin = adminByAccountId.get(Number(id)) === true;
          const showPortalBadge = role !== "portal_none";
          const tone =
            role === "portal_manager"
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-100"
              : role === "portal_user"
              ? "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-100"
              : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200";
          const displayRole = role === "portal_manager" ? "Portal manager" : role === "portal_user" ? "Portal user" : role;
          return (
            <span
              key={`${id}-${role}`}
              className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-2 py-0.5 ui-caption font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-100"
            >
              <span>{label}</span>
              {showPortalBadge && (
                <span className={`rounded-full px-1.5 py-0.5 ui-badge font-semibold uppercase tracking-wide ${tone}`}>
                  {displayRole}
                </span>
              )}
              {isAccountAdmin && (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 ui-badge font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
                  Admin
                </span>
              )}
            </span>
          );
        })}
      </div>
    );
  };

  const renderAssociationSummary = (user: User) => {
    const hasAccounts = Boolean(user.accounts && user.accounts.length > 0);
    const hasS3Users = Boolean(user.s3_users && user.s3_users.length > 0);
    if (!hasAccounts && !hasS3Users) {
      return <span className="ui-caption text-slate-500 dark:text-slate-400">-</span>;
    }
    const accountChips = renderAccountChips(user);
    const s3UserChips = renderS3UserChips(user);
    if (hasAccounts && hasS3Users) {
      return (
        <div className="space-y-1">
          <div>
            <div className="ui-badge font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Accounts
            </div>
            <div className="ui-caption text-slate-600 dark:text-slate-300">{accountChips ?? "-"}</div>
          </div>
          <div>
            <div className="ui-badge font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Users
            </div>
            <div className="ui-caption text-slate-600 dark:text-slate-300">{s3UserChips ?? "-"}</div>
          </div>
        </div>
      );
    }
    const isAccountsOnly = hasAccounts;
    const label = isAccountsOnly ? "Accounts" : "Users";
    const value = isAccountsOnly ? accountChips : s3UserChips || "-";
    return (
      <div>
        <div className="ui-badge font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          {label}
        </div>
        <div className="ui-caption text-slate-600 dark:text-slate-300">{value}</div>
      </div>
    );
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

  const extractError = (err: unknown): string => {
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
      const searchValue = filter.trim();
      const response = await listUsers({
        page,
        page_size: pageSize,
        search: searchValue || undefined,
        sort_by: sort.field,
        sort_dir: sort.direction,
      });
      const totalPages = Math.max(1, Math.ceil((response.total || 0) / pageSize));
      if (response.total > 0 && page > totalPages) {
        setPage(totalPages);
        return;
      }
      setUsers(response.items);
      setTotalUsers(response.total);
    } catch (err) {
      setError("Unable to load users.");
    } finally {
      setLoading(false);
    }
  }, [filter, page, pageSize, sort.direction, sort.field]);

  const fetchS3Accounts = useCallback(async () => {
    try {
      const data = await listMinimalS3Accounts();
      setS3Accounts(data);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const fetchS3Users = useCallback(async () => {
    setS3UsersLoading(true);
    try {
      const data = await listMinimalS3Users();
      setS3Users(data);
      setS3UsersLoaded(true);
    } catch (err) {
      console.error(err);
    } finally {
      setS3UsersLoading(false);
    }
  }, []);

  const ensureS3Users = useCallback(async () => {
    if (s3UsersLoaded || s3UsersLoading) return;
    await fetchS3Users();
  }, [s3UsersLoaded, s3UsersLoading, fetchS3Users]);

  useEffect(() => {
    fetchUsers();
    fetchS3Accounts();
  }, [fetchUsers, fetchS3Accounts]);

  useEffect(() => {
    if (showCreateModal || showEditModal) {
      ensureS3Users();
    }
  }, [showCreateModal, showEditModal, ensureS3Users]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setActionMessage(null);
    if (!form.email || !form.password) {
      setActionError("Email and password are required.");
      return;
    }
    const payload: CreateUserPayload = {
      email: form.email,
      password: form.password,
      role: form.role,
    };
    if (form.role === "ui_admin" && createUseCustomKeys) {
      const trimmedAccess = form.rgw_access_key?.trim() ?? "";
      const trimmedSecret = form.rgw_secret_key?.trim() ?? "";
      if (!trimmedAccess || !trimmedSecret) {
        setActionError("Provide both RGW admin access and secret keys.");
        return;
      }
      payload.rgw_access_key = trimmedAccess;
      payload.rgw_secret_key = trimmedSecret;
    }
    try {
      const created = await createUser(payload);
      if (created?.id && createSelectedS3Accounts.length > 0) {
        await Promise.all(
          createSelectedS3Accounts.map((entry) =>
            assignUserToS3Account(
              created.id,
              Number(entry.id),
              entry.role as string | undefined,
              entry.account_admin ?? entry.role === "portal_manager"
            )
          )
        );
      }
      if (created?.id && createSelectedS3Users.length > 0) {
        await updateUser(created.id, { s3_user_ids: createSelectedS3Users });
      }
      setActionMessage("User created");
      setForm(createFormTemplate());
      setCreateUseCustomKeys(false);
      setCreateSelectedS3Accounts([]);
      setCreateSelectedS3Users([]);
      setCreateS3AccountSearch("");
      setCreateS3Search("");
      await fetchUsers();
      await fetchS3Accounts();
      setShowCreateModal(false);
    } catch (err) {
      setActionError(extractError(err));
    }
  };

  const startEdit = (user: User) => {
    setEditingUser(user);
    setEditForm({
      email: user.email,
      password: "",
      role: normalizeUiRoleValue(user.role),
      rgw_access_key: "",
      rgw_secret_key: "",
    });
    setEditUseCustomKeys(user.role === "ui_admin" && Boolean(user.has_rgw_credentials));
    const accountRoles = new Map<number, string | null>(
      (user.account_links ?? []).map((link) => [Number(link.account_id), link.account_role ?? null])
    );
    const accountAdmins = new Map<number, boolean>(
      (user.account_links ?? []).map((link) => [Number(link.account_id), Boolean(link.account_admin)])
    );
    const selectedAccounts =
      user.accounts?.map((id) => ({
        id: Number(id),
        role: accountRoles.get(Number(id)) ?? "portal_none",
        account_admin: accountAdmins.get(Number(id)) ?? false,
      })) ?? [];
    setEditSelectedS3Accounts(selectedAccounts);
    setEditSelectedS3Users(user.s3_users ? user.s3_users.map((id) => Number(id)) : []);
    setEditS3AccountSearch("");
    setEditS3Search("");
    setActionError(null);
    setActionMessage(null);
    setShowEditModal(true);
  };

  const submitEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setBusyId(editingUser.id);
    setActionError(null);
    setActionMessage(null);
    try {
      const payload: UpdateUserPayload = {};
      if (editForm.email) {
        payload.email = editForm.email;
      }
      if (editForm.password) {
        payload.password = editForm.password;
      }
      if (editForm.role) {
        payload.role = editForm.role;
      }
      const resultingRole = (payload.role ?? editingUser.role) ?? "ui_user";
      const wantsCustomKeys = resultingRole === "ui_admin" && editUseCustomKeys;
      if (!wantsCustomKeys) {
        payload.rgw_access_key = null;
        payload.rgw_secret_key = null;
      } else {
        const trimmedAccess = editForm.rgw_access_key?.trim() ?? "";
        const trimmedSecret = editForm.rgw_secret_key?.trim() ?? "";
        const providedAny = Boolean(trimmedAccess) || Boolean(trimmedSecret);
        if (providedAny) {
          if (!trimmedAccess || !trimmedSecret) {
            setActionError("Provide both RGW admin access and secret keys.");
            setBusyId(null);
            return;
          }
          payload.rgw_access_key = trimmedAccess;
          payload.rgw_secret_key = trimmedSecret;
        } else if (!editingUser.has_rgw_credentials) {
          setActionError("Provide both RGW admin access and secret keys.");
          setBusyId(null);
          return;
        }
      }
      payload.s3_user_ids = editSelectedS3Users;
      await updateUser(editingUser.id, payload);
      const existing = editingUser.accounts ? editingUser.accounts.map((id) => Number(id)) : [];
      const existingRoleById = new Map<number, string | null>(
        (editingUser.account_links ?? []).map((link) => [Number(link.account_id), link.account_role ?? null])
      );
      const existingAdminById = new Map<number, boolean>(
        (editingUser.account_links ?? []).map((link) => [Number(link.account_id), Boolean(link.account_admin)])
      );
      const selectedIds = editSelectedS3Accounts.map((entry) => Number(entry.id));
      const toAdd = editSelectedS3Accounts.filter((entry) => !existing.includes(Number(entry.id)));
      const toRemove = existing.filter((id) => !selectedIds.includes(id));
      const toUpdateRole = editSelectedS3Accounts.filter((entry) => {
        const currentRole = existingRoleById.get(Number(entry.id)) ?? "portal_none";
        const currentAdmin = existingAdminById.get(Number(entry.id)) ?? false;
        return existing.includes(Number(entry.id)) && (currentRole !== entry.role || currentAdmin !== Boolean(entry.account_admin));
      });

      if (toAdd.length > 0) {
        await Promise.all(
          toAdd.map((entry) =>
            assignUserToS3Account(
              editingUser.id,
              Number(entry.id),
              entry.role,
              entry.account_admin ?? entry.role === "portal_manager"
            )
          )
        );
      }
      if (toUpdateRole.length > 0) {
        await Promise.all(
          toUpdateRole.map((entry) =>
            assignUserToS3Account(
              editingUser.id,
              Number(entry.id),
              entry.role,
              entry.account_admin ?? entry.role === "portal_manager"
            )
          )
        );
      }
      for (const accountId of toRemove) {
        const account = accountOptionsById.get(Number(accountId));
        if (!account) continue;
        const remainingLinks =
          (account.user_links ?? account.user_ids?.map((id) => ({ user_id: id, account_role: null, account_admin: false })) ?? [])
            .filter((link) => link.user_id !== editingUser.id);
        await updateS3Account(Number(accountId), { user_links: remainingLinks });
      }

      setActionMessage("User updated");
      setEditingUser(null);
      setEditForm({});
      setEditSelectedS3Accounts([]);
      setEditSelectedS3Users([]);
      setEditS3AccountSearch("");
      setEditS3Search("");
      setEditUseCustomKeys(false);
      setShowEditModal(false);
      await fetchUsers();
      await fetchS3Accounts();
    } catch (err) {
      setActionError(extractError(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (userId: number) => {
    const confirmDelete = window.confirm("Delete this user?");
    if (!confirmDelete) return;
    setBusyId(userId);
    setActionError(null);
    setActionMessage(null);
    try {
      await deleteUser(userId);
      setActionMessage("User deleted");
      await fetchUsers();
    } catch (err) {
      setActionError(extractError(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="UI Users"
        description="Create, edit, delete, and link UI users to RGW accounts."
        breadcrumbs={[{ label: "Admin" }, { label: "Interface" }, { label: "UI Users" }]}
        actions={[{ label: "Create user", onClick: () => setShowCreateModal(true) }]}
      />
      {actionError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 ui-body text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/60 dark:text-rose-100">
          {actionError}
        </div>
      )}
      {actionMessage && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 ui-body text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/60 dark:text-emerald-100">
          {actionMessage}
        </div>
      )}

      {showCreateModal && (
        <Modal
          title="Create user"
          onClose={() => {
            setShowCreateModal(false);
            setForm(createFormTemplate());
            setCreateUseCustomKeys(false);
            setCreateSelectedS3Accounts([]);
            setCreateS3AccountSearch("");
          }}
        >
          {actionError && (
            <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/60 dark:text-rose-100">
              {actionError}
            </div>
          )}
          {actionMessage && (
            <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 ui-body text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/60 dark:text-emerald-100">
              {actionMessage}
            </div>
          )}
          <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="ui-body font-medium text-slate-700">Email *</label>
              <input
                type="email"
                className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="jane.doe@example.com"
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="ui-body font-medium text-slate-700">Password *</label>
              <input
                type="password"
                className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="•••••••"
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="ui-body font-medium text-slate-700">Role</label>
              <select
                className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={form.role}
                onChange={(e) => {
                  const value = e.target.value;
                  setForm((f) => ({
                    ...f,
                    role: value,
                    ...(value !== "ui_admin" ? { rgw_access_key: "", rgw_secret_key: "" } : {}),
                  }));
                  if (value !== "ui_admin") {
                    setCreateUseCustomKeys(false);
                  }
                }}
              >
                <option value="ui_none">No access</option>
                <option value="ui_user">User</option>
                <option value="ui_admin">Admin</option>
              </select>
            </div>
            {form.role === "ui_admin" && (
              <div className="md:col-span-2 rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-700">
                <label className="flex items-center gap-2 ui-body font-medium text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300 text-primary focus:ring-primary"
                    checked={createUseCustomKeys}
                    onChange={(e) => {
                      setCreateUseCustomKeys(e.target.checked);
                      if (!e.target.checked) {
                        setForm((f) => ({ ...f, rgw_access_key: "", rgw_secret_key: "" }));
                      }
                    }}
                  />
                  Override default RGW admin key
                </label>
                <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                  Leave unchecked to use the shared admin key from configuration.
                </p>
                {createUseCustomKeys && (
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <label className="ui-caption font-semibold text-slate-600 dark:text-slate-300">Access key *</label>
                      <input
                        type="text"
                        className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                        value={form.rgw_access_key ?? ""}
                        autoComplete="off"
                        onChange={(e) => setForm((f) => ({ ...f, rgw_access_key: e.target.value }))}
                        placeholder="RGW********"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="ui-caption font-semibold text-slate-600 dark:text-slate-300">Secret key *</label>
                      <input
                        type="password"
                        className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                        value={form.rgw_secret_key ?? ""}
                        autoComplete="new-password"
                        onChange={(e) => setForm((f) => ({ ...f, rgw_secret_key: e.target.value }))}
                        placeholder="****************"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="md:col-span-2 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <label className="ui-body font-medium text-slate-700">Linked accounts</label>
                  <span className="ui-caption text-slate-500">Optional</span>
                </div>
                <input
                  type="text"
                  value={createS3AccountSearch}
                  onChange={(e) => setCreateS3AccountSearch(e.target.value)}
                  placeholder="Filter by name..."
                  className="w-48 rounded-md border border-slate-200 px-2 py-1 ui-caption focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              {createSelectedS3Accounts.length === 0 ? (
                <p className="ui-caption text-slate-500 dark:text-slate-400">No account selected.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {createSelectedS3Accounts.map((entry) => {
                    const label =
                      accountOptions.find((a) => Number(a.id) === Number(entry.id))?.label ?? `S3Account #${entry.id}`;
                    return (
                      <div
                        key={entry.id}
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 ui-caption font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100"
                      >
                        <span className="ui-body">{label}</span>
                        <div className="flex items-center gap-2">
                          <select
                            className="rounded-full border border-slate-200 px-2 py-1 ui-caption font-semibold uppercase tracking-wide text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                            value={entry.role}
                            onChange={(e) =>
                              setCreateSelectedS3Accounts((prev) =>
                                prev.map((item) =>
                                  item.id === entry.id ? { ...item, role: e.target.value } : item
                                )
                              )
                            }
                          >
                            <option value="portal_user">Portal user</option>
                            <option value="portal_manager">Portal manager</option>
                            <option value="portal_none">Portal none</option>
                          </select>
                          <label className="flex items-center gap-1 ui-caption font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                            <input
                              type="checkbox"
                              checked={Boolean(entry.account_admin)}
                              onChange={(e) =>
                                setCreateSelectedS3Accounts((prev) =>
                                  prev.map((item) =>
                                    item.id === entry.id ? { ...item, account_admin: e.target.checked } : item
                                  )
                                )
                              }
                              className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
                            />
                            Admin
                          </label>
                        </div>
                        <button
                          type="button"
                          onClick={() => setCreateSelectedS3Accounts((prev) => prev.filter((acc) => acc.id !== entry.id))}
                          className={tableDeleteActionClasses}
                        >
                          Remove
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-slate-200 px-2 py-2 dark:border-slate-700 dark:bg-slate-900/50">
                {availableCreateS3Accounts.length === 0 && (
                  <p className="ui-caption text-slate-500 dark:text-slate-400">No accounts available.</p>
                )}
                {visibleCreateS3Accounts.map((opt) => (
                  <div
                    key={opt.id}
                    className="flex items-center justify-between rounded px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                  >
                    <span className="ui-body text-slate-700 dark:text-slate-200">{opt.label}</span>
                    <div className="flex items-center gap-2">
                      <select
                        className="rounded-full border border-slate-200 px-2 py-1 ui-caption font-semibold uppercase tracking-wide text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                        value={createAccountRoleChoice[Number(opt.id)] ?? "portal_none"}
                        onChange={(e) =>
                          setCreateAccountRoleChoice((prev) => ({
                            ...prev,
                            [Number(opt.id)]: e.target.value,
                          }))
                        }
                      >
                        <option value="portal_user">Portal user</option>
                        <option value="portal_manager">Portal manager</option>
                        <option value="portal_none">Portal none</option>
                      </select>
                      <label className="flex items-center gap-1 ui-caption font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={Boolean(createAccountAdminChoice[Number(opt.id)])}
                          onChange={(e) =>
                            setCreateAccountAdminChoice((prev) => ({
                              ...prev,
                              [Number(opt.id)]: e.target.checked,
                            }))
                          }
                          className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
                        />
                            Admin
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const role = createAccountRoleChoice[Number(opt.id)] ?? "portal_none";
                          const account_admin = Boolean(createAccountAdminChoice[Number(opt.id)]);
                          setCreateSelectedS3Accounts((prev) => [...prev, { id: Number(opt.id), role, account_admin }]);
                        }}
                        className={tableActionButtonClasses}
                      >
                        Add
                      </button>
                    </div>
                  </div>
                ))}
                {availableCreateS3Accounts.length > MAX_VISIBLE_OPTIONS && (
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    Showing first {MAX_VISIBLE_OPTIONS} matches. Use the search box to narrow down the list.
                  </p>
                )}
              </div>
            </div>
            <div className="md:col-span-2 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <label className="ui-body font-medium text-slate-700">Linked users</label>
                  <span className="ui-caption text-slate-500">Optional</span>
                </div>
                <input
                  type="text"
                  value={createS3Search}
                  onChange={(e) => setCreateS3Search(e.target.value)}
                  placeholder="Filter by name..."
                  className="w-48 rounded-md border border-slate-200 px-2 py-1 ui-caption focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              {createSelectedS3Users.length === 0 ? (
                <p className="ui-caption text-slate-500 dark:text-slate-400">No user selected.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {createSelectedS3Users.map((id) => (
                    <span
                      key={id}
                      className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-2 py-0.5 ui-caption font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-100"
                    >
                      {s3UserLabelById.get(id) ?? `User #${id}`}
                      <button
                        type="button"
                        onClick={() => setCreateSelectedS3Users((prev) => prev.filter((s3Id) => s3Id !== id))}
                        className={tableDeleteActionClasses}
                      >
                        Remove
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-slate-200 px-2 py-2 dark:border-slate-700 dark:bg-slate-900/50">
                {availableCreateS3Users.length === 0 && (
                  <p className="ui-caption text-slate-500 dark:text-slate-400">No users available.</p>
                )}
                {visibleCreateS3Users.map((opt) => (
                  <div
                    key={opt.id}
                    className="flex items-center justify-between rounded px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                  >
                    <span className="ui-body text-slate-700 dark:text-slate-200">{opt.label}</span>
                    <button
                      type="button"
                      onClick={() => setCreateSelectedS3Users((prev) => [...prev, opt.id])}
                      className={tableActionButtonClasses}
                    >
                      Add
                    </button>
                  </div>
                ))}
                {availableCreateS3Users.length > MAX_VISIBLE_OPTIONS && (
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    Showing first {MAX_VISIBLE_OPTIONS} matches. Use the search box to narrow down the list.
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 md:col-span-2">
              <button
                type="button"
                onClick={() => {
                  setShowCreateModal(false);
                  setForm(createFormTemplate());
                  setCreateUseCustomKeys(false);
                  setCreateSelectedS3Accounts([]);
                  setCreateS3AccountSearch("");
                  setCreateSelectedS3Users([]);
                  setCreateS3Search("");
                }}
                className="rounded-md border border-slate-200 px-4 py-2 ui-body font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-md bg-primary px-4 py-2 ui-body font-medium text-white shadow-sm transition hover:bg-sky-500 disabled:opacity-60"
              >
                Create
              </button>
            </div>
          </form>
        </Modal>
      )}

      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-4 dark:border-slate-800">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">UI Users</p>
              <p className="ui-caption text-slate-500 dark:text-slate-400">Interface user management.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                <span className="ui-caption text-slate-500 dark:text-slate-400">
                  {totalUsers} user{totalUsers === 1 ? "" : "s"}
                </span>
              <div className="flex items-center gap-2 sm:justify-end">
                <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Filter</span>
                  <input
                    type="text"
                    value={filter}
                    onChange={(e) => handleFilterChange(e.target.value)}
                placeholder="Search by email, role, account, or user"
                  className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:w-64 md:w-72"
                />
              </div>
            </div>
          </div>
          {error && !loading && (
            <div className="mt-3 rounded-md bg-rose-50 px-3 py-2 ui-caption font-semibold text-rose-700 dark:bg-rose-900/40 dark:text-rose-100">
              {error}
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
        <table className="compact-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr>
                    {[
                      { label: "Email", field: "email" as SortField },
                      { label: "Role", field: "role" as SortField },
                      { label: "Last login", field: "last_login_at" as SortField },
                      { label: "S3Accounts / Users", field: "accounts" as SortField },
                      { label: "Actions", field: null as SortField | null },
                    ].map((col) => (
                  <th
                    key={col.label}
                    onClick={col.field ? () => toggleSort(col.field) : undefined}
                    className={`px-6 py-3 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${
                      col.field ? "cursor-pointer hover:text-primary-700 dark:hover:text-primary-100" : "text-right"
                    }`}
                  >
                    <div className={`flex items-center ${col.label === "Actions" ? "justify-end" : "gap-1"}`}>
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
              {loading && (
                <tr>
                  <td colSpan={4} className="px-6 py-4 ui-body text-slate-500 dark:text-slate-400">
                    Loading...
                  </td>
                </tr>
              )}
              {error && !loading && (
                <tr>
                  <td colSpan={4} className="px-6 py-4 ui-body text-rose-600 dark:text-rose-200">
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && totalUsers === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-4 ui-body text-slate-500 dark:text-slate-400">
                    No users.
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                users.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-6 py-4 ui-body font-semibold text-slate-900 dark:text-slate-100">
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(user)}
                          className="w-full text-left transition hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:hover:text-primary-100"
                        >
                          {user.email}
                        </button>
                        {user.role === "ui_admin" && user.has_rgw_credentials && (
                          <span
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100"
                            title="Custom RGW key"
                            aria-label="Custom RGW key"
                          >
                            🔑
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 ui-body text-slate-600 dark:text-slate-300">{displayUiRole(user.role)}</td>
                    <td className="px-6 py-4 ui-body text-slate-600 dark:text-slate-300">
                      {formatLastLogin(user.last_login_at)}
                    </td>
                    <td className="px-6 py-4 ui-body text-slate-600 dark:text-slate-300">
                      {renderAssociationSummary(user)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => startEdit(user)} className={tableActionButtonClasses}>
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(user.id)}
                          className={tableDeleteActionClasses}
                          disabled={busyId === user.id}
                        >
                          {busyId === user.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
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

      {editingUser && showEditModal && (
        <Modal
          title="Edit user"
          onClose={() => {
            setShowEditModal(false);
            setEditingUser(null);
            setEditSelectedS3Accounts([]);
            setEditS3AccountSearch("");
            setEditSelectedS3Users([]);
            setEditS3Search("");
            setEditUseCustomKeys(false);
            setEditForm({});
          }}
        >
          <p className="ui-body text-slate-500 mb-3">{editingUser.email}</p>
          {actionError && (
            <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/60 dark:text-rose-100">
              {actionError}
            </div>
          )}
          {actionMessage && (
            <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 ui-body text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/60 dark:text-emerald-100">
              {actionMessage}
            </div>
          )}
          <form onSubmit={submitEdit} className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="ui-body font-medium text-slate-700">Email</label>
              <input
                type="email"
                className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={editForm.email ?? ""}
                onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="ui-body font-medium text-slate-700">New password</label>
              <input
                type="password"
                className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={editForm.password ?? ""}
                onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="Leave blank to keep current"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="ui-body font-medium text-slate-700">Role</label>
              <select
                className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={editRoleValue}
                onChange={(e) => {
                  const value = e.target.value;
                  setEditForm((f) => ({
                    ...f,
                    role: value,
                    ...(value !== "ui_admin" ? { rgw_access_key: "", rgw_secret_key: "" } : {}),
                  }));
                  if (value !== "ui_admin") {
                    setEditUseCustomKeys(false);
                  }
                }}
              >
                <option value="ui_none">No access</option>
                <option value="ui_user">User</option>
                <option value="ui_admin">Admin</option>
              </select>
            </div>
            {editRoleValue === "ui_admin" && (
              <div className="md:col-span-2 rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-700">
                <label className="flex items-center gap-2 ui-body font-medium text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300 text-primary focus:ring-primary"
                    checked={editUseCustomKeys}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setEditUseCustomKeys(checked);
                      if (!checked) {
                        setEditForm((f) => ({ ...f, rgw_access_key: "", rgw_secret_key: "" }));
                      }
                    }}
                  />
                  Override default RGW admin key
                </label>
                <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                  Existing secrets are not shown; provide a new pair to replace them.
                </p>
                {editUseCustomKeys && (
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <label className="ui-caption font-semibold text-slate-600 dark:text-slate-300">Access key</label>
                      <input
                        type="text"
                        className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                        value={editForm.rgw_access_key ?? ""}
                        autoComplete="off"
                        onChange={(e) => setEditForm((f) => ({ ...f, rgw_access_key: e.target.value }))}
                        placeholder={editingUser?.has_rgw_credentials ? "(unchanged)" : "RGW********"}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="ui-caption font-semibold text-slate-600 dark:text-slate-300">Secret key</label>
                      <input
                        type="password"
                        className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                        value={editForm.rgw_secret_key ?? ""}
                        autoComplete="new-password"
                        onChange={(e) => setEditForm((f) => ({ ...f, rgw_secret_key: e.target.value }))}
                        placeholder={editingUser?.has_rgw_credentials ? "(unchanged)" : "****************"}
                      />
                    </div>
                  </div>
                )}
                {!editUseCustomKeys && editingUser?.has_rgw_credentials && (
                  <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">
                    A custom key is currently configured. Unchecking keeps using the shared key instead.
                  </p>
                )}
              </div>
            )}
            <div className="md:col-span-2 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <label className="ui-body font-medium text-slate-700">Linked Accounts</label>
                  <span className="ui-caption text-slate-500">
                    {editSelectedS3Accounts.length} linked
                  </span>
                </div>
              </div>
              {editSelectedS3Accounts.length === 0 ? (
                <p className="ui-caption text-slate-500 dark:text-slate-400">No account linked yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {editSelectedS3Accounts.map((entry) => {
                    const label =
                      accountOptions.find((a) => Number(a.id) === Number(entry.id))?.label ?? `S3Account #${entry.id}`;
                    const showPortalBadge = entry.role !== "portal_none";
                    const tone =
                      entry.role === "portal_manager"
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100"
                        : entry.role === "portal_user"
                        ? "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-100"
                        : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200";
                    const roleLabel =
                      entry.role === "portal_manager"
                        ? "Portal manager"
                        : entry.role === "portal_user"
                        ? "Portal user"
                        : entry.role;
                    return (
                      <span
                        key={entry.id}
                        className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-2 py-0.5 ui-caption font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-100"
                      >
                        <span className="ui-body">{label}</span>
                        {showPortalBadge && (
                          <span className={`rounded-full px-1.5 py-0.5 ui-badge font-semibold uppercase tracking-wide ${tone}`}>
                            {roleLabel}
                          </span>
                        )}
                        <select
                          className="rounded-full border border-slate-200 px-2 py-1 ui-caption font-semibold uppercase tracking-wide text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                          value={entry.role}
                          onChange={(e) =>
                            setEditSelectedS3Accounts((prev) =>
                              prev.map((item) =>
                                item.id === entry.id ? { ...item, role: e.target.value } : item
                              )
                            )
                          }
                        >
                          <option value="portal_user">Portal user</option>
                          <option value="portal_manager">Portal manager</option>
                          <option value="portal_none">Portal none</option>
                        </select>
                        <label className="flex items-center gap-1 ui-caption font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={Boolean(entry.account_admin)}
                            onChange={(e) =>
                              setEditSelectedS3Accounts((prev) =>
                                prev.map((item) =>
                                  item.id === entry.id ? { ...item, account_admin: e.target.checked } : item
                                )
                              )
                            }
                            className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
                          />
                          account_admin
                        </label>
                        <button
                          type="button"
                          onClick={() => setEditSelectedS3Accounts((prev) => prev.filter((acc) => acc.id !== entry.id))}
                          className={tableDeleteActionClasses}
                        >
                          Remove
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
              <div className="space-y-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/50">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <label className="ui-body font-medium text-slate-700">Add an account</label>
                    <span className="ui-caption text-slate-500 dark:text-slate-400">(filter by name)</span>
                  </div>
                  <input
                    type="text"
                    value={editS3AccountSearch}
                    onChange={(e) => setEditS3AccountSearch(e.target.value)}
                    placeholder="Search..."
                    className="w-44 rounded-md border border-slate-200 px-2 py-1 ui-caption focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                  {availableEditS3Accounts.length === 0 && (
                    <p className="ui-caption text-slate-500 dark:text-slate-400">No results.</p>
                  )}
                  {visibleEditS3Accounts.map((opt) => (
                    <div
                      key={opt.id}
                      className="flex items-center justify-between rounded-md px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                    >
                      <span className="ui-body text-slate-700 dark:text-slate-200">{opt.label}</span>
                      <div className="flex items-center gap-2">
                        <select
                          className="rounded-full border border-slate-200 px-2 py-1 ui-caption font-semibold uppercase tracking-wide text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                          value={editAccountRoleChoice[Number(opt.id)] ?? "portal_none"}
                          onChange={(e) =>
                            setEditAccountRoleChoice((prev) => ({
                              ...prev,
                              [Number(opt.id)]: e.target.value,
                            }))
                          }
                        >
                          <option value="portal_user">Portal user</option>
                          <option value="portal_manager">Portal manager</option>
                          <option value="portal_none">Portal none</option>
                        </select>
                        <label className="flex items-center gap-1 ui-caption font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={Boolean(editAccountAdminChoice[Number(opt.id)])}
                            onChange={(e) =>
                              setEditAccountAdminChoice((prev) => ({
                                ...prev,
                                [Number(opt.id)]: e.target.checked,
                              }))
                            }
                            className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
                          />
                          account_admin
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            const role = editAccountRoleChoice[Number(opt.id)] ?? "portal_none";
                            const account_admin = Boolean(editAccountAdminChoice[Number(opt.id)]);
                            setEditSelectedS3Accounts((prev) => [...prev, { id: Number(opt.id), role, account_admin }]);
                          }}
                          className={tableActionButtonClasses}
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  ))}
                  {availableEditS3Accounts.length > MAX_VISIBLE_OPTIONS && (
                    <p className="ui-caption text-slate-500 dark:text-slate-400">
                      Showing first {MAX_VISIBLE_OPTIONS} matches. Use the search box to narrow down the list.
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div className="md:col-span-2 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <label className="ui-body font-medium text-slate-700">Linked users</label>
                  <span className="ui-caption text-slate-500">Optional</span>
                </div>
                <input
                  type="text"
                  value={editS3Search}
                  onChange={(e) => setEditS3Search(e.target.value)}
                  placeholder="Filter by name..."
                  className="w-48 rounded-md border border-slate-200 px-2 py-1 ui-caption focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              {editSelectedS3Users.length === 0 ? (
                <p className="ui-caption text-slate-500 dark:text-slate-400">No user selected.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {editSelectedS3Users.map((id) => (
                    <span
                      key={id}
                      className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-2 py-0.5 ui-caption font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-100"
                    >
                      {s3UserLabelById.get(id) ?? `User #${id}`}
                      <button
                        type="button"
                        onClick={() => setEditSelectedS3Users((prev) => prev.filter((s3Id) => s3Id !== id))}
                        className={tableDeleteActionClasses}
                      >
                        Remove
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-slate-200 px-2 py-2 dark:border-slate-700 dark:bg-slate-900/50">
                {availableEditS3Users.length === 0 && (
                  <p className="ui-caption text-slate-500 dark:text-slate-400">No users available.</p>
                )}
                {visibleEditS3Users.map((opt) => (
                  <div
                    key={opt.id}
                    className="flex items-center justify-between rounded px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                  >
                    <span className="ui-body text-slate-700 dark:text-slate-200">{opt.label}</span>
                    <button
                      type="button"
                      onClick={() => setEditSelectedS3Users((prev) => [...prev, opt.id])}
                      className={tableActionButtonClasses}
                    >
                      Add
                    </button>
                  </div>
                ))}
                {availableEditS3Users.length > MAX_VISIBLE_OPTIONS && (
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    Showing first {MAX_VISIBLE_OPTIONS} matches. Use the search box to narrow down the list.
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 md:col-span-2">
              <button
                type="button"
                onClick={() => {
                  setShowEditModal(false);
                  setEditingUser(null);
                  setEditSelectedS3Accounts([]);
                  setEditS3AccountSearch("");
                  setEditUseCustomKeys(false);
                  setEditForm({});
                }}
                className="rounded-md border border-slate-200 px-4 py-2 ui-body font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busyId === editingUser.id}
                className="rounded-md bg-primary px-4 py-2 ui-body font-medium text-white shadow-sm transition hover:bg-sky-500 disabled:opacity-60"
              >
                {busyId === editingUser.id ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
