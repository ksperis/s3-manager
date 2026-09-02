/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CreateUserPayload,
  UpdateUserPayload,
  User,
  type S3UserMembership,
  type UiRole,
  createUser,
  deleteUser,
  listUsers,
  updateUser,
} from "../../api/users";
import {
  getAccountAccessRequiredMessage,
  hasAccountAccessRole,
  type AccountAccessGrant,
} from "../../api/accountAccess";
import { UiGroupSummary, listMinimalGroups } from "../../api/groups";
import { S3AccountSummary, listMinimalS3Accounts } from "../../api/accounts";
import { S3UserSummary, listMinimalS3Users } from "../../api/s3Users";
import { S3ConnectionSummary, listMinimalS3Connections } from "../../api/s3ConnectionsAdmin";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import ListPageSection from "../../components/list/ListPageSection";
import WorkflowPage, {
  WorkflowActions,
  WorkflowMetadata,
  workflowPageHostClass,
} from "../../components/WorkflowPage";
import WorkflowTabs from "../../components/WorkflowTabs";
import PageHeader from "../../components/PageHeader";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import {
  CompactAssociationSummary,
  accountAssociationRoleLabels,
  type CompactAssociationCategory,
} from "./AssociationSummary";
import {
  AdminAccessToggleSection,
  BrowserAccessSection,
  ManagerToolAccessSection,
  WorkspaceAccessSection,
} from "./AdminAccessSections";
import {
  DEFAULT_MANAGER_TOOL_ACCESS,
  buildManagerToolDefinitions,
  normalizeManagerToolAccess,
  type ManagerToolKey,
} from "./adminAccessConfig";
import PageBanner from "../../components/PageBanner";
import UiButton from "../../components/ui/UiButton";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import DataTableShell, {
  dataTableDefaultActionProps,
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import ToolbarSearchInput from "../../components/ToolbarSearchInput";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { cx, uiInputClass, uiMutedTextClass } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import UserAvatar from "../../components/UserAvatar";
import { stableSignature } from "../../utils/stableSignature";
import { isAdminLikeRole, isSuperAdminRole, readStoredUser, setSessionUserCache } from "../../utils/workspaces";
import {
  clearAdminPrincipalEditRequest,
  readAdminPrincipalEditRequest,
} from "./adminPrincipalEditLink";
import UserAssociationsTabs, { type AssociationTab } from "./UserAssociationsTabs";
import type { AccountSelection } from "./UserAccountAssociationsPanel";
import UserGroupsSelector from "./UserGroupsSelector";
import UserAuthenticationPanel from "./UserAuthenticationPanel";

type UserModalTab = "general" | "authentication" | "associations" | "groups" | "access" | "connections" | "browser" | "manager";
type AuxiliaryLoadState = "idle" | "loading" | "loaded" | "error";

const userWorkflowTabs: Array<{ id: UserModalTab; label: string }> = [
  { id: "general", label: "General" },
  { id: "groups", label: "Groups" },
  { id: "associations", label: "Associations" },
  { id: "access", label: "Workspaces" },
  { id: "connections", label: "Connections" },
  { id: "browser", label: "Browser" },
  { id: "manager", label: "Manager" },
];
const editUserWorkflowTabs: Array<{ id: UserModalTab; label: string }> = [
  { id: "general", label: "General" },
  { id: "authentication", label: "Authentication" },
  ...userWorkflowTabs.filter((tab) => tab.id !== "general"),
];

const userModalLabelClass = "ui-body font-medium text-[var(--ui-text)]";
const userModalFieldClass = cx(uiInputClass, "px-3 py-2 ui-body");
const roleAccessHelpItems = [
  { role: "No Access", access: "No workspace access (profile only)" },
  { role: "User", access: "Non-admin workspaces only" },
  { role: "Admin", access: "User access + /admin" },
  { role: "Superadmin", access: "Admin access + /admin settings" },
];

function RoleAccessHelp({
  open,
  onToggle,
  helpId,
}: {
  open: boolean;
  onToggle: () => void;
  helpId: string;
}) {
  return (
    <>
      <div className="flex items-center gap-2">
        <label className={userModalLabelClass}>Role</label>
        <button
          type="button"
          onClick={onToggle}
          aria-label="Explain role access levels"
          aria-expanded={open}
          aria-controls={helpId}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 text-[11px] font-bold text-slate-600 transition hover:border-primary hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:border-slate-600 dark:text-slate-200 dark:hover:border-primary-400 dark:hover:text-primary-100"
        >
          i
        </button>
      </div>
      {open && (
        <div id={helpId} className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-900/50">
          <p className="mb-2 ui-badge font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Role access summary</p>
          <div className="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950/70">
            <table className="w-full table-fixed border-collapse">
              <thead className="bg-slate-100 dark:bg-slate-900">
                <tr>
                  <th className="w-1/3 px-2.5 py-1.5 text-left ui-badge font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Role
                  </th>
                  <th className="px-2.5 py-1.5 text-left ui-badge font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Workspace access
                  </th>
                </tr>
              </thead>
              <tbody>
                {roleAccessHelpItems.map((item, index) => (
                  <tr key={item.role} className={index % 2 === 0 ? "bg-white dark:bg-slate-950/70" : "bg-slate-50/70 dark:bg-slate-900/60"}>
                    <td className="px-2.5 py-1.5 ui-caption font-semibold text-slate-800 dark:text-slate-100">{item.role}</td>
                    <td className="px-2.5 py-1.5 ui-caption text-slate-600 dark:text-slate-300">{item.access}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">Ceph Admin and Storage Ops also require dedicated access flags.</p>
        </div>
      )}
    </>
  );
}

export default function UsersPage() {
  type SortField = "name" | "role" | "accounts" | "last_login_at";

  const MAX_VISIBLE_OPTIONS = 10;
  const { generalSettings } = useGeneralSettings();
  const currentUser = useMemo(() => readStoredUser(), []);
  const currentUserId = currentUser?.id != null ? Number(currentUser.id) : null;
  const currentIsAdminLike = isAdminLikeRole(currentUser?.role);
  const currentIsSuperAdmin = isSuperAdminRole(currentUser?.role);
  const cephAdminFeatureEnabled = generalSettings.ceph_admin_enabled;
  const showPortalRole = Boolean(generalSettings.portal_enabled);
  const principalEditRequest = useMemo(
    () => readAdminPrincipalEditRequest(typeof window === "undefined" ? "" : window.location.search),
    [],
  );
  const requestedEditHandledRef = useRef(false);
  const startEditRef = useRef<(user: User) => void>(() => undefined);
  const [users, setUsers] = useState<User[]>([]);
  const [accounts, setS3Accounts] = useState<S3AccountSummary[]>([]);
  const [s3AccountsLoaded, setS3AccountsLoaded] = useState(false);
  const [s3AccountsLoading, setS3AccountsLoading] = useState(false);
  const [s3Users, setS3Users] = useState<S3UserSummary[]>([]);
  const [s3UsersLoading, setS3UsersLoading] = useState(false);
  const [s3Connections, setS3Connections] = useState<S3ConnectionSummary[]>([]);
  const [s3ConnectionsLoading, setS3ConnectionsLoading] = useState(false);
  const [groups, setGroups] = useState<UiGroupSummary[]>([]);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const createFormTemplate = (): CreateUserPayload => ({
    email: "",
    full_name: "",
    password: "",
    role: "ui_user",
    can_access_ceph_admin: false,
    can_access_storage_ops: false,
    can_create_manual_private_connections: false,
    can_provision_managed_private_connections: false,
    manager_tool_access: { ...DEFAULT_MANAGER_TOOL_ACCESS },
    browser_advanced_features_enabled: false,
  });
  const [form, setForm] = useState<CreateUserPayload>(() => createFormTemplate());
  const [createInitialSignature, setCreateInitialSignature] = useState(() =>
    stableSignature({
      form: createFormTemplate(),
      selectedAccounts: [],
      selectedS3Users: [],
      selectedS3Connections: [],
      selectedGroups: [],
      pendingAccountSelections: [],
      pendingS3UserSelections: [],
      pendingConnectionSelections: [],
      pendingGroupSelections: [],
      accountAccessChoice: {},
    })
  );
  const [createSelectedS3Accounts, setCreateSelectedS3Accounts] = useState<AccountSelection[]>([]);
  const [createSelectedS3Users, setCreateSelectedS3Users] = useState<S3UserMembership[]>([]);
  const [createSelectedS3Connections, setCreateSelectedS3Connections] = useState<number[]>([]);
  const [createSelectedGroups, setCreateSelectedGroups] = useState<number[]>([]);
  const [createAccountAccessChoice, setCreateAccountAccessChoice] = useState<
    Record<number, AccountAccessGrant>
  >({});
  const [createS3AccountSearch, setCreateS3AccountSearch] = useState("");
  const [createS3Search, setCreateS3Search] = useState("");
  const [createConnectionSearch, setCreateConnectionSearch] = useState("");
  const [createGroupSearch, setCreateGroupSearch] = useState("");
  const [createModalTab, setCreateModalTab] = useState<UserModalTab>("general");
  const [createAssociationsTab, setCreateAssociationsTab] = useState<"accounts" | "s3_users" | "connections">("accounts");
  const [showCreateAccountPanel, setShowCreateAccountPanel] = useState(false);
  const [createAccountSelections, setCreateAccountSelections] = useState<number[]>([]);
  const [showCreateS3UserPanel, setShowCreateS3UserPanel] = useState(false);
  const [createS3UserSelections, setCreateS3UserSelections] = useState<number[]>([]);
  const [showCreateConnectionPanel, setShowCreateConnectionPanel] = useState(false);
  const [createConnectionSelections, setCreateConnectionSelections] = useState<number[]>([]);
  const [showCreateGroupPanel, setShowCreateGroupPanel] = useState(false);
  const [createGroupSelections, setCreateGroupSelections] = useState<number[]>([]);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState<UpdateUserPayload>({});
  const [editInitialSignature, setEditInitialSignature] = useState(() =>
    stableSignature({
      form: {},
      selectedAccounts: [],
      selectedS3Users: [],
      selectedS3Connections: [],
      selectedGroups: [],
      pendingAccountSelections: [],
      pendingS3UserSelections: [],
      pendingConnectionSelections: [],
      pendingGroupSelections: [],
      accountAccessChoice: {},
    })
  );
  const [editSelectedS3Accounts, setEditSelectedS3Accounts] = useState<AccountSelection[]>([]);
  const [editSelectedS3Users, setEditSelectedS3Users] = useState<S3UserMembership[]>([]);
  const [editSelectedS3Connections, setEditSelectedS3Connections] = useState<number[]>([]);
  const [editSelectedGroups, setEditSelectedGroups] = useState<number[]>([]);
  const [editAccountAccessChoice, setEditAccountAccessChoice] = useState<
    Record<number, AccountAccessGrant>
  >({});
  const [editS3AccountSearch, setEditS3AccountSearch] = useState("");
  const [editS3Search, setEditS3Search] = useState("");
  const [editConnectionSearch, setEditConnectionSearch] = useState("");
  const [editGroupSearch, setEditGroupSearch] = useState("");
  const [editModalTab, setEditModalTab] = useState<UserModalTab>("general");
  const [editAssociationsTab, setEditAssociationsTab] = useState<"accounts" | "s3_users" | "connections">("accounts");
  const [showEditAccountPanel, setShowEditAccountPanel] = useState(false);
  const [editAccountSelections, setEditAccountSelections] = useState<number[]>([]);
  const [showEditS3UserPanel, setShowEditS3UserPanel] = useState(false);
  const [editS3UserSelections, setEditS3UserSelections] = useState<number[]>([]);
  const [showEditConnectionPanel, setShowEditConnectionPanel] = useState(false);
  const [editConnectionSelections, setEditConnectionSelections] = useState<number[]>([]);
  const [showEditGroupPanel, setShowEditGroupPanel] = useState(false);
  const [editGroupSelections, setEditGroupSelections] = useState<number[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [pendingDeleteUser, setPendingDeleteUser] = useState<User | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [createRoleHelpOpen, setCreateRoleHelpOpen] = useState(false);
  const [editRoleHelpOpen, setEditRoleHelpOpen] = useState(false);
  const [filter, setFilter] = useState(principalEditRequest?.search ?? "");
  const [sort, setSort] = useState<{ field: SortField; direction: "asc" | "desc" }>({
    field: "name",
    direction: "asc",
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalUsers, setTotalUsers] = useState(0);
  const s3AccountsLoadStateRef = useRef<AuxiliaryLoadState>("idle");
  const s3UsersLoadStateRef = useRef<AuxiliaryLoadState>("idle");
  const s3ConnectionsLoadStateRef = useRef<AuxiliaryLoadState>("idle");
  const groupsLoadStateRef = useRef<AuxiliaryLoadState>("idle");
  const accountOptions = useMemo(() => accounts.map((a) => ({ id: a.id, label: a.name })), [accounts]);
  const accountOptionsById = useMemo(() => {
    const map = new Map<number, S3AccountSummary>();
    accounts.forEach((a) => {
      map.set(a.id, a);
    });
    return map;
  }, [accounts]);
  const s3UserOptions = useMemo(() => s3Users.map((u) => ({ id: u.id, label: u.name })), [s3Users]);
  const s3UserLabelById = useMemo(() => {
    const map = new Map<number, string>();
    s3Users.forEach((u) => map.set(u.id, u.name));
    return map;
  }, [s3Users]);
  const s3ConnectionOptions = useMemo(
    () => s3Connections.map((conn) => ({ id: conn.id, label: conn.name })),
    [s3Connections]
  );
  const s3SharedConnectionOptions = s3ConnectionOptions;
  const s3ConnectionLabelById = useMemo(() => {
    const map = new Map<number, string>();
    s3Connections.forEach((conn) => map.set(conn.id, conn.name));
    return map;
  }, [s3Connections]);
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
      (opt) => !createSelectedS3Users.some((link) => link.s3_user_id === opt.id) && (!query || opt.label.toLowerCase().includes(query))
    );
  }, [s3UserOptions, createSelectedS3Users, createS3Search]);
  const availableCreateS3Connections = useMemo(() => {
    const query = createConnectionSearch.trim().toLowerCase();
    return s3SharedConnectionOptions.filter(
      (opt) =>
        !createSelectedS3Connections.includes(opt.id) && (!query || opt.label.toLowerCase().includes(query))
    );
  }, [s3SharedConnectionOptions, createSelectedS3Connections, createConnectionSearch]);
  const availableEditS3Users = useMemo(() => {
    const query = editS3Search.trim().toLowerCase();
    return s3UserOptions.filter(
      (opt) => !editSelectedS3Users.some((link) => link.s3_user_id === opt.id) && (!query || opt.label.toLowerCase().includes(query))
    );
  }, [s3UserOptions, editSelectedS3Users, editS3Search]);
  const availableEditS3Connections = useMemo(() => {
    const query = editConnectionSearch.trim().toLowerCase();
    return s3SharedConnectionOptions.filter(
      (opt) =>
        !editSelectedS3Connections.includes(opt.id) &&
        (!query || opt.label.toLowerCase().includes(query))
    );
  }, [s3SharedConnectionOptions, editSelectedS3Connections, editConnectionSearch]);
  const visibleCreateGroups = useMemo(() => {
    const query = createGroupSearch.trim().toLowerCase();
    return groups.filter(
      (group) => !createSelectedGroups.includes(group.id) && (!query || group.name.toLowerCase().includes(query))
    );
  }, [createGroupSearch, createSelectedGroups, groups]);
  const visibleEditGroups = useMemo(() => {
    const query = editGroupSearch.trim().toLowerCase();
    return groups.filter(
      (group) => !editSelectedGroups.includes(group.id) && (!query || group.name.toLowerCase().includes(query))
    );
  }, [editGroupSearch, editSelectedGroups, groups]);
  const limitedOptions = <T,>(options: T[]) => options.slice(0, MAX_VISIBLE_OPTIONS);
  const visibleCreateS3Accounts = limitedOptions(availableCreateS3Accounts);
  const visibleEditS3Accounts = limitedOptions(availableEditS3Accounts);
  const visibleCreateS3Users = limitedOptions(availableCreateS3Users);
  const visibleCreateS3Connections = limitedOptions(availableCreateS3Connections);
  const visibleEditS3Users = limitedOptions(availableEditS3Users);
  const visibleEditS3Connections = limitedOptions(availableEditS3Connections);
  const displayUiRole = (role: UiRole) => {
    if (role === "ui_superadmin") return "Superadmin";
    if (role === "ui_admin") return "Admin";
    if (role === "ui_user") return "User";
    return "No access";
  };
  const editRoleValue = editForm.role ?? editingUser?.role ?? "ui_user";
  const createRoleValue = form.role ?? "ui_user";
  const createTargetSupportsCephAdmin = createRoleValue === "ui_admin" || createRoleValue === "ui_superadmin";
  const createTargetSupportsStorageOps =
    createRoleValue === "ui_user" || createRoleValue === "ui_admin" || createRoleValue === "ui_superadmin";
  const editTargetSupportsCephAdmin = editRoleValue === "ui_admin" || editRoleValue === "ui_superadmin";
  const editTargetSupportsStorageOps =
    editRoleValue === "ui_user" || editRoleValue === "ui_admin" || editRoleValue === "ui_superadmin";
  const editTargetSupportsManagerTools = editTargetSupportsStorageOps;
  const createTargetSupportsManagerTools = createTargetSupportsStorageOps;
  const createCanGrantCephAdmin = currentIsSuperAdmin && createTargetSupportsCephAdmin;
  const createCanGrantStorageOps = currentIsAdminLike && createTargetSupportsStorageOps;
  const editCanGrantCephAdmin = currentIsSuperAdmin && editTargetSupportsCephAdmin;
  const editCanGrantStorageOps = currentIsAdminLike && editTargetSupportsStorageOps;
  const managerToolDefinitions = useMemo(
    () => buildManagerToolDefinitions(generalSettings),
    [generalSettings]
  );

  const formatLastLogin = (value?: string | null) => {
    if (!value) return "-";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }
    return parsed.toLocaleString();
  };

  const renderAssociationSummary = (user: User) => {
    const effectiveAccountLinks = user.effective_access?.account_links ?? [];
    const displayedAccountLinks = effectiveAccountLinks.length > 0
      ? effectiveAccountLinks
      : (user.account_links ?? []);
    const accountItems = displayedAccountLinks.map((link) => {
      const id = Number(link.account_id);
      const label = accountOptionsById.get(id)?.name ?? `Account #${id}`;
      const roleLabels = accountAssociationRoleLabels({
        id,
        label,
        manager_role: link.manager_role,
        portal_role: link.portal_role,
      });
      return {
        id,
        label,
        manager_role: link.manager_role,
        portal_role: link.portal_role,
        role_labels: roleLabels,
      };
    });
    const effectiveS3UserDetails = user.effective_access?.s3_user_details ?? [];
    const s3UserItems =
      effectiveS3UserDetails.length > 0
        ? effectiveS3UserDetails.map((entry) => ({
            id: entry.id,
            label: entry.name || `User #${entry.id}`,
          }))
        : (user.s3_user_details ?? []).map((entry) => ({
            id: entry.id,
            label: entry.name || `User #${entry.id}`,
          }));
    const effectiveConnectionDetails = user.effective_access?.s3_connection_details ?? [];
    const connectionItems =
      effectiveConnectionDetails.length > 0
        ? effectiveConnectionDetails.map((entry) => ({
            id: entry.id,
            label: entry.name || `Connection #${entry.id}`,
          }))
        : (user.s3_connection_details ?? []).map((entry) => ({
            id: entry.id,
            label: entry.name || `Connection #${entry.id}`,
          }));
    const categories: CompactAssociationCategory[] = [
      {
        id: "accounts",
        label: "Accounts",
        itemLabel: "RGW account",
        items: accountItems.map((account) => ({
          id: account.id,
          label: account.label,
          role_labels: account.role_labels,
        })),
      },
      { id: "s3_users", label: "RGW users", itemLabel: "RGW user", items: s3UserItems },
      { id: "connections", label: "S3 connections", itemLabel: "S3 connection", items: connectionItems },
    ];
    return <CompactAssociationSummary categories={categories} />;
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

  const extractError = (err: unknown): string => extractApiError(err, "Unexpected error");

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
      setError(extractApiError(err, "Unable to load users."));
    } finally {
      setLoading(false);
    }
  }, [filter, page, pageSize, sort.direction, sort.field]);

  const fetchS3Accounts = useCallback(async () => {
    if (s3AccountsLoadStateRef.current === "loading") return;
    s3AccountsLoadStateRef.current = "loading";
    setS3AccountsLoading(true);
    try {
      const data = await listMinimalS3Accounts();
      setS3Accounts(data);
      setS3AccountsLoaded(true);
      s3AccountsLoadStateRef.current = "loaded";
    } catch (err) {
      s3AccountsLoadStateRef.current = "error";
      console.error(err);
    } finally {
      setS3AccountsLoading(false);
    }
  }, []);

  const fetchS3Users = useCallback(async () => {
    if (s3UsersLoadStateRef.current === "loading") return;
    s3UsersLoadStateRef.current = "loading";
    setS3UsersLoading(true);
    try {
      const data = await listMinimalS3Users();
      setS3Users(data);
      s3UsersLoadStateRef.current = "loaded";
    } catch (err) {
      s3UsersLoadStateRef.current = "error";
      console.error(err);
    } finally {
      setS3UsersLoading(false);
    }
  }, []);

  const fetchS3Connections = useCallback(async () => {
    if (s3ConnectionsLoadStateRef.current === "loading") return;
    s3ConnectionsLoadStateRef.current = "loading";
    setS3ConnectionsLoading(true);
    try {
      const data = await listMinimalS3Connections();
      setS3Connections(data);
      s3ConnectionsLoadStateRef.current = "loaded";
    } catch (err) {
      s3ConnectionsLoadStateRef.current = "error";
      console.error(err);
    } finally {
      setS3ConnectionsLoading(false);
    }
  }, []);

  const ensureS3Accounts = useCallback(async (options?: { retryOnError?: boolean }) => {
    const loadState = s3AccountsLoadStateRef.current;
    if (loadState === "loaded" || loadState === "loading") return;
    if (loadState === "error" && !options?.retryOnError) return;
    await fetchS3Accounts();
  }, [fetchS3Accounts]);

  const ensureS3Users = useCallback(async (options?: { retryOnError?: boolean }) => {
    const loadState = s3UsersLoadStateRef.current;
    if (loadState === "loaded" || loadState === "loading") return;
    if (loadState === "error" && !options?.retryOnError) return;
    await fetchS3Users();
  }, [fetchS3Users]);

  const ensureS3Connections = useCallback(async (options?: { retryOnError?: boolean }) => {
    const loadState = s3ConnectionsLoadStateRef.current;
    if (loadState === "loaded" || loadState === "loading") return;
    if (loadState === "error" && !options?.retryOnError) return;
    await fetchS3Connections();
  }, [fetchS3Connections]);

  const fetchGroups = useCallback(async () => {
    if (groupsLoadStateRef.current === "loading") return;
    groupsLoadStateRef.current = "loading";
    setGroupsLoading(true);
    try {
      const data = await listMinimalGroups();
      setGroups(data);
      setGroupsLoaded(true);
      groupsLoadStateRef.current = "loaded";
    } catch (err) {
      groupsLoadStateRef.current = "error";
      console.error(err);
    } finally {
      setGroupsLoading(false);
    }
  }, []);

  const ensureGroups = useCallback(async (options?: { retryOnError?: boolean }) => {
    const loadState = groupsLoadStateRef.current;
    if (loadState === "loaded" || loadState === "loading") return;
    if (loadState === "error" && !options?.retryOnError) return;
    await fetchGroups();
  }, [fetchGroups]);

  const ensureAssociationOptionsForTab = useCallback(
    async (tab: AssociationTab, options?: { retryOnError?: boolean }) => {
      if (tab === "accounts") {
        await ensureS3Accounts(options);
        return;
      }
      if (tab === "s3_users") {
        await ensureS3Users(options);
        return;
      }
      await ensureS3Connections(options);
    },
    [ensureS3Accounts, ensureS3Connections, ensureS3Users]
  );

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    ensureS3Accounts();
  }, [ensureS3Accounts]);

  useEffect(() => {
    if ((showCreateModal && createModalTab === "groups") || (showEditModal && editModalTab === "groups")) {
      void ensureGroups({ retryOnError: true });
    }
  }, [createModalTab, editModalTab, ensureGroups, showCreateModal, showEditModal]);

  const toggleCreateAccountSelection = (accountId: number) => {
    setCreateAccountSelections((prev) =>
      prev.includes(accountId) ? prev.filter((id) => id !== accountId) : [...prev, accountId]
    );
  };

  const toggleCreateS3UserSelection = (userId: number) => {
    setCreateS3UserSelections((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const toggleCreateConnectionSelection = (connectionId: number) => {
    setCreateConnectionSelections((prev) =>
      prev.includes(connectionId) ? prev.filter((id) => id !== connectionId) : [...prev, connectionId]
    );
  };

  const toggleEditAccountSelection = (accountId: number) => {
    setEditAccountSelections((prev) =>
      prev.includes(accountId) ? prev.filter((id) => id !== accountId) : [...prev, accountId]
    );
  };

  const toggleEditS3UserSelection = (userId: number) => {
    setEditS3UserSelections((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const toggleEditConnectionSelection = (connectionId: number) => {
    setEditConnectionSelections((prev) =>
      prev.includes(connectionId) ? prev.filter((id) => id !== connectionId) : [...prev, connectionId]
    );
  };

  const emptyCreateSignature = () =>
    stableSignature({
      form: createFormTemplate(),
      selectedAccounts: [],
      selectedS3Users: [],
      selectedS3Connections: [],
      selectedGroups: [],
      pendingAccountSelections: [],
      pendingS3UserSelections: [],
      pendingConnectionSelections: [],
      pendingGroupSelections: [],
      accountAccessChoice: {},
    });

  const createCurrentSignature = useMemo(
    () =>
      stableSignature({
        form,
        selectedAccounts: createSelectedS3Accounts,
        selectedS3Users: createSelectedS3Users,
        selectedS3Connections: createSelectedS3Connections,
        selectedGroups: createSelectedGroups,
        pendingAccountSelections: createAccountSelections,
        pendingS3UserSelections: createS3UserSelections,
        pendingConnectionSelections: createConnectionSelections,
        pendingGroupSelections: createGroupSelections,
        accountAccessChoice: createAccountAccessChoice,
      }),
    [
      createAccountAccessChoice,
      createAccountSelections,
      createConnectionSelections,
      createGroupSelections,
      createS3UserSelections,
      createSelectedS3Accounts,
      createSelectedS3Connections,
      createSelectedGroups,
      createSelectedS3Users,
      form,
    ]
  );

  const resetCreateModalState = () => {
    setForm(createFormTemplate());
    setCreateSelectedS3Accounts([]);
    setCreateSelectedS3Users([]);
    setCreateSelectedS3Connections([]);
    setCreateSelectedGroups([]);
    setCreateAccountAccessChoice({});
    setCreateS3AccountSearch("");
    setCreateS3Search("");
    setCreateConnectionSearch("");
    setCreateGroupSearch("");
    setCreateModalTab("general");
    setCreateAssociationsTab("accounts");
    setShowCreateAccountPanel(false);
    setShowCreateS3UserPanel(false);
    setShowCreateConnectionPanel(false);
    setShowCreateGroupPanel(false);
    setCreateAccountSelections([]);
    setCreateS3UserSelections([]);
    setCreateConnectionSelections([]);
    setCreateGroupSelections([]);
    setCreateRoleHelpOpen(false);
    setCreateInitialSignature(emptyCreateSignature());
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    resetCreateModalState();
  };

  const editCurrentSignature = useMemo(
    () =>
      stableSignature({
        form: editForm,
        selectedAccounts: editSelectedS3Accounts,
        selectedS3Users: editSelectedS3Users,
        selectedS3Connections: editSelectedS3Connections,
        selectedGroups: editSelectedGroups,
        pendingAccountSelections: editAccountSelections,
        pendingS3UserSelections: editS3UserSelections,
        pendingConnectionSelections: editConnectionSelections,
        pendingGroupSelections: editGroupSelections,
        accountAccessChoice: editAccountAccessChoice,
      }),
    [
      editAccountAccessChoice,
      editAccountSelections,
      editConnectionSelections,
      editGroupSelections,
      editForm,
      editS3UserSelections,
      editSelectedS3Accounts,
      editSelectedS3Connections,
      editSelectedGroups,
      editSelectedS3Users,
    ]
  );

  const closeEditModal = () => {
    setShowEditModal(false);
    setEditingUser(null);
    setEditSelectedS3Accounts([]);
    setEditS3AccountSearch("");
    setEditSelectedS3Users([]);
    setEditS3Search("");
    setEditSelectedS3Connections([]);
    setEditConnectionSearch("");
    setEditSelectedGroups([]);
    setEditGroupSearch("");
    setEditModalTab("general");
    setEditAssociationsTab("accounts");
    setShowEditAccountPanel(false);
    setShowEditS3UserPanel(false);
    setShowEditConnectionPanel(false);
    setShowEditGroupPanel(false);
    setEditAccountSelections([]);
    setEditS3UserSelections([]);
    setEditConnectionSelections([]);
    setEditGroupSelections([]);
    setEditAccountAccessChoice({});
    setEditForm({});
    setEditRoleHelpOpen(false);
    setEditInitialSignature(
      stableSignature({
        form: {},
        selectedAccounts: [],
        selectedS3Users: [],
        selectedS3Connections: [],
        selectedGroups: [],
        pendingAccountSelections: [],
        pendingS3UserSelections: [],
        pendingConnectionSelections: [],
        pendingGroupSelections: [],
        accountAccessChoice: {},
      })
    );
    clearAdminPrincipalEditRequest();
  };

  const createCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showCreateModal && createCurrentSignature !== createInitialSignature,
    onClose: closeCreateModal,
  });

  const editCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showEditModal && editCurrentSignature !== editInitialSignature,
    onClose: closeEditModal,
    disabled: editingUser ? busyId === editingUser.id : false,
  });

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setActionMessage(null);
    if (!form.email || !form.password) {
      setCreateModalTab("general");
      setActionError("Email and password are required.");
      return;
    }
    if (createSelectedS3Accounts.some((entry) => !hasAccountAccessRole(entry))) {
      setCreateModalTab("associations");
      setCreateAssociationsTab("accounts");
      setActionError(getAccountAccessRequiredMessage(showPortalRole));
      return;
    }
    const role = form.role ?? "ui_user";
    const payload: CreateUserPayload = {
      email: form.email,
      full_name: form.full_name?.trim() || null,
      password: form.password,
      role,
      can_access_ceph_admin:
        currentIsSuperAdmin && (role === "ui_admin" || role === "ui_superadmin")
          ? Boolean(form.can_access_ceph_admin)
          : false,
      can_access_storage_ops:
        currentIsAdminLike && (role === "ui_user" || role === "ui_admin" || role === "ui_superadmin")
          ? Boolean(form.can_access_storage_ops)
          : false,
      can_create_manual_private_connections: createTargetSupportsManagerTools
        ? Boolean(form.can_create_manual_private_connections)
        : false,
      can_provision_managed_private_connections: createTargetSupportsManagerTools
        ? Boolean(form.can_provision_managed_private_connections)
        : false,
      manager_tool_access: createTargetSupportsManagerTools
        ? normalizeManagerToolAccess(form.manager_tool_access)
        : { ...DEFAULT_MANAGER_TOOL_ACCESS },
      browser_advanced_features_enabled: Boolean(form.browser_advanced_features_enabled),
      group_ids: createSelectedGroups,
    };
    try {
      const created = await createUser(payload);
      if (created?.id) {
        const associationsPayload: UpdateUserPayload = {
          account_links: createSelectedS3Accounts.map((entry) => ({
            account_id: Number(entry.id),
            manager_role: entry.manager_role,
            portal_role: entry.portal_role,
            allow_manager_browser_data_access: Boolean(entry.allow_manager_browser_data_access),
          })),
        };
        if (createSelectedS3Users.length > 0) {
          associationsPayload.s3_user_links = createSelectedS3Users;
        }
        if (createSelectedS3Connections.length > 0) {
          associationsPayload.s3_connection_ids = createSelectedS3Connections;
        }
        if (Object.keys(associationsPayload).length > 0) {
          await updateUser(created.id, associationsPayload);
        }
      }
      setActionMessage("User created");
      resetCreateModalState();
      await fetchUsers();
      if (s3AccountsLoaded) {
        await fetchS3Accounts();
      }
      setShowCreateModal(false);
    } catch (err) {
      setActionError(extractError(err));
    }
  };

  const startEdit = (user: User) => {
    if (!currentIsSuperAdmin && (user.role === "ui_admin" || user.role === "ui_superadmin")) {
      setActionError("Administrators can manage only standard users.");
      return;
    }
    const role = user.role;
    const nextEditForm = {
      email: user.email,
      full_name: user.full_name ?? "",
      role,
      can_access_ceph_admin:
        role === "ui_admin" || role === "ui_superadmin"
          ? Boolean(user.can_access_ceph_admin)
          : false,
      can_access_storage_ops:
        role === "ui_user" || role === "ui_admin" || role === "ui_superadmin"
          ? Boolean(user.can_access_storage_ops)
          : false,
      can_create_manual_private_connections:
        role === "ui_user" || role === "ui_admin" || role === "ui_superadmin"
          ? Boolean(user.can_create_manual_private_connections)
          : false,
      can_provision_managed_private_connections:
        role === "ui_user" || role === "ui_admin" || role === "ui_superadmin"
          ? Boolean(user.can_provision_managed_private_connections)
          : false,
      manager_tool_access: normalizeManagerToolAccess(user.manager_tool_access),
      browser_advanced_features_enabled: Boolean(user.browser_advanced_features_enabled),
    };
    setEditingUser(user);
    setEditForm(nextEditForm);
    const selectedAccounts = (user.account_links ?? []).map((link) => ({
      id: Number(link.account_id),
      manager_role: link.manager_role,
      portal_role: link.portal_role,
      allow_manager_browser_data_access: Boolean(link.allow_manager_browser_data_access),
    }));
    setEditSelectedS3Accounts(selectedAccounts);
    const nextSelectedS3Users = (user.s3_user_links ?? []).map((link) => ({
      s3_user_id: Number(link.s3_user_id),
      allow_manager_browser_data_access: Boolean(link.allow_manager_browser_data_access),
    }));
    const nextSelectedS3Connections = (user.s3_connection_details ?? []).map((connection) => Number(connection.id));
    const nextSelectedGroups = (user.group_details ?? []).map((group) => Number(group.id));
    setEditSelectedS3Users(nextSelectedS3Users);
    setEditSelectedS3Connections(nextSelectedS3Connections);
    setEditSelectedGroups(nextSelectedGroups);
    setEditS3AccountSearch("");
    setEditS3Search("");
    setEditConnectionSearch("");
    setEditGroupSearch("");
    const hasAccounts = selectedAccounts.length > 0;
    const hasS3Users = nextSelectedS3Users.length > 0;
    const hasConnections = nextSelectedS3Connections.length > 0;
    const initialAssociationsTab: AssociationTab = hasAccounts
      ? "accounts"
      : hasS3Users
        ? "s3_users"
        : hasConnections
          ? "connections"
          : "accounts";
    setEditAssociationsTab(initialAssociationsTab);
    setShowEditAccountPanel(false);
    setShowEditS3UserPanel(false);
    setShowEditConnectionPanel(false);
    setShowEditGroupPanel(false);
    setEditAccountSelections([]);
    setEditS3UserSelections([]);
    setEditConnectionSelections([]);
    setEditGroupSelections([]);
    setEditAccountAccessChoice({});
    setEditInitialSignature(
      stableSignature({
        form: nextEditForm,
        selectedAccounts,
        selectedS3Users: nextSelectedS3Users,
        selectedS3Connections: nextSelectedS3Connections,
        selectedGroups: nextSelectedGroups,
        pendingAccountSelections: [],
        pendingS3UserSelections: [],
        pendingConnectionSelections: [],
        pendingGroupSelections: [],
      accountAccessChoice: {},
      })
    );
    setEditModalTab("general");
    setEditRoleHelpOpen(false);
    setActionError(null);
    setActionMessage(null);
    setShowEditModal(true);
    void ensureAssociationOptionsForTab(initialAssociationsTab, { retryOnError: true });
  };

  startEditRef.current = startEdit;
  useEffect(() => {
    if (!principalEditRequest || requestedEditHandledRef.current) return;
    const requestedUser = users.find((user) => user.id === principalEditRequest.id);
    if (!requestedUser) return;
    requestedEditHandledRef.current = true;
    startEditRef.current(requestedUser);
  }, [principalEditRequest, users]);

  const submitEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setActionError(null);
    setActionMessage(null);
    if (editSelectedS3Accounts.some((entry) => !hasAccountAccessRole(entry))) {
      setEditModalTab("associations");
      setEditAssociationsTab("accounts");
      setActionError(getAccountAccessRequiredMessage(showPortalRole));
      return;
    }
    setBusyId(editingUser.id);
    try {
      const payload: UpdateUserPayload = {};
      const nextRole = editForm.role ?? editingUser.role;
      if (editForm.email) {
        payload.email = editForm.email;
      }
      payload.full_name = editForm.full_name?.trim() || null;
      if (editForm.role) {
        payload.role = nextRole;
      }
      payload.can_access_ceph_admin =
        currentIsSuperAdmin && (nextRole === "ui_admin" || nextRole === "ui_superadmin")
          ? Boolean(editForm.can_access_ceph_admin ?? editingUser.can_access_ceph_admin)
          : false;
      payload.can_access_storage_ops =
        currentIsAdminLike && (nextRole === "ui_user" || nextRole === "ui_admin" || nextRole === "ui_superadmin")
          ? Boolean(editForm.can_access_storage_ops ?? editingUser.can_access_storage_ops)
          : false;
      const nextRoleSupportsConnectionPermissions =
        nextRole === "ui_user" || nextRole === "ui_admin" || nextRole === "ui_superadmin";
      payload.can_create_manual_private_connections = nextRoleSupportsConnectionPermissions
        ? Boolean(
            editForm.can_create_manual_private_connections ??
              editingUser.can_create_manual_private_connections
          )
        : false;
      payload.can_provision_managed_private_connections = nextRoleSupportsConnectionPermissions
        ? Boolean(
            editForm.can_provision_managed_private_connections ??
              editingUser.can_provision_managed_private_connections
          )
        : false;
      payload.manager_tool_access =
        nextRole === "ui_user" || nextRole === "ui_admin" || nextRole === "ui_superadmin"
          ? normalizeManagerToolAccess(editForm.manager_tool_access ?? editingUser.manager_tool_access)
          : { ...DEFAULT_MANAGER_TOOL_ACCESS };
      payload.browser_advanced_features_enabled = Boolean(
        editForm.browser_advanced_features_enabled ?? editingUser.browser_advanced_features_enabled
      );
      payload.account_links = editSelectedS3Accounts.map((entry) => ({
        account_id: Number(entry.id),
        manager_role: entry.manager_role,
        portal_role: entry.portal_role,
        allow_manager_browser_data_access: Boolean(entry.allow_manager_browser_data_access),
      }));
      payload.group_ids = editSelectedGroups;
      payload.s3_user_links = editSelectedS3Users;
      payload.s3_connection_ids = editSelectedS3Connections;
      const updatedUser = await updateUser(editingUser.id, payload);
      if (currentUserId !== null && currentUserId === editingUser.id && typeof window !== "undefined") {
        setSessionUserCache({ ...(readStoredUser() ?? {}), ...updatedUser });
      }
      setActionMessage("User updated");
      closeEditModal();
      await fetchUsers();
      if (s3AccountsLoaded) {
        await fetchS3Accounts();
      }
    } catch (err) {
      setActionError(extractError(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteRequest = (user: User) => {
    const userId = user.id;
    if (currentUserId !== null && userId === currentUserId) {
      setActionError("You cannot delete your own user.");
      setActionMessage(null);
      return;
    }
    setPendingDeleteUser(user);
  };

  const handleDeleteConfirm = async () => {
    if (!pendingDeleteUser) return;
    const userId = pendingDeleteUser.id;
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
      setPendingDeleteUser(null);
    }
  };

  const usersDescription = "Create, edit, delete, and link UI users to groups, RGW accounts, S3 users, and S3 connections.";
  const associationLabel = "Storage associations";
  const filterPlaceholder = "Search users...";
  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: users.length,
  });
  const userTableColumns: Array<DataTableColumn<User, SortField>> = [
    {
      id: "user",
      label: "User",
      field: "name",
      primary: true,
      render: (user) => {
        const fullName = user.full_name?.trim();
        return (
          <span className="flex min-w-0 items-center gap-2.5">
            <UserAvatar
              avatar={user.avatar}
              name={fullName || user.email}
              email={user.email}
              size="md"
              decorative
            />
            <span className="min-w-0">
              <span className="block break-words">{fullName || user.email}</span>
              {fullName && (
                <span className={cx("block break-all text-[11px] font-medium", uiMutedTextClass)}>
                  {user.email}
                </span>
              )}
            </span>
          </span>
        );
      },
    },
    {
      id: "role",
      label: "Role",
      field: "role",
      render: (user) => (
        <div className="flex flex-wrap items-center gap-2">
          <span>{displayUiRole(user.role)}</span>
          {cephAdminFeatureEnabled &&
            (user.role === "ui_admin" || user.role === "ui_superadmin") &&
            user.can_access_ceph_admin && (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 ui-badge font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
                Ceph Admin
              </span>
            )}
        </div>
      ),
    },
    {
      id: "last_login_at",
      label: "Last login",
      field: "last_login_at",
      render: (user) => formatLastLogin(user.last_login_at),
    },
    {
      id: "associations",
      label: associationLabel,
      field: "accounts",
      mobileLabel: "Links",
      render: (user) => renderAssociationSummary(user),
    },
    {
      id: "actions",
      label: "Actions",
      align: "right",
      field: null,
      mobileRole: "actions",
      render: (user) => {
        const isCurrentUser = currentUserId !== null && user.id === currentUserId;
        const canManage = currentIsSuperAdmin || (user.role !== "ui_admin" && user.role !== "ui_superadmin");
        return (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => startEdit(user)}
              className={tableActionButtonClasses}
              disabled={!canManage}
              {...dataTableDefaultActionProps}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => handleDeleteRequest(user)}
              className={tableDeleteActionClasses}
              disabled={busyId === user.id || isCurrentUser || !canManage}
              title={isCurrentUser ? "You cannot delete your own user." : !canManage ? "Administrators can manage only standard users." : undefined}
            >
              {busyId === user.id ? "Deleting..." : "Delete"}
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div className={workflowPageHostClass(showCreateModal || (Boolean(editingUser) && showEditModal))}>
      <PageHeader
        title="UI Users"
        description={usersDescription}
        breadcrumbs={adminPageBreadcrumbs("users")}
        actions={[
          {
            label: "Create user",
            onClick: () => {
              resetCreateModalState();
              setShowCreateModal(true);
              void ensureS3Accounts({ retryOnError: true });
            },
          },
        ]}
      />
      {actionError && <PageBanner tone="error">{actionError}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}

      {showCreateModal && (
        <WorkflowPage
          title="Create user"
          description="Configure identity, workspace access, groups, and storage associations for this UI user."
          breadcrumbs={adminPageBreadcrumbs("users", { label: "Create" })}
          backLabel="Back to users"
          onBack={createCloseGuard.requestClose}
          contentVariant="plain"
          width="wide"
        >
          {actionError && (
            <PageBanner tone="error" className="mb-3">
              {actionError}
            </PageBanner>
          )}
          {actionMessage && (
            <PageBanner tone="success" className="mb-3">
              {actionMessage}
            </PageBanner>
          )}
          <form onSubmit={handleCreate} className="space-y-4">
            <WorkflowTabs<UserModalTab>
              activeTab={createModalTab}
              onTabChange={setCreateModalTab}
              ariaLabel="User creation sections"
              idPrefix="admin-user-create"
              tabs={userWorkflowTabs}
            >

            {createModalTab === "general" && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label className={userModalLabelClass}>Email *</label>
                  <input
                    type="email"
                    className={userModalFieldClass}
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="jane.doe@example.com"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className={userModalLabelClass}>Password *</label>
                  <input
                    type="password"
                    className={userModalFieldClass}
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    placeholder="•••••••"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className={userModalLabelClass}>Full name</label>
                  <input
                    className={userModalFieldClass}
                    value={form.full_name ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                    placeholder="Jane Doe"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <RoleAccessHelp
                    open={createRoleHelpOpen}
                    onToggle={() => setCreateRoleHelpOpen((prev) => !prev)}
                    helpId="create-user-role-access-help"
                  />
                  <select
                    className={userModalFieldClass}
                    value={createRoleValue}
                    onChange={(e) => {
                      const value = e.target.value as UiRole;
                      const supportsCephAdmin = value === "ui_admin" || value === "ui_superadmin";
                      const supportsStorageOps = value === "ui_user" || supportsCephAdmin;
                      setForm((f) => ({
                        ...f,
                        role: value,
                        can_access_ceph_admin:
                          currentIsSuperAdmin && supportsCephAdmin ? Boolean(f.can_access_ceph_admin) : false,
                        can_access_storage_ops:
                          currentIsAdminLike && supportsStorageOps ? Boolean(f.can_access_storage_ops) : false,
                        can_create_manual_private_connections: supportsStorageOps
                          ? Boolean(f.can_create_manual_private_connections)
                          : false,
                        can_provision_managed_private_connections: supportsStorageOps
                          ? Boolean(f.can_provision_managed_private_connections)
                          : false,
                      }));
                    }}
                  >
                    <option value="ui_none">No access</option>
                    <option value="ui_user">User</option>
                    <option value="ui_admin" disabled={!currentIsSuperAdmin}>Admin{currentIsSuperAdmin ? "" : " (restricted)"}</option>
                    <option value="ui_superadmin" disabled={!currentIsSuperAdmin}>
                      Superadmin{currentIsSuperAdmin ? "" : " (restricted)"}
                    </option>
                  </select>
                </div>
              </div>
            )}

            {createModalTab === "access" && (
              <WorkspaceAccessSection
                description="Additional operational workspaces available to this UI user."
                cephAdmin={{
                  title: "Ceph Admin access",
                  description:
                    'Allow access to /ceph-admin. Grantable only by Superadmin for roles "Admin" and "Superadmin".',
                  checked: createCanGrantCephAdmin && Boolean(form.can_access_ceph_admin),
                  disabled: !createCanGrantCephAdmin,
                  onChange: (value) =>
                    setForm((f) => ({
                      ...f,
                      can_access_ceph_admin: value,
                    })),
                  ariaLabel: "Allow access to /ceph-admin",
                }}
                storageOps={{
                  title: "Storage Ops access",
                  description:
                    'Allow access to /storage-ops. Grantable by Admin or Superadmin for roles "User" and "Admin"; "Superadmin" role updates require Superadmin.',
                  checked: createCanGrantStorageOps && Boolean(form.can_access_storage_ops),
                  disabled: !createCanGrantStorageOps,
                  onChange: (value) =>
                    setForm((f) => ({
                      ...f,
                      can_access_storage_ops: value,
                    })),
                  ariaLabel: "Allow access to /storage-ops",
                }}
              />
            )}

            {createModalTab === "browser" && (
              <BrowserAccessSection
                description="Browser options for this UI user. Groups can also grant these options."
                checked={Boolean(form.browser_advanced_features_enabled)}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    browser_advanced_features_enabled: value,
                  }))
                }
              />
            )}

            {createModalTab === "connections" && (
              <AdminAccessToggleSection
                title="Connections"
                description="Private S3 connection permissions for this UI user. Groups can also grant this permission."
                items={[
                  {
                    title: "Create manual private connections",
                    description: "Allow credentials supplied by the user on a registered endpoint or a custom URL.",
                    checked: createTargetSupportsManagerTools && Boolean(form.can_create_manual_private_connections),
                    disabled: !createTargetSupportsManagerTools,
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

            {createModalTab === "manager" && (
              <div className="space-y-4">
                {!createTargetSupportsManagerTools && (
                  <PageBanner tone="warning">
                    Manager access requires the target role to be User, Admin, or Superadmin.
                  </PageBanner>
                )}
                <AdminAccessToggleSection
                  title="Managed private access"
                  description="Server-side provisioning permissions for this UI user."
                  items={[
                    {
                      title: "Provision managed private connections",
                      description: "Allow server-side IAM or RGW credential provisioning without revealing generated secrets.",
                      checked: createTargetSupportsManagerTools && Boolean(form.can_provision_managed_private_connections),
                      disabled:
                        !createTargetSupportsManagerTools ||
                        !generalSettings.managed_private_connection_provisioning_enabled,
                      onChange: (value) =>
                        setForm((current) => ({
                          ...current,
                          can_provision_managed_private_connections: value,
                        })),
                      ariaLabel: "Allow managed private connection provisioning",
                      badge: {
                        visible: !generalSettings.managed_private_connection_provisioning_enabled,
                        label: "Disabled globally",
                        tone: "neutral",
                      },
                    },
                  ]}
                />
                <ManagerToolAccessSection
                  title="Bucket tools"
                  description="Manager permissions for advanced operations."
                  tools={managerToolDefinitions}
                  access={form.manager_tool_access}
                  isToolDisabled={(tool) => !createTargetSupportsManagerTools || !tool.enabled}
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

            {createModalTab === "associations" && (
              <UserAssociationsTabs
                activeTab={createAssociationsTab}
                onTabChange={(nextTab) => {
                  const tabChanged = nextTab !== createAssociationsTab;
                  setCreateAssociationsTab(nextTab);
                  setShowCreateAccountPanel(false);
                  setShowCreateS3UserPanel(false);
                  setShowCreateConnectionPanel(false);
                  if (tabChanged) {
                    void ensureAssociationOptionsForTab(nextTab, { retryOnError: true });
                  }
                }}
                maxVisibleOptions={MAX_VISIBLE_OPTIONS}
                showPortalRole={showPortalRole}
                accounts={{
                  selected: createSelectedS3Accounts,
                  setSelected: setCreateSelectedS3Accounts,
                  optionsById: accountOptionsById,
                  available: availableCreateS3Accounts,
                  visible: visibleCreateS3Accounts,
                  search: createS3AccountSearch,
                  setSearch: setCreateS3AccountSearch,
                  loading: s3AccountsLoading,
                  showPanel: showCreateAccountPanel,
                  setShowPanel: setShowCreateAccountPanel,
                  selections: createAccountSelections,
                  setSelections: setCreateAccountSelections,
                  accountAccessChoice: createAccountAccessChoice,
                  setAccountAccessChoice: setCreateAccountAccessChoice,
                  toggleSelection: toggleCreateAccountSelection,
                }}
                s3Users={{
                  selected: createSelectedS3Users,
                  setSelected: setCreateSelectedS3Users,
                  labelById: s3UserLabelById,
                  available: availableCreateS3Users,
                  visible: visibleCreateS3Users,
                  search: createS3Search,
                  setSearch: setCreateS3Search,
                  loading: s3UsersLoading,
                  showPanel: showCreateS3UserPanel,
                  setShowPanel: setShowCreateS3UserPanel,
                  selections: createS3UserSelections,
                  setSelections: setCreateS3UserSelections,
                  toggleSelection: toggleCreateS3UserSelection,
                }}
                connections={{
                  selected: createSelectedS3Connections,
                  setSelected: setCreateSelectedS3Connections,
                  labelById: s3ConnectionLabelById,
                  available: availableCreateS3Connections,
                  visible: visibleCreateS3Connections,
                  search: createConnectionSearch,
                  setSearch: setCreateConnectionSearch,
                  loading: s3ConnectionsLoading,
                  showPanel: showCreateConnectionPanel,
                  setShowPanel: setShowCreateConnectionPanel,
                  selections: createConnectionSelections,
                  setSelections: setCreateConnectionSelections,
                  toggleSelection: toggleCreateConnectionSelection,
                }}
              />
            )}

            {createModalTab === "groups" && (
              <UserGroupsSelector
                groups={groups}
                groupsLoaded={groupsLoaded}
                groupsLoading={groupsLoading}
                maxVisibleOptions={MAX_VISIBLE_OPTIONS}
                selectedIds={createSelectedGroups}
                setSelectedIds={setCreateSelectedGroups}
                search={createGroupSearch}
                setSearch={setCreateGroupSearch}
                visibleGroups={visibleCreateGroups}
                showPanel={showCreateGroupPanel}
                setShowPanel={setShowCreateGroupPanel}
                selections={createGroupSelections}
                setSelections={setCreateGroupSelections}
              />
            )}
            </WorkflowTabs>

            <WorkflowActions>
              <UiButton variant="secondary" onClick={createCloseGuard.requestClose}>
                Cancel
              </UiButton>
              <UiButton type="submit">
                Create
              </UiButton>
            </WorkflowActions>
          </form>
          {createCloseGuard.confirmationDialog}
        </WorkflowPage>
      )}

      <ListPageSection
          title="Users"
          description="Search matches across the full user record, including role and linked entities."
          countLabel={`${totalUsers} entr${totalUsers === 1 ? "y" : "ies"}`}
          search={
            <ToolbarSearchInput
              value={filter}
              onChange={handleFilterChange}
              placeholder={filterPlaceholder}
              className="min-w-0 flex-1 sm:w-64 md:w-72"
            />
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
          primaryColumnId="user"
          responsiveCards
          tableClassName="compact-table"
          sort={{ field: sort.field, direction: sort.direction, onSort: toggleSort }}
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

      {pendingDeleteUser && (
        <ConfirmActionDialog
          title="Delete UI user"
          description="This removes the platform user and revokes access to the UI workspaces linked to it."
          confirmLabel="Delete user"
          details={[
            { label: "User", value: pendingDeleteUser.email, mono: true },
            { label: "Role", value: displayUiRole(pendingDeleteUser.role) },
          ]}
          impacts={[
            "The user loses access immediately after deletion.",
            "Linked accounts, S3 users, and S3 connections remain in the platform but are no longer attached to this UI user.",
          ]}
          loading={busyId === pendingDeleteUser.id}
          onCancel={() => setPendingDeleteUser(null)}
          onConfirm={() => void handleDeleteConfirm()}
        />
      )}

      {editingUser && showEditModal && (
        <WorkflowPage
          title="Edit user"
          description="Manage direct access, inherited associations, workspace permissions, and Manager permissions for this UI user."
          breadcrumbs={adminPageBreadcrumbs("users", { label: "Edit" })}
          backLabel="Back to users"
          onBack={editCloseGuard.requestClose}
          contentVariant="plain"
          width="wide"
          metaContent={<WorkflowMetadata items={[{ label: "Identity", value: editingUser.email }]} />}
        >
          {actionError && (
            <PageBanner tone="error" className="mb-3">
              {actionError}
            </PageBanner>
          )}
          {actionMessage && (
            <PageBanner tone="success" className="mb-3">
              {actionMessage}
            </PageBanner>
          )}
          <form onSubmit={submitEdit} className="space-y-4">
            <WorkflowTabs<UserModalTab>
              activeTab={editModalTab}
              onTabChange={setEditModalTab}
              ariaLabel="User configuration sections"
              idPrefix="admin-user-edit"
              tabs={editUserWorkflowTabs}
            >

            {editModalTab === "general" && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label className={userModalLabelClass}>Email</label>
                  <input
                    type="email"
                    className={userModalFieldClass}
                    value={editForm.email ?? ""}
                    onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className={userModalLabelClass}>Full name</label>
                  <input
                    className={userModalFieldClass}
                    value={editForm.full_name ?? ""}
                    onChange={(e) => setEditForm((f) => ({ ...f, full_name: e.target.value }))}
                    placeholder="Jane Doe"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <RoleAccessHelp
                    open={editRoleHelpOpen}
                    onToggle={() => setEditRoleHelpOpen((prev) => !prev)}
                    helpId="edit-user-role-access-help"
                  />
                  <select
                    className={userModalFieldClass}
                    value={editRoleValue}
                    onChange={(e) => {
                      const value = e.target.value as UiRole;
                      const supportsCephAdmin = value === "ui_admin" || value === "ui_superadmin";
                      const supportsStorageOps = value === "ui_user" || supportsCephAdmin;
                      setEditForm((f) => ({
                        ...f,
                        role: value,
                        can_access_ceph_admin:
                          currentIsSuperAdmin && supportsCephAdmin ? Boolean(f.can_access_ceph_admin) : false,
                        can_access_storage_ops:
                          currentIsAdminLike && supportsStorageOps ? Boolean(f.can_access_storage_ops) : false,
                        can_create_manual_private_connections: supportsStorageOps
                          ? Boolean(f.can_create_manual_private_connections)
                          : false,
                        can_provision_managed_private_connections: supportsStorageOps
                          ? Boolean(f.can_provision_managed_private_connections)
                          : false,
                      }));
                    }}
                  >
                    <option value="ui_none">No access</option>
                    <option value="ui_user">User</option>
                    <option value="ui_admin" disabled={!currentIsSuperAdmin}>Admin{currentIsSuperAdmin ? "" : " (restricted)"}</option>
                    <option value="ui_superadmin" disabled={!currentIsSuperAdmin}>
                      Superadmin{currentIsSuperAdmin ? "" : " (restricted)"}
                    </option>
                  </select>
                </div>
              </div>
            )}

            {editModalTab === "authentication" && (
              <UserAuthenticationPanel
                userId={editingUser.id}
                canMutate={currentUserId === null || currentUserId !== editingUser.id}
              />
            )}

            {editModalTab === "access" && (
              <WorkspaceAccessSection
                description="Additional operational workspaces available to this UI user."
                cephAdmin={{
                  title: "Ceph Admin access",
                  description:
                    'Allow access to /ceph-admin. Grantable only by Superadmin for roles "Admin" and "Superadmin".',
                  checked: editCanGrantCephAdmin && Boolean(editForm.can_access_ceph_admin),
                  disabled: !editCanGrantCephAdmin,
                  onChange: (value) =>
                    setEditForm((f) => ({
                      ...f,
                      can_access_ceph_admin: value,
                    })),
                  ariaLabel: "Allow access to /ceph-admin",
                }}
                storageOps={{
                  title: "Storage Ops access",
                  description:
                    'Allow access to /storage-ops. Grantable by Admin or Superadmin for roles "User" and "Admin"; "Superadmin" role updates require Superadmin.',
                  checked: editCanGrantStorageOps && Boolean(editForm.can_access_storage_ops),
                  disabled: !editCanGrantStorageOps,
                  onChange: (value) =>
                    setEditForm((f) => ({
                      ...f,
                      can_access_storage_ops: value,
                    })),
                  ariaLabel: "Allow access to /storage-ops",
                }}
              />
            )}

            {editModalTab === "browser" && (
              <BrowserAccessSection
                description="Browser options for this UI user. Groups can also grant these options."
                checked={Boolean(editForm.browser_advanced_features_enabled ?? editingUser.browser_advanced_features_enabled)}
                onChange={(value) =>
                  setEditForm((current) => ({
                    ...current,
                    browser_advanced_features_enabled: value,
                  }))
                }
              />
            )}

            {editModalTab === "connections" && (
              <AdminAccessToggleSection
                title="Connections"
                description="Private S3 connection permissions for this UI user. Groups can also grant this permission."
                items={[
                  {
                    title: "Create manual private connections",
                    description: "Allow credentials supplied by the user on a registered endpoint or a custom URL.",
                    checked: editTargetSupportsManagerTools && Boolean(editForm.can_create_manual_private_connections),
                    disabled: !editTargetSupportsManagerTools,
                    onChange: (value) =>
                      setEditForm((current) => ({
                        ...current,
                        can_create_manual_private_connections: value,
                      })),
                    ariaLabel: "Allow manual private connection creation",
                  },
                ]}
              />
            )}

            {editModalTab === "manager" && (
              <div className="space-y-4">
                  {!editTargetSupportsManagerTools && (
                    <PageBanner tone="warning">
                      Manager access requires the target role to be User, Admin, or Superadmin.
                    </PageBanner>
                  )}
                <AdminAccessToggleSection
                  title="Managed private access"
                  description="Server-side provisioning permissions for this UI user."
                  items={[
                    {
                      title: "Provision managed private connections",
                      description: "Allow server-side IAM or RGW credential provisioning without revealing generated secrets.",
                      checked: editTargetSupportsManagerTools && Boolean(editForm.can_provision_managed_private_connections),
                      disabled:
                        !editTargetSupportsManagerTools ||
                        !generalSettings.managed_private_connection_provisioning_enabled,
                      onChange: (value) =>
                        setEditForm((current) => ({
                          ...current,
                          can_provision_managed_private_connections: value,
                        })),
                      ariaLabel: "Allow managed private connection provisioning",
                      badge: {
                        visible: !generalSettings.managed_private_connection_provisioning_enabled,
                        label: "Disabled globally",
                        tone: "neutral",
                      },
                    },
                  ]}
                />
                <ManagerToolAccessSection
                  title="Bucket tools"
                  description="Manager permissions for advanced operations."
                  tools={managerToolDefinitions}
                  access={editForm.manager_tool_access ?? editingUser.manager_tool_access}
                  isToolDisabled={(tool) => !editTargetSupportsManagerTools || !tool.enabled}
                  onChange={(key: ManagerToolKey, value) =>
                    setEditForm((f) => ({
                      ...f,
                      manager_tool_access: {
                        ...normalizeManagerToolAccess(f.manager_tool_access ?? editingUser.manager_tool_access),
                        [key]: value,
                      },
                    }))
                  }
                />
              </div>
            )}

            {editModalTab === "associations" && (
              <UserAssociationsTabs
                activeTab={editAssociationsTab}
                onTabChange={(nextTab) => {
                  const tabChanged = nextTab !== editAssociationsTab;
                  setEditAssociationsTab(nextTab);
                  setShowEditAccountPanel(false);
                  setShowEditS3UserPanel(false);
                  setShowEditConnectionPanel(false);
                  if (tabChanged) {
                    void ensureAssociationOptionsForTab(nextTab, { retryOnError: true });
                  }
                }}
                maxVisibleOptions={MAX_VISIBLE_OPTIONS}
                showPortalRole={showPortalRole}
                accounts={{
                  selected: editSelectedS3Accounts,
                  setSelected: setEditSelectedS3Accounts,
                  optionsById: accountOptionsById,
                  available: availableEditS3Accounts,
                  visible: visibleEditS3Accounts,
                  search: editS3AccountSearch,
                  setSearch: setEditS3AccountSearch,
                  loading: s3AccountsLoading,
                  showPanel: showEditAccountPanel,
                  setShowPanel: setShowEditAccountPanel,
                  selections: editAccountSelections,
                  setSelections: setEditAccountSelections,
                  accountAccessChoice: editAccountAccessChoice,
                  setAccountAccessChoice: setEditAccountAccessChoice,
                  toggleSelection: toggleEditAccountSelection,
                }}
                s3Users={{
                  selected: editSelectedS3Users,
                  setSelected: setEditSelectedS3Users,
                  labelById: s3UserLabelById,
                  available: availableEditS3Users,
                  visible: visibleEditS3Users,
                  search: editS3Search,
                  setSearch: setEditS3Search,
                  loading: s3UsersLoading,
                  showPanel: showEditS3UserPanel,
                  setShowPanel: setShowEditS3UserPanel,
                  selections: editS3UserSelections,
                  setSelections: setEditS3UserSelections,
                  toggleSelection: toggleEditS3UserSelection,
                }}
                connections={{
                  selected: editSelectedS3Connections,
                  setSelected: setEditSelectedS3Connections,
                  labelById: s3ConnectionLabelById,
                  available: availableEditS3Connections,
                  visible: visibleEditS3Connections,
                  search: editConnectionSearch,
                  setSearch: setEditConnectionSearch,
                  loading: s3ConnectionsLoading,
                  showPanel: showEditConnectionPanel,
                  setShowPanel: setShowEditConnectionPanel,
                  selections: editConnectionSelections,
                  setSelections: setEditConnectionSelections,
                  toggleSelection: toggleEditConnectionSelection,
                }}
              />
            )}

            {editModalTab === "groups" && (
              <UserGroupsSelector
                groups={groups}
                groupsLoaded={groupsLoaded}
                groupsLoading={groupsLoading}
                maxVisibleOptions={MAX_VISIBLE_OPTIONS}
                selectedIds={editSelectedGroups}
                setSelectedIds={setEditSelectedGroups}
                search={editGroupSearch}
                setSearch={setEditGroupSearch}
                visibleGroups={visibleEditGroups}
                showPanel={showEditGroupPanel}
                setShowPanel={setShowEditGroupPanel}
                selections={editGroupSelections}
                setSelections={setEditGroupSelections}
              />
            )}
            </WorkflowTabs>

            <WorkflowActions>
              {editModalTab === "authentication" ? (
                <UiButton variant="secondary" onClick={editCloseGuard.requestClose}>
                  Done
                </UiButton>
              ) : (
                <>
                  <UiButton variant="secondary" onClick={editCloseGuard.requestClose}>
                    Cancel
                  </UiButton>
                  <UiButton
                    type="submit"
                    disabled={busyId === editingUser.id}
                  >
                    {busyId === editingUser.id ? "Saving..." : "Save"}
                  </UiButton>
                </>
              )}
            </WorkflowActions>
          </form>
          {editCloseGuard.confirmationDialog}
        </WorkflowPage>
      )}
    </div>
  );
}
