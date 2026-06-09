/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  UiGroup,
  UiGroupPayload,
  createGroup,
  deleteGroup,
  listGroups,
  updateGroup,
} from "../../api/groups";
import { AccountMembership, ManagerToolAccess, UserSummary, listMinimalUsers } from "../../api/users";
import { S3AccountSummary, listMinimalS3Accounts } from "../../api/accounts";
import { S3UserSummary, listMinimalS3Users } from "../../api/s3Users";
import { S3ConnectionSummary, listMinimalS3Connections } from "../../api/s3ConnectionsAdmin";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import ListToolbar from "../../components/ListToolbar";
import Modal from "../../components/Modal";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import PageTabs from "../../components/PageTabs";
import PaginationControls from "../../components/PaginationControls";
import {
  PortalSettingsItem,
  PortalSettingsSection,
  PortalSettingsToggleAction,
} from "../../components/PortalSettingsLayout";
import TableEmptyState from "../../components/TableEmptyState";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { toolbarCompactInputClasses } from "../../components/toolbarControlClasses";
import { cx, uiCardMutedClass, uiDataTableClass, uiTableContainerClass } from "../../components/ui/styles";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { extractApiError } from "../../utils/apiError";

type GroupModalTab = "general" | "members" | "associations" | "workspaces" | "manager_tools";
type AssociationTab = "accounts" | "s3_users" | "connections";
type PortalAccountRole = "portal_none" | "portal_user" | "portal_manager";
type AccountSelection = {
  account_id: number;
  account_admin?: boolean | null;
  account_role?: PortalAccountRole | string | null;
};

const DEFAULT_MANAGER_TOOL_ACCESS: ManagerToolAccess = {
  bucket_compare: false,
  bucket_integrity_check: false,
  bucket_migration: false,
  ceph_s3_user_keys: false,
};

const PORTAL_ROLE_OPTIONS: { value: PortalAccountRole; label: string }[] = [
  { value: "portal_none", label: "No portal access" },
  { value: "portal_user", label: "Portal user" },
  { value: "portal_manager", label: "Portal manager" },
];

const modalTabsContainerClass =
  "flex flex-wrap gap-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] p-1";
const modalTabButtonClass = (active: boolean) =>
  `rounded-md px-3 py-1.5 ui-caption font-semibold transition ${
    active
      ? "bg-[var(--ui-surface)] text-[var(--ui-text)] shadow-[var(--ui-shadow-soft)]"
      : "text-[var(--ui-text-muted)] hover:bg-[var(--ui-hover)] hover:text-[var(--ui-text)]"
  }`;
const labelClass = "ui-body font-medium text-slate-700 dark:text-slate-200";
const fieldClass =
  "rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2 ui-body text-[var(--ui-text)] shadow-[var(--ui-shadow-soft)] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30";
const compactInputClass =
  "w-full rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface)] px-2 py-1 ui-caption text-[var(--ui-text)] shadow-[var(--ui-shadow-soft)] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30";
const secondaryButtonClass =
  "rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface)] px-3 py-1.5 ui-caption font-semibold text-[var(--ui-text)] hover:bg-[var(--ui-hover)]";
const settingsGroupClass = "rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] p-4";
const tableContainerClass = uiTableContainerClass;
const tableClass = cx(uiDataTableClass, "compact-table min-w-full");
const addPanelClass = cx(uiCardMutedClass, "space-y-2 px-3 py-2");
const settingsItemSurfaceClass = (disabled: boolean) =>
  disabled ? "bg-[var(--ui-surface-muted)] opacity-75" : "bg-[var(--ui-surface)]";

function normalizePortalRole(value?: string | null): PortalAccountRole {
  if (value === "portal_user" || value === "portal_manager") return value;
  return "portal_none";
}

function normalizeManagerToolAccess(access?: ManagerToolAccess | null): ManagerToolAccess {
  return {
    bucket_compare: Boolean(access?.bucket_compare),
    bucket_integrity_check: Boolean(access?.bucket_integrity_check),
    bucket_migration: Boolean(access?.bucket_migration),
    ceph_s3_user_keys: Boolean(access?.ceph_s3_user_keys),
  };
}

function accountDbId(account: S3AccountSummary): number {
  return Number(account.db_id ?? account.id);
}

function includesQuery(label: string, query: string): boolean {
  return !query || label.toLowerCase().includes(query.trim().toLowerCase());
}

function GroupModalPrimaryTabs({
  activeTab,
  onTabChange,
}: {
  activeTab: GroupModalTab;
  onTabChange: (tab: GroupModalTab) => void;
}) {
  return (
    <div className={modalTabsContainerClass}>
      {[
        ["general", "General"],
        ["members", "Members"],
        ["associations", "Associations"],
        ["workspaces", "Workspaces"],
        ["manager_tools", "Manager tools"],
      ].map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onTabChange(id as GroupModalTab)}
          className={modalTabButtonClass(activeTab === id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function SelectionPanel({
  title,
  countLabel,
  search,
  onSearch,
  children,
}: {
  title: string;
  countLabel: string;
  search: string;
  onSearch: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div className={addPanelClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="ui-body font-medium text-slate-700 dark:text-slate-200">{title}</span>
          <span className="ml-2 ui-caption text-slate-500 dark:text-slate-400">{countLabel}</span>
        </div>
        <input
          type="text"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search..."
          className={`${compactInputClass} sm:w-56`}
        />
      </div>
      <div className="max-h-56 space-y-1 overflow-y-auto pr-1">{children}</div>
    </div>
  );
}

export default function GroupsPage() {
  type SortField = "name" | "created_at" | "updated_at";

  const { generalSettings } = useGeneralSettings();
  const [groups, setGroups] = useState<UiGroup[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [accounts, setAccounts] = useState<S3AccountSummary[]>([]);
  const [s3Users, setS3Users] = useState<S3UserSummary[]>([]);
  const [connections, setConnections] = useState<S3ConnectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [auxLoading, setAuxLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ field: SortField; direction: "asc" | "desc" }>({
    field: "name",
    direction: "asc",
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalGroups, setTotalGroups] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<UiGroup | null>(null);
  const [modalTab, setModalTab] = useState<GroupModalTab>("general");
  const [associationTab, setAssociationTab] = useState<AssociationTab>("accounts");
  const [pendingDeleteGroup, setPendingDeleteGroup] = useState<UiGroup | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [form, setForm] = useState<UiGroupPayload>({
    name: "",
    description: "",
    can_access_ceph_admin: false,
    can_access_storage_ops: false,
    manager_tool_access: DEFAULT_MANAGER_TOOL_ACCESS,
    user_ids: [],
    account_links: [],
    s3_user_ids: [],
    s3_connection_ids: [],
  });
  const [memberSearch, setMemberSearch] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [s3UserSearch, setS3UserSearch] = useState("");
  const [connectionSearch, setConnectionSearch] = useState("");

  const accountOptionsById = useMemo(() => {
    const map = new Map<number, S3AccountSummary>();
    accounts.forEach((account) => {
      const id = accountDbId(account);
      if (!Number.isNaN(id)) map.set(id, account);
    });
    return map;
  }, [accounts]);

  const s3UserLabelById = useMemo(() => {
    const map = new Map<number, string>();
    s3Users.forEach((user) => map.set(user.id, user.name));
    return map;
  }, [s3Users]);

  const connectionLabelById = useMemo(() => {
    const map = new Map<number, string>();
    connections.forEach((connection) => map.set(connection.id, connection.name));
    return map;
  }, [connections]);

  const managerToolDefinitions = useMemo(
    () => [
      {
        key: "bucket_compare" as const,
        title: "Bucket compare",
        description: "Allow access to Manager > Tools > Compare.",
        enabled: Boolean(generalSettings.bucket_compare_enabled),
      },
      {
        key: "bucket_integrity_check" as const,
        title: "Bucket integrity check",
        description: "Allow access to Manager > Tools > Integrity.",
        enabled: Boolean(generalSettings.bucket_integrity_check_enabled),
      },
      {
        key: "bucket_migration" as const,
        title: "Bucket migration",
        description: "Allow access to Manager > Tools > Migration.",
        enabled: Boolean(generalSettings.bucket_migration_enabled),
      },
      {
        key: "ceph_s3_user_keys" as const,
        title: "Ceph S3 User keys",
        description: "Allow access to Manager > Ceph > Access keys.",
        enabled: Boolean(generalSettings.manager_ceph_s3_user_keys_enabled),
      },
    ],
    [
      generalSettings.bucket_compare_enabled,
      generalSettings.bucket_integrity_check_enabled,
      generalSettings.bucket_migration_enabled,
      generalSettings.manager_ceph_s3_user_keys_enabled,
    ]
  );

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await listGroups({
        page,
        page_size: pageSize,
        search: filter.trim() || undefined,
        sort_by: sort.field,
        sort_dir: sort.direction,
      });
      const totalPages = Math.max(1, Math.ceil((response.total || 0) / pageSize));
      if (response.total > 0 && page > totalPages) {
        setPage(totalPages);
        return;
      }
      setGroups(response.items);
      setTotalGroups(response.total);
    } catch (err) {
      setError(extractApiError(err, "Unable to load groups."));
    } finally {
      setLoading(false);
    }
  }, [filter, page, pageSize, sort.direction, sort.field]);

  const loadAuxiliaryData = useCallback(async () => {
    setAuxLoading(true);
    try {
      const [nextUsers, nextAccounts, nextS3Users, nextConnections] = await Promise.all([
        listMinimalUsers(),
        listMinimalS3Accounts(),
        listMinimalS3Users(),
        listMinimalS3Connections(),
      ]);
      setUsers(nextUsers);
      setAccounts(nextAccounts);
      setS3Users(nextS3Users);
      setConnections(nextConnections.filter((connection) => connection.is_shared !== false));
    } catch (err) {
      setActionError(extractApiError(err, "Unable to load selectable resources."));
    } finally {
      setAuxLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: groups.length,
  });

  const toggleSort = (field: SortField) => {
    setSort((current) =>
      current.field === field
        ? { field, direction: current.direction === "asc" ? "desc" : "asc" }
        : { field, direction: "desc" }
    );
    setPage(1);
  };

  const resetForm = () => {
    setForm({
      name: "",
      description: "",
      can_access_ceph_admin: false,
      can_access_storage_ops: false,
      manager_tool_access: { ...DEFAULT_MANAGER_TOOL_ACCESS },
      user_ids: [],
      account_links: [],
      s3_user_ids: [],
      s3_connection_ids: [],
    });
    setModalTab("general");
    setAssociationTab("accounts");
    setMemberSearch("");
    setAccountSearch("");
    setS3UserSearch("");
    setConnectionSearch("");
  };

  const openCreateModal = () => {
    setEditingGroup(null);
    resetForm();
    setShowModal(true);
    setActionError(null);
    setActionMessage(null);
    void loadAuxiliaryData();
  };

  const openEditModal = (group: UiGroup) => {
    setEditingGroup(group);
    setForm({
      name: group.name,
      description: group.description ?? "",
      can_access_ceph_admin: Boolean(group.can_access_ceph_admin),
      can_access_storage_ops: Boolean(group.can_access_storage_ops),
      manager_tool_access: normalizeManagerToolAccess(group.manager_tool_access),
      user_ids: group.user_ids ?? [],
      account_links:
        group.account_links?.map((link) => ({
          account_id: Number(link.account_id),
          account_admin: Boolean(link.account_admin),
          account_role: normalizePortalRole(link.account_role),
        })) ?? [],
      s3_user_ids: group.s3_users ?? [],
      s3_connection_ids: group.s3_connections ?? [],
    });
    setModalTab("general");
    setAssociationTab("accounts");
    setActionError(null);
    setActionMessage(null);
    setShowModal(true);
    void loadAuxiliaryData();
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingGroup(null);
    resetForm();
  };

  const setSelectedMembers = (userId: number, selected: boolean) => {
    setForm((current) => {
      const ids = new Set(current.user_ids ?? []);
      if (selected) ids.add(userId);
      else ids.delete(userId);
      return { ...current, user_ids: [...ids].sort((a, b) => a - b) };
    });
  };

  const setSelectedS3User = (s3UserId: number, selected: boolean) => {
    setForm((current) => {
      const ids = new Set(current.s3_user_ids ?? []);
      if (selected) ids.add(s3UserId);
      else ids.delete(s3UserId);
      return { ...current, s3_user_ids: [...ids].sort((a, b) => a - b) };
    });
  };

  const setSelectedConnection = (connectionId: number, selected: boolean) => {
    setForm((current) => {
      const ids = new Set(current.s3_connection_ids ?? []);
      if (selected) ids.add(connectionId);
      else ids.delete(connectionId);
      return { ...current, s3_connection_ids: [...ids].sort((a, b) => a - b) };
    });
  };

  const setSelectedAccount = (accountId: number, selected: boolean) => {
    setForm((current) => {
      const links = [...(current.account_links ?? [])];
      const existing = links.find((link) => Number(link.account_id) === accountId);
      if (selected && !existing) {
        links.push({ account_id: accountId, account_admin: false, account_role: "portal_none" });
      }
      return {
        ...current,
        account_links: selected ? links.sort((a, b) => Number(a.account_id) - Number(b.account_id)) : links.filter((link) => Number(link.account_id) !== accountId),
      };
    });
  };

  const updateAccountSelection = (accountId: number, patch: Partial<AccountMembership>) => {
    setForm((current) => ({
      ...current,
      account_links: (current.account_links ?? []).map((link) =>
        Number(link.account_id) === accountId ? { ...link, ...patch } : link
      ),
    }));
  };

  const submitGroup = async (event: FormEvent) => {
    event.preventDefault();
    const name = String(form.name || "").trim();
    if (!name) {
      setModalTab("general");
      setActionError("Group name is required.");
      return;
    }
    const payload: UiGroupPayload = {
      name,
      description: form.description || null,
      can_access_ceph_admin: Boolean(form.can_access_ceph_admin),
      can_access_storage_ops: Boolean(form.can_access_storage_ops),
      manager_tool_access: normalizeManagerToolAccess(form.manager_tool_access),
      user_ids: form.user_ids ?? [],
      account_links:
        form.account_links?.map((link) => ({
          account_id: Number(link.account_id),
          account_admin: Boolean(link.account_admin),
          account_role: normalizePortalRole(link.account_role),
        })) ?? [],
      s3_user_ids: form.s3_user_ids ?? [],
      s3_connection_ids: form.s3_connection_ids ?? [],
    };
    try {
      if (editingGroup) {
        setBusyId(editingGroup.id);
        await updateGroup(editingGroup.id, payload);
        setActionMessage("Group updated");
      } else {
        await createGroup(payload);
        setActionMessage("Group created");
      }
      closeModal();
      await fetchGroups();
    } catch (err) {
      setActionError(extractApiError(err, "Unable to save group."));
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDeleteGroup) return;
    setBusyId(pendingDeleteGroup.id);
    setActionError(null);
    setActionMessage(null);
    try {
      await deleteGroup(pendingDeleteGroup.id);
      setActionMessage("Group deleted");
      await fetchGroups();
    } catch (err) {
      setActionError(extractApiError(err, "Unable to delete group."));
    } finally {
      setBusyId(null);
      setPendingDeleteGroup(null);
    }
  };

  const selectedUserIds = new Set(form.user_ids ?? []);
  const selectedS3UserIds = new Set(form.s3_user_ids ?? []);
  const selectedConnectionIds = new Set(form.s3_connection_ids ?? []);
  const selectedAccountIds = new Set((form.account_links ?? []).map((link) => Number(link.account_id)));
  const selectedAccountById = new Map((form.account_links ?? []).map((link) => [Number(link.account_id), link]));
  const visibleUsers = users.filter((user) => includesQuery(user.email, memberSearch));
  const visibleAccounts = accounts.filter((account) => includesQuery(account.name, accountSearch));
  const visibleS3Users = s3Users.filter((user) => includesQuery(user.name, s3UserSearch));
  const visibleConnections = connections.filter((connection) => includesQuery(connection.name, connectionSearch));

  const renderMembersTab = () => (
    <SelectionPanel
      title="Members"
      countLabel={`${selectedUserIds.size} selected`}
      search={memberSearch}
      onSearch={setMemberSearch}
    >
      {auxLoading && <p className="ui-caption text-slate-500 dark:text-slate-400">Loading users...</p>}
      {!auxLoading && visibleUsers.length === 0 && <p className="ui-caption text-slate-500 dark:text-slate-400">No users.</p>}
      {visibleUsers.map((user) => (
        <label
          key={user.id}
          className="flex items-center justify-between rounded-md px-2 py-1 hover:bg-[var(--ui-hover)]"
        >
          <span className="ui-body text-slate-700 dark:text-slate-200">{user.email}</span>
          <input
            type="checkbox"
            checked={selectedUserIds.has(user.id)}
            onChange={(event) => setSelectedMembers(user.id, event.target.checked)}
            className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
          />
        </label>
      ))}
    </SelectionPanel>
  );

  const renderAssociationsTab = () => (
    <PageTabs
      tabs={[
        {
          id: "accounts",
          label: `Accounts (${selectedAccountIds.size})`,
          content: (
            <SelectionPanel
              title="Accounts"
              countLabel={`${selectedAccountIds.size} selected`}
              search={accountSearch}
              onSearch={setAccountSearch}
            >
              {visibleAccounts.map((account) => {
                const accountId = accountDbId(account);
                const selected = selectedAccountIds.has(accountId);
                const link = selectedAccountById.get(accountId);
                return (
                  <div
                    key={accountId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-[var(--ui-hover)]"
                  >
                    <label className="flex min-w-48 items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(event) => setSelectedAccount(accountId, event.target.checked)}
                        className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
                      />
                      <span>{account.name}</span>
                    </label>
                    {selected && (
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-1 ui-caption font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={Boolean(link?.account_admin)}
                            onChange={(event) => updateAccountSelection(accountId, { account_admin: event.target.checked })}
                            className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
                          />
                          Admin
                        </label>
                        <select
                          value={normalizePortalRole(link?.account_role)}
                          onChange={(event) => updateAccountSelection(accountId, { account_role: normalizePortalRole(event.target.value) })}
                          className={`${compactInputClass} w-44`}
                        >
                          {PORTAL_ROLE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                );
              })}
            </SelectionPanel>
          ),
        },
        {
          id: "s3_users",
          label: `S3 Users (${selectedS3UserIds.size})`,
          content: (
            <SelectionPanel
              title="S3 Users"
              countLabel={`${selectedS3UserIds.size} selected`}
              search={s3UserSearch}
              onSearch={setS3UserSearch}
            >
              {visibleS3Users.map((s3User) => (
                <label
                  key={s3User.id}
                  className="flex items-center justify-between rounded-md px-2 py-1 hover:bg-[var(--ui-hover)]"
                >
                  <span className="ui-body text-slate-700 dark:text-slate-200">{s3User.name}</span>
                  <input
                    type="checkbox"
                    checked={selectedS3UserIds.has(s3User.id)}
                    onChange={(event) => setSelectedS3User(s3User.id, event.target.checked)}
                    className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
                  />
                </label>
              ))}
            </SelectionPanel>
          ),
        },
        {
          id: "connections",
          label: `Connections (${selectedConnectionIds.size})`,
          content: (
            <SelectionPanel
              title="Shared S3 connections"
              countLabel={`${selectedConnectionIds.size} selected`}
              search={connectionSearch}
              onSearch={setConnectionSearch}
            >
              {visibleConnections.map((connection) => (
                <label
                  key={connection.id}
                  className="flex items-center justify-between rounded-md px-2 py-1 hover:bg-[var(--ui-hover)]"
                >
                  <span className="ui-body text-slate-700 dark:text-slate-200">{connection.name}</span>
                  <input
                    type="checkbox"
                    checked={selectedConnectionIds.has(connection.id)}
                    onChange={(event) => setSelectedConnection(connection.id, event.target.checked)}
                    className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
                  />
                </label>
              ))}
            </SelectionPanel>
          ),
        },
      ]}
      activeTab={associationTab}
      onChange={(id) => setAssociationTab(id === "s3_users" ? "s3_users" : id === "connections" ? "connections" : "accounts")}
    />
  );

  const renderGroupAssociations = (group: UiGroup) => {
    const labels = [
      ...(group.user_details ?? []).map((user) => user.email),
      ...(group.account_links ?? []).map((link) => {
        const label = accountOptionsById.get(Number(link.account_id))?.name ?? `Account #${link.account_id}`;
        const badges = [
          link.account_admin ? "Admin" : null,
          normalizePortalRole(link.account_role) !== "portal_none"
            ? normalizePortalRole(link.account_role) === "portal_manager"
              ? "Portal manager"
              : "Portal user"
            : null,
        ].filter(Boolean);
        return badges.length ? `${label} (${badges.join(", ")})` : label;
      }),
      ...(group.s3_users ?? []).map((id) => s3UserLabelById.get(Number(id)) ?? `S3 User #${id}`),
      ...(group.s3_connections ?? []).map((id) => connectionLabelById.get(Number(id)) ?? `Connection #${id}`),
    ];
    if (labels.length === 0) return <span className="ui-caption text-slate-500 dark:text-slate-400">-</span>;
    return (
      <div className="flex flex-wrap gap-2">
        {labels.slice(0, 8).map((label) => (
          <span
            key={label}
            className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 ui-caption font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-100"
          >
            {label}
          </span>
        ))}
        {labels.length > 8 && <span className="ui-caption text-slate-500">+{labels.length - 8} more</span>}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="UI Groups"
        description="Create reusable UI access groups for workspace, Manager tool, and execution context access."
        breadcrumbs={[{ label: "Admin" }, { label: "Platform" }, { label: "UI Groups" }]}
        actions={[{ label: "Create group", onClick: openCreateModal }]}
      />
      {actionError && <PageBanner tone="error">{actionError}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}

      <div className="ui-surface-card">
        <ListToolbar
          title="Groups"
          description="Search across group names, members, and linked resources."
          showHeading={false}
          countLabel={`${totalGroups} entr${totalGroups === 1 ? "y" : "ies"}`}
          search={
            <div className="flex items-center gap-2">
              <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Search
              </span>
              <input
                type="text"
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value);
                  setPage(1);
                }}
                placeholder="Search by group, member, account, user, or connection"
                className={`${toolbarCompactInputClasses} w-full sm:w-64 md:w-80`}
              />
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="compact-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr>
                {[
                  { label: "Name", field: "name" as SortField },
                  { label: "Rights", field: null },
                  { label: "Associations", field: null },
                  { label: "Actions", field: null },
                ].map((column) => (
                  <th
                    key={column.label}
                    onClick={column.field ? () => toggleSort(column.field) : undefined}
                    className={`px-6 py-3 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${
                      column.field ? "cursor-pointer hover:text-primary-700 dark:hover:text-primary-100" : ""
                    }`}
                  >
                    <div className={`flex items-center ${column.label === "Actions" ? "justify-end" : "gap-1"}`}>
                      <span>{column.label}</span>
                      {column.field && sort.field === column.field && (
                        <span className="ui-caption">{sort.direction === "asc" ? "▲" : "▼"}</span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {tableStatus === "loading" && <TableEmptyState colSpan={4} message="Loading groups..." />}
              {tableStatus === "error" && <TableEmptyState colSpan={4} message="Unable to load groups." tone="error" />}
              {tableStatus === "empty" && <TableEmptyState colSpan={4} message="No groups." />}
              {groups.map((group) => {
                const access = normalizeManagerToolAccess(group.manager_tool_access);
                const toolCount = Object.values(access).filter(Boolean).length;
                return (
                  <tr key={group.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-6 py-4 ui-body font-semibold text-slate-900 dark:text-slate-100">
                      <button
                        type="button"
                        onClick={() => openEditModal(group)}
                        className="w-full text-left transition hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:hover:text-primary-100"
                      >
                        {group.name}
                      </button>
                      {group.description && (
                        <p className="mt-1 ui-caption font-normal text-slate-500 dark:text-slate-400">{group.description}</p>
                      )}
                    </td>
                    <td className="px-6 py-4 ui-body text-slate-600 dark:text-slate-300">
                      <div className="flex flex-wrap gap-2">
                        {group.can_access_ceph_admin && <span className="rounded-full bg-amber-100 px-2 py-0.5 ui-caption font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-100">Ceph Admin</span>}
                        {group.can_access_storage_ops && <span className="rounded-full bg-sky-100 px-2 py-0.5 ui-caption font-semibold text-sky-800 dark:bg-sky-900/40 dark:text-sky-100">Storage Ops</span>}
                        {toolCount > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 ui-caption font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-100">{toolCount} Manager tools</span>}
                        {!group.can_access_ceph_admin && !group.can_access_storage_ops && toolCount === 0 && <span className="ui-caption text-slate-500 dark:text-slate-400">No workspace/tool rights</span>}
                      </div>
                    </td>
                    <td className="px-6 py-4 ui-body text-slate-600 dark:text-slate-300">
                      {renderGroupAssociations(group)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => openEditModal(group)} className={tableActionButtonClasses}>
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDeleteGroup(group)}
                          disabled={busyId === group.id}
                          className={tableDeleteActionClasses}
                        >
                          {busyId === group.id ? "Deleting..." : "Delete"}
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
          total={totalGroups}
          onPageChange={(nextPage) => setPage(Math.max(1, nextPage))}
          onPageSizeChange={(nextSize) => {
            setPageSize(nextSize);
            setPage(1);
          }}
          disabled={loading}
        />
      </div>

      {showModal && (
        <Modal title={editingGroup ? "Edit group" : "Create group"} onClose={closeModal}>
          {actionError && (
            <PageBanner tone="error" className="mb-3">
              {actionError}
            </PageBanner>
          )}
          <form onSubmit={submitGroup} className="space-y-4">
            <GroupModalPrimaryTabs activeTab={modalTab} onTabChange={setModalTab} />

            {modalTab === "general" && (
              <div className="grid grid-cols-1 gap-3">
                <div className="flex flex-col gap-1">
                  <label className={labelClass}>Name *</label>
                  <input
                    type="text"
                    className={fieldClass}
                    value={form.name ?? ""}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Storage operators"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className={labelClass}>Description</label>
                  <textarea
                    className={`${fieldClass} min-h-24`}
                    value={form.description ?? ""}
                    onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                    placeholder="Optional notes for administrators"
                  />
                </div>
              </div>
            )}

            {modalTab === "members" && renderMembersTab()}

            {modalTab === "associations" && (
              <div className={tableContainerClass}>
                <div className={tableClass}>{renderAssociationsTab()}</div>
              </div>
            )}

            {modalTab === "workspaces" && (
              <div className={settingsGroupClass}>
                <PortalSettingsSection
                  title="Mass management workspaces"
                  description="Additional operational workspaces inherited by group members."
                  layout="stack"
                >
                  <PortalSettingsItem
                    title="Ceph Admin access"
                    description="Grant effective /ceph-admin access to members whose UI role is Admin or Superadmin."
                    className={settingsItemSurfaceClass(false)}
                    action={
                      <PortalSettingsToggleAction
                        checked={Boolean(form.can_access_ceph_admin)}
                        onChange={(value) => setForm((current) => ({ ...current, can_access_ceph_admin: value }))}
                        ariaLabel="Allow group access to /ceph-admin"
                      />
                    }
                  />
                  <PortalSettingsItem
                    title="Storage Ops access"
                    description="Grant effective /storage-ops access to members with User, Admin, or Superadmin roles."
                    className={settingsItemSurfaceClass(false)}
                    action={
                      <PortalSettingsToggleAction
                        checked={Boolean(form.can_access_storage_ops)}
                        onChange={(value) => setForm((current) => ({ ...current, can_access_storage_ops: value }))}
                        ariaLabel="Allow group access to /storage-ops"
                      />
                    }
                  />
                </PortalSettingsSection>
              </div>
            )}

            {modalTab === "manager_tools" && (
              <div className="space-y-4">
                <div className={settingsGroupClass}>
                  <PortalSettingsSection
                    title="Bucket tools"
                    description="Manager tools inherited by group members."
                    layout="stack"
                  >
                    {managerToolDefinitions.map((tool) => {
                      const access = normalizeManagerToolAccess(form.manager_tool_access);
                      const disabled = !tool.enabled;
                      return (
                        <PortalSettingsItem
                          key={tool.key}
                          title={tool.title}
                          description={tool.description}
                          className={settingsItemSurfaceClass(disabled)}
                          action={
                            <PortalSettingsToggleAction
                              checked={Boolean(access[tool.key])}
                              disabled={disabled}
                              onChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  manager_tool_access: {
                                    ...normalizeManagerToolAccess(current.manager_tool_access),
                                    [tool.key]: value,
                                  },
                                }))
                              }
                              ariaLabel={tool.title}
                              badge={{ visible: disabled, label: "Disabled globally", tone: "neutral" }}
                            />
                          }
                        />
                      );
                    })}
                  </PortalSettingsSection>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-3">
              <button type="button" onClick={closeModal} className={secondaryButtonClass}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={busyId === editingGroup?.id}
                className="rounded-md bg-primary px-4 py-2 ui-body font-medium text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
              >
                {busyId === editingGroup?.id ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {pendingDeleteGroup && (
        <ConfirmActionDialog
          title="Delete UI group"
          description="This removes the group and stops members inheriting its UI access."
          confirmLabel="Delete group"
          details={[{ label: "Group", value: pendingDeleteGroup.name }]}
          impacts={[
            "Members keep their direct user permissions.",
            "Accounts, S3 users, and S3 connections remain in the platform.",
          ]}
          loading={busyId === pendingDeleteGroup.id}
          onCancel={() => setPendingDeleteGroup(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  );
}
