/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import Modal from "../../components/Modal";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import PageTabs from "../../components/PageTabs";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import UiInput from "../../components/ui/UiInput";
import { cx, uiCardMutedClass, uiDividerClass, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { copyTextToClipboard } from "../../utils/clipboard";
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

function SummaryItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className={cx("text-[11px] font-semibold uppercase", uiMutedTextClass)}>{label}</dt>
      <dd className={cx("mt-1 min-w-0 text-sm font-bold", uiTitleTextClass)}>{children}</dd>
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
  const [publicLinkDialogOpen, setPublicLinkDialogOpen] = useState(false);
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
          setObjectError(extractApiError(err, t({ en: "Unable to load file details.", fr: "Impossible de charger les détails du fichier.", de: "Dateidetails können nicht geladen werden." })));
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
    loadingMessage: t({ en: "Loading file...", fr: "Chargement du fichier...", de: "Datei wird geladen..." }),
    noAccountMessage: t({ en: "Select a project to view this file.", fr: "Sélectionnez un projet pour voir ce fichier.", de: "Wählen Sie ein Projekt aus, um diese Datei anzuzeigen." }),
  });
  if (pageState) return pageState;

  if (!space || !objectPath) {
    return <PortalPageState>{t({ en: "File not available.", fr: "Fichier indisponible.", de: "Datei nicht verfügbar." })}</PortalPageState>;
  }

  const displayPath = object.path;
  const parentPath = object.path.split("/").slice(0, -1).join("/");
  const canCreatePublicLink = space.role === "Owner" && space.visibility === "shared" && space.status !== "Archived";
  const activePublicLinkCount = publicLinks.filter((link) => link.status === "Active").length;
  const publicLinkUnavailableReason = !accountIdForApi
    ? t({ en: "Select a project first.", fr: "Sélectionnez d'abord un projet.", de: "Wählen Sie zuerst ein Projekt aus." })
    : space.status === "Archived"
      ? t({ en: "Archived spaces cannot create public links.", fr: "Les espaces archivés ne peuvent pas créer de liens publics.", de: "Archivierte Bereiche können keine öffentlichen Links erstellen." })
      : space.role !== "Owner"
        ? t({ en: "Only Owners can create public links.", fr: "Seuls les Propriétaires peuvent créer des liens publics.", de: "Nur Eigentümer können öffentliche Links erstellen." })
        : space.visibility !== "shared"
          ? t({ en: "Public links are available only for shared spaces.", fr: "Les liens publics sont disponibles uniquement pour les espaces partagés.", de: "Öffentliche Links sind nur für geteilte Bereiche verfügbar." })
          : null;
  const sharingSummary = publicLinkUnavailableReason
    ? publicLinkUnavailableReason
    : activePublicLinkCount > 0
      ? t({
          en: `${activePublicLinkCount} active public link${activePublicLinkCount > 1 ? "s" : ""}`,
          fr: `${activePublicLinkCount} lien${activePublicLinkCount > 1 ? "s" : ""} public${activePublicLinkCount > 1 ? "s" : ""} actif${activePublicLinkCount > 1 ? "s" : ""}`,
          de: `${activePublicLinkCount} aktive öffentliche Links`,
        })
      : t({ en: "Ready to create a public link", fr: "Prêt à créer un lien public", de: "Bereit für einen öffentlichen Link" });
  const pageDescription = t({
    en: `In ${space.name}. Preview, download, or share this file.`,
    fr: `Dans ${space.name}. Prévisualisez, téléchargez ou partagez ce fichier.`,
    de: `In ${space.name}. Vorschau anzeigen, herunterladen oder freigeben.`,
  });
  const deleteUnavailableReason = !accountIdForApi
    ? t({ en: "Select a project first.", fr: "Sélectionnez d'abord un projet.", de: "Wählen Sie zuerst ein Projekt aus." })
    : space.role === "Viewer"
      ? t({ en: "Viewers cannot delete files.", fr: "Les Lecteurs ne peuvent pas supprimer de fichiers.", de: "Betrachter können keine Dateien löschen." })
      : null;
  const objectEvents = workspace.activity.filter((item) => item.target === object.name || item.target === object.path);
  const openPublicLinkDialog = () => {
    if (!canCreatePublicLink) return;
    setActiveTab("preview");
    setLinkExpiration("");
    setPublicLinkDialogOpen(true);
  };
  const closePublicLinkDialog = () => {
    if (linkBusy) return;
    setPublicLinkDialogOpen(false);
    setLinkExpiration("");
  };
  const copyPath = async () => {
    if (!navigator.clipboard) {
      setDownloadMessage(t({ en: "Clipboard is unavailable in this browser.", fr: "Le presse-papiers est indisponible dans ce navigateur.", de: "Die Zwischenablage ist in diesem Browser nicht verfügbar." }));
      return;
    }
    try {
      await navigator.clipboard.writeText(object.path);
      setDownloadMessage(t({ en: "File location copied.", fr: "Emplacement du fichier copié.", de: "Dateispeicherort kopiert." }));
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
      setPublicLinkDialogOpen(false);
      setLinkExpiration("");
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
  const copyPublicLink = async (link: PortalPublicLink) => {
    setDownloadMessage(null);
    try {
      await copyTextToClipboard(link.url);
      setDownloadMessage(t({ en: "Public link copied.", fr: "Lien public copié.", de: "Öffentlicher Link kopiert." }));
    } catch {
      setDownloadMessage(t({ en: "Clipboard is unavailable in this browser.", fr: "Le presse-papiers est indisponible dans ce navigateur.", de: "Die Zwischenablage ist in diesem Browser nicht verfügbar." }));
    }
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
      accountId: String(accountIdForApi),
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
      const message = extractApiError(err, t({ en: "Unable to download this file.", fr: "Impossible de télécharger ce fichier.", de: "Diese Datei kann nicht heruntergeladen werden." }));
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
      setDownloadMessage(extractApiError(err, t({ en: "Unable to delete this file.", fr: "Impossible de supprimer ce fichier.", de: "Diese Datei kann nicht gelöscht werden." })));
      setPendingAction(null);
      setDeleteBusy(false);
    }
  };
  const publicLinksTableStatus = publicLinks.length === 0 ? "empty" : "ready";
  const publicLinkColumns: DataTableColumn<PortalPublicLink>[] = [
    {
      id: "file",
      label: t({ en: "File", fr: "Fichier", de: "Datei" }),
      primary: true,
      render: (link) => link.object_name,
    },
    {
      id: "status",
      label: t({ en: "Status", fr: "Statut", de: "Status" }),
      render: (link) => <UiBadge tone={link.status === "Active" ? "success" : "neutral"}>{portalPublicLinkStatusLabel(link.status, t)}</UiBadge>,
    },
    {
      id: "expiration",
      label: t({ en: "Expiration", fr: "Expiration", de: "Ablauf" }),
      render: (link) => (link.expires_at ? portalDateTimeLabel(link.expires_at, locale) : "-"),
    },
    {
      id: "link",
      label: t({ en: "Link", fr: "Lien", de: "Link" }),
      cellClassName: "max-w-[260px] truncate text-primary dark:text-primary-200",
      render: (link) => link.url,
    },
    {
      id: "action",
      label: t({ en: "Action", fr: "Action", de: "Aktion" }),
      align: "right",
      mobileRole: "actions",
      render: (link) => (
        <div className="flex flex-wrap justify-end gap-2 max-md:justify-start">
          {link.status === "Active" ? (
            <>
              <button type="button" onClick={() => copyPublicLink(link)} className={tableActionButtonClasses}>
                {t({ en: "Copy link", fr: "Copier le lien", de: "Link kopieren" })}
              </button>
              <button type="button" onClick={() => handleRevokePublicLink(link)} className={tableDeleteActionClasses}>
                {t({ en: "Revoke", fr: "Révoquer", de: "Widerrufen" })}
              </button>
            </>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={object.name || objectName(object.path)}
        description={pageDescription}
        breadcrumbs={portalBreadcrumbs(
          { label: t({ en: "Spaces", fr: "Espaces", de: "Bereiche" }), to: "/portal/storage-spaces" },
          { label: space.name, to: storageSpacePath(space) },
          { label: object.name || objectName(object.path) },
        )}
        actions={[
          { label: downloading ? t({ en: "Downloading...", fr: "Téléchargement...", de: "Wird heruntergeladen..." }) : t({ en: "Download", fr: "Télécharger", de: "Herunterladen" }), onClick: handleDownload, variant: "secondary", disabled: !accountIdForApi || downloading },
          { label: t({ en: "Share", fr: "Partager", de: "Freigeben" }), onClick: openPublicLinkDialog, variant: "secondary", disabled: Boolean(publicLinkUnavailableReason) || linkBusy },
        ]}
      />

      <UiCard>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)] lg:items-start">
          <div className="flex min-w-0 gap-4">
            <FileIcon />
            <div className="min-w-0">
              <p className={cx("ui-body font-semibold", uiTitleTextClass)}>{object.name || objectName(object.path)}</p>
              <p className={cx("mt-1 text-xs font-medium", uiMutedTextClass)}>
                {t({ en: `In ${space.name}`, fr: `Dans ${space.name}`, de: `In ${space.name}` })}
              </p>
              <div className={cx(uiCardMutedClass, "mt-3 flex max-w-2xl items-center gap-2 px-3 py-2 text-xs font-semibold", uiMutedTextClass)}>
                <span className="min-w-0 flex-1 truncate">{displayPath}</span>
                <button type="button" onClick={copyPath} className="shrink-0 text-primary hover:text-primary-600 dark:text-primary-200 dark:hover:text-primary-100">{t({ en: "Copy location", fr: "Copier l'emplacement", de: "Speicherort kopieren" })}</button>
              </div>
            </div>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2">
            <SummaryItem label={t({ en: "Space", fr: "Espace", de: "Bereich" })}>
              <Link to={storageSpacePath(space)} className="hover:text-primary hover:underline">
                {space.name}
              </Link>
            </SummaryItem>
            <SummaryItem label={t({ en: "Sharing", fr: "Partage", de: "Freigabe" })}>
              <span className={cx("block truncate", publicLinkUnavailableReason ? uiMutedTextClass : undefined)}>
                {sharingSummary}
              </span>
            </SummaryItem>
            <SummaryItem label={t({ en: "Size", fr: "Taille", de: "Größe" })}>{formatBytes(object.sizeBytes)}</SummaryItem>
            <SummaryItem label={t({ en: "Updated", fr: "Modifié", de: "Aktualisiert" })}>{object.lastModified}</SummaryItem>
          </dl>
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
                <QuickAction
                  label={t({ en: "Set up public link", fr: "Préparer un lien public", de: "Öffentlichen Link vorbereiten" })}
                  onClick={openPublicLinkDialog}
                  disabled={Boolean(publicLinkUnavailableReason) || linkBusy}
                  reason={publicLinkUnavailableReason}
                />
                <QuickAction label={t({ en: "Copy file location", fr: "Copier l'emplacement du fichier", de: "Dateispeicherort kopieren" })} onClick={copyPath} />
                <QuickAction label={deleteBusy ? t({ en: "Deleting...", fr: "Suppression...", de: "Wird gelöscht..." }) : t({ en: "Delete file", fr: "Supprimer le fichier", de: "Datei löschen" })} tone="rose" onClick={handleDelete} disabled={Boolean(deleteUnavailableReason) || deleteBusy} reason={deleteUnavailableReason} />
              </div>
            </UiCard>
          </section>

          {space.role === "Owner" ? (
            <UiCard
              title={t({ en: "Public links", fr: "Liens publics", de: "Öffentliche Links" })}
              description={t({
                en: "Share this file outside the workspace only when anyone with the link should have access.",
                fr: "Partagez ce fichier hors de l'espace uniquement lorsque toute personne avec le lien peut y accéder.",
                de: "Geben Sie diese Datei außerhalb des Workspace nur frei, wenn alle mit dem Link Zugriff haben dürfen.",
              })}
              actions={
                <UiButton size="sm" variant="secondary" onClick={openPublicLinkDialog} disabled={!canCreatePublicLink || linkBusy}>
                  {t({ en: "Create link", fr: "Créer un lien", de: "Link erstellen" })}
                </UiButton>
              }
            >
              <div id="portal-file-public-links" className="scroll-mt-24" />
              {publicLinkUnavailableReason ? (
                <div className={cx("mb-3 text-[11px] font-semibold", uiMutedTextClass)}>
                  {t({ en: `Sharing note: ${publicLinkUnavailableReason}`, fr: `Note de partage : ${publicLinkUnavailableReason}`, de: `Freigabehinweis: ${publicLinkUnavailableReason}` })}
                </div>
              ) : null}
              <DataTableShell
                columns={publicLinkColumns}
                rows={publicLinks}
                rowKey={(link) => link.id}
                status={publicLinksTableStatus}
                loadingMessage={t({ en: "Loading public links...", fr: "Chargement des liens publics...", de: "Öffentliche Links werden geladen..." })}
                errorMessage={t({ en: "Unable to load public links.", fr: "Impossible de charger les liens publics.", de: "Öffentliche Links können nicht geladen werden." })}
                emptyMessage={t({ en: "No public links for this file.", fr: "Aucun lien public pour ce fichier.", de: "Keine öffentlichen Links für diese Datei." })}
                responsiveCards
              />
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
                {t({ en: "No file events available.", fr: "Aucun événement disponible pour ce fichier.", de: "Keine Dateiereignisse verfügbar." })}
              </div>
            ) : null}
          </div>
        </UiCard>
      ) : null}

      {pendingAction?.type === "delete-object" ? (
        <ConfirmActionDialog
          title={t({ en: "Delete file", fr: "Supprimer le fichier", de: "Datei löschen" })}
          description={t({ en: "Confirm that you want to delete this file.", fr: "Confirmez que vous voulez supprimer ce fichier.", de: "Bestätigen Sie, dass Sie diese Datei löschen möchten." })}
          confirmLabel={t({ en: "Delete file", fr: "Supprimer le fichier", de: "Datei löschen" })}
          loading={deleteBusy}
          details={[
            { label: t({ en: "File", fr: "Fichier", de: "Datei" }), value: object.name || objectName(object.path) },
            { label: t({ en: "Path", fr: "Chemin", de: "Pfad" }), value: object.path, mono: true },
          ]}
          impacts={[
            t({ en: "The file is permanently removed from this space.", fr: "Le fichier est supprimé définitivement de cet espace.", de: "Die Datei wird dauerhaft aus diesem Bereich entfernt." }),
            t({ en: "Existing public links for this file will stop working once the file is deleted.", fr: "Les liens publics existants de ce fichier cesseront de fonctionner après suppression du fichier.", de: "Bestehende öffentliche Links für diese Datei funktionieren nicht mehr, sobald die Datei gelöscht wurde." }),
            t({ en: "This action cannot be undone from the Portal.", fr: "Cette action ne peut pas être annulée depuis le Portal.", de: "Diese Aktion kann im Portal nicht rückgängig gemacht werden." }),
          ]}
          onCancel={() => setPendingAction(null)}
          onConfirm={confirmDelete}
        />
      ) : null}

      {publicLinkDialogOpen ? (
        <Modal
          title={t({ en: "Create public link", fr: "Créer un lien public", de: "Öffentlichen Link erstellen" })}
          onClose={closePublicLinkDialog}
          closeOnBackdropClick={!linkBusy}
          closeOnEscape={!linkBusy}
        >
          <div className="space-y-4">
            <dl className="grid gap-3 text-xs">
              <div className="grid grid-cols-[110px_1fr] gap-3">
                <dt className={cx("font-semibold", uiMutedTextClass)}>{t({ en: "File", fr: "Fichier", de: "Datei" })}</dt>
                <dd className={cx("min-w-0 break-all font-bold", uiTitleTextClass)}>{object.name || objectName(object.path)}</dd>
              </div>
              <div className="grid grid-cols-[110px_1fr] gap-3">
                <dt className={cx("font-semibold", uiMutedTextClass)}>{t({ en: "Space", fr: "Espace", de: "Bereich" })}</dt>
                <dd className={cx("min-w-0 font-bold", uiTitleTextClass)}>{space.name}</dd>
              </div>
              <div className="grid grid-cols-[110px_1fr] gap-3">
                <dt className={cx("font-semibold", uiMutedTextClass)}>{t({ en: "Path", fr: "Chemin", de: "Pfad" })}</dt>
                <dd className="min-w-0 break-all font-mono text-[11px]">{object.path}</dd>
              </div>
            </dl>
            <UiInput
              type="datetime-local"
              label={t({ en: "Expiration", fr: "Expiration", de: "Ablauf" })}
              size="compact"
              className="h-9"
              value={linkExpiration}
              disabled={linkBusy}
              onChange={(event) => setLinkExpiration(event.target.value)}
              aria-label={t({ en: "Public link expiration", fr: "Expiration du lien public", de: "Ablauf des öffentlichen Links" })}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <UiButton variant="secondary" onClick={closePublicLinkDialog} disabled={linkBusy}>
                {t({ en: "Cancel", fr: "Annuler", de: "Abbrechen" })}
              </UiButton>
              <UiButton onClick={handleCreatePublicLink} loading={linkBusy} disabled={!canCreatePublicLink || linkBusy}>
                {linkBusy
                  ? t({ en: "Creating...", fr: "Création...", de: "Wird erstellt..." })
                  : t({ en: "Create link", fr: "Créer le lien", de: "Link erstellen" })}
              </UiButton>
            </div>
          </div>
        </Modal>
      ) : null}

      {pendingAction?.type === "revoke-public-link" ? (
        <ConfirmActionDialog
          title={t({ en: "Revoke public link", fr: "Révoquer le lien public", de: "Öffentlichen Link widerrufen" })}
          description={t({ en: "Confirm that you want to revoke this public link.", fr: "Confirmez que vous voulez révoquer ce lien public.", de: "Bestätigen Sie, dass Sie diesen öffentlichen Link widerrufen möchten." })}
          confirmLabel={t({ en: "Revoke link", fr: "Révoquer le lien", de: "Link widerrufen" })}
          loading={linkBusy}
          details={[
            { label: t({ en: "File", fr: "Fichier", de: "Datei" }), value: pendingAction.link.object_name },
            { label: t({ en: "Link", fr: "Lien", de: "Link" }), value: pendingAction.link.url, mono: true },
          ]}
          impacts={[
            t({ en: "Anyone using this URL loses access immediately.", fr: "Toute personne utilisant cette URL perd immédiatement l'accès.", de: "Alle, die diese URL verwenden, verlieren sofort den Zugriff." }),
            t({ en: "The file remains in the space.", fr: "Le fichier reste dans l'espace.", de: "Die Datei bleibt im Bereich." }),
            t({ en: "You can create a new public link later if sharing is still allowed.", fr: "Vous pourrez créer un nouveau lien public plus tard si le partage reste autorisé.", de: "Sie können später einen neuen öffentlichen Link erstellen, wenn Freigaben weiter erlaubt sind." }),
          ]}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => confirmRevokePublicLink(pendingAction.link)}
        />
      ) : null}
    </div>
  );
}
