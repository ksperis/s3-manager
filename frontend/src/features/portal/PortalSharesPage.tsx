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
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import {
  grantPortalStorageSpaceShare,
  listPortalStorageSpaceShareCandidates,
  listPortalStorageSpacePublicLinks,
  listPortalStorageSpaceShares,
  revokePortalStorageSpacePublicLink,
  updatePortalStorageSpace,
  type PortalCollaborator,
  type PortalPublicLink,
  revokePortalStorageSpaceShare,
  updatePortalStorageSpaceShare,
  type PortalStorageSpaceRole,
  type PortalStorageSpaceShareCandidate,
  type PortalStorageSpaceShare,
} from "../../api/portal";
import { createPortalRequest } from "../../api/portalRequests";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import DataTableShell, {
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import WorkflowPage, { WorkflowActions, workflowPageHostClass } from "../../components/WorkflowPage";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import PageTabs from "../../components/PageTabs";
import {
  tableActionButtonClasses,
  tableDeleteActionClasses,
} from "../../components/tableActionClasses";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
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
import {
  PortalShareCandidatePicker,
  selectedPortalShares,
} from "./PortalAccessControls";
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

const roles: PortalStorageSpaceRole[] = ["Viewer", "Editor", "Owner"];

type ShareTab = "with" | "by" | "links";
type CollaboratorsViewTab = "invite" | "members" | "access";
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

function CollaborationStep({
  step,
  title,
  description,
  action,
}: {
  step: string;
  title: string;
  description: string;
  action: ReactNode;
}) {
  return (
    <li className="flex min-h-[136px] flex-col justify-between rounded-md border border-[color:var(--ui-border-soft)] bg-[var(--ui-surface)] p-3">
      <div>
        <div
          className={cx(
            "text-[11px] font-semibold uppercase",
            uiMutedTextClass,
          )}
        >
          {step}
        </div>
        <h3 className="mt-1 text-sm font-bold text-[var(--ui-text)]">
          {title}
        </h3>
        <p className={cx("mt-1 text-xs leading-5", uiMutedTextClass)}>
          {description}
        </p>
      </div>
      <div className="mt-3">{action}</div>
    </li>
  );
}

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
        label: editable
          ? t({ en: "Collaborator", fr: "Collaborateur", de: "Mitwirkende" })
          : t({ en: "Shared by", fr: "Partagé par", de: "Geteilt von" }),
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
              onChange={(event) =>
                onRoleChange(
                  share,
                  event.target.value as PortalStorageSpaceRole,
                )
              }
              aria-label={t({
                en: `Access for ${share.person}`,
                fr: `Accès pour ${share.person}`,
                de: `Zugriff für ${share.person}`,
              })}
            >
              {roles.map((role) => (
                <option key={role} value={role}>
                  {portalRoleLabel(role, t)}
                </option>
              ))}
            </UiSelect>
          ) : (
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
    [busyShareId, editable, onRevoke, onRoleChange, t],
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
        editable
          ? t({
              en: "No collaborators invited yet.",
              fr: "Aucun collaborateur invité pour l'instant.",
              de: "Noch keine Mitwirkenden eingeladen.",
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
          en: "Workspace role",
          fr: "Rôle workspace",
          de: "Workspace-Rolle",
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
        en: "Workspace members",
        fr: "Membres du workspace",
        de: "Workspace-Mitglieder",
      })}
    >
      <div className="space-y-3">
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
            en: "Loading workspace members...",
            fr: "Chargement des membres du workspace...",
            de: "Workspace-Mitglieder werden geladen...",
          })}
          errorMessage={
            error ??
            t({
              en: "Unable to load workspace members.",
              fr: "Impossible de charger les membres du workspace.",
              de: "Workspace-Mitglieder können nicht geladen werden.",
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
                  en: "No workspace members to display.",
                  fr: "Aucun membre du workspace à afficher.",
                  de: "Keine Workspace-Mitglieder zum Anzeigen.",
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
  const [shareCandidateQuery, setShareCandidateQuery] = useState("");
  const [shareCandidates, setShareCandidates] = useState<
    PortalStorageSpaceShareCandidate[]
  >([]);
  const [shareCandidatesLoading, setShareCandidatesLoading] = useState(false);
  const [selectedShareRolesByUserId, setSelectedShareRolesByUserId] = useState<
    Record<number, PortalStorageSpaceRole>
  >({});
  const [selectedSpaceId, setSelectedSpaceId] = useState("");
  const [collaboratorQuery, setCollaboratorQuery] = useState("");
  const [sharesMessage, setSharesMessage] = useState<string | null>(null);
  const [busyShareId, setBusyShareId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingShareAction | null>(
    null,
  );
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [collaborationGuideDismissed, setCollaborationGuideDismissed] =
    useState(false);
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
    refreshWorkspaceData = () => undefined,
  } = usePortalWorkspaceData({ includeCollaborators: true });
  const initialUrlContextApplied = useRef(false);
  const activeCollaboratorSpaces = useMemo(
    () => workspace.spaces.filter((space) => space.status !== "Archived"),
    [workspace.spaces],
  );
  const activeOwnerSpaces = useMemo(
    () => activeCollaboratorSpaces.filter((space) => space.role === "Owner"),
    [activeCollaboratorSpaces],
  );
  const activeSharedOwnerSpaces = useMemo(
    () => activeOwnerSpaces.filter((space) => space.visibility === "shared"),
    [activeOwnerSpaces],
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
  const selectedShareEntries = selectedPortalShares(selectedShareRolesByUserId);
  const selectedInviteSpace =
    activeOwnerSpaces.find((space) => space.id === selectedSpaceId) ??
    activeOwnerSpaces[0] ??
    null;
  const selectedPublicLinkSpace =
    activeSharedOwnerSpaces.find((space) => space.id === selectedSpaceId) ??
    activeSharedOwnerSpaces[0] ??
    null;
  const collaborationGuideStorageKey = `portal.collaborators.start-guide.dismissed.${accountIdForApi ?? "default"}`;

  useEffect(() => {
    setCollaborationGuideDismissed(
      window.localStorage.getItem(collaborationGuideStorageKey) === "1",
    );
  }, [collaborationGuideStorageKey]);

  useEffect(() => {
    if (initialUrlContextApplied.current || workspace.spaces.length === 0)
      return;
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get("tab");
    const requestedSpaceId = params.get("space_id");
    if (
      requestedTab === "with" ||
      requestedTab === "by" ||
      requestedTab === "links"
    ) {
      setActiveTab(requestedTab);
      setActiveViewTab("access");
    }
    const requestedView = params.get("view");
    if (
      requestedView === "invite" ||
      requestedView === "members" ||
      requestedView === "access"
    ) {
      setActiveViewTab(requestedView);
    }
    if (
      requestedSpaceId &&
      workspace.spaces.some((space) => space.id === requestedSpaceId)
    ) {
      setSelectedSpaceId(requestedSpaceId);
    }
    initialUrlContextApplied.current = true;
  }, [workspace.spaces]);

  useEffect(() => {
    if (!selectedSpaceId && activeOwnerSpaces[0]) {
      setSelectedSpaceId(activeOwnerSpaces[0].id);
    }
    if (
      selectedSpaceId &&
      !activeOwnerSpaces.some((space) => space.id === selectedSpaceId)
    ) {
      setSelectedSpaceId(activeOwnerSpaces[0]?.id ?? "");
    }
  }, [activeOwnerSpaces, selectedSpaceId]);

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
    if (!accountIdForApi || activeOwnerSpaces.length === 0) {
      setPublicLinks([]);
      return () => {
        cancelled = true;
      };
    }
    Promise.all(
      activeOwnerSpaces.map((space) =>
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
  }, [accountIdForApi, activeOwnerSpaces]);

  useEffect(() => {
    let cancelled = false;
    if (!accountIdForApi || !selectedInviteSpace) {
      setShareCandidates([]);
      setShareCandidatesLoading(false);
      setSelectedShareRolesByUserId({});
      return () => {
        cancelled = true;
      };
    }
    setShareCandidatesLoading(true);
    listPortalStorageSpaceShareCandidates(
      accountIdForApi,
      selectedInviteSpace.id,
    )
      .then((candidates) => {
        if (cancelled) return;
        setShareCandidates(candidates);
        const availableUserIds = new Set(
          candidates
            .filter((candidate) => !candidate.already_shared)
            .map((candidate) => candidate.user_id),
        );
        setSelectedShareRolesByUserId(
          (current) =>
            Object.fromEntries(
              Object.entries(current).filter(([userId]) =>
                availableUserIds.has(Number(userId)),
              ),
            ) as Record<number, PortalStorageSpaceRole>,
        );
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setShareCandidates([]);
          setSelectedShareRolesByUserId({});
          setSharesError(
            extractApiError(
              err,
              t({
                en: "Unable to load people.",
                fr: "Impossible de charger les personnes.",
                de: "Personen können nicht geladen werden.",
              }),
            ),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setShareCandidatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, selectedInviteSpace, t]);

  useEffect(() => {
    setShareCandidateQuery("");
    setSelectedShareRolesByUserId({});
  }, [selectedSpaceId]);

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

  const refreshSpaceShares = async (spaceId: string) => {
    if (!accountIdForApi) return;
    const updated = await listPortalStorageSpaceShares(
      accountIdForApi,
      spaceId,
    );
    setApiShares((current) => {
      const rest = (current ?? []).filter(
        (share) => share.storage_space_id !== spaceId,
      );
      return [...rest, ...updated];
    });
  };

  const handleCreateShare = async () => {
    if (
      !accountIdForApi ||
      !selectedInviteSpace ||
      selectedShareEntries.length === 0
    )
      return;
    const selectedSpace = selectedInviteSpace;
    setBusyShareId("new");
    setSharesError(null);
    setSharesMessage(null);
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
          grantPortalStorageSpaceShare(accountIdForApi, selectedSpace.id, {
            user_id: entry.user_id,
            role: entry.role,
          }),
        ),
      );
      setShareCandidateQuery("");
      setSelectedShareRolesByUserId({});
      setApiShares((current) => {
        const createdIds = new Set(createdShares.map((share) => share.id));
        const filtered = (current ?? []).filter(
          (item) => !createdIds.has(item.id),
        );
        return [...filtered, ...createdShares];
      });
      const sharedUserIds = new Set(
        selectedShareEntries.map((entry) => entry.user_id),
      );
      setShareCandidates((current) =>
        current.map((candidate) =>
          sharedUserIds.has(candidate.user_id)
            ? { ...candidate, already_shared: true }
            : candidate,
        ),
      );
      setSharesMessage(
        t({
          en: "People invited.",
          fr: "Personnes invitées.",
          de: "Personen eingeladen.",
        }),
      );
      setInviteDialogOpen(false);
      setActiveTab("by");
    } catch (err) {
      console.error(err);
      setSharesError(
        extractApiError(
          err,
          t({
            en: "Unable to invite collaborators.",
            fr: "Impossible d'inviter les collaborateurs.",
            de: "Mitwirkende können nicht eingeladen werden.",
          }),
        ),
      );
    } finally {
      setBusyShareId(null);
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
      setSharesMessage(
        t({
          en: "Request sent. Track it in Help requests; an admin will add the collaborator before you can invite them.",
          fr: "Demande envoyée. Suivez-la dans Demandes d'aide ; un admin ajoutera le collaborateur avant que vous puissiez l'inviter.",
          de: "Anfrage gesendet. Verfolgen Sie sie unter Hilfeanfragen; ein Admin fügt die Person hinzu, bevor Sie sie einladen können.",
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

  const handleRoleChange = async (
    share: ShareRow,
    role: PortalStorageSpaceRole,
  ) => {
    if (!accountIdForApi || !share.userId) return;
    setBusyShareId(share.id);
    setSharesError(null);
    try {
      const updated = await updatePortalStorageSpaceShare(
        accountIdForApi,
        share.spaceId,
        share.userId,
        role,
      );
      setApiShares((current) =>
        (current ?? []).map((item) =>
          item.id === updated.id ? updated : item,
        ),
      );
    } catch (err) {
      console.error(err);
      setSharesError(
        extractApiError(
          err,
          t({
            en: "Unable to update this collaborator.",
            fr: "Impossible de mettre à jour ce collaborateur.",
            de: "Dieser Mitwirkende kann nicht aktualisiert werden.",
          }),
        ),
      );
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
      await revokePortalStorageSpaceShare(
        accountIdForApi,
        share.spaceId,
        share.userId,
      );
      await refreshSpaceShares(share.spaceId);
      setPendingAction(null);
    } catch (err) {
      console.error(err);
      setSharesError(
        extractApiError(
          err,
          t({
            en: "Unable to remove this collaborator.",
            fr: "Impossible de retirer ce collaborateur.",
            de: "Dieser Mitwirkende kann nicht entfernt werden.",
          }),
        ),
      );
      setPendingAction(null);
    } finally {
      setBusyShareId(null);
    }
  };

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
  const displayedCount =
    activeTab === "links" ? publicLinks.length : shares.length;
  const activePublicLinkCount = publicLinks.filter(
    (link) => link.status === "Active",
  ).length;
  const invitedCollaboratorCount = rows.by.length;
  const sharedWithMeCount = rows.with.length;
  const collaborationStarted =
    activeCollaboratorSpaces.length > 0 ||
    invitedCollaboratorCount > 0 ||
    sharedWithMeCount > 0 ||
    activePublicLinkCount > 0;
  const showCollaborationGuide =
    !collaborationStarted && !collaborationGuideDismissed;
  const publicLinkRows = useMemo<PublicLinkRow[]>(
    () => publicLinks.map((link) => ({ ...link, rowKey: String(link.id) })),
    [publicLinks],
  );
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
  const dismissCollaborationGuide = () => {
    window.localStorage.setItem(collaborationGuideStorageKey, "1");
    setCollaborationGuideDismissed(true);
  };

  return (
    <div className={workflowPageHostClass(inviteDialogOpen)}>
      <PageHeader
        title={t({
          en: "Collaborators",
          fr: "Collaborateurs",
          de: "Mitwirkende",
        })}
        description={t({
          en: "Share spaces with people you trust and keep track of file links sent outside the workspace.",
          fr: "Partagez des espaces avec les personnes de confiance et suivez les liens envoyés hors du workspace.",
          de: "Teilen Sie Bereiche mit vertrauenswürdigen Personen und behalten Sie Dateilinks außerhalb des Workspace im Blick.",
        })}
        breadcrumbs={portalBreadcrumbs({
          label: t({
            en: "Collaborators",
            fr: "Collaborateurs",
            de: "Mitwirkende",
          }),
        })}
      />
      {sharesError ? (
        <PageBanner tone="warning">{sharesError}</PageBanner>
      ) : null}
      {sharesMessage ? (
        <PageBanner tone="info">{sharesMessage}</PageBanner>
      ) : null}

      {showCollaborationGuide ? (
        <section
          className={cx(uiPanelMutedClass, "p-4")}
          aria-labelledby="portal-collaboration-start-title"
        >
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="portal-collaboration-start-title" className="ui-subtitle">
                {t({
                  en: "Start collaborating",
                  fr: "Démarrer la collaboration",
                  de: "Zusammenarbeit starten",
                })}
              </h2>
              <p className={cx("mt-1 ui-caption", uiMutedTextClass)}>
                {t({
                  en: "Choose a space, invite people, then review who can work there. Use public links only when one file needs to leave the workspace.",
                  fr: "Choisissez un espace, invitez des personnes, puis vérifiez qui peut y travailler. Utilisez les liens publics seulement quand un fichier doit sortir du workspace.",
                  de: "Wählen Sie einen Bereich, laden Sie Personen ein und prüfen Sie dann, wer dort arbeiten kann. Nutzen Sie öffentliche Links nur, wenn eine Datei den Workspace verlassen muss.",
                })}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className={cx("text-xs font-semibold", uiMutedTextClass)}>
                {t({
                  en: `${activeOwnerSpaces.length} space${activeOwnerSpaces.length === 1 ? "" : "s"} you can share`,
                  fr: `${activeOwnerSpaces.length} espace${activeOwnerSpaces.length > 1 ? "s" : ""} partageable${activeOwnerSpaces.length > 1 ? "s" : ""}`,
                  de: `${activeOwnerSpaces.length} teilbare${activeOwnerSpaces.length === 1 ? "r Bereich" : " Bereiche"}`,
                })}
              </div>
              <UiButton
                size="xs"
                variant="ghost"
                onClick={dismissCollaborationGuide}
              >
                {t({
                  en: "Dismiss guide",
                  fr: "Masquer le guide",
                  de: "Anleitung ausblenden",
                })}
              </UiButton>
            </div>
          </div>
          <ol className="grid gap-3 md:grid-cols-4">
            <CollaborationStep
              step={t({ en: "Step 1", fr: "Étape 1", de: "Schritt 1" })}
              title={t({
                en: "Pick a space",
                fr: "Choisir un espace",
                de: "Bereich wählen",
              })}
              description={t({
                en: "Start from the project or dataset where the files already live.",
                fr: "Partez du projet ou du jeu de données où les fichiers se trouvent déjà.",
                de: "Beginnen Sie mit dem Projekt oder Datensatz, in dem die Dateien liegen.",
              })}
              action={
                activeOwnerSpaces.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setInviteDialogOpen(true)}
                    className={cx(
                      uiButtonBaseClass,
                      uiButtonVariants.primary,
                      "h-8 px-3 py-1 text-xs",
                    )}
                  >
                    {t({
                      en: "Choose people",
                      fr: "Choisir des personnes",
                      de: "Personen wählen",
                    })}
                  </button>
                ) : (
                  <Link
                    to="/portal/storage-spaces?create=1"
                    className={cx(
                      uiButtonBaseClass,
                      uiButtonVariants.primary,
                      "h-8 px-3 py-1 text-xs",
                    )}
                  >
                    {t({
                      en: "Create a space",
                      fr: "Créer un espace",
                      de: "Bereich erstellen",
                    })}
                  </Link>
                )
              }
            />
            <CollaborationStep
              step={t({ en: "Step 2", fr: "Étape 2", de: "Schritt 2" })}
              title={t({
                en: "Invite collaborators",
                fr: "Inviter des collaborateurs",
                de: "Mitwirkende einladen",
              })}
              description={t({
                en: "Give each person the least access they need: view, edit, or manage.",
                fr: "Donnez à chacun le niveau nécessaire : consulter, modifier ou gérer.",
                de: "Geben Sie jeder Person nur den nötigen Zugriff: ansehen, bearbeiten oder verwalten.",
              })}
              action={
                <button
                  type="button"
                  disabled={activeOwnerSpaces.length === 0}
                  onClick={() => setActiveTab("by")}
                  className={cx(
                    uiButtonBaseClass,
                    uiButtonVariants.secondary,
                    "h-8 px-3 py-1 text-xs",
                  )}
                >
                  {t({
                    en: "Review invited",
                    fr: "Vérifier les invités",
                    de: "Eingeladene prüfen",
                  })}
                </button>
              }
            />
            <CollaborationStep
              step={t({ en: "Step 3", fr: "Étape 3", de: "Schritt 3" })}
              title={t({
                en: "Check access",
                fr: "Contrôler les accès",
                de: "Zugriff prüfen",
              })}
              description={t({
                en: "See spaces shared with you and spaces you have opened to others.",
                fr: "Voyez les espaces partagés avec vous et ceux que vous avez ouverts aux autres.",
                de: "Sehen Sie Bereiche, die mit Ihnen geteilt wurden, und Bereiche, die Sie geteilt haben.",
              })}
              action={
                <button
                  type="button"
                  onClick={() =>
                    setActiveTab(sharedWithMeCount > 0 ? "with" : "by")
                  }
                  className={cx(
                    uiButtonBaseClass,
                    uiButtonVariants.secondary,
                    "h-8 px-3 py-1 text-xs",
                  )}
                >
                  {t({
                    en: `${invitedCollaboratorCount + sharedWithMeCount} access item${invitedCollaboratorCount + sharedWithMeCount === 1 ? "" : "s"}`,
                    fr: `${invitedCollaboratorCount + sharedWithMeCount} accès à vérifier`,
                    de: `${invitedCollaboratorCount + sharedWithMeCount} Zugriff${invitedCollaboratorCount + sharedWithMeCount === 1 ? "" : "e"}`,
                  })}
                </button>
              }
            />
            <CollaborationStep
              step={t({ en: "Step 4", fr: "Étape 4", de: "Schritt 4" })}
              title={t({
                en: "Share one file",
                fr: "Partager un fichier",
                de: "Eine Datei teilen",
              })}
              description={t({
                en: "Open file links when someone outside the workspace needs a single file.",
                fr: "Ouvrez les liens de fichiers quand une personne externe a besoin d'un seul fichier.",
                de: "Öffnen Sie Dateilinks, wenn jemand außerhalb des Workspace eine einzelne Datei braucht.",
              })}
              action={
                <button
                  type="button"
                  onClick={() => setActiveTab("links")}
                  className={cx(
                    uiButtonBaseClass,
                    uiButtonVariants.secondary,
                    "h-8 px-3 py-1 text-xs",
                  )}
                >
                  {activePublicLinkCount > 0
                    ? t({
                        en: `${activePublicLinkCount} active link${activePublicLinkCount === 1 ? "" : "s"}`,
                        fr: `${activePublicLinkCount} lien${activePublicLinkCount > 1 ? "s" : ""} actif${activePublicLinkCount > 1 ? "s" : ""}`,
                        de: `${activePublicLinkCount} aktive Link${activePublicLinkCount === 1 ? "" : "s"}`,
                      })
                    : t({
                        en: "Open file links",
                        fr: "Ouvrir les liens",
                        de: "Dateilinks öffnen",
                      })}
                </button>
              }
            />
          </ol>
        </section>
      ) : null}

      <PageTabs
        tabs={[
          {
            id: "members",
            label: t({
              en: "Workspace members",
              fr: "Membres du workspace",
              de: "Workspace-Mitglieder",
            }),
          },
          {
            id: "access",
            label: t({
              en: "Review access",
              fr: "Vérifier les accès",
              de: "Zugriff prüfen",
            }),
          },
          {
            id: "invite",
            label: t({
              en: "Invite",
              fr: "Inviter",
              de: "Einladen",
            }),
          },
        ]}
        activeTab={activeViewTab}
        onChange={(tab) => setActiveViewTab(tab as CollaboratorsViewTab)}
        variant="bar"
      />

      {activeViewTab === "invite" ? (
        activeOwnerSpaces.length > 0 ? (
          <div id="share-space" className="scroll-mt-6">
            <UiCard
              title={t({
                en: "Invite people",
                fr: "Inviter des personnes",
                de: "Personen einladen",
              })}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="max-w-2xl">
                  <p className={cx("ui-caption", uiMutedTextClass)}>
                    {t({
                      en: "Choose a space, pick the people who should work there, and assign the right level of access in a focused dialog.",
                      fr: "Choisissez un espace, sélectionnez les personnes qui doivent y travailler et donnez le bon niveau d'accès dans une fenêtre dédiée.",
                      de: "Wählen Sie einen Bereich, die Personen, die dort arbeiten sollen, und die passende Zugriffsstufe in einem fokussierten Dialog.",
                    })}
                  </p>
                  <p
                    className={cx(
                      "mt-1 text-xs font-semibold",
                      uiMutedTextClass,
                    )}
                  >
                    {t({
                      en: `${activeOwnerSpaces.length} space${activeOwnerSpaces.length === 1 ? "" : "s"} available`,
                      fr: `${activeOwnerSpaces.length} espace${activeOwnerSpaces.length > 1 ? "s" : ""} disponible${activeOwnerSpaces.length > 1 ? "s" : ""}`,
                      de: `${activeOwnerSpaces.length} Bereich${activeOwnerSpaces.length === 1 ? "" : "e"} verfügbar`,
                    })}
                  </p>
                </div>
                <UiButton onClick={() => setInviteDialogOpen(true)}>
                  {t({ en: "Invite people", fr: "Inviter", de: "Einladen" })}
                </UiButton>
              </div>
            </UiCard>
          </div>
        ) : (
          <PageBanner tone="info">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                {t({
                  en: "You do not own an active space yet. Create a space or ask an Owner to invite people.",
                  fr: "Vous ne possédez pas encore d'espace actif. Créez un espace ou demandez à un Owner d'inviter des personnes.",
                  de: "Sie besitzen noch keinen aktiven Bereich. Erstellen Sie einen Bereich oder bitten Sie einen Owner, Personen einzuladen.",
                })}
              </span>
              <Link
                to="/portal/storage-spaces"
                className={cx(
                  uiButtonBaseClass,
                  uiButtonVariants.secondary,
                  "h-8 px-3 py-1 text-xs",
                )}
              >
                {t({
                  en: "Open spaces",
                  fr: "Ouvrir les espaces",
                  de: "Bereiche öffnen",
                })}
              </Link>
            </div>
          </PageBanner>
        )
      ) : null}

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
            en: "Review access",
            fr: "Vérifier les accès",
            de: "Zugriff prüfen",
          })}
        >
        <div className={cx("mb-3 border-b pb-3", uiDividerClass)}>
          <PageTabs
            tabs={[
              {
                id: "with",
                label: t({
                  en: "Spaces shared with me",
                  fr: "Espaces partagés avec moi",
                  de: "Mit mir geteilte Bereiche",
                }),
              },
              {
                id: "by",
                label: t({
                  en: "People with access",
                  fr: "Personnes avec accès",
                  de: "Personen mit Zugriff",
                }),
              },
              {
                id: "links",
                label: t({
                  en: "Public links",
                  fr: "Liens publics",
                  de: "Öffentliche Links",
                }),
              },
            ]}
            activeTab={activeTab}
            onChange={(tab) => setActiveTab(tab as ShareTab)}
            variant="bar"
          />
        </div>
        {activeTab === "links" ? (
          <div className="space-y-3">
            <section
              className={cx(uiPanelMutedClass, "p-4")}
              aria-labelledby="portal-public-link-guidance-title"
            >
              <div className="mb-3">
                <h2
                  id="portal-public-link-guidance-title"
                  className="ui-subtitle"
                >
                  {t({
                    en: "Create a public link from a file",
                    fr: "Créer un lien public depuis un fichier",
                    de: "Öffentlichen Link aus einer Datei erstellen",
                  })}
                </h2>
                <p className={cx("mt-1 ui-caption", uiMutedTextClass)}>
                  {t({
                    en: "Open a shared space, choose the file, then create the public link from the file actions.",
                    fr: "Ouvrez un espace partagé, choisissez le fichier, puis créez le lien public depuis les actions du fichier.",
                    de: "Öffnen Sie einen geteilten Bereich, wählen Sie die Datei und erstellen Sie den öffentlichen Link über die Dateiaktionen.",
                  })}
                </p>
              </div>
              {activeSharedOwnerSpaces.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)_auto] md:items-end">
                  <UiSelect
                    size="compact"
                    className="h-9"
                    value={selectedPublicLinkSpace?.id ?? ""}
                    onChange={(event) => setSelectedSpaceId(event.target.value)}
                    aria-label={t({
                      en: "Space for public link",
                      fr: "Espace pour le lien public",
                      de: "Bereich für öffentlichen Link",
                    })}
                  >
                    {activeSharedOwnerSpaces.map((space) => (
                      <option key={space.id} value={space.id}>
                        {space.name}
                      </option>
                    ))}
                  </UiSelect>
                  <div
                    className={cx(
                      "self-center text-xs font-medium",
                      uiMutedTextClass,
                    )}
                  >
                    {t({
                      en: "Public links are created from file context so you never have to type a storage path.",
                      fr: "Les liens publics se créent depuis le contexte du fichier : aucun chemin technique à saisir.",
                      de: "Öffentliche Links entstehen direkt aus der Datei, ohne dass ein Speicherpfad eingegeben werden muss.",
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
                    {t({
                      en: "Open files",
                      fr: "Ouvrir les fichiers",
                      de: "Dateien öffnen",
                    })}
                  </Link>
                </div>
              ) : (
                <PageBanner tone="info">
                  {t({
                    en: "Public links need an active shared space that you own. Invite collaborators to a space first, then open its files to create a link.",
                    fr: "Les liens publics nécessitent un espace partagé actif dont vous êtes propriétaire. Invitez d'abord des collaborateurs, puis ouvrez les fichiers de l'espace pour créer un lien.",
                    de: "Öffentliche Links benötigen einen aktiven geteilten Bereich, den Sie besitzen. Laden Sie zuerst Mitwirkende ein und öffnen Sie dann die Dateien, um einen Link zu erstellen.",
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
                en: "Loading public links...",
                fr: "Chargement des liens publics...",
                de: "Öffentliche Links werden geladen...",
              })}
              errorMessage={t({
                en: "Unable to load public links.",
                fr: "Impossible de charger les liens publics.",
                de: "Öffentliche Links können nicht geladen werden.",
              })}
              emptyMessage={t({
                en: "No public links yet.",
                fr: "Aucun lien public pour l'instant.",
                de: "Noch keine öffentlichen Links.",
              })}
              responsiveCards
            />
          </div>
        ) : (
          <SharesTable
            shares={shares}
            editable={activeTab === "by"}
            busyShareId={busyShareId}
            onRoleChange={handleRoleChange}
            onRevoke={handleRevoke}
          />
        )}
        <div
          className={cx(
            "mt-4 flex items-center justify-between text-[11px] font-semibold",
            uiMutedTextClass,
          )}
        >
          <span>
            {activeTab === "links"
              ? t({
                  en: `${activePublicLinkCount} active link${activePublicLinkCount === 1 ? "" : "s"}`,
                  fr: `${activePublicLinkCount} lien${activePublicLinkCount > 1 ? "s" : ""} actif${activePublicLinkCount > 1 ? "s" : ""}`,
                  de: `${activePublicLinkCount} aktive Link${activePublicLinkCount === 1 ? "" : "s"}`,
                })
              : t({
                  en: `${displayedCount} ${displayedCount === 1 ? "entry" : "entries"}`,
                  fr: `${displayedCount} entrée${displayedCount > 1 ? "s" : ""}`,
                  de: `${displayedCount} Eintrag${displayedCount === 1 ? "" : "e"}`,
                })}
          </span>
        </div>
        </UiCard>
      ) : null}

      {inviteDialogOpen && activeOwnerSpaces.length > 0 ? (
        <WorkflowPage
          title={t({
            en: "Invite people",
            fr: "Inviter des personnes",
            de: "Personen einladen",
          })}
          description={t({
            en: "Select a space, choose collaborators and assign their roles in one focused workflow.",
            fr: "Sélectionnez un espace, choisissez les collaborateurs et attribuez leurs rôles dans un seul parcours.",
            de: "Wählen Sie einen Bereich, Mitwirkende und deren Rollen in einem fokussierten Ablauf.",
          })}
          breadcrumbs={[{ label: "Portal" }, { label: t({ en: "Shares", fr: "Partages", de: "Freigaben" }), to: "/portal/shares" }, { label: t({ en: "Invite", fr: "Inviter", de: "Einladen" }) }]}
          backLabel={t({ en: "Back to shares", fr: "Retour aux partages", de: "Zurück zu Freigaben" })}
          onBack={busyShareId === "new" ? undefined : () => setInviteDialogOpen(false)}
          contentClassName="mx-auto max-w-6xl"
        >
          <div className="space-y-4">
            {sharesError ? <PageBanner tone="error">{sharesError}</PageBanner> : null}
            <div className="grid gap-3 md:grid-cols-[240px_minmax(0,1fr)] md:items-end">
              <UiSelect
                label={t({ en: "Space", fr: "Espace", de: "Bereich" })}
                size="compact"
                className="h-9"
                value={selectedInviteSpace?.id ?? ""}
                onChange={(event) => setSelectedSpaceId(event.target.value)}
                aria-label={t({
                  en: "Space to share",
                  fr: "Espace à partager",
                  de: "Zu teilender Bereich",
                })}
              >
                {activeOwnerSpaces.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.name}
                  </option>
                ))}
              </UiSelect>
              <p
                className={cx(
                  "self-center text-xs font-medium",
                  uiMutedTextClass,
                )}
              >
                {t({
                  en: "Choose people already added to this workspace, then decide whether they can view, edit, or manage the space.",
                  fr: "Choisissez des personnes déjà ajoutées à ce workspace, puis décidez si elles peuvent consulter, modifier ou gérer l'espace.",
                  de: "Wählen Sie Personen aus diesem Workspace aus und legen Sie fest, ob sie den Bereich ansehen, bearbeiten oder verwalten können.",
                })}
              </p>
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
              onRequestPerson={handleRequestCollaboratorAccess}
            />
            <WorkflowActions>
              <UiButton
                variant="secondary"
                onClick={() => setInviteDialogOpen(false)}
                disabled={busyShareId === "new"}
              >
                {t({ en: "Cancel", fr: "Annuler", de: "Abbrechen" })}
              </UiButton>
              <UiButton
                disabled={
                  !accountIdForApi ||
                  !selectedInviteSpace ||
                  selectedShareEntries.length === 0 ||
                  busyShareId === "new"
                }
                loading={busyShareId === "new"}
                onClick={handleCreateShare}
              >
                {busyShareId === "new"
                  ? t({
                      en: "Inviting...",
                      fr: "Invitation...",
                      de: "Einladung läuft...",
                    })
                  : t({ en: "Invite people", fr: "Inviter", de: "Einladen" })}
              </UiButton>
            </WorkflowActions>
          </div>
        </WorkflowPage>
      ) : null}

      {pendingAction?.type === "revoke-share" ? (
        <ConfirmActionDialog
          title={t({
            en: "Revoke access",
            fr: "Révoquer l'accès",
            de: "Zugriff widerrufen",
          })}
          description={t({
            en: "Confirm that you want to remove this person's access.",
            fr: "Confirmez que vous voulez retirer l'accès de cette personne.",
            de: "Bestätigen Sie, dass Sie den Zugriff dieser Person entfernen möchten.",
          })}
          confirmLabel={t({
            en: "Revoke access",
            fr: "Révoquer l'accès",
            de: "Zugriff widerrufen",
          })}
          loading={busyShareId === pendingAction.share.id}
          details={[
            {
              label: t({ en: "Person", fr: "Personne", de: "Person" }),
              value: pendingAction.share.person,
            },
            {
              label: t({ en: "Space", fr: "Espace", de: "Bereich" }),
              value: pendingAction.share.spaceName,
            },
            {
              label: t({ en: "Access", fr: "Accès", de: "Zugriff" }),
              value: portalRoleLabel(pendingAction.share.access, t),
            },
          ]}
          impacts={[
            t({
              en: "This person loses access to the space immediately.",
              fr: "Cette personne perd immédiatement l'accès à l'espace.",
              de: "Diese Person verliert sofort den Zugriff auf den Bereich.",
            }),
            t({
              en: "Files in the space are not deleted.",
              fr: "Les fichiers de l'espace ne sont pas supprimés.",
              de: "Dateien im Bereich werden nicht gelöscht.",
            }),
            t({
              en: "You can invite the person again later if needed.",
              fr: "Vous pourrez réinviter cette personne plus tard si nécessaire.",
              de: "Sie können diese Person später bei Bedarf erneut einladen.",
            }),
          ]}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => confirmRevoke(pendingAction.share)}
        />
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
