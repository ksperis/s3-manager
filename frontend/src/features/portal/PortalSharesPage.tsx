/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import {
  listPortalStorageSpacePublicLinks,
  listPortalStorageSpaceShares,
  revokePortalStorageSpacePublicLink,
  type PortalCollaborator,
  type PortalPublicLink,
  type PortalStorageSpaceShare,
} from "../../api/portal";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import DataTableShell, {
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import PageTabs from "../../components/PageTabs";
import {
  tableActionButtonClasses,
  tableDeleteActionClasses,
} from "../../components/tableActionClasses";
import UiBadge from "../../components/ui/UiBadge";
import UiCard from "../../components/ui/UiCard";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import UserAvatar from "../../components/UserAvatar";
import {
  cx,
  uiButtonBaseClass,
  uiButtonVariants,
  uiDividerClass,
  uiMutedTextClass,
  uiPanelMutedClass,
} from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { copyTextToClipboard } from "../../utils/clipboard";
import PortalPageTabs from "./PortalPageTabs";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import {
  storageSpacePath,
  type PortalWorkspaceRole,
} from "./portalWorkspaceModel";
import { portalRoleTone, resolvePortalWorkspacePageState } from "./portalUi";
import {
  portalAccessSourceLabel,
  portalAccountRoleLabel,
  portalDateLabel,
  portalPublicLinkStatusLabel,
  portalRoleLabel,
} from "./portalI18n";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

type ShareTab = "with" | "by";
type CollaboratorsViewTab = "members" | "access" | "links";
type PendingShareAction =
  { type: "revoke-public-link"; link: PortalPublicLink };
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
  direction,
}: {
  shares: ShareRow[];
  direction: ShareTab;
}) {
  const { t } = useI18n();
  const sharedByMe = direction === "by";
  const tableStatus = shares.length === 0 ? "empty" : "ready";
  const columns = useMemo<DataTableColumn<ShareRow>[]>(
    () => [
      {
        id: "name",
        label: t({ en: "Space", fr: "Espace", de: "Bereich" }),
        mobileLabel: t({ en: "Space", fr: "Espace", de: "Bereich" }),
        primary: true,
        render: (share) => (
          <Link
            to={`/portal/storage-spaces/${encodeURIComponent(share.spaceId)}?tab=collaborators`}
            className="font-bold text-primary hover:underline dark:text-primary-200"
          >
            {share.spaceName}
          </Link>
        ),
      },
      {
        id: "person",
        label: sharedByMe
          ? t({ en: "Collaborator", fr: "Collaborateur", de: "Mitwirkende" })
          : t({ en: "Shared by", fr: "Partagé par", de: "Geteilt von" }),
        mobileLabel: sharedByMe
          ? t({ en: "Person", fr: "Personne", de: "Person" })
          : t({ en: "Shared by", fr: "Partagé par", de: "Geteilt von" }),
        render: (share) => share.person,
      },
      {
        id: "access",
        label: t({ en: "Access", fr: "Accès", de: "Zugriff" }),
        render: (share) => (
          <UiBadge tone={portalRoleTone(share.access)}>
            {portalRoleLabel(share.access, t)}
          </UiBadge>
        ),
      },
      {
        id: "activity",
        label: t({ en: "Activity", fr: "Activité", de: "Aktivität" }),
        render: (share) =>
          share.activityLabel === "Active"
            ? t({ en: "Active", fr: "Actif", de: "Aktiv" })
            : share.activityLabel,
      },
      ...(sharedByMe
        ? [
            {
              id: "action",
              label: t({ en: "Action", fr: "Action", de: "Aktion" }),
              align: "right" as const,
              mobileRole: "actions" as const,
              render: (share: ShareRow) => (
                <Link
                  to={`/portal/storage-spaces/${encodeURIComponent(share.spaceId)}?tab=collaborators`}
                  className={tableActionButtonClasses}
                >
                  {t({
                    en: "Manage in space",
                    fr: "Gérer dans l'espace",
                    de: "Im Bereich verwalten",
                  })}
                </Link>
              ),
            },
          ]
        : []),
    ],
    [sharedByMe, t],
  );

  return (
    <DataTableShell
      columns={columns}
      rows={shares}
      rowKey={(share) => share.id}
      status={tableStatus}
      loadingMessage={t({
        en: "Loading collaborators...",
        fr: "Chargement des collaborateurs...",
        de: "Mitwirkende werden geladen...",
      })}
      errorMessage={t({
        en: "Unable to load collaborators.",
        fr: "Impossible de charger les collaborateurs.",
        de: "Mitwirkende können nicht geladen werden.",
      })}
      emptyMessage={
        sharedByMe
          ? t({
              en: "No direct access has been granted yet.",
              fr: "Aucun accès direct n'a encore été accordé.",
              de: "Es wurde noch kein direkter Zugriff vergeben.",
            })
          : t({
              en: "No spaces have been shared with you yet.",
              fr: "Aucun espace n'a encore été partagé avec vous.",
              de: "Noch keine Bereiche wurden mit Ihnen geteilt.",
            })
      }
      responsiveCards
    />
  );
}

function CollaboratorsInventory({
  collaborators,
  loading,
  error,
  query,
  onQueryChange,
}: {
  collaborators: PortalCollaborator[];
  loading: boolean;
  error?: string | null;
  query: string;
  onQueryChange: (value: string) => void;
}) {
  const { locale, t } = useI18n();
  const term = query.trim().toLowerCase();
  const visibleCollaborators = useMemo(
    () =>
      collaborators.filter((collaborator) => {
        if (!term) return true;
        return [
          collaborator.email,
          collaborator.display_name,
          collaborator.account_role,
          collaborator.access_source,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term));
      }),
    [collaborators, term],
  );
  const tableStatus: "loading" | "error" | "empty" | "ready" =
    loading && visibleCollaborators.length === 0
      ? "loading"
      : error && visibleCollaborators.length === 0
        ? "error"
        : visibleCollaborators.length === 0
          ? "empty"
          : "ready";
  const columns = useMemo<DataTableColumn<PortalCollaborator>[]>(
    () => [
      {
        id: "person",
        label: t({ en: "Person", fr: "Personne", de: "Person" }),
        primary: true,
        render: (collaborator) => (
          <span className="flex min-w-0 items-center gap-2.5">
            <UserAvatar
              avatar={collaborator.avatar}
              name={collaborator.display_name || collaborator.email}
              email={collaborator.email}
              size="sm"
            />
            <span className="min-w-0">
              <span className="block truncate font-semibold text-[var(--ui-text)]">
                {collaborator.display_name || collaborator.email}
              </span>
              <span
                className={cx(
                  "block truncate text-[11px] font-medium",
                  uiMutedTextClass,
                )}
              >
                {collaborator.email}
              </span>
            </span>
          </span>
        ),
      },
      {
        id: "role",
        label: t({
          en: "Project role",
          fr: "Rôle projet",
          de: "Projektrolle",
        }),
        render: (collaborator) => (
          <UiBadge
            tone={
              collaborator.account_role === "portal_manager"
                ? "primary"
                : "neutral"
            }
          >
            {portalAccountRoleLabel(collaborator.account_role, t)}
          </UiBadge>
        ),
      },
      {
        id: "source",
        label: t({ en: "Access", fr: "Accès", de: "Zugriff" }),
        render: (collaborator) =>
          portalAccessSourceLabel(collaborator.access_source, t),
      },
      {
        id: "since",
        label: t({
          en: "Member since",
          fr: "Membre depuis",
          de: "Mitglied seit",
        }),
        render: (collaborator) =>
          collaborator.member_since
            ? portalDateLabel(collaborator.member_since, locale)
            : "-",
      },
    ],
    [locale, t],
  );

  return (
    <UiCard
      title={t({
        en: "Project members",
        fr: "Membres du projet",
        de: "Projektmitglieder",
      })}
    >
      <div className="space-y-3">
        <p className={cx("ui-caption", uiMutedTextClass)}>
          {t({
            en: "Project membership makes someone available for collaboration. Access to files is granted separately in each space.",
            fr: "L'appartenance au projet rend une personne disponible pour collaborer. L'accès aux fichiers est accordé séparément dans chaque espace.",
            de: "Die Projektmitgliedschaft macht eine Person für die Zusammenarbeit verfügbar. Der Dateizugriff wird in jedem Bereich separat vergeben.",
          })}
        </p>
        <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_auto] md:items-end">
          <UiInput
            label={t({
              en: "Search members",
              fr: "Rechercher des membres",
              de: "Mitglieder suchen",
            })}
            size="compact"
            className="h-9"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t({
              en: "Name, email, or access source...",
              fr: "Nom, email ou source d'accès...",
              de: "Name, E-Mail oder Zugriffsquelle...",
            })}
          />
          <div
            className={cx(
              "self-center text-[11px] font-semibold",
              uiMutedTextClass,
            )}
          >
            {t({
              en: `${visibleCollaborators.length} of ${collaborators.length} member${collaborators.length === 1 ? "" : "s"}`,
              fr: `${visibleCollaborators.length} sur ${collaborators.length} membre${collaborators.length > 1 ? "s" : ""}`,
              de: `${visibleCollaborators.length} von ${collaborators.length} Mitglied${collaborators.length === 1 ? "" : "ern"}`,
            })}
          </div>
        </div>
        <DataTableShell
          columns={columns}
          rows={visibleCollaborators}
          rowKey={(collaborator) => collaborator.user_id}
          status={tableStatus}
          loadingMessage={t({
            en: "Loading project members...",
            fr: "Chargement des membres du projet...",
            de: "Projektmitglieder werden geladen...",
          })}
          errorMessage={
            error ??
            t({
              en: "Unable to load project members.",
              fr: "Impossible de charger les membres du projet.",
              de: "Projektmitglieder können nicht geladen werden.",
            })
          }
          emptyMessage={
            term
              ? t({
                  en: "No member matches this search.",
                  fr: "Aucun membre ne correspond à cette recherche.",
                  de: "Kein Mitglied passt zu dieser Suche.",
                })
              : t({
                  en: "No project members to display.",
                  fr: "Aucun membre du projet à afficher.",
                  de: "Keine Projektmitglieder zum Anzeigen.",
                })
          }
          responsiveCards
        />
      </div>
    </UiCard>
  );
}

export default function PortalSharesPage() {
  const { locale, t } = useI18n();
  const [activeViewTab, setActiveViewTab] =
    useState<CollaboratorsViewTab>("members");
  const [activeTab, setActiveTab] = useState<ShareTab>("with");
  const [apiShares, setApiShares] = useState<PortalStorageSpaceShare[] | null>(
    null,
  );
  const [sharesLoadedKey, setSharesLoadedKey] = useState<string | null>(null);
  const [publicLinks, setPublicLinks] = useState<PortalPublicLink[]>([]);
  const [sharesError, setSharesError] = useState<string | null>(null);
  const [selectedLinkSpaceId, setSelectedLinkSpaceId] = useState("");
  const [collaboratorQuery, setCollaboratorQuery] = useState("");
  const [sharesMessage, setSharesMessage] = useState<string | null>(null);
  const [busyShareId, setBusyShareId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingShareAction | null>(
    null,
  );
  const {
    workspace,
    loading,
    error,
    hasAccountContext,
    accountError,
    accountLoading,
    accountIdForApi,
    collaborators,
    collaboratorsLoading,
    collaboratorsError,
  } = usePortalWorkspaceData({ includeCollaborators: true });
  const initialUrlContextApplied = useRef(false);
  const activeCollaboratorSpaces = useMemo(
    () => workspace.spaces.filter((space) => space.status !== "Archived"),
    [workspace.spaces],
  );
  const activeManagedTeamSpaces = useMemo(
    () => activeCollaboratorSpaces.filter((space) => space.role === "Manager" && space.visibility === "shared"),
    [activeCollaboratorSpaces],
  );

  const activeCollaboratorSpaceIds = useMemo(
    () => activeCollaboratorSpaces.map((space) => space.id).join("|"),
    [activeCollaboratorSpaces],
  );
  const sharesRequestKey = useMemo(
    () =>
      accountIdForApi ? `${accountIdForApi}:${activeCollaboratorSpaceIds}` : "",
    [accountIdForApi, activeCollaboratorSpaceIds],
  );
  const selectedPublicLinkSpace =
    activeManagedTeamSpaces.find((space) => space.id === selectedLinkSpaceId) ??
    null;

  useEffect(() => {
    if (initialUrlContextApplied.current || workspace.spaces.length === 0)
      return;
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get("tab");
    const requestedSpaceId = params.get("space_id");
    if (requestedTab === "with" || requestedTab === "by") {
      setActiveTab(requestedTab);
      setActiveViewTab("access");
    } else if (requestedTab === "links") {
      setActiveViewTab("links");
    }
    const requestedView = params.get("view");
    if (requestedView === "members" || requestedView === "access" || requestedView === "links") {
      setActiveViewTab(requestedView);
    } else if (requestedView === "invite") {
      setActiveViewTab("access");
    }
    if (
      requestedSpaceId &&
      workspace.spaces.some((space) => space.id === requestedSpaceId)
    ) {
      setSelectedLinkSpaceId(requestedSpaceId);
    }
    initialUrlContextApplied.current = true;
  }, [workspace.spaces]);

  useEffect(() => {
    if (selectedLinkSpaceId && !activeManagedTeamSpaces.some((space) => space.id === selectedLinkSpaceId)) {
      setSelectedLinkSpaceId("");
    }
  }, [activeManagedTeamSpaces, selectedLinkSpaceId]);

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
    Promise.all(
      activeCollaboratorSpaces.map((space) =>
        listPortalStorageSpaceShares(accountIdForApi, space.id),
      ),
    )
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
          setSharesError(
            extractApiError(
              err,
              t({
                en: "Unable to load collaborators.",
                fr: "Impossible de charger les collaborateurs.",
                de: "Mitwirkende können nicht geladen werden.",
              }),
            ),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, activeCollaboratorSpaces, sharesRequestKey, t]);

  useEffect(() => {
    let cancelled = false;
    if (!accountIdForApi || activeManagedTeamSpaces.length === 0) {
      setPublicLinks([]);
      return () => {
        cancelled = true;
      };
    }
    Promise.all(
      activeManagedTeamSpaces.map((space) =>
        listPortalStorageSpacePublicLinks(accountIdForApi, space.id, {
          includeRevoked: true,
        }),
      ),
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
  }, [accountIdForApi, activeManagedTeamSpaces]);

  const rows = useMemo(() => {
    return {
      with: (apiShares ?? [])
        .filter((share) => share.direction === "with_me")
        .map(fromApiShare),
      by: (apiShares ?? [])
        .filter((share) => share.direction === "by_me")
        .map(fromApiShare),
      links: [],
    };
  }, [apiShares]);

  const handleRevokePublicLink = useCallback(
    (link: PortalPublicLink) => {
      if (!accountIdForApi) return;
      setPendingAction({ type: "revoke-public-link", link });
    },
    [accountIdForApi],
  );

  const copyPublicLink = useCallback(
    async (link: PortalPublicLink) => {
      setSharesMessage(null);
      setSharesError(null);
      try {
        await copyTextToClipboard(link.url);
        setSharesMessage(
          t({ en: "Link copied.", fr: "Lien copié.", de: "Link kopiert." }),
        );
      } catch {
        setSharesMessage(
          t({
            en: "Clipboard is unavailable in this browser.",
            fr: "Le presse-papiers est indisponible dans ce navigateur.",
            de: "Die Zwischenablage ist in diesem Browser nicht verfügbar.",
          }),
        );
      }
    },
    [t],
  );

  const confirmRevokePublicLink = async (link: PortalPublicLink) => {
    if (!accountIdForApi) return;
    setBusyShareId(`public-link-${link.id}`);
    setSharesError(null);
    try {
      const updated = await revokePortalStorageSpacePublicLink(
        accountIdForApi,
        link.storage_space_id,
        link.id,
      );
      setPublicLinks((current) => [
        ...current.filter(
          (item) => item.storage_space_id !== link.storage_space_id,
        ),
        ...updated,
      ]);
      setPendingAction(null);
    } catch (err) {
      console.error(err);
      setSharesError(
        extractApiError(
          err,
          t({
            en: "Unable to revoke public link.",
            fr: "Impossible de révoquer le lien public.",
            de: "Öffentlicher Link kann nicht widerrufen werden.",
          }),
        ),
      );
      setPendingAction(null);
    } finally {
      setBusyShareId(null);
    }
  };

  const shares = rows[activeTab];
  const publicLinkRows = useMemo<PublicLinkRow[]>(
    () =>
      publicLinks
        .filter(
          (link) =>
            !selectedLinkSpaceId ||
            link.storage_space_id === selectedLinkSpaceId,
        )
        .map((link) => ({ ...link, rowKey: String(link.id) })),
    [publicLinks, selectedLinkSpaceId],
  );
  const activePublicLinkCount = publicLinkRows.filter(
    (link) => link.status === "Active",
  ).length;
  const publicLinksTableStatus =
    publicLinkRows.length === 0 ? "empty" : "ready";
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
        render: (link) => (
          <UiBadge tone={link.status === "Active" ? "success" : "neutral"}>
            {portalPublicLinkStatusLabel(link.status, t)}
          </UiBadge>
        ),
      },
      {
        id: "expires",
        label: t({ en: "Expires", fr: "Expire", de: "Läuft ab" }),
        render: (link) =>
          link.expires_at ? portalDateLabel(link.expires_at, locale) : "-",
      },
      {
        id: "url",
        label: t({ en: "URL", fr: "URL", de: "URL" }),
        cellClassName:
          "max-w-[260px] truncate text-primary dark:text-primary-200",
        render: (link) => link.url,
      },
      {
        id: "action",
        label: t({ en: "Action", fr: "Action", de: "Aktion" }),
        align: "right",
        mobileRole: "actions",
        render: (link) => (
          <div className="flex flex-wrap justify-end gap-2 max-md:justify-start">
            <button
              type="button"
              onClick={() => copyPublicLink(link)}
              className={tableActionButtonClasses}
            >
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
    [busyShareId, copyPublicLink, handleRevokePublicLink, locale, t],
  );

  const sharesInitialLoading = Boolean(
    accountIdForApi &&
    activeCollaboratorSpaces.length > 0 &&
    !sharesError &&
    sharesLoadedKey !== sharesRequestKey,
  );
  const pageState = resolvePortalWorkspacePageState({
    accountLoading,
    loading: loading || sharesInitialLoading,
    accountError,
    error,
    hasAccountContext,
    loadingMessage: t({
      en: "Loading collaborators...",
      fr: "Chargement des collaborateurs...",
      de: "Mitwirkende werden geladen...",
    }),
    noAccountMessage: t({
      en: "Select a project to manage collaborators.",
      fr: "Sélectionnez un projet pour gérer les collaborateurs.",
      de: "Wählen Sie ein Projekt aus, um Mitwirkende zu verwalten.",
    }),
  });
  if (pageState) return pageState;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t({
          en: "Collaborators",
          fr: "Collaborateurs",
          de: "Mitwirkende",
        })}
        description={t({
          en: "See who belongs to the project, review access by space, and track links shared outside it.",
          fr: "Consultez les membres du projet, contrôlez les accès par espace et suivez les liens partagés à l'extérieur.",
          de: "Sehen Sie Projektmitglieder, prüfen Sie Zugriffe pro Bereich und verfolgen Sie extern geteilte Links.",
        })}
        breadcrumbs={portalBreadcrumbs({
          label: t({
            en: "Collaborators",
            fr: "Collaborateurs",
            de: "Mitwirkende",
          }),
        })}
        actions={[
          {
            label: t({
              en: "Open spaces",
              fr: "Ouvrir les espaces",
              de: "Bereiche öffnen",
            }),
            to: "/portal/storage-spaces",
          },
        ]}
      />
      {sharesError ? (
        <PageBanner tone="warning">{sharesError}</PageBanner>
      ) : null}
      {sharesMessage ? (
        <PageBanner tone="info">{sharesMessage}</PageBanner>
      ) : null}

      <PageBanner tone="info">
        {t({
          en: "A project member does not automatically have access to every file. Invite and manage people from the Collaborators tab of the relevant space.",
          fr: "Un membre du projet n'accède pas automatiquement à tous les fichiers. Invitez et gérez les personnes depuis l'onglet Collaborateurs de l'espace concerné.",
          de: "Ein Projektmitglied hat nicht automatisch Zugriff auf alle Dateien. Laden Sie Personen im Tab Mitwirkende des jeweiligen Bereichs ein und verwalten Sie sie dort.",
        })}
      </PageBanner>

      <PortalPageTabs
        tabs={[
          {
            id: "members",
            label: t({
              en: "Project members",
              fr: "Membres du projet",
              de: "Projektmitglieder",
            }),
          },
          {
            id: "access",
            label: t({
              en: "Access by space",
              fr: "Accès par espace",
              de: "Zugriff nach Bereich",
            }),
          },
          {
            id: "links",
            label: t({
              en: "External links",
              fr: "Liens externes",
              de: "Externe Links",
            }),
          },
        ]}
        activeTab={activeViewTab}
        onChange={(tab) => setActiveViewTab(tab as CollaboratorsViewTab)}
        ariaLabel={t({
          en: "Collaborator overview",
          fr: "Vue d'ensemble des collaborateurs",
          de: "Mitwirkendenübersicht",
        })}
        idPrefix="portal-collaborators"
      />

      {activeViewTab === "members" ? (
        <CollaboratorsInventory
          collaborators={collaborators?.collaborators ?? []}
          loading={collaboratorsLoading}
          error={collaboratorsError}
          query={collaboratorQuery}
          onQueryChange={setCollaboratorQuery}
        />
      ) : null}

      {activeViewTab === "access" ? (
        <UiCard
          title={t({
            en: "Access by space",
            fr: "Accès par espace",
            de: "Zugriff nach Bereich",
          })}
        >
          <p className={cx("mb-3 ui-caption", uiMutedTextClass)}>
            {t({
              en: "This overview is read-only. Open a space to invite someone, change a role, or remove access.",
              fr: "Cette vue est en lecture seule. Ouvrez un espace pour inviter une personne, modifier un rôle ou retirer un accès.",
              de: "Diese Übersicht ist schreibgeschützt. Öffnen Sie einen Bereich, um Personen einzuladen, Rollen zu ändern oder Zugriffe zu entfernen.",
            })}
          </p>
          <div className={cx("mb-3 border-b pb-3", uiDividerClass)}>
            <PageTabs
              tabs={[
                {
                  id: "with",
                  label: t({
                    en: "Shared with me",
                    fr: "Partagés avec moi",
                    de: "Mit mir geteilt",
                  }),
                },
                {
                  id: "by",
                  label: t({
                    en: "Granted by me",
                    fr: "Accordés par moi",
                    de: "Von mir vergeben",
                  }),
                },
              ]}
              activeTab={activeTab}
              onChange={(tab) => setActiveTab(tab as ShareTab)}
              variant="bar"
              ariaLabel={t({
                en: "Access direction",
                fr: "Direction des accès",
                de: "Zugriffsrichtung",
              })}
              idPrefix="portal-space-access"
            />
          </div>
          <SharesTable shares={shares} direction={activeTab} />
          <div className={cx("mt-4 text-[11px] font-semibold", uiMutedTextClass)}>
            {t({
              en: `${shares.length} ${shares.length === 1 ? "entry" : "entries"}`,
              fr: `${shares.length} entrée${shares.length > 1 ? "s" : ""}`,
              de: `${shares.length} Eintrag${shares.length === 1 ? "" : "e"}`,
            })}
          </div>
        </UiCard>
      ) : null}

      {activeViewTab === "links" ? (
        <UiCard
          title={t({
            en: "External links",
            fr: "Liens externes",
            de: "Externe Links",
          })}
        >
          <div className="space-y-3">
            <section
              className={cx(uiPanelMutedClass, "p-4")}
              aria-labelledby="portal-public-link-guidance-title"
            >
              <h2 id="portal-public-link-guidance-title" className="ui-subtitle">
                {t({
                  en: "Create links from a file",
                  fr: "Créer les liens depuis un fichier",
                  de: "Links aus einer Datei erstellen",
                })}
              </h2>
              <p className={cx("mt-1 ui-caption", uiMutedTextClass)}>
                {t({
                  en: "Public links are created from file actions. Use this overview to copy or revoke existing links.",
                  fr: "Les liens publics se créent depuis les actions d'un fichier. Utilisez cette vue pour copier ou révoquer les liens existants.",
                  de: "Öffentliche Links werden über Dateiaktionen erstellt. In dieser Übersicht können Sie vorhandene Links kopieren oder widerrufen.",
                })}
              </p>
              {activeManagedTeamSpaces.length > 0 ? (
                <div className="mt-3 grid gap-3 md:grid-cols-[220px_minmax(0,1fr)_auto] md:items-end">
                  <UiSelect
                    label={t({ en: "Filter by space", fr: "Filtrer par espace", de: "Nach Bereich filtern" })}
                    size="compact"
                    className="h-9"
                    value={selectedLinkSpaceId}
                    onChange={(event) => setSelectedLinkSpaceId(event.target.value)}
                  >
                    <option value="">
                      {t({ en: "All spaces", fr: "Tous les espaces", de: "Alle Bereiche" })}
                    </option>
                    {activeManagedTeamSpaces.map((space) => (
                      <option key={space.id} value={space.id}>
                        {space.name}
                      </option>
                    ))}
                  </UiSelect>
                  <div className={cx("self-center text-xs font-medium", uiMutedTextClass)}>
                    {t({
                      en: `${activePublicLinkCount} active link${activePublicLinkCount === 1 ? "" : "s"} in this view`,
                      fr: `${activePublicLinkCount} lien${activePublicLinkCount > 1 ? "s" : ""} actif${activePublicLinkCount > 1 ? "s" : ""} dans cette vue`,
                      de: `${activePublicLinkCount} aktive Link${activePublicLinkCount === 1 ? "" : "s"} in dieser Ansicht`,
                    })}
                  </div>
                  <Link
                    to={
                      selectedPublicLinkSpace
                        ? `${storageSpacePath(selectedPublicLinkSpace)}#space-files`
                        : "/portal/storage-spaces"
                    }
                    className={cx(
                      uiButtonBaseClass,
                      uiButtonVariants.primary,
                      "h-9 px-3 py-1.5 text-xs",
                    )}
                  >
                    {selectedPublicLinkSpace
                      ? t({ en: "Open files", fr: "Ouvrir les fichiers", de: "Dateien öffnen" })
                      : t({ en: "Open spaces", fr: "Ouvrir les espaces", de: "Bereiche öffnen" })}
                  </Link>
                </div>
              ) : (
                <PageBanner tone="info">
                  {t({
                    en: "Only project managers can create public links from active team spaces.",
                    fr: "Seuls les gestionnaires du projet peuvent créer des liens publics depuis les espaces d'équipe actifs.",
                    de: "Nur Projektmanager können öffentliche Links aus aktiven Teambereichen erstellen.",
                  })}
                </PageBanner>
              )}
            </section>
            <DataTableShell
              columns={publicLinkColumns}
              rows={publicLinkRows}
              rowKey={(link) => link.rowKey}
              status={publicLinksTableStatus}
              loadingMessage={t({
                en: "Loading external links...",
                fr: "Chargement des liens externes...",
                de: "Externe Links werden geladen...",
              })}
              errorMessage={t({
                en: "Unable to load external links.",
                fr: "Impossible de charger les liens externes.",
                de: "Externe Links können nicht geladen werden.",
              })}
              emptyMessage={t({
                en: "No external links in this view.",
                fr: "Aucun lien externe dans cette vue.",
                de: "Keine externen Links in dieser Ansicht.",
              })}
              responsiveCards
            />
          </div>
        </UiCard>
      ) : null}

      {pendingAction?.type === "revoke-public-link" ? (
        <ConfirmActionDialog
          title={t({
            en: "Revoke public link",
            fr: "Révoquer le lien public",
            de: "Öffentlichen Link widerrufen",
          })}
          description={t({
            en: "Confirm that you want to revoke this public link.",
            fr: "Confirmez que vous voulez révoquer ce lien public.",
            de: "Bestätigen Sie, dass Sie diesen öffentlichen Link widerrufen möchten.",
          })}
          confirmLabel={t({
            en: "Revoke link",
            fr: "Révoquer le lien",
            de: "Link widerrufen",
          })}
          loading={busyShareId === `public-link-${pendingAction.link.id}`}
          details={[
            {
              label: t({ en: "File", fr: "Fichier", de: "Datei" }),
              value: pendingAction.link.object_name,
            },
            {
              label: t({ en: "Space", fr: "Espace", de: "Bereich" }),
              value: pendingAction.link.storage_space_name,
            },
            {
              label: t({ en: "Link", fr: "Lien", de: "Link" }),
              value: pendingAction.link.url,
              mono: true,
            },
          ]}
          impacts={[
            t({
              en: "Anyone using this URL loses access immediately.",
              fr: "Toute personne utilisant cette URL perd immédiatement l'accès.",
              de: "Alle, die diese URL verwenden, verlieren sofort den Zugriff.",
            }),
            t({
              en: "The file remains in the space.",
              fr: "Le fichier reste dans l'espace.",
              de: "Die Datei bleibt im Bereich.",
            }),
            t({
              en: "You can create a new public link later if sharing is still allowed.",
              fr: "Vous pourrez créer un nouveau lien public plus tard si le partage reste autorisé.",
              de: "Sie können später einen neuen öffentlichen Link erstellen, wenn Freigaben weiter erlaubt sind.",
            }),
          ]}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => confirmRevokePublicLink(pendingAction.link)}
        />
      ) : null}
    </div>
  );
}
