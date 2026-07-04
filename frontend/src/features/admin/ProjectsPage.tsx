/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  createProject,
  deleteProject,
  listProjects,
  provisionProjectAccounts,
  updateProject,
  type Project,
  type ProjectAccountLinkInput,
  type ProjectGroupLinkInput,
  type ProjectPortalRole,
  type ProjectUserLinkInput,
} from "../../api/projects";
import { listMinimalS3Accounts, type S3AccountSummary } from "../../api/accounts";
import { listMinimalUsers, type UserSummary } from "../../api/users";
import { listMinimalGroups, type UiGroupSummary } from "../../api/groups";
import { listStorageEndpoints, type StorageEndpoint } from "../../api/storageEndpoints";
import ListToolbar from "../../components/ListToolbar";
import Modal from "../../components/Modal";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import PaginationControls from "../../components/PaginationControls";
import TableEmptyState from "../../components/TableEmptyState";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { toolbarCompactInputClasses } from "../../components/toolbarControlClasses";
import {
  cx,
  uiButtonBaseClass,
  uiButtonVariants,
  uiDataTableClass,
  uiInputClass,
  uiMutedTextClass,
  uiTableContainerClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { confirmAction } from "../../utils/confirm";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";

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

function accountLabel(account: S3AccountSummary | undefined): string {
  if (!account) return "Unknown account";
  const endpoint = account.storage_endpoint_name ?? account.storage_endpoint_url;
  return endpoint ? `${account.name} (${endpoint})` : account.name;
}

function endpointLabel(endpoint: StorageEndpoint): string {
  const zonegroup = endpoint.ceph_zonegroup?.name;
  return zonegroup ? `${endpoint.name} (${zonegroup})` : endpoint.name;
}

export default function ProjectsPage() {
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
  const [endpoints, setEndpoints] = useState<StorageEndpoint[]>([]);
  const [provisionEndpointIds, setProvisionEndpointIds] = useState<number[]>([]);
  const [provisionBaseName, setProvisionBaseName] = useState("");
  const [provisionEmail, setProvisionEmail] = useState("");
  const [provisioning, setProvisioning] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const accountById = useMemo(() => new Map(accounts.map((account) => [Number(account.db_id ?? account.id), account])), [accounts]);
  const userById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const accountIds = useMemo(() => selectedIds(form.account_links, "account_id"), [form.account_links]);
  const userIds = useMemo(() => selectedIds(form.user_links, "user_id"), [form.user_links]);
  const groupIds = useMemo(() => selectedIds(form.group_links, "group_id"), [form.group_links]);

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
      const [accountData, userData, groupData, endpointData] = await Promise.all([
        listMinimalS3Accounts(),
        listMinimalUsers(),
        listMinimalGroups(),
        listStorageEndpoints(),
      ]);
      setAccounts(accountData);
      setUsers(userData);
      setGroups(groupData);
      setEndpoints(endpointData.filter((endpoint) => endpoint.provider === "ceph" && Boolean(endpoint.capabilities?.account)));
    } catch (err) {
      console.error(err);
      setActionError(extractApiError(err, "Unable to load project association options."));
    } finally {
      setAuxLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const openCreateModal = () => {
    setEditingProject(null);
    setForm(emptyForm());
    setProvisionEndpointIds([]);
    setProvisionBaseName("");
    setProvisionEmail("");
    setActionError(null);
    setActionMessage(null);
    setShowModal(true);
    void loadAuxiliary();
  };

  const openEditModal = (project: Project) => {
    setEditingProject(project);
    setForm(formFromProject(project));
    setProvisionEndpointIds([]);
    setProvisionBaseName("");
    setProvisionEmail("");
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

  const handleProvision = async () => {
    if (!editingProject || provisionEndpointIds.length === 0) return;
    setProvisioning(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const result = await provisionProjectAccounts(editingProject.id, {
        endpoint_ids: provisionEndpointIds,
        base_name: provisionBaseName.trim() || null,
        email: provisionEmail.trim() || null,
      });
      setEditingProject(result.project);
      setForm(formFromProject(result.project));
      setProvisionEndpointIds([]);
      setActionMessage(
        `Provisioned ${result.created_account_ids.length} account(s); ${result.reused_endpoint_ids.length} endpoint(s) already covered.`
      );
      await loadProjects();
      await loadAuxiliary();
    } catch (err) {
      console.error(err);
      setActionError(extractApiError(err, "Unable to provision project accounts."));
    } finally {
      setProvisioning(false);
    }
  };

  const addAccountLink = () => {
    const next = accounts.find((account) => {
      const id = Number(account.db_id ?? account.id);
      return !accountIds.includes(id);
    });
    if (!next) return;
    const accountId = Number(next.db_id ?? next.id);
    setForm((current) => ({
      ...current,
      account_links: [
        ...current.account_links,
        { account_id: accountId, display_name: next.storage_endpoint_name ?? next.name, sort_order: current.account_links.length },
      ],
    }));
  };

  const addUserLink = () => {
    const next = users.find((user) => !userIds.includes(user.id));
    if (!next) return;
    setForm((current) => ({
      ...current,
      user_links: [...current.user_links, { user_id: next.id, account_role: "portal_user" }],
    }));
  };

  const addGroupLink = () => {
    const next = groups.find((group) => !groupIds.includes(group.id));
    if (!next) return;
    setForm((current) => ({
      ...current,
      group_links: [...current.group_links, { group_id: next.id, account_role: "portal_user" }],
    }));
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
                  <td>{project.user_count}</td>
                  <td>{project.group_count}</td>
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

            <section className="space-y-3">
              <SectionHeader title="S3 accounts" count={form.account_links.length} actionLabel="Add account" onAction={addAccountLink} disabled={auxLoading || accountIds.length >= accounts.length} />
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
                            <select
                              className={uiInputClass}
                              value={link.account_id}
                              onChange={(event) => {
                                const accountId = Number(event.target.value);
                                const account = accountById.get(accountId);
                                setForm((current) => ({
                                  ...current,
                                  account_links: current.account_links.map((entry, entryIndex) =>
                                    entryIndex === index
                                      ? { ...entry, account_id: accountId, display_name: entry.display_name || account?.storage_endpoint_name || account?.name || "" }
                                      : entry
                                  ),
                                }));
                              }}
                            >
                              {accounts.map((account) => {
                                const id = Number(account.db_id ?? account.id);
                                const disabled = accountIds.includes(id) && id !== link.account_id;
                                return (
                                  <option key={id} value={id} disabled={disabled}>
                                    {accountLabel(account)}
                                  </option>
                                );
                              })}
                            </select>
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
                actionLabel="Add user"
                onAction={addUserLink}
                disabled={auxLoading || userIds.length >= users.length}
                rows={form.user_links}
                options={users.map((user) => ({ id: user.id, label: user.email }))}
                selectedIds={userIds}
                idKey="user_id"
                labelById={(id) => userById.get(id)?.email ?? `User #${id}`}
                onChange={(rows) => setForm((current) => ({ ...current, user_links: rows as ProjectFormUserLink[] }))}
              />
              <AssociationTable
                title="UI groups"
                count={form.group_links.length}
                actionLabel="Add group"
                onAction={addGroupLink}
                disabled={auxLoading || groupIds.length >= groups.length}
                rows={form.group_links}
                options={groups.map((group) => ({ id: group.id, label: group.name }))}
                selectedIds={groupIds}
                idKey="group_id"
                labelById={(id) => groupById.get(id)?.name ?? `Group #${id}`}
                onChange={(rows) => setForm((current) => ({ ...current, group_links: rows as ProjectFormGroupLink[] }))}
              />
            </section>

            {editingProject ? (
              <section className="space-y-3 rounded-lg border border-[color:var(--ui-border)] p-3">
                <div>
                  <p className={cx("ui-body font-bold", uiTitleTextClass)}>Provision S3 accounts</p>
                  <p className={cx("ui-caption", uiMutedTextClass)}>
                    Select endpoints to create missing RGW accounts for this project. Endpoints sharing the same zonegroup are deduplicated by the backend.
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
                  <input
                    className={uiInputClass}
                    value={provisionBaseName}
                    onChange={(event) => setProvisionBaseName(event.target.value)}
                    placeholder="Base account name, defaults to project name"
                  />
                  <input
                    className={uiInputClass}
                    value={provisionEmail}
                    onChange={(event) => setProvisionEmail(event.target.value)}
                    placeholder="Optional root email"
                  />
                </div>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {endpoints.map((endpoint) => {
                    const selected = provisionEndpointIds.includes(endpoint.id);
                    return (
                      <label key={endpoint.id} className="flex items-start gap-2 rounded-md border border-[color:var(--ui-border)] px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(event) =>
                            setProvisionEndpointIds((current) =>
                              event.target.checked
                                ? [...current, endpoint.id]
                                : current.filter((id) => id !== endpoint.id)
                            )
                          }
                        />
                        <span>
                          <span className="block text-xs font-bold">{endpointLabel(endpoint)}</span>
                          <span className={cx("block text-[11px]", uiMutedTextClass)}>{endpoint.endpoint_url}</span>
                        </span>
                      </label>
                    );
                  })}
                  {endpoints.length === 0 ? <p className={cx("text-xs", uiMutedTextClass)}>No writable Ceph account endpoint available.</p> : null}
                </div>
                <button
                  type="button"
                  className={cx(uiButtonBaseClass, uiButtonVariants.secondary, "px-3 py-1.5 text-xs")}
                  disabled={provisionEndpointIds.length === 0 || provisioning}
                  onClick={() => void handleProvision()}
                >
                  {provisioning ? "Provisioning..." : "Provision selected endpoints"}
                </button>
              </section>
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

function SectionHeader({
  title,
  count,
  actionLabel,
  onAction,
  disabled,
}: {
  title: string;
  count: number;
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className={cx("ui-body font-bold", uiTitleTextClass)}>{title}</p>
        <p className={cx("ui-caption", uiMutedTextClass)}>{count} linked</p>
      </div>
      <button type="button" className={cx(uiButtonBaseClass, uiButtonVariants.secondary, "px-3 py-1.5 text-xs")} onClick={onAction} disabled={disabled}>
        {actionLabel}
      </button>
    </div>
  );
}

function AssociationTable<T extends ProjectFormUserLink | ProjectFormGroupLink>({
  title,
  count,
  actionLabel,
  onAction,
  disabled,
  rows,
  options,
  selectedIds,
  idKey,
  labelById,
  onChange,
}: {
  title: string;
  count: number;
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
  rows: T[];
  options: { id: number; label: string }[];
  selectedIds: number[];
  idKey: "user_id" | "group_id";
  labelById: (id: number) => string;
  onChange: (rows: T[]) => void;
}) {
  return (
    <section className="space-y-3">
      <SectionHeader title={title} count={count} actionLabel={actionLabel} onAction={onAction} disabled={disabled} />
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
                    <select
                      className={uiInputClass}
                      value={currentId}
                      aria-label={title}
                      onChange={(event) => {
                        const nextId = Number(event.target.value);
                        onChange(rows.map((entry, entryIndex) => entryIndex === index ? { ...entry, [idKey]: nextId } : entry) as T[]);
                      }}
                    >
                      {options.map((option) => (
                        <option key={option.id} value={option.id} disabled={selectedIds.includes(option.id) && option.id !== currentId}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {typeof currentId === "number" ? <p className={cx("mt-1 text-[11px]", uiMutedTextClass)}>{labelById(currentId)}</p> : null}
                  </td>
                  <td>
                    <select
                      className={uiInputClass}
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
