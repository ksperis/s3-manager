/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { downloadPortalStorageSpaceObject } from "../../api/portal";
import { extractApiError } from "../../utils/apiError";
import { formatBytes } from "../../utils/format";
import {
  storageSpacePath,
  type PortalWorkspaceFile,
  type PortalWorkspaceObjectDetail,
  type PortalWorkspaceSpace,
} from "./portalWorkspaceMockData";
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

function fallbackDetail(space: PortalWorkspaceSpace, file: PortalWorkspaceFile): PortalWorkspaceObjectDetail {
  return {
    name: file.name,
    path: file.path,
    sizeBytes: file.sizeBytes ?? 0,
    type: file.mimeType ?? "application/octet-stream",
    lastModified: file.updatedLabel,
    etag: "\"mocked-object-etag\"",
    storageClass: "STANDARD",
    encryption: "AES256 (SSE-S3)",
    objectUrl: `s3://${space.internalName}/${file.path}`,
    downloadUrl: `https://s3.example.com/${space.internalName}/${file.path}?download=1`,
    versions: [
      { id: "null (actuelle)", sizeBytes: file.sizeBytes ?? 0, lastModified: file.updatedLabel, actionLabel: "Actuelle", current: true },
      { id: "8d91fa...77c2", sizeBytes: file.sizeBytes ?? 0, lastModified: "Hier, 18:22:11", actionLabel: "Restaurer" },
    ],
    events: [
      { id: "downloaded", label: "Objet téléchargé", actor: "Alice", timeLabel: "Il y a 2 min" },
      { id: "shared", label: "Objet partagé", actor: "team", timeLabel: "Il y a 1 h" },
    ],
    previewLines: ["Aperçu mocké de l'objet sélectionné.", "Le contenu réel sera connecté aux APIs portail plus tard."],
  };
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

function QuickAction({ label, tone = "blue", onClick }: { label: string; tone?: "blue" | "rose"; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={tone === "rose" ? "text-left text-xs font-bold text-rose-600 hover:text-rose-700" : "text-left text-xs font-bold text-blue-700 hover:text-blue-800"}
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
  const { workspace, loading, error, hasAccountContext, accountError, accountLoading, accountIdForApi } = usePortalWorkspaceData();
  const decodedSpaceId = decodeRouteValue(params.spaceId);
  const objectPath = decodeObjectPath(params["*"]);
  const space = workspace.spaces.find((item) => item.id === decodedSpaceId) ?? workspace.spaces[0] ?? null;

  const { object, sourceFile } = useMemo(() => {
    if (!space) return { object: null, sourceFile: null };
    const file = space.files.find((item) => item.kind === "file" && item.path === objectPath) ?? space.files.find((item) => item.kind === "file") ?? null;
    if (!file) return { object: space.objectDetail, sourceFile: null };
    const detail = space.objectDetail.path === file.path ? space.objectDetail : fallbackDetail(space, file);
    return { object: detail, sourceFile: file };
  }, [objectPath, space]);

  if (accountLoading || loading) {
    return <PortalV3Page><div className="portal-v3-card p-6 text-sm font-semibold text-slate-600">Loading object...</div></PortalV3Page>;
  }

  if (accountError || error) {
    return <PortalV3Page><div className="portal-v3-card p-6 text-sm font-semibold text-rose-600">{accountError ?? error}</div></PortalV3Page>;
  }

  if (!hasAccountContext || !space || !object) {
    return <PortalV3Page><div className="portal-v3-card p-6 text-sm font-semibold text-slate-600">Object not available.</div></PortalV3Page>;
  }

  const displayPath = `s3://${space.internalName}/${object.path}`;
  const parentPrefix = object.path.split("/").slice(0, -1).join("/");
  const handleDownload = async () => {
    if (!accountIdForApi || downloading) return;
    const transferId = startPortalTransfer({
      accountId: accountIdForApi,
      spaceId: space.id,
      spaceName: space.name,
      name: object.name || objectName(object.path),
      direction: "Download",
      sizeBytes: object.sizeBytes,
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
        <div className="flex items-center gap-2">
          <input type="search" aria-label="Rechercher" placeholder="Rechercher..." className="h-8 w-52 rounded-md border border-slate-200 px-3 text-xs font-medium shadow-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100" />
          <button type="button" aria-label="Notifications" className="h-8 w-8 rounded-md border border-slate-200 bg-white text-xs font-bold text-slate-600 shadow-sm">!</button>
          <button type="button" aria-label="Aide" className="h-8 w-8 rounded-md border border-slate-200 bg-white text-xs font-bold text-slate-600 shadow-sm">?</button>
        </div>
      </div>

      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-4">
          <FileIcon />
          <div className="min-w-0">
            <h1 className="truncate text-[26px] font-bold leading-8 text-slate-950">{object.name || objectName(object.path)}</h1>
            <div className="mt-3 flex max-w-2xl items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
              <span className="min-w-0 flex-1 truncate">{displayPath}</span>
              <button type="button" className="shrink-0 text-blue-700">Copier</button>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handleDownload} disabled={!accountIdForApi || downloading} className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm hover:border-blue-200 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
            {downloading ? "Téléchargement..." : "Télécharger"}
          </button>
          <button type="button" className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm hover:border-blue-200 hover:text-blue-700">
            Partager
          </button>
          <button type="button" className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm hover:border-blue-200 hover:text-blue-700">
            Actions <span className="ml-2 text-slate-400">⌄</span>
          </button>
        </div>
      </header>

      {downloadMessage ? (
        <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">
          {downloadMessage}
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
        </PortalV3Card>

        <PortalV3Card title="Actions rapides">
          <div className="grid gap-4">
            <QuickAction label="Télécharger" onClick={handleDownload} />
            <QuickAction label="Obtenir le lien de l'objet" />
            <QuickAction label="Copier le chemin" />
            <QuickAction label="Partager cet objet" />
            <QuickAction label="Supprimer l'objet" tone="rose" />
          </div>
        </PortalV3Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_300px]">
        <PortalV3Card title="Aperçu rapide">
          <pre className="min-h-28 overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-[11px] leading-5 text-slate-500">{object.previewLines.join("\n")}</pre>
          <div className="mt-3 text-right text-xs font-bold text-blue-700">
            <Link to={`${storageSpacePath(space)}?prefix=${encodeURIComponent(parentPrefix ? `${parentPrefix}/` : "")}`}>
              Ouvrir dans la liste
            </Link>
          </div>
        </PortalV3Card>

        <PortalV3Card title="Événements récents">
          <div className="grid gap-4">
            {object.events.map((event) => (
              <div key={event.id} className="grid grid-cols-[1fr_auto] gap-3 text-xs">
                <div>
                  <div className="font-bold text-slate-900">{event.label}</div>
                  <div className="mt-1 text-[11px] font-medium text-slate-500">par {event.actor}</div>
                </div>
                <div className="text-[11px] font-semibold text-slate-400">{event.timeLabel}</div>
              </div>
            ))}
          </div>
          {sourceFile ? <div className="mt-4 text-[11px] font-semibold text-slate-400">Objet source: {sourceFile.name}</div> : null}
        </PortalV3Card>
      </section>
    </PortalV3Page>
  );
}
