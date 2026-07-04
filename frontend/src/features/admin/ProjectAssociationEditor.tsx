/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { listProjects, updateProject, type Project, type ProjectPortalRole } from "../../api/projects";
import PageBanner from "../../components/PageBanner";
import TableEmptyState from "../../components/TableEmptyState";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { cx, uiDataTableClass, uiInputClass, uiMutedTextClass, uiTableContainerClass, uiTitleTextClass } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import {
  AdminAssociationPickerOption,
  AdminAssociationPickerPanel,
  AdminAssociationSectionHeader,
} from "./AdminAssociationPicker";

type ProjectAssociationTarget =
  | { kind: "account"; id: number; label: string; defaultDisplayName?: string | null }
  | { kind: "user"; id: number; label: string }
  | { kind: "group"; id: number; label: string };

type ProjectAssociationState = {
  selectedIds: number[];
  displayNames: Record<number, string>;
  roles: Record<number, ProjectPortalRole>;
};

const MAX_VISIBLE_OPTIONS = 10;

const ROLE_OPTIONS: { value: ProjectPortalRole; label: string }[] = [
  { value: "portal_user", label: "Portal user" },
  { value: "portal_manager", label: "Portal manager" },
];

function normalizeRole(value?: string | null): ProjectPortalRole {
  return value === "portal_manager" ? "portal_manager" : "portal_user";
}

function accountProjectLink(project: Project, accountId: number) {
  return project.account_links.find((link) => link.account_id === accountId) ?? null;
}

function userProjectLink(project: Project, userId: number) {
  return project.user_links.find((link) => link.user_id === userId) ?? null;
}

function groupProjectLink(project: Project, groupId: number) {
  return project.group_links.find((link) => link.group_id === groupId) ?? null;
}

function projectMatchesSearch(project: Project, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return [project.name, project.description ?? ""].some((value) => value.toLowerCase().includes(query));
}

function projectCountsLabel(project: Project): string {
  return `${project.account_count} account(s), ${project.user_count} user(s), ${project.group_count} group(s)`;
}

function projectOptionDetail(project: Project): string {
  const counts = projectCountsLabel(project);
  return project.description ? `${project.description} - ${counts}` : counts;
}

function deriveAssociationState(projects: Project[], target: ProjectAssociationTarget): ProjectAssociationState {
  const selectedIds: number[] = [];
  const displayNames: Record<number, string> = {};
  const roles: Record<number, ProjectPortalRole> = {};
  projects.forEach((project) => {
    if (target.kind === "account") {
      const link = accountProjectLink(project, target.id);
      if (link) {
        selectedIds.push(project.id);
        displayNames[project.id] = link.display_name;
      }
      return;
    }
    if (target.kind === "user") {
      const link = userProjectLink(project, target.id);
      if (link) {
        selectedIds.push(project.id);
        roles[project.id] = normalizeRole(link.account_role);
      }
      return;
    }
    const link = groupProjectLink(project, target.id);
    if (link) {
      selectedIds.push(project.id);
      roles[project.id] = normalizeRole(link.account_role);
    }
  });
  return { selectedIds, displayNames, roles };
}

function associationSignature(state: ProjectAssociationState): string {
  const selected = [...state.selectedIds].sort((a, b) => a - b);
  const names = Object.fromEntries(
    selected
      .map((projectId) => [projectId, state.displayNames[projectId]] as const)
      .filter(([, value]) => typeof value === "string")
  );
  const roles = Object.fromEntries(
    selected
      .map((projectId) => [projectId, state.roles[projectId]] as const)
      .filter(([, value]) => Boolean(value))
  );
  return JSON.stringify({ selected, names, roles });
}

function targetDescription(target: ProjectAssociationTarget): string {
  if (target.kind === "account") return "Expose this S3 account through one or more Portal projects.";
  if (target.kind === "user") return "Grant this UI user Portal access through projects.";
  return "Grant this UI group Portal access through projects.";
}

export default function ProjectAssociationEditor({ target }: { target: ProjectAssociationTarget }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [displayNames, setDisplayNames] = useState<Record<number, string>>({});
  const [roles, setRoles] = useState<Record<number, ProjectPortalRole>>({});
  const [initialSignature, setInitialSignature] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [projectSelectionIds, setProjectSelectionIds] = useState<number[]>([]);

  const applyProjects = (nextProjects: Project[]) => {
    const nextState = deriveAssociationState(nextProjects, target);
    setProjects(nextProjects);
    setSelectedIds(nextState.selectedIds);
    setDisplayNames(nextState.displayNames);
    setRoles(nextState.roles);
    setInitialSignature(associationSignature(nextState));
    setShowPicker(false);
    setProjectSearch("");
    setProjectSelectionIds([]);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMessage(null);
    listProjects({ page: 1, page_size: 200, sort_by: "name", sort_dir: "asc" })
      .then((data) => {
        if (!cancelled) applyProjects(data.items);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setError(extractApiError(err, "Unable to load project associations."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [target.id, target.kind]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const linkedProjects = useMemo(
    () => projects.filter((project) => selectedSet.has(project.id)),
    [projects, selectedSet]
  );
  const availableProjects = useMemo(
    () => projects.filter((project) => !selectedSet.has(project.id) && projectMatchesSearch(project, projectSearch)),
    [projectSearch, projects, selectedSet]
  );
  const visibleAvailableProjects = useMemo(
    () => availableProjects.slice(0, MAX_VISIBLE_OPTIONS),
    [availableProjects]
  );
  const dirty = useMemo(
    () => initialSignature !== associationSignature({ selectedIds, displayNames, roles }),
    [displayNames, initialSignature, roles, selectedIds]
  );

  const toggleProjectSelection = (projectId: number, checked: boolean) => {
    setProjectSelectionIds((current) =>
      checked ? [...current, projectId] : current.filter((selectedId) => selectedId !== projectId)
    );
  };

  const addSelectedProjects = () => {
    const idsToAdd = projectSelectionIds.filter((projectId) => !selectedSet.has(projectId));
    if (idsToAdd.length === 0) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      idsToAdd.forEach((projectId) => next.add(projectId));
      return [...next];
    });
    if (target.kind === "account") {
      setDisplayNames((current) => {
        const next = { ...current };
        idsToAdd.forEach((projectId) => {
          next[projectId] = next[projectId] ?? target.defaultDisplayName ?? target.label;
        });
        return next;
      });
    } else {
      setRoles((current) => {
        const next = { ...current };
        idsToAdd.forEach((projectId) => {
          next[projectId] = next[projectId] ?? "portal_user";
        });
        return next;
      });
    }
    setProjectSelectionIds([]);
    setProjectSearch("");
    setShowPicker(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    const selectedNow = new Set(selectedIds);
    try {
      for (const project of projects) {
        const selected = selectedNow.has(project.id);
        if (target.kind === "account") {
          const existing = accountProjectLink(project, target.id);
          const nextDisplayName = (displayNames[project.id] || target.defaultDisplayName || target.label).trim();
          const unchanged = selected ? existing && existing.display_name === nextDisplayName : !existing;
          if (unchanged) continue;
          const account_links = project.account_links
            .filter((link) => link.account_id !== target.id)
            .map((link, index) => ({
              account_id: link.account_id,
              display_name: link.display_name,
              sort_order: index,
            }));
          if (selected) {
            account_links.push({
              account_id: target.id,
              display_name: nextDisplayName,
              sort_order: account_links.length,
            });
          }
          await updateProject(project.id, { account_links });
          continue;
        }
        if (target.kind === "user") {
          const existing = userProjectLink(project, target.id);
          const nextRole = normalizeRole(roles[project.id]);
          const unchanged = selected ? existing && normalizeRole(existing.account_role) === nextRole : !existing;
          if (unchanged) continue;
          const user_links = project.user_links
            .filter((link) => link.user_id !== target.id)
            .map((link) => ({ user_id: link.user_id, account_role: normalizeRole(link.account_role) }));
          if (selected) {
            user_links.push({ user_id: target.id, account_role: nextRole });
          }
          await updateProject(project.id, { user_links });
          continue;
        }
        const existing = groupProjectLink(project, target.id);
        const nextRole = normalizeRole(roles[project.id]);
        const unchanged = selected ? existing && normalizeRole(existing.account_role) === nextRole : !existing;
        if (unchanged) continue;
        const group_links = project.group_links
          .filter((link) => link.group_id !== target.id)
          .map((link) => ({ group_id: link.group_id, account_role: normalizeRole(link.account_role) }));
        if (selected) {
          group_links.push({ group_id: target.id, account_role: nextRole });
        }
        await updateProject(project.id, { group_links });
      }
      const refreshed = await listProjects({ page: 1, page_size: 200, sort_by: "name", sort_dir: "asc" });
      applyProjects(refreshed.items);
      setMessage("Project associations saved.");
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, "Unable to save project associations."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className={cx("ui-body font-semibold", uiTitleTextClass)}>Project associations</p>
          <p className={cx("ui-caption", uiMutedTextClass)}>{targetDescription(target)}</p>
        </div>
        <button type="button" className={tableActionButtonClasses} onClick={() => void save()} disabled={!dirty || saving || loading}>
          {saving ? "Saving..." : "Save project links"}
        </button>
      </div>
      {error ? <PageBanner tone="error">{error}</PageBanner> : null}
      {message ? <PageBanner tone="success">{message}</PageBanner> : null}

      <AdminAssociationSectionHeader
        title="Linked projects"
        countLabel={`${selectedIds.length} linked`}
        actionLabel={showPicker ? "Close" : "Add projects"}
        onAction={() => {
          setShowPicker((current) => !current);
          setProjectSelectionIds([]);
          setProjectSearch("");
        }}
      />

      {showPicker ? (
        <AdminAssociationPickerPanel
          title="Add projects"
          hint="Search by project name or description"
          search={projectSearch}
          onSearchChange={setProjectSearch}
          loading={loading}
          availableCount={availableProjects.length}
          maxVisibleOptions={MAX_VISIBLE_OPTIONS}
          selectedCount={projectSelectionIds.length}
          onCancel={() => {
            setShowPicker(false);
            setProjectSelectionIds([]);
            setProjectSearch("");
          }}
          onAdd={addSelectedProjects}
          addDisabled={projectSelectionIds.length === 0}
          loadingLabel="Loading projects..."
          emptyLabel="No available projects."
        >
          {visibleAvailableProjects.map((project) => (
            <AdminAssociationPickerOption
              key={project.id}
              checked={projectSelectionIds.includes(project.id)}
              onChange={(checked) => toggleProjectSelection(project.id, checked)}
              label={project.name}
              detail={projectOptionDetail(project)}
            />
          ))}
        </AdminAssociationPickerPanel>
      ) : null}

      <div className={uiTableContainerClass}>
        <table className={cx(uiDataTableClass, "min-w-full")}>
          <thead>
            <tr>
              <th className="text-left">Project</th>
              <th className="text-left">{target.kind === "account" ? "Portal label" : "Portal role"}</th>
              <th className="text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {linkedProjects.map((project) => (
              <tr key={project.id}>
                <td>
                  <p className="font-semibold">{project.name}</p>
                  <p className={cx("text-[11px]", uiMutedTextClass)}>{projectCountsLabel(project)}</p>
                </td>
                <td>
                  {target.kind === "account" ? (
                    <input
                      className={cx(uiInputClass, "min-w-48")}
                      value={displayNames[project.id] ?? ""}
                      placeholder="Location or common name"
                      onChange={(event) => setDisplayNames((current) => ({ ...current, [project.id]: event.target.value }))}
                    />
                  ) : (
                    <select
                      className={cx(uiInputClass, "min-w-40")}
                      value={roles[project.id] ?? "portal_user"}
                      onChange={(event) =>
                        setRoles((current) => ({ ...current, [project.id]: normalizeRole(event.target.value) }))
                      }
                    >
                      {ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="text-right">
                  <button
                    type="button"
                    className={tableDeleteActionClasses}
                    onClick={() => setSelectedIds((current) => current.filter((projectId) => projectId !== project.id))}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {!loading && linkedProjects.length === 0 ? (
              <TableEmptyState colSpan={3} title="No linked projects" description="Use Add projects to associate this resource." />
            ) : null}
            {loading ? <TableEmptyState colSpan={3} title="Loading projects..." /> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
