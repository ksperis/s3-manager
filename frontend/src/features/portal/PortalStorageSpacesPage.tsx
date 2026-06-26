/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createPortalStorageSpace, importPortalStorageSpace, type PortalStorageSpaceRole, type PortalStorageSpaceVisibility } from "../../api/portal";
import PageHeader from "../../components/PageHeader";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import { cx, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import { storageSpacePath } from "./portalWorkspaceModel";
import {
  portalStorageSpaceStatusTone,
  portalVisibilityTone,
  resolvePortalWorkspacePageState,
} from "./portalUi";
import {
  portalRoleLabel,
  portalStatusLabel,
  portalVisibilityLabel,
} from "./portalI18n";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

function visibleStatus(space: { status: string }) {
  if (space.status === "Active") return null;
  return space.status;
}

export default function PortalStorageSpacesPage() {
  const { t } = useI18n();
  const { workspace, loading, error, hasAccountContext, accountError, accountLoading, accountIdForApi, state } = usePortalWorkspaceData();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<PortalStorageSpaceRole | "all">("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState("name");
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newVisibility, setNewVisibility] = useState<PortalStorageSpaceVisibility>("private");
  const [newNamingMode, setNewNamingMode] = useState<"generic_uuid" | "named_bucket">("generic_uuid");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [importBucketName, setImportBucketName] = useState("");
  const [importDescription, setImportDescription] = useState("");
  const [importVisibility, setImportVisibility] = useState<PortalStorageSpaceVisibility>("private");
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSpaces = useMemo(() => {
    const filtered = workspace.spaces.filter((space) => {
      if (roleFilter !== "all" && space.role !== roleFilter) return false;
      if (statusFilter !== "all" && space.status !== statusFilter) return false;
      if (!normalizedQuery) return true;
      return [space.name, space.description, space.ownerLabel, space.visibility, portalVisibilityLabel(space.visibility, t), space.projectKey, space.datasetLabel]
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
  const effectiveNamingMode = canUseNamedBucket ? newNamingMode : "generic_uuid";

  const handleCreate = async () => {
    if (!accountIdForApi || !newName.trim()) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const created = await createPortalStorageSpace(accountIdForApi, {
        name: newName.trim(),
        naming_mode: effectiveNamingMode,
        description: newDescription.trim() || null,
        visibility: newVisibility,
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
        visibility: importVisibility,
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
          <div className={cx("grid gap-3", canUseNamedBucket ? "lg:grid-cols-[180px_1fr_1.5fr_160px_auto]" : "lg:grid-cols-[1fr_1.5fr_160px_auto]")}>
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
            <select className="ui-control h-9 py-1.5 text-xs" value={newVisibility} onChange={(event) => setNewVisibility(event.target.value as PortalStorageSpaceVisibility)} aria-label={t({ en: "Storage Space visibility", fr: "Visibilité de l'espace de stockage", de: "Sichtbarkeit des Speicherbereichs" })}>
              <option value="private">{portalVisibilityLabel("private", t)}</option>
              <option value="shared">{portalVisibilityLabel("shared", t)}</option>
            </select>
            <UiButton disabled={!newName.trim() || createBusy} onClick={handleCreate} className="h-9 px-3 py-1.5">
              {createBusy ? t({ en: "Creating...", fr: "Création...", de: "Wird erstellt..." }) : t({ en: "Create", fr: "Créer", de: "Erstellen" })}
            </UiButton>
          </div>
          {createError ? <div className="mt-3 text-xs font-semibold text-rose-600 dark:text-rose-300">{createError}</div> : null}
        </UiCard>
      ) : null}

      {showImport ? (
        <UiCard title={t({ en: "Add existing storage", fr: "Ajouter un stockage existant", de: "Vorhandenen Speicher hinzufügen" })}>
          <div className="grid gap-3 lg:grid-cols-[1fr_1.5fr_160px_auto]">
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
            <select className="ui-control h-9 py-1.5 text-xs" value={importVisibility} onChange={(event) => setImportVisibility(event.target.value as PortalStorageSpaceVisibility)} aria-label={t({ en: "Imported Storage Space visibility", fr: "Visibilité de l'espace importé", de: "Sichtbarkeit des importierten Speicherbereichs" })}>
              <option value="private">{portalVisibilityLabel("private", t)}</option>
              <option value="shared">{portalVisibilityLabel("shared", t)}</option>
            </select>
            <UiButton disabled={!importBucketName.trim() || importBusy} onClick={handleImport} className="h-9 px-3 py-1.5">
              {importBusy ? t({ en: "Adding...", fr: "Ajout...", de: "Wird hinzugefügt..." }) : t({ en: "Add", fr: "Ajouter", de: "Hinzufügen" })}
            </UiButton>
          </div>
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
            <option value="-object_count">{t({ en: "Objects", fr: "Objets", de: "Objekte" })}</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="ui-data-table min-w-[840px]">
            <thead>
              <tr>
                <th>{t({ en: "Name", fr: "Nom", de: "Name" })}</th>
                <th>{t({ en: "Visibility", fr: "Visibilité", de: "Sichtbarkeit" })}</th>
                <th>{t({ en: "Objects", fr: "Objets", de: "Objekte" })}</th>
                <th>{t({ en: "Size", fr: "Taille", de: "Größe" })}</th>
                <th>{t({ en: "Created", fr: "Créé", de: "Erstellt" })}</th>
                <th>{t({ en: "Region", fr: "Région", de: "Region" })}</th>
                <th className="text-right">{t({ en: "Action", fr: "Action", de: "Aktion" })}</th>
              </tr>
            </thead>
            <tbody>
              {filteredSpaces.map((space) => {
                const status = visibleStatus(space);
                return (
                  <tr key={space.id}>
                    <td>
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
                    <td>
                      <div className="flex flex-wrap items-center gap-2">
                        <UiBadge tone={portalVisibilityTone(space.visibility)}>{portalVisibilityLabel(space.visibility, t)}</UiBadge>
                        {status ? <UiBadge tone={portalStorageSpaceStatusTone(space)}>{portalStatusLabel(status as "Active" | "Attention" | "Archived", t)}</UiBadge> : null}
                      </div>
                    </td>
                    <td>{formatCompactNumber(space.objectCount)}</td>
                    <td>{formatBytes(space.usedBytes)}</td>
                    <td>{space.createdLabel}</td>
                    <td>{space.region}</td>
                    <td className="text-right"><Link to={storageSpacePath(space)}>{t({ en: "Open", fr: "Ouvrir", de: "Öffnen" })}</Link></td>
                  </tr>
                );
              })}
              {filteredSpaces.length === 0 ? (
                <tr>
                  <td colSpan={7} className={cx("py-6 text-center text-xs font-semibold", uiMutedTextClass)}>
                    {t({ en: "No Storage Spaces to display.", fr: "Aucun espace de stockage à afficher.", de: "Keine Speicherbereiche zum Anzeigen." })}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className={cx("mt-4 flex items-center justify-between text-[11px] font-semibold", uiMutedTextClass)}>
          <span>{filteredSpaces.length} of {workspace.spaces.length}</span>
        </div>
      </UiCard>
    </div>
  );
}
