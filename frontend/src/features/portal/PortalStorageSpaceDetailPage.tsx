/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  createPortalStorageSpaceFolder,
  listPortalStorageSpaceObjects,
  updatePortalStorageSpace,
  uploadPortalStorageSpaceObject,
  type PortalStorageObjectListing,
} from "../../api/portal";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import { tableActionButtonClasses, tableIconActionButtonClasses } from "../../components/tableActionClasses";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import UiProgressBar from "../../components/ui/UiProgressBar";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import {
  storageSpaceObjectPath,
  storageSpacePath,
  type PortalWorkspaceFile,
  type PortalWorkspaceSpace,
} from "./portalWorkspaceModel";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";
import { completePortalTransfer, failPortalTransfer, startPortalTransfer } from "./portalTransferTracker";

function decodeRouteValue(value?: string): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizePrefix(value: string): string {
  const trimmed = value.replace(/^\/+/, "");
  if (!trimmed) return "";
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function prefixLink(space: PortalWorkspaceSpace, prefix: string): string {
  const base = storageSpacePath(space);
  return prefix ? `${base}?prefix=${encodeURIComponent(prefix)}` : base;
}

function folderName(file: PortalWorkspaceFile): string {
  return file.name.replace(/\/$/, "");
}

function FileGlyph({ kind }: { kind: PortalWorkspaceFile["kind"] }) {
  if (kind === "folder") {
    return (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded border border-blue-100 bg-blue-50 text-blue-700">
        <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5">
          <path d="M2.5 5.5h5l1.3 1.6h8.7v7.4a1 1 0 0 1-1 1h-14a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </span>
    );
  }
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded border border-slate-200 bg-white text-slate-600">
      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5">
        <path d="M5 2.5h6.5L15 6v11.5H5V2.5Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M11.5 2.5V6H15" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </span>
  );
}

function HeaderIconButton({ label, children, onClick }: { label: string; children: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={tableIconActionButtonClasses}
    >
      {children}
    </button>
  );
}

function ObjectMetricCard({
  label,
  value,
  detail,
  progress,
}: {
  label: string;
  value: string;
  detail: string;
  progress?: number;
}) {
  return (
    <UiCard bodyClassName="px-4 py-3">
      <div className="text-[11px] font-semibold text-slate-500">{label}</div>
      <div className="mt-2 text-[20px] font-bold leading-6 text-slate-950">{value}</div>
      <div className="mt-1 text-[11px] font-medium text-slate-500">{detail}</div>
      {progress != null ? <div className="mt-3"><UiProgressBar value={progress} /></div> : null}
    </UiCard>
  );
}

function PrefixBreadcrumbs({ space, prefix }: { space: PortalWorkspaceSpace; prefix: string }) {
  const segments = prefix.split("/").filter(Boolean);
  let cursor = "";
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
      <Link to={storageSpacePath(space)} className="text-slate-500 hover:text-blue-700">
        Racine
      </Link>
      {segments.map((segment) => {
        cursor = `${cursor}${segment}/`;
        return (
          <span key={cursor} className="inline-flex items-center gap-2">
            <span className="text-slate-300">/</span>
            <Link to={prefixLink(space, cursor)} className="text-blue-700 hover:text-blue-800">
              {segment}
            </Link>
          </span>
        );
      })}
      {segments.length > 0 ? <span className="text-slate-300">/</span> : null}
    </div>
  );
}

function statusTone(space: PortalWorkspaceSpace) {
  if (space.status === "Attention") return "warning";
  if (space.status === "Shared") return "primary";
  return "success";
}

function nameFromPrefix(prefix: string): string {
  const normalized = prefix.replace(/\/$/, "");
  return normalized.split("/").filter(Boolean).at(-1) ?? prefix;
}

function formatObjectDate(raw?: string | null): string {
  if (!raw) return "-";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function filesFromListing(listing: PortalStorageObjectListing): PortalWorkspaceFile[] {
  const folders: PortalWorkspaceFile[] = listing.prefixes.map((prefix) => ({
    id: `prefix-${prefix}`,
    name: nameFromPrefix(prefix),
    kind: "folder",
    path: prefix,
    updatedLabel: "-",
    ownerLabel: "Workspace",
    typeLabel: "Dossier",
  }));
  const files: PortalWorkspaceFile[] = listing.objects.map((object) => ({
    id: `object-${object.key}`,
    name: object.name || nameFromPrefix(object.key),
    kind: "file",
    path: object.key,
    sizeBytes: object.size ?? null,
    updatedLabel: formatObjectDate(object.last_modified),
    ownerLabel: "Workspace",
    typeLabel: "Fichier",
  }));
  return [...folders, ...files];
}

export default function PortalStorageSpaceDetailPage() {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [showFolderForm, setShowFolderForm] = useState(false);
  const [folderNameValue, setFolderNameValue] = useState("");
  const [metadataName, setMetadataName] = useState("");
  const [metadataDescription, setMetadataDescription] = useState("");
  const [metadataBusy, setMetadataBusy] = useState(false);
  const [folderBusy, setFolderBusy] = useState(false);
  const [objectListing, setObjectListing] = useState<PortalStorageObjectListing | null>(null);
  const [objectsLoading, setObjectsLoading] = useState(false);
  const [objectsError, setObjectsError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { workspace, loading, error, hasAccountContext, accountError, accountLoading, accountIdForApi } = usePortalWorkspaceData();
  const decodedSpaceId = decodeRouteValue(spaceId);
  const space = workspace.spaces.find((item) => item.id === decodedSpaceId) ?? null;
  const currentPrefix = normalizePrefix(searchParams.get("prefix") ?? "");
  const normalizedQuery = query.trim().toLowerCase();

  useEffect(() => {
    let cancelled = false;
    if (!space || !accountIdForApi) {
      setObjectListing(null);
      setObjectsLoading(false);
      setObjectsError(null);
      return () => {
        cancelled = true;
      };
    }
    setObjectsLoading(true);
    setObjectsError(null);
    listPortalStorageSpaceObjects(accountIdForApi, space.id, { prefix: currentPrefix })
      .then((listing) => {
        if (!cancelled) setObjectListing(listing);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setObjectListing(null);
          setObjectsError(extractApiError(err, "Impossible de charger les objets de cet espace."));
        }
      })
      .finally(() => {
        if (!cancelled) setObjectsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, currentPrefix, refreshIndex, space]);

  useEffect(() => {
    if (!space) return;
    setMetadataName(space.name);
    setMetadataDescription(space.description);
  }, [space]);

  const childObjects = useMemo(() => {
    const source = objectListing ? filesFromListing(objectListing) : [];
    if (!normalizedQuery) return source;
    return source.filter((file) => file.name.toLowerCase().includes(normalizedQuery) || file.path.toLowerCase().includes(normalizedQuery));
  }, [normalizedQuery, objectListing]);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !space || !accountIdForApi) return;
    const transferId = startPortalTransfer({
      accountId: accountIdForApi,
      spaceId: space.id,
      spaceName: space.name,
      name: file.name,
      direction: "Upload",
      sizeBytes: file.size,
    });
    setUploading(true);
    setMessage(null);
    try {
      const result = await uploadPortalStorageSpaceObject(accountIdForApi, space.id, file, { prefix: currentPrefix });
      completePortalTransfer(transferId, result.key.split("/").filter(Boolean).at(-1) ?? result.key);
      setMessage(`${result.key} téléversé.`);
      setRefreshIndex((value) => value + 1);
    } catch (err) {
      console.error(err);
      const message = extractApiError(err, "Téléversement impossible pour cet espace.");
      failPortalTransfer(transferId, message);
      setMessage(message);
    } finally {
      setUploading(false);
    }
  };

  const handleCreateFolder = async () => {
    if (!space || !accountIdForApi || !folderNameValue.trim()) return;
    setFolderBusy(true);
    setMessage(null);
    try {
      const result = await createPortalStorageSpaceFolder(accountIdForApi, space.id, {
        prefix: currentPrefix,
        name: folderNameValue.trim(),
      });
      setFolderNameValue("");
      setShowFolderForm(false);
      setMessage(`${result.key} créé.`);
      setRefreshIndex((value) => value + 1);
    } catch (err) {
      console.error(err);
      setMessage(extractApiError(err, "Création du dossier impossible pour cet espace."));
    } finally {
      setFolderBusy(false);
    }
  };

  const handleSaveMetadata = async () => {
    if (!space || !accountIdForApi) return;
    setMetadataBusy(true);
    setMessage(null);
    try {
      await updatePortalStorageSpace(accountIdForApi, space.id, {
        name: metadataName.trim() || space.name,
        description: metadataDescription.trim() || null,
      });
      setMessage("Storage Space mis à jour.");
    } catch (err) {
      console.error(err);
      setMessage(extractApiError(err, "Mise à jour impossible pour cet espace."));
    } finally {
      setMetadataBusy(false);
    }
  };

  const handleArchive = async () => {
    if (!space || !accountIdForApi) return;
    if (!window.confirm(`Archiver ${space.name} ? Les objets ne seront pas supprimés.`)) return;
    setMetadataBusy(true);
    setMessage(null);
    try {
      await updatePortalStorageSpace(accountIdForApi, space.id, { archived: true });
      navigate("/portal/storage-spaces");
    } catch (err) {
      console.error(err);
      setMessage(extractApiError(err, "Archivage impossible pour cet espace."));
      setMetadataBusy(false);
    }
  };

  if (accountLoading || loading) {
    return <div className="space-y-4"><PageBanner tone="info">Loading storage space...</PageBanner></div>;
  }

  if (accountError || error) {
    return <div className="space-y-4"><PageBanner tone="error">{accountError ?? error}</PageBanner></div>;
  }

  if (!hasAccountContext || !space) {
    return <div className="space-y-4"><PageBanner tone="info">Storage space not available.</PageBanner></div>;
  }

  const fileEntries = childObjects.filter((file) => file.kind === "file");
  const totalFileBytes = fileEntries.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0);
  const averageFileSize = fileEntries.length > 0 ? totalFileBytes / fileEntries.length : null;
  const quotaPercent = space.quotaBytes && space.usedBytes ? Math.min(100, (space.usedBytes / space.quotaBytes) * 100) : null;
  const lastActivity = workspace.activity.find((item) => item.spaceId === space.id)?.actor ?? "-";

  return (
    <div className="space-y-4">
      <PageHeader
        title={space.name}
        description={`${space.description} Created ${space.createdLabel}. Region: ${space.region ?? "-"}.`}
        breadcrumbs={[{ label: "Portal" }, { label: "Storage Spaces", to: "/portal/storage-spaces" }, { label: space.name }]}
        inlineContent={<UiBadge tone={statusTone(space)}>{space.status}</UiBadge>}
        actions={[{ label: "Partager", to: "/portal/shares", variant: "secondary" }]}
      />

      {message ? <PageBanner tone="info">{message}</PageBanner> : null}
      {objectsError ? <PageBanner tone="warning">{objectsError}</PageBanner> : null}

      {space.role === "Owner" ? (
        <UiCard title="Storage Space details">
          <div className="grid gap-3 lg:grid-cols-[220px_1fr_auto_auto]">
            <input className="ui-control h-9 text-xs" value={metadataName} onChange={(event) => setMetadataName(event.target.value)} aria-label="Storage Space name" />
            <input className="ui-control h-9 text-xs" value={metadataDescription} onChange={(event) => setMetadataDescription(event.target.value)} aria-label="Storage Space description" />
            <UiButton disabled={metadataBusy} onClick={handleSaveMetadata} className="h-9 px-3 py-1.5">
              Save
            </UiButton>
            <UiButton variant="warning" disabled={metadataBusy} onClick={handleArchive} className="h-9 px-3 py-1.5">
              Archive
            </UiButton>
          </div>
        </UiCard>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ObjectMetricCard
          label="Utilisation"
          value={formatBytes(space.usedBytes)}
          detail={quotaPercent == null ? "Quota indisponible" : `sur ${formatBytes(space.quotaBytes)} (${Math.round(quotaPercent)}%)`}
          progress={quotaPercent ?? undefined}
        />
        <ObjectMetricCard label="Objets" value={formatCompactNumber(space.objectCount)} detail={space.objectCount == null ? "Indisponible" : "Suivi"} />
        <ObjectMetricCard label="Taille moyenne" value={formatBytes(averageFileSize)} detail="par objet" />
        <ObjectMetricCard label="Dernière activité" value={lastActivity === "-" ? "-" : "Récente"} detail={lastActivity === "-" ? "Aucune activité disponible" : `Par ${lastActivity}`} />
      </section>

      <UiCard>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelected} aria-label="Sélectionner un fichier à téléverser" />
            <UiButton onClick={handleUploadClick} disabled={uploading || !accountIdForApi} className="h-9 px-3 py-1.5">
              {uploading ? "Téléversement..." : "Téléverser"}
            </UiButton>
            <UiButton variant="secondary" onClick={() => setShowFolderForm((value) => !value)} disabled={!accountIdForApi || space.role === "Viewer"} className="h-9 px-3 py-1.5">
              Nouveau dossier
            </UiButton>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              type="search"
              className="ui-control h-9 w-full py-1.5 text-xs sm:w-64"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rechercher des objets..."
            />
            <HeaderIconButton label="Actualiser" onClick={() => setRefreshIndex((value) => value + 1)}>↻</HeaderIconButton>
          </div>
        </div>

        {showFolderForm ? (
          <div className="mb-4 grid gap-2 rounded-md border border-slate-100 bg-slate-50 p-3 sm:grid-cols-[1fr_auto]">
            <input className="ui-control h-9 text-xs" value={folderNameValue} onChange={(event) => setFolderNameValue(event.target.value)} placeholder="Nom du dossier" />
            <UiButton onClick={handleCreateFolder} disabled={!folderNameValue.trim() || folderBusy} className="h-9 px-3 py-1.5">
              {folderBusy ? "Création..." : "Créer"}
            </UiButton>
          </div>
        ) : null}

        <div className="mb-3">
          <PrefixBreadcrumbs space={space} prefix={currentPrefix} />
        </div>

        <div className="overflow-x-auto">
          <table className="ui-data-table min-w-[840px]">
            <thead>
              <tr>
                <th className="w-8"><input type="checkbox" aria-label="Select all objects" className="h-3.5 w-3.5 rounded border-slate-300" /></th>
                <th>Nom</th>
                <th>Type</th>
                <th>Taille</th>
                <th>Dernière modification</th>
                <th className="w-10 text-right"> </th>
              </tr>
            </thead>
            <tbody>
              {objectsLoading ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-xs font-semibold text-slate-500">
                    Chargement des objets...
                  </td>
                </tr>
              ) : null}
              {childObjects.map((file) => (
                <tr key={file.id}>
                  <td><input type="checkbox" aria-label={`Select ${file.name}`} className="h-3.5 w-3.5 rounded border-slate-300" /></td>
                  <td>
                    <div className="flex min-w-0 items-center gap-2">
                      <FileGlyph kind={file.kind} />
                      {file.kind === "folder" ? (
                        <Link to={prefixLink(space, file.path)} className="truncate font-bold text-slate-800 hover:text-blue-700">
                          {folderName(file)}
                        </Link>
                      ) : (
                        <Link to={storageSpaceObjectPath(space, file.path)} className="truncate font-bold text-slate-800 hover:text-blue-700">
                          {file.name}
                        </Link>
                      )}
                    </div>
                  </td>
                  <td>{file.typeLabel ?? (file.kind === "folder" ? "Dossier" : "Fichier")}</td>
                  <td>{file.kind === "folder" ? "-" : formatBytes(file.sizeBytes)}</td>
                  <td>{file.updatedLabel}</td>
                  <td className="text-right">
                    <button type="button" aria-label={`Actions ${file.name}`} className={tableIconActionButtonClasses}>
                      ⋮
                    </button>
                  </td>
                </tr>
              ))}
              {!objectsLoading && childObjects.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-xs font-semibold text-slate-500">
                    Aucun objet à afficher pour ce préfixe.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="mt-4 text-xs font-semibold text-slate-500">{childObjects.length} éléments</div>
      </UiCard>
    </div>
  );
}
