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
import WorkflowPage, { WorkflowActions, workflowPageHostClass } from "../../components/WorkflowPage";
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
import PortalPageTabs from "./PortalPageTabs";

type PendingAccessKeyAction =
  | { type: "disable"; key: PortalAccessKey }
  | { type: "delete"; key: PortalAccessKey };

type AccessKeysTab = "connect" | "access-list";
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
  const [activeTab, setActiveTab] = useState<AccessKeysTab>("connect");
  const [guideDismissed, setGuideDismissed] = useState(false);
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
  const [queryCreateHandled, setQueryCreateHandled] = useState(false);

  const requestedSpaceId = searchParams.get("space_id") ?? "";
  const requestedCreateTarget = searchParams.get("create") ?? "";
  const guideStorageKey = `portal.access-keys.start-guide.dismissed.${accountIdForApi ?? "default"}`;

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    setGuideDismissed(window.localStorage.getItem(guideStorageKey) === "1");
  }, [guideStorageKey]);

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
  const showStarterGuide =
    Boolean(state) &&
    hasAccountContext &&
    !connectionSpacesLoading &&
    !connectionSpacesError &&
    visibleKeys.length === 0 &&
    connectionSpaces.length === 0 &&
    !guideDismissed;

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
      setActiveTab("connect");
      setGuideDismissed(true);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(guideStorageKey, "1");
      }
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

  const dismissGuide = () => {
    setGuideDismissed(true);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(guideStorageKey, "1");
    }
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
      label: t({ en: "Access ID", fr: "ID d'accès", de: "Zugriffs-ID" }),
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
                onClick={() => {
                  setConnectionKeyId(key.access_key_id);
                  setActiveTab("connect");
                }}
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
    <div className={workflowPageHostClass(createWizardOpen)}>
      <PageHeader
        title={t({ en: "External tools", fr: "Outils externes", de: "Externe Werkzeuge" })}
        description={t({
          en: "Connect a desktop app or external partner only when they cannot work through the Portal. Keep each access limited to the right space.",
          fr: "Connectez une application de bureau ou un partenaire externe uniquement lorsqu'ils ne peuvent pas travailler dans le portail. Limitez chaque accès au bon espace.",
          de: "Verbinden Sie eine Desktop-App oder externe Partner nur, wenn sie nicht im Portal arbeiten können. Begrenzen Sie jeden Zugriff auf den passenden Bereich.",
        })}
        breadcrumbs={portalBreadcrumbs({ label: t({ en: "External tools", fr: "Outils externes", de: "Externe Werkzeuge" }) })}
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
      {state && canManageAccessKeys && (
        <PageBanner tone="info">
          {t({
            en: "Use external-tool access only when someone cannot work through Portal sharing. Each access can be paused or removed without changing the space itself.",
            fr: "Utilisez l'accès aux outils externes uniquement lorsqu'une personne ne peut pas travailler via le partage Portal. Chaque accès peut être suspendu ou supprimé sans modifier l'espace lui-même.",
            de: "Nutzen Sie Zugriff für externe Werkzeuge nur, wenn jemand nicht über Portal-Freigaben arbeiten kann. Jeder Zugriff kann pausiert oder entfernt werden, ohne den Bereich selbst zu ändern.",
          })}
        </PageBanner>
      )}
      {state && canManageAccessKeys && maxReached && (
        <PageBanner tone="info">{t({ en: "The maximum number of tool access entries has been reached.", fr: "Le nombre maximal d'accès outil est atteint.", de: "Die maximale Anzahl von Werkzeugzugriffen wurde erreicht." })}</PageBanner>
      )}

      <PortalPageTabs
        tabs={[
          {
            id: "connect",
            label: t({ en: "Connect tool", fr: "Connecter un outil", de: "Werkzeug verbinden" }),
          },
          {
            id: "access-list",
            label: t({
              en: `Tool access (${visibleKeys.length})`,
              fr: `Accès outil (${visibleKeys.length})`,
              de: `Werkzeugzugriff (${visibleKeys.length})`,
            }),
          },
        ]}
        activeTab={activeTab}
        onChange={(tabId) => setActiveTab(tabId as AccessKeysTab)}
      />

      {activeTab === "connect" && showStarterGuide ? (
        <section className="ui-surface-muted p-4" aria-labelledby="portal-external-tool-guide">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <h2 id="portal-external-tool-guide" className={cx("text-sm font-bold", uiTitleTextClass)}>
                {t({ en: "Before connecting a tool", fr: "Avant de connecter un outil", de: "Vor dem Verbinden eines Werkzeugs" })}
              </h2>
              <p className={cx("mt-1 ui-caption", uiMutedTextClass)}>
                {t({
                  en: "Use Portal sharing when a collaborator can sign in. Use tool access for apps, scripts, or partners that need a direct storage client.",
                  fr: "Utilisez le partage Portal lorsqu'un collaborateur peut se connecter. Utilisez l'accès outil pour les applications, scripts ou partenaires qui ont besoin d'un client de stockage direct.",
                  de: "Nutzen Sie Portal-Freigaben, wenn Mitwirkende sich anmelden können. Werkzeugzugriff ist für Apps, Skripte oder Partner mit direktem Speicherclient gedacht.",
                })}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <span className={cx("rounded-md px-2 py-1 ui-caption font-semibold", uiPanelMutedClass)}>
                {t({ en: "Secrets are shown once", fr: "Secrets affichés une seule fois", de: "Secrets nur einmal sichtbar" })}
              </span>
              <UiButton type="button" size="xs" variant="ghost" onClick={dismissGuide}>
                {t({ en: "Dismiss guide", fr: "Masquer le guide", de: "Anleitung ausblenden" })}
              </UiButton>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="min-w-0">
              <div className={uiLabelClass}>{t({ en: "1. Pick the space", fr: "1. Choisir l'espace", de: "1. Bereich wählen" })}</div>
              <p className={cx("mt-1 text-xs", uiMutedTextClass)}>
                {t({
                  en: "Start with the space that contains the files the tool should reach.",
                  fr: "Commencez par l'espace qui contient les fichiers que l'outil doit atteindre.",
                  de: "Beginnen Sie mit dem Bereich, dessen Dateien das Werkzeug erreichen soll.",
                })}
              </p>
            </div>
            <div className="min-w-0">
              <div className={uiLabelClass}>{t({ en: "2. Limit the access", fr: "2. Limiter l'accès", de: "2. Zugriff begrenzen" })}</div>
              <p className={cx("mt-1 text-xs", uiMutedTextClass)}>
                {t({
                  en: "Choose read only unless the tool really needs to upload or delete files.",
                  fr: "Choisissez lecture seule sauf si l'outil doit vraiment ajouter ou supprimer des fichiers.",
                  de: "Wählen Sie Nur lesen, außer das Werkzeug muss wirklich Dateien hochladen oder löschen.",
                })}
              </p>
            </div>
            <div className="min-w-0">
              <div className={uiLabelClass}>{t({ en: "3. Download setup details", fr: "3. Télécharger les détails", de: "3. Details herunterladen" })}</div>
              <p className={cx("mt-1 text-xs", uiMutedTextClass)}>
                {t({
                  en: "Download a ready-to-use setup file, then paste the one-time secret into the tool.",
                  fr: "Téléchargez un fichier de configuration prêt à l'emploi, puis collez le secret à usage unique dans l'outil.",
                  de: "Laden Sie eine fertige Einrichtungsdatei herunter und fügen Sie das einmalige Secret im Werkzeug ein.",
                })}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {createdKey?.secret_access_key && (
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
              label: t({ en: "Access ID", fr: "ID d'accès", de: "Zugriffs-ID" }),
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

      {activeTab === "connect" && state && hasAccountContext ? (
        <section className="ui-surface-card space-y-4 p-4" aria-labelledby="portal-external-tool-access">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 id="portal-external-tool-access" className={cx("text-sm font-bold", uiTitleTextClass)}>
                {t({ en: "Connect an external tool", fr: "Connecter un outil externe", de: "Externes Werkzeug verbinden" })}
              </h2>
              <p className={cx("mt-1 ui-caption", uiMutedTextClass)}>
                {t({
                  en: "Choose who the external app represents, pick the space it should reach, then download setup details for the app.",
                  fr: "Choisissez qui l'application externe représente, l'espace qu'elle doit atteindre, puis téléchargez les détails de configuration.",
                  de: "Wählen Sie, wen die externe App vertritt, welchen Bereich sie erreichen soll, und laden Sie dann die Einrichtungsdetails herunter.",
                })}
              </p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className={cx("min-w-0 p-3", uiPanelMutedClass)}>
              <div className={uiLabelClass}>{t({ en: "1. Select access", fr: "1. Sélectionner l'accès", de: "1. Zugriff wählen" })}</div>
              <p className={cx("mt-1 text-xs", uiMutedTextClass)}>
                {t({
                  en: "Use your own access for personal apps, or create a limited access for a collaborator or partner.",
                  fr: "Utilisez votre propre accès pour vos applications, ou créez un accès limité pour un collaborateur ou partenaire.",
                  de: "Nutzen Sie Ihren eigenen Zugriff für persönliche Apps oder erstellen Sie begrenzten Zugriff für Mitwirkende oder Partner.",
                })}
              </p>
            </div>
            <div className={cx("min-w-0 p-3", uiPanelMutedClass)}>
              <div className={uiLabelClass}>{t({ en: "2. Choose space", fr: "2. Choisir l'espace", de: "2. Bereich wählen" })}</div>
              <p className={cx("mt-1 text-xs", uiMutedTextClass)}>
                {t({
                  en: "Keep the app focused on the files it needs instead of exposing the whole project.",
                  fr: "Gardez l'application centrée sur les fichiers nécessaires plutôt que d'exposer tout le projet.",
                  de: "Beschränken Sie die App auf die benötigten Dateien, statt das ganze Projekt offenzulegen.",
                })}
              </p>
            </div>
            <div className={cx("min-w-0 p-3", uiPanelMutedClass)}>
              <div className={uiLabelClass}>{t({ en: "3. Download setup", fr: "3. Télécharger la configuration", de: "3. Einrichtung laden" })}</div>
              <p className={cx("mt-1 text-xs", uiMutedTextClass)}>
                {t({
                  en: "Use the ready-made file when possible; open manual details only when the app asks for them.",
                  fr: "Utilisez le fichier prêt à l'emploi si possible; ouvrez les détails manuels seulement si l'application les demande.",
                  de: "Nutzen Sie möglichst die fertige Datei; öffnen Sie manuelle Details nur, wenn die App danach fragt.",
                })}
              </p>
            </div>
          </div>

          <div className={cx("flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between", uiPanelMutedClass)}>
            <div className="min-w-0">
              <p className={cx("ui-body font-semibold", uiTitleTextClass)}>
                {t({ en: "Ready to set up an app?", fr: "Prêt à configurer une application ?", de: "Bereit, eine App einzurichten?" })}
              </p>
              <p className={cx("mt-1 ui-caption", uiMutedTextClass)}>
                {t({
                  en: "Open a focused dialog to pick the access, choose the space, and download the setup file.",
                  fr: "Ouvrez une fenêtre dédiée pour choisir l'accès, sélectionner l'espace et télécharger le fichier de configuration.",
                  de: "Öffnen Sie einen fokussierten Dialog, um Zugriff und Bereich auszuwählen und die Einrichtung herunterzuladen.",
                })}
              </p>
            </div>
            <UiButton type="button" onClick={() => setConnectionDialogOpen(true)}>
              {t({ en: "Download setup", fr: "Télécharger la configuration", de: "Einrichtung herunterladen" })}
            </UiButton>
          </div>
        </section>
      ) : null}

      {connectionDialogOpen && activeTab === "connect" && state && hasAccountContext ? (
        <Modal
          title={t({ en: "Download setup details", fr: "Télécharger les détails de configuration", de: "Einrichtungsdetails herunterladen" })}
          onClose={() => setConnectionDialogOpen(false)}
          maxWidthClass="max-w-3xl"
        >
          <div className="space-y-4">
            <p className={cx("ui-caption", uiMutedTextClass)}>
              {t({
                en: "Choose who the external app represents, pick the space it should reach, then download the file or details the app needs.",
                fr: "Choisissez qui l'application externe représente, l'espace qu'elle doit atteindre, puis téléchargez le fichier ou les détails nécessaires.",
                de: "Wählen Sie, wen die externe App vertritt, welchen Bereich sie erreichen soll, und laden Sie die benötigten Dateien oder Details herunter.",
              })}
            </p>
            {selectedConnectionKeyBucket ? (
              <span className={cx("inline-flex rounded-md px-2 py-1 ui-caption font-semibold", uiPanelMutedClass)}>
                {t({ en: "Space fixed for this access", fr: "Espace fixé pour cet accès", de: "Bereich für diesen Zugriff festgelegt" })}
              </span>
            ) : null}
            {connectionSpacesError ? <PageBanner tone="warning">{connectionSpacesError}</PageBanner> : null}

            <div className="grid gap-3 lg:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)]">
              <label className="space-y-1">
                <span className={uiLabelClass}>{t({ en: "Tool access", fr: "Accès outil", de: "Werkzeugzugriff" })}</span>
                <select
                  className={uiInputClass}
                  value={selectedConnectionKey?.access_key_id ?? ""}
                  onChange={(event) => setConnectionKeyId(event.target.value)}
                  aria-label={t({ en: "Connection tool access", fr: "Accès outil de connexion", de: "Werkzeugzugriff für Verbindung" })}
                  disabled={activeKeys.length === 0}
                >
                  {activeKeys.length === 0 ? (
                    <option value="">{t({ en: "No active access", fr: "Aucun accès actif", de: "Kein aktiver Zugriff" })}</option>
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
            </div>

            <div className="flex flex-wrap gap-2">
              <UiButton
                type="button"
                variant="secondary"
                onClick={handleDownloadCyberduckBookmark}
                disabled={!selectedConnection || !selectedConnection.endpoint}
              >
                {t({ en: "Cyberduck bookmark", fr: "Favori Cyberduck", de: "Cyberduck-Bookmark" })}
              </UiButton>
              <UiButton
                type="button"
                variant="secondary"
                onClick={() => handleDownloadConnectionSheet(false)}
                disabled={!selectedConnection}
              >
                {t({ en: "Connection details", fr: "Détails de connexion", de: "Verbindungsdetails" })}
              </UiButton>
              {showSecretConnectionDownload ? (
                <UiButton type="button" variant="warning" onClick={() => handleDownloadConnectionSheet(true)}>
                  {t({ en: "Details with secret", fr: "Détails avec secret", de: "Details mit Secret" })}
                </UiButton>
              ) : null}
            </div>

            {cyberduckBookmarkUnavailable ? (
              <PageBanner tone="info">
                {t({
                  en: "Cyberduck bookmark download is unavailable because this storage service does not expose a valid service address here. Generic connection details are still available.",
                  fr: "Le téléchargement du favori Cyberduck est indisponible car ce service de stockage n'expose pas d'adresse de service valide ici. Les détails de connexion génériques restent disponibles.",
                  de: "Der Cyberduck-Bookmark ist nicht verfügbar, weil hier keine gültige Serviceadresse bereitsteht. Allgemeine Verbindungsdetails sind weiterhin verfügbar.",
                })}
              </PageBanner>
            ) : null}

            <details className={cx("group p-3", uiPanelMutedClass)}>
              <summary className={cx("cursor-pointer ui-body font-semibold", uiTitleTextClass)}>
                {t({ en: "Manual setup details", fr: "Détails de configuration manuelle", de: "Manuelle Einrichtungsdetails" })}
              </summary>
              <p className={cx("mt-1 ui-caption", uiMutedTextClass)}>
                {t({
                  en: "Open these only when an app asks for a service address, storage name, access ID, or secret.",
                  fr: "Ouvrez-les uniquement lorsqu'une application demande une adresse de service, un nom de stockage, un ID d'accès ou un secret.",
                  de: "Öffnen Sie dies nur, wenn eine App nach Serviceadresse, Speichername, Zugriffs-ID oder Secret fragt.",
                })}
              </p>
              <dl className="mt-3 grid gap-3 ui-caption md:grid-cols-4">
                <div>
                  <dt className={uiMutedTextClass}>{t({ en: "Service address", fr: "Adresse du service", de: "Serviceadresse" })}</dt>
                  <dd className={cx("break-all font-semibold", uiTitleTextClass)}>{connectionEndpointLabel}</dd>
                </div>
                <div>
                  <dt className={uiMutedTextClass}>{t({ en: "Space", fr: "Espace", de: "Bereich" })}</dt>
                  <dd className={cx("break-all font-semibold", uiTitleTextClass)}>{selectedConnection?.storageSpaceName ?? "-"}</dd>
                </div>
                <div>
                  <dt className={uiMutedTextClass}>{t({ en: "Storage name", fr: "Nom de stockage", de: "Speichername" })}</dt>
                  <dd className={cx("break-all font-mono font-semibold", uiTitleTextClass)}>{selectedConnection?.bucketName ?? "-"}</dd>
                </div>
                <div>
                  <dt className={uiMutedTextClass}>{t({ en: "Secret", fr: "Secret", de: "Secret" })}</dt>
                  <dd className={cx("font-semibold", uiTitleTextClass)}>
                    {!selectedConnection
                      ? t({ en: "Create or enable access first", fr: "Créez ou activez d'abord un accès", de: "Erstellen oder aktivieren Sie zuerst einen Zugriff" })
                      : showSecretConnectionDownload
                      ? t({ en: "Available once for this new access", fr: "Disponible une fois pour ce nouvel accès", de: "Einmalig für diesen neuen Zugriff verfügbar" })
                      : t({ en: "Not shown again", fr: "Non réaffiché", de: "Wird nicht erneut angezeigt" })}
                  </dd>
                </div>
              </dl>
            </details>
          </div>
        </Modal>
      ) : null}

      {activeTab === "access-list" && accountLoading ? (
        <PageBanner tone="info">{t({ en: "Loading project...", fr: "Chargement du projet...", de: "Projekt wird geladen..." })}</PageBanner>
      ) : activeTab === "access-list" && !hasAccountContext ? (
        <PageEmptyState
          title={t({ en: "Select a project before connecting external tools", fr: "Sélectionnez un projet avant de connecter des outils externes", de: "Wählen Sie ein Projekt aus, bevor Sie externe Werkzeuge verbinden" })}
          description={t({ en: "External-tool access is scoped to the selected project.", fr: "L'accès aux outils externes est limité au projet sélectionné.", de: "Werkzeugzugriff ist auf das ausgewählte Projekt beschränkt." })}
          tone="warning"
        />
      ) : activeTab === "access-list" ? (
        <div className="ui-surface-card">
          <ListToolbar
            title={t({ en: "Tool access", fr: "Accès outil", de: "Werkzeugzugriff" })}
            description={
              t({
                en: "Store secrets when they are created; they cannot be shown again. Portal's own runtime access is hidden from this list.",
                fr: "Enregistrez les secrets à la création; ils ne pourront plus être affichés. L'accès runtime propre à Portal est masqué dans cette liste.",
                de: "Speichern Sie Secrets beim Erstellen; sie können nicht erneut angezeigt werden. Portals eigener Laufzeitzugriff ist in dieser Liste ausgeblendet.",
              })
            }
            showHeading={false}
            countLabel={t({ en: `${visibleKeys.length}/${maxAccessKeys || "-"} access`, fr: `${visibleKeys.length}/${maxAccessKeys || "-"} accès`, de: `${visibleKeys.length}/${maxAccessKeys || "-"} Zugriffe` })}
          />
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
                !isKeyActive(key) && "bg-slate-50/70 dark:bg-slate-900/40"
              )
            }
            responsiveCards
          />
        </div>
      ) : null}

      {createWizardOpen ? (
        <WorkflowPage
          title={t({ en: "Create tool access", fr: "Créer un accès outil", de: "Werkzeugzugriff erstellen" })}
          description={t({
            en: "Choose the recipient, scope and permissions, then keep the one-time secret visible until you are done.",
            fr: "Choisissez le destinataire, le périmètre et les droits, puis conservez le secret à usage unique jusqu'à la fin.",
            de: "Wählen Sie Empfänger, Umfang und Rechte und behalten Sie das einmalige Geheimnis bis zum Abschluss sichtbar.",
          })}
          breadcrumbs={[
            { label: "Portal" },
            { label: t({ en: "Tool access", fr: "Accès outil", de: "Werkzeugzugriff" }), to: "/portal/access-keys" },
            { label: t({ en: "Create", fr: "Créer", de: "Erstellen" }) },
          ]}
          backLabel={t({ en: "Back to tool access", fr: "Retour aux accès outil", de: "Zurück zum Werkzeugzugriff" })}
          onBack={busy === "create" ? undefined : closeCreateWizard}
          contentClassName="mx-auto max-w-5xl"
        >
          <div className="space-y-4">
            {error ? <PageBanner tone="error">{error}</PageBanner> : null}
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
    </div>
  );
}
