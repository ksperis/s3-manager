/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  downloadPortalStorageSpaceObject,
  listPortalStorageSpaceObjects,
  type PortalStorageObject,
  type PortalStorageObjectListing,
} from "../../api/portal";
import { extractApiError } from "../../utils/apiError";
import { formatBytes } from "../../utils/format";
import {
  storageSpacePath,
  type PortalWorkspaceSpace,
} from "./portalWorkspaceModel";
import { PortalV3Card, PortalV3Page } from "./PortalV3Components";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";
import { completePortalTransfer, failPortalTransfer, startPortalTransfer } from "./portalTransferTracker";

const tabs = ["Aperçu", "Détails", "Événements"];

function decodeRouteValue(value?: string): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function decodeObjectPath(value?: string): string {
  if (!value) return "";
  return value
    .split("/")
    .map((part) => decodeRouteValue(part))
    .join("/");
}

function objectName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.at(-1) ?? path;
}

function parentPrefix(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.length > 0 ? `${parts.join("/")}/` : "";
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

function objectFromListing(path: string, listing: PortalStorageObjectListing | null): PortalStorageObject | null {
  return listing?.objects.find((item) => item.key === path) ?? null;
}

function Breadcrumbs({ space, objectPath }: { space: PortalWorkspaceSpace; objectPath: string }) {
  const segments = objectPath.split("/").filter(Boolean);
  let cursor = "";
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
      <Link to="/portal/storage-spaces" className="text-blue-700 hover:text-blue-800">
        Storage Spaces
      </Link>
      <span className="text-slate-300">›</span>
      <Link to={storageSpacePath(space)} className="text-blue-700 hover:text-blue-800">
        {space.name}
      </Link>
      {segments.map((segment, index) => {
        cursor = `${cursor}${segment}/`;
        const isLast = index === segments.length - 1;
        return (
          <span key={`${cursor}-${index}`} className="inline-flex items-center gap-2">
            <span className="text-slate-300">›</span>
            {isLast ? (
              <span className="text-slate-700">{segment}</span>
            ) : (
              <Link to={`${storageSpacePath(space)}?prefix=${encodeURIComponent(cursor)}`} className="text-blue-700 hover:text-blue-800">
                {segment}
              </Link>
            )}
          </span>
        );
      })}
    </div>
  );
}

function FileIcon() {
  return (
    <span className="inline-flex h-14 w-12 items-center justify-center rounded-md border border-slate-300 bg-slate-50 text-slate-600 shadow-sm">
      <svg viewBox="0 0 24 28" aria-hidden="true" className="h-9 w-8">
        <path d="M5 2.5h9l5 5V25.5H5V2.5Z" fill="white" stroke="currentColor" strokeWidth="1.6" />
        <path d="M14 2.5v5h5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 18h8" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </span>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-4 text-xs">
      <dt className="font-semibold text-slate-500">{label}</dt>
      <dd className="min-w-0 truncate font-bold text-slate-800">{value}</dd>
    </div>
  );
}

function QuickAction({
  label,
  tone = "blue",
  onClick,
  disabled = false,
}: {
  label: string;
  tone?: "blue" | "rose";
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        disabled
          ? "cursor-not-allowed text-left text-xs font-bold text-slate-400"
          : tone === "rose"
            ? "text-left text-xs font-bold text-rose-600 hover:text-rose-700"
            : "text-left text-xs font-bold text-blue-700 hover:text-blue-800"
      }
    >
      {label}
    </button>
  );
}

export default function PortalObjectDetailPage() {
  const params = useParams();
  const [activeTab, setActiveTab] = useState("Aperçu");
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [objectListing, setObjectListing] = useState<PortalStorageObjectListing | null>(null);
  const [objectLoading, setObjectLoading] = useState(false);
  const [objectError, setObjectError] = useState<string | null>(null);
  const { workspace, loading, error, hasAccountContext, accountError, accountLoading, accountIdForApi } = usePortalWorkspaceData();
  const decodedSpaceId = decodeRouteValue(params.spaceId);
  const objectPath = decodeObjectPath(params["*"]);
  const space = workspace.spaces.find((item) => item.id === decodedSpaceId) ?? null;
  const objectPrefix = parentPrefix(objectPath);

  useEffect(() => {
    let cancelled = false;
    if (!space || !accountIdForApi || !objectPath) {
      setObjectListing(null);
      setObjectLoading(false);
      setObjectError(null);
      return () => {
        cancelled = true;
      };
    }
    setObjectLoading(true);
    setObjectError(null);
    listPortalStorageSpaceObjects(accountIdForApi, space.id, { prefix: objectPrefix })
      .then((listing) => {
        if (!cancelled) setObjectListing(listing);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setObjectListing(null);
          setObjectError(extractApiError(err, "Impossible de charger les métadonnées de cet objet."));
        }
      })
      .finally(() => {
        if (!cancelled) setObjectLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, objectPath, objectPrefix, space]);

  const listedObject = useMemo(() => objectFromListing(objectPath, objectListing), [objectListing, objectPath]);
  const object = useMemo(
    () => ({
      name: listedObject?.name || objectName(objectPath),
      path: listedObject?.key || objectPath,
      sizeBytes: listedObject?.size ?? null,
      type: "Unavailable",
      lastModified: formatObjectDate(listedObject?.last_modified),
    }),
    [listedObject, objectPath]
  );

  if (accountLoading || loading) {
    return <PortalV3Page><div className="portal-v3-card p-6 text-sm font-semibold text-slate-600">Loading object...</div></PortalV3Page>;
  }

  if (accountError || error) {
    return <PortalV3Page><div className="portal-v3-card p-6 text-sm font-semibold text-rose-600">{accountError ?? error}</div></PortalV3Page>;
  }

  if (!hasAccountContext || !space || !objectPath) {
    return <PortalV3Page><div className="portal-v3-card p-6 text-sm font-semibold text-slate-600">Object not available.</div></PortalV3Page>;
  }

  const displayPath = object.path;
  const parentPath = object.path.split("/").slice(0, -1).join("/");
  const copyPath = async () => {
    if (!navigator.clipboard) {
      setDownloadMessage("Copie indisponible dans ce navigateur.");
      return;
    }
    try {
      await navigator.clipboard.writeText(object.path);
      setDownloadMessage("Chemin copié.");
    } catch {
      setDownloadMessage("Copie indisponible dans ce navigateur.");
    }
  };
  const handleDownload = async () => {
    if (!accountIdForApi || downloading) return;
    const transferId = startPortalTransfer({
      accountId: accountIdForApi,
      spaceId: space.id,
      spaceName: space.name,
      name: object.name || objectName(object.path),
      direction: "Download",
      sizeBytes: object.sizeBytes ?? undefined,
    });
    setDownloading(true);
    setDownloadMessage(null);
    try {
      const result = await downloadPortalStorageSpaceObject(accountIdForApi, space.id, object.path);
      completePortalTransfer(transferId, result.filename);
      const href = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
      setDownloadMessage(`${result.filename} téléchargé.`);
    } catch (err) {
      console.error(err);
      const message = extractApiError(err, "Téléchargement impossible pour cet objet.");
      failPortalTransfer(transferId, message);
      setDownloadMessage(message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <PortalV3Page>
      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white px-5 py-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <Breadcrumbs space={space} objectPath={object.path} />
      </div>

      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-4">
          <FileIcon />
          <div className="min-w-0">
            <h1 className="truncate text-[26px] font-bold leading-8 text-slate-950">{object.name || objectName(object.path)}</h1>
            <div className="mt-3 flex max-w-2xl items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
              <span className="min-w-0 flex-1 truncate">{displayPath}</span>
              <button type="button" onClick={copyPath} className="shrink-0 text-blue-700">Copier</button>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handleDownload} disabled={!accountIdForApi || downloading} className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm hover:border-blue-200 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
            {downloading ? "Téléchargement..." : "Télécharger"}
          </button>
          <button type="button" disabled className="inline-flex h-9 cursor-not-allowed items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-slate-400 shadow-sm">
            Partager
          </button>
        </div>
      </header>

      {downloadMessage ? (
        <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">
          {downloadMessage}
        </div>
      ) : null}
      {objectError ? (
        <div className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
          {objectError}
        </div>
      ) : null}

      <div className="portal-v3-card px-4">
        <div className="flex gap-7 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={activeTab === tab ? "portal-v3-tab portal-v3-tab-active" : "portal-v3-tab"}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <section className="grid gap-4 xl:grid-cols-[1fr_300px]">
        <PortalV3Card title="Informations générales">
          <dl className="grid gap-4">
            <DetailRow label="Taille" value={formatBytes(object.sizeBytes)} />
            <DetailRow label="Type de contenu" value={object.type} />
            <DetailRow label="Dernière modification" value={object.lastModified} />
            <DetailRow label="Chemin" value={object.path} />
          </dl>
          {objectLoading ? <div className="mt-4 text-[11px] font-semibold text-slate-400">Chargement des métadonnées...</div> : null}
        </PortalV3Card>

        <PortalV3Card title="Actions rapides">
          <div className="grid gap-4">
            <QuickAction label="Télécharger" onClick={handleDownload} />
            <QuickAction label="Obtenir le lien de l'objet" disabled />
            <QuickAction label="Copier le chemin" onClick={copyPath} />
            <QuickAction label="Partager cet objet" disabled />
            <QuickAction label="Supprimer l'objet" tone="rose" disabled />
          </div>
        </PortalV3Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_300px]">
        <PortalV3Card title="Aperçu rapide">
          <div className="min-h-28 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs font-semibold leading-5 text-slate-500">
            Aperçu indisponible pour cet objet.
          </div>
          <div className="mt-3 text-right text-xs font-bold text-blue-700">
            <Link to={`${storageSpacePath(space)}?prefix=${encodeURIComponent(parentPath ? `${parentPath}/` : "")}`}>
              Ouvrir dans la liste
            </Link>
          </div>
        </PortalV3Card>

        <PortalV3Card title="Événements récents">
          <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-6 text-center text-xs font-semibold text-slate-500">
            Aucun événement objet disponible.
          </div>
        </PortalV3Card>
      </section>
    </PortalV3Page>
  );
}
