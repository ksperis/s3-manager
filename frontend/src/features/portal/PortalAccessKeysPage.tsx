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
import ListToolbar from "../../components/ListToolbar";
import Modal from "../../components/Modal";
import OneTimeSecretPanel from "../../components/OneTimeSecretPanel";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import UiButton from "../../components/ui/UiButton";
import { cx, uiInputClass, uiLabelClass, uiMutedTextClass, uiPanelMutedClass, uiRadioClass, uiTitleTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { usePortalAccountContext } from "./PortalAccountContext";
import {
  buildCyberduckBookmark,
  buildGenericConnectionSheet,
  bucketNameForPortalExternalTool,
  parsePortalExternalToolEndpoint,
  portalExternalToolBaseFilename,
  portalExternalToolPermissionLabel,
  storageSpaceNameForPortalExternalTool,
  triggerPortalExternalToolDownload,
  type PortalExternalToolConnection,
} from "./portalExternalToolAccess";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import { portalAccessKeyStatusLabel, portalDateTimeLabel } from "./portalI18n";

type PendingAccessKeyAction =
  | { type: "disable"; key: PortalAccessKey }
  | { type: "delete"; key: PortalAccessKey };

type CreateTarget = "self" | "external";
type ExternalPermission = "read_only" | "read_write";

function isKeyActive(key: PortalAccessKey): boolean {
  if (typeof key.is_active === "boolean") {
    return key.is_active;
  }
  const normalized = (key.status || "").toLowerCase();
  if (["inactive", "disabled", "suspended"].includes(normalized)) return false;
  if (["active", "enabled"].includes(normalized)) return true;
  return true;
}

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

function isOwnerStorageSpace(space: PortalStorageSpaceSummary): boolean {
  return (space.content_role ?? space.role) === "Owner" && !space.archived_at;
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
  const [createWizardOpen, setCreateWizardOpen] = useState(false);
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
      setError(extractApiError(err, t({ en: "Unable to load access keys.", fr: "Impossible de charger les clés d'accès.", de: "Zugriffsschlüssel können nicht geladen werden." })));
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
  const activeKeys = useMemo(() => visibleKeys.filter(isKeyActive), [visibleKeys]);
  const canManageAccessKeys = Boolean(state?.can_manage_access_keys);
  const maxAccessKeys = state?.max_access_keys ?? 0;
  const maxReached = maxAccessKeys > 0 && visibleKeys.length >= maxAccessKeys;
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
        storageSpaceName: storageSpaceNameForPortalExternalTool(selectedConnectionKey, selectedConnectionSpace),
        bucketName: selectedConnectionBucketName,
        permissionLabel: portalExternalToolPermissionLabel(selectedConnectionKey.permission),
      }
    : null;
  const selectedConnectionHasOneTimeSecret = Boolean(
    createdKey?.secret_access_key && selectedConnectionKey?.access_key_id === createdKey.access_key_id
  );
  const showSecretConnectionDownload = selectedConnectionHasOneTimeSecret && Boolean(selectedConnection);
  const connectionSpaceSelectValue = selectedConnectionKeyBucket
    ? selectedConnectionSpace?.id || selectedConnectionKeyBucket
    : connectionSpaceId;
  const connectionEndpointLabel = selectedConnection?.endpoint?.original || state?.s3_endpoint || t({ en: "Configured storage service", fr: "Service de stockage configuré", de: "Konfigurierter Speicherdienst" });
  const cyberduckBookmarkUnavailable = Boolean(selectedConnection && !selectedConnection.endpoint);

  useEffect(() => {
    if (!selectedConnectionKey && activeKeys[0]) {
      setConnectionKeyId(activeKeys[0].access_key_id);
    }
  }, [activeKeys, selectedConnectionKey]);

  useEffect(() => {
    if (!selectedConnectionKeyBucket) return;
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
      maxReached ||
      !requestedSpaceId
    ) {
      return;
    }
    setCreateTarget("external");
    setSelectedSpaceId(requestedSpaceId);
    setStorageSpacesError(null);
    setCreateWizardOpen(true);
    setQueryCreateHandled(true);
  }, [canManageAccessKeys, maxReached, queryCreateHandled, requestedCreateTarget, requestedSpaceId, state]);

  const openCreateWizard = () => {
    if (createDisabled) return;
    setCreateTarget("self");
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
    if (!accountIdForApi || !canManageAccessKeys || maxReached) return;
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
      setConnectionKeyId(key.access_key_id);
      const createdBucket = bucketNameForPortalExternalTool(key, selectedSpace);
      if (createdBucket) {
        setConnectionSpaceId(createdBucket);
      }
      setActionMessage(
        key.target_type === "external"
          ? t({ en: "External credential created", fr: "Credential externe créé", de: "Externe Zugangsdaten erstellt" })
          : t({ en: "Access key created", fr: "Clé d'accès créée", de: "Zugriffsschlüssel erstellt" })
      );
      setCreateWizardOpen(false);
      await loadKeys();
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, t({ en: "Unable to create access key.", fr: "Impossible de créer la clé d'accès.", de: "Zugriffsschlüssel kann nicht erstellt werden." })));
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
      setActionMessage(active ? t({ en: "Access key enabled", fr: "Clé d'accès activée", de: "Zugriffsschlüssel aktiviert" }) : t({ en: "Access key disabled", fr: "Clé d'accès désactivée", de: "Zugriffsschlüssel deaktiviert" }));
      setPendingAction(null);
      await loadKeys();
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, t({ en: "Unable to update access key.", fr: "Impossible de mettre à jour la clé d'accès.", de: "Zugriffsschlüssel kann nicht aktualisiert werden." })));
      setPendingAction(null);
    } finally {
      setBusy(null);
    }
  };

  const handleToggleKey = (key: PortalAccessKey) => {
    if (!accountIdForApi || !canManageAccessKeys || key.is_portal) return;
    const active = isKeyActive(key);
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
      setActionMessage(t({ en: "Access key deleted", fr: "Clé d'accès supprimée", de: "Zugriffsschlüssel gelöscht" }));
      setPendingAction(null);
      await loadKeys();
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, t({ en: "Unable to delete access key.", fr: "Impossible de supprimer la clé d'accès.", de: "Zugriffsschlüssel kann nicht gelöscht werden." })));
      setPendingAction(null);
    } finally {
      setBusy(null);
    }
  };

  const handleDownloadCyberduckBookmark = () => {
    if (!selectedConnection) return;
    if (!selectedConnection.endpoint) {
      setActionMessage(null);
      setError(t({ en: "Cyberduck bookmark download needs a valid S3 endpoint.", fr: "Le téléchargement du favori Cyberduck nécessite un point de terminaison S3 valide.", de: "Der Cyberduck-Bookmark benötigt einen gültigen S3-Endpunkt." }));
      return;
    }
    const filename = `${portalExternalToolBaseFilename(selectedConnection)}.duck`;
    triggerPortalExternalToolDownload(filename, buildCyberduckBookmark(selectedConnection), "application/xml;charset=utf-8");
    setError(null);
    setActionMessage(t({ en: "Cyberduck bookmark downloaded.", fr: "Favori Cyberduck téléchargé.", de: "Cyberduck-Bookmark heruntergeladen." }));
  };

  const handleDownloadConnectionSheet = (includeSecret: boolean) => {
    if (!selectedConnection) return;
    const filename = `${portalExternalToolBaseFilename(selectedConnection)}${includeSecret ? "-with-secret" : ""}.txt`;
    const secretAccessKey = includeSecret && selectedConnectionHasOneTimeSecret ? createdKey?.secret_access_key : null;
    triggerPortalExternalToolDownload(
      filename,
      buildGenericConnectionSheet(selectedConnection, { secretAccessKey }),
      "text/plain;charset=utf-8"
    );
    setError(null);
    setActionMessage(
      includeSecret && secretAccessKey
        ? t({ en: "Connection details with the one-time secret downloaded.", fr: "Détails de connexion avec le secret à usage unique téléchargés.", de: "Verbindungsdetails mit einmaligem Secret heruntergeladen." })
        : t({ en: "Connection details downloaded.", fr: "Détails de connexion téléchargés.", de: "Verbindungsdetails heruntergeladen." })
    );
  };

  const createDisabled = !state || !canManageAccessKeys || maxReached || Boolean(busy);
  const createWizardSubmitDisabled =
    busy === "create" ||
    !accountIdForApi ||
    (createTarget === "external" &&
      (!selectedSpaceId || !externalEmail.trim() || storageSpacesLoading || Boolean(storageSpacesError)));
  const accessKeyColumns: DataTableColumn<PortalAccessKey>[] = [
    {
      id: "access-key",
      label: t({ en: "Access key", fr: "Clé d'accès", de: "Zugriffsschlüssel" }),
      primary: true,
      cellClassName: "max-w-[18rem] break-all font-mono",
      render: (key) => key.access_key_id,
    },
    {
      id: "status",
      label: t({ en: "Status", fr: "Statut", de: "Status" }),
      cellClassName: "text-slate-700 dark:text-slate-200",
      render: (key) => portalAccessKeyStatusLabel(key.status, isKeyActive(key), t),
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
        const active = isKeyActive(key);
        const disabled = Boolean(busy) || !canManageAccessKeys;
        return (
          <div className="flex flex-wrap justify-end gap-2">
            {active ? (
              <button
                type="button"
                onClick={() => setConnectionKeyId(key.access_key_id)}
                className={tableActionButtonClasses}
                disabled={disabled}
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
    <div className="space-y-4">
      <PageHeader
        title={t({ en: "External tools", fr: "Outils externes", de: "Externe Werkzeuge" })}
        description={t({ en: "Create credentials only when another app needs S3 access. Use the endpoint shown here; each secret is shown only once.", fr: "Créez des identifiants uniquement lorsqu'une autre application a besoin d'un accès S3. Utilisez le point de terminaison indiqué ici; chaque secret n'est affiché qu'une seule fois.", de: "Erstellen Sie Zugangsdaten nur, wenn eine andere App S3-Zugriff benötigt. Verwenden Sie den hier angezeigten Endpunkt; jedes Secret wird nur einmal angezeigt." })}
        breadcrumbs={portalBreadcrumbs({ label: t({ en: "External tools", fr: "Outils externes", de: "Externe Werkzeuge" }) })}
        actions={[
          {
            label: busy === "create" ? t({ en: "Creating...", fr: "Création...", de: "Wird erstellt..." }) : t({ en: "New key", fr: "Nouvelle clé", de: "Neuer Schlüssel" }),
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
        <PageBanner tone="warning">{t({ en: "External-tool access is disabled for this portal account.", fr: "L'accès aux outils externes est désactivé pour ce compte Portal.", de: "Der Zugriff für externe Werkzeuge ist für dieses Portal-Konto deaktiviert." })}</PageBanner>
      )}
      {state && canManageAccessKeys && (
        <PageBanner tone="info">
          {t({
            en: `Use endpoint ${state.s3_endpoint || "the configured storage service"} with these keys. Disabling pauses a key for external tools; deleting removes it permanently.`,
            fr: `Utilisez ${state.s3_endpoint ? `le point de terminaison ${state.s3_endpoint}` : "le service de stockage configuré"} avec ces clés. La désactivation suspend une clé pour les outils externes; la suppression la retire définitivement.`,
            de: `Verwenden Sie ${state.s3_endpoint ? `den Endpunkt ${state.s3_endpoint}` : "den konfigurierten Speicherdienst"} mit diesen Schlüsseln. Deaktivieren pausiert einen Schlüssel für externe Werkzeuge; Löschen entfernt ihn dauerhaft.`,
          })}
        </PageBanner>
      )}
      {state && canManageAccessKeys && maxReached && (
        <PageBanner tone="info">{t({ en: "The maximum number of portal user access keys has been reached.", fr: "Le nombre maximal de clés d'accès utilisateur Portal est atteint.", de: "Die maximale Anzahl von Portal-Benutzerzugriffsschlüsseln wurde erreicht." })}</PageBanner>
      )}

      {createdKey?.secret_access_key && (
        <OneTimeSecretPanel
          title={
            createdKey.target_type === "external"
              ? t({ en: "External credential created", fr: "Credential externe créé", de: "Externe Zugangsdaten erstellt" })
              : t({ en: "Access key created", fr: "Clé d'accès créée", de: "Zugriffsschlüssel erstellt" })
          }
          description={
            createdKey.target_type === "external"
              ? t({ en: "The secret is shown only once and is limited to the selected space.", fr: "Le secret n'est affiché qu'une seule fois et reste limité à l'espace sélectionné.", de: "Das Secret wird nur einmal angezeigt und bleibt auf den ausgewählten Bereich beschränkt." })
              : t({ en: "The secret is shown only once.", fr: "Le secret n'est affiché qu'une seule fois.", de: "Das Secret wird nur einmal angezeigt." })
          }
          badge={t({ en: "Copy these values now", fr: "Copiez ces valeurs maintenant", de: "Diese Werte jetzt kopieren" })}
          actions={
            showSecretConnectionDownload ? (
              <>
                <UiButton type="button" variant="secondary" size="xs" onClick={() => handleDownloadConnectionSheet(false)}>
                  {t({ en: "Download details", fr: "Télécharger les détails", de: "Details herunterladen" })}
                </UiButton>
                <UiButton type="button" variant="warning" size="xs" onClick={() => handleDownloadConnectionSheet(true)}>
                  {t({ en: "Download with secret", fr: "Télécharger avec secret", de: "Mit Secret herunterladen" })}
                </UiButton>
              </>
            ) : null
          }
          values={[
            {
              label: t({ en: "Access key", fr: "Clé d'accès", de: "Zugriffsschlüssel" }),
              value: createdKey.access_key_id,
              copyLabel: t({ en: "Copy", fr: "Copier", de: "Kopieren" }),
            },
            {
              label: t({ en: "Secret key", fr: "Clé secrète", de: "Geheimer Schlüssel" }),
              value: createdKey.secret_access_key,
              copyLabel: t({ en: "Copy", fr: "Copier", de: "Kopieren" }),
            },
          ]}
        />
      )}

      {state && hasAccountContext ? (
        <section className="ui-surface-card space-y-4 p-4" aria-labelledby="portal-external-tool-access">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 id="portal-external-tool-access" className={cx("text-sm font-bold", uiTitleTextClass)}>
                {t({ en: "Connect an external tool", fr: "Connecter un outil externe", de: "Externes Werkzeug verbinden" })}
              </h2>
              <p className={cx("mt-1 ui-caption", uiMutedTextClass)}>
                {t({
                  en: "Choose a key and space, then download ready-to-use connection details.",
                  fr: "Choisissez une clé et un espace, puis téléchargez les informations de connexion prêtes à l'emploi.",
                  de: "Wählen Sie Schlüssel und Bereich aus und laden Sie fertige Verbindungsdetails herunter.",
                })}
              </p>
            </div>
            {selectedConnectionKeyBucket ? (
              <span className={cx("rounded-md px-2 py-1 ui-caption font-semibold", uiPanelMutedClass)}>
                {t({ en: "Space set by this key", fr: "Espace défini par cette clé", de: "Bereich durch Schlüssel festgelegt" })}
              </span>
            ) : null}
          </div>

          {connectionSpacesError ? <PageBanner tone="warning">{connectionSpacesError}</PageBanner> : null}

          <div className="grid gap-3 lg:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_auto] lg:items-end">
            <label className="space-y-1">
              <span className={uiLabelClass}>{t({ en: "Access key", fr: "Clé d'accès", de: "Zugriffsschlüssel" })}</span>
              <select
                className={uiInputClass}
                value={selectedConnectionKey?.access_key_id ?? ""}
                onChange={(event) => setConnectionKeyId(event.target.value)}
                aria-label={t({ en: "Connection access key", fr: "Clé d'accès de connexion", de: "Verbindungsschlüssel" })}
                disabled={activeKeys.length === 0}
              >
                {activeKeys.length === 0 ? (
                  <option value="">{t({ en: "No active key", fr: "Aucune clé active", de: "Kein aktiver Schlüssel" })}</option>
                ) : (
                  activeKeys.map((key) => (
                    <option key={key.access_key_id} value={key.access_key_id}>
                      {key.access_key_id} - {keyScopeLabel(key, t)}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="space-y-1">
              <span className={uiLabelClass}>{t({ en: "Space", fr: "Espace", de: "Bereich" })}</span>
              <select
                className={uiInputClass}
                value={connectionSpaceSelectValue}
                onChange={(event) => setConnectionSpaceId(event.target.value)}
                aria-label={t({ en: "Connection space", fr: "Espace de connexion", de: "Verbindungsbereich" })}
                disabled={connectionSpacesLoading || connectionSpaces.length === 0 || Boolean(selectedConnectionKeyBucket)}
              >
                {connectionSpacesLoading ? (
                  <option value="">{t({ en: "Loading...", fr: "Chargement...", de: "Wird geladen..." })}</option>
                ) : selectedConnectionKeyBucket && !selectedConnectionSpace ? (
                  <option value={selectedConnectionKeyBucket}>{selectedConnectionKey?.storage_space_name || selectedConnectionKeyBucket}</option>
                ) : connectionSpaces.length === 0 ? (
                  <option value="">{t({ en: "No space", fr: "Aucun espace", de: "Kein Bereich" })}</option>
                ) : (
                  connectionSpaces.map((space) => (
                    <option key={space.id} value={space.id}>
                      {space.name}
                    </option>
                  ))
                )}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              <UiButton
                type="button"
                variant="secondary"
                onClick={handleDownloadCyberduckBookmark}
                disabled={!selectedConnection || !selectedConnection.endpoint}
                className="h-9"
              >
                {t({ en: "Cyberduck bookmark", fr: "Favori Cyberduck", de: "Cyberduck-Bookmark" })}
              </UiButton>
              <UiButton
                type="button"
                variant="secondary"
                onClick={() => handleDownloadConnectionSheet(false)}
                disabled={!selectedConnection}
                className="h-9"
              >
                {t({ en: "Connection details", fr: "Détails de connexion", de: "Verbindungsdetails" })}
              </UiButton>
              {showSecretConnectionDownload ? (
                <UiButton type="button" variant="warning" onClick={() => handleDownloadConnectionSheet(true)} className="h-9">
                  {t({ en: "Details with secret", fr: "Détails avec secret", de: "Details mit Secret" })}
                </UiButton>
              ) : null}
            </div>
          </div>

          {cyberduckBookmarkUnavailable ? (
            <PageBanner tone="info">
              {t({
                en: "Cyberduck bookmark download is unavailable because this Storage service does not expose a valid S3 endpoint here. Generic connection details are still available.",
                fr: "Le téléchargement du favori Cyberduck est indisponible car ce service de stockage n'expose pas de point de terminaison S3 valide ici. Les détails de connexion génériques restent disponibles.",
                de: "Der Cyberduck-Bookmark ist nicht verfügbar, weil hier kein gültiger S3-Endpunkt bereitsteht. Allgemeine Verbindungsdetails sind weiterhin verfügbar.",
              })}
            </PageBanner>
          ) : null}

          <dl className="grid gap-3 ui-caption md:grid-cols-4">
            <div>
              <dt className={uiMutedTextClass}>{t({ en: "Endpoint", fr: "Point de terminaison", de: "Endpunkt" })}</dt>
              <dd className={cx("break-all font-semibold", uiTitleTextClass)}>{connectionEndpointLabel}</dd>
            </div>
            <div>
              <dt className={uiMutedTextClass}>{t({ en: "Space", fr: "Espace", de: "Bereich" })}</dt>
              <dd className={cx("break-all font-semibold", uiTitleTextClass)}>{selectedConnection?.storageSpaceName ?? "-"}</dd>
            </div>
            <div>
              <dt className={uiMutedTextClass}>{t({ en: "Name to use in S3 tools", fr: "Nom à utiliser dans les outils S3", de: "Name fuer S3-Werkzeuge" })}</dt>
              <dd className={cx("break-all font-mono font-semibold", uiTitleTextClass)}>{selectedConnection?.bucketName ?? "-"}</dd>
            </div>
            <div>
              <dt className={uiMutedTextClass}>{t({ en: "Secret", fr: "Secret", de: "Secret" })}</dt>
              <dd className={cx("font-semibold", uiTitleTextClass)}>
                {!selectedConnection
                  ? t({ en: "Create or enable a key first", fr: "Créez ou activez d'abord une clé", de: "Erstellen oder aktivieren Sie zuerst einen Schlüssel" })
                  : showSecretConnectionDownload
                  ? t({ en: "Available once for this new key", fr: "Disponible une fois pour cette nouvelle clé", de: "Einmalig fuer diesen neuen Schlüssel verfügbar" })
                  : t({ en: "Not shown again", fr: "Non réaffiché", de: "Wird nicht erneut angezeigt" })}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      {accountLoading ? (
        <PageBanner tone="info">{t({ en: "Loading portal account...", fr: "Chargement du compte Portal...", de: "Portal-Konto wird geladen..." })}</PageBanner>
      ) : !hasAccountContext ? (
        <PageEmptyState
          title={t({ en: "Select a portal account before connecting external tools", fr: "Sélectionnez un compte Portal avant de connecter des outils externes", de: "Wählen Sie ein Portal-Konto aus, bevor Sie externe Werkzeuge verbinden" })}
          description={t({ en: "External-tool keys are scoped to the selected portal account.", fr: "Les clés pour outils externes sont limitées au compte Portal sélectionné.", de: "Schlüssel für externe Werkzeuge sind auf das ausgewählte Portal-Konto beschränkt." })}
          tone="warning"
        />
      ) : (
        <div className="ui-surface-card">
          <ListToolbar
            title={t({ en: "Keys", fr: "Clés", de: "Schlüssel" })}
            description={
              state?.s3_endpoint
                ? t({ en: `Use these keys with endpoint ${state.s3_endpoint}. Store secrets when they are created; they cannot be shown again. The portal key is hidden from this list.`, fr: `Utilisez ces clés avec le point de terminaison ${state.s3_endpoint}. Enregistrez les secrets à la création; ils ne pourront plus être affichés. La clé Portal est masquée dans cette liste.`, de: `Verwenden Sie diese Schlüssel mit dem Endpunkt ${state.s3_endpoint}. Speichern Sie Secrets beim Erstellen; sie können nicht erneut angezeigt werden. Der Portal-Schlüssel ist in dieser Liste ausgeblendet.` })
                : t({ en: "Store secrets when they are created; they cannot be shown again. The portal key is hidden from this list.", fr: "Enregistrez les secrets à la création; ils ne pourront plus être affichés. La clé Portal est masquée dans cette liste.", de: "Speichern Sie Secrets beim Erstellen; sie können nicht erneut angezeigt werden. Der Portal-Schlüssel ist in dieser Liste ausgeblendet." })
            }
            showHeading={false}
            countLabel={t({ en: `${visibleKeys.length}/${maxAccessKeys || "-"} key(s)`, fr: `${visibleKeys.length}/${maxAccessKeys || "-"} clé(s)`, de: `${visibleKeys.length}/${maxAccessKeys || "-"} Schlüssel` })}
          />
          <DataTableShell
            columns={accessKeyColumns}
            rows={visibleKeys}
            rowKey={(key) => key.access_key_id}
            status={tableStatus}
            loadingMessage={t({ en: "Loading keys...", fr: "Chargement des clés...", de: "Schlüssel werden geladen..." })}
            errorMessage={t({ en: "Unable to load keys.", fr: "Impossible de charger les clés.", de: "Schlüssel können nicht geladen werden." })}
            emptyMessage={t({ en: "No external access keys.", fr: "Aucune clé d'accès externe.", de: "Keine externen Zugriffsschlüssel." })}
            rowClassName={(key) =>
              cx(
                "hover:bg-slate-50 dark:hover:bg-slate-800/40",
                !isKeyActive(key) && "bg-slate-50/70 dark:bg-slate-900/40"
              )
            }
            responsiveCards
          />
        </div>
      )}

      {createWizardOpen ? (
        <Modal
          title={t({ en: "Create access key", fr: "Créer une clé d'accès", de: "Zugriffsschlüssel erstellen" })}
          onClose={closeCreateWizard}
          closeOnBackdropClick={busy !== "create"}
          closeOnEscape={busy !== "create"}
          maxWidthClass="max-w-3xl"
        >
          <div className="space-y-4">
            {storageSpacesError ? <PageBanner tone="warning">{storageSpacesError}</PageBanner> : null}
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
                    disabled={busy === "create"}
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
                      {t({ en: "Limits the credential to one space.", fr: "Limite le credential à un seul espace.", de: "Beschränkt die Zugangsdaten auf einen Bereich." })}
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

            <div className="flex flex-wrap justify-end gap-2">
              <UiButton variant="secondary" onClick={closeCreateWizard} disabled={busy === "create"}>
                {t({ en: "Cancel", fr: "Annuler", de: "Abbrechen" })}
              </UiButton>
              <UiButton onClick={handleCreateKey} loading={busy === "create"} disabled={createWizardSubmitDisabled}>
                {busy === "create"
                  ? t({ en: "Creating...", fr: "Création...", de: "Wird erstellt..." })
                  : t({ en: "Create key", fr: "Créer la clé", de: "Schlüssel erstellen" })}
              </UiButton>
            </div>
          </div>
        </Modal>
      ) : null}

      {pendingAction?.type === "disable" ? (
        <ConfirmActionDialog
          title={t({ en: "Disable access key", fr: "Désactiver la clé d'accès", de: "Zugriffsschlüssel deaktivieren" })}
          description={t({ en: "Confirm that you want to disable this access key.", fr: "Confirmez que vous voulez désactiver cette clé d'accès.", de: "Bestätigen Sie, dass Sie diesen Zugriffsschlüssel deaktivieren möchten." })}
          confirmLabel={t({ en: "Disable key", fr: "Désactiver la clé", de: "Schlüssel deaktivieren" })}
          loading={busy === `toggle:${pendingAction.key.access_key_id}`}
          details={[
            { label: t({ en: "Access key", fr: "Clé d'accès", de: "Zugriffsschlüssel" }), value: pendingAction.key.access_key_id, mono: true },
            { label: t({ en: "Recipient", fr: "Destinataire", de: "Empfänger" }), value: keyTargetLabel(pendingAction.key, t) },
            { label: t({ en: "Scope", fr: "Périmètre", de: "Umfang" }), value: keyScopeLabel(pendingAction.key, t) },
            { label: t({ en: "Endpoint", fr: "Point de terminaison", de: "Endpunkt" }), value: state?.s3_endpoint ?? t({ en: "Configured storage service", fr: "Service de stockage configuré", de: "Konfigurierter Speicherdienst" }) },
          ]}
          impacts={[
            t({ en: "External tools using this key stop authenticating until it is re-enabled.", fr: "Les outils externes utilisant cette clé ne pourront plus s'authentifier jusqu'à sa réactivation.", de: "Externe Werkzeuge mit diesem Schlüssel können sich nicht authentifizieren, bis er wieder aktiviert wird." }),
            t({ en: "The secret value cannot be displayed again from the Portal.", fr: "Le secret ne peut plus être affiché depuis le Portal.", de: "Das Secret kann im Portal nicht erneut angezeigt werden." }),
            t({ en: "The active Portal runtime key is not affected.", fr: "La clé active utilisée par Portal n'est pas affectée.", de: "Der aktive Portal-Laufzeitschlüssel ist nicht betroffen." }),
          ]}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => updateKeyStatus(pendingAction.key, false)}
        />
      ) : null}

      {pendingAction?.type === "delete" ? (
        <ConfirmActionDialog
          title={t({ en: "Delete access key", fr: "Supprimer la clé d'accès", de: "Zugriffsschlüssel löschen" })}
          description={t({ en: "Confirm that you want to permanently delete this access key.", fr: "Confirmez que vous voulez supprimer définitivement cette clé d'accès.", de: "Bestätigen Sie, dass Sie diesen Zugriffsschlüssel dauerhaft löschen möchten." })}
          confirmLabel={t({ en: "Delete key", fr: "Supprimer la clé", de: "Schlüssel löschen" })}
          loading={busy === `delete:${pendingAction.key.access_key_id}`}
          details={[
            { label: t({ en: "Access key", fr: "Clé d'accès", de: "Zugriffsschlüssel" }), value: pendingAction.key.access_key_id, mono: true },
            { label: t({ en: "Recipient", fr: "Destinataire", de: "Empfänger" }), value: keyTargetLabel(pendingAction.key, t) },
            { label: t({ en: "Scope", fr: "Périmètre", de: "Umfang" }), value: keyScopeLabel(pendingAction.key, t) },
            { label: t({ en: "Endpoint", fr: "Point de terminaison", de: "Endpunkt" }), value: state?.s3_endpoint ?? t({ en: "Configured storage service", fr: "Service de stockage configuré", de: "Konfigurierter Speicherdienst" }) },
          ]}
          impacts={[
            t({ en: "External tools using this key stop working immediately.", fr: "Les outils externes utilisant cette clé cessent immédiatement de fonctionner.", de: "Externe Werkzeuge mit diesem Schlüssel funktionieren sofort nicht mehr." }),
            t({ en: "The secret value cannot be recovered or shown again.", fr: "Le secret ne peut pas être récupéré ni affiché à nouveau.", de: "Das Secret kann nicht wiederhergestellt oder erneut angezeigt werden." }),
            t({ en: "This deletion cannot be undone from the Portal.", fr: "Cette suppression ne peut pas être annulée depuis le Portal.", de: "Diese Löschung kann im Portal nicht rückgängig gemacht werden." }),
          ]}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => confirmDeleteKey(pendingAction.key)}
        />
      ) : null}
    </div>
  );
}
