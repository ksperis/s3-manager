/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  createPortalStorageSpacePublicLink,
  deletePortalStorageSpace,
  fetchPortalStorageSpaceAccessSummary,
  grantPortalStorageSpaceShare,
  listPortalStorageSpaceShareCandidates,
  portalStorageSpaceVersionCleanupConfirmationPhrase,
  revokePortalStorageSpaceShare,
  restorePortalStorageSpaceObject,
  streamPortalDeletedPrefixRestore,
  streamPortalStorageSpaceVersionCleanup,
  takePortalStorageSpaceOwnership,
  updatePortalStorageSpace,
  updatePortalStorageSpaceShare,
  type PortalDeletedPrefixRestoreProgress,
  type PortalDeletedPrefixRestoreResult,
  type PortalStorageSpaceVersionCleanupProgress,
  type PortalStorageSpaceVersionCleanupResult,
  type PortalPublicLink,
  type PortalStorageSpaceAccountMemberRole,
  type PortalStorageSpaceAccessSummary,
  type PortalStorageSpaceGrantRole,
  type PortalStorageSpaceShare,
  type PortalStorageSpaceShareCandidate,
} from "../../api/portal";
import { createPortalRequest } from "../../api/portalRequests";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import Modal from "../../components/Modal";
import WorkflowPage, { WorkflowActions, workflowPageHostClass } from "../../components/WorkflowPage";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import UiInput from "../../components/ui/UiInput";
import UiMeterBar from "../../components/ui/UiMeterBar";
import UiProgressBar from "../../components/ui/UiProgressBar";
import UiSelect from "../../components/ui/UiSelect";
import {
  cx,
  uiButtonBaseClass,
  uiButtonVariants,
  uiMutedTextClass,
  uiPanelMutedClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { copyTextToClipboard } from "../../utils/clipboard";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import BrowserEmbed from "../browser/BrowserEmbed";
import type {
  BrowserDeletedObjectTarget,
  BrowserObjectDetailsRouteTarget,
} from "../browser/BrowserPage";
import {
  PortalAccessModeFields,
  PortalRoleBadge,
  PortalShareCandidatePicker,
  portalAccessModeFromParts,
  portalAccessPayloadFromMode,
  portalAccessModeDescription,
  portalAccessModeSummary,
  selectedPortalShares,
  type PortalAccessMode,
} from "./PortalAccessControls";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import PortalPageTabs, { PortalTabPanel } from "./PortalPageTabs";
import { storageSpaceObjectPath, storageSpacePath } from "./portalWorkspaceModel";
import { completePortalTransfer, failPortalTransfer, startPortalTransfer } from "./portalTransferTracker";
import {
  PortalPageState,
  portalStorageSpaceStatusTone,
  resolvePortalWorkspacePageState,
} from "./portalUi";
import {
  portalDateTimeLabel,
  portalRoleLabel,
  portalShareScopeLabel,
  portalStatusLabel,
} from "./portalI18n";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

function decodeRouteValue(value?: string): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

type PendingAccessChange = {
  mode: PortalAccessMode;
  accountMemberRole: PortalStorageSpaceAccountMemberRole;
};

type PendingAccessRoleChange = {
  share: PortalStorageSpaceShare;
  role: PortalStorageSpaceGrantRole;
};

type PublicLinkTarget = {
  bucketName: string;
  key: string;
  name: string;
};

type SpaceDetailTab = "files" | "collaborators" | "settings";

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
          <UiMeterBar value={progress} label={`${label} quota usage`} />
        </div>
      ) : null}
    </UiCard>
  );
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export default function PortalStorageSpaceDetailPage() {
  const { locale, t } = useI18n();
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { generalSettings } = useGeneralSettings();
  const [message, setMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SpaceDetailTab>("files");
  const [trashRestoreTarget, setTrashRestoreTarget] =
    useState<BrowserDeletedObjectTarget | null>(null);
  const [restoringTrashKey, setRestoringTrashKey] = useState<string | null>(null);
  const [browserRefreshToken, setBrowserRefreshToken] = useState(0);
  const [deletedPrefixRestoreTarget, setDeletedPrefixRestoreTarget] =
    useState<BrowserObjectDetailsRouteTarget | null>(null);
  const [deletedPrefixRestoreRunning, setDeletedPrefixRestoreRunning] =
    useState(false);
  const [deletedPrefixRestoreProgress, setDeletedPrefixRestoreProgress] =
    useState<PortalDeletedPrefixRestoreProgress | null>(null);
  const [deletedPrefixRestoreResult, setDeletedPrefixRestoreResult] =
    useState<PortalDeletedPrefixRestoreResult | null>(null);
  const [deletedPrefixRestoreError, setDeletedPrefixRestoreError] =
    useState<string | null>(null);
  const deletedPrefixRestoreAbortRef = useRef<AbortController | null>(null);
  const [metadataName, setMetadataName] = useState("");
  const [metadataDescription, setMetadataDescription] = useState("");
  const [metadataBusy, setMetadataBusy] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [historyCleanupConfirmOpen, setHistoryCleanupConfirmOpen] = useState(false);
  const [historyCleanupDialogOpen, setHistoryCleanupDialogOpen] = useState(false);
  const [historyCleanupRunning, setHistoryCleanupRunning] = useState(false);
  const [historyCleanupProgress, setHistoryCleanupProgress] = useState<PortalStorageSpaceVersionCleanupProgress | null>(null);
  const [historyCleanupResult, setHistoryCleanupResult] = useState<PortalStorageSpaceVersionCleanupResult | null>(null);
  const [historyCleanupError, setHistoryCleanupError] = useState<string | null>(null);
  const historyCleanupAbortRef = useRef<AbortController | null>(null);
  const [accessSummary, setAccessSummary] = useState<PortalStorageSpaceAccessSummary | null>(null);
  const [accessSummaryLoading, setAccessSummaryLoading] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessMode, setAccessMode] = useState<PortalAccessMode>("private");
  const [accessAccountMemberRole, setAccessAccountMemberRole] = useState<PortalStorageSpaceAccountMemberRole>("Editor");
  const [accessCandidates, setAccessCandidates] = useState<PortalStorageSpaceShareCandidate[]>([]);
  const [accessCandidateQuery, setAccessCandidateQuery] = useState("");
  const [accessRolesByUserId, setAccessRolesByUserId] = useState<Record<number, PortalStorageSpaceGrantRole>>({});
  const [accessCandidatesLoading, setAccessCandidatesLoading] = useState(false);
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessPeopleDialogOpen, setAccessPeopleDialogOpen] = useState(false);
  const [accessRequestMessage, setAccessRequestMessage] = useState<string | null>(null);
  const [pendingAccessChange, setPendingAccessChange] = useState<PendingAccessChange | null>(null);
  const [pendingAccessRoleChange, setPendingAccessRoleChange] = useState<PendingAccessRoleChange | null>(null);
  const [pendingAccessRevoke, setPendingAccessRevoke] = useState<PortalStorageSpaceShare | null>(null);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [takeOwnershipDialogOpen, setTakeOwnershipDialogOpen] = useState(false);
  const [takeOwnershipBusy, setTakeOwnershipBusy] = useState(false);
  const [publicLinkTarget, setPublicLinkTarget] = useState<PublicLinkTarget | null>(null);
  const [publicLinkExpiration, setPublicLinkExpiration] = useState("");
  const [publicLinkBusy, setPublicLinkBusy] = useState(false);
  const [publicLinkError, setPublicLinkError] = useState<string | null>(null);
  const [createdPublicLink, setCreatedPublicLink] = useState<PortalPublicLink | null>(null);
  const [publicLinkCopyMessage, setPublicLinkCopyMessage] = useState<string | null>(null);
  const {
    workspace,
    state,
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
  const startGuideStorageKey = space
    ? `portal.storage-space-detail.start-guide.dismissed.${accountIdForApi ?? "default"}.${space.id}`
    : null;
  const [startGuideDismissed, setStartGuideDismissed] = useState(false);
  const spaceAccessMode: PortalAccessMode = space ? portalAccessModeFromParts(space.visibility, space.shareScope) : "private";
  const savedAccessMode: PortalAccessMode = accessSummary
    ? accessSummary.mode === "all"
      ? "account"
      : accessSummary.mode
    : spaceAccessMode;
  const savedAccountMemberRole = accessSummary?.default_account_member_role ?? space?.accountMemberRole ?? "Editor";
  const accessChanged = accessMode !== savedAccessMode || (accessMode === "account" && accessAccountMemberRole !== savedAccountMemberRole);
  const selectedAccessShareEntries = selectedPortalShares(accessRolesByUserId);
  const existingAccessRolesByUserId = useMemo(
    () =>
      Object.fromEntries(
        (accessSummary?.explicit_shares ?? [])
          .filter((share) => share.user_id != null)
          .map((share) => [share.user_id as number, share.role]),
      ) as Record<number, PortalStorageSpaceGrantRole>,
    [accessSummary?.explicit_shares],
  );
  const onboardingState = (location.state as { portalSpaceCreated?: boolean; portalSpaceImported?: boolean } | null) ?? null;
  const showSpaceReadyBanner = Boolean(onboardingState?.portalSpaceCreated || onboardingState?.portalSpaceImported);
  const requestedTab = useMemo(
    () => new URLSearchParams(location.search).get("tab"),
    [location.search],
  );
  const showDeletedFiles = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("show_deleted") === "1" || params.get("tab") === "trash";
  }, [location.search]);

  const selectSpaceDetailTab = useCallback(
    (tab: SpaceDetailTab) => {
      setActiveTab(tab);
      const params = new URLSearchParams(location.search);
      if (tab === "files") {
        params.delete("tab");
      } else {
        params.set("tab", tab);
      }
      const search = params.toString();
      navigate(
        {
          pathname: location.pathname,
          search: search ? `?${search}` : "",
        },
        { replace: true },
      );
    },
    [location.pathname, location.search, navigate],
  );

  useEffect(() => {
    if (!space) return;
    setMetadataName(space.name);
    setMetadataDescription(space.description);
    setAccessMode(spaceAccessMode);
    setAccessAccountMemberRole(space.accountMemberRole ?? "Editor");
  }, [space, spaceAccessMode]);

  useEffect(() => {
    if (requestedTab === "trash") {
      setActiveTab("files");
      const params = new URLSearchParams(location.search);
      params.delete("tab");
      params.set("show_deleted", "1");
      navigate(
        {
          pathname: location.pathname,
          search: `?${params.toString()}`,
        },
        { replace: true },
      );
      return;
    }
    if (
      requestedTab === "files" ||
      requestedTab === "collaborators" ||
      requestedTab === "settings"
    ) {
      setActiveTab(requestedTab);
    }
  }, [
    location.pathname,
    location.search,
    navigate,
    requestedTab,
  ]);

  useEffect(() => {
    if (!startGuideStorageKey) {
      setStartGuideDismissed(false);
      return;
    }
    try {
      setStartGuideDismissed(window.localStorage.getItem(startGuideStorageKey) === "true");
    } catch {
      setStartGuideDismissed(false);
    }
  }, [startGuideStorageKey]);

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
      setSettingsDialogOpen(false);
      setMessage(t({ en: "Space updated.", fr: "Espace mis à jour.", de: "Bereich aktualisiert." }));
    } catch (err) {
      console.error(err);
      setMessage(extractApiError(err, t({ en: "Unable to update this space.", fr: "Impossible de mettre à jour cet espace.", de: "Dieser Bereich kann nicht aktualisiert werden." })));
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

  const closeAccessPeopleDialog = () => {
    if (accessBusy) return;
    setAccessPeopleDialogOpen(false);
    setAccessRolesByUserId({});
    setAccessCandidateQuery("");
    setAccessRequestMessage(null);
  };

  const confirmAccessChange = async (change: PendingAccessChange) => {
    if (!space || !accountIdForApi) return;
    setAccessBusy(true);
    setMessage(null);
    try {
      await updatePortalStorageSpace(accountIdForApi, space.id, {
        ...portalAccessPayloadFromMode(change.mode, change.accountMemberRole),
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
      setAccessPeopleDialogOpen(false);
      await loadAccessSummary();
      const addedCount = selectedAccessShareEntries.length;
      setMessage(t({
        en: `${addedCount} ${addedCount === 1 ? "person" : "people"} added to ${space.name}.`,
        fr: `${addedCount} personne${addedCount > 1 ? "s" : ""} ajoutée${addedCount > 1 ? "s" : ""} à ${space.name}.`,
        de: `${addedCount} ${addedCount === 1 ? "Person" : "Personen"} zu ${space.name} hinzugefügt.`,
      }));
    } catch (err) {
      console.error(err);
      setMessage(extractApiError(err, t({ en: "Unable to add people.", fr: "Impossible d'ajouter ces personnes.", de: "Personen können nicht hinzugefügt werden." })));
    } finally {
      setAccessBusy(false);
    }
  };

  const handleAccessRoleChange = (share: PortalStorageSpaceShare, role: PortalStorageSpaceGrantRole) => {
    if (role === share.role) return;
    setPendingAccessRoleChange({ share, role });
  };

  const confirmAccessRoleChange = async ({ share, role }: PendingAccessRoleChange) => {
    if (!space || !accountIdForApi || share.user_id == null) return;
    setAccessBusy(true);
    setMessage(null);
    try {
      await updatePortalStorageSpaceShare(accountIdForApi, space.id, share.user_id, role);
      await loadAccessSummary();
      setPendingAccessRoleChange(null);
      setMessage(t({
        en: `${share.email} now has ${portalRoleLabel(role, t)} access to ${space.name}.`,
        fr: `${share.email} dispose maintenant de l'accès ${portalRoleLabel(role, t)} à ${space.name}.`,
        de: `${share.email} hat jetzt ${portalRoleLabel(role, t)}-Zugriff auf ${space.name}.`,
      }));
    } catch (err) {
      console.error(err);
      setMessage(extractApiError(err, t({ en: "Unable to update this person.", fr: "Impossible de mettre à jour cette personne.", de: "Diese Person kann nicht aktualisiert werden." })));
      setPendingAccessRoleChange(null);
    } finally {
      setAccessBusy(false);
    }
  };

  const handleRequestCollaboratorAccess = async ({
    targetName,
    targetEmail,
  }: {
    targetName: string;
    targetEmail: string;
  }) => {
    if (!accountIdForApi) return;
    try {
      await createPortalRequest(accountIdForApi, {
        request_type: "portal_user_access",
        target_name: targetName,
        target_email: targetEmail,
      });
      setAccessRequestMessage(
        t({
          en: `Request sent. Track it in Help requests, then return to ${space?.name ?? "this space"} to finish the invitation.`,
          fr: `Demande envoyée. Suivez-la dans Demandes d'aide, puis revenez dans ${space?.name ?? "cet espace"} pour terminer l'invitation.`,
          de: `Anfrage gesendet. Verfolgen Sie sie unter Hilfeanfragen und kehren Sie danach zu ${space?.name ?? "diesem Bereich"} zurück, um die Einladung abzuschließen.`,
        }),
      );
    } catch (err) {
      console.error(err);
      throw new Error(
        extractApiError(
          err,
          t({
            en: "Unable to send this request.",
            fr: "Impossible d'envoyer cette demande.",
            de: "Diese Anfrage kann nicht gesendet werden.",
          }),
        ),
      );
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
      setMessage(extractApiError(err, t({ en: "Unable to archive this space.", fr: "Impossible d'archiver cet espace.", de: "Dieser Bereich kann nicht archiviert werden." })));
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
      setMessage(t({ en: "Space restored.", fr: "Espace restauré.", de: "Bereich wiederhergestellt." }));
    } catch (err) {
      console.error(err);
      setMessage(extractApiError(err, t({ en: "Unable to restore this space.", fr: "Impossible de restaurer cet espace.", de: "Dieser Bereich kann nicht wiederhergestellt werden." })));
    } finally {
      setMetadataBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!space || !accountIdForApi || !space.canDelete) return;
    setDeleteBusy(true);
    setDeleteError(null);
    setMessage(null);
    try {
      await deletePortalStorageSpace(accountIdForApi, space.id);
      setDeleteDialogOpen(false);
      refreshWorkspaceData();
      navigate("/portal/storage-spaces", { replace: true });
    } catch (err) {
      console.error(err);
      setDeleteError(
        extractApiError(
          err,
          t({
            en: "Unable to delete this space.",
            fr: "Impossible de supprimer cet espace.",
            de: "Dieser Bereich kann nicht gelöscht werden.",
          })
        )
      );
    } finally {
      setDeleteBusy(false);
    }
  };

  const confirmTakeOwnership = async () => {
    if (!space || !accountIdForApi || !space.canTakeOwnership) return;
    setTakeOwnershipBusy(true);
    setMessage(null);
    try {
      await takePortalStorageSpaceOwnership(accountIdForApi, space.id);
      setTakeOwnershipDialogOpen(false);
      refreshWorkspaceData();
      await loadAccessSummary();
      setMessage(t({ en: "You now own this private space.", fr: "Vous êtes désormais propriétaire de cet espace privé.", de: "Sie besitzen nun diesen privaten Bereich." }));
    } catch (err) {
      console.error(err);
      setMessage(extractApiError(err, t({ en: "Unable to take ownership.", fr: "Impossible de reprendre la propriété.", de: "Eigentümerschaft kann nicht übernommen werden." })));
    } finally {
      setTakeOwnershipBusy(false);
    }
  };

  const confirmTrashRestore = async (item: BrowserDeletedObjectTarget) => {
    if (!space || !accountIdForApi || restoringTrashKey) return;
    setRestoringTrashKey(item.key);
    setMessage(null);
    try {
      await restorePortalStorageSpaceObject(accountIdForApi, space.id, item.key);
      setTrashRestoreTarget(null);
      setBrowserRefreshToken((current) => current + 1);
      refreshWorkspaceData();
      setMessage(
        t({
          en: `${item.name} restored to its original location.`,
          fr: `${item.name} restauré à son emplacement d'origine.`,
          de: `${item.name} wurde am ursprünglichen Ort wiederhergestellt.`,
        }),
      );
    } catch (err) {
      console.error(err);
      setMessage(
        extractApiError(
          err,
          t({
            en: "Unable to restore this file.",
            fr: "Impossible de restaurer ce fichier.",
            de: "Diese Datei kann nicht wiederhergestellt werden.",
          }),
        ),
      );
      setTrashRestoreTarget(null);
    } finally {
      setRestoringTrashKey(null);
    }
  };

  const startDeletedPrefixRestore = async () => {
    if (
      !space ||
      !accountIdForApi ||
      !deletedPrefixRestoreTarget ||
      deletedPrefixRestoreRunning
    ) {
      return;
    }
    const controller = new AbortController();
    deletedPrefixRestoreAbortRef.current = controller;
    setDeletedPrefixRestoreRunning(true);
    setDeletedPrefixRestoreProgress(null);
    setDeletedPrefixRestoreResult(null);
    setDeletedPrefixRestoreError(null);
    try {
      const result = await streamPortalDeletedPrefixRestore(
        accountIdForApi,
        space.id,
        deletedPrefixRestoreTarget.key,
        {
          signal: controller.signal,
          onProgress: setDeletedPrefixRestoreProgress,
        },
      );
      setDeletedPrefixRestoreResult(result);
      setBrowserRefreshToken((current) => current + 1);
      refreshWorkspaceData();
    } catch (err) {
      if (isAbortError(err) || controller.signal.aborted) {
        setDeletedPrefixRestoreError(
          t({
            en: "Restoration stopped. Files already restored remain available.",
            fr: "Restauration arrêtée. Les fichiers déjà restaurés restent disponibles.",
            de: "Wiederherstellung gestoppt. Bereits wiederhergestellte Dateien bleiben verfügbar.",
          }),
        );
        setBrowserRefreshToken((current) => current + 1);
      } else {
        console.error(err);
        setDeletedPrefixRestoreError(
          extractApiError(
            err,
            t({
              en: "Unable to restore the deleted files in this folder.",
              fr: "Impossible de restaurer les fichiers supprimés de ce dossier.",
              de: "Gelöschte Dateien in diesem Ordner konnten nicht wiederhergestellt werden.",
            }),
          ),
        );
      }
    } finally {
      if (deletedPrefixRestoreAbortRef.current === controller) {
        deletedPrefixRestoreAbortRef.current = null;
      }
      setDeletedPrefixRestoreRunning(false);
    }
  };

  const closeDeletedPrefixRestore = () => {
    if (deletedPrefixRestoreRunning) return;
    setDeletedPrefixRestoreTarget(null);
    setDeletedPrefixRestoreProgress(null);
    setDeletedPrefixRestoreResult(null);
    setDeletedPrefixRestoreError(null);
  };

  const pageState = resolvePortalWorkspacePageState({
    accountLoading,
    loading,
    accountError,
    error,
    hasAccountContext,
    loadingMessage: t({ en: "Loading space...", fr: "Chargement de l'espace...", de: "Bereich wird geladen..." }),
    noAccountMessage: t({ en: "Select a project to view this space.", fr: "Sélectionnez un projet pour voir cet espace.", de: "Wählen Sie ein Projekt aus, um diesen Bereich anzuzeigen." }),
  });
  if (pageState) return pageState;

  if (!space || !accountIdForApi) {
    return <PortalPageState>{t({ en: "Space not available.", fr: "Espace indisponible.", de: "Bereich nicht verfügbar." })}</PortalPageState>;
  }

  const browserAvailable =
    Boolean(generalSettings.browser_enabled) && Boolean(generalSettings.browser_portal_enabled);
  const isArchived = space.status === "Archived";
  const canBrowse = Boolean(space.canBrowse) && !isArchived;
  const hasFullAccess = space.role === "Owner" || space.role === "Manager";
  const canRename = hasFullAccess && space.nameEditable;
  const canModifyObjects = canBrowse && (hasFullAccess || space.role === "Editor");
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
  const accessKeysPath = `/portal/access-keys?space_id=${encodeURIComponent(lockedBucketName)}&create=external`;
  const canInvitePeople = !isArchived && space.role === "Manager" && space.visibility === "shared";
  const knownCollaboratorCount = Math.max(
    space.shareCount ?? 0,
    accessSummary?.explicit_shares.length ?? 0
  );
  const collaboratorsUnknown = space.shareCount == null && !accessSummary;
  const spaceHasStarted = (space.objectCount ?? 0) > 0 || knownCollaboratorCount > 0;
  const showStartSpacePanel =
    canModifyObjects &&
    !startGuideDismissed &&
    !collaboratorsUnknown &&
    !spaceHasStarted &&
    (showSpaceReadyBanner || space.objectCount === 0);
  const canCreatePublicLinks = Boolean(
    canBrowse &&
    space.role === "Manager" &&
    space.visibility === "shared" &&
    accessSummary?.can_create_public_links
  );
  const historyCleanupEnabled = Boolean(state?.storage_space_version_cleanup_enabled);
  const canCleanHistory = Boolean(historyCleanupEnabled && !isArchived && hasFullAccess);
  const deletionStatsKnown = space.objectCount != null && space.usedBytes != null;
  const storageSpaceIsEmpty = deletionStatsKnown && space.objectCount === 0 && space.usedBytes === 0;
  const expectedHistoryCleanupConfirmation = portalStorageSpaceVersionCleanupConfirmationPhrase(space.name);
  const historyCleanupDeletedEntries =
    (historyCleanupProgress?.deleted_versions ?? 0) + (historyCleanupProgress?.deleted_delete_markers ?? 0);
  const historyCleanupProgressPercent = historyCleanupProgress
    ? historyCleanupProgress.delete_candidates > 0
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round((historyCleanupDeletedEntries / historyCleanupProgress.delete_candidates) * 100)
          )
        )
      : historyCleanupProgress.stage === "completed"
      ? 100
      : null
      : null;
  const deletedPrefixRestoreProcessed =
    (deletedPrefixRestoreProgress?.restored_objects ?? 0) +
    (deletedPrefixRestoreProgress?.failed_objects ?? 0);
  const deletedPrefixRestoreProgressPercent =
    deletedPrefixRestoreProgress?.total_candidates_final &&
    deletedPrefixRestoreProgress.restore_candidates > 0
      ? Math.min(
          100,
          Math.round(
            (deletedPrefixRestoreProcessed /
              deletedPrefixRestoreProgress.restore_candidates) *
              100,
          ),
        )
      : deletedPrefixRestoreProgress?.stage === "completed"
        ? 100
        : null;
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

  const dismissStartGuide = () => {
    setStartGuideDismissed(true);
    if (!startGuideStorageKey) return;
    try {
      window.localStorage.setItem(startGuideStorageKey, "true");
    } catch {
      // Ignore storage failures; the guide can still be dismissed for this render.
    }
  };

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

  const openHistoryCleanupDialog = () => {
    if (!canCleanHistory) return;
    setHistoryCleanupConfirmOpen(true);
    setHistoryCleanupProgress(null);
    setHistoryCleanupResult(null);
    setHistoryCleanupError(null);
  };

  const closeHistoryCleanupDialog = () => {
    if (historyCleanupRunning) return;
    historyCleanupAbortRef.current?.abort();
    setHistoryCleanupDialogOpen(false);
    setHistoryCleanupProgress(null);
    setHistoryCleanupResult(null);
    setHistoryCleanupError(null);
  };

  const cancelHistoryCleanup = () => {
    historyCleanupAbortRef.current?.abort();
  };

  const runHistoryCleanup = async () => {
    if (!accountIdForApi || !canCleanHistory || historyCleanupRunning) return;
    const controller = new AbortController();
    historyCleanupAbortRef.current = controller;
    setHistoryCleanupRunning(true);
    setHistoryCleanupProgress(null);
    setHistoryCleanupResult(null);
    setHistoryCleanupError(null);
    setMessage(null);
    try {
      const result = await streamPortalStorageSpaceVersionCleanup(
        accountIdForApi,
        space.id,
        { confirmation: expectedHistoryCleanupConfirmation },
        {
          signal: controller.signal,
          onProgress: (event) => setHistoryCleanupProgress(event),
        }
      );
      setHistoryCleanupResult(result);
      refreshWorkspaceData();
      setMessage(
        t({
          en: `History cleanup completed. Estimated space gained: ${formatBytes(result.bytes_freed)}.`,
          fr: `Nettoyage de l'historique terminé. Espace estimé gagné : ${formatBytes(result.bytes_freed)}.`,
          de: `Historienbereinigung abgeschlossen. Geschätzter frei gewordener Speicher: ${formatBytes(result.bytes_freed)}.`,
        })
      );
    } catch (err) {
      if (isAbortError(err)) {
        setHistoryCleanupError(t({ en: "Cleanup canceled.", fr: "Nettoyage annulé.", de: "Bereinigung abgebrochen." }));
      } else {
        setHistoryCleanupError(
          extractApiError(
            err,
            t({
              en: "Unable to clean up this Storage Space history.",
              fr: "Impossible de nettoyer l'historique de cet espace.",
              de: "Der Verlauf dieses Bereichs kann nicht bereinigt werden.",
            })
          )
        );
      }
    } finally {
      setHistoryCleanupRunning(false);
      historyCleanupAbortRef.current = null;
    }
  };

  const confirmHistoryCleanup = () => {
    if (!canCleanHistory || historyCleanupRunning) return;
    setHistoryCleanupConfirmOpen(false);
    setHistoryCleanupDialogOpen(true);
    void runHistoryCleanup();
  };

  const storageSpaceSettingsCard = hasFullAccess ? (
    <UiCard
      title={t({ en: "Space settings", fr: "Paramètres de l'espace", de: "Bereichseinstellungen" })}
      description={t({
        en: "Review the space identity and archive state. Edit only when these details need to change.",
        fr: "Consultez l'identité de l'espace et son état d'archivage. Modifiez uniquement lorsque ces détails doivent changer.",
        de: "Prüfen Sie Identität und Archivstatus des Bereichs. Bearbeiten Sie sie nur, wenn sich diese Details ändern sollen.",
      })}
      actions={
        <div className="flex flex-wrap justify-end gap-2">
          {space.canTakeOwnership ? (
            <UiButton size="sm" variant="secondary" disabled={takeOwnershipBusy} onClick={() => setTakeOwnershipDialogOpen(true)}>
              {t({ en: "Take ownership", fr: "Reprendre la propriété", de: "Eigentümerschaft übernehmen" })}
            </UiButton>
          ) : null}
          <UiButton size="sm" variant="secondary" disabled={metadataBusy} onClick={() => setSettingsDialogOpen(true)}>
            {t({ en: "Edit details", fr: "Modifier", de: "Details bearbeiten" })}
          </UiButton>
          {isArchived ? (
            <UiButton size="sm" variant="secondary" disabled={metadataBusy} onClick={handleRestore}>
              {t({ en: "Restore", fr: "Restaurer", de: "Wiederherstellen" })}
            </UiButton>
          ) : (
            <UiButton size="sm" variant="warning" disabled={metadataBusy} onClick={handleArchive}>
              {t({ en: "Archive", fr: "Archiver", de: "Archivieren" })}
            </UiButton>
          )}
          {space.canDelete ? (
            <UiButton
              size="sm"
              variant="danger"
              disabled={metadataBusy || deleteBusy}
              onClick={() => {
                setDeleteError(null);
                setDeleteDialogOpen(true);
              }}
            >
              {t({ en: "Delete space", fr: "Supprimer l'espace", de: "Bereich löschen" })}
            </UiButton>
          ) : null}
        </div>
      }
    >
      <dl className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div>
          <dt className={cx("text-[11px] font-semibold uppercase", uiMutedTextClass)}>
            {t({ en: "Space name", fr: "Nom de l'espace", de: "Name des Bereichs" })}
          </dt>
          <dd className={cx("mt-1 text-sm font-bold", uiTitleTextClass)}>{space.name}</dd>
        </div>
        <div>
          <dt className={cx("text-[11px] font-semibold uppercase", uiMutedTextClass)}>
            {t({ en: "Description", fr: "Description", de: "Beschreibung" })}
          </dt>
          <dd className={cx("mt-1 text-sm font-medium", space.description ? uiTitleTextClass : uiMutedTextClass)}>
            {space.description || t({ en: "No description", fr: "Aucune description", de: "Keine Beschreibung" })}
          </dd>
        </div>
        <div>
          <dt className={cx("text-[11px] font-semibold uppercase", uiMutedTextClass)}>
            {t({ en: "Status", fr: "Statut", de: "Status" })}
          </dt>
          <dd className="mt-1">
            <UiBadge tone={portalStorageSpaceStatusTone(space)}>{portalStatusLabel(space.status, t)}</UiBadge>
          </dd>
        </div>
        <div>
          <dt className={cx("text-[11px] font-semibold uppercase", uiMutedTextClass)}>
            {t({ en: "Created", fr: "Créé", de: "Erstellt" })}
          </dt>
          <dd className={cx("mt-1 text-sm font-bold", uiTitleTextClass)}>{space.createdLabel}</dd>
        </div>
      </dl>
    </UiCard>
  ) : null;

  const filesSection = (
    <section id="space-files" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className={cx("text-[15px] font-bold", uiTitleTextClass)}>
            {t({ en: "Files", fr: "Fichiers", de: "Dateien" })}
          </h2>
          <p className={cx("mt-1 text-xs leading-5", uiMutedTextClass)}>
            {canModifyObjects
              ? t({ en: "Upload files, create folders, and choose a file to share outside the account.", fr: "Ajoutez des fichiers, créez des dossiers et choisissez un fichier à partager en externe.", de: "Laden Sie Dateien hoch, erstellen Sie Ordner und wählen Sie eine Datei zum externen Teilen aus." })
              : t({ en: "Browse and download the files available to you in this space.", fr: "Parcourez et téléchargez les fichiers disponibles dans cet espace.", de: "Durchsuchen und laden Sie die für Sie verfügbaren Dateien in diesem Bereich herunter." })}
          </p>
        </div>
        {canInvitePeople && savedAccessMode === "restricted" ? (
          <button
            type="button"
            onClick={() => {
              selectSpaceDetailTab("collaborators");
              setAccessPeopleDialogOpen(true);
            }}
            className="text-xs font-bold text-primary hover:underline dark:text-primary-200"
          >
            {t({ en: "Invite collaborators", fr: "Inviter des collaborateurs", de: "Mitwirkende einladen" })}
          </button>
        ) : null}
      </div>
      {isArchived ? (
        <PageBanner tone="warning">
          {t({ en: "This space is archived. Files and public links are suspended until it is restored.", fr: "Cet espace est archivé. Les fichiers et liens publics sont suspendus jusqu'à sa restauration.", de: "Dieser Bereich ist archiviert. Dateien und öffentliche Links sind bis zur Wiederherstellung ausgesetzt." })}
        </PageBanner>
      ) : !canBrowse ? (
        <PageBanner tone="warning">
          {t({ en: "Files are not available for this private space. You can still manage its collaborators and settings.", fr: "Les fichiers ne sont pas disponibles pour cet espace privé. Vous pouvez toujours gérer ses collaborateurs et paramètres.", de: "Dateien sind für diesen privaten Bereich nicht verfügbar. Sie können weiterhin Mitwirkende und Einstellungen verwalten." })}
        </PageBanner>
      ) : browserAvailable ? (
        <div className="min-h-[520px] h-[min(72vh,760px)]">
          <BrowserEmbed
            accountIdForApi={accountIdForApi}
            hasContext={hasAccountContext}
            workspaceSurface="portal"
            functionalProfile="portal"
            layoutMode="standard"
            density="compact"
            capabilityFacts={{
              canWriteObjects: canModifyObjects,
              canDeleteObjects: canModifyObjects,
              canRestoreObjects: canModifyObjects,
              canCreatePublicLinks,
            }}
            lockedBucketName={lockedBucketName}
            lockedBucketLabel={space.name}
            storageEndpointCapabilities={selectedAccount?.storage_endpoint_capabilities ?? null}
            quotaMaxSizeGb={selectedAccount?.quota_max_size_gb ?? null}
            quotaMaxObjects={selectedAccount?.quota_max_objects ?? null}
            onOpenObjectDetailsRoute={(target) => {
              if (target.bucketName !== lockedBucketName) return;
              const params = new URLSearchParams();
              if (target.isDeleted || target.initialTab === "versions") {
                params.set("tab", "history");
                params.set("deleted", "1");
              } else if (target.initialTab) {
                params.set("tab", target.initialTab);
              }
              const query = params.toString();
              navigate(`${storageSpaceObjectPath(space, target.key)}${query ? `?${query}` : ""}`);
            }}
            onCreatePublicLinkForObject={canCreatePublicLinks ? openPublicLinkDialog : undefined}
            refreshToken={browserRefreshToken}
            deletedObjectsOptions={{
              visible: showDeletedFiles,
              showToggle: true,
              canRestore: canModifyObjects,
              onVisibilityChange: (visible) => {
                const params = new URLSearchParams(location.search);
                params.delete("tab");
                if (visible) {
                  params.set("show_deleted", "1");
                } else {
                  params.delete("show_deleted");
                }
                const search = params.toString();
                navigate(
                  {
                    pathname: location.pathname,
                    search: search ? `?${search}` : "",
                  },
                  { replace: true },
                );
              },
              onRestoreObject: canModifyObjects
                ? setTrashRestoreTarget
                : undefined,
              onRestorePrefix: canModifyObjects
                ? (target) => {
                    setDeletedPrefixRestoreTarget(target);
                    setDeletedPrefixRestoreProgress(null);
                    setDeletedPrefixRestoreResult(null);
                    setDeletedPrefixRestoreError(null);
                  }
                : undefined,
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
          {t({ en: "Files are unavailable. Ask an administrator to enable file browsing for this workspace.", fr: "Les fichiers sont indisponibles. Demandez à un administrateur d'activer la navigation pour cet espace de travail.", de: "Dateien sind nicht verfügbar. Bitten Sie einen Administrator, Dateibrowsing für diesen Workspace zu aktivieren." })}
        </PageBanner>
      )}
    </section>
  );

  const startSpacePanel = showStartSpacePanel ? (
    <section className={cx(uiPanelMutedClass, "p-4")} aria-labelledby="space-start-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="space-start-title" className={cx("text-[15px] font-bold", uiTitleTextClass)}>
            {t({ en: "Start this space", fr: "Démarrer cet espace", de: "Diesen Bereich starten" })}
          </h2>
          <p className={cx("mt-1 max-w-3xl text-xs leading-5", uiMutedTextClass)}>
            {t({
              en: "Keep the first steps focused: add the files people need, then invite collaborators when the space is ready.",
              fr: "Gardez les premières étapes simples : ajoutez les fichiers utiles, puis invitez les collaborateurs quand l'espace est prêt.",
              de: "Halten Sie die ersten Schritte fokussiert: Fügen Sie die benötigten Dateien hinzu und laden Sie danach Mitwirkende ein.",
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {space.objectCount === 0 ? (
            <UiBadge tone="warning">{t({ en: "No files yet", fr: "Aucun fichier", de: "Noch keine Dateien" })}</UiBadge>
          ) : null}
          <UiButton size="xs" variant="secondary" onClick={dismissStartGuide}>
            {t({ en: "Dismiss guide", fr: "Masquer le guide", de: "Anleitung ausblenden" })}
          </UiButton>
        </div>
      </div>
      <ol className="mt-4 grid gap-3 md:grid-cols-2">
        <li className="flex min-h-[112px] flex-col justify-between rounded-md border border-[color:var(--ui-border-soft)] bg-[var(--ui-surface)] p-3">
          <div>
            <div className={cx("text-[11px] font-semibold uppercase", uiMutedTextClass)}>
              {t({ en: "Step 1", fr: "Étape 1", de: "Schritt 1" })}
            </div>
            <h3 className={cx("mt-1 text-sm font-bold", uiTitleTextClass)}>
              {t({ en: "Add files or folders", fr: "Ajouter des fichiers ou dossiers", de: "Dateien oder Ordner hinzufügen" })}
            </h3>
            <p className={cx("mt-1 text-xs leading-5", uiMutedTextClass)}>
              {t({
                en: "Use the file area below as the working place for this project or dataset.",
                fr: "Utilisez la zone de fichiers ci-dessous comme espace de travail du projet ou du jeu de données.",
                de: "Nutzen Sie den Dateibereich unten als Arbeitsbereich für dieses Projekt oder diesen Datensatz.",
              })}
            </p>
          </div>
          <div className="mt-3">
            <Link
              to={`${storageSpacePath(space)}#space-files`}
              className={cx(uiButtonBaseClass, uiButtonVariants.primary, "h-8 px-3 py-1.5 text-xs")}
            >
              {t({ en: "Add files", fr: "Ajouter des fichiers", de: "Dateien hinzufügen" })}
            </Link>
          </div>
        </li>
        <li className="flex min-h-[112px] flex-col justify-between rounded-md border border-[color:var(--ui-border-soft)] bg-[var(--ui-surface)] p-3">
          <div>
            <div className={cx("text-[11px] font-semibold uppercase", uiMutedTextClass)}>
              {t({ en: "Step 2", fr: "Étape 2", de: "Schritt 2" })}
            </div>
            <h3 className={cx("mt-1 text-sm font-bold", uiTitleTextClass)}>
              {t({ en: "Invite collaborators", fr: "Inviter des collaborateurs", de: "Mitwirkende einladen" })}
            </h3>
            <p className={cx("mt-1 text-xs leading-5", uiMutedTextClass)}>
              {canInvitePeople
                ? t({
                    en: "Bring people in once the file structure is ready for them.",
                    fr: "Invitez les personnes concernées lorsque l'organisation des fichiers est prête.",
                    de: "Laden Sie Personen ein, sobald die Dateistruktur für sie bereit ist.",
                  })
                : t({
                    en: "This space is private for now. Access can be opened from the Collaborators section when allowed.",
                    fr: "Cet espace est privé pour l'instant. L'accès pourra être ouvert depuis la section Collaborateurs si vous y êtes autorisé.",
                    de: "Dieser Bereich ist vorerst privat. Der Zugriff kann bei entsprechender Berechtigung im Bereich Mitwirkende geöffnet werden.",
                  })}
            </p>
          </div>
          <div className="mt-3">
            {canInvitePeople && savedAccessMode === "restricted" ? (
              <button
                type="button"
                onClick={() => {
                  selectSpaceDetailTab("collaborators");
                  setAccessPeopleDialogOpen(true);
                }}
                className={cx(uiButtonBaseClass, uiButtonVariants.secondary, "h-8 px-3 py-1.5 text-xs")}
              >
                {t({ en: "Invite people", fr: "Inviter", de: "Einladen" })}
              </button>
            ) : (
              <span className={cx("text-xs font-semibold", uiMutedTextClass)}>
                {t({ en: "Private for now", fr: "Privé pour l'instant", de: "Vorerst privat" })}
              </span>
            )}
          </div>
        </li>
      </ol>
    </section>
  ) : null;

  const spaceMetricsSection = (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label={t({ en: "Space summary", fr: "Résumé de l'espace", de: "Bereichszusammenfassung" })}>
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
  );

  const externalToolsCard = (
    <UiCard title={t({ en: "Connect external tools", fr: "Connecter des outils externes", de: "Externe Werkzeuge verbinden" })}>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
        <div>
          <div className={cx("text-[11px] font-semibold uppercase", uiMutedTextClass)}>
            {t({ en: "Space", fr: "Espace", de: "Bereich" })}
          </div>
          <div className={cx("mt-1 break-all text-sm font-bold", uiTitleTextClass)}>{space.name}</div>
        </div>
        <div>
          <div className={cx("text-[11px] font-semibold uppercase", uiMutedTextClass)}>
            {t({ en: "Manual storage name", fr: "Nom de stockage manuel", de: "Manueller Speichername" })}
          </div>
          <div className={cx("mt-1 break-all font-mono text-sm font-bold", uiTitleTextClass)}>{lockedBucketName}</div>
        </div>
        {isArchived ? (
          <span className="inline-flex h-9 items-center justify-center rounded-md border border-[color:var(--ui-border)] px-3 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-300">
            {t({ en: "Unavailable while archived", fr: "Indisponible si archivé", de: "Archiviert nicht verfügbar" })}
          </span>
        ) : (
          <Link
            to={accessKeysPath}
            className="inline-flex h-9 items-center justify-center rounded-md border border-[color:var(--ui-border)] px-3 py-1.5 text-xs font-semibold text-primary hover:bg-[color:var(--ui-hover)] hover:text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 dark:text-primary-200"
          >
            {t({ en: "Connection details", fr: "Détails de connexion", de: "Verbindungsdetails" })}
          </Link>
        )}
      </div>
      <p className={cx("mt-3 ui-caption", uiMutedTextClass)}>
        {isArchived
          ? t({ en: "Archived spaces have no active external-tool access.", fr: "Les espaces archivés n'ont aucun accès actif pour les outils externes.", de: "Archivierte Bereiche haben keinen aktiven Zugriff für externe Werkzeuge." })
          : t({
              en: "Use this only when an external app asks for a storage or bucket name. Portal keeps showing the space name everywhere else.",
              fr: "Utilisez ce nom uniquement lorsqu'une application externe demande un nom de stockage ou de bucket. Portal continue d'afficher le nom de l'espace partout ailleurs.",
              de: "Verwenden Sie dies nur, wenn eine externe App nach einem Speicher- oder Bucket-Namen fragt. Portal zeigt sonst überall den Bereichsnamen.",
            })}
      </p>
    </UiCard>
  );

  const historyCleanupCard = hasFullAccess ? (
    <UiCard
      title={t({ en: "History cleanup", fr: "Nettoyage de l'historique", de: "Historie bereinigen" })}
      description={t({
        en: "Remove older file history and leftover deletion records when a space needs to reclaim storage.",
        fr: "Supprimez l'ancien historique des fichiers et les traces de suppression restantes lorsqu'un espace doit récupérer du stockage.",
        de: "Entfernen Sie ältere Dateihistorie und verbliebene Löschvermerke, wenn ein Bereich Speicher zurückgewinnen muss.",
      })}
      actions={
        <UiButton
          size="sm"
          variant="danger"
          disabled={!canCleanHistory || historyCleanupRunning}
          onClick={openHistoryCleanupDialog}
        >
          {t({ en: "Clean up history", fr: "Nettoyer l'historique", de: "Historie bereinigen" })}
        </UiButton>
      }
    >
      <div className="space-y-3">
        {!historyCleanupEnabled ? (
          <PageBanner tone="info">
            {t({
              en: "History cleanup is disabled for this project.",
              fr: "Le nettoyage de l'historique est désactivé pour ce projet.",
              de: "Die Historienbereinigung ist für dieses Projekt deaktiviert.",
            })}
          </PageBanner>
        ) : isArchived ? (
          <PageBanner tone="warning">
            {t({
              en: "Restore this space before running history cleanup.",
              fr: "Restaurez cet espace avant de nettoyer son historique.",
              de: "Stellen Sie diesen Bereich wieder her, bevor Sie die Historie bereinigen.",
            })}
          </PageBanner>
        ) : (
          <p className={cx("ui-caption", uiMutedTextClass)}>
            {t({
              en: "Current files stay available. The cleanup only removes older file history and leftover deletion records.",
              fr: "Les fichiers courants restent disponibles. Le nettoyage retire uniquement l'ancien historique des fichiers et les traces de suppression restantes.",
              de: "Aktuelle Dateien bleiben verfügbar. Die Bereinigung entfernt nur ältere Dateihistorie und verbliebene Löschvermerke.",
            })}
          </p>
        )}
      </div>
    </UiCard>
  ) : null;

  return (
    <div
      className={workflowPageHostClass(
        accessPeopleDialogOpen ||
          historyCleanupDialogOpen ||
          Boolean(deletedPrefixRestoreTarget),
      )}
    >
      <PageHeader
        title={space.name}
        description={pageDescription}
        breadcrumbs={portalBreadcrumbs({ label: t({ en: "Spaces", fr: "Espaces", de: "Bereiche" }), to: "/portal/storage-spaces" }, { label: space.name })}
        inlineContent={<UiBadge tone={portalStorageSpaceStatusTone(space)}>{portalStatusLabel(space.status, t)}</UiBadge>}
        actions={[
          ...(canModifyObjects
            ? [{
                label: t({ en: "Upload files", fr: "Ajouter des fichiers", de: "Dateien hochladen" }),
                to: `${storageSpacePath(space)}#space-files`,
              }]
            : []),
          ...(canInvitePeople && savedAccessMode === "restricted"
            ? [{
                label: t({ en: "Invite people", fr: "Inviter", de: "Einladen" }),
                onClick: () => {
                  selectSpaceDetailTab("collaborators");
                  setAccessPeopleDialogOpen(true);
                },
                variant: "secondary" as const,
              }]
            : []),
        ]}
      />

      {message ? <PageBanner tone="info">{message}</PageBanner> : null}
      {showSpaceReadyBanner ? (
        <PageBanner tone="success">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-bold">
                {onboardingState?.portalSpaceImported
                  ? t({ en: "Space added.", fr: "Espace ajouté.", de: "Bereich hinzugefügt." })
                  : t({ en: "Space created.", fr: "Espace créé.", de: "Bereich erstellt." })}
              </div>
              <div className="mt-1">
                {t({
                  en: "Use the start guide below to add files and bring collaborators in at the right time.",
                  fr: "Utilisez le guide de démarrage ci-dessous pour ajouter des fichiers et inviter les collaborateurs au bon moment.",
                  de: "Nutzen Sie die Starthilfe unten, um Dateien hinzuzufügen und Mitwirkende zum richtigen Zeitpunkt einzuladen.",
                })}
              </div>
            </div>
          </div>
        </PageBanner>
      ) : null}

      <PortalPageTabs
        tabs={[
          { id: "files", label: t({ en: "Files", fr: "Fichiers", de: "Dateien" }) },
          { id: "collaborators", label: t({ en: "Collaborators", fr: "Collaborateurs", de: "Mitwirkende" }) },
          { id: "settings", label: t({ en: "Settings", fr: "Réglages", de: "Einstellungen" }) },
        ]}
        activeTab={activeTab}
        onChange={(tab) => selectSpaceDetailTab(tab as SpaceDetailTab)}
        ariaLabel={t({
          en: "Space sections",
          fr: "Sections de l'espace",
          de: "Bereichsabschnitte",
        })}
        idPrefix="portal-space-detail"
      />

      {activeTab === "files" ? (
        <PortalTabPanel idPrefix="portal-space-detail" tabId="files">
          {startSpacePanel}
          {filesSection}
          {spaceMetricsSection}
        </PortalTabPanel>
      ) : null}

      {activeTab === "collaborators" ? (
        <PortalTabPanel idPrefix="portal-space-detail" tabId="collaborators">
          <UiCard>
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
                    ? t({ en: "Archived spaces have no active collaborator access.", fr: "Les espaces archivés n'ont aucun accès collaborateur actif.", de: "Archivierte Bereiche haben keinen aktiven Mitwirkendenzugriff." })
                    : portalAccessModeDescription(savedAccessMode, t)}
                </p>
                <p className={cx("mt-1 text-[11px] font-semibold", uiMutedTextClass)}>
                  {portalAccessModeSummary(savedAccessMode, accessSummary.explicit_shares.length, accessSummary.effective_member_count, t)}
                </p>
              </div>
              <div>
                <div className={cx("text-[11px] font-semibold uppercase", uiMutedTextClass)}>
                  {accessSummary.owner
                    ? t({ en: "Owner", fr: "Propriétaire", de: "Eigentümer" })
                    : t({ en: "Managed by", fr: "Géré par", de: "Verwaltet von" })}
                </div>
                <div className={cx("mt-1 font-bold", uiTitleTextClass)}>
                  {accessSummary.owner
                    ? accessSummary.owner.display_name || accessSummary.owner.email
                    : t({ en: "Project managers", fr: "Gestionnaires du projet", de: "Projektmanager" })}
                </div>
                {accessSummary.owner ? (
                  <div className={cx("text-[11px] font-medium", uiMutedTextClass)}>{accessSummary.owner.email}</div>
                ) : null}
              </div>
              <div>
                <div className={cx("text-[11px] font-semibold uppercase", uiMutedTextClass)}>
                  {t({ en: "Public links", fr: "Liens publics", de: "Öffentliche Links" })}
                </div>
                <Link
                  to={`/portal/shares?view=links&space_id=${encodeURIComponent(space.id)}`}
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
                <PageBanner tone="info">
                  {t({
                    en: "Project membership makes a person eligible to be invited. File access is controlled here for this space.",
                    fr: "Être membre du projet permet d'être invité. L'accès réel aux fichiers se règle ici, pour cet espace.",
                    de: "Die Projektmitgliedschaft ermöglicht eine Einladung. Der tatsächliche Dateizugriff wird hier für diesen Bereich festgelegt.",
                  })}
                </PageBanner>
                <PortalAccessModeFields
                  mode={accessMode}
                  onModeChange={setAccessMode}
                  accountMemberRole={accessAccountMemberRole}
                  onAccountMemberRoleChange={setAccessAccountMemberRole}
                  disabled={accessBusy || isArchived}
                  allowedModes={["account", "restricted"]}
                  modeLabel={t({ en: "Who can access this space?", fr: "Qui peut accéder à cet espace ?", de: "Wer kann auf diesen Bereich zugreifen?" })}
                  roleLabel={t({ en: "Default role for team members", fr: "Rôle par défaut des membres", de: "Standardrolle für Teammitglieder" })}
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
                <span className={cx("text-[11px] font-semibold", uiMutedTextClass)}>
                  {t({
                    en: "Roles below apply only to this space.",
                    fr: "Les rôles ci-dessous s'appliquent uniquement à cet espace.",
                    de: "Die folgenden Rollen gelten nur für diesen Bereich.",
                  })}
                </span>
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
                        <UiSelect
                          size="compact"
                          className="h-8"
                          value={share.role}
                          disabled={accessBusy || accessChanged || isArchived}
                          onChange={(event) => handleAccessRoleChange(share, event.target.value as PortalStorageSpaceGrantRole)}
                          aria-label={t({ en: `Access for ${share.email}`, fr: `Accès pour ${share.email}`, de: `Zugriff für ${share.email}` })}
                        >
                          <option value="Viewer">{portalRoleLabel("Viewer", t)}</option>
                          <option value="Editor">{portalRoleLabel("Editor", t)}</option>
                        </UiSelect>
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
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className={cx("text-sm font-bold", uiTitleTextClass)}>
                      {t({ en: "Add people", fr: "Ajouter des personnes", de: "Personen hinzufügen" })}
                    </h3>
                    <p className={cx("mt-1 text-xs font-semibold", uiMutedTextClass)}>
                      {t({
                        en: "Invite collaborators when this space is ready to share.",
                        fr: "Invitez des collaborateurs lorsque cet espace est prêt à être partagé.",
                        de: "Laden Sie Mitwirkende ein, wenn dieser Bereich bereit zum Teilen ist.",
                      })}
                    </p>
                  </div>
                  <UiButton
                    size="sm"
                    disabled={accessBusy || accessChanged || isArchived}
                    onClick={() => setAccessPeopleDialogOpen(true)}
                  >
                    {t({ en: "Add people", fr: "Ajouter", de: "Hinzufügen" })}
                  </UiButton>
                </div>
                {accessChanged ? (
                  <div className={cx("text-xs font-semibold", uiMutedTextClass)}>
                    {t({ en: "Save the access mode before editing direct collaborators.", fr: "Enregistrez le mode d'accès avant de modifier les collaborateurs directs.", de: "Speichern Sie den Zugriffsmodus, bevor Sie direkte Mitwirkende bearbeiten." })}
                  </div>
                ) : null}
              </div>
            ) : null}
            </div>
          ) : null}
          </UiCard>
        </PortalTabPanel>
      ) : null}

      {activeTab === "settings" ? (
        <PortalTabPanel idPrefix="portal-space-detail" tabId="settings">
          {storageSpaceSettingsCard}
          {historyCleanupCard}
          {externalToolsCard}
        </PortalTabPanel>
      ) : null}

      {trashRestoreTarget ? (
        <ConfirmActionDialog
          title={t({
            en: "Restore this file?",
            fr: "Restaurer ce fichier ?",
            de: "Diese Datei wiederherstellen?",
          })}
          description={t({
            en: "The latest recoverable version will return to its original folder.",
            fr: "La dernière version récupérable retournera dans son dossier d'origine.",
            de: "Die neueste wiederherstellbare Version wird in ihren ursprünglichen Ordner zurückgelegt.",
          })}
          confirmLabel={t({
            en: "Restore file",
            fr: "Restaurer le fichier",
            de: "Datei wiederherstellen",
          })}
          cancelLabel={t({ en: "Cancel", fr: "Annuler", de: "Abbrechen" })}
          tone="primary"
          loading={restoringTrashKey === trashRestoreTarget.key}
          details={[
            {
              label: t({ en: "File", fr: "Fichier", de: "Datei" }),
              value: trashRestoreTarget.name,
            },
            {
              label: t({ en: "Original location", fr: "Emplacement d'origine", de: "Ursprünglicher Ort" }),
              value: trashRestoreTarget.key,
              mono: true,
            },
            {
              label: t({ en: "Deleted", fr: "Supprimé", de: "Gelöscht" }),
              value: portalDateTimeLabel(trashRestoreTarget.deletedAt, locale),
            },
          ]}
          impacts={[
            t({
              en: "The file will reappear in Files at the same location.",
              fr: "Le fichier réapparaîtra dans Fichiers, au même emplacement.",
              de: "Die Datei erscheint unter Dateien wieder am selben Ort.",
            }),
            t({
              en: "Its previous history remains available.",
              fr: "Son historique précédent reste disponible.",
              de: "Der bisherige Verlauf bleibt verfügbar.",
            }),
          ]}
          onCancel={() => setTrashRestoreTarget(null)}
          onConfirm={() => void confirmTrashRestore(trashRestoreTarget)}
        />
      ) : null}

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
                <dt className={cx("font-semibold", uiMutedTextClass)}>{t({ en: "Space", fr: "Espace", de: "Bereich" })}</dt>
                <dd className={cx("min-w-0 font-bold", uiTitleTextClass)}>{space.name}</dd>
              </div>
            </dl>
            <UiInput
              type="datetime-local"
              label={t({ en: "Expiration", fr: "Expiration", de: "Ablauf" })}
              size="compact"
              className="h-9"
              value={publicLinkExpiration}
              disabled={publicLinkBusy || Boolean(createdPublicLink)}
              onChange={(event) => setPublicLinkExpiration(event.target.value)}
              aria-label={t({ en: "Public link expiration", fr: "Expiration du lien public", de: "Ablauf des öffentlichen Links" })}
            />
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

      {accessPeopleDialogOpen && accessSummary?.can_manage_access && savedAccessMode === "restricted" ? (
        <WorkflowPage
          title={t({ en: "Add people", fr: "Ajouter des personnes", de: "Personen hinzufügen" })}
          description={t({
            en: "Choose collaborators and assign the role they need for this space.",
            fr: "Choisissez les collaborateurs et attribuez-leur le rôle nécessaire pour cet espace.",
            de: "Wählen Sie Mitwirkende aus und vergeben Sie die passende Rolle für diesen Bereich.",
          })}
          breadcrumbs={portalBreadcrumbs(
            { label: t({ en: "Spaces", fr: "Espaces", de: "Bereiche" }), to: "/portal/storage-spaces" },
            { label: space.name },
            { label: t({ en: "Add people", fr: "Ajouter", de: "Hinzufügen" }) },
          )}
          backLabel={t({ en: "Back to the space", fr: "Retour à l'espace", de: "Zurück zum Bereich" })}
          onBack={accessBusy ? undefined : closeAccessPeopleDialog}
          width="wide"
        >
          <div className="space-y-4">
            {accessError ? <PageBanner tone="error">{accessError}</PageBanner> : null}
            {accessRequestMessage ? (
              <PageBanner tone="success">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>{accessRequestMessage}</span>
                  <Link
                    to="/portal/requests"
                    className="text-xs font-bold text-primary hover:underline dark:text-primary-200"
                  >
                    {t({
                      en: "Open Help requests",
                      fr: "Ouvrir les demandes d'aide",
                      de: "Hilfeanfragen öffnen",
                    })}
                  </Link>
                </div>
              </PageBanner>
            ) : null}
            <div className={cx(uiPanelMutedClass, "grid gap-3 p-3 sm:grid-cols-2")}>
              <div>
                <div className={cx("text-xs font-bold", uiTitleTextClass)}>
                  {portalRoleLabel("Viewer", t)}
                </div>
                <p className={cx("mt-1 text-xs leading-5", uiMutedTextClass)}>
                  {t({
                    en: "Can browse and download files in this space.",
                    fr: "Peut consulter et télécharger les fichiers de cet espace.",
                    de: "Kann Dateien in diesem Bereich ansehen und herunterladen.",
                  })}
                </p>
              </div>
              <div>
                <div className={cx("text-xs font-bold", uiTitleTextClass)}>
                  {portalRoleLabel("Editor", t)}
                </div>
                <p className={cx("mt-1 text-xs leading-5", uiMutedTextClass)}>
                  {t({
                    en: "Can also upload, create folders, and remove files.",
                    fr: "Peut aussi ajouter des fichiers, créer des dossiers et supprimer des fichiers.",
                    de: "Kann außerdem Dateien hochladen, Ordner erstellen und Dateien entfernen.",
                  })}
                </p>
              </div>
            </div>
            <PortalShareCandidatePicker
              candidates={accessCandidates}
              selectedRolesByUserId={accessRolesByUserId}
              existingRolesByUserId={existingAccessRolesByUserId}
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
              onRequestPerson={handleRequestCollaboratorAccess}
            />
            <WorkflowActions>
              <UiButton
                variant="secondary"
                disabled={accessBusy}
                onClick={closeAccessPeopleDialog}
              >
                {t({ en: "Cancel", fr: "Annuler", de: "Abbrechen" })}
              </UiButton>
              <UiButton
                loading={accessBusy}
                disabled={accessBusy || accessChanged || selectedAccessShareEntries.length === 0 || isArchived}
                onClick={handleAddAccessPeople}
              >
                {t({ en: "Add people", fr: "Ajouter", de: "Hinzufügen" })}
              </UiButton>
            </WorkflowActions>
          </div>
        </WorkflowPage>
      ) : null}

      {historyCleanupConfirmOpen ? (
        <ConfirmActionDialog
          title={t({ en: "Clean up history", fr: "Nettoyer l'historique", de: "Historie bereinigen" })}
          description={t({
            en: "Confirm that you want to permanently remove older file history from this space.",
            fr: "Confirmez la suppression définitive de l'ancien historique des fichiers de cet espace.",
            de: "Bestätigen Sie, dass ältere Dateihistorie aus diesem Bereich dauerhaft entfernt werden soll.",
          })}
          confirmLabel={t({ en: "Start cleanup", fr: "Démarrer le nettoyage", de: "Bereinigung starten" })}
          cancelLabel={t({ en: "Cancel", fr: "Annuler", de: "Abbrechen" })}
          details={[
            { label: t({ en: "Space", fr: "Espace", de: "Bereich" }), value: space.name },
            {
              label: t({ en: "Current storage", fr: "Stockage courant", de: "Aktueller Speicher" }),
              value: formatBytes(space.usedBytes),
            },
          ]}
          impacts={[
            t({
              en: "Current files stay available.",
              fr: "Les fichiers courants restent disponibles.",
              de: "Aktuelle Dateien bleiben verfügbar.",
            }),
            t({
              en: "Older file versions and leftover deletion records are permanently removed.",
              fr: "Les anciennes versions de fichiers et les traces de suppression restantes sont supprimées définitivement.",
              de: "Ältere Dateiversionen und verbliebene Löschvermerke werden dauerhaft entfernt.",
            }),
            t({
              en: "The cleanup scans the entire space and can take some time.",
              fr: "Le nettoyage parcourt tout l'espace et peut prendre du temps.",
              de: "Die Bereinigung durchsucht den gesamten Bereich und kann einige Zeit dauern.",
            }),
          ]}
          onCancel={() => setHistoryCleanupConfirmOpen(false)}
          onConfirm={confirmHistoryCleanup}
        />
      ) : null}

      {deletedPrefixRestoreTarget ? (
        <WorkflowPage
          title={t({
            en: "Restore deleted files",
            fr: "Restaurer les fichiers supprimés",
            de: "Gelöschte Dateien wiederherstellen",
          })}
          description={t({
            en: "Restore recoverable files from this folder and its subfolders.",
            fr: "Restaurez les fichiers récupérables de ce dossier et de ses sous-dossiers.",
            de: "Stellen Sie wiederherstellbare Dateien aus diesem Ordner und seinen Unterordnern wieder her.",
          })}
          breadcrumbs={portalBreadcrumbs(
            {
              label: t({
                en: "Spaces",
                fr: "Espaces",
                de: "Bereiche",
              }),
              to: "/portal/storage-spaces",
            },
            { label: space.name },
            {
              label: t({
                en: "Restore folder",
                fr: "Restaurer le dossier",
                de: "Ordner wiederherstellen",
              }),
            },
          )}
          backLabel={t({
            en: "Back to files",
            fr: "Retour aux fichiers",
            de: "Zurück zu Dateien",
          })}
          onBack={
            deletedPrefixRestoreRunning
              ? undefined
              : closeDeletedPrefixRestore
          }
          width="standard"
        >
          <div className="space-y-4">
            {deletedPrefixRestoreError ? (
              <PageBanner tone="warning">
                {deletedPrefixRestoreError}
              </PageBanner>
            ) : null}
            <PageBanner tone="info">
              {t({
                en: "Only files that are currently deleted are restored. Existing files and version history are kept.",
                fr: "Seuls les fichiers actuellement supprimés sont restaurés. Les fichiers existants et leur historique sont conservés.",
                de: "Nur aktuell gelöschte Dateien werden wiederhergestellt. Vorhandene Dateien und der Versionsverlauf bleiben erhalten.",
              })}
            </PageBanner>
            <dl className="grid gap-3 text-xs sm:grid-cols-2">
              <div>
                <dt className={cx("font-semibold uppercase", uiMutedTextClass)}>
                  {t({ en: "Space", fr: "Espace", de: "Bereich" })}
                </dt>
                <dd className={cx("mt-1 font-bold", uiTitleTextClass)}>
                  {space.name}
                </dd>
              </div>
              <div>
                <dt className={cx("font-semibold uppercase", uiMutedTextClass)}>
                  {t({
                    en: "Folder",
                    fr: "Dossier",
                    de: "Ordner",
                  })}
                </dt>
                <dd className={cx("mt-1 break-all font-mono", uiTitleTextClass)}>
                  {deletedPrefixRestoreTarget.key}
                </dd>
              </div>
            </dl>

            {deletedPrefixRestoreProgress ? (
              <div className="rounded-md border border-[color:var(--ui-border)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className={cx("ui-caption font-semibold", uiTitleTextClass)}>
                    {deletedPrefixRestoreProgress.message ??
                      deletedPrefixRestoreProgress.stage}
                  </p>
                  <p className={cx("ui-caption", uiMutedTextClass)}>
                    {formatCompactNumber(deletedPrefixRestoreProcessed)} /{" "}
                    {deletedPrefixRestoreProgress.total_candidates_final
                      ? formatCompactNumber(
                          deletedPrefixRestoreProgress.restore_candidates,
                        )
                      : t({
                          en: "discovering",
                          fr: "détection",
                          de: "wird ermittelt",
                        })}
                  </p>
                </div>
                {deletedPrefixRestoreProgressPercent === null ? (
                  <div
                    className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--ui-surface-muted)]"
                    role="progressbar"
                    aria-label={t({
                      en: "Deleted file restoration progress",
                      fr: "Progression de la restauration",
                      de: "Fortschritt der Wiederherstellung",
                    })}
                  >
                    <div className="h-full w-full animate-pulse rounded-full bg-primary/70" />
                  </div>
                ) : (
                  <UiProgressBar
                    value={deletedPrefixRestoreProgressPercent}
                    label={t({
                      en: "Deleted file restoration progress",
                      fr: "Progression de la restauration",
                      de: "Fortschritt der Wiederherstellung",
                    })}
                    className="mt-2 h-2 bg-[var(--ui-surface-muted)]"
                  />
                )}
                <p className={cx("mt-2 ui-caption", uiMutedTextClass)}>
                  {t({
                    en: `${formatCompactNumber(deletedPrefixRestoreProgress.scanned_versions)} versions and ${formatCompactNumber(deletedPrefixRestoreProgress.scanned_delete_markers)} deletion records scanned.`,
                    fr: `${formatCompactNumber(deletedPrefixRestoreProgress.scanned_versions)} versions et ${formatCompactNumber(deletedPrefixRestoreProgress.scanned_delete_markers)} traces de suppression analysées.`,
                    de: `${formatCompactNumber(deletedPrefixRestoreProgress.scanned_versions)} Versionen und ${formatCompactNumber(deletedPrefixRestoreProgress.scanned_delete_markers)} Löschvermerke geprüft.`,
                  })}
                </p>
              </div>
            ) : null}

            {deletedPrefixRestoreResult ? (
              <>
                <div className="grid gap-2 sm:grid-cols-3">
                  <ObjectMetricCard
                    label={t({
                      en: "Found",
                      fr: "Trouvés",
                      de: "Gefunden",
                    })}
                    value={formatCompactNumber(
                      deletedPrefixRestoreResult.restore_candidates,
                    )}
                    detail={t({
                      en: "recoverable files",
                      fr: "fichiers récupérables",
                      de: "wiederherstellbare Dateien",
                    })}
                  />
                  <ObjectMetricCard
                    label={t({
                      en: "Restored",
                      fr: "Restaurés",
                      de: "Wiederhergestellt",
                    })}
                    value={formatCompactNumber(
                      deletedPrefixRestoreResult.restored_objects,
                    )}
                    detail={t({
                      en: "returned to their folders",
                      fr: "replacés dans leurs dossiers",
                      de: "in ihre Ordner zurückgelegt",
                    })}
                  />
                  <ObjectMetricCard
                    label={t({
                      en: "Not restored",
                      fr: "Non restaurés",
                      de: "Nicht wiederhergestellt",
                    })}
                    value={formatCompactNumber(
                      deletedPrefixRestoreResult.failed_objects,
                    )}
                    detail={t({
                      en: "review below",
                      fr: "à vérifier ci-dessous",
                      de: "unten prüfen",
                    })}
                  />
                </div>
                {deletedPrefixRestoreResult.failures.length > 0 ? (
                  <div className={uiPanelMutedClass}>
                    <p className={cx("ui-caption font-semibold", uiTitleTextClass)}>
                      {t({
                        en: "Files requiring attention",
                        fr: "Fichiers à vérifier",
                        de: "Zu prüfende Dateien",
                      })}
                    </p>
                    <ul className="mt-2 space-y-1 ui-caption">
                      {deletedPrefixRestoreResult.failures.map((failure) => (
                        <li key={failure.key} className="break-all">
                          <span className="font-mono">{failure.key}</span>
                          {" — "}
                          {failure.detail}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : null}

            <WorkflowActions>
              {deletedPrefixRestoreRunning ? (
                <UiButton
                  variant="secondary"
                  onClick={() =>
                    deletedPrefixRestoreAbortRef.current?.abort()
                  }
                >
                  {t({
                    en: "Stop",
                    fr: "Arrêter",
                    de: "Stoppen",
                  })}
                </UiButton>
              ) : deletedPrefixRestoreResult ? (
                <UiButton onClick={closeDeletedPrefixRestore}>
                  {t({ en: "Done", fr: "Terminer", de: "Fertig" })}
                </UiButton>
              ) : (
                <>
                  <UiButton
                    variant="secondary"
                    onClick={closeDeletedPrefixRestore}
                  >
                    {t({ en: "Cancel", fr: "Annuler", de: "Abbrechen" })}
                  </UiButton>
                  <UiButton onClick={() => void startDeletedPrefixRestore()}>
                    {t({
                      en: "Restore files",
                      fr: "Restaurer les fichiers",
                      de: "Dateien wiederherstellen",
                    })}
                  </UiButton>
                </>
              )}
            </WorkflowActions>
          </div>
        </WorkflowPage>
      ) : null}

      {historyCleanupDialogOpen ? (
        <WorkflowPage
          title={t({ en: "Clean up history", fr: "Nettoyer l'historique", de: "Historie bereinigen" })}
          description={t({
            en: "Review the impact, follow the complete scan and keep the cleanup result visible.",
            fr: "Vérifiez l'impact, suivez l'analyse complète et conservez le résultat du nettoyage visible.",
            de: "Prüfen Sie die Auswirkungen, verfolgen Sie den vollständigen Scan und behalten Sie das Ergebnis sichtbar.",
          })}
          breadcrumbs={portalBreadcrumbs(
            { label: t({ en: "Spaces", fr: "Espaces", de: "Bereiche" }), to: "/portal/storage-spaces" },
            { label: space.name },
            {
              label: t({
                en: "History cleanup",
                fr: "Nettoyage de l'historique",
                de: "Historienbereinigung",
              }),
            },
          )}
          backLabel={t({ en: "Back to the space", fr: "Retour à l'espace", de: "Zurück zum Bereich" })}
          onBack={historyCleanupRunning ? undefined : closeHistoryCleanupDialog}
          width="standard"
        >
          <div className="space-y-4">
            {historyCleanupError ? <PageBanner tone="warning">{historyCleanupError}</PageBanner> : null}
            <PageBanner tone="warning">
              {t({
                en: "This scans the entire space, deletes older file versions, then removes leftover deletion records. Current files are kept, but deleted history cannot be restored from Portal.",
                fr: "Cette opération parcourt tout l'espace, supprime les anciennes versions de fichiers, puis retire les traces de suppression restantes. Les fichiers courants sont conservés, mais l'historique supprimé ne pourra pas être restauré depuis Portal.",
                de: "Diese Aktion durchsucht den gesamten Bereich, löscht ältere Dateiversionen und entfernt verbliebene Löschvermerke. Aktuelle Dateien bleiben erhalten, gelöschte Historie kann in Portal aber nicht wiederhergestellt werden.",
              })}
            </PageBanner>

            <dl className="grid gap-3 text-xs sm:grid-cols-2">
              <div>
                <dt className={cx("font-semibold uppercase", uiMutedTextClass)}>
                  {t({ en: "Space", fr: "Espace", de: "Bereich" })}
                </dt>
                <dd className={cx("mt-1 break-all font-bold", uiTitleTextClass)}>{space.name}</dd>
              </div>
              <div>
                <dt className={cx("font-semibold uppercase", uiMutedTextClass)}>
                  {t({ en: "Current storage", fr: "Stockage courant", de: "Aktueller Speicher" })}
                </dt>
                <dd className={cx("mt-1 font-bold", uiTitleTextClass)}>{formatBytes(space.usedBytes)}</dd>
              </div>
            </dl>

            {historyCleanupProgress ? (
              <div className="rounded-md border border-[color:var(--ui-border)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className={cx("ui-caption font-semibold", uiTitleTextClass)}>
                    {historyCleanupProgress.message ?? historyCleanupProgress.stage}
                  </p>
                  <p className={cx("ui-caption", uiMutedTextClass)}>
                    {formatCompactNumber(historyCleanupDeletedEntries)} /{" "}
                    {historyCleanupProgress.total_candidates_final
                      ? formatCompactNumber(historyCleanupProgress.delete_candidates)
                      : historyCleanupProgress.delete_candidates > 0
                      ? t({
                          en: `at least ${formatCompactNumber(historyCleanupProgress.delete_candidates)}`,
                          fr: `au moins ${formatCompactNumber(historyCleanupProgress.delete_candidates)}`,
                          de: `mindestens ${formatCompactNumber(historyCleanupProgress.delete_candidates)}`,
                        })
                      : t({ en: "discovering", fr: "détection", de: "wird ermittelt" })}
                  </p>
                </div>
                {historyCleanupProgressPercent === null ? (
                  <div
                    className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--ui-surface-muted)]"
                    role="progressbar"
                    aria-label={t({
                      en: "Storage Space history cleanup progress",
                      fr: "Progression du nettoyage de l'historique",
                      de: "Fortschritt der Historienbereinigung",
                    })}
                  >
                    <div className="h-full w-full animate-pulse rounded-full bg-rose-500/70" />
                  </div>
                ) : (
                  <UiProgressBar
                    value={historyCleanupProgressPercent}
                    label={t({
                      en: "Storage Space history cleanup progress",
                      fr: "Progression du nettoyage de l'historique",
                      de: "Fortschritt der Historienbereinigung",
                    })}
                    className="mt-2 h-2 bg-[var(--ui-surface-muted)]"
                    barClassName="bg-rose-600 transition-[width] duration-150 ease-out"
                  />
                )}
                <p className={cx("mt-2 ui-caption", uiMutedTextClass)}>
                  {t({
                    en: `${formatCompactNumber(historyCleanupProgress.scanned_versions)} versions scanned, ${formatCompactNumber(historyCleanupProgress.scanned_delete_markers)} delete markers scanned, ${formatBytes(historyCleanupProgress.bytes_freed)} gained so far.`,
                    fr: `${formatCompactNumber(historyCleanupProgress.scanned_versions)} versions scannées, ${formatCompactNumber(historyCleanupProgress.scanned_delete_markers)} delete markers scannés, ${formatBytes(historyCleanupProgress.bytes_freed)} gagnés pour l'instant.`,
                    de: `${formatCompactNumber(historyCleanupProgress.scanned_versions)} Versionen geprüft, ${formatCompactNumber(historyCleanupProgress.scanned_delete_markers)} Delete Marker geprüft, bisher ${formatBytes(historyCleanupProgress.bytes_freed)} frei geworden.`,
                  })}
                </p>
              </div>
            ) : null}

            {historyCleanupResult ? (
              <div className="grid gap-2 sm:grid-cols-3">
                <ObjectMetricCard
                  label={t({ en: "Space gained", fr: "Espace gagné", de: "Frei geworden" })}
                  value={formatBytes(historyCleanupResult.bytes_freed)}
                  detail={t({ en: "estimated", fr: "estimé", de: "geschätzt" })}
                />
                <ObjectMetricCard
                  label={t({ en: "Versions deleted", fr: "Versions supprimées", de: "Versionen gelöscht" })}
                  value={formatCompactNumber(historyCleanupResult.deleted_versions)}
                  detail={t({ en: "historical", fr: "historiques", de: "historisch" })}
                />
                <ObjectMetricCard
                  label={t({ en: "Markers removed", fr: "Markers retirés", de: "Marker entfernt" })}
                  value={formatCompactNumber(historyCleanupResult.deleted_delete_markers)}
                  detail={t({ en: "orphan delete markers", fr: "delete markers orphelins", de: "verwaiste Delete Marker" })}
                />
              </div>
            ) : null}

            <WorkflowActions>
              <UiButton variant="secondary" onClick={closeHistoryCleanupDialog} disabled={historyCleanupRunning}>
                {historyCleanupResult
                  ? t({ en: "Done", fr: "Terminer", de: "Fertig" })
                  : t({ en: "Cancel", fr: "Annuler", de: "Abbrechen" })}
              </UiButton>
              {historyCleanupRunning ? (
                <UiButton variant="danger" onClick={cancelHistoryCleanup}>
                  {t({ en: "Stop cleanup", fr: "Arrêter le nettoyage", de: "Bereinigung stoppen" })}
                </UiButton>
              ) : (
                <UiButton
                  variant="danger"
                  onClick={runHistoryCleanup}
                  disabled={
                    Boolean(historyCleanupResult) ||
                    !canCleanHistory
                  }
                >
                  {t({ en: "Start cleanup", fr: "Démarrer le nettoyage", de: "Bereinigung starten" })}
                </UiButton>
              )}
            </WorkflowActions>
          </div>
        </WorkflowPage>
      ) : null}

      {settingsDialogOpen && hasFullAccess ? (
        <Modal
          title={t({ en: "Edit space details", fr: "Modifier les détails de l'espace", de: "Bereichsdetails bearbeiten" })}
          onClose={() => {
            if (metadataBusy) return;
            setSettingsDialogOpen(false);
            setMetadataName(space.name);
            setMetadataDescription(space.description);
          }}
          closeOnBackdropClick={!metadataBusy}
          closeOnEscape={!metadataBusy}
        >
          <div className="space-y-4">
            <UiInput
              label={t({ en: "Space name", fr: "Nom de l'espace", de: "Name des Bereichs" })}
              size="compact"
              className="h-9 disabled:opacity-70"
              value={metadataName}
              onChange={(event) => setMetadataName(event.target.value)}
              aria-label={t({ en: "Space name", fr: "Nom de l'espace", de: "Name des Bereichs" })}
              disabled={!canRename || metadataBusy}
              title={canRename ? t({ en: "Space name", fr: "Nom de l'espace", de: "Name des Bereichs" }) : t({ en: "Name locked for this space", fr: "Nom verrouillé pour cet espace", de: "Name für diesen Bereich gesperrt" })}
            />
            <UiInput
              label={t({ en: "Space description", fr: "Description de l'espace", de: "Beschreibung des Bereichs" })}
              size="compact"
              className="h-9"
              value={metadataDescription}
              onChange={(event) => setMetadataDescription(event.target.value)}
              aria-label={t({ en: "Space description", fr: "Description de l'espace", de: "Beschreibung des Bereichs" })}
              disabled={metadataBusy}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <UiButton
                variant="secondary"
                disabled={metadataBusy}
                onClick={() => {
                  setSettingsDialogOpen(false);
                  setMetadataName(space.name);
                  setMetadataDescription(space.description);
                }}
              >
                {t({ en: "Cancel", fr: "Annuler", de: "Abbrechen" })}
              </UiButton>
              <UiButton loading={metadataBusy} disabled={metadataBusy} onClick={handleSaveMetadata}>
                {metadataBusy
                  ? t({ en: "Saving...", fr: "Enregistrement...", de: "Wird gespeichert..." })
                  : t({ en: "Save", fr: "Enregistrer", de: "Speichern" })}
              </UiButton>
            </div>
          </div>
        </Modal>
      ) : null}

      {pendingAccessChange ? (
        <ConfirmActionDialog
          title={t({ en: "Change collaborators", fr: "Modifier les collaborateurs", de: "Mitwirkende ändern" })}
          description={t({ en: "Confirm who can access this space.", fr: "Confirmez qui peut accéder à cet espace.", de: "Bestätigen Sie, wer auf diesen Bereich zugreifen kann." })}
          confirmLabel={t({ en: "Update access", fr: "Mettre à jour l'accès", de: "Zugriff aktualisieren" })}
          tone="primary"
          loading={accessBusy}
          details={[
            { label: t({ en: "Space", fr: "Espace", de: "Bereich" }), value: space.name },
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
                t({ en: "Existing direct collaborator grants are kept but become inactive while the space is private.", fr: "Les droits directs existants sont conservés mais deviennent inactifs tant que l'espace est privé.", de: "Bestehende direkte Berechtigungen bleiben erhalten, sind bei privatem Zugriff aber inaktiv." }),
                t({ en: "Public links are suspended while the space is private.", fr: "Les liens publics sont suspendus tant que l'espace est privé.", de: "Öffentliche Links sind bei privatem Zugriff ausgesetzt." }),
              ]
            : pendingAccessChange.mode === "account"
            ? [
                t({ en: "Current and future Portal members of this account receive access automatically.", fr: "Les membres Portal actuels et futurs de ce compte recevront automatiquement l'accès.", de: "Aktuelle und zukünftige Portal-Mitglieder dieses Kontos erhalten automatisch Zugriff." }),
                t({ en: "Direct collaborator grants remain available for explicit role overrides.", fr: "Les droits directs restent disponibles pour les rôles explicites.", de: "Direkte Berechtigungen bleiben für explizite Rollen erhalten." }),
                t({ en: "Public links remain managed separately.", fr: "Les liens publics restent gérés séparément.", de: "Öffentliche Links werden weiterhin separat verwaltet." }),
              ]
            : [
                t({ en: "Only the owner and direct collaborators keep user access.", fr: "Seuls le propriétaire et les collaborateurs directs conservent un accès utilisateur.", de: "Nur der Eigentümer und direkte Mitwirkende behalten Benutzerzugriff." }),
                t({ en: "Account-wide automatic access stops.", fr: "L'accès automatique à tout le compte s'arrête.", de: "Der automatische accountweite Zugriff endet." }),
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
            { label: t({ en: "Space", fr: "Espace", de: "Bereich" }), value: space.name },
            { label: t({ en: "Access", fr: "Accès", de: "Zugriff" }), value: portalRoleLabel(pendingAccessRevoke.role, t) },
          ]}
          impacts={[
            t({ en: "This person loses direct access immediately.", fr: "Cette personne perd immédiatement son accès direct.", de: "Diese Person verliert sofort den direkten Zugriff." }),
            t({ en: "Files in the space are not deleted.", fr: "Les fichiers de l'espace ne sont pas supprimés.", de: "Dateien im Bereich werden nicht gelöscht." }),
          ]}
          onCancel={() => setPendingAccessRevoke(null)}
          onConfirm={() => confirmAccessRevoke(pendingAccessRevoke)}
        />
      ) : null}

      {pendingAccessRoleChange ? (
        <ConfirmActionDialog
          title={t({
            en: "Change access role",
            fr: "Modifier le rôle d'accès",
            de: "Zugriffsrolle ändern",
          })}
          description={t({
            en: "Review the new role before applying it to this space.",
            fr: "Vérifiez le nouveau rôle avant de l'appliquer à cet espace.",
            de: "Prüfen Sie die neue Rolle, bevor Sie sie auf diesen Bereich anwenden.",
          })}
          confirmLabel={t({
            en: "Update role",
            fr: "Mettre à jour le rôle",
            de: "Rolle aktualisieren",
          })}
          tone="primary"
          loading={accessBusy}
          details={[
            {
              label: t({ en: "Person", fr: "Personne", de: "Person" }),
              value: pendingAccessRoleChange.share.email,
            },
            {
              label: t({ en: "Space", fr: "Espace", de: "Bereich" }),
              value: space.name,
            },
            {
              label: t({ en: "Current role", fr: "Rôle actuel", de: "Aktuelle Rolle" }),
              value: portalRoleLabel(pendingAccessRoleChange.share.role, t),
            },
            {
              label: t({ en: "New role", fr: "Nouveau rôle", de: "Neue Rolle" }),
              value: portalRoleLabel(pendingAccessRoleChange.role, t),
            },
          ]}
          onCancel={() => setPendingAccessRoleChange(null)}
          onConfirm={() => confirmAccessRoleChange(pendingAccessRoleChange)}
        />
      ) : null}

      {takeOwnershipDialogOpen ? (
        <ConfirmActionDialog
          title={t({ en: "Take ownership", fr: "Reprendre la propriété", de: "Eigentümerschaft übernehmen" })}
          description={t({
            en: "Confirm that you want to become the owner of this private space.",
            fr: "Confirmez que vous souhaitez devenir propriétaire de cet espace privé.",
            de: "Bestätigen Sie, dass Sie Eigentümer dieses privaten Bereichs werden möchten.",
          })}
          confirmLabel={t({ en: "Take ownership", fr: "Reprendre la propriété", de: "Übernehmen" })}
          loading={takeOwnershipBusy}
          details={[
            { label: t({ en: "Space", fr: "Espace", de: "Bereich" }), value: space.name },
            { label: t({ en: "Current owner", fr: "Propriétaire actuel", de: "Aktueller Eigentümer" }), value: space.ownerLabel ?? "-" },
          ]}
          impacts={[
            t({ en: "You receive the Owner role for this private space.", fr: "Vous recevez le rôle Propriétaire pour cet espace privé.", de: "Sie erhalten die Eigentümerrolle für diesen privaten Bereich." }),
            t({ en: "The previous owner loses their access to this private space.", fr: "L'ancien propriétaire perd son accès à cet espace privé.", de: "Der vorherige Eigentümer verliert den Zugriff auf diesen privaten Bereich." }),
          ]}
          warning={t({ en: "Ownership transfer is immediate.", fr: "Le transfert de propriété est immédiat.", de: "Die Eigentumsübertragung erfolgt sofort." })}
          onCancel={() => setTakeOwnershipDialogOpen(false)}
          onConfirm={confirmTakeOwnership}
        />
      ) : null}

      {archiveDialogOpen ? (
        <ConfirmActionDialog
          title={t({ en: "Archive space", fr: "Archiver l'espace", de: "Bereich archivieren" })}
          description={t({ en: "Confirm that you want to archive this space.", fr: "Confirmez que vous voulez archiver cet espace.", de: "Bestätigen Sie, dass Sie diesen Bereich archivieren möchten." })}
          confirmLabel={t({ en: "Archive space", fr: "Archiver l'espace", de: "Bereich archivieren" })}
          loading={metadataBusy}
          details={[
            { label: t({ en: "Space", fr: "Espace", de: "Bereich" }), value: space.name },
            { label: t({ en: "Status", fr: "Statut", de: "Status" }), value: t({ en: "Can be restored later", fr: "Restaurable plus tard", de: "Kann später wiederhergestellt werden" }) },
          ]}
          impacts={[
            t({ en: "The space is removed from active file work until it is restored.", fr: "L'espace est retiré des fichiers actifs jusqu'à sa restauration.", de: "Der Bereich wird bis zur Wiederherstellung aus der aktiven Dateiarbeit entfernt." }),
            t({ en: "Existing files are kept and are not deleted.", fr: "Les fichiers existants sont conservés et ne sont pas supprimés.", de: "Bestehende Dateien bleiben erhalten und werden nicht gelöscht." }),
            t({ en: "Public links and file access are suspended while archived.", fr: "Les liens publics et l'accès aux fichiers sont suspendus pendant l'archivage.", de: "Öffentliche Links und Dateizugriff sind während der Archivierung ausgesetzt." }),
          ]}
          warning={t({ en: "Archiving is reversible from this settings section.", fr: "L'archivage est réversible depuis cette section de paramètres.", de: "Die Archivierung kann in diesem Einstellungsbereich rückgängig gemacht werden." })}
          onCancel={() => setArchiveDialogOpen(false)}
          onConfirm={confirmArchive}
        />
      ) : null}

      {deleteDialogOpen ? (
        <ConfirmActionDialog
          title={t({ en: "Delete space", fr: "Supprimer l'espace", de: "Bereich löschen" })}
          description={
            deleteError
              ? deleteError
              : storageSpaceIsEmpty
              ? t({
                  en: "Confirm the permanent deletion of this space and its storage bucket.",
                  fr: "Confirmez la suppression définitive de cet espace et de son bucket de stockage.",
                  de: "Bestätigen Sie die endgültige Löschung dieses Bereichs und seines Speicher-Buckets.",
                })
              : deletionStatsKnown
              ? t({
                  en: "This space cannot be deleted yet. Delete every current file, then clean up its history before trying again.",
                  fr: "Cet espace ne peut pas encore être supprimé. Supprimez tous les fichiers courants, puis nettoyez son historique avant de réessayer.",
                  de: "Dieser Bereich kann noch nicht gelöscht werden. Löschen Sie zuerst alle aktuellen Dateien und bereinigen Sie anschließend die Historie.",
                })
              : t({
                  en: "Current storage statistics are unavailable. The server will verify that the bucket is empty before deleting anything.",
                  fr: "Les statistiques de stockage sont indisponibles. Le serveur vérifiera que le bucket est vide avant toute suppression.",
                  de: "Aktuelle Speicherstatistiken sind nicht verfügbar. Der Server prüft vor dem Löschen, ob der Bucket leer ist.",
                })
          }
          confirmLabel={t({ en: "Delete space", fr: "Supprimer l'espace", de: "Bereich löschen" })}
          cancelLabel={t({ en: "Cancel", fr: "Annuler", de: "Abbrechen" })}
          loading={deleteBusy}
          confirmDisabled={deletionStatsKnown && !storageSpaceIsEmpty}
          details={[
            { label: t({ en: "Space", fr: "Espace", de: "Bereich" }), value: space.name },
            {
              label: t({ en: "Current files", fr: "Fichiers courants", de: "Aktuelle Dateien" }),
              value: space.objectCount == null ? "-" : formatCompactNumber(space.objectCount),
            },
            {
              label: t({ en: "Current storage", fr: "Stockage courant", de: "Aktueller Speicher" }),
              value: formatBytes(space.usedBytes),
            },
          ]}
          impacts={
            storageSpaceIsEmpty
              ? [
                  t({ en: "The Storage Space and its bucket are permanently deleted.", fr: "Le Storage Space et son bucket sont supprimés définitivement.", de: "Der Storage Space und sein Bucket werden endgültig gelöscht." }),
                  t({ en: "Collaborator access, external credentials, and public links are revoked.", fr: "Les accès collaborateurs, identifiants externes et liens publics sont révoqués.", de: "Zugriffe von Mitwirkenden, externe Anmeldedaten und öffentliche Links werden widerrufen." }),
                ]
              : [
                  isArchived
                    ? t({ en: "Restore the space before removing files and cleaning its history.", fr: "Restaurez l'espace avant de supprimer les fichiers et de nettoyer son historique.", de: "Stellen Sie den Bereich wieder her, bevor Sie Dateien und Historie löschen." })
                    : t({ en: "Remove current files from the Files tab.", fr: "Supprimez les fichiers courants depuis l'onglet Fichiers.", de: "Entfernen Sie aktuelle Dateien auf der Registerkarte Dateien." }),
                  t({ en: "Use History cleanup to remove older versions and delete markers.", fr: "Utilisez Nettoyage de l'historique pour retirer les anciennes versions et les delete markers.", de: "Verwenden Sie die Historienbereinigung, um ältere Versionen und Löschmarkierungen zu entfernen." }),
                ]
          }
          warning={t({
            en: "Portal never empties the bucket automatically during deletion.",
            fr: "Portal ne vide jamais automatiquement le bucket pendant la suppression.",
            de: "Portal leert den Bucket beim Löschen niemals automatisch.",
          })}
          onCancel={() => {
            if (deleteBusy) return;
            setDeleteDialogOpen(false);
            setDeleteError(null);
          }}
          onConfirm={confirmDelete}
        />
      ) : null}
    </div>
  );
}
