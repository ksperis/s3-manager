/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { updatePortalStorageSpace, type PortalStorageSpaceVisibility } from "../../api/portal";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import UiProgressBar from "../../components/ui/UiProgressBar";
import { cx, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import BrowserEmbed from "../browser/BrowserEmbed";
import type { BrowserActionId } from "../browser/browserActions";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import { storageSpaceObjectPath } from "./portalWorkspaceModel";
import { completePortalTransfer, failPortalTransfer, startPortalTransfer } from "./portalTransferTracker";
import {
  PortalPageState,
  portalStorageSpaceStatusTone,
  resolvePortalWorkspacePageState,
} from "./portalUi";
import { portalStatusLabel, portalVisibilityLabel } from "./portalI18n";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

function decodeRouteValue(value?: string): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const VIEWER_HIDDEN_BROWSER_ACTION_IDS: readonly BrowserActionId[] = [
  "uploadFiles",
  "uploadFolder",
  "newFolder",
  "delete",
];

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
      <div className={cx("text-[11px] font-semibold", uiMutedTextClass)}>{label}</div>
      <div className={cx("mt-2 text-[20px] font-bold leading-6", uiTitleTextClass)}>{value}</div>
      <div className={cx("mt-1 text-[11px] font-medium", uiMutedTextClass)}>{detail}</div>
      {progress != null ? (
        <div className="mt-3">
          <UiProgressBar value={progress} />
        </div>
      ) : null}
    </UiCard>
  );
}

export default function PortalStorageSpaceDetailPage() {
  const { t } = useI18n();
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const { generalSettings } = useGeneralSettings();
  const [message, setMessage] = useState<string | null>(null);
  const [metadataName, setMetadataName] = useState("");
  const [metadataDescription, setMetadataDescription] = useState("");
  const [metadataVisibility, setMetadataVisibility] = useState<PortalStorageSpaceVisibility>("private");
  const [metadataBusy, setMetadataBusy] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const {
    workspace,
    loading,
    error,
    hasAccountContext,
    accountError,
    accountLoading,
    accountIdForApi,
    selectedAccount,
  } = usePortalWorkspaceData();
  const decodedSpaceId = decodeRouteValue(spaceId);
  const space = workspace.spaces.find((item) => item.id === decodedSpaceId) ?? null;

  useEffect(() => {
    if (!space) return;
    setMetadataName(space.name);
    setMetadataDescription(space.description);
    setMetadataVisibility(space.visibility);
  }, [space]);

  const handleSaveMetadata = async () => {
    if (!space || !accountIdForApi) return;
    setMetadataBusy(true);
    setMessage(null);
    try {
      await updatePortalStorageSpace(accountIdForApi, space.id, {
        ...(space.nameEditable ? { name: metadataName.trim() || space.name } : {}),
        description: metadataDescription.trim() || null,
        visibility: metadataVisibility,
      });
      setMessage(t({ en: "Storage Space updated.", fr: "Espace de stockage mis à jour.", de: "Speicherbereich aktualisiert." }));
    } catch (err) {
      console.error(err);
      setMessage(extractApiError(err, t({ en: "Unable to update this Storage Space.", fr: "Impossible de mettre à jour cet espace de stockage.", de: "Dieser Speicherbereich kann nicht aktualisiert werden." })));
    } finally {
      setMetadataBusy(false);
    }
  };

  const handleArchive = () => {
    if (!space || !accountIdForApi) return;
    setArchiveDialogOpen(true);
  };

  const confirmArchive = async () => {
    if (!space || !accountIdForApi) return;
    setMetadataBusy(true);
    setMessage(null);
    try {
      await updatePortalStorageSpace(accountIdForApi, space.id, { archived: true });
      setArchiveDialogOpen(false);
      navigate("/portal/storage-spaces");
    } catch (err) {
      console.error(err);
      setMessage(extractApiError(err, t({ en: "Unable to archive this Storage Space.", fr: "Impossible d'archiver cet espace de stockage.", de: "Dieser Speicherbereich kann nicht archiviert werden." })));
      setMetadataBusy(false);
    }
  };

  const handleRestore = async () => {
    if (!space || !accountIdForApi) return;
    setMetadataBusy(true);
    setMessage(null);
    try {
      await updatePortalStorageSpace(accountIdForApi, space.id, { archived: false });
      setMessage(t({ en: "Storage Space restored.", fr: "Espace de stockage restauré.", de: "Speicherbereich wiederhergestellt." }));
    } catch (err) {
      console.error(err);
      setMessage(extractApiError(err, t({ en: "Unable to restore this Storage Space.", fr: "Impossible de restaurer cet espace de stockage.", de: "Dieser Speicherbereich kann nicht wiederhergestellt werden." })));
    } finally {
      setMetadataBusy(false);
    }
  };

  const pageState = resolvePortalWorkspacePageState({
    accountLoading,
    loading,
    accountError,
    error,
    hasAccountContext,
    loadingMessage: t({ en: "Loading storage space...", fr: "Chargement de l'espace de stockage...", de: "Speicherbereich wird geladen..." }),
    noAccountMessage: t({ en: "Select an account to view this Storage Space.", fr: "Sélectionnez un compte pour voir cet espace de stockage.", de: "Wählen Sie ein Konto aus, um diesen Speicherbereich anzuzeigen." }),
  });
  if (pageState) return pageState;

  if (!space || !accountIdForApi) {
    return <PortalPageState>{t({ en: "Storage Space not available.", fr: "Espace de stockage indisponible.", de: "Speicherbereich nicht verfügbar." })}</PortalPageState>;
  }

  const browserAvailable =
    Boolean(generalSettings.browser_enabled) && Boolean(generalSettings.browser_portal_enabled);
  const isArchived = space.status === "Archived";
  const canRename = space.role === "Owner" && space.nameEditable;
  const canModifyObjects = space.role === "Owner" || space.role === "Editor";
  const lockedBucketName = space.internalName ?? space.id;
  const quotaPercent =
    space.quotaBytes && space.usedBytes
      ? Math.min(100, (space.usedBytes / space.quotaBytes) * 100)
      : null;
  const averageFileSize =
    space.usedBytes != null && space.objectCount != null && space.objectCount > 0
      ? space.usedBytes / space.objectCount
      : null;
  const lastActivity = workspace.activity.find((item) => item.spaceId === space.id)?.actor ?? "-";

  return (
    <div className="space-y-4">
      <PageHeader
        title={space.name}
        description={t({ en: `${space.description} Created ${space.createdLabel}. Region: ${space.region ?? "-"}.`, fr: `${space.description} Créé le ${space.createdLabel}. Région : ${space.region ?? "-"}.`, de: `${space.description} Erstellt am ${space.createdLabel}. Region: ${space.region ?? "-"}.` })}
        breadcrumbs={portalBreadcrumbs({ label: t({ en: "Storage Spaces", fr: "Espaces de stockage", de: "Speicherbereiche" }), to: "/portal/storage-spaces" }, { label: space.name })}
        inlineContent={<UiBadge tone={portalStorageSpaceStatusTone(space)}>{portalStatusLabel(space.status, t)}</UiBadge>}
        actions={!isArchived && space.visibility === "shared" ? [{ label: t({ en: "Share", fr: "Partager", de: "Freigeben" }), to: "/portal/shares", variant: "secondary" }] : []}
      />

      {message ? <PageBanner tone="info">{message}</PageBanner> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ObjectMetricCard
          label={t({ en: "Storage used", fr: "Stockage utilisé", de: "Genutzter Speicher" })}
          value={formatBytes(space.usedBytes)}
          detail={quotaPercent == null ? t({ en: "Quota unavailable", fr: "Quota indisponible", de: "Quote nicht verfügbar" }) : t({ en: `of ${formatBytes(space.quotaBytes)} (${Math.round(quotaPercent)}%)`, fr: `sur ${formatBytes(space.quotaBytes)} (${Math.round(quotaPercent)} %)`, de: `von ${formatBytes(space.quotaBytes)} (${Math.round(quotaPercent)} %)` })}
          progress={quotaPercent ?? undefined}
        />
        <ObjectMetricCard label={t({ en: "Objects", fr: "Objets", de: "Objekte" })} value={formatCompactNumber(space.objectCount)} detail={space.objectCount == null ? t({ en: "Unavailable", fr: "Indisponible", de: "Nicht verfügbar" }) : t({ en: "Tracked", fr: "Suivis", de: "Erfasst" })} />
        <ObjectMetricCard label={t({ en: "Average size", fr: "Taille moyenne", de: "Durchschnittsgröße" })} value={formatBytes(averageFileSize)} detail={t({ en: "per object", fr: "par objet", de: "pro Objekt" })} />
        <ObjectMetricCard label={t({ en: "Last activity", fr: "Dernière activité", de: "Letzte Aktivität" })} value={lastActivity === "-" ? "-" : t({ en: "Recent", fr: "Récente", de: "Kürzlich" })} detail={lastActivity === "-" ? t({ en: "No activity available", fr: "Aucune activité disponible", de: "Keine Aktivität verfügbar" }) : t({ en: `By ${lastActivity}`, fr: `Par ${lastActivity}`, de: `Von ${lastActivity}` })} />
      </section>

      {isArchived ? (
        <PageBanner tone="warning">
          {t({ en: "This Storage Space is archived. Files and public links are suspended until it is restored.", fr: "Cet espace de stockage est archivé. Les fichiers et liens publics sont suspendus jusqu'à sa restauration.", de: "Dieser Speicherbereich ist archiviert. Dateien und öffentliche Links sind bis zur Wiederherstellung ausgesetzt." })}
        </PageBanner>
      ) : browserAvailable ? (
        <div className="min-h-[520px] h-[min(72vh,760px)]">
          <BrowserEmbed
            accountIdForApi={accountIdForApi}
            hasContext={hasAccountContext}
            workspaceSurface="portal"
            actionProfile="portal-basic"
            hiddenActionIds={canModifyObjects ? undefined : VIEWER_HIDDEN_BROWSER_ACTION_IDS}
            lockedBucketName={lockedBucketName}
            lockedBucketLabel={space.name}
            storageEndpointCapabilities={selectedAccount?.storage_endpoint_capabilities ?? null}
            quotaMaxSizeGb={selectedAccount?.quota_max_size_gb ?? null}
            quotaMaxObjects={selectedAccount?.quota_max_objects ?? null}
            onOpenObjectDetailsRoute={(target) => {
              if (target.bucketName !== lockedBucketName) return;
              navigate(storageSpaceObjectPath(space, target.key));
            }}
            transferReporter={{
              start: (transfer) => {
                if (transfer.bucketName !== lockedBucketName) return null;
                return startPortalTransfer({
                  accountId: String(accountIdForApi),
                  spaceId: space.id,
                  spaceName: space.name,
                  name: transfer.name,
                  direction: transfer.direction,
                  sizeBytes: transfer.sizeBytes,
                });
              },
              complete: completePortalTransfer,
              fail: failPortalTransfer,
            }}
          />
        </div>
      ) : (
        <PageBanner tone="warning">
          {t({ en: "File browsing is unavailable. Ask an administrator to enable file browsing for this workspace.", fr: "La navigation dans les fichiers est indisponible. Demandez à un administrateur de l'activer pour ce workspace.", de: "Dateibrowsing ist nicht verfügbar. Bitten Sie einen Administrator, es für diesen Arbeitsbereich zu aktivieren." })}
        </PageBanner>
      )}

      {space.role === "Owner" ? (
        <UiCard title={t({ en: "Storage Space settings", fr: "Paramètres de l'espace de stockage", de: "Speicherbereichseinstellungen" })}>
          <div className="grid gap-3 lg:grid-cols-[220px_1fr_160px_auto_auto]">
            <input
              className="ui-control h-9 text-xs disabled:opacity-70"
              value={metadataName}
              onChange={(event) => setMetadataName(event.target.value)}
              aria-label={t({ en: "Storage Space name", fr: "Nom de l'espace de stockage", de: "Name des Speicherbereichs" })}
              disabled={!canRename || metadataBusy}
              title={canRename ? t({ en: "Storage Space name", fr: "Nom de l'espace de stockage", de: "Name des Speicherbereichs" }) : t({ en: "Name locked for this Storage Space", fr: "Nom verrouillé pour cet espace de stockage", de: "Name für diesen Speicherbereich gesperrt" })}
            />
            <input className="ui-control h-9 text-xs" value={metadataDescription} onChange={(event) => setMetadataDescription(event.target.value)} aria-label={t({ en: "Storage Space description", fr: "Description de l'espace de stockage", de: "Beschreibung des Speicherbereichs" })} />
            <select
              className="ui-control h-9 py-1.5 text-xs"
              value={metadataVisibility}
              onChange={(event) => setMetadataVisibility(event.target.value as PortalStorageSpaceVisibility)}
              aria-label={t({ en: "Storage Space visibility", fr: "Visibilité de l'espace de stockage", de: "Sichtbarkeit des Speicherbereichs" })}
              disabled={metadataBusy || isArchived}
            >
              <option value="private">{portalVisibilityLabel("private", t)}</option>
              <option value="shared">{portalVisibilityLabel("shared", t)}</option>
            </select>
            <UiButton disabled={metadataBusy} onClick={handleSaveMetadata} className="h-9 px-3 py-1.5">
              {t({ en: "Save", fr: "Enregistrer", de: "Speichern" })}
            </UiButton>
            {isArchived ? (
              <UiButton variant="secondary" disabled={metadataBusy} onClick={handleRestore} className="h-9 px-3 py-1.5">
                {t({ en: "Restore", fr: "Restaurer", de: "Wiederherstellen" })}
              </UiButton>
            ) : (
              <UiButton variant="warning" disabled={metadataBusy} onClick={handleArchive} className="h-9 px-3 py-1.5">
                {t({ en: "Archive", fr: "Archiver", de: "Archivieren" })}
              </UiButton>
            )}
          </div>
        </UiCard>
      ) : null}

      {archiveDialogOpen ? (
        <ConfirmActionDialog
          title={t({ en: "Archive Storage Space", fr: "Archiver l'espace de stockage", de: "Speicherbereich archivieren" })}
          description={t({ en: "Confirm that you want to archive this Storage Space.", fr: "Confirmez que vous voulez archiver cet espace de stockage.", de: "Bestätigen Sie, dass Sie diesen Speicherbereich archivieren möchten." })}
          confirmLabel={t({ en: "Archive Storage Space", fr: "Archiver l'espace de stockage", de: "Speicherbereich archivieren" })}
          loading={metadataBusy}
          details={[
            { label: t({ en: "Storage Space", fr: "Espace de stockage", de: "Speicherbereich" }), value: space.name },
            { label: t({ en: "Status", fr: "Statut", de: "Status" }), value: t({ en: "Can be restored later", fr: "Restaurable plus tard", de: "Kann später wiederhergestellt werden" }) },
          ]}
          impacts={[
            t({ en: "The Storage Space is removed from active file work until it is restored.", fr: "L'espace de stockage est retiré des fichiers actifs jusqu'à sa restauration.", de: "Der Speicherbereich wird bis zur Wiederherstellung aus der aktiven Dateiarbeit entfernt." }),
            t({ en: "Existing objects are kept and are not deleted.", fr: "Les objets existants sont conservés et ne sont pas supprimés.", de: "Bestehende Objekte bleiben erhalten und werden nicht gelöscht." }),
            t({ en: "Public links and file access are suspended while archived.", fr: "Les liens publics et l'accès aux fichiers sont suspendus pendant l'archivage.", de: "Öffentliche Links und Dateizugriff sind während der Archivierung ausgesetzt." }),
          ]}
          warning={t({ en: "Archiving is reversible from this settings section.", fr: "L'archivage est réversible depuis cette section de paramètres.", de: "Die Archivierung kann in diesem Einstellungsbereich rückgängig gemacht werden." })}
          onCancel={() => setArchiveDialogOpen(false)}
          onConfirm={confirmArchive}
        />
      ) : null}
    </div>
  );
}
