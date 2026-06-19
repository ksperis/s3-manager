/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createPortalStorageSpace, importPortalStorageSpace, type PortalStorageSpaceRole, type PortalStorageSpaceVisibility } from "../../api/portal";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import { cx, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import { storageSpacePath, type PortalWorkspaceSpace } from "./portalWorkspaceModel";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

function statusTone(space: PortalWorkspaceSpace) {
  if (space.status === "Archived") return "neutral";
  if (space.status === "Attention") return "warning";
  if (space.status === "Shared") return "primary";
  if (space.status === "Private") return "neutral";
  return "success";
}

function visibilityTone(visibility: PortalStorageSpaceVisibility) {
  return visibility === "shared" ? "primary" : "neutral";
}

function visibilityLabel(visibility: PortalStorageSpaceVisibility) {
  return visibility === "shared" ? "Shared" : "Private";
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

  const canCreate = Boolean(state?.can_manage_buckets);
  const canUseNamedBucket = Boolean(state?.allow_named_bucket_create);

  const handleCreate = async () => {
    if (!accountIdForApi || !newName.trim()) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const created = await createPortalStorageSpace(accountIdForApi, {
        name: newName.trim(),
        naming_mode: canUseNamedBucket ? newNamingMode : "generic_uuid",
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
      setImportError(extractApiError(err, "Unable to import bucket."));
    } finally {
      setImportBusy(false);
    }
  };

  if (accountLoading || loading) {
    return <div className="space-y-4"><PageBanner tone="info">Loading storage spaces...</PageBanner></div>;
  }

  if (accountError || error) {
    return <div className="space-y-4"><PageBanner tone="error">{accountError ?? error}</PageBanner></div>;
  }

  if (!hasAccountContext) {
    return <div className="space-y-4"><PageBanner tone="info">Select an account to view storage spaces.</PageBanner></div>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Storage Spaces"
        description="Manage your storage spaces and their configuration."
        breadcrumbs={[{ label: "Portal" }, { label: "Storage Spaces" }]}
        actions={
          canCreate
            ? [
                { label: "Create storage space", onClick: () => setShowCreate((value) => !value) },
                { label: "Import bucket", onClick: () => setShowImport((value) => !value), variant: "secondary" },
              ]
            : []
        }
      />

      {showCreate ? (
        <UiCard title="Create Storage Space">
          <div className="grid gap-3 lg:grid-cols-[180px_1fr_1.5fr_160px_auto]">
            <select
              className="ui-control h-9 py-1.5 text-xs"
              value={newNamingMode}
              onChange={(event) => setNewNamingMode(event.target.value as "generic_uuid" | "named_bucket")}
              disabled={!canUseNamedBucket}
              aria-label="Storage Space naming mode"
            >
              <option value="generic_uuid">Generic storage</option>
              {canUseNamedBucket ? <option value="named_bucket">Named bucket</option> : null}
            </select>
            <input
              className="ui-control h-9 text-xs"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder={newNamingMode === "named_bucket" ? "Storage Space and bucket name" : "Storage Space name"}
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
        <UiCard title="Import bucket">
          <div className="grid gap-3 lg:grid-cols-[1fr_1.5fr_160px_auto]">
            <input
              className="ui-control h-9 text-xs"
              value={importBucketName}
              onChange={(event) => setImportBucketName(event.target.value)}
              placeholder="Bucket name"
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
              {importBusy ? "Importing..." : "Import"}
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
            <option value="all">All statuses</option>
            <option value="Active">Active</option>
            <option value="Attention">Attention</option>
            <option value="Private">Private</option>
            <option value="Shared">Shared</option>
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
                <th>Status</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredSpaces.map((space) => (
                <tr key={space.id}>
                  <td>
                    <div className={cx("font-bold", uiTitleTextClass)}>{space.name}</div>
                    <div className={cx("text-[11px] font-medium", uiMutedTextClass)}>{space.description}</div>
                  </td>
                  <td><UiBadge tone={visibilityTone(space.visibility)}>{visibilityLabel(space.visibility)}</UiBadge></td>
                  <td>{formatCompactNumber(space.objectCount)}</td>
                  <td>{formatBytes(space.usedBytes)}</td>
                  <td>{space.createdLabel}</td>
                  <td>{space.region}</td>
                  <td><UiBadge tone={statusTone(space)}>{space.status === "Active" ? "Enabled" : space.status}</UiBadge></td>
                  <td className="text-right"><Link to={storageSpacePath(space)}>Open</Link></td>
                </tr>
              ))}
              {filteredSpaces.length === 0 ? (
                <tr>
                  <td colSpan={8} className={cx("py-6 text-center text-xs font-semibold", uiMutedTextClass)}>
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
