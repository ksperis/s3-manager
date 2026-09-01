/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  createPortalStorageSpacePublicLink,
  deletePortalStorageSpace,
  fetchPortalStorageSpaceAccessSummary,
  fetchPortalStorageSpaceSettings,
  grantPortalStorageSpaceShare,
  listPortalStorageSpacePublicLinks,
  listPortalStorageSpaceShareCandidates,
  revokePortalStorageSpaceShare,
  restorePortalStorageSpaceObject,
  takePortalStorageSpaceOwnership,
  updatePortalStorageSpace,
  updatePortalStorageSpaceSettings,
  updatePortalStorageSpaceShare,
  type PortalPublicLink,
  type PortalStorageSpaceAccountMemberRole,
  type PortalStorageSpaceAccessSummary,
  type PortalStorageSpaceGrantRole,
  type PortalStorageSpaceShare,
  type PortalStorageSpaceShareCandidate,
  type PortalStorageSpaceSettings,
} from "../../api/portal";
import { createPortalRequest } from "../../api/portalRequests";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import Modal from "../../components/Modal";
import WorkflowPage, { WorkflowActions, workflowPageHostClass } from "../../components/WorkflowPage";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import StorageSpaceIcon from "../../components/StorageSpaceIcon";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import {
  cx,
  uiButtonBaseClass,
  uiButtonVariants,
  uiCheckboxClass,
  uiMutedTextClass,
  uiPanelMutedClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { copyTextToClipboard } from "../../utils/clipboard";
import {
  readClientStorageKey,
  writeClientStorageKey,
} from "../../utils/clientStorage";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import BrowserEmbed from "../browser/BrowserEmbed";
import type {
  BrowserDeletedObjectTarget,
  BrowserObjectDetailsRouteTarget,
} from "../browser/browserPageContract";
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
import PortalDeletedPrefixRestoreWorkflow from "./PortalDeletedPrefixRestoreWorkflow";
import PortalPublicLinkCreateDialog from "./PortalPublicLinkCreateDialog";
import PortalPublicLinkRevokeDialog from "./PortalPublicLinkRevokeDialog";
import PortalPublicLinksTable from "./PortalPublicLinksTable";
import { storageSpaceObjectPath, storageSpacePath } from "./portalWorkspaceModel";
import PortalStorageSpaceStatistics from "./PortalStorageSpaceStatistics";
import PortalStorageSpaceHistoryCleanupWorkflow from "./PortalStorageSpaceHistoryCleanupWorkflow";
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
import { usePortalPublicLinkActions } from "./usePortalPublicLinkActions";
import StorageSpaceIconPickerModal from "./StorageSpaceIconPickerModal";

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

type SpaceDetailTab =
  | "files"
  | "collaborators"
  | "external-links"
  | "statistics"
  | "settings";

export default function PortalStorageSpaceDetailPage() {
  const { locale, t } = useI18n();
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { generalSettings } = useGeneralSettings();
  const [message, setMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SpaceDetailTab>(() => {
    const requestedTab = new URLSearchParams(location.search).get("tab");
    return requestedTab === "collaborators" || requestedTab === "external-links" || requestedTab === "statistics" || requestedTab === "settings"
      ? requestedTab
      : "files";
  });
  const [trashRestoreTarget, setTrashRestoreTarget] =
    useState<BrowserDeletedObjectTarget | null>(null);
  const [restoringTrashKey, setRestoringTrashKey] = useState<string | null>(null);
  const [browserRefreshToken, setBrowserRefreshToken] = useState(0);
  const [deletedPrefixRestoreTarget, setDeletedPrefixRestoreTarget] =
    useState<BrowserObjectDetailsRouteTarget | null>(null);
  const [metadataName, setMetadataName] = useState("");
  const [metadataDescription, setMetadataDescription] = useState("");
  const [metadataBusy, setMetadataBusy] = useState(false);
  const [spaceSettings, setSpaceSettings] = useState<PortalStorageSpaceSettings | null>(null);
  const [spaceVersioningEnabled, setSpaceVersioningEnabled] = useState(false);
  const [spaceLifecycleEnabled, setSpaceLifecycleEnabled] = useState(false);
  const [spaceVersionHistoryRetentionDays, setSpaceVersionHistoryRetentionDays] = useState("");
  const [spaceSettingsLoading, setSpaceSettingsLoading] = useState(false);
  const [spaceSettingsSaving, setSpaceSettingsSaving] = useState(false);
  const [spaceSettingsError, setSpaceSettingsError] = useState<string | null>(null);
  const [spaceSettingsMessage, setSpaceSettingsMessage] = useState<string | null>(null);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [iconDialogOpen, setIconDialogOpen] = useState(false);
  const [historyCleanupConfirmOpen, setHistoryCleanupConfirmOpen] = useState(false);
  const [historyCleanupDialogOpen, setHistoryCleanupDialogOpen] = useState(false);
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
  const [externalLinks, setExternalLinks] = useState<PortalPublicLink[]>([]);
  const [externalLinksLoading, setExternalLinksLoading] = useState(false);
  const [externalLinksError, setExternalLinksError] = useState<string | null>(null);
  const [pendingExternalLinkRevoke, setPendingExternalLinkRevoke] = useState<PortalPublicLink | null>(null);
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
  } = usePortalWorkspaceData({
    includeArchived: true,
    includeUsage: activeTab === "statistics",
  });
  const decodedSpaceId = decodeRouteValue(spaceId);
  const space = workspace.spaces.find((item) => item.id === decodedSpaceId) ?? null;
  const {
    busyLinkId: busyExternalLinkId,
    copyLink: copyExternalLink,
    revokeLink: revokeExternalLink,
  } = usePortalPublicLinkActions({
    accountId: accountIdForApi,
    onLinksUpdated: (links) => setExternalLinks(links),
    onMessage: setMessage,
    onError: setExternalLinksError,
  });
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
    return params.get("show_deleted") === "1";
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
    let cancelled = false;
    const canReadSettings = Boolean(space && (space.role === "Owner" || space.role === "Manager"));
    setSpaceSettings(null);
    setSpaceSettingsError(null);
    setSpaceSettingsMessage(null);
    if (!space || !accountIdForApi || !canReadSettings || activeTab !== "settings") {
      setSpaceSettingsLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setSpaceSettingsLoading(true);
    fetchPortalStorageSpaceSettings(accountIdForApi, space.id)
      .then((settings) => {
        if (cancelled) return;
        setSpaceSettings(settings);
        setSpaceVersioningEnabled(settings.versioning_enabled);
        setSpaceLifecycleEnabled(settings.lifecycle_enabled);
        setSpaceVersionHistoryRetentionDays(String(settings.version_history_retention_days));
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setSpaceSettingsError(
            extractApiError(
              err,
              t({
                en: "Unable to load version history settings.",
                fr: "Impossible de charger les paramètres d’historique des versions.",
                de: "Einstellungen für den Versionsverlauf konnten nicht geladen werden.",
              }),
            ),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setSpaceSettingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, activeTab, space, t]);

  useEffect(() => {
    if (
      requestedTab === "files" ||
      requestedTab === "collaborators" ||
      requestedTab === "external-links" ||
      requestedTab === "statistics" ||
      requestedTab === "settings"
    ) {
      setActiveTab(requestedTab);
    }
  }, [requestedTab]);

  useEffect(() => {
    let cancelled = false;
    const canListExternalLinks = Boolean(
      space &&
        space.status !== "Archived" &&
        (space.role === "Owner" || space.role === "Manager"),
    );
    if (
      activeTab !== "external-links" ||
      !space ||
      !accountIdForApi ||
      !canListExternalLinks
    ) {
      setExternalLinks([]);
      setExternalLinksLoading(false);
      setExternalLinksError(null);
      return () => {
        cancelled = true;
      };
    }
    setExternalLinksLoading(true);
    setExternalLinksError(null);
    listPortalStorageSpacePublicLinks(accountIdForApi, space.id, {
      includeRevoked: true,
    })
      .then((links) => {
        if (!cancelled) setExternalLinks(links);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setExternalLinks([]);
          setExternalLinksError(
            extractApiError(
              err,
              t({
                en: "Unable to load external links.",
                fr: "Impossible de charger les liens externes.",
                de: "Externe Links können nicht geladen werden.",
              }),
            ),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setExternalLinksLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, activeTab, space, t]);

  useEffect(() => {
    if (!startGuideStorageKey) {
      setStartGuideDismissed(false);
      return;
    }
    setStartGuideDismissed(readClientStorageKey(startGuideStorageKey) === "true");
  }, [startGuideStorageKey]);

  const shouldLoadAccessSummary = Boolean(
    space &&
      accountIdForApi &&
      (activeTab === "collaborators" ||
        (activeTab === "files" &&
          (space.shareCount == null ||
            (generalSettings.browser_enabled &&
              generalSettings.browser_portal_enabled &&
              space.status !== "Archived" &&
              space.canBrowse &&
              space.role === "Manager" &&
              space.visibility === "shared"))))
  );

  const loadAccessSummary = useCallback(async () => {
    if (!space || !accountIdForApi || !shouldLoadAccessSummary) {
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
  }, [accountIdForApi, shouldLoadAccessSummary, space, t]);

  useEffect(() => {
    void loadAccessSummary();
  }, [loadAccessSummary]);

  useEffect(() => {
    let cancelled = false;
    if (!accessPeopleDialogOpen || !space || !accountIdForApi || !accessSummary?.can_manage_access || savedAccessMode !== "restricted" || accessChanged) {
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
  }, [accessPeopleDialogOpen, accountIdForApi, accessChanged, accessSummary?.can_manage_access, savedAccessMode, space]);

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

  const handleSaveSpaceSettings = async () => {
    if (!space || !accountIdForApi || !spaceSettings?.can_update || spaceSettingsSaving) return;
    const retentionDays = Number(spaceVersionHistoryRetentionDays);
    if (!Number.isInteger(retentionDays) || retentionDays < 1) {
      setSpaceSettingsMessage(null);
      setSpaceSettingsError(
        t({
          en: "Version history retention must be a positive integer.",
          fr: "La conservation de l’historique des versions doit être un entier positif.",
          de: "Die Aufbewahrung des Versionsverlaufs muss eine positive ganze Zahl sein.",
        }),
      );
      return;
    }
    setSpaceSettingsSaving(true);
    setSpaceSettingsError(null);
    setSpaceSettingsMessage(null);
    try {
      const updated = await updatePortalStorageSpaceSettings(accountIdForApi, space.id, {
        versioning_enabled: spaceVersioningEnabled,
        lifecycle_enabled: spaceLifecycleEnabled,
        version_history_retention_days: retentionDays,
      });
      setSpaceSettings(updated);
      setSpaceVersioningEnabled(updated.versioning_enabled);
      setSpaceLifecycleEnabled(updated.lifecycle_enabled);
      setSpaceVersionHistoryRetentionDays(String(updated.version_history_retention_days));
      setSpaceSettingsMessage(
        t({
          en: "Version history settings saved.",
          fr: "Paramètres d’historique des versions enregistrés.",
          de: "Einstellungen für den Versionsverlauf gespeichert.",
        }),
      );
    } catch (err) {
      console.error(err);
      setSpaceSettingsError(
        extractApiError(
          err,
          t({
            en: "Unable to update version history settings.",
            fr: "Impossible de modifier les paramètres d’historique des versions.",
            de: "Einstellungen für den Versionsverlauf konnten nicht aktualisiert werden.",
          }),
        ),
      );
    } finally {
      setSpaceSettingsSaving(false);
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
  const canConfigureIcon = state?.portal_role === "portal_manager";
  const canRename = hasFullAccess && space.nameEditable;
  const canModifyObjects = canBrowse && (hasFullAccess || space.role === "Editor");
  const lockedBucketName = space.internalName ?? space.id;
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
  const externalLinksUnavailableReason = isArchived
    ? t({
        en: "Restore this archived space to review links.",
        fr: "Restaurez cet espace archivé pour voir ses liens.",
        de: "Archivierte Bereiche zeigen keine externen Links.",
      })
    : !hasFullAccess
      ? t({
          en: "Only owners and managers can review links.",
          fr: "Accès propriétaire ou gestionnaire requis.",
          de: "Nur Owner und Manager sehen externe Links.",
        })
      : null;
  const externalLinksTableStatus = resolveListTableStatus({
    loading: externalLinksLoading,
    error: externalLinksError,
    rowCount: externalLinks.length,
  });
  const historyCleanupEnabled = Boolean(state?.storage_space_version_cleanup_enabled);
  const canCleanHistory = Boolean(historyCleanupEnabled && !isArchived && hasFullAccess);
  const deletionStatsKnown = space.objectCount != null && space.usedBytes != null;
  const storageSpaceIsEmpty = deletionStatsKnown && space.objectCount === 0 && space.usedBytes === 0;
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
    writeClientStorageKey(startGuideStorageKey, "true");
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
  };

  const closeHistoryCleanupDialog = () => {
    setHistoryCleanupDialogOpen(false);
  };

  const confirmHistoryCleanup = () => {
    if (!canCleanHistory) return;
    setHistoryCleanupConfirmOpen(false);
    setHistoryCleanupDialogOpen(true);
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
          {canConfigureIcon ? (
            <UiButton size="sm" variant="secondary" onClick={() => setIconDialogOpen(true)}>
              {t({ en: "Change icon", fr: "Modifier l’icône", de: "Symbol ändern" })}
            </UiButton>
          ) : null}
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
          <dd className={cx("mt-1 flex items-center gap-2 text-sm font-bold", uiTitleTextClass)}>
            <StorageSpaceIcon icon={space.icon} name={space.name} size="sm" decorative />
            <span>{space.name}</span>
          </dd>
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

  const versionHistorySettingsCard = hasFullAccess ? (
    <UiCard
      title={t({
        en: "Version history settings",
        fr: "Paramètres de l’historique des versions",
        de: "Einstellungen für den Versionsverlauf",
      })}
      description={t({
        en: "Configure Versioning, Lifecycle and how long older file versions are retained for this Storage Space.",
        fr: "Configurez le Versioning, le Lifecycle et la durée de conservation des anciennes versions de fichiers pour cet espace.",
        de: "Konfigurieren Sie Versioning, Lifecycle und die Aufbewahrungsdauer älterer Dateiversionen für diesen Bereich.",
      })}
      actions={
        <div className="flex flex-wrap justify-end gap-2">
          <UiButton
            size="sm"
            variant="danger"
            disabled={!canCleanHistory}
            onClick={openHistoryCleanupDialog}
          >
            {t({ en: "Clean up history", fr: "Nettoyer l'historique", de: "Historie bereinigen" })}
          </UiButton>
          {spaceSettings?.can_update ? (
          <UiButton
            size="sm"
            disabled={spaceSettingsLoading || spaceSettingsSaving}
            onClick={handleSaveSpaceSettings}
          >
            {spaceSettingsSaving
              ? t({ en: "Saving...", fr: "Enregistrement...", de: "Speichern..." })
              : t({ en: "Save settings", fr: "Enregistrer", de: "Einstellungen speichern" })}
          </UiButton>
          ) : null}
        </div>
      }
    >
      <div className="space-y-4">
        {spaceSettingsLoading ? (
          <PageBanner tone="info">
            {t({
              en: "Loading version history settings...",
              fr: "Chargement des paramètres d’historique des versions...",
              de: "Einstellungen für den Versionsverlauf werden geladen...",
            })}
          </PageBanner>
        ) : null}
        {spaceSettingsError ? <PageBanner tone="warning">{spaceSettingsError}</PageBanner> : null}
        {spaceSettingsMessage ? <PageBanner tone="success">{spaceSettingsMessage}</PageBanner> : null}
        {spaceSettings && !spaceSettings.can_update ? (
          <PageBanner tone={isArchived ? "warning" : "info"}>
            {isArchived
              ? t({
                  en: "Archived spaces keep their settings but cannot be changed.",
                  fr: "Les espaces archivés conservent leurs paramètres mais ne peuvent pas être modifiés.",
                  de: "Archivierte Bereiche behalten ihre Einstellungen, können aber nicht geändert werden.",
                })
              : t({
                  en: "Owners can review these values. Only a project Portal Manager can change them.",
                  fr: "Les Owners peuvent consulter ces valeurs. Seul un Portal Manager du projet peut les modifier.",
                  de: "Eigentümer können diese Werte einsehen. Nur ein Portal Manager des Projekts kann sie ändern.",
                })}
          </PageBanner>
        ) : null}
        {spaceSettings ? (
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-md border border-[color:var(--ui-border-soft)] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className={cx("text-xs font-bold", uiTitleTextClass)}>Versioning</div>
                  <div className={cx("mt-1 text-[11px] font-semibold", uiMutedTextClass)}>
                    {t({ en: "S3 status", fr: "Statut S3", de: "S3-Status" })}: {spaceSettings.versioning_status}
                  </div>
                </div>
                <label className="inline-flex items-center gap-2 text-xs font-semibold">
                  <input
                    type="checkbox"
                    className={uiCheckboxClass}
                    checked={spaceVersioningEnabled}
                    disabled={!spaceSettings.can_update || spaceSettingsSaving}
                    onChange={(event) => setSpaceVersioningEnabled(event.target.checked)}
                    aria-label="Versioning"
                  />
                  {spaceVersioningEnabled
                    ? t({ en: "Enabled", fr: "Activé", de: "Aktiviert" })
                    : t({ en: "Disabled", fr: "Désactivé", de: "Deaktiviert" })}
                </label>
              </div>
            </div>
            <div className="rounded-md border border-[color:var(--ui-border-soft)] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className={cx("text-xs font-bold", uiTitleTextClass)}>Lifecycle</div>
                  <div className={cx("mt-1 text-[11px] font-semibold", uiMutedTextClass)}>
                    {t({
                      en: "Portal-managed history rules only",
                      fr: "Règles d’historique gérées par le Portal uniquement",
                      de: "Nur vom Portal verwaltete Verlaufsregeln",
                    })}
                  </div>
                </div>
                <label className="inline-flex items-center gap-2 text-xs font-semibold">
                  <input
                    type="checkbox"
                    className={uiCheckboxClass}
                    checked={spaceLifecycleEnabled}
                    disabled={!spaceSettings.can_update || spaceSettingsSaving}
                    onChange={(event) => setSpaceLifecycleEnabled(event.target.checked)}
                    aria-label="Lifecycle"
                  />
                  {spaceLifecycleEnabled
                    ? t({ en: "Enabled", fr: "Activé", de: "Aktiviert" })
                    : t({ en: "Disabled", fr: "Désactivé", de: "Deaktiviert" })}
                </label>
              </div>
            </div>
            <div className="rounded-md border border-[color:var(--ui-border-soft)] p-3">
              <label className={cx("text-xs font-bold", uiTitleTextClass)} htmlFor="space-version-history-retention">
                {t({
                  en: "Version history retention",
                  fr: "Conservation de l’historique des versions",
                  de: "Aufbewahrung des Versionsverlaufs",
                })}
              </label>
              <div className="mt-2 flex items-center gap-2">
                <UiInput
                  id="space-version-history-retention"
                  type="number"
                  min={1}
                  step={1}
                  size="compact"
                  className="w-24"
                  value={spaceVersionHistoryRetentionDays}
                  disabled={!spaceSettings.can_update || spaceSettingsSaving || !spaceLifecycleEnabled}
                  onChange={(event) => setSpaceVersionHistoryRetentionDays(event.target.value)}
                />
                <span className={cx("text-xs font-semibold", uiMutedTextClass)}>
                  {t({ en: "days", fr: "jours", de: "Tage" })}
                </span>
              </div>
            </div>
          </div>
        ) : null}
        <div className="border-t border-[color:var(--ui-border-soft)] pt-4">
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
      </div>
    </UiCard>
  ) : null;

  const filesSection = (
    <section id="space-files" className="space-y-3">
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
            executionContextKind="portal_account"
            hasContext={hasAccountContext}
            workspaceSurface="portal"
            functionalProfile="portal"
            layoutMode="standard"
            density="comfortable"
            capabilityFacts={{
              canWriteObjects: canModifyObjects,
              canDeleteObjects: canModifyObjects,
              canRestoreObjects: canModifyObjects,
              canCreatePublicLinks,
            }}
            lockedBucketName={lockedBucketName}
            lockedBucketLabel={space.name}
            storageEndpointCapabilities={selectedAccount?.storage_endpoint_capabilities ?? null}
            quotaMaxSizeGb={
              space.quotaBytes != null
                ? space.quotaBytes / 1024 ** 3
                : null
            }
            quotaMaxObjects={space.quotaObjects ?? null}
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
                ? setDeletedPrefixRestoreTarget
                : undefined,
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
          { id: "external-links", label: t({ en: "External links", fr: "Liens externes", de: "Externe Links" }) },
          { id: "statistics", label: t({ en: "Statistics", fr: "Statistiques", de: "Statistiken" }) },
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
        </PortalTabPanel>
      ) : null}

      {activeTab === "statistics" ? (
        <PortalTabPanel idPrefix="portal-space-detail" tabId="statistics">
          <PortalStorageSpaceStatistics
            accountIdForApi={accountIdForApi}
            accountName={workspace.accountName}
            rgwAccountId={selectedAccount?.rgw_account_id}
            space={space}
          />
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
                <button
                  type="button"
                  onClick={() => selectSpaceDetailTab("external-links")}
                  className="mt-1 inline-flex text-sm font-bold text-primary hover:underline dark:text-primary-200"
                >
                  {t({
                    en: `${accessSummary.public_link_count} public link${accessSummary.public_link_count > 1 ? "s" : ""}`,
                    fr: `${accessSummary.public_link_count} lien${accessSummary.public_link_count > 1 ? "s" : ""} public${accessSummary.public_link_count > 1 ? "s" : ""}`,
                    de: `${accessSummary.public_link_count} öffentliche Links`,
                  })}
                </button>
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

      {activeTab === "external-links" ? (
        <PortalTabPanel idPrefix="portal-space-detail" tabId="external-links">
          {externalLinksUnavailableReason ? (
            <PageBanner tone={isArchived ? "warning" : "info"}>
              {externalLinksUnavailableReason}
            </PageBanner>
          ) : (
            <div className="space-y-3">
              {externalLinksError && externalLinks.length > 0 ? (
                <PageBanner tone="error">{externalLinksError}</PageBanner>
              ) : null}
              <PortalPublicLinksTable
                links={externalLinks}
                status={externalLinksTableStatus}
                busyLinkId={busyExternalLinkId}
                showCopyForInactive
                onCopy={copyExternalLink}
                onRevoke={setPendingExternalLinkRevoke}
                errorMessage={externalLinksError ?? undefined}
                emptyMessage={t({
                  en: "No external links for this space.",
                  fr: "Aucun lien externe pour cet espace.",
                  de: "Keine externen Links für diesen Bereich.",
                })}
              />
            </div>
          )}
        </PortalTabPanel>
      ) : null}

      {activeTab === "settings" ? (
        <PortalTabPanel idPrefix="portal-space-detail" tabId="settings">
          {storageSpaceSettingsCard}
          {versionHistorySettingsCard}
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
        <PortalPublicLinkCreateDialog
          fileName={publicLinkTarget.name}
          path={publicLinkTarget.key}
          spaceName={space.name}
          expiration={publicLinkExpiration}
          busy={publicLinkBusy}
          canCreate={canCreatePublicLinks}
          error={publicLinkError}
          message={publicLinkCopyMessage}
          createdLink={createdPublicLink}
          onExpirationChange={setPublicLinkExpiration}
          onClose={closePublicLinkDialog}
          onCreate={handleCreatePublicLink}
          onCopy={copyCreatedPublicLink}
        />
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
        <PortalDeletedPrefixRestoreWorkflow
          accountId={accountIdForApi}
          spaceId={space.id}
          spaceName={space.name}
          target={deletedPrefixRestoreTarget}
          onClose={() => setDeletedPrefixRestoreTarget(null)}
          onBrowserRefresh={() =>
            setBrowserRefreshToken((current) => current + 1)
          }
          onWorkspaceRefresh={refreshWorkspaceData}
        />
      ) : null}

      {historyCleanupDialogOpen ? (
        <PortalStorageSpaceHistoryCleanupWorkflow
          accountId={accountIdForApi}
          spaceId={space.id}
          spaceName={space.name}
          usedBytes={space.usedBytes}
          enabled={canCleanHistory}
          onClose={closeHistoryCleanupDialog}
          onStart={() => setMessage(null)}
          onCompleted={(bytesFreed) => {
            refreshWorkspaceData();
            setMessage(
              t({
                en: `History cleanup completed. Estimated space gained: ${formatBytes(bytesFreed)}.`,
                fr: `Nettoyage de l'historique terminé. Espace estimé gagné : ${formatBytes(bytesFreed)}.`,
                de: `Historienbereinigung abgeschlossen. Geschätzter frei gewordener Speicher: ${formatBytes(bytesFreed)}.`,
              }),
            );
          }}
        />
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

      {iconDialogOpen && canConfigureIcon ? (
        <StorageSpaceIconPickerModal
          accountId={accountIdForApi}
          space={space}
          onClose={() => setIconDialogOpen(false)}
          onSaved={refreshWorkspaceData}
        />
      ) : null}

      {pendingExternalLinkRevoke ? (
        <PortalPublicLinkRevokeDialog
          link={pendingExternalLinkRevoke}
          loading={busyExternalLinkId === pendingExternalLinkRevoke.id}
          onCancel={() => setPendingExternalLinkRevoke(null)}
          onConfirm={() =>
            void revokeExternalLink(pendingExternalLinkRevoke).finally(() =>
              setPendingExternalLinkRevoke(null),
            )
          }
        />
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
