/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createPortalStorageSpace, importPortalStorageSpace, type PortalStorageSpaceRole, type PortalStorageSpaceVisibility } from "../../api/portal";
import PageHeader from "../../components/PageHeader";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import { cx, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import { storageSpacePath } from "./portalWorkspaceModel";
import {
  portalStorageSpaceStatusTone,
  portalVisibilityLabel,
  portalVisibilityTone,
  resolvePortalWorkspacePageState,
} from "./portalUi";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

function visibleStatus(space: { status: string; visibility: PortalStorageSpaceVisibility }) {
  const visibilityLabel = portalVisibilityLabel(space.visibility);
  if (space.status === visibilityLabel || space.status === "Active") return null;
  return space.status;
}

export default function PortalStorageSpacesPage() {
  const { workspace, loading, error, hasAccountContext, accountError, accountLoading, accountIdForApi, state } = usePortalWorkspaceData();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<PortalStorageSpaceRole | "all">("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState("name");
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newVisibility, setNewVisibility] = useState<PortalStorageSpaceVisibility>("private");
  const [newNamingMode, setNewNamingMode] = useState<"generic_uuid" | "named_bucket">("generic_uuid");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [importBucketName, setImportBucketName] = useState("");
  const [importDescription, setImportDescription] = useState("");
  const [importVisibility, setImportVisibility] = useState<PortalStorageSpaceVisibility>("private");
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSpaces = useMemo(() => {
    const filtered = workspace.spaces.filter((space) => {
      if (roleFilter !== "all" && space.role !== roleFilter) return false;
      if (statusFilter !== "all" && space.status !== statusFilter) return false;
      if (!normalizedQuery) return true;
      return [space.name, space.description, space.ownerLabel, space.visibility, space.projectKey, space.datasetLabel]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery));
    });
    return [...filtered].sort((a, b) => {
      if (sort === "created_at") return (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
      if (sort === "-created_at") return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
      if (sort === "used_bytes") return (a.usedBytes ?? -1) - (b.usedBytes ?? -1);
      if (sort === "-used_bytes") return (b.usedBytes ?? -1) - (a.usedBytes ?? -1);
      if (sort === "object_count") return (a.objectCount ?? -1) - (b.objectCount ?? -1);
      if (sort === "-object_count") return (b.objectCount ?? -1) - (a.objectCount ?? -1);
      return a.name.localeCompare(b.name);
    });
  }, [normalizedQuery, roleFilter, sort, statusFilter, workspace.spaces]);

  const canCreate = Boolean(state?.can_create_storage_spaces);
  const canImport = state?.account_role === "portal_manager" && Boolean(state?.can_manage_buckets);
  const canUseNamedBucket = Boolean(state?.allow_named_bucket_create);
  const effectiveNamingMode = canUseNamedBucket ? newNamingMode : "generic_uuid";

  const handleCreate = async () => {
    if (!accountIdForApi || !newName.trim()) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const created = await createPortalStorageSpace(accountIdForApi, {
        name: newName.trim(),
        naming_mode: effectiveNamingMode,
        description: newDescription.trim() || null,
        visibility: newVisibility,
      });
      navigate(storageSpacePath({ id: created.id }));
    } catch (err) {
      console.error(err);
      setCreateError(extractApiError(err, "Unable to create Storage Space."));
    } finally {
      setCreateBusy(false);
    }
  };

  const handleImport = async () => {
    if (!accountIdForApi || !importBucketName.trim()) return;
    setImportBusy(true);
    setImportError(null);
    try {
      const imported = await importPortalStorageSpace(accountIdForApi, {
        bucket_name: importBucketName.trim(),
        description: importDescription.trim() || null,
        visibility: importVisibility,
      });
      navigate(storageSpacePath({ id: imported.id }));
    } catch (err) {
      console.error(err);
      setImportError(extractApiError(err, "Unable to add existing storage."));
    } finally {
      setImportBusy(false);
    }
  };

  const pageState = resolvePortalWorkspacePageState({
    accountLoading,
    loading,
    accountError,
    error,
    hasAccountContext,
    loadingMessage: "Loading storage spaces...",
    noAccountMessage: "Select an account to view storage spaces.",
  });
  if (pageState) return pageState;
  const headerActions = [
    ...(canCreate ? [{ label: "Create storage space", onClick: () => setShowCreate((value) => !value) }] : []),
    ...(canImport
      ? [{ label: "Add existing storage", onClick: () => setShowImport((value) => !value), variant: "secondary" as const }]
      : []),
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Storage Spaces"
        description="Manage access, files and usage for your Storage Spaces."
        breadcrumbs={portalBreadcrumbs({ label: "Storage Spaces" })}
        actions={headerActions}
      />

      {showCreate ? (
        <UiCard title="Create Storage Space">
          <div className={cx("grid gap-3", canUseNamedBucket ? "lg:grid-cols-[180px_1fr_1.5fr_160px_auto]" : "lg:grid-cols-[1fr_1.5fr_160px_auto]")}>
            {canUseNamedBucket ? (
              <select
                className="ui-control h-9 py-1.5 text-xs"
                value={newNamingMode}
                onChange={(event) => setNewNamingMode(event.target.value as "generic_uuid" | "named_bucket")}
                aria-label="Storage Space naming mode"
              >
                <option value="generic_uuid">Automatic storage</option>
                <option value="named_bucket">Named storage</option>
              </select>
            ) : null}
            <input
              className="ui-control h-9 text-xs"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder={effectiveNamingMode === "named_bucket" ? "Storage Space and storage name" : "Storage Space name"}
            />
            <input className="ui-control h-9 text-xs" value={newDescription} onChange={(event) => setNewDescription(event.target.value)} placeholder="Description" />
            <select className="ui-control h-9 py-1.5 text-xs" value={newVisibility} onChange={(event) => setNewVisibility(event.target.value as PortalStorageSpaceVisibility)} aria-label="Storage Space visibility">
              <option value="private">Private</option>
              <option value="shared">Shared</option>
            </select>
            <UiButton disabled={!newName.trim() || createBusy} onClick={handleCreate} className="h-9 px-3 py-1.5">
              {createBusy ? "Creating..." : "Create"}
            </UiButton>
          </div>
          {createError ? <div className="mt-3 text-xs font-semibold text-rose-600 dark:text-rose-300">{createError}</div> : null}
        </UiCard>
      ) : null}

      {showImport ? (
        <UiCard title="Add existing storage">
          <div className="grid gap-3 lg:grid-cols-[1fr_1.5fr_160px_auto]">
            <input
              className="ui-control h-9 text-xs"
              value={importBucketName}
              onChange={(event) => setImportBucketName(event.target.value)}
              placeholder="Existing storage name"
            />
            <input
              className="ui-control h-9 text-xs"
              value={importDescription}
              onChange={(event) => setImportDescription(event.target.value)}
              placeholder="Description"
            />
            <select className="ui-control h-9 py-1.5 text-xs" value={importVisibility} onChange={(event) => setImportVisibility(event.target.value as PortalStorageSpaceVisibility)} aria-label="Imported Storage Space visibility">
              <option value="private">Private</option>
              <option value="shared">Shared</option>
            </select>
            <UiButton disabled={!importBucketName.trim() || importBusy} onClick={handleImport} className="h-9 px-3 py-1.5">
              {importBusy ? "Adding..." : "Add"}
            </UiButton>
          </div>
          {importError ? <div className="mt-3 text-xs font-semibold text-rose-600 dark:text-rose-300">{importError}</div> : null}
        </UiCard>
      ) : null}

      <UiCard>
        <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(220px,1fr)_160px_160px_180px]">
          <input
            type="search"
            className="ui-control h-9 py-1.5 text-xs"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search storage spaces..."
          />
          <select className="ui-control h-9 py-1.5 text-xs" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as PortalStorageSpaceRole | "all")}>
            <option value="all">All roles</option>
            <option value="Owner">Owner</option>
            <option value="Editor">Editor</option>
            <option value="Viewer">Viewer</option>
          </select>
          <select className="ui-control h-9 py-1.5 text-xs" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All states</option>
            <option value="Active">Active</option>
            <option value="Private">Private</option>
            <option value="Shared">Shared</option>
            <option value="Attention">Attention</option>
            <option value="Archived">Archived</option>
          </select>
          <select className="ui-control h-9 py-1.5 text-xs" value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="name">Name</option>
            <option value="-created_at">Newest</option>
            <option value="-used_bytes">Usage</option>
            <option value="-object_count">Objects</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="ui-data-table min-w-[840px]">
            <thead>
              <tr>
                <th>Name</th>
                <th>Visibility</th>
                <th>Objects</th>
                <th>Size</th>
                <th>Created</th>
                <th>Region</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredSpaces.map((space) => {
                const status = visibleStatus(space);
                return (
                  <tr key={space.id}>
                    <td>
                      <Link
                        to={storageSpacePath(space)}
                        className={cx(
                          "font-bold hover:text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                          uiTitleTextClass,
                        )}
                      >
                        {space.name}
                      </Link>
                      <div className={cx("text-[11px] font-medium", uiMutedTextClass)}>{space.description}</div>
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center gap-2">
                        <UiBadge tone={portalVisibilityTone(space.visibility)}>{portalVisibilityLabel(space.visibility)}</UiBadge>
                        {status ? <UiBadge tone={portalStorageSpaceStatusTone(space)}>{status}</UiBadge> : null}
                      </div>
                    </td>
                    <td>{formatCompactNumber(space.objectCount)}</td>
                    <td>{formatBytes(space.usedBytes)}</td>
                    <td>{space.createdLabel}</td>
                    <td>{space.region}</td>
                    <td className="text-right"><Link to={storageSpacePath(space)}>Open</Link></td>
                  </tr>
                );
              })}
              {filteredSpaces.length === 0 ? (
                <tr>
                  <td colSpan={7} className={cx("py-6 text-center text-xs font-semibold", uiMutedTextClass)}>
                    No Storage Spaces to display.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className={cx("mt-4 flex items-center justify-between text-[11px] font-semibold", uiMutedTextClass)}>
          <span>{filteredSpaces.length} of {workspace.spaces.length}</span>
        </div>
      </UiCard>
    </div>
  );
}
