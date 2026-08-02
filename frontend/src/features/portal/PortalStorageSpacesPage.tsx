/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  createPortalStorageSpace,
  importPortalStorageSpace,
  listPortalShareCandidates,
  type PortalStorageSpaceAccountMemberRole,
  type PortalStorageSpaceGrantRole,
  type PortalStorageSpaceRole,
  type PortalStorageSpaceShareCandidate,
} from "../../api/portal";
import DataTableShell, {
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import PageHeader from "../../components/PageHeader";
import StorageSpaceIcon from "../../components/StorageSpaceIcon";
import WorkflowPage, {
  WorkflowActions,
  workflowPageHostClass,
} from "../../components/WorkflowPage";
import { tableActionButtonClasses } from "../../components/tableActionClasses";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import { UserAvatarStack } from "../../components/UserAvatar";
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
import { formatBytes, formatCompactNumber } from "../../utils/format";
import {
  PortalAccessModeFields,
  PortalShareCandidatePicker,
  portalAccessPayloadFromMode,
  portalAccessModeDescription,
  portalAccessModeSummary,
  selectedPortalShares,
  type PortalAccessMode,
} from "./PortalAccessControls";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import PortalPageTabs, { PortalTabPanel } from "./PortalPageTabs";
import { storageSpacePath } from "./portalWorkspaceModel";
import {
  portalStorageSpaceStatusTone,
  portalVisibilityTone,
  resolvePortalWorkspacePageState,
} from "./portalUi";
import type { PortalWorkspaceSpace } from "./portalWorkspaceModel";
import {
  portalRoleLabel,
  portalShareScopeLabel,
  portalStatusLabel,
} from "./portalI18n";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

type SpacesTab = "active" | "archived";

function visibleStatus(space: { status: string }) {
  if (space.status === "Active") return null;
  return space.status;
}

function StartStep({
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
    <li className="flex min-h-[144px] flex-col justify-between rounded-md border border-[color:var(--ui-border-soft)] bg-[var(--ui-surface)] p-3">
      <div>
        <div
          className={cx(
            "text-[11px] font-semibold uppercase",
            uiMutedTextClass,
          )}
        >
          {step}
        </div>
        <h3 className={cx("mt-1 text-sm font-bold", uiTitleTextClass)}>
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

export default function PortalStorageSpacesPage() {
  const { t } = useI18n();
  const {
    workspace,
    loading,
    error,
    hasAccountContext,
    accountError,
    accountLoading,
    accountIdForApi,
    state,
  } = usePortalWorkspaceData({
    includeArchived: true,
    includeUsage: true,
  });
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<PortalStorageSpaceRole | "all">(
    "all",
  );
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState("name");
  const [activeTab, setActiveTab] = useState<SpacesTab>("active");
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [startGuideDismissed, setStartGuideDismissed] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newAccessMode, setNewAccessMode] =
    useState<PortalAccessMode>("private");
  const [newAccountMemberRole, setNewAccountMemberRole] =
    useState<PortalStorageSpaceAccountMemberRole>("Editor");
  const [shareCandidates, setShareCandidates] = useState<
    PortalStorageSpaceShareCandidate[]
  >([]);
  const [shareCandidateQuery, setShareCandidateQuery] = useState("");
  const [shareCandidatesLoading, setShareCandidatesLoading] = useState(false);
  const [shareCandidatesError, setShareCandidatesError] = useState<
    string | null
  >(null);
  const [restrictedRolesByUserId, setRestrictedRolesByUserId] = useState<
    Record<number, PortalStorageSpaceGrantRole>
  >({});
  const [importShareCandidateQuery, setImportShareCandidateQuery] =
    useState("");
  const [importRestrictedRolesByUserId, setImportRestrictedRolesByUserId] =
    useState<Record<number, PortalStorageSpaceGrantRole>>({});
  const [newNamingMode, setNewNamingMode] = useState<
    "generic_uuid" | "named_bucket"
  >("generic_uuid");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [importBucketName, setImportBucketName] = useState("");
  const [importDescription, setImportDescription] = useState("");
  const [importAccessMode, setImportAccessMode] =
    useState<PortalAccessMode>("private");
  const [importAccountMemberRole, setImportAccountMemberRole] =
    useState<PortalStorageSpaceAccountMemberRole>("Editor");
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const activeSpaces = useMemo(
    () => workspace.spaces.filter((space) => space.status !== "Archived"),
    [workspace.spaces],
  );
  const archivedSpaces = useMemo(
    () => workspace.spaces.filter((space) => space.status === "Archived"),
    [workspace.spaces],
  );
  const visibleSpaces = activeTab === "archived" ? archivedSpaces : activeSpaces;
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSpaces = useMemo(() => {
    const filtered = visibleSpaces.filter((space) => {
      if (roleFilter !== "all" && space.role !== roleFilter) return false;
      if (statusFilter !== "all" && space.status !== statusFilter) return false;
      if (!normalizedQuery) return true;
      return [
        space.name,
        space.description,
        space.ownerLabel,
        space.visibility,
        portalShareScopeLabel(space.visibility, space.shareScope, t),
        space.projectKey,
        space.datasetLabel,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery));
    });
    return [...filtered].sort((a, b) => {
      if (sort === "created_at")
        return (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
      if (sort === "-created_at")
        return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
      if (sort === "used_bytes")
        return (a.usedBytes ?? -1) - (b.usedBytes ?? -1);
      if (sort === "-used_bytes")
        return (b.usedBytes ?? -1) - (a.usedBytes ?? -1);
      if (sort === "object_count")
        return (a.objectCount ?? -1) - (b.objectCount ?? -1);
      if (sort === "-object_count")
        return (b.objectCount ?? -1) - (a.objectCount ?? -1);
      return a.name.localeCompare(b.name);
    });
  }, [normalizedQuery, roleFilter, sort, statusFilter, t, visibleSpaces]);
  const tableStatus = filteredSpaces.length === 0 ? "empty" : "ready";
  const storageSpaceColumns = useMemo<DataTableColumn<PortalWorkspaceSpace>[]>(
    () => [
      {
        id: "name",
        label: t({ en: "Space", fr: "Espace", de: "Bereich" }),
        mobileLabel: t({ en: "Space", fr: "Espace", de: "Bereich" }),
        primary: true,
        render: (space) => (
          <div className="flex min-w-0 items-start gap-2">
            <StorageSpaceIcon
              icon={space.icon}
              name={space.name}
              size="sm"
              className="mt-0.5"
              decorative
            />
            <div className="min-w-0">
              <Link
                to={storageSpacePath(space)}
                className={cx(
                  "font-bold hover:text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                  uiTitleTextClass,
                )}
              >
                {space.name}
              </Link>
              <div className={cx("text-[11px] font-medium", uiMutedTextClass)}>
                {space.description}
              </div>
            </div>
          </div>
        ),
      },
      {
        id: "access",
        label: t({
          en: "Collaborators",
          fr: "Collaborateurs",
          de: "Mitwirkende",
        }),
        render: (space) => {
          const status = visibleStatus(space);
          const collaborators = space.collaborators ?? [];
          const isWholeTeam =
            space.visibility === "shared" && space.shareScope === "account";
          return (
            <div className="flex min-w-[132px] flex-col items-start gap-2">
              {space.visibility === "private" ? (
                <UiBadge tone={portalVisibilityTone(space.visibility)}>
                  {portalShareScopeLabel(space.visibility, space.shareScope, t)}
                </UiBadge>
              ) : isWholeTeam ? (
                <UiBadge tone={portalVisibilityTone(space.visibility)}>
                  {portalShareScopeLabel(space.visibility, space.shareScope, t)}
                </UiBadge>
              ) : collaborators.length > 0 ? (
                <UserAvatarStack
                  people={collaborators}
                  totalCount={space.collaboratorCount ?? collaborators.length}
                  maxVisible={5}
                  size="sm"
                />
              ) : (
                <span className={cx("text-xs", uiMutedTextClass)}>
                  {t({ en: "No collaborators", fr: "Aucun collaborateur", de: "Keine Mitwirkenden" })}
                </span>
              )}
              {status ? (
                <UiBadge tone={portalStorageSpaceStatusTone(space)}>
                  {portalStatusLabel(
                    status as "Active" | "Attention" | "Archived",
                    t,
                  )}
                </UiBadge>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "files",
        label: t({ en: "Files", fr: "Fichiers", de: "Dateien" }),
        render: (space) => formatCompactNumber(space.objectCount),
      },
      {
        id: "size",
        label: t({ en: "Size", fr: "Taille", de: "Größe" }),
        render: (space) => formatBytes(space.usedBytes),
      },
      {
        id: "created",
        label: t({ en: "Created", fr: "Créé", de: "Erstellt" }),
        render: (space) => space.createdLabel,
      },
      {
        id: "region",
        label: t({ en: "Region", fr: "Région", de: "Region" }),
        render: (space) => space.region,
      },
      {
        id: "action",
        label: t({ en: "Action", fr: "Action", de: "Aktion" }),
        align: "right",
        mobileRole: "actions",
        render: (space) => (
          <div className="flex justify-end gap-2">
            <Link
              to={storageSpacePath(space)}
              className={tableActionButtonClasses}
            >
              {t({ en: "Open", fr: "Ouvrir", de: "Öffnen" })}
            </Link>
          </div>
        ),
      },
    ],
    [t],
  );

  const canCreatePrivate = Boolean(state?.can_create_private_storage_spaces);
  const canCreateTeam = Boolean(state?.can_create_team_storage_spaces);
  const canCreate = canCreatePrivate || canCreateTeam;
  const canImport =
    state?.account_role === "portal_manager" &&
    Boolean(state?.can_manage_buckets);
  const canUseNamedBucket = Boolean(state?.allow_named_bucket_create);
  const createAccessModes = useMemo<PortalAccessMode[]>(
    () => [
      ...(canCreatePrivate ? (["private"] as PortalAccessMode[]) : []),
      ...(canCreateTeam ? (["account", "restricted"] as PortalAccessMode[]) : []),
    ],
    [canCreatePrivate, canCreateTeam],
  );
  const importAccessModes = useMemo<PortalAccessMode[]>(
    () => [
      ...(canCreatePrivate ? (["private"] as PortalAccessMode[]) : []),
      "account",
      "restricted",
    ],
    [canCreatePrivate],
  );
  const firstWritableSpace =
    activeSpaces.find(
      (space) => space.role === "Manager" || space.role === "Owner" || space.role === "Editor",
    ) ??
    activeSpaces[0] ??
    null;
  const firstManagedTeamSpace =
    activeSpaces.find((space) => space.role === "Manager" && space.visibility === "shared") ?? null;
  const effectiveNamingMode = canUseNamedBucket
    ? newNamingMode
    : "generic_uuid";
  const effectiveNewAccessMode: PortalAccessMode = createAccessModes.includes(newAccessMode)
    ? newAccessMode
    : createAccessModes[0] ?? "private";
  const effectiveNewAccessPayload = portalAccessPayloadFromMode(
    effectiveNewAccessMode,
    newAccountMemberRole,
  );
  const effectiveImportAccessPayload = portalAccessPayloadFromMode(
    importAccessMode,
    importAccountMemberRole,
  );
  const selectedRestrictedEntries = selectedPortalShares(
    restrictedRolesByUserId,
  );
  const selectedImportRestrictedEntries = selectedPortalShares(
    importRestrictedRolesByUserId,
  );
  const portalMemberCount = shareCandidates.length + 1;
  const createRequested = searchParams.get("create") === "1";
  const startGuideStorageKey = `portal.storage-spaces.start-guide.dismissed.${accountIdForApi ?? "default"}`;

  useEffect(() => {
    if (canCreate && createRequested) {
      setShowCreate(true);
    }
  }, [canCreate, createRequested]);

  useEffect(() => {
    if (!createAccessModes.includes(newAccessMode) && createAccessModes[0]) {
      setNewAccessMode(createAccessModes[0]);
    }
  }, [createAccessModes, newAccessMode]);

  useEffect(() => {
    if (!importAccessModes.includes(importAccessMode) && importAccessModes[0]) {
      setImportAccessMode(importAccessModes[0]);
    }
  }, [importAccessMode, importAccessModes]);

  useEffect(() => {
    setStartGuideDismissed(
      window.localStorage.getItem(startGuideStorageKey) === "1",
    );
  }, [startGuideStorageKey]);

  useEffect(() => {
    setStatusFilter("all");
  }, [activeTab]);

  useEffect(() => {
    let cancelled = false;
    const needsCandidates =
      (showCreate && effectiveNewAccessMode !== "private") ||
      (showImport && importAccessMode !== "private" && canImport);
    if (!needsCandidates || !accountIdForApi) {
      setShareCandidates([]);
      setShareCandidatesLoading(false);
      setShareCandidatesError(null);
      return () => {
        cancelled = true;
      };
    }
    setShareCandidatesLoading(true);
    setShareCandidatesError(null);
    listPortalShareCandidates(accountIdForApi)
      .then((candidates) => {
        if (!cancelled) setShareCandidates(candidates);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setShareCandidates([]);
          setShareCandidatesError(
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
  }, [
    accountIdForApi,
    canImport,
    effectiveNewAccessMode,
    importAccessMode,
    newAccessMode,
    showCreate,
    showImport,
    t,
  ]);

  const updateRestrictedRoles = (
    setter: Dispatch<SetStateAction<Record<number, PortalStorageSpaceGrantRole>>>,
    userId: number,
    role: PortalStorageSpaceGrantRole | null,
  ) => {
    setter((current) => {
      const next = { ...current };
      if (!role) {
        delete next[userId];
      } else {
        next[userId] = role;
      }
      return next;
    });
  };

  const handleCreate = async () => {
    if (!accountIdForApi || !newName.trim()) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const created = await createPortalStorageSpace(accountIdForApi, {
        name: newName.trim(),
        naming_mode: effectiveNamingMode,
        description: newDescription.trim() || null,
        ...effectiveNewAccessPayload,
        initial_shares:
          effectiveNewAccessPayload.share_scope === "restricted"
            ? selectedRestrictedEntries
            : [],
      });
      navigate(storageSpacePath({ id: created.id }), {
        state: { portalSpaceCreated: true },
      });
    } catch (err) {
      console.error(err);
      setCreateError(
        extractApiError(
          err,
          t({
            en: "Unable to create this space.",
            fr: "Impossible de créer cet espace.",
            de: "Dieser Bereich kann nicht erstellt werden.",
          }),
        ),
      );
    } finally {
      setCreateBusy(false);
    }
  };

  const handleImport = async () => {
    if (!accountIdForApi || !importBucketName.trim()) return;
    setImportBusy(true);
    setImportError(null);
    try {
      const imported = await importPortalStorageSpace(accountIdForApi, {
        bucket_name: importBucketName.trim(),
        description: importDescription.trim() || null,
        ...effectiveImportAccessPayload,
        initial_shares:
          effectiveImportAccessPayload.share_scope === "restricted"
            ? selectedImportRestrictedEntries
            : [],
      });
      navigate(storageSpacePath({ id: imported.id }), {
        state: { portalSpaceImported: true },
      });
    } catch (err) {
      console.error(err);
      setImportError(
        extractApiError(
          err,
          t({
            en: "Unable to add existing storage.",
            fr: "Impossible d'ajouter le stockage existant.",
            de: "Vorhandener Speicher kann nicht hinzugefügt werden.",
          }),
        ),
      );
    } finally {
      setImportBusy(false);
    }
  };

  const dismissStartGuide = () => {
    window.localStorage.setItem(startGuideStorageKey, "1");
    setStartGuideDismissed(true);
  };

  const pageState = resolvePortalWorkspacePageState({
    accountLoading,
    loading,
    accountError,
    error,
    hasAccountContext,
    loadingMessage: t({
      en: "Loading spaces...",
      fr: "Chargement des espaces...",
      de: "Bereiche werden geladen...",
    }),
    noAccountMessage: t({
      en: "Select a project to view spaces.",
      fr: "Sélectionnez un projet pour voir les espaces.",
      de: "Wählen Sie ein Projekt aus, um Bereiche anzuzeigen.",
    }),
  });
  if (pageState) return pageState;
  const headerActions = [
    ...(canCreate
      ? [
          {
            label: t({
              en: "Create space",
              fr: "Créer un espace",
              de: "Bereich erstellen",
            }),
            onClick: () => setShowCreate(true),
          },
        ]
      : []),
    ...(canImport
      ? [
          {
            label: t({
              en: "Add existing space",
              fr: "Ajouter un espace existant",
              de: "Vorhandenen Bereich hinzufügen",
            }),
            onClick: () => setShowImport(true),
            variant: "secondary" as const,
          },
        ]
      : []),
  ];
  const showStartGuide = workspace.spaces.length === 0 && !startGuideDismissed;
  const statusOptions = [
    { value: "Active", label: portalStatusLabel("Active", t) },
    { value: "Attention", label: portalStatusLabel("Attention", t) },
  ];

  return (
    <div className={workflowPageHostClass(showCreate || showImport)}>
      <PageHeader
        title={t({ en: "Spaces", fr: "Espaces", de: "Bereiche" })}
        description={t({
          en: "Create places for project files, upload data, and invite collaborators.",
          fr: "Créez des espaces pour les fichiers de projet, ajoutez des données et invitez des collaborateurs.",
          de: "Erstellen Sie Bereiche für Projektdateien, laden Sie Daten hoch und laden Sie Mitwirkende ein.",
        })}
        breadcrumbs={portalBreadcrumbs({
          label: t({ en: "Spaces", fr: "Espaces", de: "Bereiche" }),
        })}
        actions={headerActions}
      />

      {showStartGuide ? (
        <section
          className={cx(uiPanelMutedClass, "p-4")}
          aria-labelledby="portal-spaces-start-title"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div
                className={cx(
                  "text-[11px] font-semibold uppercase",
                  uiMutedTextClass,
                )}
              >
                {t({
                  en: "Start here",
                  fr: "Commencer ici",
                  de: "Hier starten",
                })}
              </div>
              <h2
                id="portal-spaces-start-title"
                className={cx("mt-1 text-[15px] font-bold", uiTitleTextClass)}
              >
                {t({
                  en: "Create, fill, and share a space",
                  fr: "Créer, remplir et partager un espace",
                  de: "Bereich erstellen, füllen und teilen",
                })}
              </h2>
              <p
                className={cx(
                  "mt-1 max-w-3xl text-xs leading-5",
                  uiMutedTextClass,
                )}
              >
                {t({
                  en: "Use spaces as project rooms: create one, add files, then bring collaborators in when the content is ready.",
                  fr: "Utilisez les espaces comme des salles de projet : créez-en un, ajoutez des fichiers, puis invitez les collaborateurs quand le contenu est prêt.",
                  de: "Nutzen Sie Bereiche wie Projekträume: Erstellen Sie einen, fügen Sie Dateien hinzu und laden Sie Mitwirkende ein, sobald die Inhalte bereit sind.",
                })}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <UiBadge tone="warning">
                {t({
                  en: "No spaces yet",
                  fr: "Aucun espace",
                  de: "Noch keine Bereiche",
                })}
              </UiBadge>
              <UiButton size="xs" variant="ghost" onClick={dismissStartGuide}>
                {t({
                  en: "Dismiss guide",
                  fr: "Masquer le guide",
                  de: "Anleitung ausblenden",
                })}
              </UiButton>
            </div>
          </div>
          <ol className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StartStep
              step={t({ en: "Step 1", fr: "Étape 1", de: "Schritt 1" })}
              title={t({
                en: "Set up a space",
                fr: "Configurer un espace",
                de: "Bereich einrichten",
              })}
              description={t({
                en: "Name the project, dataset, or team room where files will live.",
                fr: "Nommez le projet, le jeu de données ou l'espace d'équipe où les fichiers seront rangés.",
                de: "Benennen Sie das Projekt, den Datensatz oder Teamraum, in dem Dateien liegen werden.",
              })}
              action={
                canCreate ? (
                  <button
                    type="button"
                    onClick={() => setShowCreate(true)}
                    className={cx(
                      uiButtonBaseClass,
                      uiButtonVariants.primary,
                      "h-8 px-3 py-1.5 text-xs",
                    )}
                  >
                    {t({
                      en: "Start a new space",
                      fr: "Démarrer un nouvel espace",
                      de: "Neuen Bereich starten",
                    })}
                  </button>
                ) : (
                  <span
                    className={cx("text-xs font-semibold", uiMutedTextClass)}
                  >
                    {t({
                      en: "Ask to be added",
                      fr: "Demander un accès",
                      de: "Zugriff anfragen",
                    })}
                  </span>
                )
              }
            />
            <StartStep
              step={t({ en: "Step 2", fr: "Étape 2", de: "Schritt 2" })}
              title={t({
                en: "Upload files",
                fr: "Ajouter des fichiers",
                de: "Dateien hochladen",
              })}
              description={t({
                en: "Open a space and use its file area to add folders or data.",
                fr: "Ouvrez un espace et utilisez sa zone de fichiers pour ajouter des dossiers ou des données.",
                de: "Öffnen Sie einen Bereich und nutzen Sie den Dateibereich, um Ordner oder Daten hinzuzufügen.",
              })}
              action={
                firstWritableSpace ? (
                  <Link
                    to={`${storageSpacePath(firstWritableSpace)}#space-files`}
                    className={cx(
                      uiButtonBaseClass,
                      uiButtonVariants.secondary,
                      "h-8 px-3 py-1.5 text-xs",
                    )}
                  >
                    {t({
                      en: "Open files",
                      fr: "Ouvrir les fichiers",
                      de: "Dateien öffnen",
                    })}
                  </Link>
                ) : (
                  <span
                    className={cx("text-xs font-semibold", uiMutedTextClass)}
                  >
                    {t({
                      en: "Create a space first",
                      fr: "Créez d'abord un espace",
                      de: "Zuerst Bereich erstellen",
                    })}
                  </span>
                )
              }
            />
            <StartStep
              step={t({ en: "Step 3", fr: "Étape 3", de: "Schritt 3" })}
              title={t({
                en: "Invite people",
                fr: "Inviter des personnes",
                de: "Personen einladen",
              })}
              description={t({
                en: "Managers can give internal collaborators Viewer or Editor access to team spaces.",
                fr: "Les gestionnaires peuvent donner aux collaborateurs un accès Lecteur ou Éditeur aux espaces d'équipe.",
                de: "Manager können internen Mitwirkenden Viewer- oder Editor-Zugriff auf Teambereiche geben.",
              })}
              action={
                firstManagedTeamSpace ? (
                  <Link
                    to={`/portal/storage-spaces/${encodeURIComponent(firstManagedTeamSpace.id)}?tab=collaborators`}
                    className={cx(
                      uiButtonBaseClass,
                      uiButtonVariants.secondary,
                      "h-8 px-3 py-1.5 text-xs",
                    )}
                  >
                    {t({ en: "Invite people", fr: "Inviter", de: "Einladen" })}
                  </Link>
                ) : (
                  <span
                    className={cx("text-xs font-semibold", uiMutedTextClass)}
                  >
                    {t({
                      en: "A managed team space is needed",
                      fr: "Un espace d'équipe géré est requis",
                      de: "Ein verwalteter Teambereich ist erforderlich",
                    })}
                  </span>
                )
              }
            />
            <StartStep
              step={t({ en: "Step 4", fr: "Étape 4", de: "Schritt 4" })}
              title={t({
                en: "Share a file",
                fr: "Partager un fichier",
                de: "Datei teilen",
              })}
              description={t({
                en: "Choose a file from the space to create an external link only when it is needed.",
                fr: "Choisissez un fichier depuis l'espace pour créer un lien externe uniquement si nécessaire.",
                de: "Wählen Sie bei Bedarf eine Datei im Bereich aus, um einen externen Link zu erstellen.",
              })}
              action={
                firstManagedTeamSpace ? (
                  <Link
                    to={`${storageSpacePath(firstManagedTeamSpace)}#space-files`}
                    className={cx(
                      uiButtonBaseClass,
                      uiButtonVariants.secondary,
                      "h-8 px-3 py-1.5 text-xs",
                    )}
                  >
                    {t({
                      en: "Choose file",
                      fr: "Choisir un fichier",
                      de: "Datei wählen",
                    })}
                  </Link>
                ) : (
                  <span
                    className={cx("text-xs font-semibold", uiMutedTextClass)}
                  >
                    {t({
                      en: "A managed team space is needed",
                      fr: "Un espace d'équipe géré est requis",
                      de: "Ein verwalteter Teambereich ist erforderlich",
                    })}
                  </span>
                )
              }
            />
          </ol>
        </section>
      ) : null}

      {showCreate ? (
        <WorkflowPage
          title={t({
            en: "Create a space",
            fr: "Créer un espace",
            de: "Bereich erstellen",
          })}
          description={t({
            en: "Define the space, its storage identity, and who can work there.",
            fr: "Définissez l'espace, son identité de stockage et les personnes qui peuvent y travailler.",
            de: "Legen Sie den Bereich, seine Speicheridentität und die berechtigten Personen fest.",
          })}
          breadcrumbs={portalBreadcrumbs(
            {
              label: t({ en: "Spaces", fr: "Espaces", de: "Bereiche" }),
              to: "/portal/storage-spaces",
            },
            {
              label: t({ en: "Create", fr: "Créer", de: "Erstellen" }),
            },
          )}
          backLabel={t({ en: "Back to spaces", fr: "Retour aux espaces", de: "Zurück zu Bereichen" })}
          onBack={createBusy ? undefined : () => setShowCreate(false)}
        >
          <div className="space-y-4">
            <p className={cx("ui-caption", uiMutedTextClass)}>
              {t({
                en: "Name the place first. You can upload files and invite collaborators right after it opens.",
                fr: "Nommez d'abord l'espace. Vous pourrez ajouter des fichiers et inviter des collaborateurs dès son ouverture.",
                de: "Benennen Sie zuerst den Bereich. Danach können Sie Dateien hochladen und Mitwirkende einladen.",
              })}
            </p>
            <div
              className={cx(
                "grid gap-3",
                canUseNamedBucket
                  ? "lg:grid-cols-[180px_1fr_1.5fr]"
                  : "lg:grid-cols-[1fr_1.5fr]",
              )}
            >
              {canUseNamedBucket ? (
                <UiSelect
                  label={t({
                    en: "Space setup",
                    fr: "Configuration de l'espace",
                    de: "Bereich einrichten",
                  })}
                  size="compact"
                  className="h-9"
                  value={newNamingMode}
                  onChange={(event) =>
                    setNewNamingMode(
                      event.target.value as "generic_uuid" | "named_bucket",
                    )
                  }
                >
                  <option value="generic_uuid">
                    {t({
                      en: "Let Portal choose the ID",
                      fr: "Laisser Portal choisir l'identifiant",
                      de: "Portal wählt die ID",
                    })}
                  </option>
                  <option value="named_bucket">
                    {t({
                      en: "Use a custom tool ID",
                      fr: "Utiliser un identifiant d'outil",
                      de: "Eigene Werkzeug-ID nutzen",
                    })}
                  </option>
                </UiSelect>
              ) : null}
              <UiInput
                label={
                  effectiveNamingMode === "named_bucket"
                    ? t({
                        en: "Space name and tool ID",
                        fr: "Nom de l'espace et identifiant d'outil",
                        de: "Bereichsname und Werkzeug-ID",
                      })
                    : t({
                        en: "Space name",
                        fr: "Nom de l'espace",
                        de: "Name des Bereichs",
                      })
                }
                size="compact"
                className="h-9"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder={
                  effectiveNamingMode === "named_bucket"
                    ? t({
                        en: "Project or dataset ID",
                        fr: "Identifiant du projet ou du jeu de données",
                        de: "Projekt- oder Datensatz-ID",
                      })
                    : t({
                        en: "Project, team, or dataset name",
                        fr: "Nom du projet, de l'équipe ou du jeu de données",
                        de: "Projekt-, Team- oder Datensatzname",
                      })
                }
              />
              <UiInput
                label={t({
                  en: "Description",
                  fr: "Description",
                  de: "Beschreibung",
                })}
                size="compact"
                className="h-9"
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
                placeholder={t({
                  en: "Description",
                  fr: "Description",
                  de: "Beschreibung",
                })}
              />
            </div>
            <div className="space-y-3">
              {createAccessModes.length > 1 ? (
                <PortalAccessModeFields
                  mode={newAccessMode}
                  onModeChange={setNewAccessMode}
                  accountMemberRole={newAccountMemberRole}
                  onAccountMemberRoleChange={setNewAccountMemberRole}
                  allowedModes={createAccessModes}
                  modeLabel={t({
                    en: "Who can access this space?",
                    fr: "Qui peut accéder à cet espace ?",
                    de: "Wer kann auf diesen Bereich zugreifen?",
                  })}
                  roleLabel={t({
                    en: "Default role for team members",
                    fr: "Rôle par défaut des membres",
                    de: "Standardrolle für Teammitglieder",
                  })}
                />
              ) : (
                <div className={cx("text-xs font-medium", uiMutedTextClass)}>
                  {portalAccessModeDescription("private", t)}
                </div>
              )}
              <div
                className={cx("text-[11px] font-semibold", uiMutedTextClass)}
              >
                {portalAccessModeSummary(
                  effectiveNewAccessMode,
                  selectedRestrictedEntries.length,
                  portalMemberCount,
                  t,
                )}
              </div>
            </div>
            {effectiveNewAccessMode === "restricted" ? (
              <PortalShareCandidatePicker
                candidates={shareCandidates}
                selectedRolesByUserId={restrictedRolesByUserId}
                query={shareCandidateQuery}
                loading={shareCandidatesLoading}
                error={shareCandidatesError}
                onQueryChange={setShareCandidateQuery}
                onRoleChange={(userId, role) =>
                  updateRestrictedRoles(
                    setRestrictedRolesByUserId,
                    userId,
                    role,
                  )
                }
              />
            ) : null}
            {createError ? (
              <UiInlineMessage tone="error">{createError}</UiInlineMessage>
            ) : null}
            <WorkflowActions>
              <UiButton
                variant="secondary"
                onClick={() => setShowCreate(false)}
                disabled={createBusy}
              >
                {t({ en: "Cancel", fr: "Annuler", de: "Abbrechen" })}
              </UiButton>
              <UiButton
                disabled={!newName.trim() || createBusy}
                loading={createBusy}
                onClick={handleCreate}
              >
                {t({ en: "Create", fr: "Créer", de: "Erstellen" })}
              </UiButton>
            </WorkflowActions>
          </div>
        </WorkflowPage>
      ) : null}

      {showImport ? (
        <WorkflowPage
          title={t({
            en: "Add existing space",
            fr: "Ajouter un espace existant",
            de: "Vorhandenen Bereich hinzufügen",
          })}
          description={t({
            en: "Attach existing storage to Portal and define its initial access.",
            fr: "Rattachez un stockage existant à Portal et définissez ses accès initiaux.",
            de: "Binden Sie vorhandenen Speicher an Portal an und legen Sie den anfänglichen Zugriff fest.",
          })}
          breadcrumbs={portalBreadcrumbs(
            {
              label: t({ en: "Spaces", fr: "Espaces", de: "Bereiche" }),
              to: "/portal/storage-spaces",
            },
            {
              label: t({ en: "Add existing", fr: "Ajouter un existant", de: "Vorhandenen hinzufügen" }),
            },
          )}
          backLabel={t({ en: "Back to spaces", fr: "Retour aux espaces", de: "Zurück zu Bereichen" })}
          onBack={importBusy ? undefined : () => setShowImport(false)}
        >
          <div className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-[1fr_1.5fr]">
              <UiInput
                label={t({
                  en: "Existing technical ID",
                  fr: "Identifiant technique existant",
                  de: "Vorhandene technische ID",
                })}
                size="compact"
                className="h-9"
                value={importBucketName}
                onChange={(event) => setImportBucketName(event.target.value)}
                placeholder={t({
                  en: "Existing technical ID",
                  fr: "Identifiant technique existant",
                  de: "Vorhandene technische ID",
                })}
              />
              <UiInput
                label={t({
                  en: "Description",
                  fr: "Description",
                  de: "Beschreibung",
                })}
                size="compact"
                className="h-9"
                value={importDescription}
                onChange={(event) => setImportDescription(event.target.value)}
                placeholder={t({
                  en: "Description",
                  fr: "Description",
                  de: "Beschreibung",
                })}
              />
            </div>
            <div className="space-y-3">
              <PortalAccessModeFields
                mode={importAccessMode}
                onModeChange={setImportAccessMode}
                accountMemberRole={importAccountMemberRole}
                onAccountMemberRoleChange={setImportAccountMemberRole}
                allowedModes={importAccessModes}
                modeLabel={t({
                  en: "Who can access this space?",
                  fr: "Qui peut accéder à cet espace ?",
                  de: "Wer kann auf diesen Bereich zugreifen?",
                })}
                roleLabel={t({
                  en: "Default role for team members",
                  fr: "Rôle par défaut des membres",
                  de: "Standardrolle für Teammitglieder",
                })}
              />
              <div
                className={cx("text-[11px] font-semibold", uiMutedTextClass)}
              >
                {portalAccessModeSummary(
                  importAccessMode,
                  selectedImportRestrictedEntries.length,
                  portalMemberCount,
                  t,
                )}
              </div>
            </div>
            {importAccessMode === "restricted" ? (
              <PortalShareCandidatePicker
                candidates={shareCandidates}
                selectedRolesByUserId={importRestrictedRolesByUserId}
                query={importShareCandidateQuery}
                loading={shareCandidatesLoading}
                error={shareCandidatesError}
                onQueryChange={setImportShareCandidateQuery}
                onRoleChange={(userId, role) =>
                  updateRestrictedRoles(
                    setImportRestrictedRolesByUserId,
                    userId,
                    role,
                  )
                }
              />
            ) : null}
            {importError ? (
              <UiInlineMessage tone="error">{importError}</UiInlineMessage>
            ) : null}
            <WorkflowActions>
              <UiButton
                variant="secondary"
                onClick={() => setShowImport(false)}
                disabled={importBusy}
              >
                {t({ en: "Cancel", fr: "Annuler", de: "Abbrechen" })}
              </UiButton>
              <UiButton
                disabled={!importBucketName.trim() || importBusy}
                loading={importBusy}
                onClick={handleImport}
              >
                {t({ en: "Add", fr: "Ajouter", de: "Hinzufügen" })}
              </UiButton>
            </WorkflowActions>
          </div>
        </WorkflowPage>
      ) : null}

      <PortalPageTabs
        tabs={[
          {
            id: "active",
            label: t({
              en: `Active spaces (${activeSpaces.length})`,
              fr: `Espaces actifs (${activeSpaces.length})`,
              de: `Aktive Bereiche (${activeSpaces.length})`,
            }),
          },
          {
            id: "archived",
            label: t({
              en: `Archived (${archivedSpaces.length})`,
              fr: `Archivés (${archivedSpaces.length})`,
              de: `Archiviert (${archivedSpaces.length})`,
            }),
          },
        ]}
        activeTab={activeTab}
        onChange={(tabId) => setActiveTab(tabId as SpacesTab)}
        ariaLabel={t({
          en: "Storage space views",
          fr: "Vues des espaces de stockage",
          de: "Speicherbereichsansichten",
        })}
        idPrefix="portal-storage-spaces"
      />

      <PortalTabPanel idPrefix="portal-storage-spaces" tabId={activeTab}>
        <UiCard>
          <div
            className={cx(
              "mb-4 grid gap-3",
              activeTab === "archived"
                ? "lg:grid-cols-[minmax(220px,1fr)_160px_180px]"
                : "lg:grid-cols-[minmax(220px,1fr)_160px_160px_180px]",
            )}
          >
          <UiInput
            label={t({ en: "Search", fr: "Recherche", de: "Suche" })}
            type="search"
            size="compact"
            className="h-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t({
              en: "Search spaces...",
              fr: "Rechercher des espaces...",
              de: "Bereiche suchen...",
            })}
          />
          <UiSelect
            label={t({ en: "My role", fr: "Mon rôle", de: "Meine Rolle" })}
            size="compact"
            className="h-9"
            value={roleFilter}
            onChange={(event) =>
              setRoleFilter(
                event.target.value as PortalStorageSpaceRole | "all",
              )
            }
          >
            <option value="all">
              {t({ en: "All roles", fr: "Tous les rôles", de: "Alle Rollen" })}
            </option>
            <option value="Manager">{portalRoleLabel("Manager", t)}</option>
            <option value="Owner">{portalRoleLabel("Owner", t)}</option>
            <option value="Editor">{portalRoleLabel("Editor", t)}</option>
            <option value="Viewer">{portalRoleLabel("Viewer", t)}</option>
          </UiSelect>
          {activeTab === "active" ? (
            <UiSelect
              label={t({ en: "Status", fr: "Statut", de: "Status" })}
              size="compact"
              className="h-9"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">
                {t({ en: "All states", fr: "Tous les états", de: "Alle Status" })}
              </option>
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </UiSelect>
          ) : null}
          <UiSelect
            label={t({ en: "Sort by", fr: "Trier par", de: "Sortieren nach" })}
            size="compact"
            className="h-9"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="name">
              {t({ en: "Name", fr: "Nom", de: "Name" })}
            </option>
            <option value="-created_at">
              {t({ en: "Newest", fr: "Plus récents", de: "Neueste" })}
            </option>
            <option value="-used_bytes">
              {t({ en: "Usage", fr: "Utilisation", de: "Nutzung" })}
            </option>
            <option value="-object_count">
              {t({ en: "Files", fr: "Fichiers", de: "Dateien" })}
            </option>
          </UiSelect>
          </div>
          <DataTableShell
            columns={storageSpaceColumns}
            rows={filteredSpaces}
            rowKey={(space) => space.id}
            status={tableStatus}
            loadingMessage={t({
              en: "Loading spaces...",
              fr: "Chargement des espaces...",
              de: "Bereiche werden geladen...",
            })}
            errorMessage={t({
              en: "Unable to load spaces.",
              fr: "Impossible de charger les espaces.",
              de: "Bereiche können nicht geladen werden.",
            })}
            emptyMessage={
              activeTab === "archived"
                ? t({
                    en: "No archived spaces.",
                    fr: "Aucun espace archivé.",
                    de: "Keine archivierten Bereiche.",
                  })
                : canCreate
                ? t({
                    en: "No spaces yet. Create one to start storing files.",
                    fr: "Aucun espace pour l'instant. Créez-en un pour commencer à stocker des fichiers.",
                    de: "Noch keine Bereiche. Erstellen Sie einen, um Dateien zu speichern.",
                  })
                : t({
                    en: "No spaces are available. Ask an administrator to add you to a space or enable creation for your account.",
                    fr: "Aucun espace n'est disponible. Demandez à un administrateur de vous ajouter à un espace ou d'activer la création pour votre compte.",
                    de: "Es sind keine Bereiche verfügbar. Bitten Sie einen Administrator, Sie zu einem Bereich hinzuzufügen oder die Erstellung für Ihr Konto zu aktivieren.",
                  })
            }
            responsiveCards
          />
          <div
            className={cx(
              "mt-4 flex items-center justify-between text-[11px] font-semibold",
              uiMutedTextClass,
            )}
          >
            <span>
              {t({
                en: `${filteredSpaces.length} of ${visibleSpaces.length}`,
                fr: `${filteredSpaces.length} sur ${visibleSpaces.length}`,
                de: `${filteredSpaces.length} von ${visibleSpaces.length}`,
              })}
            </span>
          </div>
        </UiCard>
      </PortalTabPanel>
    </div>
  );
}
