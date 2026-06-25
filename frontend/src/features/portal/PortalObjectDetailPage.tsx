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
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import PageTabs from "../../components/PageTabs";
import { tableDeleteActionClasses } from "../../components/tableActionClasses";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import { cx, uiCardMutedClass, uiDividerClass, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { formatBytes } from "../../utils/format";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import { storageSpacePath } from "./portalWorkspaceModel";
import {
  PortalPageState,
  resolvePortalWorkspacePageState,
} from "./portalUi";
import { portalDateTimeLabel, portalPublicLinkStatusLabel } from "./portalI18n";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";
import { completePortalTransfer, failPortalTransfer, startPortalTransfer } from "./portalTransferTracker";

type ObjectTab = "preview" | "details" | "events";

type PendingObjectAction =
  | { type: "delete-object" }
  | { type: "revoke-public-link"; link: PortalPublicLink };

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
  reason,
}: {
  label: string;
  tone?: "blue" | "rose";
  onClick?: () => void;
  disabled?: boolean;
  reason?: string | null;
}) {
  return (
    <div className="grid gap-1">
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
      {disabled && reason ? <span className={cx("text-[11px] font-medium leading-4", uiMutedTextClass)}>{reason}</span> : null}
    </div>
  );
}

export default function PortalObjectDetailPage() {
  const { locale, t } = useI18n();
  const params = useParams();
  const [activeTab, setActiveTab] = useState<ObjectTab>("preview");
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [objectDetail, setObjectDetail] = useState<PortalStorageObjectDetail | null>(null);
  const [publicLinks, setPublicLinks] = useState<PortalPublicLink[]>([]);
  const [linkExpiration, setLinkExpiration] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingObjectAction | null>(null);
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
      space.role === "Owner" && space.visibility === "shared" && space.status !== "Archived"
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
          setObjectError(extractApiError(err, t({ en: "Unable to load object metadata.", fr: "Impossible de charger les métadonnées de l'objet.", de: "Objektmetadaten können nicht geladen werden." })));
        }
      })
      .finally(() => {
        if (!cancelled) setObjectLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, objectPath, space, t]);

  const object = useMemo(
    () => ({
      name: objectDetail?.name || objectName(objectPath),
      path: objectDetail?.key || objectPath,
      sizeBytes: objectDetail?.size ?? null,
      type: objectDetail?.content_type ?? t({ en: "Unavailable", fr: "Indisponible", de: "Nicht verfügbar" }),
      storageClass: objectDetail?.storage_class ?? "STANDARD",
      encryption: objectDetail?.encryption ?? "-",
      lastModified: portalDateTimeLabel(objectDetail?.last_modified, locale),
      previewType: objectDetail?.preview_type ?? "unavailable",
      previewText: objectDetail?.preview_text ?? null,
      previewUnavailableReason: objectDetail?.preview_unavailable_reason ?? t({ en: "Preview unavailable.", fr: "Aperçu indisponible.", de: "Vorschau nicht verfügbar." }),
    }),
    [locale, objectDetail, objectPath, t]
  );

  const pageState = resolvePortalWorkspacePageState({
    accountLoading,
    loading,
    accountError,
    error,
    hasAccountContext,
    loadingMessage: t({ en: "Loading object...", fr: "Chargement de l'objet...", de: "Objekt wird geladen..." }),
    noAccountMessage: t({ en: "Select an account to view this object.", fr: "Sélectionnez un compte pour voir cet objet.", de: "Wählen Sie ein Konto aus, um dieses Objekt anzuzeigen." }),
  });
  if (pageState) return pageState;

  if (!space || !objectPath) {
    return <PortalPageState>{t({ en: "Object not available.", fr: "Objet indisponible.", de: "Objekt nicht verfügbar." })}</PortalPageState>;
  }

  const displayPath = object.path;
  const parentPath = object.path.split("/").slice(0, -1).join("/");
  const canCreatePublicLink = space.role === "Owner" && space.visibility === "shared" && space.status !== "Archived";
  const publicLinkUnavailableReason = !accountIdForApi
    ? t({ en: "Select a Portal account first.", fr: "Sélectionnez d'abord un compte Portal.", de: "Wählen Sie zuerst ein Portal-Konto aus." })
    : space.status === "Archived"
      ? t({ en: "Archived Storage Spaces cannot create public links.", fr: "Les espaces de stockage archivés ne peuvent pas créer de liens publics.", de: "Archivierte Speicherbereiche können keine öffentlichen Links erstellen." })
      : space.role !== "Owner"
        ? t({ en: "Only Owners can create public links.", fr: "Seuls les Propriétaires peuvent créer des liens publics.", de: "Nur Eigentümer können öffentliche Links erstellen." })
        : space.visibility !== "shared"
          ? t({ en: "Public links are available only for shared Storage Spaces.", fr: "Les liens publics sont disponibles uniquement pour les espaces de stockage partagés.", de: "Öffentliche Links sind nur für geteilte Speicherbereiche verfügbar." })
          : null;
  const deleteUnavailableReason = !accountIdForApi
    ? t({ en: "Select a Portal account first.", fr: "Sélectionnez d'abord un compte Portal.", de: "Wählen Sie zuerst ein Portal-Konto aus." })
    : space.role === "Viewer"
      ? t({ en: "Viewers cannot delete files.", fr: "Les Lecteurs ne peuvent pas supprimer de fichiers.", de: "Betrachter können keine Dateien löschen." })
      : null;
  const objectEvents = workspace.activity.filter((item) => item.target === object.name || item.target === object.path);
  const copyPath = async () => {
    if (!navigator.clipboard) {
      setDownloadMessage(t({ en: "Clipboard is unavailable in this browser.", fr: "Le presse-papiers est indisponible dans ce navigateur.", de: "Die Zwischenablage ist in diesem Browser nicht verfügbar." }));
      return;
    }
    try {
      await navigator.clipboard.writeText(object.path);
      setDownloadMessage(t({ en: "Path copied.", fr: "Chemin copié.", de: "Pfad kopiert." }));
    } catch {
      setDownloadMessage(t({ en: "Clipboard is unavailable in this browser.", fr: "Le presse-papiers est indisponible dans ce navigateur.", de: "Die Zwischenablage ist in diesem Browser nicht verfügbar." }));
    }
  };
  const handleCreatePublicLink = async () => {
    if (!accountIdForApi || !space || linkBusy || !canCreatePublicLink) return;
    setLinkBusy(true);
    setDownloadMessage(null);
    try {
      const link = await createPortalStorageSpacePublicLink(accountIdForApi, space.id, {
        object_key: object.path,
        label: object.name,
        expires_at: linkExpiration ? new Date(linkExpiration).toISOString() : null,
      });
      setPublicLinks((current) => [link, ...current.filter((item) => item.id !== link.id)]);
      setDownloadMessage(t({ en: "Public link created.", fr: "Lien public créé.", de: "Öffentlicher Link erstellt." }));
    } catch (err) {
      console.error(err);
      setDownloadMessage(extractApiError(err, t({ en: "Unable to create public link.", fr: "Impossible de créer le lien public.", de: "Öffentlicher Link kann nicht erstellt werden." })));
    } finally {
      setLinkBusy(false);
    }
  };
  const handleRevokePublicLink = (link: PortalPublicLink) => {
    if (!accountIdForApi || !space || linkBusy) return;
    setPendingAction({ type: "revoke-public-link", link });
  };
  const confirmRevokePublicLink = async (link: PortalPublicLink) => {
    if (!accountIdForApi || !space || linkBusy) return;
    setLinkBusy(true);
    setDownloadMessage(null);
    try {
      const links = await revokePortalStorageSpacePublicLink(accountIdForApi, space.id, link.id);
      setPublicLinks(links);
      setDownloadMessage(t({ en: "Public link revoked.", fr: "Lien public révoqué.", de: "Öffentlicher Link widerrufen." }));
      setPendingAction(null);
    } catch (err) {
      console.error(err);
      setDownloadMessage(extractApiError(err, t({ en: "Unable to revoke public link.", fr: "Impossible de révoquer le lien public.", de: "Öffentlicher Link kann nicht widerrufen werden." })));
      setPendingAction(null);
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
      setDownloadMessage(t({ en: `${result.filename} downloaded.`, fr: `${result.filename} téléchargé.`, de: `${result.filename} heruntergeladen.` }));
    } catch (err) {
      console.error(err);
      const message = extractApiError(err, t({ en: "Unable to download this object.", fr: "Impossible de télécharger cet objet.", de: "Dieses Objekt kann nicht heruntergeladen werden." }));
      failPortalTransfer(transferId, message);
      setDownloadMessage(message);
    } finally {
      setDownloading(false);
    }
  };
  const handleDelete = () => {
    if (!accountIdForApi || !space || deleteBusy || deleteUnavailableReason) return;
    setPendingAction({ type: "delete-object" });
  };
  const confirmDelete = async () => {
    if (!accountIdForApi || !space || deleteBusy) return;
    setDeleteBusy(true);
    setDownloadMessage(null);
    try {
      await deletePortalStorageSpaceObject(accountIdForApi, space.id, object.path);
      setDownloadMessage(t({ en: `${object.name} deleted.`, fr: `${object.name} supprimé.`, de: `${object.name} gelöscht.` }));
      setPendingAction(null);
      window.setTimeout(() => {
        window.location.href = `${storageSpacePath(space)}?prefix=${encodeURIComponent(parentPath ? `${parentPath}/` : "")}`;
      }, 250);
    } catch (err) {
      console.error(err);
      setDownloadMessage(extractApiError(err, t({ en: "Unable to delete this object.", fr: "Impossible de supprimer cet objet.", de: "Dieses Objekt kann nicht gelöscht werden." })));
      setPendingAction(null);
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={object.name || objectName(object.path)}
        description={object.path}
        breadcrumbs={portalBreadcrumbs(
          { label: t({ en: "Storage Spaces", fr: "Espaces de stockage", de: "Speicherbereiche" }), to: "/portal/storage-spaces" },
          { label: space.name, to: storageSpacePath(space) },
          { label: object.name || objectName(object.path) },
        )}
        actions={[
          { label: downloading ? t({ en: "Downloading...", fr: "Téléchargement...", de: "Wird heruntergeladen..." }) : t({ en: "Download", fr: "Télécharger", de: "Herunterladen" }), onClick: handleDownload, variant: "secondary", disabled: !accountIdForApi || downloading },
          { label: linkBusy ? t({ en: "Sharing...", fr: "Partage...", de: "Wird freigegeben..." }) : t({ en: "Share", fr: "Partager", de: "Freigeben" }), onClick: handleCreatePublicLink, variant: "secondary", disabled: Boolean(publicLinkUnavailableReason) || linkBusy },
        ]}
      />

      <UiCard>
        <div className="flex min-w-0 gap-4">
          <FileIcon />
          <div className="min-w-0">
            <p className={cx("ui-body font-semibold", uiTitleTextClass)}>{object.name || objectName(object.path)}</p>
            <div className={cx(uiCardMutedClass, "mt-3 flex max-w-2xl items-center gap-2 px-3 py-2 text-xs font-semibold", uiMutedTextClass)}>
              <span className="min-w-0 flex-1 truncate">{displayPath}</span>
              <button type="button" onClick={copyPath} className="shrink-0 text-primary hover:text-primary-600 dark:text-primary-200 dark:hover:text-primary-100">{t({ en: "Copy", fr: "Copier", de: "Kopieren" })}</button>
            </div>
          </div>
        </div>
      </UiCard>

      {downloadMessage ? <PageBanner tone="info">{downloadMessage}</PageBanner> : null}
      {objectError ? <PageBanner tone="warning">{objectError}</PageBanner> : null}

      <div className={cx("border-b pb-3", uiDividerClass)}>
        <PageTabs
          tabs={[
            { id: "preview", label: t({ en: "Preview", fr: "Aperçu", de: "Vorschau" }) },
            { id: "details", label: t({ en: "Details", fr: "Détails", de: "Details" }) },
            { id: "events", label: t({ en: "Events", fr: "Événements", de: "Ereignisse" }) },
          ]}
          activeTab={activeTab}
          onChange={(tab) => setActiveTab(tab as ObjectTab)}
          variant="bar"
        />
      </div>

      {activeTab === "preview" ? (
        <div className="space-y-4">
          <section className="grid gap-4 xl:grid-cols-[1fr_300px]">
            <UiCard title={t({ en: "Quick preview", fr: "Aperçu rapide", de: "Schnellvorschau" })}>
              {object.previewType === "text" && object.previewText ? (
                <pre className="max-h-72 overflow-auto rounded-md border border-[color:var(--ui-border)] bg-slate-950 p-3 text-xs leading-5 text-slate-50">{object.previewText}</pre>
              ) : (
                <div className={cx(uiCardMutedClass, "min-h-28 p-3 text-xs font-semibold leading-5", uiMutedTextClass)}>
                  {object.previewUnavailableReason}
                </div>
              )}
              <div className="mt-3 text-right text-xs font-bold">
                <Link to={`${storageSpacePath(space)}?prefix=${encodeURIComponent(parentPath ? `${parentPath}/` : "")}`}>
                  {t({ en: "Open in file list", fr: "Ouvrir dans la liste des fichiers", de: "In Dateiliste öffnen" })}
                </Link>
              </div>
            </UiCard>

            <UiCard title={t({ en: "Quick actions", fr: "Actions rapides", de: "Schnellaktionen" })}>
              <div className="grid gap-4">
                <QuickAction label={t({ en: "Download", fr: "Télécharger", de: "Herunterladen" })} onClick={handleDownload} />
                <QuickAction label={t({ en: "Create public link", fr: "Créer un lien public", de: "Öffentlichen Link erstellen" })} onClick={handleCreatePublicLink} disabled={Boolean(publicLinkUnavailableReason) || linkBusy} reason={publicLinkUnavailableReason} />
                <QuickAction label={t({ en: "Copy path", fr: "Copier le chemin", de: "Pfad kopieren" })} onClick={copyPath} />
                <QuickAction label={deleteBusy ? t({ en: "Deleting...", fr: "Suppression...", de: "Wird gelöscht..." }) : t({ en: "Delete object", fr: "Supprimer l'objet", de: "Objekt löschen" })} tone="rose" onClick={handleDelete} disabled={Boolean(deleteUnavailableReason) || deleteBusy} reason={deleteUnavailableReason} />
              </div>
            </UiCard>
          </section>

          {space.role === "Owner" ? (
            <UiCard title={t({ en: "Public links", fr: "Liens publics", de: "Öffentliche Links" })}>
              <div className="mb-3 grid gap-2 sm:grid-cols-[220px_auto]">
                <input
                  type="datetime-local"
                  className="ui-control h-9 text-xs"
                  value={linkExpiration}
                  onChange={(event) => setLinkExpiration(event.target.value)}
                  aria-label={t({ en: "Public link expiration", fr: "Expiration du lien public", de: "Ablauf des öffentlichen Links" })}
                />
                <UiButton onClick={handleCreatePublicLink} disabled={!canCreatePublicLink || linkBusy} className="h-9 px-3 py-1.5">
                  {linkBusy ? t({ en: "Creating...", fr: "Création...", de: "Wird erstellt..." }) : t({ en: "Create link", fr: "Créer le lien", de: "Link erstellen" })}
                </UiButton>
              </div>
              {publicLinkUnavailableReason ? (
                <div className={cx("mb-3 text-[11px] font-semibold", uiMutedTextClass)}>
                  {t({ en: `Create public link unavailable: ${publicLinkUnavailableReason}`, fr: `Création de lien public indisponible : ${publicLinkUnavailableReason}`, de: `Öffentlichen Link erstellen nicht verfügbar: ${publicLinkUnavailableReason}` })}
                </div>
              ) : null}
              <div className="overflow-x-auto">
                <table className="ui-data-table min-w-[760px]">
                  <thead>
                    <tr>
                      <th>{t({ en: "Object", fr: "Objet", de: "Objekt" })}</th>
                      <th>{t({ en: "Status", fr: "Statut", de: "Status" })}</th>
                      <th>{t({ en: "Expiration", fr: "Expiration", de: "Ablauf" })}</th>
                      <th>{t({ en: "Link", fr: "Lien", de: "Link" })}</th>
                      <th className="text-right">{t({ en: "Action", fr: "Action", de: "Aktion" })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {publicLinks.map((link) => (
                      <tr key={link.id}>
                        <td className={cx("font-bold", uiTitleTextClass)}>{link.object_name}</td>
                        <td><UiBadge tone={link.status === "Active" ? "success" : "neutral"}>{portalPublicLinkStatusLabel(link.status, t)}</UiBadge></td>
                        <td>{link.expires_at ? portalDateTimeLabel(link.expires_at, locale) : "-"}</td>
                        <td className="max-w-[260px] truncate text-primary dark:text-primary-200">{link.url}</td>
                        <td className="text-right">
                          {link.status === "Active" ? (
                            <button type="button" onClick={() => handleRevokePublicLink(link)} className={tableDeleteActionClasses}>
                              {t({ en: "Revoke", fr: "Révoquer", de: "Widerrufen" })}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                    {publicLinks.length === 0 ? (
                      <tr>
                        <td colSpan={5} className={cx("py-5 text-center text-xs font-semibold", uiMutedTextClass)}>
                          {t({ en: "No public links for this object.", fr: "Aucun lien public pour cet objet.", de: "Keine öffentlichen Links für dieses Objekt." })}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </UiCard>
          ) : null}
        </div>
      ) : null}

      {activeTab === "details" ? (
        <UiCard title={t({ en: "General information", fr: "Informations générales", de: "Allgemeine Informationen" })}>
          <dl className="grid gap-4">
            <DetailRow label={t({ en: "Size", fr: "Taille", de: "Größe" })} value={formatBytes(object.sizeBytes)} />
            <DetailRow label={t({ en: "Content type", fr: "Type de contenu", de: "Inhaltstyp" })} value={object.type} />
            <DetailRow label={t({ en: "Last modified", fr: "Dernière modification", de: "Zuletzt geändert" })} value={object.lastModified} />
            <DetailRow label={t({ en: "Path", fr: "Chemin", de: "Pfad" })} value={object.path} />
          </dl>
          <details className={cx("mt-4 rounded-md border border-[color:var(--ui-border)] px-3 py-2 text-xs", uiMutedTextClass)}>
            <summary className={cx("cursor-pointer font-bold", uiTitleTextClass)}>{t({ en: "Technical details", fr: "Détails techniques", de: "Technische Details" })}</summary>
            <dl className="mt-3 grid gap-4">
              <DetailRow label={t({ en: "Storage class", fr: "Classe de stockage", de: "Speicherklasse" })} value={object.storageClass} />
              <DetailRow label={t({ en: "Encryption", fr: "Chiffrement", de: "Verschlüsselung" })} value={object.encryption} />
            </dl>
          </details>
          {objectLoading ? <div className={cx("mt-4 text-[11px] font-semibold", uiMutedTextClass)}>{t({ en: "Loading metadata...", fr: "Chargement des métadonnées...", de: "Metadaten werden geladen..." })}</div> : null}
        </UiCard>
      ) : null}

      {activeTab === "events" ? (
        <UiCard title={t({ en: "Recent events", fr: "Événements récents", de: "Letzte Ereignisse" })}>
          <div className="grid gap-2">
            {objectEvents.slice(0, 12).map((item) => (
              <div key={item.id} className={cx(uiCardMutedClass, "px-3 py-2 text-xs")}>
                <div className={cx("font-bold", uiTitleTextClass)}>{item.action}</div>
                <div className={cx("mt-1", uiMutedTextClass)}>{item.actor} · {item.timeLabel}</div>
              </div>
            ))}
            {objectEvents.length === 0 ? (
              <div className={cx(uiCardMutedClass, "px-3 py-6 text-center text-xs font-semibold", uiMutedTextClass)}>
                {t({ en: "No object events available.", fr: "Aucun événement disponible pour cet objet.", de: "Keine Objektereignisse verfügbar." })}
              </div>
            ) : null}
          </div>
        </UiCard>
      ) : null}

      {pendingAction?.type === "delete-object" ? (
        <ConfirmActionDialog
          title={t({ en: "Delete object", fr: "Supprimer l'objet", de: "Objekt löschen" })}
          description={t({ en: "Confirm that you want to delete this file.", fr: "Confirmez que vous voulez supprimer ce fichier.", de: "Bestätigen Sie, dass Sie diese Datei löschen möchten." })}
          confirmLabel={t({ en: "Delete object", fr: "Supprimer l'objet", de: "Objekt löschen" })}
          loading={deleteBusy}
          details={[
            { label: t({ en: "File", fr: "Fichier", de: "Datei" }), value: object.name || objectName(object.path) },
            { label: t({ en: "Path", fr: "Chemin", de: "Pfad" }), value: object.path, mono: true },
          ]}
          impacts={[
            t({ en: "The file is permanently removed from this Storage Space.", fr: "Le fichier est supprimé définitivement de cet espace de stockage.", de: "Die Datei wird dauerhaft aus diesem Speicherbereich entfernt." }),
            t({ en: "Existing public links for this file will stop working once the object is gone.", fr: "Les liens publics existants de ce fichier cesseront de fonctionner après suppression de l'objet.", de: "Bestehende öffentliche Links für diese Datei funktionieren nicht mehr, sobald das Objekt entfernt wurde." }),
            t({ en: "This action cannot be undone from the Portal.", fr: "Cette action ne peut pas être annulée depuis le Portal.", de: "Diese Aktion kann im Portal nicht rückgängig gemacht werden." }),
          ]}
          onCancel={() => setPendingAction(null)}
          onConfirm={confirmDelete}
        />
      ) : null}

      {pendingAction?.type === "revoke-public-link" ? (
        <ConfirmActionDialog
          title={t({ en: "Revoke public link", fr: "Révoquer le lien public", de: "Öffentlichen Link widerrufen" })}
          description={t({ en: "Confirm that you want to revoke this public link.", fr: "Confirmez que vous voulez révoquer ce lien public.", de: "Bestätigen Sie, dass Sie diesen öffentlichen Link widerrufen möchten." })}
          confirmLabel={t({ en: "Revoke link", fr: "Révoquer le lien", de: "Link widerrufen" })}
          loading={linkBusy}
          details={[
            { label: t({ en: "Object", fr: "Objet", de: "Objekt" }), value: pendingAction.link.object_name },
            { label: t({ en: "Link", fr: "Lien", de: "Link" }), value: pendingAction.link.url, mono: true },
          ]}
          impacts={[
            t({ en: "Anyone using this URL loses access immediately.", fr: "Toute personne utilisant cette URL perd immédiatement l'accès.", de: "Alle, die diese URL verwenden, verlieren sofort den Zugriff." }),
            t({ en: "The object remains in the Storage Space.", fr: "L'objet reste dans l'espace de stockage.", de: "Das Objekt bleibt im Speicherbereich." }),
            t({ en: "You can create a new public link later if sharing is still allowed.", fr: "Vous pourrez créer un nouveau lien public plus tard si le partage reste autorisé.", de: "Sie können später einen neuen öffentlichen Link erstellen, wenn Freigaben weiter erlaubt sind." }),
          ]}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => confirmRevokePublicLink(pendingAction.link)}
        />
      ) : null}
    </div>
  );
}
