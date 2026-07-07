/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type Dispatch, type FormEvent, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { UiGroupSummary, listMinimalGroups } from "../../api/groups";
import { S3AccountSummary, listMinimalS3Accounts, updateS3Account } from "../../api/accounts";
import { S3UserSummary, listMinimalS3Users } from "../../api/s3Users";
import { S3ConnectionSummary, listMinimalS3Connections } from "../../api/s3ConnectionsAdmin";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import ListToolbar from "../../components/ListToolbar";
import Modal from "../../components/Modal";
import PageHeader from "../../components/PageHeader";
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
import AdminModalTabs from "./AdminModalTabs";
import {
  DEFAULT_MANAGER_TOOL_ACCESS,
  PORTAL_ROLE_OPTIONS,
  buildManagerToolDefinitions,
  normalizeManagerToolAccess,
  normalizePortalRole,
  type ManagerToolKey,
  type PortalAccountRole,
} from "./adminAccessConfig";
import PageBanner from "../../components/PageBanner";
import PageTabs from "../../components/PageTabs";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { toolbarCompactInputClasses } from "../../components/toolbarControlClasses";
import { cx, uiButtonBaseClass, uiButtonVariants, uiInputClass } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { CLIENT_STORAGE_KEYS, readClientJson, writeClientJson } from "../../utils/clientStorage";
import { stableSignature } from "../../utils/stableSignature";
import { isAdminLikeRole, isSuperAdminRole, readStoredUser } from "../../utils/workspaces";
import {
  AdminAssociationPickerPanel,
  AdminAssociationSectionHeader,
  adminAssociationAccountOptionRowClass,
  adminAssociationAdminLabelClass,
  adminAssociationAddPanelClass,
  adminAssociationCheckboxClass,
  adminAssociationCompactInputClass,
  adminAssociationCompactSelectClass,
  adminAssociationOptionLabelClass,
  adminAssociationOptionRowClass,
  adminAssociationTableClass as associationTableClass,
  adminAssociationTableContainerClass as associationTableContainerClass,
} from "./AdminAssociationPicker";

type AssociationTab = "accounts" | "s3_users" | "connections";
type UserModalTab = "general" | "associations" | "groups" | "access" | "browser" | "manager_tools";
type AuxiliaryLoadState = "idle" | "loading" | "loaded" | "error";

type AccountSelection = {
  id: number;
  account_admin?: boolean;
  account_role?: PortalAccountRole;
};

type Option = {
  id: number;
  label: string;
};

const userModalLabelClass = "ui-body font-medium text-[var(--ui-text)]";
const userModalFieldClass = cx(uiInputClass, "px-3 py-2 ui-body");
const userModalCancelButtonClass = cx(uiButtonBaseClass, uiButtonVariants.secondary, "px-4 py-2 ui-body");
const associationAddPanelClass = adminAssociationAddPanelClass;
const associationCompactInputClass = adminAssociationCompactInputClass;
const associationCompactSelectClass = adminAssociationCompactSelectClass;
const associationOptionRowClass = adminAssociationOptionRowClass;
const associationAccountOptionRowClass = adminAssociationAccountOptionRowClass;
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

type AssociationsTabsProps = {
  activeTab: AssociationTab;
  onTabChange: (tab: AssociationTab) => void;
  maxVisibleOptions: number;
  showPortalRole: boolean;
  accounts: {
    selected: AccountSelection[];
    setSelected: Dispatch<SetStateAction<AccountSelection[]>>;
    optionsById: Map<number, S3AccountSummary>;
    available: Option[];
    visible: Option[];
    search: string;
    setSearch: Dispatch<SetStateAction<string>>;
    loading: boolean;
    showPanel: boolean;
    setShowPanel: Dispatch<SetStateAction<boolean>>;
    selections: number[];
    setSelections: Dispatch<SetStateAction<number[]>>;
    adminChoice: Record<number, boolean>;
    setAdminChoice: Dispatch<SetStateAction<Record<number, boolean>>>;
    toggleSelection: (id: number) => void;
  };
  s3Users: {
    selected: number[];
    setSelected: Dispatch<SetStateAction<number[]>>;
    labelById: Map<number, string>;
    available: Option[];
    visible: Option[];
    search: string;
    setSearch: Dispatch<SetStateAction<string>>;
    loading: boolean;
    showPanel: boolean;
    setShowPanel: Dispatch<SetStateAction<boolean>>;
    selections: number[];
    setSelections: Dispatch<SetStateAction<number[]>>;
    toggleSelection: (id: number) => void;
  };
  connections: {
    selected: number[];
    setSelected: Dispatch<SetStateAction<number[]>>;
    labelById: Map<number, string>;
    available: Option[];
    visible: Option[];
    search: string;
    setSearch: Dispatch<SetStateAction<string>>;
    loading: boolean;
    showPanel: boolean;
    setShowPanel: Dispatch<SetStateAction<boolean>>;
    selections: number[];
    setSelections: Dispatch<SetStateAction<number[]>>;
    toggleSelection: (id: number) => void;
  };
};

const AssociationsTabs = ({
  activeTab,
  onTabChange,
  maxVisibleOptions,
  showPortalRole,
  accounts,
  s3Users,
  connections,
}: AssociationsTabsProps) => {
  const totalSelected =
    accounts.selected.length + s3Users.selected.length + connections.selected.length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Associations</label>
          <span className="ui-caption text-slate-500">{totalSelected} total</span>
        </div>
      </div>
      <PageTabs
        tabs={[
          {
            id: "accounts",
            label: `Accounts (${accounts.selected.length})`,
            content: (
              <div className="space-y-3">
                <AdminAssociationSectionHeader
                  title="Linked accounts"
                  countLabel={`${accounts.selected.length} linked`}
                  actionLabel={accounts.showPanel ? "Close" : "Add accounts"}
                  onAction={() => accounts.setShowPanel((prev) => !prev)}
                />
                <div className={associationTableContainerClass}>
                  <table className={associationTableClass}>
                    <thead>
                      <tr>
                        <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Account
                        </th>
                        <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Admin
                        </th>
                        {showPortalRole && (
                          <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Portal role
                          </th>
                        )}
                        <th className="px-3 py-2 text-right ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {accounts.selected.length === 0 ? (
                        <tr>
                          <td colSpan={showPortalRole ? 4 : 3} className="px-3 py-3 ui-body text-slate-500 dark:text-slate-400">
                            No account linked yet.
                          </td>
                        </tr>
                      ) : (
                        accounts.selected.map((entry) => {
                          const label =
                            accounts.optionsById.get(Number(entry.id))?.name ?? `S3Account #${entry.id}`;
                          return (
                            <tr key={entry.id}>
                              <td className="px-3 py-2 ui-body text-slate-700 dark:text-slate-200">{label}</td>
                              <td className="px-3 py-2">
                                <label className="flex items-center gap-2 ui-caption font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(entry.account_admin)}
                                    onChange={(e) =>
                                      accounts.setSelected((prev) =>
                                        prev.map((item) =>
                                          item.id === entry.id ? { ...item, account_admin: e.target.checked } : item
                                        )
                                      )
                                    }
                                    className={adminAssociationCheckboxClass}
                                  />
                                  Admin
                                </label>
                              </td>
                              {showPortalRole && (
                                <td className="px-3 py-2">
                                  <select
                                    value={normalizePortalRole(entry.account_role)}
                                    onChange={(e) =>
                                      accounts.setSelected((prev) =>
                                        prev.map((item) =>
                                          item.id === entry.id
                                            ? { ...item, account_role: normalizePortalRole(e.target.value) }
                                            : item
                                        )
                                      )
                                    }
                                    className={associationCompactSelectClass}
                                  >
                                    {PORTAL_ROLE_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                              )}
                              <td className="px-3 py-2 text-right">
                                <button
                                  type="button"
                                  onClick={() =>
                                    accounts.setSelected((prev) => prev.filter((acc) => acc.id !== entry.id))
                                  }
                                  className={tableDeleteActionClasses}
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                {accounts.showPanel && (
                  <AdminAssociationPickerPanel
                    title="Add accounts"
                    hint="(search by name)"
                    search={accounts.search}
                    onSearchChange={accounts.setSearch}
                    loading={accounts.loading}
                    availableCount={accounts.available.length}
                    maxVisibleOptions={maxVisibleOptions}
                    selectedCount={accounts.selections.length}
                    loadingLabel="Loading accounts..."
                    addDisabled={accounts.selections.length === 0}
                    onCancel={() => {
                      accounts.setShowPanel(false);
                      accounts.setSelections([]);
                      accounts.setSearch("");
                    }}
                    onAdd={() => {
                      if (accounts.selections.length === 0) return;
                      const next = accounts.selections.map((accountId) => {
                        const account_admin = accounts.adminChoice[accountId] ?? false;
                        return { id: accountId, account_admin, account_role: "portal_none" as PortalAccountRole };
                      });
                      accounts.setSelected((prev) => [...prev, ...next]);
                      accounts.setSelections([]);
                      accounts.setSearch("");
                      accounts.setShowPanel(false);
                    }}
                  >
                      {accounts.visible.map((opt) => {
                        const accountId = Number(opt.id);
                        const isSelected = accounts.selections.includes(accountId);
                        const adminChecked = accounts.adminChoice[accountId] ?? false;
                        return (
                          <div
                            key={opt.id}
                            className={associationAccountOptionRowClass(isSelected)}
                          >
                            <label className={adminAssociationOptionLabelClass}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => accounts.toggleSelection(accountId)}
                                className={adminAssociationCheckboxClass}
                              />
                              <span>{opt.label}</span>
                            </label>
                            <div className="flex items-center gap-2">
                              <label className={adminAssociationAdminLabelClass}>
                                <input
                                  type="checkbox"
                                  checked={Boolean(adminChecked)}
                                  onChange={(e) =>
                                    accounts.setAdminChoice((prev) => ({
                                      ...prev,
                                      [accountId]: e.target.checked,
                                    }))
                                  }
                                  className={adminAssociationCheckboxClass}
                                />
                                Admin
                              </label>
                            </div>
                          </div>
                        );
                      })}
                  </AdminAssociationPickerPanel>
                )}
              </div>
            ),
          },
          {
            id: "s3_users",
            label: `S3 Users (${s3Users.selected.length})`,
            content: (
              <div className="space-y-3">
                <AdminAssociationSectionHeader
                  title="Linked users"
                  countLabel={`${s3Users.selected.length} linked`}
                  actionLabel={s3Users.showPanel ? "Close" : "Add users"}
                  onAction={() => s3Users.setShowPanel((prev) => !prev)}
                />
                <div className={associationTableContainerClass}>
                  <table className={associationTableClass}>
                    <thead>
                      <tr>
                        <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          User
                        </th>
                        <th className="px-3 py-2 text-right ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {s3Users.selected.length === 0 ? (
                        <tr>
                          <td colSpan={2} className="px-3 py-3 ui-body text-slate-500 dark:text-slate-400">
                            No user linked yet.
                          </td>
                        </tr>
                      ) : (
                        s3Users.selected.map((id) => (
                          <tr key={id}>
                            <td className="px-3 py-2 ui-body text-slate-700 dark:text-slate-200">
                              {s3Users.labelById.get(id) ?? `User #${id}`}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                onClick={() => s3Users.setSelected((prev) => prev.filter((s3Id) => s3Id !== id))}
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
                {s3Users.showPanel && (
                  <AdminAssociationPickerPanel
                    title="Add users"
                    hint="(search by name)"
                    search={s3Users.search}
                    onSearchChange={s3Users.setSearch}
                    loading={s3Users.loading}
                    availableCount={s3Users.available.length}
                    maxVisibleOptions={maxVisibleOptions}
                    selectedCount={s3Users.selections.length}
                    loadingLabel="Loading users..."
                    addDisabled={s3Users.selections.length === 0}
                    onCancel={() => {
                      s3Users.setShowPanel(false);
                      s3Users.setSelections([]);
                      s3Users.setSearch("");
                    }}
                    onAdd={() => {
                      if (s3Users.selections.length === 0) return;
                      s3Users.setSelected((prev) => [...prev, ...s3Users.selections]);
                      s3Users.setSelections([]);
                      s3Users.setSearch("");
                      s3Users.setShowPanel(false);
                    }}
                  >
                      {s3Users.visible.map((opt) => {
                        const isSelected = s3Users.selections.includes(opt.id);
                        return (
                          <div
                            key={opt.id}
                            className={associationOptionRowClass(isSelected)}
                          >
                            <label className={adminAssociationOptionLabelClass}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => s3Users.toggleSelection(opt.id)}
                                className={adminAssociationCheckboxClass}
                              />
                              <span>{opt.label}</span>
                            </label>
                          </div>
                        );
                      })}
                  </AdminAssociationPickerPanel>
                )}
              </div>
            ),
          },
          {
            id: "connections",
            label: `Connections (${connections.selected.length})`,
            content: (
              <div className="space-y-3">
                <AdminAssociationSectionHeader
                  title={
                    <>
                      Linked connections <span className="ui-caption text-slate-400">(shared only)</span>
                    </>
                  }
                  countLabel={`${connections.selected.length} linked`}
                  actionLabel={connections.showPanel ? "Close" : "Add connections"}
                  onAction={() => connections.setShowPanel((prev) => !prev)}
                />
                <div className={associationTableContainerClass}>
                  <table className={associationTableClass}>
                    <thead>
                      <tr>
                        <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Connection
                        </th>
                        <th className="px-3 py-2 text-right ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {connections.selected.length === 0 ? (
                        <tr>
                          <td colSpan={2} className="px-3 py-3 ui-body text-slate-500 dark:text-slate-400">
                            No connection linked yet.
                          </td>
                        </tr>
                      ) : (
                        connections.selected.map((id) => (
                          <tr key={id}>
                            <td className="px-3 py-2 ui-body text-slate-700 dark:text-slate-200">
                              {connections.labelById.get(id) ?? `Connection #${id}`}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                onClick={() =>
                                  connections.setSelected((prev) => prev.filter((connId) => connId !== id))
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
                {connections.showPanel && (
                  <AdminAssociationPickerPanel
                    title="Add connections"
                    hint="(search by name)"
                    search={connections.search}
                    onSearchChange={connections.setSearch}
                    loading={connections.loading}
                    availableCount={connections.available.length}
                    maxVisibleOptions={maxVisibleOptions}
                    selectedCount={connections.selections.length}
                    loadingLabel="Loading connections..."
                    addDisabled={connections.selections.length === 0}
                    onCancel={() => {
                      connections.setShowPanel(false);
                      connections.setSelections([]);
                      connections.setSearch("");
                    }}
                    onAdd={() => {
                      if (connections.selections.length === 0) return;
                      connections.setSelected((prev) => [...prev, ...connections.selections]);
                      connections.setSelections([]);
                      connections.setSearch("");
                      connections.setShowPanel(false);
                    }}
                  >
                      {connections.visible.map((opt) => {
                        const isSelected = connections.selections.includes(opt.id);
                        return (
                          <div
                            key={opt.id}
                            className={associationOptionRowClass(isSelected)}
                          >
                            <label className={adminAssociationOptionLabelClass}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => connections.toggleSelection(opt.id)}
                                className={adminAssociationCheckboxClass}
                              />
                              <span>{opt.label}</span>
                            </label>
                          </div>
                        );
                      })}
                  </AdminAssociationPickerPanel>
                )}
              </div>
            ),
          },
        ]}
        activeTab={activeTab}
        onChange={(id) => {
          const nextTab = id === "s3_users" ? "s3_users" : id === "connections" ? "connections" : "accounts";
          onTabChange(nextTab);
        }}
      />
    </div>
  );
};

export default function UsersPage() {
  type SortField = "email" | "role" | "accounts" | "last_login_at";

  const MAX_VISIBLE_OPTIONS = 10;
  const { generalSettings } = useGeneralSettings();
  const currentUser = useMemo(() => readStoredUser(), []);
  const currentUserId = currentUser?.id != null ? Number(currentUser.id) : null;
  const currentIsAdminLike = isAdminLikeRole(currentUser?.role);
  const currentIsSuperAdmin = isSuperAdminRole(currentUser?.role);
  const cephAdminFeatureEnabled = generalSettings.ceph_admin_enabled;
  const showPortalRole = Boolean(generalSettings.portal_enabled);
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
    password: "",
    role: "ui_user",
    can_access_ceph_admin: false,
    can_access_storage_ops: false,
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
      accountAdminChoice: {},
    })
  );
  const [createSelectedS3Accounts, setCreateSelectedS3Accounts] = useState<AccountSelection[]>([]);
  const [createSelectedS3Users, setCreateSelectedS3Users] = useState<number[]>([]);
  const [createSelectedS3Connections, setCreateSelectedS3Connections] = useState<number[]>([]);
  const [createSelectedGroups, setCreateSelectedGroups] = useState<number[]>([]);
  const [createAccountAdminChoice, setCreateAccountAdminChoice] = useState<Record<number, boolean>>({});
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
      accountAdminChoice: {},
    })
  );
  const [editSelectedS3Accounts, setEditSelectedS3Accounts] = useState<AccountSelection[]>([]);
  const [editSelectedS3Users, setEditSelectedS3Users] = useState<number[]>([]);
  const [editSelectedS3Connections, setEditSelectedS3Connections] = useState<number[]>([]);
  const [editSelectedGroups, setEditSelectedGroups] = useState<number[]>([]);
  const [editAccountAdminChoice, setEditAccountAdminChoice] = useState<Record<number, boolean>>({});
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
  const [busyId, setBusyId] = useState<number | null>(null);
  const [pendingDeleteUser, setPendingDeleteUser] = useState<User | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [createRoleHelpOpen, setCreateRoleHelpOpen] = useState(false);
  const [editRoleHelpOpen, setEditRoleHelpOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ field: SortField; direction: "asc" | "desc" }>({
    field: "email",
    direction: "asc",
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalUsers, setTotalUsers] = useState(0);
  const s3AccountsLoadStateRef = useRef<AuxiliaryLoadState>("idle");
  const s3UsersLoadStateRef = useRef<AuxiliaryLoadState>("idle");
  const s3ConnectionsLoadStateRef = useRef<AuxiliaryLoadState>("idle");
  const groupsLoadStateRef = useRef<AuxiliaryLoadState>("idle");
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
  const s3ConnectionOptions = useMemo(
    () => s3Connections.filter((conn) => conn.is_shared !== false).map((conn) => ({ id: conn.id, label: conn.name })),
    [s3Connections]
  );
  const s3SharedConnectionOptions = s3ConnectionOptions;
  const s3ConnectionLabelById = useMemo(() => {
    const map = new Map<number, string>();
    s3Connections.forEach((conn) => map.set(conn.id, conn.name));
    return map;
  }, [s3Connections]);
  const groupLabelById = useMemo(() => {
    const map = new Map<number, string>();
    groups.forEach((group) => map.set(group.id, group.name));
    return map;
  }, [groups]);
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
      (opt) => !editSelectedS3Users.includes(opt.id) && (!query || opt.label.toLowerCase().includes(query))
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
    return groups.filter((group) => !query || group.name.toLowerCase().includes(query));
  }, [createGroupSearch, groups]);
  const visibleEditGroups = useMemo(() => {
    const query = editGroupSearch.trim().toLowerCase();
    return groups.filter((group) => !query || group.name.toLowerCase().includes(query));
  }, [editGroupSearch, groups]);
  const limitedOptions = <T,>(options: T[]) => options.slice(0, MAX_VISIBLE_OPTIONS);
  const visibleCreateS3Accounts = limitedOptions(availableCreateS3Accounts);
  const visibleEditS3Accounts = limitedOptions(availableEditS3Accounts);
  const visibleCreateS3Users = limitedOptions(availableCreateS3Users);
  const visibleCreateS3Connections = limitedOptions(availableCreateS3Connections);
  const visibleEditS3Users = limitedOptions(availableEditS3Users);
  const visibleEditS3Connections = limitedOptions(availableEditS3Connections);
  const normalizeUiRoleValue = (role?: string | null): string => {
    const value = (role || "").toLowerCase();
    if (value === "ui_superadmin" || value === "super_admin" || value === "superadmin") return "ui_superadmin";
    if (value === "ui_admin" || value === "account_admin" || value === "admin") return "ui_admin";
    if (value === "ui_none" || value === "none") return "ui_none";
    return "ui_user";
  };
  const displayUiRole = (role?: string | null) => {
    const value = (role || "").toLowerCase();
    if (value === "ui_superadmin" || value === "super_admin" || value === "superadmin") return "Superadmin";
    if (value === "ui_admin" || value === "account_admin" || value === "admin") return "Admin";
    if (value === "ui_user" || value === "account_user") return "User";
    if (value === "ui_none" || value === "none") return "No access";
    return role || "-";
  };
  const editRoleValue = normalizeUiRoleValue(editForm.role ?? editingUser?.role ?? "ui_user");
  const createRoleValue = normalizeUiRoleValue(form.role);
  const createTargetSupportsCephAdmin = createRoleValue === "ui_admin" || createRoleValue === "ui_superadmin";
  const createTargetSupportsStorageOps =
    createRoleValue === "ui_user" || createRoleValue === "ui_admin" || createRoleValue === "ui_superadmin";
  const editTargetSupportsCephAdmin = editRoleValue === "ui_admin" || editRoleValue === "ui_superadmin";
  const editTargetSupportsStorageOps =
    editRoleValue === "ui_user" || editRoleValue === "ui_admin" || editRoleValue === "ui_superadmin";
  const editTargetSupportsManagerTools = editTargetSupportsStorageOps;
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
    const accountIds =
      user.accounts && user.accounts.length > 0
        ? user.accounts.map((id) => Number(id))
        : (user.account_links ?? []).map((link) => Number(link.account_id));
    const adminByAccountId = new Map<number, boolean>(
      (user.account_links ?? []).map((link) => [Number(link.account_id), Boolean(link.account_admin)])
    );
    const portalRoleByAccountId = new Map<number, PortalAccountRole>(
      (user.account_links ?? []).map((link) => [Number(link.account_id), normalizePortalRole(link.account_role)])
    );
    const accountItems: AssociationAccountItem[] = accountIds.map((id) => ({
      id,
      label: accountOptionsById.get(id)?.name ?? `Account #${id}`,
      account_admin: adminByAccountId.get(id) === true,
      account_role: portalRoleByAccountId.get(id) ?? "portal_none",
    }));
    const s3UserItems: AssociationChipItem[] =
      user.s3_user_details && user.s3_user_details.length > 0
        ? user.s3_user_details.map((entry) => ({ id: entry.id, label: entry.name || `User #${entry.id}` }))
        : (user.s3_users ?? []).map((id) => ({
            id: Number(id),
            label: s3UserLabelById.get(Number(id)) ?? `User #${id}`,
          }));
    const connectionItems: AssociationChipItem[] =
      user.s3_connection_details && user.s3_connection_details.length > 0
        ? user.s3_connection_details.map((entry) => ({
            id: entry.id,
            label: entry.name || `Connection #${entry.id}`,
          }))
        : (user.s3_connections ?? []).map((id) => ({
            id: Number(id),
            label: s3ConnectionLabelById.get(Number(id)) ?? `Connection #${id}`,
          }));
    const groupItems: AssociationChipItem[] =
      user.group_details && user.group_details.length > 0
        ? user.group_details.map((entry) => ({ id: entry.id, label: entry.name || `Group #${entry.id}` }))
        : (user.group_ids ?? []).map((id) => ({
            id: Number(id),
            label: groupLabelById.get(Number(id)) ?? `Group #${id}`,
          }));
    return (
      <AssociationSummary
        sections={[
          {
            label: "Accounts",
            value: <AccountAssociationChips accounts={accountItems} showPortalRole={showPortalRole} />,
            visible: accountItems.length > 0,
          },
          { label: "Users", value: <AssociationChips items={s3UserItems} />, visible: s3UserItems.length > 0 },
          {
            label: "Connections",
            value: <AssociationChips items={connectionItems} />,
            visible: connectionItems.length > 0,
          },
          { label: "Groups", value: <AssociationChips items={groupItems} />, visible: groupItems.length > 0 },
        ]}
      />
    );
  };

  const renderGroupsSelector = ({
    selectedIds,
    onToggle,
    search,
    setSearch,
    visibleGroups,
  }: {
    selectedIds: number[];
    onToggle: (groupId: number) => void;
    search: string;
    setSearch: Dispatch<SetStateAction<string>>;
    visibleGroups: UiGroupSummary[];
  }) => {
    const limitedGroups = limitedOptions(visibleGroups);
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <label className={userModalLabelClass}>Groups</label>
            <span className="ui-caption text-slate-500 dark:text-slate-400">{selectedIds.length} selected</span>
          </div>
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search groups..."
            className={`${associationCompactInputClass} w-full sm:w-56`}
          />
        </div>
        <div className={associationAddPanelClass}>
          <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {groupsLoading ? (
              <p className="ui-caption text-slate-500 dark:text-slate-400">Loading groups...</p>
            ) : groupsLoaded && groups.length === 0 ? (
              <p className="ui-caption text-slate-500 dark:text-slate-400">No UI groups available.</p>
            ) : visibleGroups.length === 0 ? (
              <p className="ui-caption text-slate-500 dark:text-slate-400">No results.</p>
            ) : null}
            {limitedGroups.map((group) => {
              const checked = selectedIds.includes(group.id);
              return (
                <label
                  key={group.id}
                  className={associationOptionRowClass(checked)}
                >
                  <span className={adminAssociationOptionLabelClass}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(group.id)}
                      className={adminAssociationCheckboxClass}
                    />
                    <span>{group.name}</span>
                  </span>
                  {group.description && (
                    <span className="max-w-md truncate ui-caption text-slate-500 dark:text-slate-400">
                      {group.description}
                    </span>
                  )}
                </label>
              );
            })}
            {visibleGroups.length > MAX_VISIBLE_OPTIONS && (
              <p className="ui-caption text-slate-500 dark:text-slate-400">
                Showing first {MAX_VISIBLE_OPTIONS} matches. Use the search box to narrow down the list.
              </p>
            )}
          </div>
        </div>
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

  const toggleCreateGroupSelection = (groupId: number) => {
    setCreateSelectedGroups((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
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

  const toggleEditGroupSelection = (groupId: number) => {
    setEditSelectedGroups((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
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
      accountAdminChoice: {},
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
        accountAdminChoice: createAccountAdminChoice,
      }),
    [
      createAccountAdminChoice,
      createAccountSelections,
      createConnectionSelections,
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
    setCreateAccountAdminChoice({});
    setCreateS3AccountSearch("");
    setCreateS3Search("");
    setCreateConnectionSearch("");
    setCreateGroupSearch("");
    setCreateModalTab("general");
    setCreateAssociationsTab("accounts");
    setShowCreateAccountPanel(false);
    setShowCreateS3UserPanel(false);
    setShowCreateConnectionPanel(false);
    setCreateAccountSelections([]);
    setCreateS3UserSelections([]);
    setCreateConnectionSelections([]);
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
        accountAdminChoice: editAccountAdminChoice,
      }),
    [
      editAccountAdminChoice,
      editAccountSelections,
      editConnectionSelections,
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
    setEditAccountSelections([]);
    setEditS3UserSelections([]);
    setEditConnectionSelections([]);
    setEditAccountAdminChoice({});
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
        accountAdminChoice: {},
      })
    );
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
    const normalizedRole = normalizeUiRoleValue(form.role);
    const payload: CreateUserPayload = {
      email: form.email,
      password: form.password,
      role: normalizedRole,
      can_access_ceph_admin:
        currentIsSuperAdmin && (normalizedRole === "ui_admin" || normalizedRole === "ui_superadmin")
          ? Boolean(form.can_access_ceph_admin)
          : false,
      can_access_storage_ops:
        currentIsAdminLike && (normalizedRole === "ui_user" || normalizedRole === "ui_admin" || normalizedRole === "ui_superadmin")
          ? Boolean(form.can_access_storage_ops)
          : false,
      browser_advanced_features_enabled: Boolean(form.browser_advanced_features_enabled),
      group_ids: createSelectedGroups,
    };
    try {
      const created = await createUser(payload);
      if (created?.id && createSelectedS3Accounts.length > 0) {
        await Promise.all(
          createSelectedS3Accounts.map((entry) =>
            assignUserToS3Account(
              created.id,
              Number(entry.id),
              entry.account_admin ?? false,
              normalizePortalRole(entry.account_role)
            )
          )
        );
      }
      if (created?.id) {
        const associationsPayload: UpdateUserPayload = {};
        if (createSelectedS3Users.length > 0) {
          associationsPayload.s3_user_ids = createSelectedS3Users;
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
    const normalizedRole = normalizeUiRoleValue(user.role);
    const nextEditForm = {
      email: user.email,
      password: "",
      role: normalizedRole,
      can_access_ceph_admin:
        normalizedRole === "ui_admin" || normalizedRole === "ui_superadmin"
          ? Boolean(user.can_access_ceph_admin)
          : false,
      can_access_storage_ops:
        normalizedRole === "ui_user" || normalizedRole === "ui_admin" || normalizedRole === "ui_superadmin"
          ? Boolean(user.can_access_storage_ops)
          : false,
      manager_tool_access: normalizeManagerToolAccess(user.manager_tool_access),
      browser_advanced_features_enabled: Boolean(user.browser_advanced_features_enabled),
    };
    setEditingUser(user);
    setEditForm(nextEditForm);
    const accountAdmins = new Map<number, boolean>(
      (user.account_links ?? []).map((link) => [Number(link.account_id), Boolean(link.account_admin)])
    );
    const accountRoles = new Map<number, PortalAccountRole>(
      (user.account_links ?? []).map((link) => [Number(link.account_id), normalizePortalRole(link.account_role)])
    );
    const selectedAccounts =
      user.accounts?.map((id) => ({
        id: Number(id),
        account_admin: accountAdmins.get(Number(id)) ?? false,
        account_role: accountRoles.get(Number(id)) ?? "portal_none",
      })) ?? [];
    setEditSelectedS3Accounts(selectedAccounts);
    const nextSelectedS3Users = user.s3_users ? user.s3_users.map((id) => Number(id)) : [];
    const nextSelectedS3Connections = user.s3_connections ? user.s3_connections.map((id) => Number(id)) : [];
    const nextSelectedGroups =
      user.group_ids && user.group_ids.length > 0
        ? user.group_ids.map((id) => Number(id))
        : (user.group_details ?? []).map((group) => Number(group.id));
    setEditSelectedS3Users(nextSelectedS3Users);
    setEditSelectedS3Connections(nextSelectedS3Connections);
    setEditSelectedGroups(nextSelectedGroups);
    setEditS3AccountSearch("");
    setEditS3Search("");
    setEditConnectionSearch("");
    setEditGroupSearch("");
    const hasAccounts = selectedAccounts.length > 0;
    const hasS3Users = Boolean(user.s3_users && user.s3_users.length > 0);
    const hasConnections = Boolean(user.s3_connections && user.s3_connections.length > 0);
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
    setEditAccountSelections([]);
    setEditS3UserSelections([]);
    setEditConnectionSelections([]);
    setEditAccountAdminChoice({});
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
        accountAdminChoice: {},
      })
    );
    setEditModalTab("general");
    setEditRoleHelpOpen(false);
    setActionError(null);
    setActionMessage(null);
    setShowEditModal(true);
    void ensureAssociationOptionsForTab(initialAssociationsTab, { retryOnError: true });
  };

  const submitEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setBusyId(editingUser.id);
    setActionError(null);
    setActionMessage(null);
    try {
      const payload: UpdateUserPayload = {};
      const nextRole = normalizeUiRoleValue(editForm.role ?? editingUser.role);
      if (editForm.email) {
        payload.email = editForm.email;
      }
      if (editForm.password) {
        payload.password = editForm.password;
      }
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
      payload.manager_tool_access =
        nextRole === "ui_user" || nextRole === "ui_admin" || nextRole === "ui_superadmin"
          ? normalizeManagerToolAccess(editForm.manager_tool_access ?? editingUser.manager_tool_access)
          : { ...DEFAULT_MANAGER_TOOL_ACCESS };
      payload.browser_advanced_features_enabled = Boolean(
        editForm.browser_advanced_features_enabled ?? editingUser.browser_advanced_features_enabled
      );
      payload.group_ids = editSelectedGroups;
      payload.s3_user_ids = editSelectedS3Users;
      payload.s3_connection_ids = editSelectedS3Connections;
      const updatedUser = await updateUser(editingUser.id, payload);
      if (currentUserId !== null && currentUserId === editingUser.id && typeof window !== "undefined") {
        const stored = readClientJson<Record<string, unknown>>(CLIENT_STORAGE_KEYS.sessionUser);
        writeClientJson(CLIENT_STORAGE_KEYS.sessionUser, { ...(stored ?? {}), ...updatedUser });
      }
      const existing = editingUser.accounts ? editingUser.accounts.map((id) => Number(id)) : [];
      const existingAdminById = new Map<number, boolean>(
        (editingUser.account_links ?? []).map((link) => [Number(link.account_id), Boolean(link.account_admin)])
      );
      const existingRoleById = new Map<number, PortalAccountRole>(
        (editingUser.account_links ?? []).map((link) => [Number(link.account_id), normalizePortalRole(link.account_role)])
      );
      const selectedIds = editSelectedS3Accounts.map((entry) => Number(entry.id));
      const toAdd = editSelectedS3Accounts.filter((entry) => !existing.includes(Number(entry.id)));
      const toRemove = existing.filter((id) => !selectedIds.includes(id));
      const toUpdateLinks = editSelectedS3Accounts.filter((entry) => {
        const currentAdmin = existingAdminById.get(Number(entry.id)) ?? false;
        const currentRole = existingRoleById.get(Number(entry.id)) ?? "portal_none";
        return (
          existing.includes(Number(entry.id)) &&
          (currentAdmin !== Boolean(entry.account_admin) || currentRole !== normalizePortalRole(entry.account_role))
        );
      });

      if (toAdd.length > 0) {
        await Promise.all(
          toAdd.map((entry) =>
            assignUserToS3Account(
              editingUser.id,
              Number(entry.id),
              entry.account_admin ?? false,
              normalizePortalRole(entry.account_role)
            )
          )
        );
      }
      if (toUpdateLinks.length > 0) {
        await Promise.all(
          toUpdateLinks.map((entry) =>
            assignUserToS3Account(
              editingUser.id,
              Number(entry.id),
              entry.account_admin ?? false,
              normalizePortalRole(entry.account_role)
            )
          )
        );
      }
      for (const accountId of toRemove) {
        const account = accountOptionsById.get(Number(accountId));
        if (!account) continue;
        const remainingLinks =
          (account.user_links ?? account.user_ids?.map((id) => ({ user_id: id, account_admin: false, account_role: "portal_none" })) ?? [])
            .filter((link) => link.user_id !== editingUser.id);
        await updateS3Account(Number(accountId), { user_links: remainingLinks });
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
  const associationLabel = "Associations / Groups";
  const filterPlaceholder = "Search by email, role, group, account, user, or connection";
  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: users.length,
  });
  const userTableColumns: Array<DataTableColumn<User, SortField>> = [
    {
      id: "email",
      label: "Email",
      field: "email",
      primary: true,
      render: (user) => (
        <button
          type="button"
          onClick={() => startEdit(user)}
          className="max-w-full break-all text-left transition hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:hover:text-primary-100"
        >
          {user.email}
        </button>
      ),
    },
    {
      id: "role",
      label: "Role",
      field: "role",
      render: (user) => (
        <div className="flex flex-wrap items-center gap-2">
          <span>{displayUiRole(user.role)}</span>
          {cephAdminFeatureEnabled &&
            (normalizeUiRoleValue(user.role) === "ui_admin" ||
              normalizeUiRoleValue(user.role) === "ui_superadmin") &&
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
        return (
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => startEdit(user)} className={tableActionButtonClasses}>
              Edit
            </button>
            <button
              type="button"
              onClick={() => handleDeleteRequest(user)}
              className={tableDeleteActionClasses}
              disabled={busyId === user.id || isCurrentUser}
              title={isCurrentUser ? "You cannot delete your own user." : undefined}
            >
              {busyId === user.id ? "Deleting..." : "Delete"}
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
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
        <Modal
          title="Create user"
          onClose={createCloseGuard.requestClose}
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
            <AdminModalTabs<UserModalTab>
              activeTab={createModalTab}
              onTabChange={setCreateModalTab}
              tabs={[
                { id: "general", label: "General" },
                { id: "associations", label: "Associations" },
                { id: "groups", label: "Groups" },
                { id: "access", label: "Workspaces" },
                { id: "browser", label: "Browser" },
              ]}
            />

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
                  <RoleAccessHelp
                    open={createRoleHelpOpen}
                    onToggle={() => setCreateRoleHelpOpen((prev) => !prev)}
                    helpId="create-user-role-access-help"
                  />
                  <select
                    className={userModalFieldClass}
                    value={createRoleValue}
                    onChange={(e) => {
                      const value = normalizeUiRoleValue(e.target.value);
                      const supportsCephAdmin = value === "ui_admin" || value === "ui_superadmin";
                      const supportsStorageOps = value === "ui_user" || supportsCephAdmin;
                      setForm((f) => ({
                        ...f,
                        role: value,
                        can_access_ceph_admin:
                          currentIsSuperAdmin && supportsCephAdmin ? Boolean(f.can_access_ceph_admin) : false,
                        can_access_storage_ops:
                          currentIsAdminLike && supportsStorageOps ? Boolean(f.can_access_storage_ops) : false,
                      }));
                    }}
                  >
                    <option value="ui_none">No access</option>
                    <option value="ui_user">User</option>
                    <option value="ui_admin">Admin</option>
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

            {createModalTab === "associations" && (
              <AssociationsTabs
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
                  adminChoice: createAccountAdminChoice,
                  setAdminChoice: setCreateAccountAdminChoice,
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

            {createModalTab === "groups" &&
              renderGroupsSelector({
                selectedIds: createSelectedGroups,
                onToggle: toggleCreateGroupSelection,
                search: createGroupSearch,
                setSearch: setCreateGroupSearch,
                visibleGroups: visibleCreateGroups,
              })}

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={createCloseGuard.requestClose}
                className={userModalCancelButtonClass}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-md bg-primary px-4 py-2 ui-body font-medium text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
              >
                Create
              </button>
            </div>
          </form>
          {createCloseGuard.confirmationDialog}
        </Modal>
      )}

      <div className="ui-surface-card">
        <ListToolbar
          title="Users"
          description="Search matches across the full user record, including role and linked entities."
          showHeading={false}
          countLabel={`${totalUsers} entr${totalUsers === 1 ? "y" : "ies"}`}
          search={
            <div className="flex min-w-0 flex-1 items-center gap-2 max-sm:w-full">
              <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Search
              </span>
              <input
                type="text"
                value={filter}
                onChange={(e) => handleFilterChange(e.target.value)}
                placeholder={filterPlaceholder}
                className={`${toolbarCompactInputClasses} min-w-0 flex-1 sm:w-64 md:w-72`}
              />
            </div>
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
          primaryColumnId="email"
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
      </div>

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
        <Modal
          title="Edit user"
          onClose={editCloseGuard.requestClose}
        >
          <p className="mb-3 ui-body text-slate-500 dark:text-slate-300">{editingUser.email}</p>
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
            <AdminModalTabs<UserModalTab>
              activeTab={editModalTab}
              onTabChange={setEditModalTab}
              tabs={[
                { id: "general", label: "General" },
                { id: "associations", label: "Associations" },
                { id: "groups", label: "Groups" },
                { id: "access", label: "Workspaces" },
                { id: "browser", label: "Browser" },
                { id: "manager_tools", label: "Manager tools" },
              ]}
            />

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
                  <label className={userModalLabelClass}>New password</label>
                  <input
                    type="password"
                    className={userModalFieldClass}
                    value={editForm.password ?? ""}
                    onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
                    placeholder="Leave blank to keep current"
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
                      const value = normalizeUiRoleValue(e.target.value);
                      const supportsCephAdmin = value === "ui_admin" || value === "ui_superadmin";
                      const supportsStorageOps = value === "ui_user" || supportsCephAdmin;
                      setEditForm((f) => ({
                        ...f,
                        role: value,
                        can_access_ceph_admin:
                          currentIsSuperAdmin && supportsCephAdmin ? Boolean(f.can_access_ceph_admin) : false,
                        can_access_storage_ops:
                          currentIsAdminLike && supportsStorageOps ? Boolean(f.can_access_storage_ops) : false,
                      }));
                    }}
                  >
                    <option value="ui_none">No access</option>
                    <option value="ui_user">User</option>
                    <option value="ui_admin">Admin</option>
                    <option value="ui_superadmin" disabled={!currentIsSuperAdmin}>
                      Superadmin{currentIsSuperAdmin ? "" : " (restricted)"}
                    </option>
                  </select>
                </div>
              </div>
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

            {editModalTab === "manager_tools" && (
              <div className="space-y-4">
                {!editTargetSupportsManagerTools && (
                  <PageBanner tone="warning">
                    Manager tool access requires the target role to be User, Admin, or Superadmin.
                  </PageBanner>
                )}
                <ManagerToolAccessSection
                  title="Bucket tools"
                  description="Manager tools for bucket-level operations."
                  tools={managerToolDefinitions.filter((tool) => tool.key !== "ceph_s3_user_keys" && tool.key !== "bucket_quota")}
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
                <ManagerToolAccessSection
                  title="Privileged Ceph access"
                  description="Ceph admin-API actions exposed outside the Ceph Admin workspace."
                  tools={managerToolDefinitions.filter((tool) => tool.key === "ceph_s3_user_keys" || tool.key === "bucket_quota")}
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
              <AssociationsTabs
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
                  adminChoice: editAccountAdminChoice,
                  setAdminChoice: setEditAccountAdminChoice,
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

            {editModalTab === "groups" &&
              renderGroupsSelector({
                selectedIds: editSelectedGroups,
                onToggle: toggleEditGroupSelection,
                search: editGroupSearch,
                setSearch: setEditGroupSearch,
                visibleGroups: visibleEditGroups,
              })}

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={editCloseGuard.requestClose}
                className={userModalCancelButtonClass}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busyId === editingUser.id}
                className="rounded-md bg-primary px-4 py-2 ui-body font-medium text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
              >
                {busyId === editingUser.id ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
          {editCloseGuard.confirmationDialog}
        </Modal>
      )}
    </div>
  );
}
