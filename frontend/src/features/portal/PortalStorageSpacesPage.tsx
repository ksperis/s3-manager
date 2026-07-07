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
import PageHeader from "../../components/PageHeader";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import { cx, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
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
          setShareCandidatesError(extractApiError(err, t({ en: "Unable to load eligible users.", fr: "Impossible de charger les utilisateurs éligibles.", de: "Berechtigte Benutzer können nicht geladen werden." })));
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
      setCreateError(extractApiError(err, t({ en: "Unable to create Storage Space.", fr: "Impossible de créer l'espace de stockage.", de: "Speicherbereich kann nicht erstellt werden." })));
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
    loadingMessage: t({ en: "Loading storage spaces...", fr: "Chargement des espaces de stockage...", de: "Speicherbereiche werden geladen..." }),
    noAccountMessage: t({ en: "Select an account to view storage spaces.", fr: "Sélectionnez un compte pour voir les espaces de stockage.", de: "Wählen Sie ein Konto aus, um Speicherbereiche anzuzeigen." }),
  });
  if (pageState) return pageState;
  const headerActions = [
    ...(canCreate ? [{ label: t({ en: "Create storage space", fr: "Créer un espace de stockage", de: "Speicherbereich erstellen" }), onClick: () => setShowCreate((value) => !value) }] : []),
    ...(canImport
      ? [{ label: t({ en: "Add existing storage", fr: "Ajouter un stockage existant", de: "Vorhandenen Speicher hinzufügen" }), onClick: () => setShowImport((value) => !value), variant: "secondary" as const }]
      : []),
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={t({ en: "Storage Spaces", fr: "Espaces de stockage", de: "Speicherbereiche" })}
        description={t({ en: "Manage access, files and usage for your Storage Spaces.", fr: "Gérez les accès, les fichiers et l'utilisation de vos espaces de stockage.", de: "Verwalten Sie Zugriff, Dateien und Nutzung Ihrer Speicherbereiche." })}
        breadcrumbs={portalBreadcrumbs({ label: t({ en: "Storage Spaces", fr: "Espaces de stockage", de: "Speicherbereiche" }) })}
        actions={headerActions}
      />

      {showCreate ? (
        <UiCard title={t({ en: "Create Storage Space", fr: "Créer un espace de stockage", de: "Speicherbereich erstellen" })}>
          <div className={cx("grid gap-3", canUseNamedBucket
            ? "lg:grid-cols-[180px_1fr_1.5fr_auto]"
            : "lg:grid-cols-[1fr_1.5fr_auto]")}>
            {canUseNamedBucket ? (
              <select
                className="ui-control h-9 py-1.5 text-xs"
                value={newNamingMode}
                onChange={(event) => setNewNamingMode(event.target.value as "generic_uuid" | "named_bucket")}
                aria-label={t({ en: "Storage Space naming mode", fr: "Mode de nommage de l'espace de stockage", de: "Benennungsmodus des Speicherbereichs" })}
              >
                <option value="generic_uuid">{t({ en: "Automatic storage", fr: "Stockage automatique", de: "Automatischer Speicher" })}</option>
                <option value="named_bucket">{t({ en: "Named storage", fr: "Stockage nommé", de: "Benannter Speicher" })}</option>
              </select>
            ) : null}
            <input
              className="ui-control h-9 text-xs"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder={effectiveNamingMode === "named_bucket"
                ? t({ en: "Storage Space and storage name", fr: "Nom de l'espace et du stockage", de: "Name von Speicherbereich und Speicher" })
                : t({ en: "Storage Space name", fr: "Nom de l'espace de stockage", de: "Name des Speicherbereichs" })}
            />
            <input className="ui-control h-9 text-xs" value={newDescription} onChange={(event) => setNewDescription(event.target.value)} placeholder={t({ en: "Description", fr: "Description", de: "Beschreibung" })} />
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
                modeLabel={t({ en: "Storage Space access", fr: "Accès à l'espace de stockage", de: "Zugriff auf den Speicherbereich" })}
                roleLabel={t({ en: "Default access for account members", fr: "Accès par défaut des membres du compte", de: "Standardzugriff für Kontomitglieder" })}
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
          {createError ? <div className="mt-3 text-xs font-semibold text-rose-600 dark:text-rose-300">{createError}</div> : null}
        </UiCard>
      ) : null}

      {showImport ? (
        <UiCard title={t({ en: "Add existing storage", fr: "Ajouter un stockage existant", de: "Vorhandenen Speicher hinzufügen" })}>
          <div className="grid gap-3 lg:grid-cols-[1fr_1.5fr_auto]">
            <input
              className="ui-control h-9 text-xs"
              value={importBucketName}
              onChange={(event) => setImportBucketName(event.target.value)}
              placeholder={t({ en: "Existing storage name", fr: "Nom du stockage existant", de: "Name des vorhandenen Speichers" })}
            />
            <input
              className="ui-control h-9 text-xs"
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
              modeLabel={t({ en: "Imported Storage Space access", fr: "Accès à l'espace importé", de: "Zugriff auf den importierten Speicherbereich" })}
              roleLabel={t({ en: "Default access for account members", fr: "Accès par défaut des membres du compte", de: "Standardzugriff für Kontomitglieder" })}
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
          {importError ? <div className="mt-3 text-xs font-semibold text-rose-600 dark:text-rose-300">{importError}</div> : null}
        </UiCard>
      ) : null}

      <UiCard>
        <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(220px,1fr)_160px_160px_180px]">
          <input
            type="search"
            className="ui-control h-9 py-1.5 text-xs"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t({ en: "Search storage spaces...", fr: "Rechercher des espaces de stockage...", de: "Speicherbereiche suchen..." })}
          />
          <select className="ui-control h-9 py-1.5 text-xs" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as PortalStorageSpaceRole | "all")}>
            <option value="all">{t({ en: "All roles", fr: "Tous les rôles", de: "Alle Rollen" })}</option>
            <option value="Owner">{portalRoleLabel("Owner", t)}</option>
            <option value="Editor">{portalRoleLabel("Editor", t)}</option>
            <option value="Viewer">{portalRoleLabel("Viewer", t)}</option>
          </select>
          <select className="ui-control h-9 py-1.5 text-xs" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">{t({ en: "All states", fr: "Tous les états", de: "Alle Status" })}</option>
            <option value="Active">{portalStatusLabel("Active", t)}</option>
            <option value="Attention">{portalStatusLabel("Attention", t)}</option>
            <option value="Archived">{portalStatusLabel("Archived", t)}</option>
          </select>
          <select className="ui-control h-9 py-1.5 text-xs" value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="name">{t({ en: "Name", fr: "Nom", de: "Name" })}</option>
            <option value="-created_at">{t({ en: "Newest", fr: "Plus récents", de: "Neueste" })}</option>
            <option value="-used_bytes">{t({ en: "Usage", fr: "Utilisation", de: "Nutzung" })}</option>
            <option value="-object_count">{t({ en: "Files", fr: "Fichiers", de: "Dateien" })}</option>
          </select>
        </div>
        <div className="overflow-x-auto max-md:overflow-visible">
          <table className="ui-data-table min-w-[840px] max-md:block max-md:w-full max-md:min-w-0">
            <thead className="max-md:hidden">
              <tr>
                <th>{t({ en: "Name", fr: "Nom", de: "Name" })}</th>
                <th>{t({ en: "Access", fr: "Accès", de: "Zugriff" })}</th>
                <th>{t({ en: "Files", fr: "Fichiers", de: "Dateien" })}</th>
                <th>{t({ en: "Size", fr: "Taille", de: "Größe" })}</th>
                <th>{t({ en: "Created", fr: "Créé", de: "Erstellt" })}</th>
                <th>{t({ en: "Region", fr: "Région", de: "Region" })}</th>
                <th className="text-right">{t({ en: "Action", fr: "Action", de: "Aktion" })}</th>
              </tr>
            </thead>
            <tbody className="max-md:block max-md:w-full max-md:space-y-3">
              {filteredSpaces.map((space) => {
                const status = visibleStatus(space);
                return (
                  <tr key={space.id} className="max-md:block max-md:w-full max-md:rounded-md max-md:border max-md:border-[color:var(--ui-border)] max-md:bg-[color:var(--ui-surface)] max-md:p-3">
                    <td className="max-md:block max-md:border-0 max-md:p-0">
                      <span className={cx("hidden text-[11px] font-semibold max-md:block", uiMutedTextClass)}>{t({ en: "Storage Space", fr: "Espace de stockage", de: "Speicherbereich" })}</span>
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
                    </td>
                    <td className="max-md:mt-3 max-md:block max-md:border-0 max-md:p-0">
                      <span className={cx("hidden text-[11px] font-semibold max-md:block", uiMutedTextClass)}>{t({ en: "Access", fr: "Accès", de: "Zugriff" })}</span>
                      <div className="flex flex-wrap items-center gap-2">
                        <UiBadge tone={portalVisibilityTone(space.visibility)}>{portalShareScopeLabel(space.visibility, space.shareScope, t)}</UiBadge>
                        {status ? <UiBadge tone={portalStorageSpaceStatusTone(space)}>{portalStatusLabel(status as "Active" | "Attention" | "Archived", t)}</UiBadge> : null}
                      </div>
                    </td>
                    <td className="max-md:mt-3 max-md:block max-md:border-0 max-md:p-0">
                      <span className={cx("hidden text-[11px] font-semibold max-md:block", uiMutedTextClass)}>{t({ en: "Files", fr: "Fichiers", de: "Dateien" })}</span>
                      {formatCompactNumber(space.objectCount)}
                    </td>
                    <td className="max-md:mt-3 max-md:block max-md:border-0 max-md:p-0">
                      <span className={cx("hidden text-[11px] font-semibold max-md:block", uiMutedTextClass)}>{t({ en: "Size", fr: "Taille", de: "Größe" })}</span>
                      {formatBytes(space.usedBytes)}
                    </td>
                    <td className="max-md:mt-3 max-md:block max-md:border-0 max-md:p-0">
                      <span className={cx("hidden text-[11px] font-semibold max-md:block", uiMutedTextClass)}>{t({ en: "Created", fr: "Créé", de: "Erstellt" })}</span>
                      {space.createdLabel}
                    </td>
                    <td className="max-md:mt-3 max-md:block max-md:border-0 max-md:p-0">
                      <span className={cx("hidden text-[11px] font-semibold max-md:block", uiMutedTextClass)}>{t({ en: "Region", fr: "Région", de: "Region" })}</span>
                      {space.region}
                    </td>
                    <td className="text-right max-md:mt-3 max-md:block max-md:border-0 max-md:p-0 max-md:text-left">
                      <Link to={storageSpacePath(space)} className="text-xs font-bold text-primary hover:text-primary-600 dark:text-primary-200 dark:hover:text-primary-100">
                        {t({ en: "Open", fr: "Ouvrir", de: "Öffnen" })}
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {filteredSpaces.length === 0 ? (
                <tr className="max-md:block max-md:w-full">
                  <td colSpan={7} className={cx("py-6 text-center text-xs font-semibold max-md:block max-md:border-0", uiMutedTextClass)}>
                    {canCreate
                      ? t({
                          en: "No Storage Spaces yet. Create one to start storing files.",
                          fr: "Aucun espace de stockage pour l'instant. Créez-en un pour commencer à stocker des fichiers.",
                          de: "Noch keine Speicherbereiche. Erstellen Sie einen, um Dateien zu speichern.",
                        })
                      : t({
                          en: "No Storage Spaces are available. Ask an administrator to add you to a Storage Space or enable creation for your account.",
                          fr: "Aucun espace de stockage n'est disponible. Demandez à un administrateur de vous ajouter à un espace ou d'activer la création pour votre compte.",
                          de: "Es sind keine Speicherbereiche verfügbar. Bitten Sie einen Administrator, Sie zu einem Speicherbereich hinzuzufügen oder die Erstellung für Ihr Konto zu aktivieren.",
                        })}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
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
