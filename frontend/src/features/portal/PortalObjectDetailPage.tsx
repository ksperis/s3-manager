/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  createPortalStorageSpacePublicLink,
  deletePortalStorageSpaceObject,
  downloadPortalStorageSpaceObject,
  fetchPortalStorageSpaceObjectDetail,
  listPortalStorageSpacePublicLinks,
  revokePortalStorageSpacePublicLink,
  type PortalPublicLink,
  type PortalStorageObjectDetail,
} from "../../api/portal";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import PageTabs from "../../components/PageTabs";
import { tableDeleteActionClasses } from "../../components/tableActionClasses";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import { cx, uiCardMutedClass, uiDividerClass, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { formatBytes } from "../../utils/format";
import {
  storageSpacePath,
  type PortalWorkspaceSpace,
} from "./portalWorkspaceModel";
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

function FileIcon() {
  return (
    <span className="inline-flex h-14 w-12 items-center justify-center rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] text-[var(--ui-text-muted)] shadow-[var(--ui-shadow-soft)]">
      <svg viewBox="0 0 24 28" aria-hidden="true" className="h-9 w-8">
        <path d="M5 2.5h9l5 5V25.5H5V2.5Z" fill="var(--ui-surface)" stroke="currentColor" strokeWidth="1.6" />
        <path d="M14 2.5v5h5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 18h8" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </span>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-4 text-xs">
      <dt className={cx("font-semibold", uiMutedTextClass)}>{label}</dt>
      <dd className={cx("min-w-0 truncate font-bold", uiTitleTextClass)}>{value}</dd>
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
          ? cx("cursor-not-allowed text-left text-xs font-bold", uiMutedTextClass)
          : tone === "rose"
            ? "text-left text-xs font-bold text-rose-600 hover:text-rose-700 dark:text-rose-300 dark:hover:text-rose-200"
            : "text-left text-xs font-bold text-primary hover:text-primary-600 dark:text-primary-200 dark:hover:text-primary-100"
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
  const [objectDetail, setObjectDetail] = useState<PortalStorageObjectDetail | null>(null);
  const [publicLinks, setPublicLinks] = useState<PortalPublicLink[]>([]);
  const [linkExpiration, setLinkExpiration] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [objectLoading, setObjectLoading] = useState(false);
  const [objectError, setObjectError] = useState<string | null>(null);
  const { workspace, loading, error, hasAccountContext, accountError, accountLoading, accountIdForApi } = usePortalWorkspaceData();
  const decodedSpaceId = decodeRouteValue(params.spaceId);
  const objectPath = decodeObjectPath(params["*"]);
  const space = workspace.spaces.find((item) => item.id === decodedSpaceId) ?? null;

  useEffect(() => {
    let cancelled = false;
    if (!space || !accountIdForApi || !objectPath) {
      setObjectDetail(null);
      setObjectLoading(false);
      setObjectError(null);
      return () => {
        cancelled = true;
      };
    }
    setObjectLoading(true);
    setObjectError(null);
    Promise.all([
      fetchPortalStorageSpaceObjectDetail(accountIdForApi, space.id, objectPath),
      space.role === "Owner"
        ? listPortalStorageSpacePublicLinks(accountIdForApi, space.id, { objectKey: objectPath, includeRevoked: true })
        : Promise.resolve([] as PortalPublicLink[]),
    ])
      .then(([detail, links]) => {
        if (!cancelled) {
          setObjectDetail(detail);
          setPublicLinks(links);
        }
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setObjectDetail(null);
          setPublicLinks([]);
          setObjectError(extractApiError(err, "Impossible de charger les métadonnées de cet objet."));
        }
      })
      .finally(() => {
        if (!cancelled) setObjectLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, objectPath, space]);

  const object = useMemo(
    () => ({
      name: objectDetail?.name || objectName(objectPath),
      path: objectDetail?.key || objectPath,
      sizeBytes: objectDetail?.size ?? null,
      type: objectDetail?.content_type ?? "Unavailable",
      storageClass: objectDetail?.storage_class ?? "STANDARD",
      encryption: objectDetail?.encryption ?? "-",
      lastModified: formatObjectDate(objectDetail?.last_modified),
      previewType: objectDetail?.preview_type ?? "unavailable",
      previewText: objectDetail?.preview_text ?? null,
      previewUnavailableReason: objectDetail?.preview_unavailable_reason ?? "Preview unavailable.",
    }),
    [objectDetail, objectPath]
  );

  if (accountLoading || loading) {
    return <div className="space-y-4"><PageBanner tone="info">Loading object...</PageBanner></div>;
  }

  if (accountError || error) {
    return <div className="space-y-4"><PageBanner tone="error">{accountError ?? error}</PageBanner></div>;
  }

  if (!hasAccountContext || !space || !objectPath) {
    return <div className="space-y-4"><PageBanner tone="info">Object not available.</PageBanner></div>;
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
  const handleCreatePublicLink = async () => {
    if (!accountIdForApi || !space || linkBusy) return;
    setLinkBusy(true);
    setDownloadMessage(null);
    try {
      const link = await createPortalStorageSpacePublicLink(accountIdForApi, space.id, {
        object_key: object.path,
        label: object.name,
        expires_at: linkExpiration ? new Date(linkExpiration).toISOString() : null,
      });
      setPublicLinks((current) => [link, ...current.filter((item) => item.id !== link.id)]);
      setDownloadMessage("Lien public créé.");
    } catch (err) {
      console.error(err);
      setDownloadMessage(extractApiError(err, "Création du lien public impossible."));
    } finally {
      setLinkBusy(false);
    }
  };
  const handleRevokePublicLink = async (link: PortalPublicLink) => {
    if (!accountIdForApi || !space || linkBusy) return;
    if (!window.confirm(`Révoquer le lien public pour ${link.object_name} ?`)) return;
    setLinkBusy(true);
    setDownloadMessage(null);
    try {
      const links = await revokePortalStorageSpacePublicLink(accountIdForApi, space.id, link.id);
      setPublicLinks(links);
      setDownloadMessage("Lien public révoqué.");
    } catch (err) {
      console.error(err);
      setDownloadMessage(extractApiError(err, "Révocation du lien public impossible."));
    } finally {
      setLinkBusy(false);
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
  const handleDelete = async () => {
    if (!accountIdForApi || !space || deleteBusy) return;
    if (!window.confirm(`Supprimer ${object.name} ? Cette action est définitive.`)) return;
    setDeleteBusy(true);
    setDownloadMessage(null);
    try {
      await deletePortalStorageSpaceObject(accountIdForApi, space.id, object.path);
      setDownloadMessage(`${object.name} supprimé.`);
      window.setTimeout(() => {
        window.location.href = `${storageSpacePath(space)}?prefix=${encodeURIComponent(parentPath ? `${parentPath}/` : "")}`;
      }, 250);
    } catch (err) {
      console.error(err);
      setDownloadMessage(extractApiError(err, "Suppression impossible pour cet objet."));
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={object.name || objectName(object.path)}
        description={object.path}
        breadcrumbs={[
          { label: "Portal" },
          { label: "Storage Spaces", to: "/portal/storage-spaces" },
          { label: space.name, to: storageSpacePath(space) },
          { label: object.name || objectName(object.path) },
        ]}
        actions={[
          { label: downloading ? "Téléchargement..." : "Télécharger", onClick: handleDownload, variant: "secondary", disabled: !accountIdForApi || downloading },
          { label: linkBusy ? "Partage..." : "Partager", onClick: handleCreatePublicLink, variant: "secondary", disabled: !accountIdForApi || space.role !== "Owner" || linkBusy },
        ]}
      />

      <UiCard>
        <div className="flex min-w-0 gap-4">
          <FileIcon />
          <div className="min-w-0">
            <p className={cx("ui-body font-semibold", uiTitleTextClass)}>{object.name || objectName(object.path)}</p>
            <div className={cx(uiCardMutedClass, "mt-3 flex max-w-2xl items-center gap-2 px-3 py-2 text-xs font-semibold", uiMutedTextClass)}>
              <span className="min-w-0 flex-1 truncate">{displayPath}</span>
              <button type="button" onClick={copyPath} className="shrink-0 text-primary hover:text-primary-600 dark:text-primary-200 dark:hover:text-primary-100">Copier</button>
            </div>
          </div>
        </div>
      </UiCard>

      {downloadMessage ? <PageBanner tone="info">{downloadMessage}</PageBanner> : null}
      {objectError ? <PageBanner tone="warning">{objectError}</PageBanner> : null}

      <div className={cx("border-b pb-3", uiDividerClass)}>
        <PageTabs tabs={tabs.map((tab) => ({ id: tab, label: tab }))} activeTab={activeTab} onChange={setActiveTab} variant="bar" />
      </div>

      <section className="grid gap-4 xl:grid-cols-[1fr_300px]">
        <UiCard title="Informations générales">
          <dl className="grid gap-4">
            <DetailRow label="Taille" value={formatBytes(object.sizeBytes)} />
            <DetailRow label="Type de contenu" value={object.type} />
            <DetailRow label="Dernière modification" value={object.lastModified} />
            <DetailRow label="Storage class" value={object.storageClass} />
            <DetailRow label="Chiffrement" value={object.encryption} />
            <DetailRow label="Chemin" value={object.path} />
          </dl>
          {objectLoading ? <div className={cx("mt-4 text-[11px] font-semibold", uiMutedTextClass)}>Chargement des métadonnées...</div> : null}
        </UiCard>

        <UiCard title="Actions rapides">
          <div className="grid gap-4">
            <QuickAction label="Télécharger" onClick={handleDownload} />
            <QuickAction label="Obtenir le lien public" onClick={handleCreatePublicLink} disabled={space.role !== "Owner" || linkBusy} />
            <QuickAction label="Copier le chemin" onClick={copyPath} />
            <QuickAction label="Partager cet objet" onClick={handleCreatePublicLink} disabled={space.role !== "Owner" || linkBusy} />
            <QuickAction label={deleteBusy ? "Suppression..." : "Supprimer l'objet"} tone="rose" onClick={handleDelete} disabled={space.role === "Viewer" || deleteBusy} />
          </div>
        </UiCard>
      </section>

      {space.role === "Owner" ? (
        <UiCard title="Liens publics">
          <div className="mb-3 grid gap-2 sm:grid-cols-[220px_auto]">
            <input
              type="datetime-local"
              className="ui-control h-9 text-xs"
              value={linkExpiration}
              onChange={(event) => setLinkExpiration(event.target.value)}
              aria-label="Expiration du lien public"
            />
            <UiButton onClick={handleCreatePublicLink} disabled={linkBusy} className="h-9 px-3 py-1.5">
              {linkBusy ? "Création..." : "Créer un lien"}
            </UiButton>
          </div>
          <div className="overflow-x-auto">
            <table className="ui-data-table min-w-[760px]">
              <thead>
                <tr>
                  <th>Objet</th>
                  <th>Statut</th>
                  <th>Expiration</th>
                  <th>Lien</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {publicLinks.map((link) => (
                  <tr key={link.id}>
                    <td className={cx("font-bold", uiTitleTextClass)}>{link.object_name}</td>
                    <td><UiBadge tone={link.status === "Active" ? "success" : "neutral"}>{link.status}</UiBadge></td>
                    <td>{link.expires_at ? formatObjectDate(link.expires_at) : "-"}</td>
                    <td className="max-w-[260px] truncate text-primary dark:text-primary-200">{link.url}</td>
                    <td className="text-right">
                      {link.status === "Active" ? (
                        <button type="button" onClick={() => handleRevokePublicLink(link)} className={tableDeleteActionClasses}>
                          Revoke
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {publicLinks.length === 0 ? (
                  <tr>
                    <td colSpan={5} className={cx("py-5 text-center text-xs font-semibold", uiMutedTextClass)}>
                      Aucun lien public pour cet objet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </UiCard>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[1fr_300px]">
        <UiCard title="Aperçu rapide">
          {object.previewType === "text" && object.previewText ? (
            <pre className="max-h-72 overflow-auto rounded-md border border-[color:var(--ui-border)] bg-slate-950 p-3 text-xs leading-5 text-slate-50">{object.previewText}</pre>
          ) : (
            <div className={cx(uiCardMutedClass, "min-h-28 p-3 text-xs font-semibold leading-5", uiMutedTextClass)}>
              {object.previewUnavailableReason}
            </div>
          )}
          <div className="mt-3 text-right text-xs font-bold">
            <Link to={`${storageSpacePath(space)}?prefix=${encodeURIComponent(parentPath ? `${parentPath}/` : "")}`}>
              Ouvrir dans la liste
            </Link>
          </div>
        </UiCard>

        <UiCard title="Événements récents">
          <div className="grid gap-2">
            {workspace.activity.filter((item) => item.target === object.name || item.target === object.path).slice(0, 4).map((item) => (
              <div key={item.id} className={cx(uiCardMutedClass, "px-3 py-2 text-xs")}>
                <div className={cx("font-bold", uiTitleTextClass)}>{item.action}</div>
                <div className={cx("mt-1", uiMutedTextClass)}>{item.actor} · {item.timeLabel}</div>
              </div>
            ))}
            {workspace.activity.filter((item) => item.target === object.name || item.target === object.path).length === 0 ? (
              <div className={cx(uiCardMutedClass, "px-3 py-6 text-center text-xs font-semibold", uiMutedTextClass)}>
                Aucun événement objet disponible.
              </div>
            ) : null}
          </div>
        </UiCard>
      </section>
    </div>
  );
}
