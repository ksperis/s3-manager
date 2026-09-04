/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import type { S3AccountSelector } from "../../api/accountParams";
import {
  deletePortalStorageSpaceObject,
  downloadPortalStorageSpaceObject,
  restorePortalStorageSpaceObject,
  type PortalStorageObjectVersion,
} from "../../api/portal";
import type { PortalPublicLink } from "../../api/portalSharing";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import PageBanner from "../../components/PageBanner";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import {
  cx,
  uiMutedTextClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { copyTextToClipboard } from "../../utils/clipboard";
import { triggerBlobDownload } from "../../utils/download";
import { formatBytes } from "../../utils/format";
import ObjectDetailsDrawer from "./ObjectDetailsDrawer";
import ObjectPreview, { type ObjectPreviewLoadResult } from "./ObjectPreview";
import PortalObjectHistoryPanel from "../portal/PortalObjectHistoryPanel";
import PortalPublicLinkCreateDialog from "../portal/PortalPublicLinkCreateDialog";
import PortalPublicLinkRevokeDialog from "../portal/PortalPublicLinkRevokeDialog";
import PortalPublicLinksTable from "../portal/PortalPublicLinksTable";
import { portalDateTimeLabel } from "../portal/portalI18n";
import type { PortalWorkspaceSpace } from "../portal/portalWorkspaceModel";
import DetailsList from "./DetailsList";
import { useStorageSpaceObjectData } from "./useStorageSpaceObjectData";
import { useStorageSpaceObjectSharing } from "./useStorageSpaceObjectSharing";
import type { StorageSpaceObjectDetailsView } from "./objectDetailsContract";

type PendingAction =
  | { type: "delete" }
  | { type: "restore"; version: PortalStorageObjectVersion }
  | { type: "revoke"; link: PortalPublicLink };

type StorageSpaceObjectDetailsDrawerProps = {
  accountId: S3AccountSelector;
  activeView: StorageSpaceObjectDetailsView;
  canCreatePublicLinks: boolean;
  canModify: boolean;
  createPublicLinkRequestToken?: number;
  isDeleted: boolean;
  objectKey: string;
  space: PortalWorkspaceSpace;
  onClose: () => void;
  onCreatePublicLinkRequestHandled?: () => void;
  onMessage: (message: string | null) => void;
  onPublicLinkCreated?: (link: PortalPublicLink) => void;
  onRefreshObjects: () => void;
  onViewChange: (view: StorageSpaceObjectDetailsView) => void;
};

function objectName(key: string) {
  return key.split("/").filter(Boolean).at(-1) ?? key;
}

export default function StorageSpaceObjectDetailsDrawer({
  accountId,
  activeView,
  canCreatePublicLinks,
  canModify,
  createPublicLinkRequestToken = 0,
  isDeleted,
  objectKey,
  space,
  onClose,
  onCreatePublicLinkRequestHandled,
  onMessage,
  onPublicLinkCreated,
  onRefreshObjects,
  onViewChange,
}: StorageSpaceObjectDetailsDrawerProps) {
  const { locale, t } = useI18n();
  const {
    detail,
    detailLoading,
    detailError,
    history,
    historyLoading,
    historyError,
    loadHistory,
    refreshAfterRestore,
  } = useStorageSpaceObjectData({
    accountId,
    historyActive: activeView === "history",
    isDeleted,
    objectKey,
    spaceId: space.id,
  });
  const [downloading, setDownloading] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const canManageSharing =
    space.role === "Manager" && space.visibility === "shared" && space.status !== "Archived";
  const resolvedName = detail?.name || objectName(objectKey);
  const resolvedKey = detail?.key || objectKey;
  const {
    busyLinkId,
    closeCreate,
    copyCreatedLink,
    copyLink,
    createBusy,
    createError,
    createLink,
    createMessage,
    createOpen,
    createdLink,
    expiration,
    links,
    linksError,
    linksLoading,
    openCreate,
    revokeLink,
    setExpiration,
  } = useStorageSpaceObjectSharing({
    accountId,
    active: activeView === "sharing",
    canCreate: canCreatePublicLinks,
    canManage: canManageSharing,
    createRequestToken: createPublicLinkRequestToken,
    objectKey,
    objectName: resolvedName,
    onCreateRequestHandled: onCreatePublicLinkRequestHandled,
    onMessage,
    onPublicLinkCreated,
    spaceId: space.id,
  });

  useEffect(() => {
    setDeleteBusy(false);
    setPendingAction(null);
  }, [objectKey, space.id]);

  const loadPreview = useCallback(
    async (signal: AbortSignal): Promise<ObjectPreviewLoadResult> => {
      const response = await downloadPortalStorageSpaceObject(
        accountId,
        space.id,
        objectKey,
        signal,
      );
      return {
        blob: response.blob,
        contentType: detail?.content_type || response.blob.type || null,
      };
    },
    [accountId, detail?.content_type, objectKey, space.id],
  );

  const handleDownload = async () => {
    if (downloading || isDeleted) return;
    setDownloading(true);
    onMessage(null);
    try {
      const response = await downloadPortalStorageSpaceObject(accountId, space.id, objectKey);
      triggerBlobDownload(response.filename, response.blob);
      onMessage(
        t({
          en: `${response.filename} downloaded.`,
          fr: `${response.filename} téléchargé.`,
          de: `${response.filename} heruntergeladen.`,
        }),
      );
    } catch (error) {
      console.error(error);
      onMessage(
        extractApiError(
          error,
          t({
            en: "Unable to download this file.",
            fr: "Impossible de télécharger ce fichier.",
            de: "Diese Datei kann nicht heruntergeladen werden.",
          }),
        ),
      );
    } finally {
      setDownloading(false);
    }
  };

  const handleCopyPath = async () => {
    try {
      await copyTextToClipboard(resolvedKey);
      onMessage(
        t({
          en: "File location copied.",
          fr: "Emplacement du fichier copié.",
          de: "Dateispeicherort kopiert.",
        }),
      );
    } catch {
      onMessage(
        t({
          en: "Clipboard is unavailable in this browser.",
          fr: "Le presse-papiers est indisponible dans ce navigateur.",
          de: "Die Zwischenablage ist in diesem Browser nicht verfügbar.",
        }),
      );
    }
  };

  const confirmDelete = async () => {
    if (!canModify || isDeleted || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await deletePortalStorageSpaceObject(accountId, space.id, objectKey);
      setPendingAction(null);
      onMessage(
        t({
          en: `${resolvedName} removed from the file list.`,
          fr: `${resolvedName} retiré de la liste des fichiers.`,
          de: `${resolvedName} wurde aus der Dateiliste entfernt.`,
        }),
      );
      onRefreshObjects();
      onClose();
    } catch (error) {
      console.error(error);
      setPendingAction(null);
      onMessage(
        extractApiError(
          error,
          t({
            en: "Unable to delete this file.",
            fr: "Impossible de supprimer ce fichier.",
            de: "Diese Datei kann nicht gelöscht werden.",
          }),
        ),
      );
    } finally {
      setDeleteBusy(false);
    }
  };

  const confirmRestore = async (version: PortalStorageObjectVersion) => {
    if (restoringVersionId) return;
    setRestoringVersionId(version.version_id);
    try {
      await restorePortalStorageSpaceObject(accountId, space.id, objectKey, version.version_id);
      setPendingAction(null);
      await refreshAfterRestore();
      onRefreshObjects();
      onMessage(
        t({
          en: "Version restored. It is now the current version.",
          fr: "Version restaurée. Elle est maintenant la version actuelle.",
          de: "Version wiederhergestellt. Sie ist jetzt die aktuelle Version.",
        }),
      );
      if (isDeleted) onClose();
    } catch (error) {
      console.error(error);
      setPendingAction(null);
      onMessage(
        extractApiError(
          error,
          t({
            en: "Unable to restore this version.",
            fr: "Impossible de restaurer cette version.",
            de: "Diese Version kann nicht wiederhergestellt werden.",
          }),
        ),
      );
    } finally {
      setRestoringVersionId(null);
    }
  };

  const sharingUnavailableReason = !canManageSharing
    ? space.status === "Archived"
      ? t({
          en: "Public links are unavailable while this space is archived.",
          fr: "Les liens publics sont indisponibles tant que cet espace est archivé.",
          de: "Öffentliche Links sind für archivierte Bereiche nicht verfügbar.",
        })
      : space.role !== "Manager"
        ? t({
            en: "Only project managers can manage public links.",
            fr: "Seuls les gestionnaires du projet peuvent gérer les liens publics.",
            de: "Nur Projektmanager können öffentliche Links verwalten.",
          })
        : t({
            en: "Public links are available only for shared spaces.",
            fr: "Les liens publics sont disponibles uniquement pour les espaces partagés.",
            de: "Öffentliche Links sind nur für geteilte Bereiche verfügbar.",
          })
    : !canCreatePublicLinks
      ? t({
          en: "Your current access does not allow creating public links.",
          fr: "Votre accès actuel ne permet pas de créer de liens publics.",
          de: "Ihr aktueller Zugriff erlaubt keine öffentlichen Links.",
        })
      : null;

  const tabs = useMemo(
    () => [
      { id: "preview", label: t({ en: "Preview", fr: "Aperçu", de: "Vorschau" }) },
      { id: "history", label: t({ en: "History", fr: "Historique", de: "Verlauf" }) },
      { id: "sharing", label: t({ en: "Sharing", fr: "Partage", de: "Freigabe" }) },
      { id: "details", label: t({ en: "Details", fr: "Détails", de: "Details" }) },
    ],
    [t],
  );

  return (
    <>
      <ObjectDetailsDrawer
        name={resolvedName}
        path={resolvedKey}
        copyPathLabel={t({ en: "Copy path", fr: "Copier le chemin", de: "Pfad kopieren" })}
        moreLabel={t({ en: "More", fr: "Plus", de: "Mehr" })}
        onCopyPath={() => void handleCopyPath()}
        primaryAction={
          !isDeleted
            ? {
                label: t({ en: "Download", fr: "Télécharger", de: "Herunterladen" }),
                loading: downloading,
                onSelect: () => void handleDownload(),
              }
            : undefined
        }
        secondaryActions={
          !isDeleted && canModify
            ? [{
                id: "delete",
                label: t({ en: "Delete", fr: "Supprimer", de: "Löschen" }),
                tone: "danger",
                onSelect: () => setPendingAction({ type: "delete" }),
              }]
            : []
        }
        activeTab={activeView}
        tabs={tabs}
        tabsAriaLabel={t({
          en: "File detail views",
          fr: "Vues du détail du fichier",
          de: "Dateidetailansichten",
        })}
        notice={
          isDeleted ? (
            <PageBanner tone="warning">
              {t({
                en: "This file is in the trash. Review History to restore a version.",
                fr: "Ce fichier est dans la corbeille. Consultez l’historique pour restaurer une version.",
                de: "Diese Datei befindet sich im Papierkorb. Stellen Sie eine Version im Verlauf wieder her.",
              })}
            </PageBanner>
          ) : detailError ? <PageBanner tone="warning">{detailError}</PageBanner> : null
        }
        onClose={onClose}
        onTabChange={(view) => onViewChange(view as StorageSpaceObjectDetailsView)}
      >
        {activeView === "preview" ? (
          detailLoading && !detail ? (
            <div className={cx("py-10 text-center text-sm font-semibold", uiMutedTextClass)}>
              {t({ en: "Loading preview...", fr: "Chargement de l’aperçu...", de: "Vorschau wird geladen..." })}
            </div>
          ) : detail && !isDeleted ? (
            <ObjectPreview
              name={resolvedName}
              sizeBytes={detail.size}
              contentType={detail.content_type}
              initialText={detail.preview_text}
              loadBlob={loadPreview}
              variant="card"
              labels={{
                loading: t({ en: "Loading preview...", fr: "Chargement de l’aperçu...", de: "Vorschau wird geladen..." }),
                unavailable: t({ en: "Preview is unavailable for this file type.", fr: "L’aperçu n’est pas disponible pour ce type de fichier.", de: "Für diesen Dateityp ist keine Vorschau verfügbar." }),
                tooLarge: t({ en: "Preview is limited to files of 50 MiB or less. Download the file to open it.", fr: "L’aperçu est limité aux fichiers de 50 Mio maximum. Téléchargez le fichier pour l’ouvrir.", de: "Die Vorschau ist auf Dateien bis 50 MiB begrenzt. Laden Sie die Datei herunter, um sie zu öffnen." }),
                unknownSize: t({ en: "Preview is unavailable because the file size could not be determined.", fr: "L’aperçu est indisponible car la taille du fichier n’a pas pu être déterminée.", de: "Die Vorschau ist nicht verfügbar, da die Dateigröße nicht ermittelt werden konnte." }),
                truncated: t({ en: "Preview truncated to the first 64 KiB.", fr: "Aperçu limité aux 64 premiers Kio.", de: "Vorschau auf die ersten 64 KiB gekürzt." }),
                error: t({ en: "Unable to load preview.", fr: "Impossible de charger l’aperçu.", de: "Vorschau kann nicht geladen werden." }),
                frameTitle: t({ en: "File preview", fr: "Aperçu du fichier", de: "Dateivorschau" }),
              }}
              formatError={(error) => extractApiError(error, t({ en: "Unable to load preview.", fr: "Impossible de charger l’aperçu.", de: "Vorschau kann nicht geladen werden." }))}
            />
          ) : (
            <PageBanner tone="info">
              {t({ en: "Preview is unavailable for this file.", fr: "L’aperçu est indisponible pour ce fichier.", de: "Für diese Datei ist keine Vorschau verfügbar." })}
            </PageBanner>
          )
        ) : null}

        {activeView === "history" && history?.versioning_status === "Disabled" && !historyLoading ? (
          <PageBanner tone="info">
            {t({
              en: "Version history is disabled for this space, so there are no earlier versions to show.",
              fr: "L’historique des versions est désactivé pour cet espace : aucune version antérieure n’est disponible.",
              de: "Der Versionsverlauf ist für diesen Bereich deaktiviert. Es sind keine früheren Versionen verfügbar.",
            })}
          </PageBanner>
        ) : activeView === "history" ? (
          <PortalObjectHistoryPanel
            history={history}
            loading={historyLoading}
            error={historyError}
            restoringVersionId={restoringVersionId}
            onRetry={() => void loadHistory()}
            onLoadMore={() => void loadHistory({ keyMarker: history?.next_key_marker, versionIdMarker: history?.next_version_id_marker }, true)}
            onRestore={(version) => setPendingAction({ type: "restore", version })}
          />
        ) : null}

        {activeView === "sharing" ? (
          <UiCard
            title={t({ en: "Public links", fr: "Liens publics", de: "Öffentliche Links" })}
            description={t({
              en: "Share this file outside the workspace only when anyone with the link should have access.",
              fr: "Partagez ce fichier hors de l’espace uniquement lorsque toute personne avec le lien peut y accéder.",
              de: "Geben Sie diese Datei außerhalb des Workspace nur frei, wenn alle mit dem Link Zugriff haben dürfen.",
            })}
            actions={
              <UiButton
                size="sm"
                variant="secondary"
                disabled={!canCreatePublicLinks}
                onClick={openCreate}
              >
                {t({ en: "Create link", fr: "Créer un lien", de: "Link erstellen" })}
              </UiButton>
            }
          >
            {sharingUnavailableReason ? <PageBanner tone="info">{sharingUnavailableReason}</PageBanner> : null}
            {canManageSharing ? (
              <PortalPublicLinksTable
                links={links}
                status={resolveListTableStatus({ loading: linksLoading, error: linksError, rowCount: links.length })}
                errorMessage={linksError ?? undefined}
                emptyMessage={t({ en: "No public links for this file.", fr: "Aucun lien public pour ce fichier.", de: "Keine öffentlichen Links für diese Datei." })}
                busyLinkId={busyLinkId}
                fitContainer
                onCopy={(link) => void copyLink(link)}
                onRevoke={(link) => setPendingAction({ type: "revoke", link })}
              />
            ) : null}
          </UiCard>
        ) : null}

        {activeView === "details" ? (
          <UiCard title={t({ en: "General information", fr: "Informations générales", de: "Allgemeine Informationen" })}>
            <DetailsList
              items={[
                {
                  label: t({ en: "Space", fr: "Espace", de: "Bereich" }),
                  value: space.name,
                },
                {
                  label: t({ en: "Size", fr: "Taille", de: "Größe" }),
                  value: formatBytes(detail?.size ?? null),
                },
                {
                  label: t({
                    en: "Content type",
                    fr: "Type de contenu",
                    de: "Inhaltstyp",
                  }),
                  value: detail?.content_type ?? "-",
                },
                {
                  label: t({
                    en: "Last modified",
                    fr: "Dernière modification",
                    de: "Zuletzt geändert",
                  }),
                  value: portalDateTimeLabel(detail?.last_modified, locale),
                },
                {
                  label: t({ en: "Path", fr: "Chemin", de: "Pfad" }),
                  value: resolvedKey,
                  mono: true,
                },
              ]}
            />
            <details className={cx("mt-4 rounded-md border border-[color:var(--ui-border)] px-3 py-2 text-xs", uiMutedTextClass)}>
              <summary className={cx("cursor-pointer font-bold", uiTitleTextClass)}>{t({ en: "Technical details", fr: "Détails techniques", de: "Technische Details" })}</summary>
              <div className="mt-3">
                <DetailsList
                  items={[
                    {
                      label: t({
                        en: "Storage class",
                        fr: "Classe de stockage",
                        de: "Speicherklasse",
                      }),
                      value: detail?.storage_class ?? "STANDARD",
                    },
                    {
                      label: t({
                        en: "Encryption",
                        fr: "Chiffrement",
                        de: "Verschlüsselung",
                      }),
                      value: detail?.encryption ?? "-",
                    },
                  ]}
                />
              </div>
            </details>
            {detailLoading ? <p className={cx("mt-4 text-xs font-semibold", uiMutedTextClass)}>{t({ en: "Loading metadata...", fr: "Chargement des métadonnées...", de: "Metadaten werden geladen..." })}</p> : null}
          </UiCard>
        ) : null}
      </ObjectDetailsDrawer>

      {pendingAction?.type === "delete" ? (
        <ConfirmActionDialog
          title={t({ en: "Delete this file?", fr: "Supprimer ce fichier ?", de: "Diese Datei löschen?" })}
          description={t({ en: "The file will be removed from the current list. Its recovery depends on this space's version history settings.", fr: "Le fichier sera retiré de la liste actuelle. Sa récupération dépend des paramètres d’historique de cet espace.", de: "Die Datei wird aus der aktuellen Liste entfernt. Ihre Wiederherstellung hängt von den Verlaufseinstellungen ab." })}
          confirmLabel={t({ en: "Delete file", fr: "Supprimer le fichier", de: "Datei löschen" })}
          loading={deleteBusy}
          details={[
            { label: t({ en: "File", fr: "Fichier", de: "Datei" }), value: resolvedName },
            { label: t({ en: "Path", fr: "Chemin", de: "Pfad" }), value: resolvedKey, mono: true },
          ]}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}

      {pendingAction?.type === "restore" ? (
        <ConfirmActionDialog
          title={t({ en: "Restore this version?", fr: "Restaurer cette version ?", de: "Diese Version wiederherstellen?" })}
          description={t({ en: "This version will become the file's new current state.", fr: "Cette version deviendra le nouvel état actuel du fichier.", de: "Diese Version wird zum neuen aktuellen Stand der Datei." })}
          confirmLabel={t({ en: "Restore version", fr: "Restaurer la version", de: "Version wiederherstellen" })}
          loading={restoringVersionId === pendingAction.version.version_id}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void confirmRestore(pendingAction.version)}
        />
      ) : null}

      {pendingAction?.type === "revoke" ? (
        <PortalPublicLinkRevokeDialog
          link={pendingAction.link}
          loading={busyLinkId === pendingAction.link.id}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void revokeLink(pendingAction.link).finally(() => setPendingAction(null))}
        />
      ) : null}

      {createOpen ? (
        <PortalPublicLinkCreateDialog
          fileName={resolvedName}
          path={resolvedKey}
          spaceName={space.name}
          expiration={expiration}
          busy={createBusy}
          canCreate={canCreatePublicLinks}
          error={createError}
          message={createMessage}
          createdLink={createdLink}
          onExpirationChange={setExpiration}
          onClose={closeCreate}
          onCreate={() => void createLink()}
          onCopy={() => void copyCreatedLink()}
        />
      ) : null}
    </>
  );
}
