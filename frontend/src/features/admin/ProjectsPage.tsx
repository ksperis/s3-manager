/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  createProject,
  deleteProject,
  fetchProjectPortalSettings,
  listProjects,
  updateProject,
  updateProjectPortalSettings,
  type Project,
  type ProjectAccountLinkInput,
  type ProjectGroupLinkInput,
  type ProjectPortalRole,
  type PortalProjectSettings,
  type ProjectUserLinkInput,
} from "../../api/projects";
import type { PortalSettingsOverride } from "../../api/appSettings";
import { listMinimalS3Accounts, type S3AccountSummary } from "../../api/accounts";
import { listMinimalUsers, type UserSummary } from "../../api/users";
import { listMinimalGroups, type UiGroupSummary } from "../../api/groups";
import ListToolbar from "../../components/ListToolbar";
import Modal from "../../components/Modal";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import PaginationControls from "../../components/PaginationControls";
import TableEmptyState from "../../components/TableEmptyState";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { toolbarCompactInputClasses } from "../../components/toolbarControlClasses";
import {
  cx,
  uiButtonBaseClass,
  uiButtonVariants,
  uiCardMutedClass,
  uiDataTableClass,
  uiInputClass,
  uiMutedTextClass,
  uiTableContainerClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { confirmAction } from "../../utils/confirm";
import {
  AdminAssociationPickerOption,
  AdminAssociationPickerPanel,
  AdminAssociationSectionHeader,
} from "./AdminAssociationPicker";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import PortalOverridesPanel from "./PortalOverridesPanel";

type ProjectFormAccountLink = ProjectAccountLinkInput & { account_id: number | "" };
type ProjectFormUserLink = ProjectUserLinkInput & { user_id: number | "" };
type ProjectFormGroupLink = ProjectGroupLinkInput & { group_id: number | "" };

type ProjectForm = {
  name: string;
  description: string;
  account_links: ProjectFormAccountLink[];
  user_links: ProjectFormUserLink[];
  group_links: ProjectFormGroupLink[];
};

const ROLE_OPTIONS: { value: ProjectPortalRole; label: string }[] = [
  { value: "portal_user", label: "Portal user" },
  { value: "portal_manager", label: "Portal manager" },
];

const MAX_VISIBLE_OPTIONS = 10;

type ProjectAssociationOption = {
  id: number;
  label: string;
  detail?: string | null;
};

const emptyForm = (): ProjectForm => ({
  name: "",
  description: "",
  account_links: [],
  user_links: [],
  group_links: [],
});

function roleValue(value?: string | null): ProjectPortalRole {
  return value === "portal_manager" ? "portal_manager" : "portal_user";
}

function formFromProject(project: Project | null): ProjectForm {
  if (!project) return emptyForm();
  return {
    name: project.name,
    description: project.description ?? "",
    account_links: project.account_links.map((link) => ({
      account_id: link.account_id,
      display_name: link.display_name,
      sort_order: link.sort_order,
    })),
    user_links: project.user_links.map((link) => ({
      user_id: link.user_id,
      account_role: roleValue(link.account_role),
    })),
    group_links: project.group_links.map((link) => ({
      group_id: link.group_id,
      account_role: roleValue(link.account_role),
    })),
  };
}

function selectedIds(entries: unknown[], key: string): number[] {
  return entries
    .map((entry) => (entry as Record<string, unknown>)[key])
    .filter((value): value is number => typeof value === "number");
}

function accountId(account: S3AccountSummary): number {
  return Number(account.db_id ?? account.id);
}

function accountLabel(account: S3AccountSummary | undefined): string {
  if (!account) return "Unknown account";
  const endpoint = account.storage_endpoint_name ?? account.storage_endpoint_url;
  return endpoint ? `${account.name} (${endpoint})` : account.name;
}

function optionMatchesSearch(option: ProjectAssociationOption, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return [option.label, option.detail ?? ""].some((value) => value.toLowerCase().includes(query));
}

export default function ProjectsPage() {
  const { generalSettings } = useGeneralSettings();
  const portalEnabled = generalSettings.portal_enabled;
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [form, setForm] = useState<ProjectForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [auxLoading, setAuxLoading] = useState(false);
  const [accounts, setAccounts] = useState<S3AccountSummary[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [groups, setGroups] = useState<UiGroupSummary[]>([]);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [showUserPicker, setShowUserPicker] = useState(false);
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [accountPickerSearch, setAccountPickerSearch] = useState("");
  const [userPickerSearch, setUserPickerSearch] = useState("");
  const [groupPickerSearch, setGroupPickerSearch] = useState("");
  const [accountSelectionIds, setAccountSelectionIds] = useState<number[]>([]);
  const [userSelectionIds, setUserSelectionIds] = useState<number[]>([]);
  const [groupSelectionIds, setGroupSelectionIds] = useState<number[]>([]);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [portalSettings, setPortalSettings] = useState<PortalProjectSettings | null>(null);
  const [portalSettingsLoading, setPortalSettingsLoading] = useState(false);
  const [portalSettingsSaving, setPortalSettingsSaving] = useState(false);
  const [portalSettingsError, setPortalSettingsError] = useState<string | null>(null);
  const [portalSettingsMessage, setPortalSettingsMessage] = useState<string | null>(null);

  const accountById = useMemo(() => new Map(accounts.map((account) => [accountId(account), account])), [accounts]);
  const userById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const accountIds = useMemo(() => selectedIds(form.account_links, "account_id"), [form.account_links]);
  const userIds = useMemo(() => selectedIds(form.user_links, "user_id"), [form.user_links]);
  const groupIds = useMemo(() => selectedIds(form.group_links, "group_id"), [form.group_links]);
  const accountOptions = useMemo<ProjectAssociationOption[]>(
    () =>
      accounts.map((account) => ({
        id: accountId(account),
        label: accountLabel(account),
        detail: account.rgw_account_id ?? account.storage_endpoint_url ?? account.storage_endpoint_name,
      })),
    [accounts]
  );
  const userOptions = useMemo<ProjectAssociationOption[]>(
    () => users.map((user) => ({ id: user.id, label: user.email })),
    [users]
  );
  const groupOptions = useMemo<ProjectAssociationOption[]>(
    () => groups.map((group) => ({ id: group.id, label: group.name })),
    [groups]
  );
  const availableAccountOptions = useMemo(
    () => accountOptions.filter((option) => !accountIds.includes(option.id) && optionMatchesSearch(option, accountPickerSearch)),
    [accountIds, accountOptions, accountPickerSearch]
  );
  const availableUserOptions = useMemo(
    () => userOptions.filter((option) => !userIds.includes(option.id) && optionMatchesSearch(option, userPickerSearch)),
    [userIds, userOptions, userPickerSearch]
  );
  const availableGroupOptions = useMemo(
    () => groupOptions.filter((option) => !groupIds.includes(option.id) && optionMatchesSearch(option, groupPickerSearch)),
    [groupIds, groupOptions, groupPickerSearch]
  );
  const visibleAccountOptions = useMemo(() => availableAccountOptions.slice(0, MAX_VISIBLE_OPTIONS), [availableAccountOptions]);
  const visibleUserOptions = useMemo(() => availableUserOptions.slice(0, MAX_VISIBLE_OPTIONS), [availableUserOptions]);
  const visibleGroupOptions = useMemo(() => availableGroupOptions.slice(0, MAX_VISIBLE_OPTIONS), [availableGroupOptions]);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listProjects({
        page,
        page_size: pageSize,
        search: search.trim() || undefined,
        sort_by: "name",
        sort_dir: "asc",
      });
      setProjects(data.items);
      setTotal(data.total);
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, "Unable to load projects."));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search]);

  const loadAuxiliary = useCallback(async () => {
    setAuxLoading(true);
    try {
      const [accountData, userData, groupData] = await Promise.all([
        listMinimalS3Accounts(),
        listMinimalUsers(),
        listMinimalGroups(),
      ]);
      setAccounts(accountData);
      setUsers(userData);
      setGroups(groupData);
    } catch (err) {
      console.error(err);
      setActionError(extractApiError(err, "Unable to load project association options."));
    } finally {
      setAuxLoading(false);
    }
  }, []);

  const resetAssociationPickers = () => {
    setShowAccountPicker(false);
    setShowUserPicker(false);
    setShowGroupPicker(false);
    setAccountPickerSearch("");
    setUserPickerSearch("");
    setGroupPickerSearch("");
    setAccountSelectionIds([]);
    setUserSelectionIds([]);
    setGroupSelectionIds([]);
  };

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    setPortalSettings(null);
    setPortalSettingsError(null);
    setPortalSettingsMessage(null);
    setPortalSettingsLoading(false);
    if (!showModal || !editingProject || !portalEnabled) return;
    setPortalSettingsLoading(true);
    fetchProjectPortalSettings(editingProject.id)
      .then((data) => setPortalSettings(data))
      .catch((err) => {
        console.error(err);
        setPortalSettingsError(extractApiError(err, "Unable to load project portal overrides."));
      })
      .finally(() => setPortalSettingsLoading(false));
  }, [editingProject, portalEnabled, showModal]);

  const openCreateModal = () => {
    setEditingProject(null);
    setForm(emptyForm());
    resetAssociationPickers();
    setActionError(null);
    setActionMessage(null);
    setShowModal(true);
    void loadAuxiliary();
  };

  const openEditModal = (project: Project) => {
    setEditingProject(project);
    setForm(formFromProject(project));
    resetAssociationPickers();
    setActionError(null);
    setActionMessage(null);
    setShowModal(true);
    void loadAuxiliary();
  };

  const payloadFromForm = () => ({
    name: form.name.trim(),
    description: form.description.trim() || null,
    account_links: form.account_links
      .filter((link): link is ProjectFormAccountLink & { account_id: number } => typeof link.account_id === "number")
      .map((link, index) => ({
        account_id: link.account_id,
        display_name: link.display_name?.trim() || null,
        sort_order: index,
      })),
    user_links: form.user_links
      .filter((link): link is ProjectFormUserLink & { user_id: number } => typeof link.user_id === "number")
      .map((link) => ({ user_id: link.user_id, account_role: roleValue(link.account_role) })),
    group_links: form.group_links
      .filter((link): link is ProjectFormGroupLink & { group_id: number } => typeof link.group_id === "number")
      .map((link) => ({ group_id: link.group_id, account_role: roleValue(link.account_role) })),
  });

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    setActionError(null);
    setActionMessage(null);
    try {
      if (editingProject) {
        await updateProject(editingProject.id, payloadFromForm());
        setActionMessage("Project updated.");
      } else {
        await createProject(payloadFromForm());
        setActionMessage("Project created.");
      }
      setShowModal(false);
      await loadProjects();
    } catch (err) {
      console.error(err);
      setActionError(extractApiError(err, "Unable to save project."));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (project: Project) => {
    if (!confirmAction(`Delete project "${project.name}"? S3 accounts and UI users are kept, only project associations are removed.`)) {
      return;
    }
    setDeletingId(project.id);
    setActionError(null);
    setActionMessage(null);
    try {
      await deleteProject(project.id);
      setActionMessage("Project deleted.");
      await loadProjects();
    } catch (err) {
      console.error(err);
      setActionError(extractApiError(err, "Unable to delete project."));
    } finally {
      setDeletingId(null);
    }
  };

  const handleSavePortalOverrides = async (payload: PortalSettingsOverride) => {
    if (!editingProject || portalSettingsSaving) return;
    setPortalSettingsSaving(true);
    setPortalSettingsError(null);
    setPortalSettingsMessage(null);
    try {
      const updated = await updateProjectPortalSettings(editingProject.id, payload);
      setPortalSettings(updated);
      setPortalSettingsMessage("Portal overrides saved.");
    } catch (err) {
      console.error(err);
      setPortalSettingsError(extractApiError(err, "Unable to save project portal overrides."));
    } finally {
      setPortalSettingsSaving(false);
    }
  };

  const handleResetPortalOverrides = async () => {
    if (!editingProject || portalSettingsSaving) return;
    if (!confirmAction("Reset portal overrides for this project?")) return;
    setPortalSettingsSaving(true);
    setPortalSettingsError(null);
    setPortalSettingsMessage(null);
    try {
      const updated = await updateProjectPortalSettings(editingProject.id, {});
      setPortalSettings(updated);
      setPortalSettingsMessage("Portal overrides reset.");
    } catch (err) {
      console.error(err);
      setPortalSettingsError(extractApiError(err, "Unable to reset project portal overrides."));
    } finally {
      setPortalSettingsSaving(false);
    }
  };

  const toggleAccountSelection = (id: number, checked: boolean) => {
    setAccountSelectionIds((current) => (checked ? [...current, id] : current.filter((selectedId) => selectedId !== id)));
  };

  const toggleUserSelection = (id: number, checked: boolean) => {
    setUserSelectionIds((current) => (checked ? [...current, id] : current.filter((selectedId) => selectedId !== id)));
  };

  const toggleGroupSelection = (id: number, checked: boolean) => {
    setGroupSelectionIds((current) => (checked ? [...current, id] : current.filter((selectedId) => selectedId !== id)));
  };

  const addSelectedAccountLinks = () => {
    setForm((current) => ({
      ...current,
      account_links: [
        ...current.account_links,
        ...accountSelectionIds
          .filter((id) => !selectedIds(current.account_links, "account_id").includes(id))
          .map((id, index) => {
            const account = accountById.get(id);
            return {
              account_id: id,
              display_name: account?.storage_endpoint_name ?? account?.name ?? `Account #${id}`,
              sort_order: current.account_links.length + index,
            };
          }),
      ],
    }));
    setAccountSelectionIds([]);
    setAccountPickerSearch("");
    setShowAccountPicker(false);
  };

  const addSelectedUserLinks = () => {
    setForm((current) => ({
      ...current,
      user_links: [
        ...current.user_links,
        ...userSelectionIds
          .filter((id) => !selectedIds(current.user_links, "user_id").includes(id))
          .map((id) => ({ user_id: id, account_role: "portal_user" as ProjectPortalRole })),
      ],
    }));
    setUserSelectionIds([]);
    setUserPickerSearch("");
    setShowUserPicker(false);
  };

  const addSelectedGroupLinks = () => {
    setForm((current) => ({
      ...current,
      group_links: [
        ...current.group_links,
        ...groupSelectionIds
          .filter((id) => !selectedIds(current.group_links, "group_id").includes(id))
          .map((id) => ({ group_id: id, account_role: "portal_user" as ProjectPortalRole })),
      ],
    }));
    setGroupSelectionIds([]);
    setGroupPickerSearch("");
    setShowGroupPicker(false);
  };

  const tableStatus = resolveListTableStatus({ loading, error, rowCount: projects.length });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Projects"
        description="Group several S3 accounts into one Portal project and grant Portal users access at project level."
        breadcrumbs={adminPageBreadcrumbs("projects")}
        actions={[{ label: "New project", onClick: openCreateModal }]}
      />

      {actionMessage ? <PageBanner tone="success">{actionMessage}</PageBanner> : null}
      {actionError ? <PageBanner tone="error">{actionError}</PageBanner> : null}

      <div className="ui-surface-card overflow-hidden">
        <ListToolbar
          title="Projects"
          description="Projects replace direct Portal user to account grants."
          countLabel={`${total} project${total === 1 ? "" : "s"}`}
          search={
            <input
              type="search"
              className={toolbarCompactInputClasses}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search projects..."
            />
          }
        />
        <div className={uiTableContainerClass}>
          <table className={cx(uiDataTableClass, "min-w-full")}>
            <thead>
              <tr>
                <th className="text-left">Project</th>
                <th className="text-left">S3 accounts</th>
                <th className="text-left">UI users</th>
                <th className="text-left">UI groups</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id}>
                  <td>
                    <div>
                      <p className={cx("font-bold", uiTitleTextClass)}>{project.name}</p>
                      <p className={cx("max-w-xl text-xs", uiMutedTextClass)}>{project.description || "No description"}</p>
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1.5">
                      {project.account_links.length === 0 ? (
                        <span className={uiMutedTextClass}>None</span>
                      ) : (
                        project.account_links.map((link) => (
                          <span key={link.account_id} className="rounded-full border border-[color:var(--ui-border)] px-2 py-0.5 text-[11px] font-semibold">
                            {link.display_name}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td>
                    <ProjectCountPill count={project.user_count} singular="user" />
                  </td>
                  <td>
                    <ProjectCountPill count={project.group_count} singular="group" />
                  </td>
                  <td className="text-right">
                    <div className="flex justify-end gap-2">
                      <button type="button" className={tableActionButtonClasses} onClick={() => openEditModal(project)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className={tableDeleteActionClasses}
                        onClick={() => void handleDelete(project)}
                        disabled={deletingId === project.id}
                      >
                        {deletingId === project.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {tableStatus === "empty" ? (
                <TableEmptyState colSpan={5} title="No projects" description="Create a project to expose S3 accounts in the Portal." />
              ) : null}
              {tableStatus === "error" ? (
                <TableEmptyState colSpan={5} title="Unable to load projects" description={error ?? undefined} tone="error" />
              ) : null}
            </tbody>
          </table>
        </div>
        <PaginationControls
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          disabled={loading}
        />
      </div>

      {showModal ? (
        <Modal
          title={editingProject ? `Edit ${editingProject.name}` : "New project"}
          onClose={() => setShowModal(false)}
          maxWidthClass="max-w-5xl"
          maxBodyHeightClass="max-h-[78vh]"
        >
          <form className="space-y-5" onSubmit={handleSubmit}>
            <section className="grid gap-3 md:grid-cols-[1fr_1.5fr]">
              <label className="space-y-1">
                <span className="ui-caption font-semibold text-[var(--ui-text-muted)]">Name</span>
                <input
                  className={uiInputClass}
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  required
                />
              </label>
              <label className="space-y-1">
                <span className="ui-caption font-semibold text-[var(--ui-text-muted)]">Description</span>
                <input
                  className={uiInputClass}
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                />
              </label>
            </section>

            <ProjectModalSummary
              accountCount={form.account_links.length}
              userCount={form.user_links.length}
              groupCount={form.group_links.length}
            />

            <section className="space-y-3">
              <AdminAssociationSectionHeader
                title="S3 accounts"
                countLabel={`${form.account_links.length} linked`}
                actionLabel={showAccountPicker ? "Close" : "Add accounts"}
                onAction={() => {
                  setShowAccountPicker((current) => !current);
                  setAccountSelectionIds([]);
                  setAccountPickerSearch("");
                }}
              />
              {showAccountPicker ? (
                <AdminAssociationPickerPanel
                  title="Add S3 accounts"
                  hint="Search by account, endpoint, or RGW id"
                  search={accountPickerSearch}
                  onSearchChange={setAccountPickerSearch}
                  loading={auxLoading}
                  availableCount={availableAccountOptions.length}
                  maxVisibleOptions={MAX_VISIBLE_OPTIONS}
                  selectedCount={accountSelectionIds.length}
                  onCancel={() => {
                    setShowAccountPicker(false);
                    setAccountSelectionIds([]);
                    setAccountPickerSearch("");
                  }}
                  onAdd={addSelectedAccountLinks}
                  addDisabled={accountSelectionIds.length === 0}
                  loadingLabel="Loading accounts..."
                  emptyLabel="No available accounts."
                >
                  {visibleAccountOptions.map((option) => (
                    <AdminAssociationPickerOption
                      key={option.id}
                      checked={accountSelectionIds.includes(option.id)}
                      onChange={(checked) => toggleAccountSelection(option.id, checked)}
                      label={option.label}
                      detail={option.detail}
                    />
                  ))}
                </AdminAssociationPickerPanel>
              ) : null}
              <div className={uiTableContainerClass}>
                <table className={cx(uiDataTableClass, "min-w-full")}>
                  <thead>
                    <tr>
                      <th className="text-left">Account</th>
                      <th className="text-left">Portal label</th>
                      <th className="text-left">Endpoint</th>
                      <th className="text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.account_links.map((link, index) => {
                      const selected = typeof link.account_id === "number" ? accountById.get(link.account_id) : undefined;
                      return (
                        <tr key={`${link.account_id || "new"}-${index}`}>
                          <td>
                            <p className={cx("font-semibold", uiTitleTextClass)}>
                              {selected ? accountLabel(selected) : `Account #${link.account_id}`}
                            </p>
                            {selected?.rgw_account_id ? (
                              <p className={cx("text-[11px]", uiMutedTextClass)}>{selected.rgw_account_id}</p>
                            ) : null}
                          </td>
                          <td>
                            <input
                              className={uiInputClass}
                              value={link.display_name ?? ""}
                              onChange={(event) =>
                                setForm((current) => ({
                                  ...current,
                                  account_links: current.account_links.map((entry, entryIndex) =>
                                    entryIndex === index ? { ...entry, display_name: event.target.value } : entry
                                  ),
                                }))
                              }
                              placeholder="Location or common name"
                            />
                          </td>
                          <td className={uiMutedTextClass}>{selected?.storage_endpoint_name ?? selected?.storage_endpoint_url ?? "-"}</td>
                          <td className="text-right">
                            <button
                              type="button"
                              className={tableDeleteActionClasses}
                              onClick={() =>
                                setForm((current) => ({
                                  ...current,
                                  account_links: current.account_links.filter((_, entryIndex) => entryIndex !== index),
                                }))
                              }
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {form.account_links.length === 0 ? (
                      <TableEmptyState colSpan={4} title="No accounts linked" description="Add at least one S3 account before exposing this project in the Portal." />
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <AssociationTable
                title="UI users"
                count={form.user_links.length}
                actionLabel={showUserPicker ? "Close" : "Add UI users"}
                showPicker={showUserPicker}
                onTogglePicker={() => {
                  setShowUserPicker((current) => !current);
                  setUserSelectionIds([]);
                  setUserPickerSearch("");
                }}
                pickerTitle="Add UI users"
                pickerHint="Search by email"
                pickerSearch={userPickerSearch}
                onPickerSearchChange={setUserPickerSearch}
                loading={auxLoading}
                availableOptions={availableUserOptions}
                visibleOptions={visibleUserOptions}
                pickerSelectionIds={userSelectionIds}
                onPickerSelectionChange={toggleUserSelection}
                onAddSelected={addSelectedUserLinks}
                loadingLabel="Loading users..."
                emptyLabel="No available users."
                rows={form.user_links}
                idKey="user_id"
                labelById={(id) => userById.get(id)?.email ?? `User #${id}`}
                onChange={(rows) => setForm((current) => ({ ...current, user_links: rows as ProjectFormUserLink[] }))}
              />
              <AssociationTable
                title="UI groups"
                count={form.group_links.length}
                actionLabel={showGroupPicker ? "Close" : "Add UI groups"}
                showPicker={showGroupPicker}
                onTogglePicker={() => {
                  setShowGroupPicker((current) => !current);
                  setGroupSelectionIds([]);
                  setGroupPickerSearch("");
                }}
                pickerTitle="Add UI groups"
                pickerHint="Search by group name"
                pickerSearch={groupPickerSearch}
                onPickerSearchChange={setGroupPickerSearch}
                loading={auxLoading}
                availableOptions={availableGroupOptions}
                visibleOptions={visibleGroupOptions}
                pickerSelectionIds={groupSelectionIds}
                onPickerSelectionChange={toggleGroupSelection}
                onAddSelected={addSelectedGroupLinks}
                loadingLabel="Loading groups..."
                emptyLabel="No available groups."
                rows={form.group_links}
                idKey="group_id"
                labelById={(id) => groupById.get(id)?.name ?? `Group #${id}`}
                onChange={(rows) => setForm((current) => ({ ...current, group_links: rows as ProjectFormGroupLink[] }))}
              />
            </section>

            {editingProject && portalEnabled ? (
              <PortalOverridesPanel
                settings={portalSettings}
                loading={portalSettingsLoading}
                saving={portalSettingsSaving}
                error={portalSettingsError}
                message={portalSettingsMessage}
                targetLabel="project"
                onSave={(payload) => void handleSavePortalOverrides(payload)}
                onReset={() => void handleResetPortalOverrides()}
              />
            ) : null}

            <div className="flex justify-end gap-2 border-t border-[color:var(--ui-border-soft)] pt-4">
              <button type="button" className={cx(uiButtonBaseClass, uiButtonVariants.secondary, "px-3 py-1.5 text-xs")} onClick={() => setShowModal(false)}>
                Cancel
              </button>
              <button type="submit" className={cx(uiButtonBaseClass, uiButtonVariants.primary, "px-3 py-1.5 text-xs")} disabled={!form.name.trim() || saving}>
                {saving ? "Saving..." : "Save project"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}

function ProjectCountPill({ count, singular }: { count: number; singular: string }) {
  const label = count === 0 ? `No ${singular}s` : `${count} ${singular}${count === 1 ? "" : "s"}`;
  return (
    <span
      className={cx(
        "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        count === 0
          ? "border-[color:var(--ui-border)] text-[var(--ui-text-muted)]"
          : "border-primary/25 bg-primary/10 text-primary-800 dark:text-primary-100"
      )}
    >
      {label}
    </span>
  );
}

function ProjectModalSummary({
  accountCount,
  userCount,
  groupCount,
}: {
  accountCount: number;
  userCount: number;
  groupCount: number;
}) {
  const principalCount = userCount + groupCount;
  const items = [
    {
      label: "Portal locations",
      value: `${accountCount} account${accountCount === 1 ? "" : "s"}`,
      detail:
        accountCount > 0
          ? "Users will choose these labels when creating Storage Spaces."
          : "Link at least one S3 account before exposing the project.",
      ready: accountCount > 0,
    },
    {
      label: "Portal access",
      value: `${userCount} user${userCount === 1 ? "" : "s"} / ${groupCount} group${groupCount === 1 ? "" : "s"}`,
      detail:
        principalCount > 0
          ? "Direct users and groups can see this project according to their role."
          : "No UI user or group can access this project yet.",
      ready: principalCount > 0,
    },
    {
      label: "Account source",
      value: "Existing RGW Accounts",
      detail: "Create RGW Accounts first, then link them to this project.",
      ready: accountCount > 0,
    },
  ];

  return (
    <section className={cx(uiCardMutedClass, "grid gap-3 px-3 py-3 md:grid-cols-3")}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cx(
                "h-2 w-2 rounded-full",
                item.ready ? "bg-emerald-500" : "bg-amber-500"
              )}
              aria-hidden="true"
            />
            <span className={cx("ui-caption font-semibold uppercase", uiMutedTextClass)}>{item.label}</span>
          </div>
          <p className={cx("mt-1 ui-body font-bold", uiTitleTextClass)}>{item.value}</p>
          <p className={cx("mt-0.5 ui-caption", uiMutedTextClass)}>{item.detail}</p>
        </div>
      ))}
    </section>
  );
}

function AssociationTable<T extends ProjectFormUserLink | ProjectFormGroupLink>({
  title,
  count,
  actionLabel,
  showPicker,
  onTogglePicker,
  pickerTitle,
  pickerHint,
  pickerSearch,
  onPickerSearchChange,
  loading,
  availableOptions,
  visibleOptions,
  pickerSelectionIds,
  onPickerSelectionChange,
  onAddSelected,
  loadingLabel,
  emptyLabel,
  rows,
  idKey,
  labelById,
  onChange,
}: {
  title: string;
  count: number;
  actionLabel: string;
  showPicker: boolean;
  onTogglePicker: () => void;
  pickerTitle: string;
  pickerHint: string;
  pickerSearch: string;
  onPickerSearchChange: (value: string) => void;
  loading: boolean;
  availableOptions: ProjectAssociationOption[];
  visibleOptions: ProjectAssociationOption[];
  pickerSelectionIds: number[];
  onPickerSelectionChange: (id: number, checked: boolean) => void;
  onAddSelected: () => void;
  loadingLabel: string;
  emptyLabel: string;
  rows: T[];
  idKey: "user_id" | "group_id";
  labelById: (id: number) => string;
  onChange: (rows: T[]) => void;
}) {
  return (
    <section className="space-y-3">
      <AdminAssociationSectionHeader title={title} countLabel={`${count} linked`} actionLabel={actionLabel} onAction={onTogglePicker} />
      {showPicker ? (
        <AdminAssociationPickerPanel
          title={pickerTitle}
          hint={pickerHint}
          search={pickerSearch}
          onSearchChange={onPickerSearchChange}
          loading={loading}
          availableCount={availableOptions.length}
          maxVisibleOptions={MAX_VISIBLE_OPTIONS}
          selectedCount={pickerSelectionIds.length}
          onCancel={onTogglePicker}
          onAdd={onAddSelected}
          addDisabled={pickerSelectionIds.length === 0}
          loadingLabel={loadingLabel}
          emptyLabel={emptyLabel}
        >
          {visibleOptions.map((option) => (
            <AdminAssociationPickerOption
              key={option.id}
              checked={pickerSelectionIds.includes(option.id)}
              onChange={(checked) => onPickerSelectionChange(option.id, checked)}
              label={option.label}
              detail={option.detail}
            />
          ))}
        </AdminAssociationPickerPanel>
      ) : null}
      <div className={uiTableContainerClass}>
        <table className={cx(uiDataTableClass, "min-w-full")}>
          <thead>
            <tr>
              <th className="text-left">{title}</th>
              <th className="text-left">Portal role</th>
              <th className="text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const currentId = idKey === "user_id"
                ? (row as ProjectFormUserLink).user_id
                : (row as ProjectFormGroupLink).group_id;
              return (
                <tr key={`${currentId || "new"}-${index}`}>
                  <td>
                    <p className={cx("font-semibold", uiTitleTextClass)}>
                      {typeof currentId === "number" ? labelById(currentId) : "Unknown"}
                    </p>
                  </td>
                  <td>
                    <select
                      className={cx(uiInputClass, "min-w-40")}
                      value={row.account_role}
                      onChange={(event) =>
                        onChange(rows.map((entry, entryIndex) => entryIndex === index ? { ...entry, account_role: roleValue(event.target.value) } : entry) as T[])
                      }
                    >
                      {ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="text-right">
                    <button type="button" className={tableDeleteActionClasses} onClick={() => onChange(rows.filter((_, entryIndex) => entryIndex !== index))}>
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <TableEmptyState colSpan={3} title={`No ${title.toLowerCase()} linked`} description="Add a link to grant Portal access through this project." />
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
