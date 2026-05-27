/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  listPortalStorageSpaceObjects,
  uploadPortalStorageSpaceObject,
  type PortalStorageObjectListing,
} from "../../api/portal";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import {
  storageSpaceObjectPath,
  storageSpacePath,
  type PortalWorkspaceFile,
  type PortalWorkspaceSpace,
} from "./portalWorkspaceMockData";
import { PortalV3Badge, PortalV3Card, PortalV3Page, PortalV3Progress, PortalV3Search } from "./PortalV3Components";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

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

function objectParent(path: string): string {
  const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
  const index = normalized.lastIndexOf("/");
  return index < 0 ? "" : `${normalized.slice(0, index)}/`;
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
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-xs font-bold text-slate-600 shadow-sm hover:border-blue-200 hover:text-blue-700"
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
    <div className="portal-v3-card px-4 py-3">
      <div className="text-[11px] font-semibold text-slate-500">{label}</div>
      <div className="mt-2 text-[20px] font-bold leading-6 text-slate-950">{value}</div>
      <div className="mt-1 text-[11px] font-medium text-slate-500">{detail}</div>
      {progress != null ? <div className="mt-3"><PortalV3Progress value={progress} /></div> : null}
    </div>
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
  if (space.status === "Attention") return "amber";
  if (space.status === "Shared") return "blue";
  return "green";
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
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [objectListing, setObjectListing] = useState<PortalStorageObjectListing | null>(null);
  const [objectsLoading, setObjectsLoading] = useState(false);
  const [objectsError, setObjectsError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { workspace, loading, error, hasAccountContext, accountError, accountLoading, accountIdForApi } = usePortalWorkspaceData();
  const decodedSpaceId = decodeRouteValue(spaceId);
  const space = workspace.spaces.find((item) => item.id === decodedSpaceId) ?? workspace.spaces[0] ?? null;
  const currentPrefix = normalizePrefix(searchParams.get("prefix") ?? space?.defaultPrefix ?? "");
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

  const mockChildObjects = useMemo(() => {
    if (!space) return [];
    return space.files
      .filter((file) => objectParent(file.path) === currentPrefix)
      .filter((file) => {
        if (!normalizedQuery) return true;
        return file.name.toLowerCase().includes(normalizedQuery) || file.path.toLowerCase().includes(normalizedQuery);
      });
  }, [currentPrefix, normalizedQuery, space]);

  const childObjects = useMemo(() => {
    const source = objectListing ? filesFromListing(objectListing) : mockChildObjects;
    if (!normalizedQuery) return source;
    return source.filter((file) => file.name.toLowerCase().includes(normalizedQuery) || file.path.toLowerCase().includes(normalizedQuery));
  }, [mockChildObjects, normalizedQuery, objectListing]);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !space || !accountIdForApi) return;
    setUploading(true);
    setMessage(null);
    try {
      const result = await uploadPortalStorageSpaceObject(accountIdForApi, space.id, file, { prefix: currentPrefix });
      setMessage(`${result.key} téléversé.`);
      setRefreshIndex((value) => value + 1);
    } catch (err) {
      console.error(err);
      setMessage(extractApiError(err, "Téléversement impossible pour cet espace."));
    } finally {
      setUploading(false);
    }
  };

  if (accountLoading || loading) {
    return <PortalV3Page><div className="portal-v3-card p-6 text-sm font-semibold text-slate-600">Loading storage space...</div></PortalV3Page>;
  }

  if (accountError || error) {
    return <PortalV3Page><div className="portal-v3-card p-6 text-sm font-semibold text-rose-600">{accountError ?? error}</div></PortalV3Page>;
  }

  if (!hasAccountContext || !space) {
    return <PortalV3Page><div className="portal-v3-card p-6 text-sm font-semibold text-slate-600">Storage space not available.</div></PortalV3Page>;
  }

  const fileEntries = space.files.filter((file) => file.kind === "file");
  const totalFileBytes = fileEntries.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0);
  const averageFileSize = fileEntries.length > 0 ? totalFileBytes / fileEntries.length : null;
  const quotaPercent = space.quotaBytes && space.usedBytes ? Math.min(100, (space.usedBytes / space.quotaBytes) * 100) : 34;
  const lastActivity = workspace.activity.find((item) => item.spaceId === space.id)?.actor ?? "Alice";

  return (
    <PortalV3Page>
      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white px-5 py-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
          <Link to="/portal/storage-spaces" className="text-blue-700 hover:text-blue-800">
            Storage Spaces
          </Link>
          <span className="text-slate-300">›</span>
          <span className="text-slate-700">{space.name}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PortalV3Search value={query} onChange={setQuery} placeholder="Rechercher..." className="w-full sm:w-56" />
          <HeaderIconButton label="Notifications">!</HeaderIconButton>
          <HeaderIconButton label="Aide">?</HeaderIconButton>
          <HeaderIconButton label="Preferences">*</HeaderIconButton>
        </div>
      </div>

      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[26px] font-bold leading-8 text-slate-950">{space.name}</h1>
            <PortalV3Badge tone={statusTone(space)}>{space.status}</PortalV3Badge>
          </div>
          <p className="mt-2 text-xs font-medium text-slate-500">
            Créé le {space.createdLabel} <span className="px-2 text-slate-300">•</span> Région: {space.region}{" "}
            <span className="px-2 text-slate-300">•</span> Standard
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm hover:border-blue-200 hover:text-blue-700">
            Partager
          </button>
          <button type="button" className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm hover:border-blue-200 hover:text-blue-700">
            Actions
            <span className="ml-2 text-slate-400">⌄</span>
          </button>
        </div>
      </header>

      {message ? <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">{message}</div> : null}
      {objectsError ? (
        <div className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
          {objectsError} Données de prévisualisation affichées.
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ObjectMetricCard label="Utilisation" value={formatBytes(space.usedBytes)} detail={`sur ${formatBytes(space.quotaBytes ?? 10 * 1024 ** 4)} (${Math.round(quotaPercent)}%)`} progress={quotaPercent} />
        <ObjectMetricCard label="Objets" value={formatCompactNumber(space.objectCount)} detail="+47,342 cette semaine" />
        <ObjectMetricCard label="Taille moyenne" value={formatBytes(averageFileSize)} detail="par objet" />
        <ObjectMetricCard label="Dernière activité" value="Il y a 2 min" detail={`Par ${lastActivity}`} />
      </section>

      <PortalV3Card>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelected} aria-label="Sélectionner un fichier à téléverser" />
            <button type="button" onClick={handleUploadClick} disabled={uploading || !accountIdForApi} className="inline-flex h-9 items-center justify-center rounded-md border border-blue-600 bg-blue-600 px-3 text-xs font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
              {uploading ? "Téléversement..." : "Téléverser"}
            </button>
            <button type="button" onClick={() => setMessage("Création de dossier mockée pour cette prévisualisation UX.")} className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm hover:border-blue-200 hover:text-blue-700">
              + Nouveau dossier
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <PortalV3Search value={query} onChange={setQuery} placeholder="Rechercher des objets..." className="w-full sm:w-64" />
            <HeaderIconButton label="Filtrer">≡</HeaderIconButton>
            <HeaderIconButton label="Actualiser" onClick={() => setRefreshIndex((value) => value + 1)}>↻</HeaderIconButton>
          </div>
        </div>

        <div className="mb-3">
          <PrefixBreadcrumbs space={space} prefix={currentPrefix} />
        </div>

        <div className="overflow-x-auto">
          <table className="portal-v3-table min-w-[840px]">
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
                    <button type="button" aria-label={`Actions ${file.name}`} className="rounded px-2 py-1 text-lg leading-none text-slate-500 hover:bg-slate-50 hover:text-slate-800">
                      ⋮
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 text-xs font-semibold text-slate-500">{childObjects.length} éléments</div>
      </PortalV3Card>
    </PortalV3Page>
  );
}
