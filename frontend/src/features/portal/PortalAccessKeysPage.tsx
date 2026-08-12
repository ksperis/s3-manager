/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  createPortalAccessKey,
  deletePortalAccessKey,
  fetchPortalAccessKeysState,
  listPortalStorageSpaces,
  updatePortalAccessKeyStatus,
  type PortalAccessKey,
  type PortalAccessKeyCreate,
  type PortalAccessKeysState,
  type PortalStorageSpaceSummary,
} from "../../api/portal";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import Modal from "../../components/Modal";
import WorkflowPage, { WorkflowActions, workflowPageHostClass } from "../../components/WorkflowPage";
import OneTimeSecretPanel from "../../components/OneTimeSecretPanel";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import ListPageSection from "../../components/list/ListPageSection";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import UiButton from "../../components/ui/UiButton";
import UiDetails from "../../components/ui/UiDetails";
import { cx, uiInputClass, uiLabelClass, uiMutedTextClass, uiPanelMutedClass, uiRadioClass, uiTitleTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { usePortalAccountContext } from "./PortalAccountContext";
import {
  buildCyberduckBookmark,
  buildGenericConnectionSheet,
  buildRcloneConfig,
  buildWinScpProfile,
  bucketNameForPortalExternalTool,
  parsePortalExternalToolEndpoint,
  portalExternalToolBaseFilename,
  portalExternalToolPermissionLabel,
  portalExternalToolRcloneRemoteName,
  portalExternalToolRcloneSecretEnvironmentVariable,
  storageSpaceNameForPortalExternalTool,
  triggerPortalExternalToolDownload,
  type PortalExternalToolConnection,
} from "./portalExternalToolAccess";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import { portalAccessKeyStatusLabel, portalDateTimeLabel } from "./portalI18n";
import PortalPageTabs, { PortalTabPanel } from "./PortalPageTabs";

type PendingAccessKeyAction =
  | { type: "disable"; key: PortalAccessKey }
  | { type: "delete"; key: PortalAccessKey }
  | { type: "export-secret"; key: PortalAccessKey };

type AccessKeysTab = "connect" | "access-list";
type CreateTarget = "self" | "external";
type ExternalPermission = "read_only" | "read_write";

function keyTargetLabel(key: PortalAccessKey, t: ReturnType<typeof useI18n>["t"]): string {
  if (key.target_type === "external") {
    return key.external_email || t({ en: "External user", fr: "Utilisateur externe", de: "Externer Benutzer" });
  }
  return t({ en: "Myself", fr: "Moi-même", de: "Ich selbst" });
}

function keyScopeLabel(key: PortalAccessKey, t: ReturnType<typeof useI18n>["t"]): string {
  if (key.target_type === "external") {
    const permission = key.permission === "read_write"
      ? t({ en: "Read/write", fr: "Lecture/écriture", de: "Lesen/Schreiben" })
      : t({ en: "Read only", fr: "Lecture seule", de: "Nur lesen" });
    return key.storage_space_name ? `${key.storage_space_name} · ${permission}` : permission;
  }
  return t({ en: "Portal grants", fr: "Droits Portal", de: "Portal-Berechtigungen" });
}

function keyPermissionLabel(key: PortalAccessKey, t: ReturnType<typeof useI18n>["t"]): string {
  if (key.permission === "read_write") {
    return t({ en: "Read/write", fr: "Lecture/écriture", de: "Lesen/Schreiben" });
  }
  return t({ en: "Read only", fr: "Lecture seule", de: "Nur lesen" });
}

function keyCreatedDateLabel(createdAt: string | null | undefined, locale: string): string | null {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" }).format(date);
}

function keyConnectionLabel(
  key: PortalAccessKey,
  locale: string,
  t: ReturnType<typeof useI18n>["t"]
): string {
  if (key.target_type === "external") {
    return [
      key.external_email || t({ en: "External user", fr: "Utilisateur externe", de: "Externer Benutzer" }),
      key.storage_space_name,
      keyPermissionLabel(key, t),
    ].filter(Boolean).join(" · ");
  }
  const createdDate = keyCreatedDateLabel(key.created_at, locale);
  const createdLabel = createdDate
    ? t({ en: `created ${createdDate}`, fr: `créé le ${createdDate}`, de: `erstellt am ${createdDate}` })
    : null;
  const suffix = key.access_key_id.length > 4 ? `…${key.access_key_id.slice(-4)}` : key.access_key_id;
  return [keyTargetLabel(key, t), createdLabel, suffix].filter(Boolean).join(" · ");
}

function isOwnerStorageSpace(space: PortalStorageSpaceSummary): boolean {
  return (space.role === "Owner" || space.role === "Manager") && !space.archived_at;
}

export default function PortalAccessKeysPage() {
  const { locale, t } = useI18n();
  const [searchParams] = useSearchParams();
  const { accountIdForApi, hasAccountContext, loading: accountLoading, error: accountError } = usePortalAccountContext();
  const [state, setState] = useState<PortalAccessKeysState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<PortalAccessKey | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAccessKeyAction | null>(null);
  const [activeTab, setActiveTab] = useState<AccessKeysTab>("access-list");
  const [createWizardOpen, setCreateWizardOpen] = useState(false);
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const [createTarget, setCreateTarget] = useState<CreateTarget>("self");
  const [externalEmail, setExternalEmail] = useState("");
  const [externalPermission, setExternalPermission] = useState<ExternalPermission>("read_only");
  const [selectedSpaceId, setSelectedSpaceId] = useState("");
  const [storageSpaces, setStorageSpaces] = useState<PortalStorageSpaceSummary[]>([]);
  const [storageSpacesLoading, setStorageSpacesLoading] = useState(false);
  const [storageSpacesError, setStorageSpacesError] = useState<string | null>(null);
  const [connectionSpaces, setConnectionSpaces] = useState<PortalStorageSpaceSummary[]>([]);
  const [connectionSpacesLoading, setConnectionSpacesLoading] = useState(false);
  const [connectionSpacesError, setConnectionSpacesError] = useState<string | null>(null);
  const [connectionKeyId, setConnectionKeyId] = useState("");
  const [connectionSpaceId, setConnectionSpaceId] = useState("");
  const [connectionCopyMessage, setConnectionCopyMessage] = useState<string | null>(null);
  const [queryCreateHandled, setQueryCreateHandled] = useState(false);

  const requestedSpaceId = searchParams.get("space_id") ?? "";
  const requestedCreateTarget = searchParams.get("create") ?? "";

  const loadKeys = useCallback(async () => {
    if (!hasAccountContext || !accountIdForApi) {
      setState(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPortalAccessKeysState(accountIdForApi);
      setState(data);
    } catch (err) {
      console.error(err);
      setState(null);
      setError(extractApiError(err, t({ en: "Unable to load tool access.", fr: "Impossible de charger les accès outil.", de: "Werkzeugzugriff kann nicht geladen werden." })));
    } finally {
      setLoading(false);
    }
  }, [accountIdForApi, hasAccountContext, t]);

  useEffect(() => {
    setCreatedKey(null);
    setActionMessage(null);
    void loadKeys();
  }, [loadKeys]);

  const loadStorageSpacesForWizard = useCallback(async () => {
    if (!accountIdForApi) return;
    setStorageSpacesLoading(true);
    setStorageSpacesError(null);
    try {
      const spaces = await listPortalStorageSpaces(accountIdForApi, { sort: "name" });
      const ownerSpaces = spaces.filter(isOwnerStorageSpace);
      setStorageSpaces(ownerSpaces);
      setSelectedSpaceId((current) => {
        if (current && ownerSpaces.some((space) => space.id === current)) {
          return current;
        }
        const requested = ownerSpaces.find(
          (space) => space.id === requestedSpaceId || space.internal_bucket_name === requestedSpaceId
        );
        if (requested) return requested.id;
        return ownerSpaces[0]?.id || "";
      });
    } catch (err) {
      console.error(err);
      setStorageSpaces([]);
      setSelectedSpaceId("");
      setStorageSpacesError(extractApiError(err, t({ en: "Unable to load spaces.", fr: "Impossible de charger les espaces.", de: "Bereiche können nicht geladen werden." })));
    } finally {
      setStorageSpacesLoading(false);
    }
  }, [accountIdForApi, requestedSpaceId, t]);

  useEffect(() => {
    if (!createWizardOpen || createTarget !== "external") return;
    void loadStorageSpacesForWizard();
  }, [createTarget, createWizardOpen, loadStorageSpacesForWizard]);

  const loadConnectionSpaces = useCallback(async () => {
    if (!accountIdForApi) return;
    setConnectionSpacesLoading(true);
    setConnectionSpacesError(null);
    try {
      const spaces = await listPortalStorageSpaces(accountIdForApi, { sort: "name" });
      const activeSpaces = spaces.filter((space) => !space.archived_at);
      setConnectionSpaces(activeSpaces);
      setConnectionSpaceId((current) => {
        if (current && activeSpaces.some((space) => space.id === current || space.internal_bucket_name === current)) {
          return current;
        }
        const requested = activeSpaces.find(
          (space) => space.id === requestedSpaceId || space.internal_bucket_name === requestedSpaceId
        );
        return requested?.id || activeSpaces[0]?.id || "";
      });
    } catch (err) {
      console.error(err);
      setConnectionSpaces([]);
      setConnectionSpaceId("");
      setConnectionSpacesError(extractApiError(err, t({ en: "Unable to load spaces.", fr: "Impossible de charger les espaces.", de: "Bereiche können nicht geladen werden." })));
    } finally {
      setConnectionSpacesLoading(false);
    }
  }, [accountIdForApi, requestedSpaceId, t]);

  useEffect(() => {
    if (!state || !hasAccountContext || !accountIdForApi) return;
    void loadConnectionSpaces();
  }, [accountIdForApi, hasAccountContext, loadConnectionSpaces, state]);

  const visibleKeys = useMemo(() => {
    const keys = (state?.access_keys ?? []).filter((key) => !key.is_portal);
    if (createdKey && !createdKey.is_portal && !keys.some((key) => key.access_key_id === createdKey.access_key_id)) {
      return [createdKey, ...keys];
    }
    return keys;
  }, [createdKey, state?.access_keys]);
  const activeKeys = useMemo(() => visibleKeys.filter((key) => key.is_active), [visibleKeys]);
  const personalKeys = useMemo(
    () => visibleKeys.filter((key) => key.target_type !== "external"),
    [visibleKeys]
  );
  const canManageAccessKeys = Boolean(state?.can_manage_access_keys);
  const maxAccessKeys = state?.max_access_keys ?? 0;
  const personalAccessLimitReached = maxAccessKeys > 0 && personalKeys.length >= maxAccessKeys;
  const tableStatus = resolveListTableStatus({ loading, error, rowCount: visibleKeys.length });
  const selectedSpace = useMemo(
    () => storageSpaces.find((space) => space.id === selectedSpaceId) ?? null,
    [selectedSpaceId, storageSpaces]
  );
  const selectedConnectionKey = useMemo(
    () => activeKeys.find((key) => key.access_key_id === connectionKeyId) ?? activeKeys[0] ?? null,
    [activeKeys, connectionKeyId]
  );
  const selectedConnectionKeyBucket = selectedConnectionKey?.target_type === "external"
    ? bucketNameForPortalExternalTool(selectedConnectionKey, null)
    : "";
  const selectedConnectionSpace = useMemo(() => {
    const matchValue = selectedConnectionKeyBucket || connectionSpaceId;
    return (
      connectionSpaces.find((space) => space.id === matchValue || space.internal_bucket_name === matchValue) ??
      connectionSpaces[0] ??
      null
    );
  }, [connectionSpaceId, connectionSpaces, selectedConnectionKeyBucket]);
  const selectedConnectionBucketName = bucketNameForPortalExternalTool(selectedConnectionKey, selectedConnectionSpace);
  const selectedConnection: PortalExternalToolConnection | null = selectedConnectionKey && selectedConnectionBucketName
    ? {
        key: selectedConnectionKey,
        endpoint: parsePortalExternalToolEndpoint(state?.s3_endpoint),
        forcePathStyle: Boolean(state?.force_path_style),
        storageSpaceName: storageSpaceNameForPortalExternalTool(selectedConnectionKey, selectedConnectionSpace),
        bucketName: selectedConnectionBucketName,
        permissionLabel: portalExternalToolPermissionLabel(selectedConnectionKey.permission),
      }
    : null;
  const selectedConnectionHasOneTimeSecret = Boolean(
    createdKey?.secret_access_key && selectedConnectionKey?.access_key_id === createdKey.access_key_id
  );
  const canExportOneTimeExternalCredentials = Boolean(
    state && createdKey?.target_type === "external" && selectedConnectionHasOneTimeSecret && selectedConnection
  );
  const connectionEndpointLabel = selectedConnection?.endpoint?.original || state?.s3_endpoint || t({ en: "Configured storage service", fr: "Service de stockage configuré", de: "Konfigurierter Speicherdienst" });
  const setupFileUnavailable = Boolean(selectedConnection && !selectedConnection.endpoint);
  const selectedConnectionNeedsSpace = Boolean(selectedConnectionKey && !selectedConnectionKeyBucket);
  const selectedConnectionHasNoSpace =
    selectedConnectionNeedsSpace &&
    !connectionSpacesLoading &&
    !connectionSpacesError &&
    connectionSpaces.length === 0;
  const rcloneRemoteName = selectedConnection ? portalExternalToolRcloneRemoteName(selectedConnection) : "remote";
  const rcloneSecretEnvironmentVariable = selectedConnection
    ? portalExternalToolRcloneSecretEnvironmentVariable(selectedConnection)
    : "RCLONE_CONFIG_REMOTE_SECRET_ACCESS_KEY";

  useEffect(() => {
    if (!selectedConnectionKey && activeKeys[0]) {
      setConnectionKeyId(activeKeys[0].access_key_id);
    }
  }, [activeKeys, selectedConnectionKey]);

  useEffect(() => {
    if (!selectedConnectionKeyBucket) {
      setConnectionSpaceId((current) => {
        if (connectionSpaces.some((space) => space.id === current || space.internal_bucket_name === current)) {
          return current;
        }
        return connectionSpaces[0]?.id || "";
      });
      return;
    }
    const matchingSpace = connectionSpaces.find(
      (space) => space.id === selectedConnectionKeyBucket || space.internal_bucket_name === selectedConnectionKeyBucket
    );
    setConnectionSpaceId(matchingSpace?.id || selectedConnectionKeyBucket);
  }, [connectionSpaces, selectedConnectionKeyBucket]);

  useEffect(() => {
    if (
      queryCreateHandled ||
      requestedCreateTarget !== "external" ||
      !state ||
      !canManageAccessKeys ||
      !requestedSpaceId
    ) {
      return;
    }
    setCreateTarget("external");
    setSelectedSpaceId(requestedSpaceId);
    setStorageSpacesError(null);
    setCreateWizardOpen(true);
    setQueryCreateHandled(true);
  }, [canManageAccessKeys, queryCreateHandled, requestedCreateTarget, requestedSpaceId, state]);

  const openCreateWizard = () => {
    if (createDisabled) return;
    setCreateTarget(personalAccessLimitReached ? "external" : "self");
    setExternalEmail("");
    setExternalPermission("read_only");
    setSelectedSpaceId(storageSpaces[0]?.id || "");
    setStorageSpacesError(null);
    setCreateWizardOpen(true);
  };

  const closeCreateWizard = () => {
    if (busy === "create") return;
    setCreateWizardOpen(false);
  };

  const handleCreateKey = async () => {
    if (!accountIdForApi || !canManageAccessKeys) return;
    if (createTarget === "self" && personalAccessLimitReached) return;
    const payload: PortalAccessKeyCreate =
      createTarget === "external"
        ? {
            target_type: "external",
            storage_space_id: selectedSpaceId,
            external_email: externalEmail.trim(),
            permission: externalPermission,
          }
        : { target_type: "self" };
    if (payload.target_type === "external" && (!payload.storage_space_id || !payload.external_email)) return;
    setBusy("create");
    setError(null);
    setActionMessage(null);
    try {
      const key = await createPortalAccessKey(accountIdForApi, payload);
      setCreatedKey(key);
      setActiveTab("connect");
      setConnectionKeyId(key.access_key_id);
      const createdBucket = bucketNameForPortalExternalTool(key, selectedSpace);
      if (createdBucket) {
        setConnectionSpaceId(createdBucket);
      }
      setActionMessage(
        key.target_type === "external"
          ? t({ en: "External tool access created", fr: "Accès outil externe créé", de: "Externer Werkzeugzugriff erstellt" })
          : t({ en: "Personal tool access created", fr: "Accès outil personnel créé", de: "Persönlicher Werkzeugzugriff erstellt" })
      );
      setCreateWizardOpen(false);
      await loadKeys();
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, t({ en: "Unable to create tool access.", fr: "Impossible de créer l'accès outil.", de: "Werkzeugzugriff kann nicht erstellt werden." })));
    } finally {
      setBusy(null);
    }
  };

  const updateKeyStatus = async (key: PortalAccessKey, active: boolean) => {
    if (!accountIdForApi || !canManageAccessKeys || key.is_portal) return;
    setBusy(`toggle:${key.access_key_id}`);
    setError(null);
    setActionMessage(null);
    try {
      await updatePortalAccessKeyStatus(accountIdForApi, key.access_key_id, active);
      setActionMessage(active ? t({ en: "Tool access enabled", fr: "Accès outil activé", de: "Werkzeugzugriff aktiviert" }) : t({ en: "Tool access disabled", fr: "Accès outil désactivé", de: "Werkzeugzugriff deaktiviert" }));
      setPendingAction(null);
      await loadKeys();
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, t({ en: "Unable to update tool access.", fr: "Impossible de mettre à jour l'accès outil.", de: "Werkzeugzugriff kann nicht aktualisiert werden." })));
      setPendingAction(null);
    } finally {
      setBusy(null);
    }
  };

  const handleToggleKey = (key: PortalAccessKey) => {
    if (!accountIdForApi || !canManageAccessKeys || key.is_portal) return;
    const active = key.is_active;
    if (active) {
      setPendingAction({ type: "disable", key });
      return;
    }
    void updateKeyStatus(key, true);
  };

  const handleDeleteKey = (key: PortalAccessKey) => {
    if (!accountIdForApi || !canManageAccessKeys || key.is_portal) return;
    setPendingAction({ type: "delete", key });
  };

  const confirmDeleteKey = async (key: PortalAccessKey) => {
    if (!accountIdForApi || !canManageAccessKeys || key.is_portal) return;
    setBusy(`delete:${key.access_key_id}`);
    setError(null);
    setActionMessage(null);
    try {
      await deletePortalAccessKey(accountIdForApi, key.access_key_id);
      setActionMessage(t({ en: "Tool access deleted", fr: "Accès outil supprimé", de: "Werkzeugzugriff gelöscht" }));
      setPendingAction(null);
      await loadKeys();
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, t({ en: "Unable to delete tool access.", fr: "Impossible de supprimer l'accès outil.", de: "Werkzeugzugriff kann nicht gelöscht werden." })));
      setPendingAction(null);
    } finally {
      setBusy(null);
    }
  };

  const handleDownloadCyberduckBookmark = () => {
    if (!selectedConnection) return;
    if (!selectedConnection.endpoint) {
      setActionMessage(null);
      setError(t({ en: "Cyberduck bookmark download needs a valid service address.", fr: "Le téléchargement du favori Cyberduck nécessite une adresse de service valide.", de: "Der Cyberduck-Bookmark benötigt eine gültige Serviceadresse." }));
      return;
    }
    const filename = `${portalExternalToolBaseFilename(selectedConnection)}.duck`;
    triggerPortalExternalToolDownload(filename, buildCyberduckBookmark(selectedConnection), "application/xml;charset=utf-8");
    setError(null);
    setActionMessage(t({ en: "Cyberduck bookmark downloaded.", fr: "Favori Cyberduck téléchargé.", de: "Cyberduck-Bookmark heruntergeladen." }));
  };

  const handleDownloadWinScpProfile = () => {
    if (!selectedConnection?.endpoint) return;
    const filename = `${portalExternalToolBaseFilename(selectedConnection)}-winscp.ini`;
    triggerPortalExternalToolDownload(filename, buildWinScpProfile(selectedConnection), "text/plain;charset=utf-8");
    setError(null);
    setActionMessage(t({ en: "WinSCP profile downloaded.", fr: "Profil WinSCP téléchargé.", de: "WinSCP-Profil heruntergeladen." }));
  };

  const handleDownloadRcloneConfig = () => {
    if (!selectedConnection?.endpoint) return;
    const filename = `${portalExternalToolBaseFilename(selectedConnection)}-rclone.conf`;
    triggerPortalExternalToolDownload(filename, buildRcloneConfig(selectedConnection), "text/plain;charset=utf-8");
    setError(null);
    setActionMessage(t({ en: "rclone configuration downloaded.", fr: "Configuration rclone téléchargée.", de: "rclone-Konfiguration heruntergeladen." }));
  };

  const handleDownloadConnectionSheet = (includeSecret: boolean) => {
    if (!selectedConnection) return;
    if (includeSecret && !canExportOneTimeExternalCredentials) return;
    const filename = `${portalExternalToolBaseFilename(selectedConnection)}${includeSecret ? "-unencrypted-credentials" : ""}.txt`;
    const secretAccessKey = includeSecret ? createdKey?.secret_access_key : null;
    triggerPortalExternalToolDownload(
      filename,
      buildGenericConnectionSheet(selectedConnection, { secretAccessKey }),
      "text/plain;charset=utf-8"
    );
    setError(null);
    setActionMessage(
      includeSecret && secretAccessKey
        ? t({
            en: "Unencrypted credentials downloaded. Delete the file after secure transfer.",
            fr: "Identifiants non chiffrés téléchargés. Supprimez le fichier après le transfert sécurisé.",
            de: "Unverschlüsselte Zugangsdaten heruntergeladen. Löschen Sie die Datei nach der sicheren Übertragung.",
          })
        : t({ en: "Connection details downloaded.", fr: "Détails de connexion téléchargés.", de: "Verbindungsdetails heruntergeladen." })
    );
  };

  const closeConnectionDialog = () => {
    setConnectionCopyMessage(null);
    setConnectionDialogOpen(false);
  };

  const openConnectionDialog = (key?: PortalAccessKey) => {
    if (key) setConnectionKeyId(key.access_key_id);
    setConnectionCopyMessage(null);
    setConnectionDialogOpen(true);
  };

  const handleCopyConnectionValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setConnectionCopyMessage(t({ en: "Value copied.", fr: "Valeur copiée.", de: "Wert kopiert." }));
    } catch {
      setConnectionCopyMessage(t({ en: "Unable to copy this value.", fr: "Impossible de copier cette valeur.", de: "Dieser Wert kann nicht kopiert werden." }));
    }
  };

  const createDisabled = !state || !canManageAccessKeys || Boolean(busy);
  const createWizardSubmitDisabled =
    busy === "create" ||
    !accountIdForApi ||
    (createTarget === "self" && personalAccessLimitReached) ||
    (createTarget === "external" &&
      (!selectedSpaceId || !externalEmail.trim() || storageSpacesLoading || Boolean(storageSpacesError)));
  const accessKeyColumns: DataTableColumn<PortalAccessKey>[] = [
    {
      id: "access-key",
      label: t({ en: "Access ID", fr: "ID d'accès", de: "Zugriffs-ID" }),
      primary: true,
      cellClassName: "max-w-[18rem] break-all font-mono",
      render: (key) => key.access_key_id,
    },
    {
      id: "status",
      label: t({ en: "Status", fr: "Statut", de: "Status" }),
      cellClassName: "text-slate-700 dark:text-slate-200",
      render: (key) => portalAccessKeyStatusLabel(key.is_active, t),
    },
    {
      id: "target",
      label: t({ en: "Recipient", fr: "Destinataire", de: "Empfänger" }),
      cellClassName: "min-w-[10rem]",
      render: (key) => keyTargetLabel(key, t),
    },
    {
      id: "scope",
      label: t({ en: "Scope", fr: "Périmètre", de: "Umfang" }),
      cellClassName: "min-w-[12rem]",
      render: (key) => keyScopeLabel(key, t),
    },
    {
      id: "created",
      label: t({ en: "Created on", fr: "Créée le", de: "Erstellt am" }),
      render: (key) => portalDateTimeLabel(key.created_at, locale),
    },
    {
      id: "actions",
      label: t({ en: "Actions", fr: "Actions", de: "Aktionen" }),
      align: "right",
      mobileRole: "actions",
      render: (key) => {
        const active = key.is_active;
        const disabled = Boolean(busy) || !canManageAccessKeys;
        return (
          <div className="flex flex-wrap justify-end gap-2">
            {active ? (
              <button
                type="button"
                onClick={() => openConnectionDialog(key)}
                className={tableActionButtonClasses}
                disabled={Boolean(busy)}
                aria-label={`${t({ en: "Connect", fr: "Connecter", de: "Verbinden" })} ${keyConnectionLabel(key, locale, t)}`}
              >
                {t({ en: "Connect", fr: "Connecter", de: "Verbinden" })}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => handleToggleKey(key)}
              className={tableActionButtonClasses}
              disabled={disabled}
            >
              {busy === `toggle:${key.access_key_id}`
                ? t({ en: "Saving...", fr: "Enregistrement...", de: "Wird gespeichert..." })
                : active
                  ? t({ en: "Disable", fr: "Désactiver", de: "Deaktivieren" })
                  : t({ en: "Enable", fr: "Activer", de: "Aktivieren" })}
            </button>
            <button
              type="button"
              onClick={() => handleDeleteKey(key)}
              className={tableDeleteActionClasses}
              disabled={disabled}
            >
              {busy === `delete:${key.access_key_id}` ? t({ en: "Deleting...", fr: "Suppression...", de: "Wird gelöscht..." }) : t({ en: "Delete", fr: "Supprimer", de: "Löschen" })}
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div className={workflowPageHostClass(createWizardOpen)}>
      <PageHeader
        title={t({ en: "External S3 tools", fr: "Outils S3 externes", de: "Externe S3-Werkzeuge" })}
        description={t({
          en: "Create S3 credentials for a desktop app, script, or external partner. Keep each access limited to the right space.",
          fr: "Créez des identifiants S3 pour une application de bureau, un script ou un partenaire externe. Limitez chaque accès au bon espace.",
          de: "Erstellen Sie S3-Zugangsdaten für Desktop-Apps, Skripte oder externe Partner. Begrenzen Sie jeden Zugriff auf den passenden Bereich.",
        })}
        breadcrumbs={portalBreadcrumbs({
          label: t({ en: "External tools", fr: "Outils externes", de: "Externe Werkzeuge" }),
        })}
        actions={[
          {
            label: busy === "create" ? t({ en: "Creating...", fr: "Création...", de: "Wird erstellt..." }) : t({ en: "New tool access", fr: "Nouvel accès outil", de: "Neuer Werkzeugzugriff" }),
            onClick: openCreateWizard,
            variant: "primary",
            disabled: createDisabled,
          },
        ]}
      />

      {accountError && <PageBanner tone="error">{accountError}</PageBanner>}
      {error && <PageBanner tone="error">{error}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {state && !canManageAccessKeys && (
        <PageBanner tone="warning">{t({ en: "External-tool access is disabled for this project.", fr: "L'accès aux outils externes est désactivé pour ce projet.", de: "Der Zugriff für externe Werkzeuge ist für dieses Projekt deaktiviert." })}</PageBanner>
      )}
      <PortalPageTabs
        tabs={[
          {
            id: "access-list",
            label: t({
              en: `Tool access (${visibleKeys.length})`,
              fr: `Accès outil (${visibleKeys.length})`,
              de: `Werkzeugzugriff (${visibleKeys.length})`,
            }),
          },
          {
            id: "connect",
            label: t({ en: "Connect tool", fr: "Connecter un outil", de: "Werkzeug verbinden" }),
          },
        ]}
        activeTab={activeTab}
        onChange={(tabId) => setActiveTab(tabId as AccessKeysTab)}
        ariaLabel={t({
          en: "External tool access views",
          fr: "Vues des accès aux outils externes",
          de: "Ansichten für externen Werkzeugzugriff",
        })}
        idPrefix="portal-tool-access"
      />

      {activeTab === "connect" ? (
        <PortalTabPanel idPrefix="portal-tool-access" tabId="connect" className="space-y-4">
          {createdKey?.secret_access_key && (
            <div className="space-y-3">
              <OneTimeSecretPanel
                title={
                  createdKey.target_type === "external"
                    ? t({ en: "External tool access created", fr: "Accès outil externe créé", de: "Externer Werkzeugzugriff erstellt" })
                    : t({ en: "Personal tool access created", fr: "Accès outil personnel créé", de: "Persönlicher Werkzeugzugriff erstellt" })
                }
                description={
                  createdKey.target_type === "external"
                    ? t({ en: "The secret is shown only once and is limited to the selected space.", fr: "Le secret n'est affiché qu'une seule fois et reste limité à l'espace sélectionné.", de: "Das Secret wird nur einmal angezeigt und bleibt auf den ausgewählten Bereich beschränkt." })
                    : t({ en: "The secret is shown only once.", fr: "Le secret n'est affiché qu'une seule fois.", de: "Das Secret wird nur einmal angezeigt." })
                }
                badge={t({ en: "Copy these values now", fr: "Copiez ces valeurs maintenant", de: "Diese Werte jetzt kopieren" })}
                actions={
                  <UiButton
                    type="button"
                    size="xs"
                    onClick={() => openConnectionDialog(createdKey)}
                    disabled={!state || !hasAccountContext}
                  >
                    {t({ en: "Configure this access", fr: "Configurer cet accès", de: "Diesen Zugriff konfigurieren" })}
                  </UiButton>
                }
                values={[
                  {
                    label: t({ en: "Access ID", fr: "ID d'accès", de: "Zugriffs-ID" }),
                    value: createdKey.access_key_id,
                    copyLabel: t({ en: "Copy Access ID", fr: "Copier l'ID d'accès", de: "Zugriffs-ID kopieren" }),
                  },
                  {
                    label: t({ en: "Secret key", fr: "Clé secrète", de: "Geheimer Schlüssel" }),
                    value: createdKey.secret_access_key,
                    copyLabel: t({ en: "Copy secret key", fr: "Copier la clé secrète", de: "Geheimen Schlüssel kopieren" }),
                  },
                ]}
              />

              {canExportOneTimeExternalCredentials ? (
                <UiDetails className={cx("group", uiPanelMutedClass)}>
                  <summary className="cursor-pointer px-3 py-3 ui-caption font-semibold text-[var(--ui-text)]">
                    {t({
                      en: "Advanced: prepare credentials for secure transfer",
                      fr: "Avancé : préparer les identifiants pour un transfert sécurisé",
                      de: "Erweitert: Zugangsdaten für eine sichere Übertragung vorbereiten",
                    })}
                  </summary>
                  <div className="space-y-3 border-t border-[color:var(--ui-border-soft)] px-3 py-3">
                    <p className={cx("ui-caption", uiMutedTextClass)}>
                      {t({
                        en: "Use this only when you must send this access to its recipient through a secure channel. The exported text file contains the unencrypted secret.",
                        fr: "Utilisez cette option uniquement si vous devez transmettre cet accès à son destinataire par un canal sécurisé. Le fichier texte exporté contient la clé secrète non chiffrée.",
                        de: "Verwenden Sie diese Option nur, wenn Sie diesen Zugriff über einen sicheren Kanal an den Empfänger senden müssen. Die exportierte Textdatei enthält das unverschlüsselte Secret.",
                      })}
                    </p>
                    <UiButton
                      type="button"
                      variant="warning"
                      size="xs"
                      onClick={() => setPendingAction({ type: "export-secret", key: createdKey })}
                    >
                      {t({
                        en: "Export unencrypted credentials (.txt)",
                        fr: "Exporter les identifiants non chiffrés (.txt)",
                        de: "Unverschlüsselte Zugangsdaten exportieren (.txt)",
                      })}
                    </UiButton>
                  </div>
                </UiDetails>
              ) : null}
            </div>
          )}

          {state && hasAccountContext ? (
            <section className="ui-surface-card p-4" aria-labelledby="portal-external-tool-access">
              <h2 id="portal-external-tool-access" className={cx("text-sm font-bold", uiTitleTextClass)}>
                {t({ en: "Connect a tool", fr: "Connecter un outil", de: "Werkzeug verbinden" })}
              </h2>
              <p className={cx("mt-1 max-w-2xl ui-caption", uiMutedTextClass)}>
                {t({
                  en: "Choose the application you use and download its ready-to-import configuration.",
                  fr: "Choisissez l'application que vous utilisez et téléchargez sa configuration prête à importer.",
                  de: "Wählen Sie Ihre Anwendung und laden Sie die importfertige Konfiguration herunter.",
                })}
              </p>
              <UiButton type="button" className="mt-4" onClick={() => openConnectionDialog()}>
                {t({ en: "Configure a tool", fr: "Configurer un outil", de: "Werkzeug konfigurieren" })}
              </UiButton>
            </section>
          ) : null}
        </PortalTabPanel>
      ) : null}

      {connectionDialogOpen && state && hasAccountContext ? (
        <Modal
          title={t({ en: "Connect a tool", fr: "Connecter un outil", de: "Werkzeug verbinden" })}
          onClose={closeConnectionDialog}
          maxWidthClass="max-w-4xl"
          closeLabel={t({ en: "Close", fr: "Fermer", de: "Schließen" })}
          closeAriaLabel={t({ en: "Close modal", fr: "Fermer la fenêtre", de: "Dialog schließen" })}
        >
          <div className="space-y-5">
            {activeKeys.length === 0 ? (
              <PageEmptyState
                eyebrow={t({ en: "Access required", fr: "Accès requis", de: "Zugriff erforderlich" })}
                title={t({ en: "Create an active tool access first", fr: "Créez d'abord un accès outil actif", de: "Erstellen Sie zuerst einen aktiven Werkzeugzugriff" })}
                description={t({
                  en: "The configuration identifies which permissions the application will use.",
                  fr: "La configuration doit indiquer quels droits l'application utilisera.",
                  de: "Die Konfiguration muss festlegen, welche Berechtigungen die Anwendung verwendet.",
                })}
                primaryAction={canManageAccessKeys ? {
                  label: t({ en: "Create tool access", fr: "Créer un accès outil", de: "Werkzeugzugriff erstellen" }),
                  onClick: () => {
                    closeConnectionDialog();
                    openCreateWizard();
                  },
                } : undefined}
              />
            ) : (
              <>
                <section className="space-y-3" aria-labelledby="portal-tool-connection-section">
                  <h3 id="portal-tool-connection-section" className={cx("ui-body font-semibold", uiTitleTextClass)}>
                    {t({ en: "Connection", fr: "Connexion", de: "Verbindung" })}
                  </h3>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1">
                      <span className={uiLabelClass}>{t({ en: "Access used", fr: "Accès utilisé", de: "Verwendeter Zugriff" })}</span>
                      <select
                        className={uiInputClass}
                        value={selectedConnectionKey?.access_key_id ?? ""}
                        onChange={(event) => setConnectionKeyId(event.target.value)}
                      >
                        {activeKeys.map((key) => (
                          <option key={key.access_key_id} value={key.access_key_id}>
                            {keyConnectionLabel(key, locale, t)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedConnectionKeyBucket ? (
                      <div className="space-y-1">
                        <span className={uiLabelClass}>{t({ en: "Space", fr: "Space", de: "Space" })}</span>
                        <p className={cx("min-h-10 rounded-lg border px-3 py-2 ui-body", uiPanelMutedClass, uiTitleTextClass)}>
                          {selectedConnectionKey?.storage_space_name || selectedConnection?.storageSpaceName || selectedConnectionKeyBucket}
                          {" — "}
                          {t({
                            en: "fixed when this access was created",
                            fr: "défini lors de la création de cet accès",
                            de: "bei der Erstellung dieses Zugriffs festgelegt",
                          })}
                        </p>
                      </div>
                    ) : (
                      <label className="space-y-1">
                        <span className={uiLabelClass}>{t({ en: "Space", fr: "Space", de: "Space" })}</span>
                        <select
                          className={uiInputClass}
                          value={connectionSpaceId}
                          onChange={(event) => setConnectionSpaceId(event.target.value)}
                          disabled={connectionSpacesLoading || connectionSpaces.length === 0}
                        >
                          {connectionSpacesLoading ? (
                            <option value="">{t({ en: "Loading...", fr: "Chargement...", de: "Wird geladen..." })}</option>
                          ) : connectionSpaces.length === 0 ? (
                            <option value="">{t({ en: "No Space", fr: "Aucun Space", de: "Kein Space" })}</option>
                          ) : (
                            connectionSpaces.map((space) => (
                              <option key={space.id} value={space.id}>{space.name}</option>
                            ))
                          )}
                        </select>
                      </label>
                    )}
                  </div>
                </section>

                {selectedConnectionNeedsSpace && connectionSpacesError ? (
                  <PageBanner tone="warning">{connectionSpacesError}</PageBanner>
                ) : null}
                {selectedConnectionHasNoSpace ? (
                  <PageEmptyState
                    eyebrow={t({ en: "Space required", fr: "Space requis", de: "Space erforderlich" })}
                    title={t({ en: "Create a Space to continue", fr: "Créez un Space pour continuer", de: "Erstellen Sie einen Space, um fortzufahren" })}
                    description={t({
                      en: "The application needs a Space to use as its initial folder.",
                      fr: "L'application a besoin d'un Space comme dossier initial.",
                      de: "Die Anwendung benötigt einen Space als Startordner.",
                    })}
                    primaryAction={{
                      label: t({ en: "Create a Space", fr: "Créer un Space", de: "Space erstellen" }),
                      to: "/portal/storage-spaces?create=1",
                    }}
                  />
                ) : selectedConnection ? (
                  <>
                    <section className="space-y-3" aria-labelledby="portal-tool-application-section">
                      <div>
                        <h3 id="portal-tool-application-section" className={cx("ui-body font-semibold", uiTitleTextClass)}>
                          {t({ en: "Choose your application", fr: "Choisissez votre application", de: "Wählen Sie Ihre Anwendung" })}
                        </h3>
                        <p className={cx("mt-1 ui-caption", uiMutedTextClass)}>
                          {t({
                            en: "Install the application first if you do not already have it, then import the downloaded file.",
                            fr: "Installez d'abord l'application si nécessaire, puis importez le fichier téléchargé.",
                            de: "Installieren Sie die Anwendung bei Bedarf zuerst und importieren Sie dann die heruntergeladene Datei.",
                          })}
                        </p>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <article className={cx("flex min-h-[220px] flex-col p-4", uiPanelMutedClass)}>
                          <div>
                            <h4 className={cx("ui-body font-semibold", uiTitleTextClass)}>Cyberduck / Mountain Duck</h4>
                            <p className={cx("mt-1 ui-caption font-semibold", uiMutedTextClass)}>
                              {t({ en: "macOS and Windows", fr: "macOS et Windows", de: "macOS und Windows" })}
                            </p>
                            <p className={cx("mt-2 ui-caption", uiMutedTextClass)}>
                              {t({
                                en: "Browse files or mount the Space like a disk.",
                                fr: "Parcourez les fichiers ou montez le Space comme un disque.",
                                de: "Durchsuchen Sie Dateien oder binden Sie den Space wie ein Laufwerk ein.",
                              })}
                            </p>
                            <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 ui-caption">
                              <a
                                className="font-semibold text-primary hover:underline dark:text-primary-200"
                                href="https://cyberduck.io/download/"
                                target="_blank"
                                rel="noreferrer"
                                aria-label={t({ en: "Install Cyberduck from the official site (opens in a new tab)", fr: "Installer Cyberduck depuis le site officiel (s'ouvre dans un nouvel onglet)", de: "Cyberduck von der offiziellen Website installieren (öffnet einen neuen Tab)" })}
                              >
                                {t({ en: "Install Cyberduck", fr: "Installer Cyberduck", de: "Cyberduck installieren" })}
                              </a>
                              <a
                                className="font-semibold text-primary hover:underline dark:text-primary-200"
                                href="https://mountainduck.io/"
                                target="_blank"
                                rel="noreferrer"
                                aria-label={t({ en: "Install Mountain Duck from the official site (opens in a new tab)", fr: "Installer Mountain Duck depuis le site officiel (s'ouvre dans un nouvel onglet)", de: "Mountain Duck von der offiziellen Website installieren (öffnet einen neuen Tab)" })}
                              >
                                {t({ en: "Install Mountain Duck", fr: "Installer Mountain Duck", de: "Mountain Duck installieren" })}
                              </a>
                            </p>
                          </div>
                          <UiButton
                            type="button"
                            className="mt-auto self-start"
                            variant="secondary"
                            onClick={handleDownloadCyberduckBookmark}
                            disabled={setupFileUnavailable}
                            aria-label={`${t({ en: "Download Cyberduck or Mountain Duck configuration (.duck) for", fr: "Télécharger la configuration Cyberduck ou Mountain Duck (.duck) pour", de: "Cyberduck- oder Mountain-Duck-Konfiguration (.duck) herunterladen für" })} ${selectedConnection.storageSpaceName}`}
                          >
                            {t({ en: "Download configuration (.duck)", fr: "Télécharger la configuration (.duck)", de: "Konfiguration herunterladen (.duck)" })}
                          </UiButton>
                        </article>
                        <article className={cx("flex min-h-[220px] flex-col p-4", uiPanelMutedClass)}>
                          <div>
                            <h4 className={cx("ui-body font-semibold", uiTitleTextClass)}>WinSCP</h4>
                            <p className={cx("mt-1 ui-caption font-semibold", uiMutedTextClass)}>Windows</p>
                            <p className={cx("mt-2 ui-caption", uiMutedTextClass)}>
                              {t({
                                en: "Transfer files with a graphical interface.",
                                fr: "Transférez des fichiers avec une interface graphique.",
                                de: "Übertragen Sie Dateien mit einer grafischen Oberfläche.",
                              })}
                            </p>
                            <p className="mt-3 ui-caption">
                              <a
                                className="font-semibold text-primary hover:underline dark:text-primary-200"
                                href="https://winscp.net/eng/download.php"
                                target="_blank"
                                rel="noreferrer"
                                aria-label={t({ en: "Install WinSCP from the official site (opens in a new tab)", fr: "Installer WinSCP depuis le site officiel (s'ouvre dans un nouvel onglet)", de: "WinSCP von der offiziellen Website installieren (öffnet einen neuen Tab)" })}
                              >
                                {t({ en: "Install WinSCP", fr: "Installer WinSCP", de: "WinSCP installieren" })}
                              </a>
                            </p>
                          </div>
                          <UiButton
                            type="button"
                            className="mt-auto self-start"
                            variant="secondary"
                            onClick={handleDownloadWinScpProfile}
                            disabled={setupFileUnavailable}
                            aria-label={`${t({ en: "Download WinSCP profile (.ini) for", fr: "Télécharger le profil WinSCP (.ini) pour", de: "WinSCP-Profil (.ini) herunterladen für" })} ${selectedConnection.storageSpaceName}`}
                          >
                            {t({ en: "Download WinSCP profile (.ini)", fr: "Télécharger le profil WinSCP (.ini)", de: "WinSCP-Profil herunterladen (.ini)" })}
                          </UiButton>
                        </article>
                      </div>
                    </section>

                    {setupFileUnavailable ? (
                      <PageBanner tone="warning">
                        {t({
                          en: "Configuration downloads are unavailable because the storage service address is invalid. Check the manual values or contact an administrator.",
                          fr: "Les téléchargements de configuration sont indisponibles car l'adresse du service de stockage est invalide. Vérifiez les valeurs manuelles ou contactez un administrateur.",
                          de: "Konfigurationsdownloads sind nicht verfügbar, weil die Adresse des Speicherdienstes ungültig ist. Prüfen Sie die manuellen Werte oder wenden Sie sich an einen Administrator.",
                        })}
                      </PageBanner>
                    ) : null}

                    <details className={cx("group p-4", uiPanelMutedClass)}>
                      <summary className={cx("cursor-pointer ui-body font-semibold", uiTitleTextClass)}>
                        {t({ en: "Advanced tools and manual setup", fr: "Outils avancés et configuration manuelle", de: "Erweiterte Werkzeuge und manuelle Einrichtung" })}
                      </summary>
                      <div className="mt-4 space-y-5">
                        <section className="space-y-3" aria-labelledby="portal-rclone-setup">
                          <div>
                            <h4 id="portal-rclone-setup" className={cx("ui-body font-semibold", uiTitleTextClass)}>rclone</h4>
                            <p className={cx("mt-1 ui-caption", uiMutedTextClass)}>
                              {t({ en: "Command line and automation.", fr: "Ligne de commande et automatisation.", de: "Kommandozeile und Automatisierung." })}
                              {" "}
                              <a
                                className="font-semibold text-primary hover:underline dark:text-primary-200"
                                href="https://rclone.org/downloads/"
                                target="_blank"
                                rel="noreferrer"
                                aria-label={t({ en: "Install rclone from the official site (opens in a new tab)", fr: "Installer rclone depuis le site officiel (s'ouvre dans un nouvel onglet)", de: "rclone von der offiziellen Website installieren (öffnet einen neuen Tab)" })}
                              >
                                {t({ en: "Install rclone", fr: "Installer rclone", de: "rclone installieren" })}
                              </a>
                            </p>
                          </div>
                          <div className="grid gap-2 ui-caption">
                            <div>
                              <span className={uiMutedTextClass}>{t({ en: "Secret environment variable", fr: "Variable d'environnement du secret", de: "Umgebungsvariable für das Secret" })}</span>
                              <code className={cx("mt-1 block break-all rounded-md px-2 py-1", uiTitleTextClass)}>{rcloneSecretEnvironmentVariable}</code>
                            </div>
                            <div>
                              <span className={uiMutedTextClass}>{t({ en: "Example command", fr: "Commande d'exemple", de: "Beispielbefehl" })}</span>
                              <code className={cx("mt-1 block break-all rounded-md px-2 py-1", uiTitleTextClass)}>rclone lsd {rcloneRemoteName}:{selectedConnection.bucketName}</code>
                            </div>
                          </div>
                          <UiButton
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={handleDownloadRcloneConfig}
                            disabled={setupFileUnavailable}
                            aria-label={`${t({ en: "Download rclone configuration (.conf) for", fr: "Télécharger la configuration rclone (.conf) pour", de: "rclone-Konfiguration (.conf) herunterladen für" })} ${selectedConnection.storageSpaceName}`}
                          >
                            {t({ en: "Download rclone configuration (.conf)", fr: "Télécharger la configuration rclone (.conf)", de: "rclone-Konfiguration herunterladen (.conf)" })}
                          </UiButton>
                        </section>

                        <section className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700" aria-labelledby="portal-manual-s3-setup">
                          <div>
                            <h4 id="portal-manual-s3-setup" className={cx("ui-body font-semibold", uiTitleTextClass)}>
                              {t({ en: "Other S3-compatible application", fr: "Autre application compatible S3", de: "Andere S3-kompatible Anwendung" })}
                            </h4>
                            <p className={cx("mt-1 ui-caption", uiMutedTextClass)}>
                              {t({
                                en: "Enter the secret in the application when requested. It is never included in these downloads.",
                                fr: "Saisissez le secret dans l'application lorsqu'il est demandé. Il n'est jamais inclus dans ces téléchargements.",
                                de: "Geben Sie das Secret auf Nachfrage in der Anwendung ein. Es ist nie in diesen Downloads enthalten.",
                              })}
                            </p>
                          </div>
                          <dl className="grid gap-3 ui-caption sm:grid-cols-2">
                            {[
                              {
                                label: t({ en: "S3 endpoint", fr: "Endpoint S3", de: "S3-Endpunkt" }),
                                value: connectionEndpointLabel,
                              },
                              {
                                label: t({ en: "Bucket", fr: "Bucket", de: "Bucket" }),
                                value: selectedConnection.bucketName,
                              },
                              {
                                label: t({ en: "Access ID", fr: "ID d'accès", de: "Zugriffs-ID" }),
                                value: selectedConnection.key.access_key_id,
                              },
                            ].map((item) => (
                              <div key={item.label}>
                                <dt className={uiMutedTextClass}>{item.label}</dt>
                                <dd className={cx("mt-1 break-all font-mono font-semibold", uiTitleTextClass)}>{item.value}</dd>
                                <UiButton
                                  type="button"
                                  size="xs"
                                  variant="ghost"
                                  className="mt-1"
                                  onClick={() => void handleCopyConnectionValue(item.value)}
                                  aria-label={`${t({ en: "Copy", fr: "Copier", de: "Kopieren" })} ${item.label}: ${item.value}`}
                                >
                                  {t({ en: "Copy", fr: "Copier", de: "Kopieren" })}
                                </UiButton>
                              </div>
                            ))}
                            <div>
                              <dt className={uiMutedTextClass}>{t({ en: "Addressing mode", fr: "Mode d'adressage", de: "Adressierungsmodus" })}</dt>
                              <dd className={cx("mt-1 font-semibold", uiTitleTextClass)}>
                                {selectedConnection.forcePathStyle
                                  ? t({ en: "Path-style", fr: "Style chemin", de: "Pfadstil" })
                                  : t({ en: "Virtual-hosted style", fr: "Style hôte virtuel", de: "Virtueller Hoststil" })}
                              </dd>
                            </div>
                          </dl>
                          <div className="flex flex-wrap items-center gap-3">
                            <UiButton
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => handleDownloadConnectionSheet(false)}
                              aria-label={`${t({ en: "Download connection details (.txt) for", fr: "Télécharger les détails de connexion (.txt) pour", de: "Verbindungsdetails (.txt) herunterladen für" })} ${selectedConnection.storageSpaceName}`}
                            >
                              {t({ en: "Download connection details (.txt)", fr: "Télécharger les détails de connexion (.txt)", de: "Verbindungsdetails herunterladen (.txt)" })}
                            </UiButton>
                            <span className={cx("ui-caption", uiMutedTextClass)} aria-live="polite">{connectionCopyMessage}</span>
                          </div>
                        </section>
                      </div>
                    </details>
                  </>
                ) : null}
              </>
            )}
          </div>
        </Modal>
      ) : null}

      {activeTab === "access-list" ? (
        <PortalTabPanel idPrefix="portal-tool-access" tabId="access-list">
          {accountLoading ? (
            <PageBanner tone="info">{t({ en: "Loading project...", fr: "Chargement du projet...", de: "Projekt wird geladen..." })}</PageBanner>
          ) : !hasAccountContext ? (
            <PageEmptyState
              title={t({ en: "Select a project before connecting external tools", fr: "Sélectionnez un projet avant de connecter des outils externes", de: "Wählen Sie ein Projekt aus, bevor Sie externe Werkzeuge verbinden" })}
              description={t({ en: "External-tool access is scoped to the selected project.", fr: "L'accès aux outils externes est limité au projet sélectionné.", de: "Werkzeugzugriff ist auf das ausgewählte Projekt beschränkt." })}
              tone="warning"
            />
          ) : (
            <ListPageSection
              title={t({ en: "Tool access", fr: "Accès outil", de: "Werkzeugzugriff" })}
              description={t({
                en: "Store secrets when they are created; they cannot be shown again. Portal's own runtime access is hidden from this list.",
                fr: "Enregistrez les secrets à la création; ils ne pourront plus être affichés. L'accès runtime propre à Portal est masqué dans cette liste.",
                de: "Speichern Sie Secrets beim Erstellen; sie können nicht erneut angezeigt werden. Portals eigener Laufzeitzugriff ist in dieser Liste ausgeblendet.",
              })}
              countLabel={t({ en: `${visibleKeys.length} access`, fr: `${visibleKeys.length} accès`, de: `${visibleKeys.length} Zugriffe` })}
            >
              <DataTableShell
                columns={accessKeyColumns}
                rows={visibleKeys}
                rowKey={(key) => key.access_key_id}
                status={tableStatus}
                loadingMessage={t({ en: "Loading tool access...", fr: "Chargement des accès outil...", de: "Werkzeugzugriff wird geladen..." })}
                errorMessage={t({ en: "Unable to load tool access.", fr: "Impossible de charger les accès outil.", de: "Werkzeugzugriff kann nicht geladen werden." })}
                emptyMessage={t({ en: "No external tool access yet.", fr: "Aucun accès outil externe pour l'instant.", de: "Noch kein externer Werkzeugzugriff." })}
                rowClassName={(key) =>
                  cx(
                    "hover:bg-slate-50 dark:hover:bg-slate-800/40",
                    !key.is_active && "bg-slate-50/70 dark:bg-slate-900/40"
                  )
                }
                responsiveCards
              />
            </ListPageSection>
          )}
        </PortalTabPanel>
      ) : null}

      {createWizardOpen ? (
        <WorkflowPage
          title={t({ en: "Create S3 tool access", fr: "Créer un accès outil S3", de: "S3-Werkzeugzugriff erstellen" })}
          description={t({
            en: "Choose the IAM user, S3 scope, and permissions, then keep the one-time secret visible until you are done.",
            fr: "Choisissez l'utilisateur IAM, le périmètre S3 et les droits, puis conservez le secret à usage unique jusqu'à la fin.",
            de: "Wählen Sie IAM-Benutzer, S3-Umfang und Rechte und behalten Sie das einmalige Geheimnis bis zum Abschluss sichtbar.",
          })}
          breadcrumbs={portalBreadcrumbs(
            {
              label: t({ en: "External tools", fr: "Outils externes", de: "Externe Werkzeuge" }),
              to: "/portal/access-keys",
            },
            { label: t({ en: "Create", fr: "Créer", de: "Erstellen" }) },
          )}
          backLabel={t({ en: "Back to tool access", fr: "Retour aux accès outil", de: "Zurück zum Werkzeugzugriff" })}
          onBack={busy === "create" ? undefined : closeCreateWizard}
          width="standard"
        >
          <div className="space-y-4">
            {error ? <PageBanner tone="error">{error}</PageBanner> : null}
            {storageSpacesError ? <PageBanner tone="warning">{storageSpacesError}</PageBanner> : null}
            <PageBanner tone="info">
              {t({
                en: "If the recipient can sign in to Portal, prefer sharing the Space there. Create tool access for desktop applications, scripts, or direct S3 clients.",
                fr: "Si le destinataire peut se connecter à Portal, préférez le partage du Space. Créez un accès outil pour une application de bureau, un script ou un client S3 direct.",
                de: "Wenn sich der Empfänger bei Portal anmelden kann, geben Sie den Space bevorzugt dort frei. Werkzeugzugriff ist für Desktop-Anwendungen, Skripte oder direkte S3-Clients gedacht.",
              })}
            </PageBanner>
            {personalAccessLimitReached ? (
              <PageBanner tone="info">
                {t({
                  en: `Your personal IAM user already has the maximum of ${maxAccessKeys} S3 access keys. You can still create access for an external user because it uses a separate IAM user.`,
                  fr: `Votre utilisateur IAM personnel a déjà atteint la limite de ${maxAccessKeys} clés d'accès S3. Vous pouvez toutefois créer un accès pour un utilisateur externe.`,
                  de: `Ihr persönlicher IAM-Benutzer hat bereits das Maximum von ${maxAccessKeys} S3-Zugriffsschlüsseln. Für externe Benutzer können Sie weiterhin Zugriff erstellen, da dafür ein separater IAM-Benutzer verwendet wird.`,
                })}
              </PageBanner>
            ) : null}
            <section className="space-y-2">
              <p className={uiLabelClass}>{t({ en: "Recipient", fr: "Destinataire", de: "Empfänger" })}</p>
              <div className="grid gap-2 md:grid-cols-2">
                <label className={cx("flex min-h-[88px] cursor-pointer gap-3 p-3", uiPanelMutedClass, createTarget === "self" && "ring-2 ring-primary")}>
                  <input
                    type="radio"
                    name="portal-access-key-target"
                    aria-label={t({ en: "For myself", fr: "Pour moi-même", de: "Für mich" })}
                    className={cx("mt-1", uiRadioClass)}
                    checked={createTarget === "self"}
                    onChange={() => setCreateTarget("self")}
                    disabled={busy === "create" || personalAccessLimitReached}
                  />
                  <span className="space-y-1">
                    <span className={cx("block ui-body font-semibold", uiTitleTextClass)}>{t({ en: "For myself", fr: "Pour moi-même", de: "Für mich" })}</span>
                    <span className={cx("block ui-caption", uiMutedTextClass)}>
                      {t({ en: "Uses my current Portal grants.", fr: "Utilise mes droits Portal actuels.", de: "Verwendet meine aktuellen Portal-Berechtigungen." })}
                    </span>
                  </span>
                </label>
                <label className={cx("flex min-h-[88px] cursor-pointer gap-3 p-3", uiPanelMutedClass, createTarget === "external" && "ring-2 ring-primary")}>
                  <input
                    type="radio"
                    name="portal-access-key-target"
                    aria-label={t({ en: "For an external user", fr: "Pour un utilisateur externe", de: "Für einen externen Benutzer" })}
                    className={cx("mt-1", uiRadioClass)}
                    checked={createTarget === "external"}
                    onChange={() => setCreateTarget("external")}
                    disabled={busy === "create"}
                  />
                  <span className="space-y-1">
                    <span className={cx("block ui-body font-semibold", uiTitleTextClass)}>{t({ en: "For an external user", fr: "Pour un utilisateur externe", de: "Für einen externen Benutzer" })}</span>
                    <span className={cx("block ui-caption", uiMutedTextClass)}>
                      {t({ en: "Limits tool access to one space.", fr: "Limite l'accès outil à un seul espace.", de: "Beschränkt den Werkzeugzugriff auf einen Bereich." })}
                    </span>
                  </span>
                </label>
              </div>
            </section>

            {createTarget === "external" ? (
              <section className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1">
                  <span className={uiLabelClass}>{t({ en: "External user", fr: "Utilisateur externe", de: "Externer Benutzer" })}</span>
                  <input
                    className={uiInputClass}
                    value={externalEmail}
                    onChange={(event) => setExternalEmail(event.target.value)}
                    placeholder={t({ en: "name@example.org", fr: "nom@example.org", de: "name@example.org" })}
                    disabled={busy === "create"}
                  />
                </label>
                <label className="space-y-1">
                  <span className={uiLabelClass}>{t({ en: "Space", fr: "Espace", de: "Bereich" })}</span>
                  <select
                    className={uiInputClass}
                    value={selectedSpaceId}
                    onChange={(event) => setSelectedSpaceId(event.target.value)}
                    disabled={busy === "create" || storageSpacesLoading || storageSpaces.length === 0}
                  >
                    {storageSpacesLoading ? (
                      <option value="">{t({ en: "Loading...", fr: "Chargement...", de: "Wird geladen..." })}</option>
                    ) : storageSpaces.length === 0 ? (
                      <option value="">{t({ en: "No owned space", fr: "Aucun espace propriétaire", de: "Kein eigener Bereich" })}</option>
                    ) : (
                      storageSpaces.map((space) => (
                        <option key={space.id} value={space.id}>
                          {space.name}
                        </option>
                      ))
                    )}
                  </select>
                </label>
                <fieldset className="space-y-2 md:col-span-2">
                  <legend className={uiLabelClass}>{t({ en: "Permission", fr: "Droits", de: "Berechtigung" })}</legend>
                  <div className="grid gap-2 md:grid-cols-2">
                    <label className={cx("flex min-h-[74px] cursor-pointer gap-3 p-3", uiPanelMutedClass, externalPermission === "read_only" && "ring-2 ring-primary")}>
                      <input
                        type="radio"
                        name="portal-external-access-permission"
                        aria-label={t({ en: "Read only", fr: "Lecture seule", de: "Nur lesen" })}
                        className={cx("mt-1", uiRadioClass)}
                        checked={externalPermission === "read_only"}
                        onChange={() => setExternalPermission("read_only")}
                        disabled={busy === "create"}
                      />
                      <span>
                        <span className={cx("block ui-body font-semibold", uiTitleTextClass)}>{t({ en: "Read only", fr: "Lecture seule", de: "Nur lesen" })}</span>
                        <span className={cx("block ui-caption", uiMutedTextClass)}>{t({ en: "List and download.", fr: "Lister et télécharger.", de: "Auflisten und herunterladen." })}</span>
                      </span>
                    </label>
                    <label className={cx("flex min-h-[74px] cursor-pointer gap-3 p-3", uiPanelMutedClass, externalPermission === "read_write" && "ring-2 ring-primary")}>
                      <input
                        type="radio"
                        name="portal-external-access-permission"
                        aria-label={t({ en: "Read/write", fr: "Lecture/écriture", de: "Lesen/Schreiben" })}
                        className={cx("mt-1", uiRadioClass)}
                        checked={externalPermission === "read_write"}
                        onChange={() => setExternalPermission("read_write")}
                        disabled={busy === "create"}
                      />
                      <span>
                        <span className={cx("block ui-body font-semibold", uiTitleTextClass)}>{t({ en: "Read/write", fr: "Lecture/écriture", de: "Lesen/Schreiben" })}</span>
                        <span className={cx("block ui-caption", uiMutedTextClass)}>{t({ en: "List, download, upload, and delete.", fr: "Lister, télécharger, déposer et supprimer.", de: "Auflisten, herunterladen, hochladen und löschen." })}</span>
                      </span>
                    </label>
                  </div>
                </fieldset>
              </section>
            ) : null}

            <section className={cx("space-y-2 p-3", uiPanelMutedClass)}>
              <p className={uiLabelClass}>{t({ en: "Summary", fr: "Récapitulatif", de: "Zusammenfassung" })}</p>
              <dl className="grid gap-2 ui-caption md:grid-cols-2">
                <div>
                  <dt className={uiMutedTextClass}>{t({ en: "Recipient", fr: "Destinataire", de: "Empfänger" })}</dt>
                  <dd className={cx("font-semibold", uiTitleTextClass)}>
                    {createTarget === "external"
                      ? externalEmail.trim() || t({ en: "External user", fr: "Utilisateur externe", de: "Externer Benutzer" })
                      : t({ en: "Myself", fr: "Moi-même", de: "Ich selbst" })}
                  </dd>
                </div>
                <div>
                  <dt className={uiMutedTextClass}>{t({ en: "Scope", fr: "Périmètre", de: "Umfang" })}</dt>
                  <dd className={cx("font-semibold", uiTitleTextClass)}>
                    {createTarget === "external"
                      ? selectedSpace?.name || t({ en: "Select a space", fr: "Sélectionner un espace", de: "Bereich auswählen" })
                      : t({ en: "My Portal access", fr: "Mes accès Portal", de: "Mein Portal-Zugriff" })}
                  </dd>
                </div>
              </dl>
            </section>

            <WorkflowActions>
              <UiButton variant="secondary" onClick={closeCreateWizard} disabled={busy === "create"}>
                {t({ en: "Cancel", fr: "Annuler", de: "Abbrechen" })}
              </UiButton>
              <UiButton onClick={handleCreateKey} loading={busy === "create"} disabled={createWizardSubmitDisabled}>
                {busy === "create"
                  ? t({ en: "Creating...", fr: "Création...", de: "Wird erstellt..." })
                  : t({ en: "Create access", fr: "Créer l'accès", de: "Zugriff erstellen" })}
              </UiButton>
            </WorkflowActions>
          </div>
        </WorkflowPage>
      ) : null}

      {pendingAction?.type === "disable" ? (
        <ConfirmActionDialog
          title={t({ en: "Disable tool access", fr: "Désactiver l'accès outil", de: "Werkzeugzugriff deaktivieren" })}
          description={t({ en: "Confirm that you want to disable this tool access.", fr: "Confirmez que vous voulez désactiver cet accès outil.", de: "Bestätigen Sie, dass Sie diesen Werkzeugzugriff deaktivieren möchten." })}
          confirmLabel={t({ en: "Disable access", fr: "Désactiver l'accès", de: "Zugriff deaktivieren" })}
          loading={busy === `toggle:${pendingAction.key.access_key_id}`}
          details={[
            { label: t({ en: "Access ID", fr: "ID d'accès", de: "Zugriffs-ID" }), value: pendingAction.key.access_key_id, mono: true },
            { label: t({ en: "Recipient", fr: "Destinataire", de: "Empfänger" }), value: keyTargetLabel(pendingAction.key, t) },
            { label: t({ en: "Scope", fr: "Périmètre", de: "Umfang" }), value: keyScopeLabel(pendingAction.key, t) },
            { label: t({ en: "Service address", fr: "Adresse du service", de: "Serviceadresse" }), value: state?.s3_endpoint ?? t({ en: "Configured storage service", fr: "Service de stockage configuré", de: "Konfigurierter Speicherdienst" }) },
          ]}
          impacts={[
            t({ en: "External tools using this access stop authenticating until it is re-enabled.", fr: "Les outils externes utilisant cet accès ne pourront plus s'authentifier jusqu'à sa réactivation.", de: "Externe Werkzeuge mit diesem Zugriff können sich nicht authentifizieren, bis er wieder aktiviert wird." }),
            t({ en: "The secret value cannot be displayed again from the Portal.", fr: "Le secret ne peut plus être affiché depuis le Portal.", de: "Das Secret kann im Portal nicht erneut angezeigt werden." }),
            t({ en: "The active Portal runtime access is not affected.", fr: "L'accès runtime actif utilisé par Portal n'est pas affecté.", de: "Der aktive Portal-Laufzeitzugriff ist nicht betroffen." }),
          ]}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => updateKeyStatus(pendingAction.key, false)}
        />
      ) : null}

      {pendingAction?.type === "delete" ? (
        <ConfirmActionDialog
          title={t({ en: "Delete tool access", fr: "Supprimer l'accès outil", de: "Werkzeugzugriff löschen" })}
          description={t({ en: "Confirm that you want to permanently delete this tool access.", fr: "Confirmez que vous voulez supprimer définitivement cet accès outil.", de: "Bestätigen Sie, dass Sie diesen Werkzeugzugriff dauerhaft löschen möchten." })}
          confirmLabel={t({ en: "Delete access", fr: "Supprimer l'accès", de: "Zugriff löschen" })}
          loading={busy === `delete:${pendingAction.key.access_key_id}`}
          details={[
            { label: t({ en: "Access ID", fr: "ID d'accès", de: "Zugriffs-ID" }), value: pendingAction.key.access_key_id, mono: true },
            { label: t({ en: "Recipient", fr: "Destinataire", de: "Empfänger" }), value: keyTargetLabel(pendingAction.key, t) },
            { label: t({ en: "Scope", fr: "Périmètre", de: "Umfang" }), value: keyScopeLabel(pendingAction.key, t) },
            { label: t({ en: "Service address", fr: "Adresse du service", de: "Serviceadresse" }), value: state?.s3_endpoint ?? t({ en: "Configured storage service", fr: "Service de stockage configuré", de: "Konfigurierter Speicherdienst" }) },
          ]}
          impacts={[
            t({ en: "External tools using this access stop working immediately.", fr: "Les outils externes utilisant cet accès cessent immédiatement de fonctionner.", de: "Externe Werkzeuge mit diesem Zugriff funktionieren sofort nicht mehr." }),
            t({ en: "The secret value cannot be recovered or shown again.", fr: "Le secret ne peut pas être récupéré ni affiché à nouveau.", de: "Das Secret kann nicht wiederhergestellt oder erneut angezeigt werden." }),
            t({ en: "This deletion cannot be undone from the Portal.", fr: "Cette suppression ne peut pas être annulée depuis le Portal.", de: "Diese Löschung kann im Portal nicht rückgängig gemacht werden." }),
          ]}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => confirmDeleteKey(pendingAction.key)}
        />
      ) : null}

      {pendingAction?.type === "export-secret" ? (
        <ConfirmActionDialog
          title={t({
            en: "Export unencrypted credentials?",
            fr: "Exporter des identifiants non chiffrés ?",
            de: "Unverschlüsselte Zugangsdaten exportieren?",
          })}
          description={t({
            en: "This creates a text file containing the Access ID and one-time secret for this external recipient.",
            fr: "Cette action crée un fichier texte contenant l'ID d'accès et la clé secrète à usage unique pour ce destinataire externe.",
            de: "Dadurch wird eine Textdatei mit der Zugriffs-ID und dem einmaligen Secret für diesen externen Empfänger erstellt.",
          })}
          confirmLabel={t({
            en: "Export credentials (.txt)",
            fr: "Exporter les identifiants (.txt)",
            de: "Zugangsdaten exportieren (.txt)",
          })}
          details={[
            { label: t({ en: "Recipient", fr: "Destinataire", de: "Empfänger" }), value: keyTargetLabel(pendingAction.key, t) },
            { label: t({ en: "Scope", fr: "Périmètre", de: "Umfang" }), value: keyScopeLabel(pendingAction.key, t) },
          ]}
          impacts={[
            t({
              en: "Anyone who obtains this file can use the access within its assigned permissions.",
              fr: "Toute personne qui obtient ce fichier peut utiliser l'accès dans la limite de ses droits.",
              de: "Jede Person mit dieser Datei kann den Zugriff im Rahmen der zugewiesenen Berechtigungen verwenden.",
            }),
            t({
              en: "The file may remain in Downloads, backups, or synchronized folders until you delete it.",
              fr: "Le fichier peut rester dans les téléchargements, les sauvegardes ou les dossiers synchronisés jusqu'à sa suppression.",
              de: "Die Datei kann bis zum Löschen in Downloads, Sicherungen oder synchronisierten Ordnern verbleiben.",
            }),
          ]}
          warning={t({
            en: "Transfer it through a secure channel and delete every copy after the recipient configures the tool.",
            fr: "Transmettez-le par un canal sécurisé et supprimez chaque copie après la configuration de l'outil par le destinataire.",
            de: "Übertragen Sie die Datei über einen sicheren Kanal und löschen Sie jede Kopie, nachdem der Empfänger das Werkzeug konfiguriert hat.",
          })}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => {
            handleDownloadConnectionSheet(true);
            setPendingAction(null);
          }}
        />
      ) : null}
    </div>
  );
}
