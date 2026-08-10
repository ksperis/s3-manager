/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  UiGroup,
  UiGroupPayload,
  type UiGroupAvatarIcon,
  createGroup,
  deleteGroupAvatar,
  deleteGroup,
  listGroups,
  uploadGroupAvatar,
  updateGroup,
} from "../../api/groups";
import { AccountMembership, UserSummary, listMinimalUsers } from "../../api/users";
import {
  ACCOUNT_ACCESS_ROLE_OPTIONS,
  normalizeAccountAccessRole,
} from "../../api/accountRoles";
import { S3AccountSummary, listMinimalS3Accounts } from "../../api/accounts";
import { S3UserSummary, listMinimalS3Users } from "../../api/s3Users";
import { S3ConnectionSummary, listMinimalS3Connections } from "../../api/s3ConnectionsAdmin";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import GroupAvatar from "../../components/GroupAvatar";
import ListPageSection from "../../components/list/ListPageSection";
import WorkflowPage, { WorkflowActions, workflowPageHostClass } from "../../components/WorkflowPage";
import WorkflowTabs from "../../components/WorkflowTabs";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import ToolbarSearchInput from "../../components/ToolbarSearchInput";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import {
  AssociationPrincipalStack,
  CompactAssociationSummary,
  accountAssociationRoleLabels,
  uiPrincipalRoleLabel,
  type AssociationAccountItem,
  type AssociationPrincipalItem,
  type CompactAssociationCategory,
} from "./AssociationSummary";
import {
  AdminAccessToggleSection,
  BrowserAccessSection,
  ManagerToolAccessSection,
  WorkspaceAccessSection,
} from "./AdminAccessSections";
import {
  AdminAssociationLinkedTable,
  AdminAssociationPickerPanel,
  adminAssociationAccountOptionRowClass,
  adminAssociationAccountOptionLabelClass,
  adminAssociationCheckboxClass,
  adminAssociationOptionRowClass,
  adminAssociationTableActionCellClass,
  adminAssociationTableControlCellClass,
  adminAssociationTableLabelCellClass,
} from "./AdminAssociationPicker";
import AdminAssociationAdvancedSettings from "./AdminAssociationAdvancedSettings";
import {
  DEFAULT_MANAGER_TOOL_ACCESS,
  buildManagerToolDefinitions,
  normalizeManagerToolAccess,
  type ManagerToolKey,
} from "./adminAccessConfig";
import PageTabs from "../../components/PageTabs";
import UiButton from "../../components/ui/UiButton";
import UiSelect from "../../components/ui/UiSelect";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { extractApiError } from "../../utils/apiError";
import {
  clearAdminPrincipalEditRequest,
  readAdminPrincipalEditRequest,
} from "./adminPrincipalEditLink";

type GroupModalTab = "general" | "members" | "associations" | "workspaces" | "connections" | "browser" | "manager";
type AssociationTab = "accounts" | "s3_users" | "connections";
const labelClass = "ui-body font-medium text-slate-700 dark:text-slate-200";
const fieldClass =
  "rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2 ui-body text-[var(--ui-text)] shadow-[var(--ui-shadow-soft)] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30";
const secondaryButtonClass =
  "rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface)] px-3 py-1.5 ui-caption font-semibold text-[var(--ui-text)] hover:bg-[var(--ui-hover)]";
const MAX_VISIBLE_OPTIONS = 10;
const groupAvatarIcons: Array<{ value: UiGroupAvatarIcon; label: string }> = [
  { value: "users", label: "Team" },
  { value: "building", label: "Organization" },
  { value: "shield", label: "Security" },
  { value: "briefcase", label: "Operations" },
  { value: "academic", label: "Research" },
];
function includesQuery(label: string, query: string): boolean {
  return !query || label.toLowerCase().includes(query.trim().toLowerCase());
}

export default function GroupsPage() {
  type SortField = "name" | "created_at" | "updated_at";

  const { generalSettings } = useGeneralSettings();
  const showPortalRole = Boolean(generalSettings.portal_enabled);
  const principalEditRequest = useMemo(
    () => readAdminPrincipalEditRequest(typeof window === "undefined" ? "" : window.location.search),
    [],
  );
  const requestedEditHandledRef = useRef(false);
  const openEditRef = useRef<(group: UiGroup) => void>(() => undefined);
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
  const [filter, setFilter] = useState(principalEditRequest?.search ?? "");
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
    can_create_manual_private_connections: false,
    can_provision_managed_private_connections: false,
    browser_advanced_features_enabled: false,
    manager_tool_access: DEFAULT_MANAGER_TOOL_ACCESS,
    user_ids: [],
    account_links: [],
    s3_user_links: [],
    s3_connection_ids: [],
  });
  const [memberSearch, setMemberSearch] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [s3UserSearch, setS3UserSearch] = useState("");
  const [connectionSearch, setConnectionSearch] = useState("");
  const [showMemberPicker, setShowMemberPicker] = useState(false);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [showS3UserPicker, setShowS3UserPicker] = useState(false);
  const [showConnectionPicker, setShowConnectionPicker] = useState(false);
  const [memberSelections, setMemberSelections] = useState<number[]>([]);
  const [accountSelections, setAccountSelections] = useState<number[]>([]);
  const [s3UserSelections, setS3UserSelections] = useState<number[]>([]);
  const [connectionSelections, setConnectionSelections] = useState<number[]>([]);
  const [accountPortalRoleChoice, setAccountPortalRoleChoice] = useState<Record<number, string>>({});
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [removeAvatarImage, setRemoveAvatarImage] = useState(false);
  const avatarFileUrl = useMemo(
    () => (avatarFile && typeof URL.createObjectURL === "function" ? URL.createObjectURL(avatarFile) : null),
    [avatarFile],
  );

  useEffect(() => () => {
    if (avatarFileUrl && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(avatarFileUrl);
  }, [avatarFileUrl]);

  const avatarPreview = avatarFileUrl
    ? { source: "uploaded" as const, initials: "", url: avatarFileUrl }
    : form.avatar_source === "preset"
      ? { source: "preset" as const, initials: "", icon: form.avatar_icon ?? "users" }
      : form.avatar_source === "uploaded" && editingGroup?.avatar
        ? editingGroup.avatar
        : { source: "initials" as const, initials: "" };

  const selectAvatarFile = (file: File | null) => {
    if (!file) return;
    if (!(["image/png", "image/jpeg"].includes(file.type)) || file.size > 1024 * 1024) {
      setActionError("Group image must be a PNG or JPEG file of 1 MiB or less.");
      return;
    }
    setActionError(null);
    setAvatarFile(file);
    setRemoveAvatarImage(false);
  };

  const accountOptionsById = useMemo(() => {
    const map = new Map<number, S3AccountSummary>();
    accounts.forEach((account) => {
      const id = account.id;
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
      setConnections(nextConnections);
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
      avatar_source: "initials",
      avatar_icon: null,
      can_access_ceph_admin: false,
      can_access_storage_ops: false,
      can_create_manual_private_connections: false,
      can_provision_managed_private_connections: false,
      browser_advanced_features_enabled: false,
      manager_tool_access: { ...DEFAULT_MANAGER_TOOL_ACCESS },
      user_ids: [],
      account_links: [],
      s3_user_links: [],
      s3_connection_ids: [],
    });
    setModalTab("general");
    setAssociationTab("accounts");
    setMemberSearch("");
    setAccountSearch("");
    setS3UserSearch("");
    setConnectionSearch("");
    setShowMemberPicker(false);
    setShowAccountPicker(false);
    setShowS3UserPicker(false);
    setShowConnectionPicker(false);
    setMemberSelections([]);
    setAccountSelections([]);
    setS3UserSelections([]);
    setConnectionSelections([]);
    setAccountPortalRoleChoice({});
    setAvatarFile(null);
    setRemoveAvatarImage(false);
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
      avatar_source: group.avatar?.source ?? "initials",
      avatar_icon: group.avatar?.icon ?? null,
      can_access_ceph_admin: Boolean(group.can_access_ceph_admin),
      can_access_storage_ops: Boolean(group.can_access_storage_ops),
      can_create_manual_private_connections: Boolean(group.can_create_manual_private_connections),
      can_provision_managed_private_connections: Boolean(group.can_provision_managed_private_connections),
      browser_advanced_features_enabled: Boolean(group.browser_advanced_features_enabled),
      manager_tool_access: normalizeManagerToolAccess(group.manager_tool_access),
      user_ids: (group.user_details ?? []).map((user) => Number(user.id)),
      account_links:
        group.account_links?.map((link) => ({
          account_id: Number(link.account_id),
          role: normalizeAccountAccessRole(link.role),
          allow_manager_browser_data_access: Boolean(link.allow_manager_browser_data_access),
        })) ?? [],
      s3_user_links: (group.s3_user_links ?? []).map((link) => ({
        s3_user_id: Number(link.s3_user_id),
        allow_manager_browser_data_access: Boolean(link.allow_manager_browser_data_access),
      })),
      s3_connection_ids: (group.s3_connection_details ?? []).map((connection) => Number(connection.id)),
    });
    setModalTab("general");
    setAssociationTab("accounts");
    setActionError(null);
    setActionMessage(null);
    setShowModal(true);
    void loadAuxiliaryData();
  };

  openEditRef.current = openEditModal;
  useEffect(() => {
    if (!principalEditRequest || requestedEditHandledRef.current) return;
    const requestedGroup = groups.find((group) => group.id === principalEditRequest.id);
    if (!requestedGroup) return;
    requestedEditHandledRef.current = true;
    openEditRef.current(requestedGroup);
  }, [groups, principalEditRequest]);

  const closeModal = () => {
    setShowModal(false);
    setEditingGroup(null);
    resetForm();
    clearAdminPrincipalEditRequest();
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
      avatar_source: avatarFile ? undefined : form.avatar_source,
      avatar_icon: form.avatar_icon,
      can_access_ceph_admin: Boolean(form.can_access_ceph_admin),
      can_access_storage_ops: Boolean(form.can_access_storage_ops),
      can_create_manual_private_connections: Boolean(form.can_create_manual_private_connections),
      can_provision_managed_private_connections: Boolean(form.can_provision_managed_private_connections),
      browser_advanced_features_enabled: Boolean(form.browser_advanced_features_enabled),
      manager_tool_access: normalizeManagerToolAccess(form.manager_tool_access),
      user_ids: form.user_ids ?? [],
      account_links:
        form.account_links?.map((link) => ({
          account_id: Number(link.account_id),
          role: normalizeAccountAccessRole(link.role),
          allow_manager_browser_data_access: Boolean(link.allow_manager_browser_data_access),
        })) ?? [],
      s3_user_links: form.s3_user_links ?? [],
      s3_connection_ids: form.s3_connection_ids ?? [],
    };
    try {
      let savedGroup: UiGroup;
      if (editingGroup) {
        setBusyId(editingGroup.id);
        savedGroup = await updateGroup(editingGroup.id, payload);
        setActionMessage("Group updated");
      } else {
        savedGroup = await createGroup(payload);
        setActionMessage("Group created");
      }
      if (avatarFile) {
        await uploadGroupAvatar(savedGroup.id, avatarFile);
      } else if (editingGroup && removeAvatarImage) {
        await deleteGroupAvatar(savedGroup.id);
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
  const selectedS3UserIds = new Set((form.s3_user_links ?? []).map((link) => link.s3_user_id));
  const selectedConnectionIds = new Set(form.s3_connection_ids ?? []);
  const selectedAccountIds = new Set((form.account_links ?? []).map((link) => Number(link.account_id)));
  const userLabelById = new Map(users.map((user) => [user.id, user.email]));
  const availableUsers = users.filter(
    (user) => !selectedUserIds.has(user.id) && includesQuery(user.email, memberSearch)
  );
  const availableAccounts = accounts.filter(
    (account) => !selectedAccountIds.has(account.id) && includesQuery(account.name, accountSearch)
  );
  const availableS3Users = s3Users.filter(
    (user) => !selectedS3UserIds.has(user.id) && includesQuery(user.name, s3UserSearch)
  );
  const availableConnections = connections.filter(
    (connection) => !selectedConnectionIds.has(connection.id) && includesQuery(connection.name, connectionSearch)
  );
  const visibleUsers = availableUsers.slice(0, MAX_VISIBLE_OPTIONS);
  const visibleAccounts = availableAccounts.slice(0, MAX_VISIBLE_OPTIONS);
  const visibleS3Users = availableS3Users.slice(0, MAX_VISIBLE_OPTIONS);
  const visibleConnections = availableConnections.slice(0, MAX_VISIBLE_OPTIONS);

  const togglePendingSelection = (
    setSelections: Dispatch<SetStateAction<number[]>>,
    id: number,
  ) => {
    setSelections((current) =>
      current.includes(id) ? current.filter((selectedId) => selectedId !== id) : [...current, id]
    );
  };

  const renderMembersTab = () => (
    <AdminAssociationLinkedTable
      title="Members"
      countLabel={`${selectedUserIds.size} linked`}
      actionLabel={showMemberPicker ? "Close" : "Add UI users"}
      onAction={() => setShowMemberPicker((current) => !current)}
      headers={[{ label: "User" }, { label: "Actions", align: "right" }]}
      hasItems={selectedUserIds.size > 0}
      emptyLabel="No linked users yet."
      rows={(form.user_ids ?? []).map((userId) => (
        <tr key={userId}>
          <td className={adminAssociationTableLabelCellClass}>
            {userLabelById.get(userId) ?? `User #${userId}`}
          </td>
          <td className={adminAssociationTableActionCellClass}>
            <button
              type="button"
              className={tableDeleteActionClasses}
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  user_ids: (current.user_ids ?? []).filter((id) => id !== userId),
                }))
              }
            >
              Remove
            </button>
          </td>
        </tr>
      ))}
      picker={
        showMemberPicker ? (
          <AdminAssociationPickerPanel
            title="Add UI users"
            hint="(filter by email)"
            search={memberSearch}
            onSearchChange={setMemberSearch}
            searchAriaLabel="Search group members"
            loading={auxLoading}
            availableCount={availableUsers.length}
            maxVisibleOptions={MAX_VISIBLE_OPTIONS}
            selectedCount={memberSelections.length}
            loadingLabel="Loading users..."
            emptyLabel="No users available."
            addDisabled={memberSelections.length === 0}
            onCancel={() => {
              setShowMemberPicker(false);
              setMemberSelections([]);
              setMemberSearch("");
            }}
            onAdd={() => {
              setForm((current) => ({
                ...current,
                user_ids: [...new Set([...(current.user_ids ?? []), ...memberSelections])].sort((a, b) => a - b),
              }));
              setShowMemberPicker(false);
              setMemberSelections([]);
              setMemberSearch("");
            }}
          >
            {visibleUsers.map((user) => (
              <label
                key={user.id}
                className={adminAssociationOptionRowClass(memberSelections.includes(user.id))}
              >
                <span className="ui-body text-slate-700 dark:text-slate-200">{user.email}</span>
                <input
                  type="checkbox"
                  checked={memberSelections.includes(user.id)}
                  onChange={() => togglePendingSelection(setMemberSelections, user.id)}
                  className={adminAssociationCheckboxClass}
                />
              </label>
            ))}
          </AdminAssociationPickerPanel>
        ) : undefined
      }
    />
  );

  const renderAssociationsTab = () => (
    <PageTabs
      tabs={[
        {
          id: "accounts",
          label: `Accounts (${selectedAccountIds.size})`,
          content: (
            <AdminAssociationLinkedTable
              title="Linked accounts"
              countLabel={`${selectedAccountIds.size} linked`}
              actionLabel={showAccountPicker ? "Close" : "Add accounts"}
              onAction={() => setShowAccountPicker((current) => !current)}
              headers={[
                { label: "Account" },
                { label: "Access role" },
                { label: "Actions", align: "right" as const },
              ]}
              hasItems={selectedAccountIds.size > 0}
              emptyLabel="No linked accounts yet."
              rows={(form.account_links ?? []).map((link) => {
                const accountId = Number(link.account_id);
                return (
                  <tr key={accountId}>
                    <td className={adminAssociationTableLabelCellClass}>
                      {accountOptionsById.get(accountId)?.name ?? `Account #${accountId}`}
                    </td>
                    <td className={adminAssociationTableControlCellClass}>
                      <UiSelect
                        aria-label={`Access role for ${accountOptionsById.get(accountId)?.name ?? `Account #${accountId}`}`}
                        size="compact"
                        fieldClassName="w-52"
                        value={normalizeAccountAccessRole(link.role)}
                        onChange={(event) =>
                          updateAccountSelection(accountId, { role: normalizeAccountAccessRole(event.target.value) })
                        }
                      >
                        {ACCOUNT_ACCESS_ROLE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </UiSelect>
                    </td>
                    <td className={adminAssociationTableActionCellClass}>
                      <AdminAssociationAdvancedSettings
                        targetLabel={accountOptionsById.get(accountId)?.name ?? `Account #${accountId}`}
                        associationKind="account"
                        allowManagerBrowserDataAccess={Boolean(link.allow_manager_browser_data_access)}
                        onApply={(allowed) =>
                          updateAccountSelection(accountId, {
                            allow_manager_browser_data_access: allowed,
                          })
                        }
                      />
                      <button
                        type="button"
                        className={tableDeleteActionClasses}
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            account_links: (current.account_links ?? []).filter(
                              (currentLink) => Number(currentLink.account_id) !== accountId
                            ),
                          }))
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
              picker={
                showAccountPicker ? (
                  <AdminAssociationPickerPanel
                    title="Add accounts"
                    hint="(search by name)"
                    search={accountSearch}
                    onSearchChange={setAccountSearch}
                    searchAriaLabel="Search group accounts"
                    loading={auxLoading}
                    availableCount={availableAccounts.length}
                    maxVisibleOptions={MAX_VISIBLE_OPTIONS}
                    selectedCount={accountSelections.length}
                    loadingLabel="Loading accounts..."
                    emptyLabel="No accounts available."
                    addDisabled={accountSelections.length === 0}
                    onCancel={() => {
                      setShowAccountPicker(false);
                      setAccountSelections([]);
                      setAccountSearch("");
                    }}
                    onAdd={() => {
                      setForm((current) => ({
                        ...current,
                        account_links: [
                          ...(current.account_links ?? []),
                          ...accountSelections.map((accountId) => ({
                            account_id: accountId,
                            role: accountPortalRoleChoice[accountId]
                              ? normalizeAccountAccessRole(accountPortalRoleChoice[accountId])
                              : showPortalRole
                                ? "portal_user" as const
                                : "account_administrator" as const,
                            allow_manager_browser_data_access: false,
                          })),
                        ].sort((left, right) => Number(left.account_id) - Number(right.account_id)),
                      }));
                      setShowAccountPicker(false);
                      setAccountSelections([]);
                      setAccountSearch("");
                    }}
                  >
                    {visibleAccounts.map((account) => {
                      const accountId = account.id;
                      const selected = accountSelections.includes(accountId);
                      return (
                        <div key={accountId} className={adminAssociationAccountOptionRowClass(selected)}>
                          <label className={adminAssociationAccountOptionLabelClass}>
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => togglePendingSelection(setAccountSelections, accountId)}
                              className={adminAssociationCheckboxClass}
                            />
                            <span>{account.name}</span>
                          </label>
                          <div className="flex flex-wrap items-center gap-2">
                            <UiSelect
                              aria-label={`Access role for ${account.name}`}
                              size="compact"
                              fieldClassName="w-52"
                              value={accountPortalRoleChoice[accountId] || (showPortalRole ? "portal_user" : "account_administrator")}
                              onChange={(event) =>
                                setAccountPortalRoleChoice((current) => ({
                                  ...current,
                                  [accountId]: normalizeAccountAccessRole(event.target.value),
                                }))
                              }
                            >
                              {ACCOUNT_ACCESS_ROLE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </UiSelect>
                          </div>
                        </div>
                      );
                    })}
                  </AdminAssociationPickerPanel>
                ) : undefined
              }
            />
          ),
        },
        {
          id: "s3_users",
          label: `S3 Users (${selectedS3UserIds.size})`,
          content: (
            <AdminAssociationLinkedTable
              title="Linked RGW users"
              countLabel={`${selectedS3UserIds.size} linked`}
              actionLabel={showS3UserPicker ? "Close" : "Add RGW users"}
              onAction={() => setShowS3UserPicker((current) => !current)}
              headers={[{ label: "RGW user" }, { label: "Actions", align: "right" }]}
              hasItems={selectedS3UserIds.size > 0}
              emptyLabel="No linked RGW users yet."
              rows={(form.s3_user_links ?? []).map((link) => (
                <tr key={link.s3_user_id}>
                  <td className={adminAssociationTableLabelCellClass}>
                    {s3UserLabelById.get(link.s3_user_id) ?? `RGW User #${link.s3_user_id}`}
                  </td>
                  <td className={adminAssociationTableActionCellClass}>
                    <AdminAssociationAdvancedSettings
                      targetLabel={s3UserLabelById.get(link.s3_user_id) ?? `RGW User #${link.s3_user_id}`}
                      associationKind="rgw_user"
                      allowManagerBrowserDataAccess={Boolean(link.allow_manager_browser_data_access)}
                      onApply={(allowed) =>
                        setForm((current) => ({
                          ...current,
                          s3_user_links: (current.s3_user_links ?? []).map((item) =>
                            item.s3_user_id === link.s3_user_id
                              ? { ...item, allow_manager_browser_data_access: allowed }
                              : item
                          ),
                        }))
                      }
                    />
                    <button
                      type="button"
                      className={tableDeleteActionClasses}
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          s3_user_links: (current.s3_user_links ?? []).filter(
                            (item) => item.s3_user_id !== link.s3_user_id
                          ),
                        }))
                      }
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              picker={
                showS3UserPicker ? (
                  <AdminAssociationPickerPanel
                    title="Add RGW users"
                    hint="(search by name)"
                    search={s3UserSearch}
                    onSearchChange={setS3UserSearch}
                    searchAriaLabel="Search group S3 users"
                    loading={auxLoading}
                    availableCount={availableS3Users.length}
                    maxVisibleOptions={MAX_VISIBLE_OPTIONS}
                    selectedCount={s3UserSelections.length}
                    loadingLabel="Loading RGW users..."
                    emptyLabel="No RGW users available."
                    addDisabled={s3UserSelections.length === 0}
                    onCancel={() => {
                      setShowS3UserPicker(false);
                      setS3UserSelections([]);
                      setS3UserSearch("");
                    }}
                    onAdd={() => {
                      setForm((current) => ({
                        ...current,
                        s3_user_links: [
                          ...(current.s3_user_links ?? []),
                          ...s3UserSelections.map((s3UserId) => ({
                            s3_user_id: s3UserId,
                            allow_manager_browser_data_access: false,
                          })),
                        ].sort((a, b) => a.s3_user_id - b.s3_user_id),
                      }));
                      setShowS3UserPicker(false);
                      setS3UserSelections([]);
                      setS3UserSearch("");
                    }}
                  >
                    {visibleS3Users.map((s3User) => (
                      <label
                        key={s3User.id}
                        className={adminAssociationOptionRowClass(s3UserSelections.includes(s3User.id))}
                      >
                        <span className="ui-body text-slate-700 dark:text-slate-200">{s3User.name}</span>
                        <input
                          type="checkbox"
                          checked={s3UserSelections.includes(s3User.id)}
                          onChange={() => togglePendingSelection(setS3UserSelections, s3User.id)}
                          className={adminAssociationCheckboxClass}
                        />
                      </label>
                    ))}
                  </AdminAssociationPickerPanel>
                ) : undefined
              }
            />
          ),
        },
        {
          id: "connections",
          label: `Connections (${selectedConnectionIds.size})`,
          content: (
            <AdminAssociationLinkedTable
              title="Linked shared S3 connections"
              countLabel={`${selectedConnectionIds.size} linked`}
              actionLabel={showConnectionPicker ? "Close" : "Add S3 connections"}
              onAction={() => setShowConnectionPicker((current) => !current)}
              headers={[{ label: "S3 connection" }, { label: "Actions", align: "right" }]}
              hasItems={selectedConnectionIds.size > 0}
              emptyLabel="No linked S3 connections yet."
              rows={(form.s3_connection_ids ?? []).map((connectionId) => (
                <tr key={connectionId}>
                  <td className={adminAssociationTableLabelCellClass}>
                    {connectionLabelById.get(connectionId) ?? `Connection #${connectionId}`}
                  </td>
                  <td className={adminAssociationTableActionCellClass}>
                    <button
                      type="button"
                      className={tableDeleteActionClasses}
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          s3_connection_ids: (current.s3_connection_ids ?? []).filter((id) => id !== connectionId),
                        }))
                      }
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              picker={
                showConnectionPicker ? (
                  <AdminAssociationPickerPanel
                    title="Add S3 connections"
                    hint="(shared only)"
                    search={connectionSearch}
                    onSearchChange={setConnectionSearch}
                    searchAriaLabel="Search group shared S3 connections"
                    loading={auxLoading}
                    availableCount={availableConnections.length}
                    maxVisibleOptions={MAX_VISIBLE_OPTIONS}
                    selectedCount={connectionSelections.length}
                    loadingLabel="Loading shared S3 connections..."
                    emptyLabel="No shared S3 connections available."
                    addDisabled={connectionSelections.length === 0}
                    onCancel={() => {
                      setShowConnectionPicker(false);
                      setConnectionSelections([]);
                      setConnectionSearch("");
                    }}
                    onAdd={() => {
                      setForm((current) => ({
                        ...current,
                        s3_connection_ids: [
                          ...new Set([...(current.s3_connection_ids ?? []), ...connectionSelections]),
                        ].sort((a, b) => a - b),
                      }));
                      setShowConnectionPicker(false);
                      setConnectionSelections([]);
                      setConnectionSearch("");
                    }}
                  >
                    {visibleConnections.map((connection) => (
                      <label
                        key={connection.id}
                        className={adminAssociationOptionRowClass(connectionSelections.includes(connection.id))}
                      >
                        <span className="ui-body text-slate-700 dark:text-slate-200">{connection.name}</span>
                        <input
                          type="checkbox"
                          checked={connectionSelections.includes(connection.id)}
                          onChange={() => togglePendingSelection(setConnectionSelections, connection.id)}
                          className={adminAssociationCheckboxClass}
                        />
                      </label>
                    ))}
                  </AdminAssociationPickerPanel>
                ) : undefined
              }
            />
          ),
        },
      ]}
      activeTab={associationTab}
      onChange={(id) => {
        setAssociationTab(id === "s3_users" ? "s3_users" : id === "connections" ? "connections" : "accounts");
        setShowAccountPicker(false);
        setShowS3UserPicker(false);
        setShowConnectionPicker(false);
      }}
    />
  );

  const renderGroupAssociations = (group: UiGroup) => {
    const accountDetailsById = new Map((group.account_details ?? []).map((account) => [Number(account.id), account]));
    const s3UserDetailsById = new Map((group.s3_user_details ?? []).map((user) => [Number(user.id), user]));
    const accountItems: AssociationAccountItem[] = (group.account_links ?? []).map((link) => {
      const accountId = Number(link.account_id);
      return {
        id: accountId,
        label:
          accountDetailsById.get(accountId)?.name ??
          accountOptionsById.get(accountId)?.name ??
          `Account #${link.account_id}`,
        role: link.role,
      };
    });
    const s3UserItems = (group.s3_user_links ?? []).map((link) => {
      const s3UserId = Number(link.s3_user_id);
      return {
        id: s3UserId,
        label: s3UserDetailsById.get(s3UserId)?.name ?? s3UserLabelById.get(s3UserId) ?? `S3 User #${s3UserId}`,
      };
    });
    const connectionItems = (group.s3_connection_details ?? []).map((details) => {
      const connectionId = Number(details.id);
      return {
        id: connectionId,
        label:
          details.name ??
          connectionLabelById.get(connectionId) ??
          `Connection #${connectionId}`,
      };
    });
    const categories: CompactAssociationCategory[] = [
      {
        id: "accounts",
        label: "Accounts",
        itemLabel: "RGW account",
        items: accountItems.map((account) => ({
          id: account.id,
          label: account.label,
          role_labels: accountAssociationRoleLabels(account, showPortalRole),
        })),
      },
      { id: "s3_users", label: "RGW users", itemLabel: "RGW user", items: s3UserItems },
      { id: "connections", label: "S3 connections", itemLabel: "S3 connection", items: connectionItems },
    ];
    return <CompactAssociationSummary categories={categories} />;
  };

  const renderGroupMembers = (group: UiGroup) => {
    const memberItems: AssociationPrincipalItem[] = (group.user_details ?? []).map((user) => {
      const id = Number(user.id);
      return {
        id,
        kind: "user",
        label: user.display_name || user.full_name || user.email || `User #${id}`,
        email: user.email,
        avatar: user.avatar,
        role_labels: [uiPrincipalRoleLabel(user.role)],
      };
    });
    return <AssociationPrincipalStack items={memberItems} maxVisible={5} />;
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
          className="flex w-full items-center gap-2 text-left transition hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:hover:text-primary-100"
        >
          <GroupAvatar avatar={group.avatar} name={group.name} size="md" decorative />
          <span className="min-w-0">
            <span className="block truncate">{group.name}</span>
            {group.description && (
              <span className="mt-0.5 block truncate ui-caption font-normal text-slate-500 dark:text-slate-400">{group.description}</span>
            )}
          </span>
        </button>
      ),
    },
    {
      id: "rights",
      label: "Rights",
      cellClassName: "align-top min-w-[12rem]",
      render: (group) => {
        const access = normalizeManagerToolAccess(group.manager_tool_access);
        const toolCount =
          Object.values(access).filter(Boolean).length +
          Number(Boolean(group.can_provision_managed_private_connections));
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
            {group.can_create_manual_private_connections && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 ui-caption font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100">
                Connections
              </span>
            )}
            {toolCount > 0 && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 ui-caption font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                {toolCount} Manager permissions
              </span>
            )}
            {!group.can_access_ceph_admin && !group.can_access_storage_ops && !group.can_create_manual_private_connections && toolCount === 0 && (
              <span className="ui-caption text-slate-500 dark:text-slate-400">No workspace/tool rights</span>
            )}
          </div>
        );
      },
    },
    {
      id: "members",
      label: "Members",
      cellClassName: "align-top min-w-[10rem]",
      render: (group) => renderGroupMembers(group),
    },
    {
      id: "associations",
      label: "Storage associations",
      cellClassName: "align-top min-w-[18rem]",
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

      <ListPageSection
          title="Groups"
          description="Search across group names, members, and linked resources."
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
      >
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
      </ListPageSection>

      {showModal && (
        <WorkflowPage
          title={editingGroup ? "Edit UI group" : "Create UI group"}
          description="Manage members, storage associations, and inherited workspace permissions for this UI group."
          breadcrumbs={adminPageBreadcrumbs("groups", { label: editingGroup ? "Edit" : "Create" })}
          backLabel="Back to groups"
          onBack={closeModal}
          contentVariant="plain"
          width="wide"
        >
          {actionError && (
            <PageBanner tone="error" className="mb-3">
              {actionError}
            </PageBanner>
          )}
          <form onSubmit={submitGroup} className="space-y-4">
            <WorkflowTabs<GroupModalTab>
              activeTab={modalTab}
              onTabChange={setModalTab}
              ariaLabel="UI group configuration sections"
              idPrefix="admin-ui-group-editor"
              tabs={[
                { id: "general", label: "General" },
                { id: "members", label: "Members" },
                { id: "associations", label: "Associations" },
                { id: "workspaces", label: "Workspaces" },
                { id: "connections", label: "Connections" },
                { id: "browser", label: "Browser" },
                { id: "manager", label: "Manager" },
              ]}
            >

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
                <div className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] p-3">
                  <div className="flex flex-wrap items-start gap-4">
                    <GroupAvatar avatar={avatarPreview} name={String(form.name || "UI group")} size="lg" />
                    <div className="min-w-0 flex-1 space-y-3">
                      <div>
                        <div className={labelClass}>Group pictogram</div>
                        <p className="ui-caption text-slate-500 dark:text-slate-400">
                          Use initials, a predefined pictogram, or a custom PNG/JPEG image. Groups never use Gravatar or OIDC images.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={form.avatar_source === "initials" && !avatarFile ? secondaryButtonClass : tableActionButtonClasses}
                          onClick={() => {
                            setAvatarFile(null);
                            setForm((current) => ({ ...current, avatar_source: "initials", avatar_icon: null }));
                          }}
                        >
                          Initials
                        </button>
                        {groupAvatarIcons.map((icon) => (
                          <button
                            key={icon.value}
                            type="button"
                            title={icon.label}
                            aria-label={`Use ${icon.label} pictogram`}
                            className={`rounded-md border p-1.5 ${
                              form.avatar_source === "preset" && form.avatar_icon === icon.value && !avatarFile
                                ? "border-primary bg-primary-50 dark:bg-primary-950/40"
                                : "border-[color:var(--ui-border)] bg-[var(--ui-surface)] hover:bg-[var(--ui-hover)]"
                            }`}
                            onClick={() => {
                              setAvatarFile(null);
                              setForm((current) => ({ ...current, avatar_source: "preset", avatar_icon: icon.value }));
                            }}
                          >
                            <GroupAvatar
                              avatar={{ source: "preset", initials: "", icon: icon.value }}
                              name={icon.label}
                              size="sm"
                              className="border-0"
                            />
                          </button>
                        ))}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className={secondaryButtonClass}>
                          Upload image
                          <input
                            type="file"
                            accept="image/png,image/jpeg"
                            className="sr-only"
                            onChange={(event) => selectAvatarFile(event.target.files?.[0] ?? null)}
                          />
                        </label>
                        {avatarFile ? <span className="ui-caption text-slate-600 dark:text-slate-300">{avatarFile.name}</span> : null}
                        {editingGroup?.avatar?.source === "uploaded" && !avatarFile ? (
                          <button
                            type="button"
                            className={tableDeleteActionClasses}
                            onClick={() => {
                              setRemoveAvatarImage(true);
                              setForm((current) => ({ ...current, avatar_source: "initials", avatar_icon: null }));
                            }}
                          >
                            Remove uploaded image
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {modalTab === "members" && renderMembersTab()}

            {modalTab === "associations" && (
              renderAssociationsTab()
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

            {modalTab === "connections" && (
              <AdminAccessToggleSection
                title="Connections"
                description="Private S3 connection permissions inherited by group members."
                items={[
                  {
                    title: "Create manual private connections",
                    description: "Allow credentials supplied by the user on a registered endpoint or a custom URL.",
                    checked: Boolean(form.can_create_manual_private_connections),
                    onChange: (value) =>
                      setForm((current) => ({
                        ...current,
                        can_create_manual_private_connections: value,
                      })),
                    ariaLabel: "Allow manual private connection creation",
                  },
                ]}
              />
            )}

            {modalTab === "manager" && (
              <div className="space-y-4">
                <AdminAccessToggleSection
                  title="Managed private access"
                  description="Server-side provisioning permissions inherited by group members."
                  items={[
                    {
                      title: "Provision managed private connections",
                      description: "Allow server-side IAM or RGW credential provisioning without revealing generated secrets.",
                      checked: Boolean(form.can_provision_managed_private_connections),
                      onChange: (value) =>
                        setForm((current) => ({
                          ...current,
                          can_provision_managed_private_connections: value,
                        })),
                      ariaLabel: "Allow managed private connection provisioning",
                    },
                  ]}
                />
                <ManagerToolAccessSection
                  title="Bucket tools"
                  description="Manager permissions inherited by group members."
                  tools={managerToolDefinitions}
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
            </WorkflowTabs>

            <WorkflowActions>
              <UiButton variant="secondary" onClick={closeModal}>
                Cancel
              </UiButton>
              <UiButton
                type="submit"
                disabled={busyId === editingGroup?.id}
              >
                {busyId === editingGroup?.id ? "Saving..." : "Save"}
              </UiButton>
            </WorkflowActions>
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
