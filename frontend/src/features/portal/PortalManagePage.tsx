/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  PortalAccountRole,
  PortalState,
  PortalUserSummary,
  addPortalUser,
  deletePortalUser,
  fetchPortalState,
  grantPortalUserBucket,
  listPortalUserBuckets,
  listPortalUsers,
  revokePortalUserBucket,
  updatePortalUserRole,
} from "../../api/portal";
import Modal from "../../components/Modal";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import SortableHeader from "../../components/SortableHeader";
import TableEmptyState from "../../components/TableEmptyState";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { confirmAction } from "../../utils/confirm";
import { usePortalAccountContext } from "./PortalAccountContext";

type SortField = "email" | "iam_username" | "role";

type SortState = {
  field: SortField;
  direction: "asc" | "desc";
};

const userTableColumns: { label: string; field?: SortField | null; align?: "left" | "right" }[] = [
  { label: "Email", field: "email" },
  { label: "IAM user", field: "iam_username" },
  { label: "Role", field: "role" },
  { label: "Actions", field: null, align: "right" },
];

function getUserEmail(): string | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("user");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { email?: string | null };
    return parsed.email ?? null;
  } catch {
    return null;
  }
}

const normalizePortalRole = (role?: string | null): PortalAccountRole => {
  if (role === "portal_manager") return "portal_manager";
  return "portal_user";
};

const portalRoleLabel = (role?: string | null, iamOnly?: boolean | null) => {
  if (iamOnly) return "IAM (hors portail)";
  return role === "portal_manager" ? "Portal manager" : "Portal user";
};

const portalRoleBadgeClasses = (role?: string | null, iamOnly?: boolean | null) => {
  if (iamOnly) {
    return "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200";
  }
  if (role === "portal_manager") {
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-100";
  }
  return "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-100";
};

export default function PortalManagePage() {
  const { accountIdForApi, selectedAccount, hasAccountContext, loading: accountLoading, error: accountError } =
    usePortalAccountContext();
  const [portalState, setPortalState] = useState<PortalState | null>(null);
  const [stateLoading, setStateLoading] = useState(false);
  const [stateError, setStateError] = useState<string | null>(null);
  const [users, setUsers] = useState<PortalUserSummary[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [busyUserId, setBusyUserId] = useState<number | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingUser, setEditingUser] = useState<PortalUserSummary | null>(null);
  const [editRole, setEditRole] = useState<PortalAccountRole>("portal_user");
  const [editBuckets, setEditBuckets] = useState<string[]>([]);
  const [editSelectedBucket, setEditSelectedBucket] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editRemovingBucket, setEditRemovingBucket] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editMessage, setEditMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortState>({ field: "email", direction: "asc" });
  const userEmail = useMemo(() => getUserEmail(), []);
  const accountName = selectedAccount?.name ?? "compte selectionne";

  const canManagePortalUsers = Boolean(portalState?.can_manage_portal_users) || portalState?.account_role === "portal_manager";

  useEffect(() => {
    if (!accountIdForApi) {
      setPortalState(null);
      setStateError(null);
      setStateLoading(false);
      return;
    }
    setStateLoading(true);
    setStateError(null);
    fetchPortalState(accountIdForApi)
      .then((data) => {
        setPortalState(data);
      })
      .catch((err) => {
        console.error(err);
        setPortalState(null);
        setStateError("Impossible de charger le contexte portail.");
      })
      .finally(() => setStateLoading(false));
  }, [accountIdForApi]);

  useEffect(() => {
    setUsers([]);
    setUsersError(null);
    setUsersLoading(false);
    if (!accountIdForApi || !canManagePortalUsers) return;
    setUsersLoading(true);
    listPortalUsers(accountIdForApi)
      .then((data) => {
        setUsers(data);
      })
      .catch((err) => {
        console.error(err);
        setUsersError("Impossible de charger les utilisateurs du portail.");
      })
      .finally(() => setUsersLoading(false));
  }, [accountIdForApi, canManagePortalUsers]);

  useEffect(() => {
    setActionError(null);
    setActionMessage(null);
    setShowCreateModal(false);
    setShowEditModal(false);
    setEditingUser(null);
    setEditBuckets([]);
    setEditSelectedBucket("");
    setEditRole("portal_user");
    setEditError(null);
    setEditMessage(null);
  }, [accountIdForApi]);

  const toggleSort = (field: SortField) => {
    setSort((prev) => {
      if (prev.field === field) {
        return { field, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { field, direction: "asc" };
    });
  };

  const filteredUsers = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const items = query
      ? users.filter((u) => u.email.toLowerCase().includes(query) || (u.iam_username ?? "").toLowerCase().includes(query))
      : users;
    const sorted = [...items].sort((a, b) => {
      const aValue =
        sort.field === "iam_username"
          ? a.iam_username ?? ""
          : sort.field === "role"
            ? portalRoleLabel(a.role, a.iam_only)
            : a.email;
      const bValue =
        sort.field === "iam_username"
          ? b.iam_username ?? ""
          : sort.field === "role"
            ? portalRoleLabel(b.role, b.iam_only)
            : b.email;
      if (aValue === bValue) return 0;
      return sort.direction === "asc" ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
    });
    return sorted;
  }, [filter, sort.direction, sort.field, users]);

  const canRenderUsers =
    !accountLoading &&
    !accountError &&
    !stateError &&
    hasAccountContext &&
    !stateLoading &&
    canManagePortalUsers;
  const userCountLabel = canRenderUsers ? `${filteredUsers.length} utilisateur(s)` : "-";

  const openEditModal = (user: PortalUserSummary) => {
    if (!user.id || user.iam_only || !accountIdForApi || !canManagePortalUsers) return;
    setEditingUser(user);
    setEditRole(normalizePortalRole(user.role));
    setEditBuckets([]);
    setEditSelectedBucket("");
    setEditError(null);
    setEditMessage(null);
    setEditLoading(true);
    setShowEditModal(true);
    listPortalUserBuckets(accountIdForApi, user.id)
      .then((resp) => {
        const buckets = resp.buckets || [];
        setEditBuckets(buckets);
        const available = (portalState?.buckets || []).map((b) => b.name);
        const next = available.find((bucket) => !buckets.includes(bucket));
        setEditSelectedBucket(next ?? "");
      })
      .catch(() => {
        setEditError("Impossible de charger les droits buckets.");
      })
      .finally(() => setEditLoading(false));
  };

  const closeEditModal = () => {
    setShowEditModal(false);
    setEditingUser(null);
    setEditBuckets([]);
    setEditSelectedBucket("");
    setEditError(null);
    setEditMessage(null);
    setEditLoading(false);
    setEditSaving(false);
    setEditRemovingBucket(null);
  };

  const handleCreatePortalUser = async (event: FormEvent) => {
    event.preventDefault();
    if (!accountIdForApi || !canManagePortalUsers || !newUserEmail.trim()) return;
    setActionError(null);
    setActionMessage(null);
    setCreatingUser(true);
    try {
      const created = await addPortalUser(accountIdForApi, newUserEmail.trim());
      setUsers((prev) => [created, ...prev.filter((u) => u.id !== created.id)]);
      setActionMessage("Utilisateur ajoute au portail.");
      setNewUserEmail("");
      setShowCreateModal(false);
    } catch (err) {
      console.error(err);
      setActionError("Ajout impossible. Verifiez l'email et les droits.");
    } finally {
      setCreatingUser(false);
    }
  };

  const handleRemovePortalUser = async (user: PortalUserSummary) => {
    if (!accountIdForApi || !canManagePortalUsers || !user.id) return;
    if (userEmail && user.email === userEmail) {
      setActionError("Vous ne pouvez pas retirer votre propre acces.");
      return;
    }
    if (!confirmAction(`Retirer ${user.email} du portail ?`)) return;
    setActionError(null);
    setActionMessage(null);
    setBusyUserId(user.id);
    try {
      await deletePortalUser(accountIdForApi, user.id);
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
      setActionMessage("Utilisateur retire du portail.");
      if (editingUser?.id === user.id) {
        closeEditModal();
      }
    } catch (err) {
      console.error(err);
      setActionError("Suppression impossible. Verifiez vos droits.");
    } finally {
      setBusyUserId(null);
    }
  };

  const handleUpdatePortalRole = async () => {
    if (!accountIdForApi || !canManagePortalUsers || !editingUser?.id) return;
    const currentRole = normalizePortalRole(editingUser.role);
    if (editRole === currentRole) return;
    if (editRole === "portal_user" && editingUser.email === userEmail) {
      setEditError("Vous ne pouvez pas retirer vos propres droits de manager.");
      return;
    }
    setEditError(null);
    setEditMessage(null);
    setBusyUserId(editingUser.id);
    try {
      const updated = await updatePortalUserRole(accountIdForApi, editingUser.id, editRole);
      setUsers((prev) => prev.map((u) => (u.id === editingUser.id ? { ...u, role: updated.role ?? editRole } : u)));
      setEditingUser((prev) => (prev ? { ...prev, role: updated.role ?? editRole } : prev));
      setEditMessage("Role mis a jour.");
    } catch (err) {
      console.error(err);
      setEditError("Mise a jour impossible. Verifiez vos droits.");
    } finally {
      setBusyUserId(null);
    }
  };

  const handleGrantPortalBucket = async () => {
    if (!accountIdForApi || !editingUser?.id || !editSelectedBucket) return;
    setEditSaving(true);
    setEditError(null);
    setEditMessage(null);
    try {
      const resp = await grantPortalUserBucket(accountIdForApi, editingUser.id, editSelectedBucket);
      const buckets = resp.buckets || [];
      setEditBuckets(buckets);
      const available = (portalState?.buckets || []).map((b) => b.name);
      const next = available.find((bucket) => !buckets.includes(bucket));
      setEditSelectedBucket(next ?? "");
      setEditMessage(`Acces ajoute au bucket ${editSelectedBucket}.`);
    } catch (err) {
      console.error(err);
      setEditError("Ajout impossible. Verifiez vos droits.");
    } finally {
      setEditSaving(false);
    }
  };

  const handleRevokePortalBucket = async (bucketName: string) => {
    if (!accountIdForApi || !editingUser?.id || !bucketName) return;
    setEditRemovingBucket(bucketName);
    setEditError(null);
    setEditMessage(null);
    try {
      const resp = await revokePortalUserBucket(accountIdForApi, editingUser.id, bucketName);
      const buckets = resp.buckets || [];
      setEditBuckets(buckets);
      const available = (portalState?.buckets || []).map((b) => b.name);
      const next = available.find((bucket) => !buckets.includes(bucket));
      setEditSelectedBucket(next ?? "");
      setEditMessage(`Acces retire du bucket ${bucketName}.`);
    } catch (err) {
      console.error(err);
      setEditError("Retrait impossible. Verifiez vos droits.");
    } finally {
      setEditRemovingBucket(null);
    }
  };

  const pageDescription = selectedAccount
    ? `Gerez les utilisateurs et leurs droits buckets pour ${accountName}.`
    : "Gerez les utilisateurs et leurs droits buckets du portail.";

  const headerActions = [
    { label: "Retour au portail", to: "/portal", variant: "ghost" as const },
    ...(canManagePortalUsers ? [{ label: "Ajouter un utilisateur", onClick: () => setShowCreateModal(true) }] : []),
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Gestion du portail"
        description={pageDescription}
        breadcrumbs={[{ label: "Portail", to: "/portal" }, { label: "Gestion" }]}
        actions={headerActions}
      />

      {accountLoading && <PageBanner tone="info">Chargement du contexte portail...</PageBanner>}
      {accountError && <PageBanner tone="error">{accountError}</PageBanner>}
      {!accountLoading && !hasAccountContext && (
        <PageBanner tone="warning">Selectionnez un compte dans la barre superieure pour continuer.</PageBanner>
      )}
      {stateError && <PageBanner tone="error">{stateError}</PageBanner>}
      {!stateLoading && !stateError && hasAccountContext && !canManagePortalUsers && (
        <PageBanner tone="warning">Acces reserve aux managers du portail.</PageBanner>
      )}
      {actionError && <PageBanner tone="error">{actionError}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}

      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-4 dark:border-slate-800">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">Utilisateurs du portail</p>
              <p className="ui-caption text-slate-500 dark:text-slate-400">
                Role et droits buckets pour le compte selectionne.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <span className="ui-caption text-slate-500 dark:text-slate-400">{userCountLabel}</span>
              <div className="flex items-center gap-2 sm:justify-end">
                <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Filtre
                </span>
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Rechercher par email ou IAM"
                  disabled={!canRenderUsers}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:w-64 md:w-72"
                />
              </div>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="manager-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr>
                {userTableColumns.map((col) => (
                  <SortableHeader
                    key={col.label}
                    label={col.label}
                    field={col.field}
                    activeField={sort.field}
                    direction={sort.direction}
                    align={col.align ?? (col.label === "Actions" ? "right" : "left")}
                    onSort={col.field ? (field) => toggleSort(field as SortField) : undefined}
                  />
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {accountLoading && <TableEmptyState colSpan={userTableColumns.length} message="Chargement du contexte..." />}
              {accountError && !accountLoading && (
                <TableEmptyState colSpan={userTableColumns.length} message="Erreur de contexte." />
              )}
              {stateError && !accountLoading && !accountError && (
                <TableEmptyState colSpan={userTableColumns.length} message="Impossible de charger le contexte portail." />
              )}
              {!accountLoading && !accountError && !stateError && !hasAccountContext && (
                <TableEmptyState colSpan={userTableColumns.length} message="Selectionnez un compte pour continuer." />
              )}
              {!accountLoading && !accountError && !stateError && hasAccountContext && stateLoading && (
                <TableEmptyState colSpan={userTableColumns.length} message="Chargement des permissions..." />
              )}
              {!accountLoading && !accountError && !stateError && hasAccountContext && !stateLoading && !canManagePortalUsers && (
                <TableEmptyState colSpan={userTableColumns.length} message="Acces reserve aux managers du portail." />
              )}
              {canRenderUsers && usersLoading && (
                <TableEmptyState colSpan={userTableColumns.length} message="Chargement des utilisateurs..." />
              )}
              {canRenderUsers && !usersLoading && usersError && (
                <TableEmptyState colSpan={userTableColumns.length} message="Impossible de charger les utilisateurs." />
              )}
              {canRenderUsers && !usersLoading && !usersError && filteredUsers.length === 0 && (
                <TableEmptyState colSpan={userTableColumns.length} message="Aucun utilisateur portail." />
              )}
              {canRenderUsers &&
                !usersLoading &&
                !usersError &&
                filteredUsers.map((user) => {
                  const isIamOnly = Boolean(user.iam_only);
                  const isSelf = Boolean(userEmail && user.email === userEmail);
                  const busy = busyUserId === user.id;
                  return (
                    <tr key={user.id ?? user.email} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="manager-table-cell px-6 py-4 ui-body font-semibold text-slate-900 dark:text-slate-100">
                        <div className="flex flex-wrap items-center gap-2">
                          <span>{user.email}</span>
                          {isSelf && (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 ui-caption font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-200">
                              Vous
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="manager-table-cell px-6 py-4 ui-body text-slate-600 dark:text-slate-300">
                        <span className="font-mono">{user.iam_username || "-"}</span>
                      </td>
                      <td className="manager-table-cell px-6 py-4">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 ui-caption font-semibold ${portalRoleBadgeClasses(user.role, user.iam_only)}`}
                        >
                          {portalRoleLabel(user.role, user.iam_only)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {canManagePortalUsers && !isIamOnly ? (
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openEditModal(user)}
                              className={tableActionButtonClasses}
                              disabled={busy}
                            >
                              Gerer
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemovePortalUser(user)}
                              className={tableDeleteActionClasses}
                              disabled={busy || isSelf}
                            >
                              {busy ? "Suppression..." : "Retirer"}
                            </button>
                          </div>
                        ) : (
                          <span className="ui-caption text-slate-400">Lecture seule</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-4 dark:border-slate-800">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">Configuration du portail</p>
              <p className="ui-caption text-slate-500 dark:text-slate-400">
                Parametres specifiques a ce compte (a venir).
              </p>
            </div>
            <button
              type="button"
              className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-400"
              disabled
            >
              Configurer
            </button>
          </div>
        </div>
        <div className="px-4 py-4">
          <PageBanner tone="info">Cette section sera disponible dans un second temps.</PageBanner>
        </div>
      </div>

      {showCreateModal && (
        <Modal title="Ajouter un utilisateur" onClose={() => setShowCreateModal(false)}>
          {actionError && (
            <PageBanner tone="error" className="mb-3">
              {actionError}
            </PageBanner>
          )}
          <form onSubmit={handleCreatePortalUser} className="space-y-3">
            <div className="flex flex-col gap-1">
              <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Email *</label>
              <input
                type="email"
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
                placeholder="prenom.nom@example.com"
                className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                required
              />
              <p className="ui-caption text-slate-500 dark:text-slate-400">
                Le role par defaut est "Portal user". Vous pourrez promouvoir ensuite.
              </p>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={creatingUser || !newUserEmail.trim()}
                className="rounded-md bg-primary px-4 py-2 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
              >
                {creatingUser ? "Ajout..." : "Ajouter"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showEditModal && editingUser && (
        <Modal title={`Gerer ${editingUser.email}`} onClose={closeEditModal}>
          {editError && (
            <PageBanner tone="error" className="mb-3">
              {editError}
            </PageBanner>
          )}
          {editMessage && (
            <PageBanner tone="success" className="mb-3">
              {editMessage}
            </PageBanner>
          )}
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Email</span>
                <div className="rounded-md border border-slate-200 px-3 py-2 ui-body text-slate-700 dark:border-slate-700 dark:text-slate-100">
                  {editingUser.email}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">IAM user</span>
                <div className="rounded-md border border-slate-200 px-3 py-2 font-mono ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100">
                  {editingUser.iam_username || "-"}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Role portail</p>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">Definit les droits de gestion du portail.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value as PortalAccountRole)}
                    className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="portal_user">Portal user</option>
                    <option value="portal_manager">Portal manager</option>
                  </select>
                  <button
                    type="button"
                    onClick={handleUpdatePortalRole}
                    disabled={busyUserId === editingUser.id}
                    className="rounded-md bg-slate-900 px-3 py-2 ui-caption font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                  >
                    {busyUserId === editingUser.id ? "Mise a jour..." : "Mettre a jour"}
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Droits buckets</p>
                <span className="ui-caption text-slate-400 dark:text-slate-500">{editBuckets.length} autorise(s)</span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <div>
                  <label className="ui-caption font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Ajouter</label>
                  <select
                    value={editSelectedBucket}
                    onChange={(e) => setEditSelectedBucket(e.target.value)}
                    disabled={
                      editLoading ||
                      editSaving ||
                      Boolean(editRemovingBucket) ||
                      (portalState?.buckets || []).length === 0
                    }
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="">Selectionnez un bucket</option>
                    {(portalState?.buckets || []).map((bucket) => (
                      <option key={bucket.name} value={bucket.name} disabled={editBuckets.includes(bucket.name)}>
                        {bucket.name} {editBuckets.includes(bucket.name) ? "(deja autorise)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={handleGrantPortalBucket}
                  disabled={editLoading || editSaving || Boolean(editRemovingBucket) || !editSelectedBucket}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 ui-body font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
                >
                  {editSaving ? "Ajout..." : "Autoriser"}
                </button>
              </div>
              <div className="mt-3">
                {editLoading ? (
                  <div className="ui-body text-slate-500 dark:text-slate-400">Chargement...</div>
                ) : editBuckets.length === 0 ? (
                  <p className="ui-body text-slate-500 dark:text-slate-400">Aucun bucket autorise pour cet utilisateur.</p>
                ) : (
                  <div className="divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                    {editBuckets.map((name) => {
                      const removing = editRemovingBucket === name;
                      return (
                        <div key={name} className="flex items-center justify-between gap-3 px-3 py-2 ui-body">
                          <span className="font-mono text-slate-700 dark:text-slate-200">{name}</span>
                          <button
                            type="button"
                            onClick={() => handleRevokePortalBucket(name)}
                            disabled={editSaving || Boolean(editRemovingBucket)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600"
                            aria-label={`Retirer l'acces au bucket ${name}`}
                            title={`Retirer l'acces au bucket ${name}`}
                          >
                            <span aria-hidden>{removing ? "..." : "✕"}</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
