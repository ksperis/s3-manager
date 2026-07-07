/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  createPortalStorageSpacePublicLink,
  fetchPortalStorageSpaceAccessSummary,
  grantPortalStorageSpaceShare,
  listPortalStorageSpaceShareCandidates,
  revokePortalStorageSpaceShare,
  updatePortalStorageSpace,
  updatePortalStorageSpaceShare,
  type PortalPublicLink,
  type PortalStorageSpaceAccountMemberRole,
  type PortalStorageSpaceAccessSummary,
  type PortalStorageSpaceRole,
  type PortalStorageSpaceShare,
  type PortalStorageSpaceShareCandidate,
} from "../../api/portal";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import Modal from "../../components/Modal";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import UiProgressBar from "../../components/ui/UiProgressBar";
import { cx, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { copyTextToClipboard } from "../../utils/clipboard";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import BrowserEmbed from "../browser/BrowserEmbed";
import type { BrowserActionId } from "../browser/browserActions";
import {
  PortalAccessModeFields,
  PortalRoleBadge,
  PortalShareCandidatePicker,
  portalAccessModeDescription,
  portalAccessModeSummary,
  selectedPortalShares,
  type PortalAccessMode,
} from "./PortalAccessControls";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import { storageSpaceObjectPath } from "./portalWorkspaceModel";
import { completePortalTransfer, failPortalTransfer, startPortalTransfer } from "./portalTransferTracker";
import {
  PortalPageState,
  portalStorageSpaceStatusTone,
  resolvePortalWorkspacePageState,
} from "./portalUi";
import { portalRoleLabel, portalShareScopeLabel, portalStatusLabel } from "./portalI18n";
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

type PendingAccessChange = {
  mode: PortalAccessMode;
  accountMemberRole: PortalStorageSpaceAccountMemberRole;
};

type PublicLinkTarget = {
  bucketName: string;
  key: string;
  name: string;
};

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
  const [metadataBusy, setMetadataBusy] = useState(false);
  const [accessSummary, setAccessSummary] = useState<PortalStorageSpaceAccessSummary | null>(null);
  const [accessSummaryLoading, setAccessSummaryLoading] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessMode, setAccessMode] = useState<PortalAccessMode>("private");
  const [accessAccountMemberRole, setAccessAccountMemberRole] = useState<PortalStorageSpaceAccountMemberRole>("Editor");
  const [accessCandidates, setAccessCandidates] = useState<PortalStorageSpaceShareCandidate[]>([]);
  const [accessCandidateQuery, setAccessCandidateQuery] = useState("");
  const [accessRolesByUserId, setAccessRolesByUserId] = useState<Record<number, PortalStorageSpaceRole>>({});
  const [accessCandidatesLoading, setAccessCandidatesLoading] = useState(false);
  const [accessBusy, setAccessBusy] = useState(false);
  const [pendingAccessChange, setPendingAccessChange] = useState<PendingAccessChange | null>(null);
  const [pendingAccessRevoke, setPendingAccessRevoke] = useState<PortalStorageSpaceShare | null>(null);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [publicLinkTarget, setPublicLinkTarget] = useState<PublicLinkTarget | null>(null);
  const [publicLinkExpiration, setPublicLinkExpiration] = useState("");
  const [publicLinkBusy, setPublicLinkBusy] = useState(false);
  const [publicLinkError, setPublicLinkError] = useState<string | null>(null);
  const [createdPublicLink, setCreatedPublicLink] = useState<PortalPublicLink | null>(null);
  const [publicLinkCopyMessage, setPublicLinkCopyMessage] = useState<string | null>(null);
  const {
    workspace,
    loading,
    error,
    hasAccountContext,
    accountError,
    accountLoading,
    accountIdForApi,
    selectedAccount,
    refreshWorkspaceData = () => undefined,
  } = usePortalWorkspaceData({ includeArchived: true });
  const decodedSpaceId = decodeRouteValue(spaceId);
  const space = workspace.spaces.find((item) => item.id === decodedSpaceId) ?? null;
  const spaceAccessMode: PortalAccessMode = space
    ? space.visibility === "private"
      ? "private"
      : space.shareScope === "account"
      ? "account"
      : "restricted"
    : "private";
  const savedAccessMode: PortalAccessMode = accessSummary
    ? accessSummary.mode === "all"
      ? "account"
      : accessSummary.mode
    : spaceAccessMode;
  const savedAccountMemberRole = accessSummary?.default_account_member_role ?? space?.accountMemberRole ?? "Editor";
  const accessChanged = accessMode !== savedAccessMode || (accessMode === "account" && accessAccountMemberRole !== savedAccountMemberRole);
  const selectedAccessShareEntries = selectedPortalShares(accessRolesByUserId);

  useEffect(() => {
    if (!space) return;
    setMetadataName(space.name);
    setMetadataDescription(space.description);
    setAccessMode(spaceAccessMode);
    setAccessAccountMemberRole(space.accountMemberRole ?? "Editor");
  }, [space, spaceAccessMode]);

  const loadAccessSummary = useCallback(async () => {
    if (!space || !accountIdForApi) {
      setAccessSummary(null);
      return;
    }
    setAccessSummaryLoading(true);
    setAccessError(null);
    try {
      const summary = await fetchPortalStorageSpaceAccessSummary(accountIdForApi, space.id);
      setAccessSummary(summary);
      const mode = summary.mode === "all" ? "account" : summary.mode;
      setAccessMode(mode);
      setAccessAccountMemberRole(summary.default_account_member_role ?? space.accountMemberRole ?? "Editor");
    } catch (err) {
      console.error(err);
      setAccessSummary(null);
      setAccessError(extractApiError(err, t({ en: "Unable to load access details.", fr: "Impossible de charger les détails d'accès.", de: "Zugriffsdetails können nicht geladen werden." })));
    } finally {
      setAccessSummaryLoading(false);
    }
  }, [accountIdForApi, space, t]);

  useEffect(() => {
    void loadAccessSummary();
  }, [loadAccessSummary]);

  useEffect(() => {
    let cancelled = false;
    if (!space || !accountIdForApi || !accessSummary?.can_manage_access || savedAccessMode !== "restricted" || accessChanged) {
      setAccessCandidates([]);
      setAccessCandidatesLoading(false);
      setAccessRolesByUserId({});
      return () => {
        cancelled = true;
      };
    }
    setAccessCandidatesLoading(true);
    listPortalStorageSpaceShareCandidates(accountIdForApi, space.id)
      .then((candidates) => {
        if (!cancelled) setAccessCandidates(candidates);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setAccessCandidates([]);
      })
      .finally(() => {
        if (!cancelled) setAccessCandidatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, accessChanged, accessSummary?.can_manage_access, savedAccessMode, space]);

  const handleSaveMetadata = async () => {
    if (!space || !accountIdForApi) return;
    setMetadataBusy(true);
    setMessage(null);
    try {
      await updatePortalStorageSpace(accountIdForApi, space.id, {
        ...(space.nameEditable ? { name: metadataName.trim() || space.name } : {}),
        description: metadataDescription.trim() || null,
      });
      refreshWorkspaceData();
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

  const handleRequestSaveAccess = () => {
    if (!space || !accountIdForApi || !accessChanged) return;
    setPendingAccessChange({ mode: accessMode, accountMemberRole: accessAccountMemberRole });
  };

  const confirmAccessChange = async (change: PendingAccessChange) => {
    if (!space || !accountIdForApi) return;
    setAccessBusy(true);
    setMessage(null);
    try {
      await updatePortalStorageSpace(accountIdForApi, space.id, {
        visibility: change.mode === "private" ? "private" : "shared",
        share_scope: change.mode === "account" ? "account" : "restricted",
        account_member_role: change.mode === "account" ? change.accountMemberRole : null,
      });
      setPendingAccessChange(null);
      refreshWorkspaceData();
      await loadAccessSummary();
      setMessage(t({ en: "Access updated.", fr: "Accès mis à jour.", de: "Zugriff aktualisiert." }));
    } catch (err) {
      console.error(err);
      setMessage(extractApiError(err, t({ en: "Unable to update access.", fr: "Impossible de mettre à jour l'accès.", de: "Zugriff kann nicht aktualisiert werden." })));
      setPendingAccessChange(null);
    } finally {
      setAccessBusy(false);
    }
  };

  const handleAddAccessPeople = async () => {
    if (!space || !accountIdForApi || selectedAccessShareEntries.length === 0) return;
    setAccessBusy(true);
    setMessage(null);
    try {
      await Promise.all(
        selectedAccessShareEntries.map((entry) =>
          grantPortalStorageSpaceShare(accountIdForApi, space.id, {
            user_id: entry.user_id,
            role: entry.role,
          })
        )
      );
      setAccessRolesByUserId({});
      setAccessCandidateQuery("");
      await loadAccessSummary();
      setMessage(t({ en: "People added.", fr: "Personnes ajoutées.", de: "Personen hinzugefügt." }));
    } catch (err) {
      console.error(err);
      setMessage(extractApiError(err, t({ en: "Unable to add people.", fr: "Impossible d'ajouter ces personnes.", de: "Personen können nicht hinzugefügt werden." })));
    } finally {
      setAccessBusy(false);
    }
  };

  const handleAccessRoleChange = async (share: PortalStorageSpaceShare, role: PortalStorageSpaceRole) => {
    if (!space || !accountIdForApi || share.user_id == null) return;
    setAccessBusy(true);
    setMessage(null);
    try {
      await updatePortalStorageSpaceShare(accountIdForApi, space.id, share.user_id, role);
      await loadAccessSummary();
      setMessage(t({ en: "Access role updated.", fr: "Rôle d'accès mis à jour.", de: "Zugriffsrolle aktualisiert." }));
    } catch (err) {
      console.error(err);
      setMessage(extractApiError(err, t({ en: "Unable to update this person.", fr: "Impossible de mettre à jour cette personne.", de: "Diese Person kann nicht aktualisiert werden." })));
    } finally {
      setAccessBusy(false);
    }
  };

  const confirmAccessRevoke = async (share: PortalStorageSpaceShare) => {
    if (!space || !accountIdForApi || share.user_id == null) return;
    setAccessBusy(true);
    setMessage(null);
    try {
      await revokePortalStorageSpaceShare(accountIdForApi, space.id, share.user_id);
      setPendingAccessRevoke(null);
      await loadAccessSummary();
      setMessage(t({ en: "Access revoked.", fr: "Accès révoqué.", de: "Zugriff widerrufen." }));
    } catch (err) {
      console.error(err);
      setMessage(extractApiError(err, t({ en: "Unable to revoke access.", fr: "Impossible de révoquer l'accès.", de: "Zugriff kann nicht widerrufen werden." })));
      setPendingAccessRevoke(null);
    } finally {
      setAccessBusy(false);
    }
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
      refreshWorkspaceData();
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
  const canBrowse = Boolean(space.canBrowse) && !isArchived;
  const contentRole = space.contentRole;
  const canRename = space.role === "Owner" && space.nameEditable;
  const canModifyObjects = canBrowse && (contentRole === "Owner" || contentRole === "Editor");
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
  const canCreatePublicLinks = Boolean(
    canBrowse &&
    space.role === "Owner" &&
    contentRole === "Owner" &&
    space.visibility === "shared" &&
    accessSummary?.can_create_public_links
  );
  const pageDescription = space.description
    ? t({
        en: `${space.description} Created ${space.createdLabel}. Region: ${space.region ?? "-"}.`,
        fr: `${space.description} Créé le ${space.createdLabel}. Région : ${space.region ?? "-"}.`,
        de: `${space.description} Erstellt am ${space.createdLabel}. Region: ${space.region ?? "-"}.`,
      })
    : t({
        en: `Created ${space.createdLabel}. Region: ${space.region ?? "-"}.`,
        fr: `Créé le ${space.createdLabel}. Région : ${space.region ?? "-"}.`,
        de: `Erstellt am ${space.createdLabel}. Region: ${space.region ?? "-"}.`,
      });

  const openPublicLinkDialog = (target: PublicLinkTarget) => {
    if (target.bucketName !== lockedBucketName || !canCreatePublicLinks) return;
    setPublicLinkTarget(target);
    setPublicLinkExpiration("");
    setPublicLinkError(null);
    setCreatedPublicLink(null);
    setPublicLinkCopyMessage(null);
  };

  const closePublicLinkDialog = () => {
    if (publicLinkBusy) return;
    setPublicLinkTarget(null);
    setPublicLinkExpiration("");
    setPublicLinkError(null);
    setCreatedPublicLink(null);
    setPublicLinkCopyMessage(null);
  };

  const handleCreatePublicLink = async () => {
    if (!publicLinkTarget || !accountIdForApi || publicLinkBusy || !canCreatePublicLinks) return;
    let expiresAt: string | null = null;
    if (publicLinkExpiration) {
      const expiration = new Date(publicLinkExpiration);
      if (Number.isNaN(expiration.getTime())) {
        setPublicLinkError(t({ en: "Choose a valid expiration date.", fr: "Choisissez une date d'expiration valide.", de: "Wählen Sie ein gültiges Ablaufdatum." }));
        return;
      }
      expiresAt = expiration.toISOString();
    }
    setPublicLinkBusy(true);
    setPublicLinkError(null);
    setPublicLinkCopyMessage(null);
    try {
      const link = await createPortalStorageSpacePublicLink(accountIdForApi, space.id, {
        object_key: publicLinkTarget.key,
        label: publicLinkTarget.name,
        expires_at: expiresAt,
      });
      setCreatedPublicLink(link);
      setMessage(t({ en: "Public link created.", fr: "Lien public créé.", de: "Öffentlicher Link erstellt." }));
      void loadAccessSummary();
    } catch (err) {
      console.error(err);
      setPublicLinkError(extractApiError(err, t({ en: "Unable to create public link.", fr: "Impossible de créer le lien public.", de: "Öffentlicher Link kann nicht erstellt werden." })));
    } finally {
      setPublicLinkBusy(false);
    }
  };

  const copyCreatedPublicLink = async () => {
    if (!createdPublicLink?.url) return;
    try {
      await copyTextToClipboard(createdPublicLink.url);
      setPublicLinkCopyMessage(t({ en: "Link copied.", fr: "Lien copié.", de: "Link kopiert." }));
    } catch {
      setPublicLinkCopyMessage(t({ en: "Clipboard is unavailable in this browser.", fr: "Le presse-papiers est indisponible dans ce navigateur.", de: "Die Zwischenablage ist in diesem Browser nicht verfügbar." }));
    }
  };

  const storageSpaceSettingsCard = space.role === "Owner" ? (
    <UiCard title={t({ en: "Storage Space settings", fr: "Paramètres de l'espace de stockage", de: "Speicherbereichseinstellungen" })}>
      <div className="grid gap-3 lg:grid-cols-[220px_1fr_auto_auto]">
        <input
          className="ui-control h-9 text-xs disabled:opacity-70"
          value={metadataName}
          onChange={(event) => setMetadataName(event.target.value)}
          aria-label={t({ en: "Storage Space name", fr: "Nom de l'espace de stockage", de: "Name des Speicherbereichs" })}
          disabled={!canRename || metadataBusy}
          title={canRename ? t({ en: "Storage Space name", fr: "Nom de l'espace de stockage", de: "Name des Speicherbereichs" }) : t({ en: "Name locked for this Storage Space", fr: "Nom verrouillé pour cet espace de stockage", de: "Name für diesen Speicherbereich gesperrt" })}
        />
        <input className="ui-control h-9 text-xs" value={metadataDescription} onChange={(event) => setMetadataDescription(event.target.value)} aria-label={t({ en: "Storage Space description", fr: "Description de l'espace de stockage", de: "Beschreibung des Speicherbereichs" })} />
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
  ) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={space.name}
        description={pageDescription}
        breadcrumbs={portalBreadcrumbs({ label: t({ en: "Storage Spaces", fr: "Espaces de stockage", de: "Speicherbereiche" }), to: "/portal/storage-spaces" }, { label: space.name })}
        inlineContent={<UiBadge tone={portalStorageSpaceStatusTone(space)}>{portalStatusLabel(space.status, t)}</UiBadge>}
        actions={!isArchived && (space.visibility === "shared" || accessSummary?.can_manage_access) ? [{
          label: t({ en: "Share", fr: "Partager", de: "Freigeben" }),
          to: `/portal/shares?space_id=${encodeURIComponent(space.id)}&tab=by`,
          variant: "secondary",
        }] : []}
      />

      {message ? <PageBanner tone="info">{message}</PageBanner> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ObjectMetricCard
          label={t({ en: "Storage used", fr: "Stockage utilisé", de: "Genutzter Speicher" })}
          value={formatBytes(space.usedBytes)}
          detail={quotaPercent == null ? t({ en: "Quota unavailable", fr: "Quota indisponible", de: "Quote nicht verfügbar" }) : t({ en: `of ${formatBytes(space.quotaBytes)} (${Math.round(quotaPercent)}%)`, fr: `sur ${formatBytes(space.quotaBytes)} (${Math.round(quotaPercent)} %)`, de: `von ${formatBytes(space.quotaBytes)} (${Math.round(quotaPercent)} %)` })}
          progress={quotaPercent ?? undefined}
        />
        <ObjectMetricCard label={t({ en: "Files", fr: "Fichiers", de: "Dateien" })} value={formatCompactNumber(space.objectCount)} detail={space.objectCount == null ? t({ en: "Unavailable", fr: "Indisponible", de: "Nicht verfügbar" }) : t({ en: "Tracked", fr: "Suivis", de: "Erfasst" })} />
        <ObjectMetricCard label={t({ en: "Average size", fr: "Taille moyenne", de: "Durchschnittsgröße" })} value={formatBytes(averageFileSize)} detail={t({ en: "per file", fr: "par fichier", de: "pro Datei" })} />
        <ObjectMetricCard label={t({ en: "Last activity", fr: "Dernière activité", de: "Letzte Aktivität" })} value={lastActivity === "-" ? "-" : t({ en: "Recent", fr: "Récente", de: "Kürzlich" })} detail={lastActivity === "-" ? t({ en: "No activity available", fr: "Aucune activité disponible", de: "Keine Aktivität verfügbar" }) : t({ en: `By ${lastActivity}`, fr: `Par ${lastActivity}`, de: `Von ${lastActivity}` })} />
      </section>

      {storageSpaceSettingsCard}

      <UiCard title={t({ en: "Access", fr: "Accès", de: "Zugriff" })}>
        {accessSummaryLoading ? (
          <div className={cx("text-xs font-semibold", uiMutedTextClass)}>
            {t({ en: "Loading access...", fr: "Chargement des accès...", de: "Zugriff wird geladen..." })}
          </div>
        ) : accessError ? (
          <PageBanner tone="warning">{accessError}</PageBanner>
        ) : accessSummary ? (
          <div className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <UiBadge tone={savedAccessMode === "private" ? "neutral" : "info"}>
                    {savedAccessMode === "account"
                      ? portalShareScopeLabel("shared", "account", t)
                      : savedAccessMode === "restricted"
                      ? portalShareScopeLabel("shared", "restricted", t)
                      : portalShareScopeLabel("private", "restricted", t)}
                  </UiBadge>
                  {isArchived ? <UiBadge tone="warning">{portalStatusLabel("Archived", t)}</UiBadge> : null}
                </div>
                <p className={cx("mt-2 text-xs font-medium", uiMutedTextClass)}>
                  {isArchived
                    ? t({ en: "Archived Storage Spaces have no active Portal access.", fr: "Les espaces archivés n'ont aucun accès Portal actif.", de: "Archivierte Speicherbereiche haben keinen aktiven Portal-Zugriff." })
                    : portalAccessModeDescription(savedAccessMode, t)}
                </p>
                <p className={cx("mt-1 text-[11px] font-semibold", uiMutedTextClass)}>
                  {portalAccessModeSummary(savedAccessMode, accessSummary.explicit_shares.length, accessSummary.effective_member_count, t)}
                </p>
              </div>
              <div>
                <div className={cx("text-[11px] font-semibold uppercase", uiMutedTextClass)}>
                  {t({ en: "Owner", fr: "Propriétaire", de: "Eigentümer" })}
                </div>
                <div className={cx("mt-1 font-bold", uiTitleTextClass)}>
                  {accessSummary.owner.display_name || accessSummary.owner.email}
                </div>
                <div className={cx("text-[11px] font-medium", uiMutedTextClass)}>{accessSummary.owner.email}</div>
              </div>
              <div>
                <div className={cx("text-[11px] font-semibold uppercase", uiMutedTextClass)}>
                  {t({ en: "External reach", fr: "Portée externe", de: "Externe Reichweite" })}
                </div>
                <Link
                  to={`/portal/shares?space_id=${encodeURIComponent(space.id)}&tab=links`}
                  className="mt-1 inline-flex text-sm font-bold text-primary hover:underline dark:text-primary-200"
                >
                  {t({
                    en: `${accessSummary.public_link_count} public link${accessSummary.public_link_count > 1 ? "s" : ""}`,
                    fr: `${accessSummary.public_link_count} lien${accessSummary.public_link_count > 1 ? "s" : ""} public${accessSummary.public_link_count > 1 ? "s" : ""}`,
                    de: `${accessSummary.public_link_count} öffentliche Links`,
                  })}
                </Link>
              </div>
            </div>

            {accessSummary.can_manage_access ? (
              <div className="space-y-3 border-t border-[color:var(--ui-border-soft)] pt-4">
                <PortalAccessModeFields
                  mode={accessMode}
                  onModeChange={setAccessMode}
                  accountMemberRole={accessAccountMemberRole}
                  onAccountMemberRoleChange={setAccessAccountMemberRole}
                  disabled={accessBusy || isArchived}
                  modeLabel={t({ en: "Storage Space access", fr: "Accès à l'espace de stockage", de: "Zugriff auf den Speicherbereich" })}
                  roleLabel={t({ en: "Default access for account members", fr: "Accès par défaut des membres de l'account", de: "Standardzugriff für Account-Mitglieder" })}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <UiButton
                    size="sm"
                    disabled={!accessChanged || accessBusy || isArchived}
                    onClick={handleRequestSaveAccess}
                  >
                    {t({ en: "Save access", fr: "Enregistrer l'accès", de: "Zugriff speichern" })}
                  </UiButton>
                  {accessChanged ? (
                    <span className={cx("text-[11px] font-semibold", uiMutedTextClass)}>
                      {t({ en: "Confirm before changing who has access.", fr: "Une confirmation sera demandée avant de modifier les personnes couvertes.", de: "Vor der Änderung der berechtigten Personen ist eine Bestätigung erforderlich." })}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="space-y-2 border-t border-[color:var(--ui-border-soft)] pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className={cx("text-sm font-bold", uiTitleTextClass)}>
                  {t({ en: "Direct collaborators", fr: "Collaborateurs directs", de: "Direkte Mitwirkende" })}
                </h3>
                <Link
                  to={`/portal/shares?space_id=${encodeURIComponent(space.id)}&tab=by`}
                  className="text-xs font-bold text-primary hover:underline dark:text-primary-200"
                >
                  {t({ en: "Open Shares", fr: "Ouvrir Partages", de: "Freigaben öffnen" })}
                </Link>
              </div>
              {accessSummary.explicit_shares.length > 0 ? (
                <div className="space-y-2">
                  {accessSummary.explicit_shares.map((share) => (
                    <div key={share.id} className="grid gap-2 rounded-md border border-[color:var(--ui-border)] px-3 py-2 md:grid-cols-[minmax(0,1fr)_150px_auto] md:items-center">
                      <div className="min-w-0">
                        <div className={cx("truncate text-xs font-bold", uiTitleTextClass)}>{share.email}</div>
                        {savedAccessMode === "private" ? (
                          <div className={cx("text-[11px] font-semibold", uiMutedTextClass)}>
                            {t({ en: "Inactive while private", fr: "Inactif tant que l'accès est privé", de: "Inaktiv bei privatem Zugriff" })}
                          </div>
                        ) : null}
                      </div>
                      {accessSummary.can_manage_access && share.user_id != null && savedAccessMode !== "private" ? (
                        <select
                          className="ui-control h-8 py-1.5 text-xs"
                          value={share.role}
                          disabled={accessBusy || accessChanged || isArchived}
                          onChange={(event) => handleAccessRoleChange(share, event.target.value as PortalStorageSpaceRole)}
                          aria-label={t({ en: `Access for ${share.email}`, fr: `Accès pour ${share.email}`, de: `Zugriff für ${share.email}` })}
                        >
                          <option value="Viewer">{portalRoleLabel("Viewer", t)}</option>
                          <option value="Editor">{portalRoleLabel("Editor", t)}</option>
                          <option value="Owner">{portalRoleLabel("Owner", t)}</option>
                        </select>
                      ) : (
                        <PortalRoleBadge role={share.role} />
                      )}
                      {accessSummary.can_manage_access && share.user_id != null && savedAccessMode !== "private" ? (
                        <UiButton
                          size="xs"
                          variant="danger"
                          disabled={accessBusy || accessChanged || isArchived}
                          onClick={() => setPendingAccessRevoke(share)}
                        >
                          {t({ en: "Revoke", fr: "Révoquer", de: "Widerrufen" })}
                        </UiButton>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className={cx("text-xs font-semibold", uiMutedTextClass)}>
                  {t({ en: "No direct collaborators yet.", fr: "Aucun collaborateur direct pour l'instant.", de: "Noch keine direkten Mitwirkenden." })}
                </div>
              )}
            </div>

            {accessSummary.can_manage_access && savedAccessMode === "restricted" ? (
              <div className="space-y-3 border-t border-[color:var(--ui-border-soft)] pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className={cx("text-sm font-bold", uiTitleTextClass)}>
                    {t({ en: "Add people", fr: "Ajouter des personnes", de: "Personen hinzufügen" })}
                  </h3>
                  <UiButton
                    size="sm"
                    disabled={accessBusy || accessChanged || selectedAccessShareEntries.length === 0 || isArchived}
                    onClick={handleAddAccessPeople}
                  >
                    {t({ en: "Add people", fr: "Ajouter", de: "Hinzufügen" })}
                  </UiButton>
                </div>
                {accessChanged ? (
                  <div className={cx("text-xs font-semibold", uiMutedTextClass)}>
                    {t({ en: "Save the access mode before editing direct collaborators.", fr: "Enregistrez le mode d'accès avant de modifier les collaborateurs directs.", de: "Speichern Sie den Zugriffsmodus, bevor Sie direkte Mitwirkende bearbeiten." })}
                  </div>
                ) : (
                  <PortalShareCandidatePicker
                    candidates={accessCandidates}
                    selectedRolesByUserId={accessRolesByUserId}
                    query={accessCandidateQuery}
                    loading={accessCandidatesLoading}
                    error={null}
                    includeAlreadyShared
                    onQueryChange={setAccessCandidateQuery}
                    onRoleChange={(userId, role) => {
                      setAccessRolesByUserId((current) => {
                        const next = { ...current };
                        if (role) {
                          next[userId] = role;
                        } else {
                          delete next[userId];
                        }
                        return next;
                      });
                    }}
                  />
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </UiCard>

      {isArchived ? (
        <PageBanner tone="warning">
          {t({ en: "This Storage Space is archived. Files and public links are suspended until it is restored.", fr: "Cet espace de stockage est archivé. Les fichiers et liens publics sont suspendus jusqu'à sa restauration.", de: "Dieser Speicherbereich ist archiviert. Dateien und öffentliche Links sind bis zur Wiederherstellung ausgesetzt." })}
        </PageBanner>
      ) : !canBrowse ? (
        <PageBanner tone="warning">
          {t({ en: "File browsing is not available for this private Storage Space. You can still manage its Portal details.", fr: "La navigation dans les fichiers n'est pas disponible pour cet espace privé. Vous pouvez toujours gérer ses détails Portal.", de: "Dateibrowsing ist für diesen privaten Speicherbereich nicht verfügbar. Die Portal-Details können weiterhin verwaltet werden." })}
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
            onCreatePublicLinkForObject={canCreatePublicLinks ? openPublicLinkDialog : undefined}
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

      {publicLinkTarget ? (
        <Modal
          title={t({ en: "Create public link", fr: "Créer un lien public", de: "Öffentlichen Link erstellen" })}
          onClose={closePublicLinkDialog}
          closeOnBackdropClick={!publicLinkBusy}
          closeOnEscape={!publicLinkBusy}
        >
          <div className="space-y-4">
            {publicLinkError ? <PageBanner tone="warning">{publicLinkError}</PageBanner> : null}
            {publicLinkCopyMessage ? <PageBanner tone="info">{publicLinkCopyMessage}</PageBanner> : null}
            <dl className="grid gap-3 text-xs">
              <div className="grid grid-cols-[130px_1fr] gap-3">
                <dt className={cx("font-semibold", uiMutedTextClass)}>{t({ en: "File", fr: "Fichier", de: "Datei" })}</dt>
                <dd className={cx("min-w-0 break-all font-bold", uiTitleTextClass)}>{publicLinkTarget.name}</dd>
              </div>
              <div className="grid grid-cols-[130px_1fr] gap-3">
                <dt className={cx("font-semibold", uiMutedTextClass)}>{t({ en: "Path", fr: "Chemin", de: "Pfad" })}</dt>
                <dd className="min-w-0 break-all font-mono text-[11px]">{publicLinkTarget.key}</dd>
              </div>
              <div className="grid grid-cols-[130px_1fr] gap-3">
                <dt className={cx("font-semibold", uiMutedTextClass)}>{t({ en: "Storage Space", fr: "Espace de stockage", de: "Speicherbereich" })}</dt>
                <dd className={cx("min-w-0 font-bold", uiTitleTextClass)}>{space.name}</dd>
              </div>
            </dl>
            <label className="grid gap-1 text-xs font-semibold">
              <span className={uiMutedTextClass}>{t({ en: "Expiration", fr: "Expiration", de: "Ablauf" })}</span>
              <input
                type="datetime-local"
                className="ui-control h-9 text-xs"
                value={publicLinkExpiration}
                disabled={publicLinkBusy || Boolean(createdPublicLink)}
                onChange={(event) => setPublicLinkExpiration(event.target.value)}
                aria-label={t({ en: "Public link expiration", fr: "Expiration du lien public", de: "Ablauf des öffentlichen Links" })}
              />
            </label>
            {createdPublicLink ? (
              <div className="rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] p-3">
                <div className={cx("text-[11px] font-semibold uppercase", uiMutedTextClass)}>
                  {t({ en: "Public link", fr: "Lien public", de: "Öffentlicher Link" })}
                </div>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <code className="min-w-0 flex-1 break-all rounded-md bg-[var(--ui-surface)] px-2 py-1 text-[11px]">{createdPublicLink.url}</code>
                  <UiButton size="sm" variant="secondary" onClick={copyCreatedPublicLink}>
                    {t({ en: "Copy link", fr: "Copier le lien", de: "Link kopieren" })}
                  </UiButton>
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <UiButton variant="secondary" onClick={closePublicLinkDialog} disabled={publicLinkBusy}>
                {createdPublicLink ? t({ en: "Done", fr: "Terminer", de: "Fertig" }) : t({ en: "Cancel", fr: "Annuler", de: "Abbrechen" })}
              </UiButton>
              <UiButton
                onClick={handleCreatePublicLink}
                loading={publicLinkBusy}
                disabled={Boolean(createdPublicLink) || !canCreatePublicLinks}
              >
                {publicLinkBusy
                  ? t({ en: "Creating...", fr: "Création...", de: "Wird erstellt..." })
                  : t({ en: "Create link", fr: "Créer le lien", de: "Link erstellen" })}
              </UiButton>
            </div>
          </div>
        </Modal>
      ) : null}

      {pendingAccessChange ? (
        <ConfirmActionDialog
          title={t({ en: "Change access", fr: "Modifier l'accès", de: "Zugriff ändern" })}
          description={t({ en: "Confirm the new access mode for this Storage Space.", fr: "Confirmez le nouveau mode d'accès de cet espace de stockage.", de: "Bestätigen Sie den neuen Zugriffsmodus für diesen Speicherbereich." })}
          confirmLabel={t({ en: "Update access", fr: "Mettre à jour l'accès", de: "Zugriff aktualisieren" })}
          tone="primary"
          loading={accessBusy}
          details={[
            { label: t({ en: "Storage Space", fr: "Espace de stockage", de: "Speicherbereich" }), value: space.name },
            {
              label: t({ en: "New access", fr: "Nouvel accès", de: "Neuer Zugriff" }),
              value: pendingAccessChange.mode === "account"
                ? portalShareScopeLabel("shared", "account", t)
                : pendingAccessChange.mode === "restricted"
                ? portalShareScopeLabel("shared", "restricted", t)
                : portalShareScopeLabel("private", "restricted", t),
            },
          ]}
          impacts={pendingAccessChange.mode === "private"
            ? [
                t({ en: "Only the owner keeps active access.", fr: "Seul le propriétaire conserve un accès actif.", de: "Nur der Eigentümer behält aktiven Zugriff." }),
                t({ en: "Existing direct collaborator grants are kept but become inactive while the Storage Space is private.", fr: "Les droits directs existants sont conservés mais deviennent inactifs tant que l'espace est privé.", de: "Bestehende direkte Berechtigungen bleiben erhalten, sind bei privatem Zugriff aber inaktiv." }),
                t({ en: "Public links are suspended while the Storage Space is private.", fr: "Les liens publics sont suspendus tant que l'espace est privé.", de: "Öffentliche Links sind bei privatem Zugriff ausgesetzt." }),
              ]
            : pendingAccessChange.mode === "account"
            ? [
                t({ en: "Current and future Portal members of this account receive access automatically.", fr: "Les membres Portal actuels et futurs de cet account recevront automatiquement l'accès.", de: "Aktuelle und zukünftige Portal-Mitglieder dieses Accounts erhalten automatisch Zugriff." }),
                t({ en: "Direct collaborator grants remain available for explicit role overrides.", fr: "Les droits directs restent disponibles pour les rôles explicites.", de: "Direkte Berechtigungen bleiben für explizite Rollen erhalten." }),
                t({ en: "Public links remain managed separately.", fr: "Les liens publics restent gérés séparément.", de: "Öffentliche Links werden weiterhin separat verwaltet." }),
              ]
            : [
                t({ en: "Only the owner and direct collaborators keep user access.", fr: "Seuls le propriétaire et les collaborateurs directs conservent un accès utilisateur.", de: "Nur der Eigentümer und direkte Mitwirkende behalten Benutzerzugriff." }),
                t({ en: "Account-wide automatic access stops.", fr: "L'accès automatique à tout l'account s'arrête.", de: "Der automatische accountweite Zugriff endet." }),
                t({ en: "Public links remain managed separately.", fr: "Les liens publics restent gérés séparément.", de: "Öffentliche Links werden weiterhin separat verwaltet." }),
              ]}
          onCancel={() => setPendingAccessChange(null)}
          onConfirm={() => confirmAccessChange(pendingAccessChange)}
        />
      ) : null}

      {pendingAccessRevoke ? (
        <ConfirmActionDialog
          title={t({ en: "Revoke access", fr: "Révoquer l'accès", de: "Zugriff widerrufen" })}
          description={t({ en: "Confirm that you want to remove this direct collaborator.", fr: "Confirmez que vous voulez retirer ce collaborateur direct.", de: "Bestätigen Sie, dass Sie diesen direkten Mitwirkenden entfernen möchten." })}
          confirmLabel={t({ en: "Revoke access", fr: "Révoquer l'accès", de: "Zugriff widerrufen" })}
          loading={accessBusy}
          details={[
            { label: t({ en: "Person", fr: "Personne", de: "Person" }), value: pendingAccessRevoke.email },
            { label: t({ en: "Storage Space", fr: "Espace de stockage", de: "Speicherbereich" }), value: space.name },
            { label: t({ en: "Access", fr: "Accès", de: "Zugriff" }), value: portalRoleLabel(pendingAccessRevoke.role, t) },
          ]}
          impacts={[
            t({ en: "This person loses direct access immediately.", fr: "Cette personne perd immédiatement son accès direct.", de: "Diese Person verliert sofort den direkten Zugriff." }),
            t({ en: "Files in the Storage Space are not deleted.", fr: "Les fichiers de l'espace de stockage ne sont pas supprimés.", de: "Dateien im Speicherbereich werden nicht gelöscht." }),
          ]}
          onCancel={() => setPendingAccessRevoke(null)}
          onConfirm={() => confirmAccessRevoke(pendingAccessRevoke)}
        />
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
            t({ en: "Existing files are kept and are not deleted.", fr: "Les fichiers existants sont conservés et ne sont pas supprimés.", de: "Bestehende Dateien bleiben erhalten und werden nicht gelöscht." }),
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
