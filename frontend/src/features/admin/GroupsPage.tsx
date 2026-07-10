/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  UiGroup,
  UiGroupPayload,
  createGroup,
  deleteGroup,
  listGroups,
  updateGroup,
} from "../../api/groups";
import { AccountMembership, UserSummary, listMinimalUsers } from "../../api/users";
import { S3AccountSummary, listMinimalS3Accounts } from "../../api/accounts";
import { S3UserSummary, listMinimalS3Users } from "../../api/s3Users";
import { S3ConnectionSummary, listMinimalS3Connections } from "../../api/s3ConnectionsAdmin";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import ListToolbar from "../../components/ListToolbar";
import WorkflowPage, { workflowPageHostClass } from "../../components/WorkflowPage";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import ToolbarSearchInput from "../../components/ToolbarSearchInput";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import AssociationSummary, {
  AccountAssociationChips,
  AssociationChips,
  type AssociationAccountItem,
  type AssociationChipItem,
} from "./AssociationSummary";
import {
  BrowserAccessSection,
  ManagerToolAccessSection,
  WorkspaceAccessSection,
} from "./AdminAccessSections";
import {
  AdminAssociationSelectionPanel,
  adminAssociationAccountOptionRowClass,
  adminAssociationAccountOptionLabelClass,
  adminAssociationAdminLabelClass,
  adminAssociationCheckboxClass,
  adminAssociationCompactSelectClass,
  adminAssociationOptionRowClass,
  adminAssociationTableClass as tableClass,
  adminAssociationTableContainerClass as tableContainerClass,
} from "./AdminAssociationPicker";
import AdminModalTabs from "./AdminModalTabs";
import {
  DEFAULT_MANAGER_TOOL_ACCESS,
  PORTAL_ROLE_OPTIONS,
  buildManagerToolDefinitions,
  normalizeManagerToolAccess,
  normalizePortalRole,
  type ManagerToolKey,
} from "./adminAccessConfig";
import PageTabs from "../../components/PageTabs";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { extractApiError } from "../../utils/apiError";

type GroupModalTab = "general" | "members" | "associations" | "workspaces" | "browser" | "manager_tools";
type AssociationTab = "accounts" | "s3_users" | "connections";
const labelClass = "ui-body font-medium text-slate-700 dark:text-slate-200";
const fieldClass =
  "rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2 ui-body text-[var(--ui-text)] shadow-[var(--ui-shadow-soft)] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30";
const secondaryButtonClass =
  "rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface)] px-3 py-1.5 ui-caption font-semibold text-[var(--ui-text)] hover:bg-[var(--ui-hover)]";
function accountDbId(account: S3AccountSummary): number {
  return Number(account.db_id ?? account.id);
}

function includesQuery(label: string, query: string): boolean {
  return !query || label.toLowerCase().includes(query.trim().toLowerCase());
}

export default function GroupsPage() {
  type SortField = "name" | "created_at" | "updated_at";

  const { generalSettings } = useGeneralSettings();
  const showPortalRole = Boolean(generalSettings.portal_enabled);
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
    browser_advanced_features_enabled: false,
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
    () => buildManagerToolDefinitions(generalSettings),
    [generalSettings]
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
      browser_advanced_features_enabled: false,
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
      browser_advanced_features_enabled: Boolean(group.browser_advanced_features_enabled),
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
      browser_advanced_features_enabled: Boolean(form.browser_advanced_features_enabled),
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
    <AdminAssociationSelectionPanel
      title="Members"
      countLabel={`${selectedUserIds.size} selected`}
      search={memberSearch}
      onSearchChange={setMemberSearch}
      loading={auxLoading}
      loadingLabel="Loading users..."
      availableCount={visibleUsers.length}
      emptyLabel="No users."
      searchAriaLabel="Search group members"
    >
      {visibleUsers.map((user) => (
        <label
          key={user.id}
          className={adminAssociationOptionRowClass(selectedUserIds.has(user.id))}
        >
          <span className="ui-body text-slate-700 dark:text-slate-200">{user.email}</span>
          <input
            type="checkbox"
            checked={selectedUserIds.has(user.id)}
            onChange={(event) => setSelectedMembers(user.id, event.target.checked)}
            className={adminAssociationCheckboxClass}
          />
        </label>
      ))}
    </AdminAssociationSelectionPanel>
  );

  const renderAssociationsTab = () => (
    <PageTabs
      tabs={[
        {
          id: "accounts",
          label: `Accounts (${selectedAccountIds.size})`,
          content: (
            <AdminAssociationSelectionPanel
              title="Accounts"
              countLabel={`${selectedAccountIds.size} selected`}
              search={accountSearch}
              onSearchChange={setAccountSearch}
              loading={auxLoading}
              loadingLabel="Loading accounts..."
              availableCount={visibleAccounts.length}
              emptyLabel="No accounts."
              searchAriaLabel="Search group accounts"
            >
              {visibleAccounts.map((account) => {
                const accountId = accountDbId(account);
                const selected = selectedAccountIds.has(accountId);
                const link = selectedAccountById.get(accountId);
                return (
                  <div
                    key={accountId}
                    className={adminAssociationAccountOptionRowClass(selected)}
                  >
                    <label className={adminAssociationAccountOptionLabelClass}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(event) => setSelectedAccount(accountId, event.target.checked)}
                        className={adminAssociationCheckboxClass}
                      />
                      <span>{account.name}</span>
                    </label>
                    {selected && (
                      <div className="flex flex-wrap items-center gap-2">
                        <label className={adminAssociationAdminLabelClass}>
                          <input
                            type="checkbox"
                            checked={Boolean(link?.account_admin)}
                            onChange={(event) => updateAccountSelection(accountId, { account_admin: event.target.checked })}
                            className={adminAssociationCheckboxClass}
                          />
                          Admin
                        </label>
                        {showPortalRole && (
                          <select
                            value={normalizePortalRole(link?.account_role)}
                            onChange={(event) => updateAccountSelection(accountId, { account_role: normalizePortalRole(event.target.value) })}
                            className={adminAssociationCompactSelectClass}
                          >
                            {PORTAL_ROLE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </AdminAssociationSelectionPanel>
          ),
        },
        {
          id: "s3_users",
          label: `S3 Users (${selectedS3UserIds.size})`,
          content: (
            <AdminAssociationSelectionPanel
              title="S3 Users"
              countLabel={`${selectedS3UserIds.size} selected`}
              search={s3UserSearch}
              onSearchChange={setS3UserSearch}
              loading={auxLoading}
              loadingLabel="Loading S3 users..."
              availableCount={visibleS3Users.length}
              emptyLabel="No S3 users."
              searchAriaLabel="Search group S3 users"
            >
              {visibleS3Users.map((s3User) => (
                <label
                  key={s3User.id}
                  className={adminAssociationOptionRowClass(selectedS3UserIds.has(s3User.id))}
                >
                  <span className="ui-body text-slate-700 dark:text-slate-200">{s3User.name}</span>
                  <input
                    type="checkbox"
                    checked={selectedS3UserIds.has(s3User.id)}
                    onChange={(event) => setSelectedS3User(s3User.id, event.target.checked)}
                    className={adminAssociationCheckboxClass}
                  />
                </label>
              ))}
            </AdminAssociationSelectionPanel>
          ),
        },
        {
          id: "connections",
          label: `Connections (${selectedConnectionIds.size})`,
          content: (
            <AdminAssociationSelectionPanel
              title="Shared S3 connections"
              countLabel={`${selectedConnectionIds.size} selected`}
              search={connectionSearch}
              onSearchChange={setConnectionSearch}
              loading={auxLoading}
              loadingLabel="Loading shared S3 connections..."
              availableCount={visibleConnections.length}
              emptyLabel="No shared S3 connections."
              searchAriaLabel="Search group shared S3 connections"
            >
              {visibleConnections.map((connection) => (
                <label
                  key={connection.id}
                  className={adminAssociationOptionRowClass(selectedConnectionIds.has(connection.id))}
                >
                  <span className="ui-body text-slate-700 dark:text-slate-200">{connection.name}</span>
                  <input
                    type="checkbox"
                    checked={selectedConnectionIds.has(connection.id)}
                    onChange={(event) => setSelectedConnection(connection.id, event.target.checked)}
                    className={adminAssociationCheckboxClass}
                  />
                </label>
              ))}
            </AdminAssociationSelectionPanel>
          ),
        },
      ]}
      activeTab={associationTab}
      onChange={(id) => setAssociationTab(id === "s3_users" ? "s3_users" : id === "connections" ? "connections" : "accounts")}
    />
  );

  const renderGroupAssociations = (group: UiGroup) => {
    const accountDetailsById = new Map((group.account_details ?? []).map((account) => [Number(account.id), account]));
    const s3UserDetailsById = new Map((group.s3_user_details ?? []).map((user) => [Number(user.id), user]));
    const connectionDetailsById = new Map(
      (group.s3_connection_details ?? []).map((connection) => [Number(connection.id), connection])
    );
    const accountItems: AssociationAccountItem[] = (group.account_links ?? []).map((link) => {
      const accountId = Number(link.account_id);
      return {
        id: accountId,
        label:
          accountDetailsById.get(accountId)?.name ??
          accountOptionsById.get(accountId)?.name ??
          `Account #${link.account_id}`,
        account_admin: Boolean(link.account_admin),
        account_role: link.account_role,
      };
    });
    const userItems: AssociationChipItem[] = (group.user_details ?? []).map((user) => ({
      id: user.id,
      label: user.email,
    }));
    const s3UserItems: AssociationChipItem[] = (group.s3_users ?? []).map((id) => {
      const s3UserId = Number(id);
      return {
        id: s3UserId,
        label: s3UserDetailsById.get(s3UserId)?.name ?? s3UserLabelById.get(s3UserId) ?? `S3 User #${id}`,
      };
    });
    const connectionItems: AssociationChipItem[] = (group.s3_connections ?? []).map((id) => {
      const connectionId = Number(id);
      return {
        id: connectionId,
        label:
          connectionDetailsById.get(connectionId)?.name ??
          connectionLabelById.get(connectionId) ??
          `Connection #${id}`,
      };
    });
    return (
      <AssociationSummary
        sections={[
          {
            label: "Accounts",
            value: <AccountAssociationChips accounts={accountItems} showPortalRole={showPortalRole} />,
            visible: accountItems.length > 0,
          },
          { label: "Users", value: <AssociationChips items={userItems} />, visible: userItems.length > 0 },
          { label: "S3 Users", value: <AssociationChips items={s3UserItems} />, visible: s3UserItems.length > 0 },
          {
            label: "Connections",
            value: <AssociationChips items={connectionItems} />,
            visible: connectionItems.length > 0,
          },
        ]}
      />
    );
  };
  const groupTableColumns: Array<DataTableColumn<UiGroup, SortField>> = [
    {
      id: "name",
      label: "Name",
      field: "name",
      primary: true,
      cellClassName: "align-top min-w-[14rem]",
      render: (group) => (
        <button
          type="button"
          onClick={() => openEditModal(group)}
          className="w-full text-left transition hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:hover:text-primary-100"
        >
          <span>{group.name}</span>
          {group.description && (
            <span className="mt-1 block ui-caption font-normal text-slate-500 dark:text-slate-400">{group.description}</span>
          )}
        </button>
      ),
    },
    {
      id: "rights",
      label: "Rights",
      cellClassName: "align-top min-w-[12rem]",
      render: (group) => {
        const access = normalizeManagerToolAccess(group.manager_tool_access);
        const toolCount = Object.values(access).filter(Boolean).length;
        return (
          <div className="flex flex-wrap gap-2">
            {group.can_access_ceph_admin && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 ui-caption font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
                Ceph Admin
              </span>
            )}
            {group.can_access_storage_ops && (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 ui-caption font-semibold text-sky-800 dark:bg-sky-900/40 dark:text-sky-100">
                Storage Ops
              </span>
            )}
            {toolCount > 0 && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 ui-caption font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                {toolCount} Manager tools
              </span>
            )}
            {!group.can_access_ceph_admin && !group.can_access_storage_ops && toolCount === 0 && (
              <span className="ui-caption text-slate-500 dark:text-slate-400">No workspace/tool rights</span>
            )}
          </div>
        );
      },
    },
    {
      id: "associations",
      label: "Associations",
      cellClassName: "align-top min-w-[20rem]",
      render: (group) => renderGroupAssociations(group),
    },
    {
      id: "actions",
      label: "Actions",
      align: "right",
      mobileRole: "actions",
      cellClassName: "align-top",
      render: (group) => (
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
      ),
    },
  ];

  return (
    <div className={workflowPageHostClass(showModal)}>
      <PageHeader
        title="UI Groups"
        description="Create reusable UI access groups for workspace, Manager tool, and execution context access."
        breadcrumbs={adminPageBreadcrumbs("groups")}
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
            <ToolbarSearchInput
              value={filter}
              onChange={(value) => {
                setFilter(value);
                setPage(1);
              }}
              placeholder="Search by group, member, account, user, or connection"
              className="w-full sm:w-64 md:w-80"
            />
          }
        />
        <DataTableShell
          columns={groupTableColumns}
          rows={groups}
          rowKey={(group) => group.id}
          status={tableStatus}
          loadingMessage="Loading groups..."
          errorMessage="Unable to load groups."
          emptyMessage="No groups."
          sort={{ field: sort.field, direction: sort.direction, onSort: toggleSort }}
          pagination={{
            page,
            pageSize,
            total: totalGroups,
            onPageChange: (nextPage) => setPage(Math.max(1, nextPage)),
            onPageSizeChange: (nextSize) => {
              setPageSize(nextSize);
              setPage(1);
            },
            disabled: loading,
          }}
          primaryColumnId="name"
          responsiveCards
          tableClassName="compact-table"
        />
      </div>

      {showModal && (
        <WorkflowPage
          title={editingGroup ? "Edit UI group" : "Create UI group"}
          description="Manage members, associations and inherited workspace permissions in one dedicated page."
          breadcrumbs={[...adminPageBreadcrumbs("groups"), { label: editingGroup ? "Edit" : "Create" }]}
          backLabel="Back to groups"
          onBack={closeModal}
          contentClassName="mx-auto max-w-7xl"
        >
          {actionError && (
            <PageBanner tone="error" className="mb-3">
              {actionError}
            </PageBanner>
          )}
          <form onSubmit={submitGroup} className="space-y-4">
            <AdminModalTabs<GroupModalTab>
              activeTab={modalTab}
              onTabChange={setModalTab}
              tabs={[
                { id: "general", label: "General" },
                { id: "members", label: "Members" },
                { id: "associations", label: "Associations" },
                { id: "workspaces", label: "Workspaces" },
                { id: "browser", label: "Browser" },
                { id: "manager_tools", label: "Manager tools" },
              ]}
            />

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
              <WorkspaceAccessSection
                description="Additional operational workspaces inherited by group members."
                cephAdmin={{
                  title: "Ceph Admin access",
                  description: "Grant effective /ceph-admin access to members whose UI role is Admin or Superadmin.",
                  checked: Boolean(form.can_access_ceph_admin),
                  onChange: (value) => setForm((current) => ({ ...current, can_access_ceph_admin: value })),
                  ariaLabel: "Allow group access to /ceph-admin",
                }}
                storageOps={{
                  title: "Storage Ops access",
                  description: "Grant effective /storage-ops access to members with User, Admin, or Superadmin roles.",
                  checked: Boolean(form.can_access_storage_ops),
                  onChange: (value) => setForm((current) => ({ ...current, can_access_storage_ops: value })),
                  ariaLabel: "Allow group access to /storage-ops",
                }}
              />
            )}

            {modalTab === "browser" && (
              <BrowserAccessSection
                description="Browser options inherited by group members."
                checked={Boolean(form.browser_advanced_features_enabled)}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    browser_advanced_features_enabled: value,
                  }))
                }
              />
            )}

            {modalTab === "manager_tools" && (
              <div className="space-y-4">
                <ManagerToolAccessSection
                  title="Bucket tools"
                  description="Manager tools inherited by group members."
                  tools={managerToolDefinitions.filter((tool) => tool.key !== "ceph_s3_user_keys" && tool.key !== "bucket_quota")}
                  access={form.manager_tool_access}
                  onChange={(key: ManagerToolKey, value) =>
                    setForm((current) => ({
                      ...current,
                      manager_tool_access: {
                        ...normalizeManagerToolAccess(current.manager_tool_access),
                        [key]: value,
                      },
                    }))
                  }
                />
                <ManagerToolAccessSection
                  title="Privileged Ceph access"
                  description="Ceph admin-API actions inherited by group members outside the Ceph Admin workspace."
                  tools={managerToolDefinitions.filter((tool) => tool.key === "ceph_s3_user_keys" || tool.key === "bucket_quota")}
                  access={form.manager_tool_access}
                  onChange={(key: ManagerToolKey, value) =>
                    setForm((current) => ({
                      ...current,
                      manager_tool_access: {
                        ...normalizeManagerToolAccess(current.manager_tool_access),
                        [key]: value,
                      },
                    }))
                  }
                />
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
        </WorkflowPage>
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
