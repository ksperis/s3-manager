/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  createPortalStorageSpace,
  importPortalStorageSpace,
  listPortalShareCandidates,
  type PortalStorageSpaceAccountMemberRole,
  type PortalStorageSpaceRole,
  type PortalStorageSpaceShareCandidate,
  type PortalStorageSpaceVisibility,
} from "../../api/portal";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import PageHeader from "../../components/PageHeader";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiInput from "../../components/ui/UiInput";
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
import { formatBytes, formatCompactNumber } from "../../utils/format";
import {
  PortalAccessModeFields,
  PortalShareCandidatePicker,
  portalAccessModeDescription,
  portalAccessModeSummary,
  selectedPortalShares,
  type PortalAccessMode,
} from "./PortalAccessControls";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
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

function visibleStatus(space: { status: string }) {
  if (space.status === "Active") return null;
  return space.status;
}

function JourneyStepCard({
  title,
  description,
  actionLabel,
  to,
  onClick,
  disabled = false,
}: {
  title: string;
  description: string;
  actionLabel: string;
  to?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const actionClass = cx(
    uiButtonBaseClass,
    disabled ? uiButtonVariants.secondary : uiButtonVariants.primary,
    "h-8 px-3 py-1.5 text-xs",
    disabled && "pointer-events-none opacity-60"
  );
  return (
    <div className={cx(uiPanelMutedClass, "flex min-h-[132px] flex-col justify-between p-4")}>
      <div>
        <h2 className={cx("text-sm font-bold", uiTitleTextClass)}>{title}</h2>
        <p className={cx("mt-2 text-xs leading-5", uiMutedTextClass)}>{description}</p>
      </div>
      <div className="mt-3">
        {to ? (
          <Link to={to} className={actionClass} aria-disabled={disabled ? true : undefined}>
            {actionLabel}
          </Link>
        ) : (
          <button type="button" onClick={onClick} disabled={disabled} className={actionClass}>
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

export default function PortalStorageSpacesPage() {
  const { t } = useI18n();
  const { workspace, loading, error, hasAccountContext, accountError, accountLoading, accountIdForApi, state } = usePortalWorkspaceData({ includeArchived: true });
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<PortalStorageSpaceRole | "all">("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState("name");
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newAccessMode, setNewAccessMode] = useState<PortalAccessMode>("private");
  const [newAccountMemberRole, setNewAccountMemberRole] = useState<PortalStorageSpaceAccountMemberRole>("Editor");
  const [shareCandidates, setShareCandidates] = useState<PortalStorageSpaceShareCandidate[]>([]);
  const [shareCandidateQuery, setShareCandidateQuery] = useState("");
  const [shareCandidatesLoading, setShareCandidatesLoading] = useState(false);
  const [shareCandidatesError, setShareCandidatesError] = useState<string | null>(null);
  const [restrictedRolesByUserId, setRestrictedRolesByUserId] = useState<Record<number, PortalStorageSpaceRole>>({});
  const [importShareCandidateQuery, setImportShareCandidateQuery] = useState("");
  const [importRestrictedRolesByUserId, setImportRestrictedRolesByUserId] = useState<Record<number, PortalStorageSpaceRole>>({});
  const [newNamingMode, setNewNamingMode] = useState<"generic_uuid" | "named_bucket">("generic_uuid");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [importBucketName, setImportBucketName] = useState("");
  const [importDescription, setImportDescription] = useState("");
  const [importAccessMode, setImportAccessMode] = useState<PortalAccessMode>("private");
  const [importAccountMemberRole, setImportAccountMemberRole] = useState<PortalStorageSpaceAccountMemberRole>("Editor");
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSpaces = useMemo(() => {
    const filtered = workspace.spaces.filter((space) => {
      if (roleFilter !== "all" && space.role !== roleFilter) return false;
      if (statusFilter !== "all" && space.status !== statusFilter) return false;
      if (!normalizedQuery) return true;
      return [space.name, space.description, space.ownerLabel, space.visibility, portalShareScopeLabel(space.visibility, space.shareScope, t), space.projectKey, space.datasetLabel]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery));
    });
    return [...filtered].sort((a, b) => {
      if (sort === "created_at") return (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
      if (sort === "-created_at") return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
      if (sort === "used_bytes") return (a.usedBytes ?? -1) - (b.usedBytes ?? -1);
      if (sort === "-used_bytes") return (b.usedBytes ?? -1) - (a.usedBytes ?? -1);
      if (sort === "object_count") return (a.objectCount ?? -1) - (b.objectCount ?? -1);
      if (sort === "-object_count") return (b.objectCount ?? -1) - (a.objectCount ?? -1);
      return a.name.localeCompare(b.name);
    });
  }, [normalizedQuery, roleFilter, sort, statusFilter, t, workspace.spaces]);
  const tableStatus = filteredSpaces.length === 0 ? "empty" : "ready";
  const storageSpaceColumns = useMemo<DataTableColumn<PortalWorkspaceSpace>[]>(
    () => [
      {
        id: "name",
        label: t({ en: "Space", fr: "Espace", de: "Bereich" }),
        mobileLabel: t({ en: "Space", fr: "Espace", de: "Bereich" }),
        primary: true,
        render: (space) => (
          <>
            <Link
              to={storageSpacePath(space)}
              className={cx(
                "font-bold hover:text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                uiTitleTextClass,
              )}
            >
              {space.name}
            </Link>
            <div className={cx("text-[11px] font-medium", uiMutedTextClass)}>{space.description}</div>
          </>
        ),
      },
      {
        id: "access",
        label: t({ en: "Collaborators", fr: "Collaborateurs", de: "Mitwirkende" }),
        render: (space) => {
          const status = visibleStatus(space);
          return (
            <div className="flex flex-wrap items-center gap-2">
              <UiBadge tone={portalVisibilityTone(space.visibility)}>{portalShareScopeLabel(space.visibility, space.shareScope, t)}</UiBadge>
              {status ? <UiBadge tone={portalStorageSpaceStatusTone(space)}>{portalStatusLabel(status as "Active" | "Attention" | "Archived", t)}</UiBadge> : null}
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
          <Link to={storageSpacePath(space)} className="text-xs font-bold text-primary hover:text-primary-600 dark:text-primary-200 dark:hover:text-primary-100">
            {t({ en: "Open", fr: "Ouvrir", de: "Öffnen" })}
          </Link>
        ),
      },
    ],
    [t]
  );

  const canCreate = Boolean(state?.can_create_storage_spaces);
  const canImport = state?.account_role === "portal_manager" && Boolean(state?.can_manage_buckets);
  const canUseNamedBucket = Boolean(state?.allow_named_bucket_create);
  const canChooseVisibility = state?.account_role === "portal_manager";
  const effectiveNamingMode = canUseNamedBucket ? newNamingMode : "generic_uuid";
  const effectiveNewAccessMode: PortalAccessMode = canChooseVisibility ? newAccessMode : "private";
  const effectiveNewVisibility: PortalStorageSpaceVisibility = effectiveNewAccessMode === "private" ? "private" : "shared";
  const effectiveNewShareScope = effectiveNewAccessMode === "account" ? "account" : "restricted";
  const effectiveImportVisibility: PortalStorageSpaceVisibility = importAccessMode === "private" ? "private" : "shared";
  const effectiveImportShareScope = importAccessMode === "account" ? "account" : "restricted";
  const selectedRestrictedEntries = selectedPortalShares(restrictedRolesByUserId);
  const selectedImportRestrictedEntries = selectedPortalShares(importRestrictedRolesByUserId);
  const portalMemberCount = shareCandidates.length + 1;
  const activeSpaces = workspace.spaces.filter((space) => space.status !== "Archived");
  const firstWritableSpace = activeSpaces.find((space) => space.contentRole === "Owner" || space.contentRole === "Editor" || space.role === "Owner" || space.role === "Editor");
  const firstOwnerSpace = activeSpaces.find((space) => space.role === "Owner");

  useEffect(() => {
    let cancelled = false;
    const needsCandidates = (
      showCreate && newAccessMode !== "private" && canChooseVisibility
    ) || (
      showImport && importAccessMode !== "private" && canImport
    );
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
          setShareCandidatesError(extractApiError(err, t({ en: "Unable to load people.", fr: "Impossible de charger les personnes.", de: "Personen können nicht geladen werden." })));
        }
      })
      .finally(() => {
        if (!cancelled) setShareCandidatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, canChooseVisibility, canImport, importAccessMode, newAccessMode, showCreate, showImport, t]);

  const updateRestrictedRoles = (
    setter: Dispatch<SetStateAction<Record<number, PortalStorageSpaceRole>>>,
    userId: number,
    role: PortalStorageSpaceRole | null,
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
        visibility: effectiveNewVisibility,
        share_scope: effectiveNewShareScope,
        account_member_role: effectiveNewShareScope === "account" ? newAccountMemberRole : null,
        initial_shares: effectiveNewShareScope === "restricted" ? selectedRestrictedEntries : [],
      });
      navigate(storageSpacePath({ id: created.id }));
    } catch (err) {
      console.error(err);
      setCreateError(extractApiError(err, t({ en: "Unable to create this space.", fr: "Impossible de créer cet espace.", de: "Dieser Bereich kann nicht erstellt werden." })));
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
        visibility: effectiveImportVisibility,
        share_scope: effectiveImportShareScope,
        account_member_role: effectiveImportShareScope === "account" ? importAccountMemberRole : null,
        initial_shares: effectiveImportShareScope === "restricted" ? selectedImportRestrictedEntries : [],
      });
      navigate(storageSpacePath({ id: imported.id }));
    } catch (err) {
      console.error(err);
      setImportError(extractApiError(err, t({ en: "Unable to add existing storage.", fr: "Impossible d'ajouter le stockage existant.", de: "Vorhandener Speicher kann nicht hinzugefügt werden." })));
    } finally {
      setImportBusy(false);
    }
  };

  const pageState = resolvePortalWorkspacePageState({
    accountLoading,
    loading,
    accountError,
    error,
    hasAccountContext,
    loadingMessage: t({ en: "Loading spaces...", fr: "Chargement des espaces...", de: "Bereiche werden geladen..." }),
    noAccountMessage: t({ en: "Select an account to view spaces.", fr: "Sélectionnez un compte pour voir les espaces.", de: "Wählen Sie ein Konto aus, um Bereiche anzuzeigen." }),
  });
  if (pageState) return pageState;
  const headerActions = [
    ...(canCreate ? [{ label: t({ en: "Create space", fr: "Créer un espace", de: "Bereich erstellen" }), onClick: () => setShowCreate((value) => !value) }] : []),
    ...(canImport
      ? [{ label: t({ en: "Add existing space", fr: "Ajouter un espace existant", de: "Vorhandenen Bereich hinzufügen" }), onClick: () => setShowImport((value) => !value), variant: "secondary" as const }]
      : []),
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={t({ en: "Spaces", fr: "Espaces", de: "Bereiche" })}
        description={t({ en: "Create places for project files, upload data, and invite collaborators.", fr: "Créez des espaces pour les fichiers de projet, ajoutez des données et invitez des collaborateurs.", de: "Erstellen Sie Bereiche für Projektdateien, laden Sie Daten hoch und laden Sie Mitwirkende ein." })}
        breadcrumbs={portalBreadcrumbs({ label: t({ en: "Spaces", fr: "Espaces", de: "Bereiche" }) })}
        actions={headerActions}
      />

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" aria-label={t({ en: "Main workspace tasks", fr: "Tâches principales de l'espace", de: "Wichtige Workspace-Aufgaben" })}>
        <JourneyStepCard
          title={t({ en: "Create a space", fr: "Créer un espace", de: "Bereich erstellen" })}
          description={t({ en: "Start a focused place for a project, dataset, or team handoff.", fr: "Démarrez un espace dédié à un projet, un jeu de données ou un transfert d'équipe.", de: "Starten Sie einen fokussierten Bereich für ein Projekt, einen Datensatz oder eine Teamübergabe." })}
          actionLabel={t({ en: "Start", fr: "Commencer", de: "Starten" })}
          onClick={() => setShowCreate(true)}
          disabled={!canCreate}
        />
        <JourneyStepCard
          title={t({ en: "Upload files", fr: "Ajouter des fichiers", de: "Dateien hochladen" })}
          description={t({ en: "Open a space and add files or folders without seeing storage internals.", fr: "Ouvrez un espace et ajoutez des fichiers ou dossiers sans voir les détails techniques.", de: "Öffnen Sie einen Bereich und fügen Sie Dateien oder Ordner ohne technische Details hinzu." })}
          actionLabel={t({ en: "Open files", fr: "Ouvrir les fichiers", de: "Dateien öffnen" })}
          to={firstWritableSpace ? `${storageSpacePath(firstWritableSpace)}#space-files` : undefined}
          disabled={!firstWritableSpace}
        />
        <JourneyStepCard
          title={t({ en: "Invite collaborators", fr: "Inviter des collaborateurs", de: "Mitwirkende einladen" })}
          description={t({ en: "Give selected people Viewer, Editor, or Owner access to a space.", fr: "Donnez aux personnes choisies un accès Lecteur, Éditeur ou Propriétaire.", de: "Geben Sie ausgewählten Personen Betrachter-, Bearbeiter- oder Eigentümerzugriff." })}
          actionLabel={t({ en: "Invite people", fr: "Inviter", de: "Einladen" })}
          to={firstOwnerSpace ? `/portal/shares?space_id=${encodeURIComponent(firstOwnerSpace.id)}&tab=by` : undefined}
          disabled={!firstOwnerSpace}
        />
        <JourneyStepCard
          title={t({ en: "Share outside", fr: "Partager en externe", de: "Extern teilen" })}
          description={t({ en: "Review public links and create new ones from selected files when sharing is allowed.", fr: "Consultez les liens publics et créez-en depuis les fichiers lorsque le partage est autorisé.", de: "Prüfen Sie öffentliche Links und erstellen Sie neue aus Dateien, wenn Teilen erlaubt ist." })}
          actionLabel={t({ en: "Review links", fr: "Voir les liens", de: "Links prüfen" })}
          to="/portal/shares?tab=links"
          disabled={workspace.spaces.length === 0}
        />
      </section>

      {showCreate ? (
        <UiCard
          title={t({ en: "Create a space", fr: "Créer un espace", de: "Bereich erstellen" })}
          description={t({ en: "Name the place first. You can upload files and invite collaborators right after it opens.", fr: "Nommez d'abord l'espace. Vous pourrez ajouter des fichiers et inviter des collaborateurs dès son ouverture.", de: "Benennen Sie zuerst den Bereich. Danach können Sie Dateien hochladen und Mitwirkende einladen." })}
        >
          <div className={cx("grid gap-3", canUseNamedBucket
            ? "lg:grid-cols-[180px_1fr_1.5fr_auto]"
            : "lg:grid-cols-[1fr_1.5fr_auto]")}>
            {canUseNamedBucket ? (
              <UiSelect
                label={t({ en: "Storage setup", fr: "Configuration du stockage", de: "Speicher-Einrichtung" })}
                size="compact"
                className="h-9"
                value={newNamingMode}
                onChange={(event) => setNewNamingMode(event.target.value as "generic_uuid" | "named_bucket")}
              >
                <option value="generic_uuid">{t({ en: "Automatic space", fr: "Espace automatique", de: "Automatischer Bereich" })}</option>
                <option value="named_bucket">{t({ en: "Named storage", fr: "Stockage nommé", de: "Benannter Speicher" })}</option>
              </UiSelect>
            ) : null}
            <UiInput
              label={effectiveNamingMode === "named_bucket"
                ? t({ en: "Space and storage name", fr: "Nom de l'espace et du stockage", de: "Name von Bereich und Speicher" })
                : t({ en: "Space name", fr: "Nom de l'espace", de: "Name des Bereichs" })}
              size="compact"
              className="h-9"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder={effectiveNamingMode === "named_bucket"
                ? t({ en: "Space and storage name", fr: "Nom de l'espace et du stockage", de: "Name von Bereich und Speicher" })
                : t({ en: "Project, team, or dataset name", fr: "Nom du projet, de l'équipe ou du jeu de données", de: "Projekt-, Team- oder Datensatzname" })}
            />
            <UiInput
              label={t({ en: "Description", fr: "Description", de: "Beschreibung" })}
              size="compact"
              className="h-9"
              value={newDescription}
              onChange={(event) => setNewDescription(event.target.value)}
              placeholder={t({ en: "Description", fr: "Description", de: "Beschreibung" })}
            />
            <UiButton disabled={!newName.trim() || createBusy} onClick={handleCreate} className="h-9 px-3 py-1.5">
              {createBusy ? t({ en: "Creating...", fr: "Création...", de: "Wird erstellt..." }) : t({ en: "Create", fr: "Créer", de: "Erstellen" })}
            </UiButton>
          </div>
          <div className="mt-3 space-y-3">
            {canChooseVisibility ? (
              <PortalAccessModeFields
                mode={newAccessMode}
                onModeChange={setNewAccessMode}
                accountMemberRole={newAccountMemberRole}
                onAccountMemberRoleChange={setNewAccountMemberRole}
                modeLabel={t({ en: "Who can access this space?", fr: "Qui peut accéder à cet espace ?", de: "Wer kann auf diesen Bereich zugreifen?" })}
                roleLabel={t({ en: "Default role for team members", fr: "Rôle par défaut des membres", de: "Standardrolle für Teammitglieder" })}
              />
            ) : (
              <div className={cx("text-xs font-medium", uiMutedTextClass)}>
                {portalAccessModeDescription("private", t)}
              </div>
            )}
            <div className={cx("text-[11px] font-semibold", uiMutedTextClass)}>
              {portalAccessModeSummary(effectiveNewAccessMode, selectedRestrictedEntries.length, portalMemberCount, t)}
            </div>
          </div>
          {canChooseVisibility && newAccessMode === "restricted" ? (
            <PortalShareCandidatePicker
              candidates={shareCandidates}
              selectedRolesByUserId={restrictedRolesByUserId}
              query={shareCandidateQuery}
              loading={shareCandidatesLoading}
              error={shareCandidatesError}
              onQueryChange={setShareCandidateQuery}
              onRoleChange={(userId, role) => updateRestrictedRoles(setRestrictedRolesByUserId, userId, role)}
            />
          ) : null}
          {createError ? (
            <UiInlineMessage tone="error" className="mt-3">
              {createError}
            </UiInlineMessage>
          ) : null}
        </UiCard>
      ) : null}

      {showImport ? (
        <UiCard title={t({ en: "Add existing space", fr: "Ajouter un espace existant", de: "Vorhandenen Bereich hinzufügen" })}>
          <div className="grid gap-3 lg:grid-cols-[1fr_1.5fr_auto]">
            <UiInput
              label={t({ en: "Existing storage name", fr: "Nom du stockage existant", de: "Name des vorhandenen Speichers" })}
              size="compact"
              className="h-9"
              value={importBucketName}
              onChange={(event) => setImportBucketName(event.target.value)}
              placeholder={t({ en: "Existing storage name", fr: "Nom du stockage existant", de: "Name des vorhandenen Speichers" })}
            />
            <UiInput
              label={t({ en: "Description", fr: "Description", de: "Beschreibung" })}
              size="compact"
              className="h-9"
              value={importDescription}
              onChange={(event) => setImportDescription(event.target.value)}
              placeholder={t({ en: "Description", fr: "Description", de: "Beschreibung" })}
            />
            <UiButton disabled={!importBucketName.trim() || importBusy} onClick={handleImport} className="h-9 px-3 py-1.5">
              {importBusy ? t({ en: "Adding...", fr: "Ajout...", de: "Wird hinzugefügt..." }) : t({ en: "Add", fr: "Ajouter", de: "Hinzufügen" })}
            </UiButton>
          </div>
          <div className="mt-3 space-y-3">
            <PortalAccessModeFields
              mode={importAccessMode}
              onModeChange={setImportAccessMode}
              accountMemberRole={importAccountMemberRole}
              onAccountMemberRoleChange={setImportAccountMemberRole}
              modeLabel={t({ en: "Who can access this space?", fr: "Qui peut accéder à cet espace ?", de: "Wer kann auf diesen Bereich zugreifen?" })}
              roleLabel={t({ en: "Default role for team members", fr: "Rôle par défaut des membres", de: "Standardrolle für Teammitglieder" })}
            />
            <div className={cx("text-[11px] font-semibold", uiMutedTextClass)}>
              {portalAccessModeSummary(importAccessMode, selectedImportRestrictedEntries.length, portalMemberCount, t)}
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
              onRoleChange={(userId, role) => updateRestrictedRoles(setImportRestrictedRolesByUserId, userId, role)}
            />
          ) : null}
          {importError ? (
            <UiInlineMessage tone="error" className="mt-3">
              {importError}
            </UiInlineMessage>
          ) : null}
        </UiCard>
      ) : null}

      <UiCard>
        <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(220px,1fr)_160px_160px_180px]">
          <UiInput
            label={t({ en: "Search", fr: "Recherche", de: "Suche" })}
            type="search"
            size="compact"
            className="h-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t({ en: "Search spaces...", fr: "Rechercher des espaces...", de: "Bereiche suchen..." })}
          />
          <UiSelect
            label={t({ en: "My role", fr: "Mon rôle", de: "Meine Rolle" })}
            size="compact"
            className="h-9"
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value as PortalStorageSpaceRole | "all")}
          >
            <option value="all">{t({ en: "All roles", fr: "Tous les rôles", de: "Alle Rollen" })}</option>
            <option value="Owner">{portalRoleLabel("Owner", t)}</option>
            <option value="Editor">{portalRoleLabel("Editor", t)}</option>
            <option value="Viewer">{portalRoleLabel("Viewer", t)}</option>
          </UiSelect>
          <UiSelect
            label={t({ en: "Status", fr: "Statut", de: "Status" })}
            size="compact"
            className="h-9"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">{t({ en: "All states", fr: "Tous les états", de: "Alle Status" })}</option>
            <option value="Active">{portalStatusLabel("Active", t)}</option>
            <option value="Attention">{portalStatusLabel("Attention", t)}</option>
            <option value="Archived">{portalStatusLabel("Archived", t)}</option>
          </UiSelect>
          <UiSelect
            label={t({ en: "Sort by", fr: "Trier par", de: "Sortieren nach" })}
            size="compact"
            className="h-9"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="name">{t({ en: "Name", fr: "Nom", de: "Name" })}</option>
            <option value="-created_at">{t({ en: "Newest", fr: "Plus récents", de: "Neueste" })}</option>
            <option value="-used_bytes">{t({ en: "Usage", fr: "Utilisation", de: "Nutzung" })}</option>
            <option value="-object_count">{t({ en: "Files", fr: "Fichiers", de: "Dateien" })}</option>
          </UiSelect>
        </div>
        <DataTableShell
          columns={storageSpaceColumns}
          rows={filteredSpaces}
          rowKey={(space) => space.id}
          status={tableStatus}
          loadingMessage={t({ en: "Loading spaces...", fr: "Chargement des espaces...", de: "Bereiche werden geladen..." })}
          errorMessage={t({ en: "Unable to load spaces.", fr: "Impossible de charger les espaces.", de: "Bereiche können nicht geladen werden." })}
          emptyMessage={canCreate
            ? t({
                en: "No spaces yet. Create one to start storing files.",
                fr: "Aucun espace pour l'instant. Créez-en un pour commencer à stocker des fichiers.",
                de: "Noch keine Bereiche. Erstellen Sie einen, um Dateien zu speichern.",
              })
            : t({
                en: "No spaces are available. Ask an administrator to add you to a space or enable creation for your account.",
                fr: "Aucun espace n'est disponible. Demandez à un administrateur de vous ajouter à un espace ou d'activer la création pour votre compte.",
                de: "Es sind keine Bereiche verfügbar. Bitten Sie einen Administrator, Sie zu einem Bereich hinzuzufügen oder die Erstellung für Ihr Konto zu aktivieren.",
              })}
          responsiveCards
        />
        <div className={cx("mt-4 flex items-center justify-between text-[11px] font-semibold", uiMutedTextClass)}>
          <span>
            {t({
              en: `${filteredSpaces.length} of ${workspace.spaces.length}`,
              fr: `${filteredSpaces.length} sur ${workspace.spaces.length}`,
              de: `${filteredSpaces.length} von ${workspace.spaces.length}`,
            })}
          </span>
        </div>
      </UiCard>
    </div>
  );
}
