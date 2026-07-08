/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  grantPortalStorageSpaceShare,
  listPortalStorageSpaceShareCandidates,
  listPortalStorageSpacePublicLinks,
  listPortalStorageSpaceShares,
  revokePortalStorageSpacePublicLink,
  updatePortalStorageSpace,
  type PortalPublicLink,
  revokePortalStorageSpaceShare,
  updatePortalStorageSpaceShare,
  type PortalStorageSpaceRole,
  type PortalStorageSpaceShareCandidate,
  type PortalStorageSpaceShare,
} from "../../api/portal";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import PageTabs from "../../components/PageTabs";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import UiSelect from "../../components/ui/UiSelect";
import { cx, uiDividerClass, uiMutedTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { copyTextToClipboard } from "../../utils/clipboard";
import { PortalShareCandidatePicker, selectedPortalShares } from "./PortalAccessControls";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import type { PortalWorkspaceRole } from "./portalWorkspaceModel";
import {
  portalRoleTone,
  resolvePortalWorkspacePageState,
} from "./portalUi";
import {
  portalDateLabel,
  portalPublicLinkStatusLabel,
  portalRoleLabel,
} from "./portalI18n";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

const roles: PortalStorageSpaceRole[] = ["Viewer", "Editor", "Owner"];

type ShareTab = "with" | "by" | "links";
type PendingShareAction =
  | { type: "revoke-share"; share: ShareRow }
  | { type: "revoke-public-link"; link: PortalPublicLink };
type ShareRow = {
  id: string;
  userId?: number | null;
  spaceId: string;
  spaceName: string;
  person: string;
  access: PortalWorkspaceRole;
  activityLabel: string;
};
type PublicLinkRow = PortalPublicLink & { rowKey: string };

function fromApiShare(share: PortalStorageSpaceShare): ShareRow {
  return {
    id: share.id,
    userId: share.user_id,
    spaceId: share.storage_space_id,
    spaceName: share.storage_space_name,
    person: share.email,
    access: share.role,
    activityLabel: share.activity_label ?? "Active",
  };
}

function SharesTable({
  shares,
  editable,
  busyShareId,
  onRoleChange,
  onRevoke,
}: {
  shares: ShareRow[];
  editable: boolean;
  busyShareId: string | null;
  onRoleChange: (share: ShareRow, role: PortalStorageSpaceRole) => void;
  onRevoke: (share: ShareRow) => void;
}) {
  const { t } = useI18n();
  const tableStatus = shares.length === 0 ? "empty" : "ready";
  const columns = useMemo<DataTableColumn<ShareRow>[]>(
    () => [
      {
        id: "name",
        label: t({ en: "Space", fr: "Espace", de: "Bereich" }),
        mobileLabel: t({ en: "Space", fr: "Espace", de: "Bereich" }),
        primary: true,
        render: (share) => share.spaceName,
      },
      {
        id: "person",
        label: editable ? t({ en: "Collaborator", fr: "Collaborateur", de: "Mitwirkende" }) : t({ en: "Shared by", fr: "Partagé par", de: "Geteilt von" }),
        render: (share) => share.person,
      },
      {
        id: "access",
        label: t({ en: "Access", fr: "Accès", de: "Zugriff" }),
        render: (share) =>
          editable && share.userId ? (
            <UiSelect
              size="compact"
              className="h-8"
              value={share.access}
              disabled={busyShareId === share.id}
              onChange={(event) => onRoleChange(share, event.target.value as PortalStorageSpaceRole)}
              aria-label={t({ en: `Access for ${share.person}`, fr: `Accès pour ${share.person}`, de: `Zugriff für ${share.person}` })}
            >
              {roles.map((role) => (
                <option key={role} value={role}>{portalRoleLabel(role, t)}</option>
              ))}
            </UiSelect>
          ) : (
            <UiBadge tone={portalRoleTone(share.access)}>{portalRoleLabel(share.access, t)}</UiBadge>
          ),
      },
      {
        id: "activity",
        label: t({ en: "Activity", fr: "Activité", de: "Aktivität" }),
        render: (share) => (share.activityLabel === "Active" ? t({ en: "Active", fr: "Actif", de: "Aktiv" }) : share.activityLabel),
      },
      ...(editable
        ? [
            {
              id: "action",
              label: t({ en: "Action", fr: "Action", de: "Aktion" }),
              align: "right" as const,
              mobileRole: "actions" as const,
              render: (share: ShareRow) =>
                share.userId ? (
                  <button
                    type="button"
                    disabled={busyShareId === share.id}
                    onClick={() => onRevoke(share)}
                    className={tableDeleteActionClasses}
                  >
                    {t({ en: "Revoke", fr: "Révoquer", de: "Widerrufen" })}
                  </button>
                ) : null,
            },
          ]
        : []),
    ],
    [busyShareId, editable, onRevoke, onRoleChange, t]
  );

  return (
    <DataTableShell
      columns={columns}
      rows={shares}
      rowKey={(share) => share.id}
      status={tableStatus}
      loadingMessage={t({ en: "Loading collaborators...", fr: "Chargement des collaborateurs...", de: "Mitwirkende werden geladen..." })}
      errorMessage={t({ en: "Unable to load collaborators.", fr: "Impossible de charger les collaborateurs.", de: "Mitwirkende können nicht geladen werden." })}
      emptyMessage={
        editable
          ? t({ en: "No collaborators invited yet.", fr: "Aucun collaborateur invité pour l'instant.", de: "Noch keine Mitwirkenden eingeladen." })
          : t({ en: "No spaces have been shared with you yet.", fr: "Aucun espace n'a encore été partagé avec vous.", de: "Noch keine Bereiche wurden mit Ihnen geteilt." })
      }
      responsiveCards
    />
  );
}

export default function PortalSharesPage() {
  const { locale, t } = useI18n();
  const [activeTab, setActiveTab] = useState<ShareTab>("with");
  const [apiShares, setApiShares] = useState<PortalStorageSpaceShare[] | null>(null);
  const [sharesLoadedKey, setSharesLoadedKey] = useState<string | null>(null);
  const [publicLinks, setPublicLinks] = useState<PortalPublicLink[]>([]);
  const [sharesError, setSharesError] = useState<string | null>(null);
  const [shareCandidateQuery, setShareCandidateQuery] = useState("");
  const [shareCandidates, setShareCandidates] = useState<PortalStorageSpaceShareCandidate[]>([]);
  const [shareCandidatesLoading, setShareCandidatesLoading] = useState(false);
  const [selectedShareRolesByUserId, setSelectedShareRolesByUserId] = useState<Record<number, PortalStorageSpaceRole>>({});
  const [selectedSpaceId, setSelectedSpaceId] = useState("");
  const [sharesMessage, setSharesMessage] = useState<string | null>(null);
  const [busyShareId, setBusyShareId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingShareAction | null>(null);
  const {
    workspace,
    loading,
    error,
    hasAccountContext,
    accountError,
    accountLoading,
    accountIdForApi,
    refreshWorkspaceData = () => undefined,
  } = usePortalWorkspaceData();
  const initialUrlContextApplied = useRef(false);
  const activeCollaboratorSpaces = useMemo(
    () => workspace.spaces.filter((space) => space.status !== "Archived"),
    [workspace.spaces]
  );
  const activeOwnerSpaces = useMemo(
    () => activeCollaboratorSpaces.filter((space) => space.role === "Owner"),
    [activeCollaboratorSpaces]
  );

  const spaceIds = useMemo(() => workspace.spaces.map((space) => space.id).join("|"), [workspace.spaces]);
  const activeCollaboratorSpaceIds = useMemo(() => activeCollaboratorSpaces.map((space) => space.id).join("|"), [activeCollaboratorSpaces]);
  const sharesRequestKey = useMemo(
    () => (accountIdForApi ? `${accountIdForApi}:${activeCollaboratorSpaceIds}` : ""),
    [accountIdForApi, activeCollaboratorSpaceIds]
  );
  const selectedShareEntries = selectedPortalShares(selectedShareRolesByUserId);

  useEffect(() => {
    if (initialUrlContextApplied.current || workspace.spaces.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get("tab");
    const requestedSpaceId = params.get("space_id");
    if (requestedTab === "with" || requestedTab === "by" || requestedTab === "links") {
      setActiveTab(requestedTab);
    }
    if (requestedSpaceId && workspace.spaces.some((space) => space.id === requestedSpaceId)) {
      setSelectedSpaceId(requestedSpaceId);
    }
    initialUrlContextApplied.current = true;
  }, [workspace.spaces]);

  useEffect(() => {
    const selectableSpaces = activeTab === "with" ? activeCollaboratorSpaces : activeOwnerSpaces;
    if (!selectedSpaceId && selectableSpaces[0]) {
      setSelectedSpaceId(selectableSpaces[0].id);
    }
    if (selectedSpaceId && !selectableSpaces.some((space) => space.id === selectedSpaceId)) {
      setSelectedSpaceId(selectableSpaces[0]?.id ?? "");
    }
  }, [activeOwnerSpaces, activeCollaboratorSpaces, activeTab, selectedSpaceId]);

  useEffect(() => {
    let cancelled = false;
    if (!accountIdForApi || activeCollaboratorSpaces.length === 0) {
      setApiShares([]);
      setSharesLoadedKey(sharesRequestKey);
      setSharesError(null);
      return () => {
        cancelled = true;
      };
    }
    setApiShares(null);
    setSharesError(null);
    Promise.all(activeCollaboratorSpaces.map((space) => listPortalStorageSpaceShares(accountIdForApi, space.id)))
      .then((results) => {
        if (!cancelled) {
          setApiShares(results.flat());
          setSharesLoadedKey(sharesRequestKey);
        }
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setApiShares(null);
          setSharesLoadedKey(null);
          setSharesError(extractApiError(err, t({ en: "Unable to load collaborators.", fr: "Impossible de charger les collaborateurs.", de: "Mitwirkende können nicht geladen werden." })));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, activeCollaboratorSpaces, sharesRequestKey, t]);

  useEffect(() => {
    let cancelled = false;
    if (!accountIdForApi || workspace.spaces.length === 0) {
      setPublicLinks([]);
      return () => {
        cancelled = true;
      };
    }
    Promise.all(
      activeOwnerSpaces.map((space) => listPortalStorageSpacePublicLinks(accountIdForApi, space.id, { includeRevoked: true }))
    )
      .then((results) => {
        if (!cancelled) setPublicLinks(results.flat());
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setPublicLinks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, activeOwnerSpaces, spaceIds]);

  useEffect(() => {
    let cancelled = false;
    if (!accountIdForApi || activeTab !== "by" || !selectedSpaceId) {
      setShareCandidates([]);
      setShareCandidatesLoading(false);
      setSelectedShareRolesByUserId({});
      return () => {
        cancelled = true;
      };
    }
    setShareCandidatesLoading(true);
    listPortalStorageSpaceShareCandidates(accountIdForApi, selectedSpaceId)
      .then((candidates) => {
        if (cancelled) return;
        setShareCandidates(candidates);
        const availableUserIds = new Set(candidates.filter((candidate) => !candidate.already_shared).map((candidate) => candidate.user_id));
        setSelectedShareRolesByUserId((current) =>
          Object.fromEntries(Object.entries(current).filter(([userId]) => availableUserIds.has(Number(userId)))) as Record<number, PortalStorageSpaceRole>
        );
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setShareCandidates([]);
          setSelectedShareRolesByUserId({});
          setSharesError(extractApiError(err, t({ en: "Unable to load people.", fr: "Impossible de charger les personnes.", de: "Personen können nicht geladen werden." })));
        }
      })
      .finally(() => {
        if (!cancelled) setShareCandidatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, activeTab, selectedSpaceId, t]);

  useEffect(() => {
    setShareCandidateQuery("");
    setSelectedShareRolesByUserId({});
  }, [selectedSpaceId]);

  const rows = useMemo(() => {
    return {
      with: (apiShares ?? []).filter((share) => share.direction === "with_me").map(fromApiShare),
      by: (apiShares ?? []).filter((share) => share.direction === "by_me").map(fromApiShare),
      links: [],
    };
  }, [apiShares]);

  const refreshSpaceShares = async (spaceId: string) => {
    if (!accountIdForApi) return;
    const updated = await listPortalStorageSpaceShares(accountIdForApi, spaceId);
    setApiShares((current) => {
      const rest = (current ?? []).filter((share) => share.storage_space_id !== spaceId);
      return [...rest, ...updated];
    });
  };

  const handleCreateShare = async () => {
    if (!accountIdForApi || !selectedSpaceId || selectedShareEntries.length === 0) return;
    const selectedSpace = activeOwnerSpaces.find((space) => space.id === selectedSpaceId);
    if (!selectedSpace) return;
    setBusyShareId("new");
    setSharesError(null);
    try {
      if (selectedSpace.visibility === "private") {
        await updatePortalStorageSpace(accountIdForApi, selectedSpace.id, {
          visibility: "shared",
          share_scope: "restricted",
          account_member_role: null,
        });
        refreshWorkspaceData();
      }
      const createdShares = await Promise.all(
        selectedShareEntries.map((entry) =>
          grantPortalStorageSpaceShare(accountIdForApi, selectedSpaceId, {
            user_id: entry.user_id,
            role: entry.role,
          })
        )
      );
      setShareCandidateQuery("");
      setSelectedShareRolesByUserId({});
      setApiShares((current) => {
        const createdIds = new Set(createdShares.map((share) => share.id));
        const filtered = (current ?? []).filter((item) => !createdIds.has(item.id));
        return [...filtered, ...createdShares];
      });
      const sharedUserIds = new Set(selectedShareEntries.map((entry) => entry.user_id));
      setShareCandidates((current) =>
        current.map((candidate) =>
          sharedUserIds.has(candidate.user_id) ? { ...candidate, already_shared: true } : candidate
        )
      );
      setActiveTab("by");
    } catch (err) {
      console.error(err);
      setSharesError(extractApiError(err, t({ en: "Unable to invite collaborators.", fr: "Impossible d'inviter les collaborateurs.", de: "Mitwirkende können nicht eingeladen werden." })));
    } finally {
      setBusyShareId(null);
    }
  };

  const handleRoleChange = async (share: ShareRow, role: PortalStorageSpaceRole) => {
    if (!accountIdForApi || !share.userId) return;
    setBusyShareId(share.id);
    setSharesError(null);
    try {
      const updated = await updatePortalStorageSpaceShare(accountIdForApi, share.spaceId, share.userId, role);
      setApiShares((current) => (current ?? []).map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      console.error(err);
      setSharesError(extractApiError(err, t({ en: "Unable to update this collaborator.", fr: "Impossible de mettre à jour ce collaborateur.", de: "Dieser Mitwirkende kann nicht aktualisiert werden." })));
    } finally {
      setBusyShareId(null);
    }
  };

  const handleRevoke = async (share: ShareRow) => {
    if (!accountIdForApi || !share.userId) return;
    setPendingAction({ type: "revoke-share", share });
  };

  const confirmRevoke = async (share: ShareRow) => {
    if (!accountIdForApi || !share.userId) return;
    setBusyShareId(share.id);
    setSharesError(null);
    try {
      await revokePortalStorageSpaceShare(accountIdForApi, share.spaceId, share.userId);
      await refreshSpaceShares(share.spaceId);
      setPendingAction(null);
    } catch (err) {
      console.error(err);
      setSharesError(extractApiError(err, t({ en: "Unable to remove this collaborator.", fr: "Impossible de retirer ce collaborateur.", de: "Dieser Mitwirkende kann nicht entfernt werden." })));
      setPendingAction(null);
    } finally {
      setBusyShareId(null);
    }
  };

  const handleRevokePublicLink = useCallback((link: PortalPublicLink) => {
    if (!accountIdForApi) return;
    setPendingAction({ type: "revoke-public-link", link });
  }, [accountIdForApi]);

  const copyPublicLink = useCallback(async (link: PortalPublicLink) => {
    setSharesMessage(null);
    setSharesError(null);
    try {
      await copyTextToClipboard(link.url);
      setSharesMessage(t({ en: "Link copied.", fr: "Lien copié.", de: "Link kopiert." }));
    } catch {
      setSharesMessage(t({ en: "Clipboard is unavailable in this browser.", fr: "Le presse-papiers est indisponible dans ce navigateur.", de: "Die Zwischenablage ist in diesem Browser nicht verfügbar." }));
    }
  }, [t]);

  const confirmRevokePublicLink = async (link: PortalPublicLink) => {
    if (!accountIdForApi) return;
    setBusyShareId(`public-link-${link.id}`);
    setSharesError(null);
    try {
      const updated = await revokePortalStorageSpacePublicLink(accountIdForApi, link.storage_space_id, link.id);
      setPublicLinks((current) => [
        ...current.filter((item) => item.storage_space_id !== link.storage_space_id),
        ...updated,
      ]);
      setPendingAction(null);
    } catch (err) {
      console.error(err);
      setSharesError(extractApiError(err, t({ en: "Unable to revoke public link.", fr: "Impossible de révoquer le lien public.", de: "Öffentlicher Link kann nicht widerrufen werden." })));
      setPendingAction(null);
    } finally {
      setBusyShareId(null);
    }
  };

  const shares = rows[activeTab];
  const displayedCount = activeTab === "links" ? publicLinks.length : shares.length;
  const publicLinkRows = useMemo<PublicLinkRow[]>(
    () => publicLinks.map((link) => ({ ...link, rowKey: String(link.id) })),
    [publicLinks]
  );
  const publicLinksTableStatus = publicLinkRows.length === 0 ? "empty" : "ready";
  const publicLinkColumns = useMemo<DataTableColumn<PublicLinkRow>[]>(
    () => [
      {
        id: "space",
        label: t({ en: "Space", fr: "Espace", de: "Bereich" }),
        primary: true,
        render: (link) => link.storage_space_name,
      },
      {
        id: "file",
        label: t({ en: "File", fr: "Fichier", de: "Datei" }),
        render: (link) => link.object_name,
      },
      {
        id: "status",
        label: t({ en: "Status", fr: "Statut", de: "Status" }),
        render: (link) => <UiBadge tone={link.status === "Active" ? "success" : "neutral"}>{portalPublicLinkStatusLabel(link.status, t)}</UiBadge>,
      },
      {
        id: "expires",
        label: t({ en: "Expires", fr: "Expire", de: "Läuft ab" }),
        render: (link) => (link.expires_at ? portalDateLabel(link.expires_at, locale) : "-"),
      },
      {
        id: "url",
        label: t({ en: "URL", fr: "URL", de: "URL" }),
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
            <button type="button" onClick={() => copyPublicLink(link)} className={tableActionButtonClasses}>
              {t({ en: "Copy", fr: "Copier", de: "Kopieren" })}
            </button>
            {link.status === "Active" ? (
              <button
                type="button"
                disabled={busyShareId === `public-link-${link.id}`}
                onClick={() => handleRevokePublicLink(link)}
                className={tableDeleteActionClasses}
              >
                {t({ en: "Revoke", fr: "Révoquer", de: "Widerrufen" })}
              </button>
            ) : null}
          </div>
        ),
      },
    ],
    [busyShareId, copyPublicLink, handleRevokePublicLink, locale, t]
  );

  const sharesInitialLoading = Boolean(
    accountIdForApi && activeCollaboratorSpaces.length > 0 && !sharesError && sharesLoadedKey !== sharesRequestKey
  );
  const pageState = resolvePortalWorkspacePageState({
    accountLoading,
    loading: loading || sharesInitialLoading,
    accountError,
    error,
    hasAccountContext,
    loadingMessage: t({ en: "Loading collaborators...", fr: "Chargement des collaborateurs...", de: "Mitwirkende werden geladen..." }),
    noAccountMessage: t({ en: "Select an account to manage collaborators.", fr: "Sélectionnez un compte pour gérer les collaborateurs.", de: "Wählen Sie ein Konto aus, um Mitwirkende zu verwalten." }),
  });
  if (pageState) return pageState;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t({ en: "Collaborators", fr: "Collaborateurs", de: "Mitwirkende" })}
        description={t({ en: "Invite people to spaces and review public links.", fr: "Invitez des personnes dans des espaces et vérifiez les liens publics.", de: "Laden Sie Personen in Bereiche ein und prüfen Sie öffentliche Links." })}
        breadcrumbs={portalBreadcrumbs({ label: t({ en: "Collaborators", fr: "Collaborateurs", de: "Mitwirkende" }) })}
      />
      {sharesError ? <PageBanner tone="warning">{sharesError}</PageBanner> : null}
      {sharesMessage ? <PageBanner tone="info">{sharesMessage}</PageBanner> : null}
      <UiCard>
        <div className={cx("mb-3 border-b pb-3", uiDividerClass)}>
          <PageTabs
            tabs={[
              { id: "with", label: t({ en: "Shared with me", fr: "Partagés avec moi", de: "Mit mir geteilt" }) },
              { id: "by", label: t({ en: "People I invited", fr: "Personnes invitées", de: "Von mir eingeladene Personen" }) },
              { id: "links", label: t({ en: "Public links", fr: "Liens publics", de: "Öffentliche Links" }) },
            ]}
            activeTab={activeTab}
            onChange={(tab) => setActiveTab(tab as ShareTab)}
            variant="bar"
          />
        </div>
        {activeTab === "links" ? (
          <DataTableShell
            columns={publicLinkColumns}
            rows={publicLinkRows}
            rowKey={(link) => link.rowKey}
            status={publicLinksTableStatus}
            loadingMessage={t({ en: "Loading public links...", fr: "Chargement des liens publics...", de: "Öffentliche Links werden geladen..." })}
            errorMessage={t({ en: "Unable to load public links.", fr: "Impossible de charger les liens publics.", de: "Öffentliche Links können nicht geladen werden." })}
            emptyMessage={t({ en: "No public links yet.", fr: "Aucun lien public pour l'instant.", de: "Noch keine öffentlichen Links." })}
            responsiveCards
          />
        ) : (
          <SharesTable
            shares={shares}
            editable={activeTab === "by"}
            busyShareId={busyShareId}
            onRoleChange={handleRoleChange}
            onRevoke={handleRevoke}
          />
        )}
        <div className={cx("mt-4 flex items-center justify-between text-[11px] font-semibold", uiMutedTextClass)}>
          <span>
            {t({
              en: `${displayedCount} of ${displayedCount}`,
              fr: `${displayedCount} sur ${displayedCount}`,
              de: `${displayedCount} von ${displayedCount}`,
            })}
          </span>
        </div>
      </UiCard>

      {activeTab === "by" ? (
        <UiCard title={t({ en: "Invite people to a space", fr: "Inviter des personnes dans un espace", de: "Personen in einen Bereich einladen" })}>
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)_auto]">
              <UiSelect
                size="compact"
                className="h-9"
                value={selectedSpaceId}
                onChange={(event) => setSelectedSpaceId(event.target.value)}
                aria-label={t({ en: "Space to share", fr: "Espace à partager", de: "Zu teilender Bereich" })}
              >
                {activeOwnerSpaces.map((space) => (
                  <option key={space.id} value={space.id}>{space.name}</option>
                ))}
              </UiSelect>
              <div className={cx("self-center text-xs font-medium", uiMutedTextClass)}>
                {t({
                  en: "Choose people who already have workspace access, then decide what they can do in this space.",
                  fr: "Choisissez des personnes qui ont déjà accès au workspace, puis décidez ce qu'elles peuvent faire dans cet espace.",
                  de: "Wählen Sie Personen mit Workspace-Zugriff aus und legen Sie fest, was sie in diesem Bereich tun dürfen.",
                })}
              </div>
              <UiButton
                disabled={!accountIdForApi || !selectedSpaceId || selectedShareEntries.length === 0 || busyShareId === "new" || activeOwnerSpaces.length === 0}
                onClick={handleCreateShare}
                className="h-9 px-3 py-1.5"
              >
                {busyShareId === "new"
                  ? t({ en: "Inviting...", fr: "Invitation...", de: "Einladung läuft..." })
                  : t({ en: "Invite people", fr: "Inviter", de: "Einladen" })}
              </UiButton>
            </div>
            <PortalShareCandidatePicker
              candidates={shareCandidates}
              selectedRolesByUserId={selectedShareRolesByUserId}
              query={shareCandidateQuery}
              loading={shareCandidatesLoading}
              error={null}
              includeAlreadyShared
              onQueryChange={setShareCandidateQuery}
              onRoleChange={(userId, role) => {
                setSelectedShareRolesByUserId((current) => {
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
          </div>
        </UiCard>
      ) : null}

      {pendingAction?.type === "revoke-share" ? (
        <ConfirmActionDialog
          title={t({ en: "Revoke access", fr: "Révoquer l'accès", de: "Zugriff widerrufen" })}
          description={t({ en: "Confirm that you want to remove this person's access.", fr: "Confirmez que vous voulez retirer l'accès de cette personne.", de: "Bestätigen Sie, dass Sie den Zugriff dieser Person entfernen möchten." })}
          confirmLabel={t({ en: "Revoke access", fr: "Révoquer l'accès", de: "Zugriff widerrufen" })}
          loading={busyShareId === pendingAction.share.id}
          details={[
            { label: t({ en: "Person", fr: "Personne", de: "Person" }), value: pendingAction.share.person },
            { label: t({ en: "Space", fr: "Espace", de: "Bereich" }), value: pendingAction.share.spaceName },
            { label: t({ en: "Access", fr: "Accès", de: "Zugriff" }), value: portalRoleLabel(pendingAction.share.access, t) },
          ]}
          impacts={[
            t({ en: "This person loses access to the space immediately.", fr: "Cette personne perd immédiatement l'accès à l'espace.", de: "Diese Person verliert sofort den Zugriff auf den Bereich." }),
            t({ en: "Files in the space are not deleted.", fr: "Les fichiers de l'espace ne sont pas supprimés.", de: "Dateien im Bereich werden nicht gelöscht." }),
            t({ en: "You can invite the person again later if needed.", fr: "Vous pourrez réinviter cette personne plus tard si nécessaire.", de: "Sie können diese Person später bei Bedarf erneut einladen." }),
          ]}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => confirmRevoke(pendingAction.share)}
        />
      ) : null}

      {pendingAction?.type === "revoke-public-link" ? (
        <ConfirmActionDialog
          title={t({ en: "Revoke public link", fr: "Révoquer le lien public", de: "Öffentlichen Link widerrufen" })}
          description={t({ en: "Confirm that you want to revoke this public link.", fr: "Confirmez que vous voulez révoquer ce lien public.", de: "Bestätigen Sie, dass Sie diesen öffentlichen Link widerrufen möchten." })}
          confirmLabel={t({ en: "Revoke link", fr: "Révoquer le lien", de: "Link widerrufen" })}
          loading={busyShareId === `public-link-${pendingAction.link.id}`}
          details={[
            { label: t({ en: "File", fr: "Fichier", de: "Datei" }), value: pendingAction.link.object_name },
            { label: t({ en: "Space", fr: "Espace", de: "Bereich" }), value: pendingAction.link.storage_space_name },
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
