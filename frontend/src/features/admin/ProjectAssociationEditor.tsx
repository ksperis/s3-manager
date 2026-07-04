/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { listProjects, updateProject, type Project, type ProjectPortalRole } from "../../api/projects";
import PageBanner from "../../components/PageBanner";
import TableEmptyState from "../../components/TableEmptyState";
import { tableActionButtonClasses } from "../../components/tableActionClasses";
import { cx, uiDataTableClass, uiInputClass, uiMutedTextClass, uiTableContainerClass, uiTitleTextClass } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";

type ProjectAssociationTarget =
  | { kind: "account"; id: number; label: string; defaultDisplayName?: string | null }
  | { kind: "user"; id: number; label: string };

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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMessage(null);
    listProjects({ page: 1, page_size: 200, sort_by: "name", sort_dir: "asc" })
      .then((data) => {
        if (cancelled) return;
        const nextProjects = data.items;
        const nextSelected: number[] = [];
        const nextDisplayNames: Record<number, string> = {};
        const nextRoles: Record<number, ProjectPortalRole> = {};
        nextProjects.forEach((project) => {
          if (target.kind === "account") {
            const link = accountProjectLink(project, target.id);
            if (link) {
              nextSelected.push(project.id);
              nextDisplayNames[project.id] = link.display_name;
            }
          } else {
            const link = userProjectLink(project, target.id);
            if (link) {
              nextSelected.push(project.id);
              nextRoles[project.id] = normalizeRole(link.account_role);
            }
          }
        });
        setProjects(nextProjects);
        setSelectedIds(nextSelected);
        setDisplayNames(nextDisplayNames);
        setRoles(nextRoles);
        setInitialSignature(JSON.stringify({ selected: [...nextSelected].sort(), names: nextDisplayNames, roles: nextRoles }));
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
  const dirty = useMemo(
    () => initialSignature !== JSON.stringify({ selected: [...selectedIds].sort(), names: displayNames, roles }),
    [displayNames, initialSignature, roles, selectedIds]
  );

  const handleToggle = (project: Project, checked: boolean) => {
    setSelectedIds((current) =>
      checked ? [...current, project.id] : current.filter((projectId) => projectId !== project.id)
    );
    if (checked && target.kind === "account") {
      setDisplayNames((current) => ({
        ...current,
        [project.id]: current[project.id] ?? target.defaultDisplayName ?? target.label,
      }));
    }
    if (checked && target.kind === "user") {
      setRoles((current) => ({ ...current, [project.id]: current[project.id] ?? "portal_user" }));
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      for (const project of projects) {
        const selected = selectedSet.has(project.id);
        if (target.kind === "account") {
          const existing = accountProjectLink(project, target.id);
          const nextDisplayName = (displayNames[project.id] || target.defaultDisplayName || target.label).trim();
          const unchanged = selected
            ? existing && existing.display_name === nextDisplayName
            : !existing;
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
        } else {
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
        }
      }
      const refreshed = await listProjects({ page: 1, page_size: 200, sort_by: "name", sort_dir: "asc" });
      setProjects(refreshed.items);
      setInitialSignature(JSON.stringify({ selected: [...selectedIds].sort(), names: displayNames, roles }));
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
          <p className={cx("ui-caption", uiMutedTextClass)}>
            {target.kind === "account"
              ? "Expose this S3 account through one or more Portal projects."
              : "Grant this UI user Portal access through projects."}
          </p>
        </div>
        <button type="button" className={tableActionButtonClasses} onClick={() => void save()} disabled={!dirty || saving || loading}>
          {saving ? "Saving..." : "Save project links"}
        </button>
      </div>
      {error ? <PageBanner tone="error">{error}</PageBanner> : null}
      {message ? <PageBanner tone="success">{message}</PageBanner> : null}
      <div className={uiTableContainerClass}>
        <table className={cx(uiDataTableClass, "min-w-full")}>
          <thead>
            <tr>
              <th className="text-left">Project</th>
              <th className="text-left">{target.kind === "account" ? "Portal label" : "Portal role"}</th>
              <th className="text-left">Linked</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => {
              const selected = selectedSet.has(project.id);
              return (
                <tr key={project.id}>
                  <td>
                    <p className="font-semibold">{project.name}</p>
                    <p className={cx("text-[11px]", uiMutedTextClass)}>
                      {project.account_count} account(s), {project.user_count} user(s)
                    </p>
                  </td>
                  <td>
                    {target.kind === "account" ? (
                      <input
                        className={uiInputClass}
                        value={displayNames[project.id] ?? ""}
                        placeholder="Location or common name"
                        disabled={!selected}
                        onChange={(event) => setDisplayNames((current) => ({ ...current, [project.id]: event.target.value }))}
                      />
                    ) : (
                      <select
                        className={uiInputClass}
                        value={roles[project.id] ?? "portal_user"}
                        disabled={!selected}
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
                  <td>
                    <label className="inline-flex items-center gap-2 text-xs font-semibold">
                      <input type="checkbox" checked={selected} onChange={(event) => handleToggle(project, event.target.checked)} />
                      <span>{selected ? "Linked" : "Not linked"}</span>
                    </label>
                  </td>
                </tr>
              );
            })}
            {!loading && projects.length === 0 ? (
              <TableEmptyState colSpan={3} title="No projects" description="Create projects first from the Projects admin page." />
            ) : null}
            {loading ? <TableEmptyState colSpan={3} title="Loading projects..." /> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
