/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createPortalAccessKey,
  createPortalProjectAccessKey,
  deletePortalAccessKey,
  deletePortalProjectAccessKey,
  fetchPortalAccessKeysState,
  fetchPortalProjectAccessKeysState,
  isPortalProjectSelector,
  updatePortalAccessKeyStatus,
  updatePortalProjectAccessKeyStatus,
  type PortalAccessKey,
  type PortalAccessKeyScope,
  type PortalAccessKeysState,
  type PortalProjectAccessKeysState,
} from "../../api/portal";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import ListToolbar from "../../components/ListToolbar";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import TableEmptyState from "../../components/TableEmptyState";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import { cx, type UiTone, uiMutedTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { copyTextToClipboard } from "../../utils/clipboard";
import { usePortalAccountContext } from "./PortalAccountContext";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import { portalAccessKeyStatusLabel, portalDateTimeLabel } from "./portalI18n";

type PendingAccessKeyAction =
  | { type: "disable"; key: PortalAccessKey; scope?: PortalAccessKeyScope }
  | { type: "delete"; key: PortalAccessKey; scope?: PortalAccessKeyScope };

function isKeyActive(key: PortalAccessKey): boolean {
  if (typeof key.is_active === "boolean") {
    return key.is_active;
  }
  const normalized = (key.status || "").toLowerCase();
  if (["inactive", "disabled", "suspended"].includes(normalized)) return false;
  if (["active", "enabled"].includes(normalized)) return true;
  return true;
}

function visibleExternalKeys(keys: PortalAccessKey[] | undefined): PortalAccessKey[] {
  return (keys ?? []).filter((key) => !key.is_portal);
}

function busyKey(prefix: "create" | "delete" | "toggle", keyOrScope?: PortalAccessKey | PortalAccessKeyScope): string {
  if (!keyOrScope) return `${prefix}:account`;
  if ("scope_id" in keyOrScope) return `${prefix}:${keyOrScope.scope_id}`;
  return `${prefix}:account:${keyOrScope.access_key_id}`;
}

function scopedBusyKey(prefix: "delete" | "toggle", scope: PortalAccessKeyScope | undefined, key: PortalAccessKey): string {
  return `${prefix}:${scope?.scope_id ?? "account"}:${key.access_key_id}`;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    if (!value) return;
    try {
      await copyTextToClipboard(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center rounded-full bg-slate-900 px-3 py-1 ui-caption font-semibold text-white shadow-sm transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
    >
      {copied ? t({ en: "Copied", fr: "Copié", de: "Kopiert" }) : label}
    </button>
  );
}

function accessKeyStatusTone(active: boolean): UiTone {
  return active ? "success" : "neutral";
}

export default function PortalAccessKeysPage() {
  const { locale, t } = useI18n();
  const { accountIdForApi, hasAccountContext, loading: accountLoading, error: accountError } = usePortalAccountContext();
  const isProjectContext = Boolean(accountIdForApi && isPortalProjectSelector(accountIdForApi));
  const [state, setState] = useState<PortalAccessKeysState | null>(null);
  const [projectState, setProjectState] = useState<PortalProjectAccessKeysState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<PortalAccessKey | null>(null);
  const [createdScopeLabel, setCreatedScopeLabel] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAccessKeyAction | null>(null);

  const loadKeys = useCallback(async () => {
    if (!hasAccountContext || !accountIdForApi) {
      setState(null);
      setProjectState(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (isPortalProjectSelector(accountIdForApi)) {
        const data = await fetchPortalProjectAccessKeysState(accountIdForApi);
        setProjectState(data);
        setState(null);
      } else {
        const data = await fetchPortalAccessKeysState(accountIdForApi);
        setState(data);
        setProjectState(null);
      }
    } catch (err) {
      console.error(err);
      setState(null);
      setProjectState(null);
      setError(extractApiError(err, t({ en: "Unable to load access keys.", fr: "Impossible de charger les clés d'accès.", de: "Zugriffsschlüssel können nicht geladen werden." })));
    } finally {
      setLoading(false);
    }
  }, [accountIdForApi, hasAccountContext]);

  useEffect(() => {
    setCreatedKey(null);
    setCreatedScopeLabel(null);
    setActionMessage(null);
    void loadKeys();
  }, [loadKeys]);

  const visibleKeys = useMemo(() => visibleExternalKeys(state?.access_keys), [state?.access_keys]);
  const canManageAccessKeys = Boolean(state?.can_manage_access_keys);
  const maxAccessKeys = state?.max_access_keys ?? 0;
  const maxReached = maxAccessKeys > 0 && visibleKeys.length >= maxAccessKeys;
  const tableStatus = resolveListTableStatus({ loading, error, rowCount: visibleKeys.length });

  const handleCreateKey = async () => {
    if (!accountIdForApi || !canManageAccessKeys || maxReached) return;
    setBusy(busyKey("create"));
    setError(null);
    setActionMessage(null);
    setCreatedScopeLabel(null);
    try {
      const key = await createPortalAccessKey(accountIdForApi);
      setCreatedKey(key);
      setActionMessage(t({ en: "Access key created", fr: "Clé d'accès créée", de: "Zugriffsschlüssel erstellt" }));
      await loadKeys();
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, t({ en: "Unable to create access key.", fr: "Impossible de créer la clé d'accès.", de: "Zugriffsschlüssel kann nicht erstellt werden." })));
    } finally {
      setBusy(null);
    }
  };

  const handleCreateProjectKey = async (scope: PortalAccessKeyScope) => {
    const keys = visibleExternalKeys(scope.access_keys);
    const scopeMaxReached = scope.max_access_keys > 0 && keys.length >= scope.max_access_keys;
    if (!accountIdForApi || !scope.can_manage_access_keys || scope.unavailable_reason || scopeMaxReached) return;
    setBusy(busyKey("create", scope));
    setError(null);
    setActionMessage(null);
    try {
      const key = await createPortalProjectAccessKey(accountIdForApi, scope.scope_id);
      setCreatedKey(key);
      setCreatedScopeLabel(scope.label);
      setActionMessage(t({ en: "Access key created", fr: "Clé d'accès créée", de: "Zugriffsschlüssel erstellt" }));
      await loadKeys();
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, t({ en: "Unable to create access key.", fr: "Impossible de créer la clé d'accès.", de: "Zugriffsschlüssel kann nicht erstellt werden." })));
    } finally {
      setBusy(null);
    }
  };

  const updateKeyStatus = async (key: PortalAccessKey, active: boolean, scope?: PortalAccessKeyScope) => {
    const canManage = scope ? scope.can_manage_access_keys && !scope.unavailable_reason : canManageAccessKeys;
    if (!accountIdForApi || !canManage || key.is_portal) return;
    setBusy(scopedBusyKey("toggle", scope, key));
    setError(null);
    setActionMessage(null);
    try {
      if (scope) {
        await updatePortalProjectAccessKeyStatus(accountIdForApi, scope.scope_id, key.access_key_id, active);
      } else {
        await updatePortalAccessKeyStatus(accountIdForApi, key.access_key_id, active);
      }
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

  const handleToggleKey = (key: PortalAccessKey, scope?: PortalAccessKeyScope) => {
    const canManage = scope ? scope.can_manage_access_keys && !scope.unavailable_reason : canManageAccessKeys;
    if (!accountIdForApi || !canManage || key.is_portal) return;
    const active = isKeyActive(key);
    if (active) {
      setPendingAction({ type: "disable", key, scope });
      return;
    }
    void updateKeyStatus(key, true, scope);
  };

  const handleDeleteKey = (key: PortalAccessKey, scope?: PortalAccessKeyScope) => {
    const canManage = scope ? scope.can_manage_access_keys && !scope.unavailable_reason : canManageAccessKeys;
    if (!accountIdForApi || !canManage || key.is_portal) return;
    setPendingAction({ type: "delete", key, scope });
  };

  const confirmDeleteKey = async (key: PortalAccessKey, scope?: PortalAccessKeyScope) => {
    const canManage = scope ? scope.can_manage_access_keys && !scope.unavailable_reason : canManageAccessKeys;
    if (!accountIdForApi || !canManage || key.is_portal) return;
    setBusy(scopedBusyKey("delete", scope, key));
    setError(null);
    setActionMessage(null);
    try {
      if (scope) {
        await deletePortalProjectAccessKey(accountIdForApi, scope.scope_id, key.access_key_id);
      } else {
        await deletePortalAccessKey(accountIdForApi, key.access_key_id);
      }
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

  const createDisabled = !state || !canManageAccessKeys || maxReached || Boolean(busy);
  const actionEndpointLabel = pendingAction?.scope?.s3_endpoint ?? state?.s3_endpoint ?? t({ en: "Configured storage service", fr: "Service de stockage configuré", de: "Konfigurierter Speicherdienst" });
  const projectHasScopes = Boolean(projectState?.scopes.length);

  const renderKeyRows = (keys: PortalAccessKey[], scope?: PortalAccessKeyScope) => {
    const scopedCanManage = scope ? scope.can_manage_access_keys && !scope.unavailable_reason : canManageAccessKeys;
    return keys.map((key) => {
      const active = isKeyActive(key);
      const disabled = Boolean(busy) || !scopedCanManage;
      const statusLabel = portalAccessKeyStatusLabel(key.status, active, t);
      const createdLabel = portalDateTimeLabel(key.created_at, locale);
      return (
        <tr
          key={`${scope?.scope_id ?? "account"}:${key.access_key_id}`}
          className={cx(
            "hover:bg-slate-50 dark:hover:bg-slate-800/50 max-md:block max-md:w-full max-md:rounded-md max-md:border max-md:border-[color:var(--ui-border)] max-md:bg-[color:var(--ui-surface)] max-md:p-3",
            active ? "" : "bg-slate-50/70 dark:bg-slate-800/40"
          )}
        >
          <td className="manager-table-cell max-w-[18rem] break-all px-6 py-4 font-mono text-slate-800 dark:text-slate-100 max-md:block max-md:max-w-full max-md:border-0 max-md:p-0">
            <span className={cx("hidden font-sans text-[11px] font-semibold max-md:block", uiMutedTextClass)}>
              {t({ en: "Access key", fr: "Clé d'accès", de: "Zugriffsschlüssel" })}
            </span>
            {key.access_key_id}
          </td>
          <td className="manager-table-cell px-6 py-4 ui-body text-slate-700 dark:text-slate-200 max-md:mt-3 max-md:block max-md:border-0 max-md:p-0">
            <span className={cx("hidden text-[11px] font-semibold max-md:block", uiMutedTextClass)}>
              {t({ en: "Status", fr: "Statut", de: "Status" })}
            </span>
            <UiBadge tone={accessKeyStatusTone(active)}>{statusLabel}</UiBadge>
          </td>
          <td className="manager-table-cell px-6 py-4 ui-body text-slate-600 dark:text-slate-300 max-md:mt-3 max-md:block max-md:border-0 max-md:p-0">
            <span className={cx("hidden text-[11px] font-semibold max-md:block", uiMutedTextClass)}>
              {t({ en: "Created on", fr: "Créée le", de: "Erstellt am" })}
            </span>
            {createdLabel}
          </td>
          <td className="px-6 py-4 text-right max-md:mt-3 max-md:block max-md:border-0 max-md:p-0 max-md:text-left">
            <span className={cx("hidden text-[11px] font-semibold max-md:block", uiMutedTextClass)}>
              {t({ en: "Actions", fr: "Actions", de: "Aktionen" })}
            </span>
            <div className="flex flex-wrap justify-end gap-2 max-md:justify-start">
              <button
                type="button"
                onClick={() => handleToggleKey(key, scope)}
                className={tableActionButtonClasses}
                disabled={disabled}
              >
                {busy === scopedBusyKey("toggle", scope, key)
                  ? t({ en: "Saving...", fr: "Enregistrement...", de: "Wird gespeichert..." })
                  : active
                    ? t({ en: "Disable", fr: "Désactiver", de: "Deaktivieren" })
                    : t({ en: "Enable", fr: "Activer", de: "Aktivieren" })}
              </button>
              <button
                type="button"
                onClick={() => handleDeleteKey(key, scope)}
                className={tableDeleteActionClasses}
                disabled={disabled}
              >
                {busy === scopedBusyKey("delete", scope, key) ? t({ en: "Deleting...", fr: "Suppression...", de: "Wird gelöscht..." }) : t({ en: "Delete", fr: "Supprimer", de: "Löschen" })}
              </button>
            </div>
          </td>
        </tr>
      );
    });
  };

  const renderKeysTable = (keys: PortalAccessKey[], status: ReturnType<typeof resolveListTableStatus>, scope?: PortalAccessKeyScope) => (
    <table className="ui-data-table min-w-[720px] max-md:block max-md:w-full max-md:min-w-0">
      <thead className="max-md:hidden">
        <tr>
          <th>
            {t({ en: "Access key", fr: "Clé d'accès", de: "Zugriffsschlüssel" })}
          </th>
          <th>
            {t({ en: "Status", fr: "Statut", de: "Status" })}
          </th>
          <th>
            {t({ en: "Created on", fr: "Créée le", de: "Erstellt am" })}
          </th>
          <th className="text-right">
            {t({ en: "Actions", fr: "Actions", de: "Aktionen" })}
          </th>
        </tr>
      </thead>
      <tbody className="max-md:block max-md:w-full max-md:space-y-3">
        {status === "loading" && <TableEmptyState colSpan={4} message={t({ en: "Loading keys...", fr: "Chargement des clés...", de: "Schlüssel werden geladen..." })} />}
        {status === "error" && <TableEmptyState colSpan={4} message={t({ en: "Unable to load keys.", fr: "Impossible de charger les clés.", de: "Schlüssel können nicht geladen werden." })} tone="error" />}
        {status === "empty" && <TableEmptyState colSpan={4} message={t({ en: "No external access keys yet. Create a key when you need to connect an external S3 tool.", fr: "Aucune clé d'accès externe pour le moment. Créez une clé lorsque vous devez connecter un outil S3 externe.", de: "Noch keine externen Zugriffsschlüssel. Erstellen Sie einen Schlüssel, wenn Sie ein externes S3-Werkzeug verbinden müssen." })} />}
        {renderKeyRows(keys, scope)}
      </tbody>
    </table>
  );

  const renderProjectScope = (scope: PortalAccessKeyScope) => {
    const keys = visibleExternalKeys(scope.access_keys);
    const scopeMaxReached = scope.max_access_keys > 0 && keys.length >= scope.max_access_keys;
    const scopeCanCreate = scope.can_manage_access_keys && !scope.unavailable_reason && !scopeMaxReached && !busy;
    const countLabel = t({ en: `${keys.length}/${scope.max_access_keys || "-"} key(s)`, fr: `${keys.length}/${scope.max_access_keys || "-"} clé(s)`, de: `${keys.length}/${scope.max_access_keys || "-"} Schlüssel` });
    const accountLabels = scope.accounts
      .map((account) => account.display_name || account.account_name)
      .filter(Boolean);
    const scopeKindLabel = scope.zonegroup
      ? t({ en: "Storage zone", fr: "Zone de stockage", de: "Speicherzone" })
      : t({ en: "Storage zone not configured", fr: "Zone de stockage non configurée", de: "Speicherzone nicht konfiguriert" });
    const status = resolveListTableStatus({
      loading: loading && !projectState,
      error: error && !projectState ? error : null,
      rowCount: keys.length,
    });
    return (
      <div key={scope.scope_id} className="ui-surface-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[color:var(--ui-border-soft)] px-4 py-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <UiBadge tone={scope.zonegroup ? "neutral" : "warning"}>{scopeKindLabel}</UiBadge>
              <h2 className="min-w-0 break-words ui-body font-semibold text-[var(--ui-text)]">{scope.label}</h2>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 ui-caption text-[var(--ui-text-muted)]">
              <span className="font-semibold">{t({ en: "Endpoint", fr: "Endpoint", de: "Endpoint" })}</span>
              {scope.s3_endpoint ? (
                <span className="min-w-0 max-w-full break-all font-mono text-[var(--ui-text)]">{scope.s3_endpoint}</span>
              ) : (
                <span>{t({ en: "No S3 endpoint is available", fr: "Aucun endpoint S3 disponible", de: "Kein S3-Endpunkt verfügbar" })}</span>
              )}
            </div>
            {accountLabels.length > 0 && (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="ui-caption font-semibold text-[var(--ui-text-muted)]">
                  {t({ en: "Storage locations", fr: "Localisations de stockage", de: "Speicherorte" })}
                </span>
                {accountLabels.map((label) => (
                  <UiBadge key={label} tone="neutral">{label}</UiBadge>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <UiBadge tone="neutral">{countLabel}</UiBadge>
            <UiButton
              onClick={() => handleCreateProjectKey(scope)}
              size="sm"
              disabled={!scopeCanCreate}
            >
              {busy === busyKey("create", scope)
                ? t({ en: "Creating...", fr: "Création...", de: "Wird erstellt..." })
                : t({ en: "New key", fr: "Nouvelle clé", de: "Neuer Schlüssel" })}
            </UiButton>
          </div>
        </div>

        <div className="space-y-3 p-4">
          {scope.unavailable_reason && <PageBanner tone="warning">{scope.unavailable_reason}</PageBanner>}
          {!scope.unavailable_reason && !scope.can_manage_access_keys && (
            <PageBanner tone="warning">{t({ en: "Access-key management is disabled for this project scope.", fr: "La gestion des clés d'accès est désactivée pour ce périmètre projet.", de: "Die Verwaltung von Zugriffsschlüsseln ist für diesen Projekt-Scope deaktiviert." })}</PageBanner>
          )}
          {!scope.unavailable_reason && scope.can_manage_access_keys && scopeMaxReached && (
            <PageBanner tone="info">{t({ en: "The maximum number of project access keys has been reached for this storage zone.", fr: "Le nombre maximal de clés d'accès projet est atteint pour cette zone de stockage.", de: "Die maximale Anzahl von Projekt-Zugriffsschlüsseln ist für diese Speicherzone erreicht." })}</PageBanner>
          )}

          <div className="overflow-x-auto max-md:overflow-visible">
            {renderKeysTable(keys, status, scope)}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t({ en: "Access keys", fr: "Clés d'accès", de: "Zugriffsschlüssel" })}
        description={
          isProjectContext
            ? t({ en: "Create S3 access keys for external tools. Project keys are scoped by storage zone and inherit your Storage Space permissions.", fr: "Créez des clés d'accès S3 pour les outils externes. Les clés projet sont limitées par zone de stockage et héritent de vos droits sur les Storage Spaces.", de: "Erstellen Sie S3-Zugriffsschlüssel für externe Werkzeuge. Projektschlüssel sind auf eine Speicherzone begrenzt und erben Ihre Storage-Space-Rechte." })
            : t({ en: "Create S3 access keys for external tools. Use the endpoint shown here; each secret is shown only once.", fr: "Créez des clés d'accès S3 pour les outils externes. Utilisez l'endpoint indiqué ici; chaque secret n'est affiché qu'une seule fois.", de: "Erstellen Sie S3-Zugriffsschlüssel für externe Werkzeuge. Verwenden Sie den hier angezeigten Endpoint; jedes Secret wird nur einmal angezeigt." })
        }
        breadcrumbs={portalBreadcrumbs({ label: t({ en: "Access keys", fr: "Clés d'accès", de: "Zugriffsschlüssel" }) })}
        actions={
          isProjectContext
            ? []
            : [
                {
                  label: busy === busyKey("create") ? t({ en: "Creating...", fr: "Création...", de: "Wird erstellt..." }) : t({ en: "New key", fr: "Nouvelle clé", de: "Neuer Schlüssel" }),
                  onClick: handleCreateKey,
                  variant: "primary",
                  disabled: createDisabled,
                },
              ]
        }
      />

      {accountError && <PageBanner tone="error">{accountError}</PageBanner>}
      {error && <PageBanner tone="error">{error}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {isProjectContext && projectState && (
        <PageBanner tone="info">
          {t({ en: "Choose the storage zone that matches your external tool, create a key, then copy the secret immediately. The same key inherits your visible Storage Space permissions.", fr: "Choisissez la zone de stockage correspondant à votre outil externe, créez une clé, puis copiez immédiatement le secret. La clé hérite de vos droits sur les Storage Spaces visibles.", de: "Wählen Sie die Speicherzone für Ihr externes Werkzeug, erstellen Sie einen Schlüssel und kopieren Sie das Secret sofort. Der Schlüssel erbt Ihre Rechte auf sichtbare Storage Spaces." })}
        </PageBanner>
      )}
      {!isProjectContext && state && !canManageAccessKeys && (
        <PageBanner tone="warning">{t({ en: "Access-key management is disabled for this portal workspace.", fr: "La gestion des clés d'accès est désactivée pour ce workspace Portal.", de: "Die Verwaltung von Zugriffsschlüsseln ist für diesen Portal-Workspace deaktiviert." })}</PageBanner>
      )}
      {!isProjectContext && state && canManageAccessKeys && (
        <PageBanner tone="info">
          {t({ en: `Use endpoint ${state.s3_endpoint || "the configured storage service"} with these keys. Disabling pauses a key for external tools; deleting removes it permanently.`, fr: `Utilisez l'endpoint ${state.s3_endpoint || "du service de stockage configuré"} avec ces clés. La désactivation suspend une clé pour les outils externes; la suppression la retire définitivement.`, de: `Verwenden Sie den Endpoint ${state.s3_endpoint || "des konfigurierten Speicherdienstes"} mit diesen Schlüsseln. Deaktivieren pausiert einen Schlüssel für externe Werkzeuge; Löschen entfernt ihn dauerhaft.` })}
        </PageBanner>
      )}
      {!isProjectContext && state && canManageAccessKeys && maxReached && (
        <PageBanner tone="info">{t({ en: "The maximum number of portal user access keys has been reached.", fr: "Le nombre maximal de clés d'accès utilisateur Portal est atteint.", de: "Die maximale Anzahl von Portal-Benutzerzugriffsschlüsseln wurde erreicht." })}</PageBanner>
      )}

      {createdKey?.secret_access_key && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 ui-body text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/60 dark:text-amber-100">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">{t({ en: "Access key created", fr: "Clé d'accès créée", de: "Zugriffsschlüssel erstellt" })}</p>
              <p className="ui-caption text-amber-700 dark:text-amber-200">
                {createdScopeLabel
                  ? t({ en: `Scope: ${createdScopeLabel}. The secret is shown only once.`, fr: `Périmètre : ${createdScopeLabel}. Le secret n'est affiché qu'une seule fois.`, de: `Scope: ${createdScopeLabel}. Das Secret wird nur einmal angezeigt.` })
                  : t({ en: "The secret is shown only once.", fr: "Le secret n'est affiché qu'une seule fois.", de: "Das Secret wird nur einmal angezeigt." })}
              </p>
            </div>
            <span className="rounded-full bg-amber-100 px-3 py-1 ui-caption font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/40 dark:text-amber-100">
              {t({ en: "Copy these values now", fr: "Copiez ces valeurs maintenant", de: "Diese Werte jetzt kopieren" })}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <div className="ui-caption uppercase tracking-wide text-amber-600">{t({ en: "Access key", fr: "Clé d'accès", de: "Zugriffsschlüssel" })}</div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="max-w-full break-all rounded border border-amber-200 bg-white/80 px-3 py-2 font-mono ui-caption text-slate-800 dark:border-amber-800 dark:bg-amber-50/10 dark:text-amber-100">
                  {createdKey.access_key_id}
                </div>
                <CopyButton value={createdKey.access_key_id} label={t({ en: "Copy", fr: "Copier", de: "Kopieren" })} />
              </div>
            </div>
            <div>
              <div className="ui-caption uppercase tracking-wide text-amber-600">{t({ en: "Secret key", fr: "Clé secrète", de: "Geheimer Schlüssel" })}</div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="max-w-full break-all rounded border border-amber-200 bg-white/80 px-3 py-2 font-mono ui-caption text-slate-800 dark:border-amber-800 dark:bg-amber-50/10 dark:text-amber-100">
                  {createdKey.secret_access_key}
                </div>
                <CopyButton value={createdKey.secret_access_key} label={t({ en: "Copy", fr: "Copier", de: "Kopieren" })} />
              </div>
            </div>
          </div>
        </div>
      )}

      {accountLoading ? (
        <PageBanner tone="info">{t({ en: "Loading portal workspace...", fr: "Chargement du workspace Portal...", de: "Portal-Workspace wird geladen..." })}</PageBanner>
      ) : !hasAccountContext ? (
        <PageEmptyState
          title={t({ en: "Select a portal workspace before managing access keys", fr: "Sélectionnez un workspace Portal avant de gérer les clés d'accès", de: "Wählen Sie einen Portal-Workspace aus, bevor Sie Zugriffsschlüssel verwalten" })}
          description={t({ en: "Access keys are scoped to the selected portal workspace.", fr: "Les clés d'accès sont limitées au workspace Portal sélectionné.", de: "Zugriffsschlüssel sind auf den ausgewählten Portal-Workspace beschränkt." })}
          tone="warning"
        />
      ) : isProjectContext ? (
        <div className="space-y-4">
          {loading && !projectState && <PageBanner tone="info">{t({ en: "Loading project access-key scopes...", fr: "Chargement des périmètres de clés projet...", de: "Projekt-Zugriffsschlüssel-Scope werden geladen..." })}</PageBanner>}
          {!loading && projectState && !projectHasScopes && (
            <PageEmptyState
              title={t({ en: "No project storage scope is available", fr: "Aucun périmètre de stockage projet n'est disponible", de: "Kein Projekt-Speicher-Scope verfügbar" })}
              description={t({ en: "The selected project must be linked to at least one configured RGW Account before access keys can be created.", fr: "Le projet sélectionné doit être lié à au moins un RGW Account configuré avant de créer des clés d'accès.", de: "Das ausgewählte Projekt muss mit mindestens einem konfigurierten RGW Account verknüpft sein, bevor Zugriffsschlüssel erstellt werden können." })}
              tone="info"
            />
          )}
          {projectState?.scopes.map(renderProjectScope)}
        </div>
      ) : (
        <div className="ui-surface-card">
          <ListToolbar
            title={t({ en: "Keys", fr: "Clés", de: "Schlüssel" })}
            description={
              state?.s3_endpoint
                ? t({ en: `Use these keys with endpoint ${state.s3_endpoint}. Store secrets when they are created; they cannot be shown again. The portal key is hidden from this list.`, fr: `Utilisez ces clés avec l'endpoint ${state.s3_endpoint}. Enregistrez les secrets à la création; ils ne pourront plus être affichés. La clé Portal est masquée dans cette liste.`, de: `Verwenden Sie diese Schlüssel mit dem Endpoint ${state.s3_endpoint}. Speichern Sie Secrets beim Erstellen; sie können nicht erneut angezeigt werden. Der Portal-Schlüssel ist in dieser Liste ausgeblendet.` })
                : t({ en: "Store secrets when they are created; they cannot be shown again. The portal key is hidden from this list.", fr: "Enregistrez les secrets à la création; ils ne pourront plus être affichés. La clé Portal est masquée dans cette liste.", de: "Speichern Sie Secrets beim Erstellen; sie können nicht erneut angezeigt werden. Der Portal-Schlüssel ist in dieser Liste ausgeblendet." })
            }
            showHeading={false}
            countLabel={t({ en: `${visibleKeys.length}/${maxAccessKeys || "-"} key(s)`, fr: `${visibleKeys.length}/${maxAccessKeys || "-"} clé(s)`, de: `${visibleKeys.length}/${maxAccessKeys || "-"} Schlüssel` })}
          />
          <div className="overflow-x-auto max-md:overflow-visible">
            {renderKeysTable(visibleKeys, tableStatus)}
          </div>
        </div>
      )}

      {pendingAction?.type === "disable" ? (
        <ConfirmActionDialog
          title={t({ en: "Disable access key", fr: "Désactiver la clé d'accès", de: "Zugriffsschlüssel deaktivieren" })}
          description={t({ en: "Confirm that you want to disable this access key.", fr: "Confirmez que vous voulez désactiver cette clé d'accès.", de: "Bestätigen Sie, dass Sie diesen Zugriffsschlüssel deaktivieren möchten." })}
          confirmLabel={t({ en: "Disable key", fr: "Désactiver la clé", de: "Schlüssel deaktivieren" })}
          loading={busy === scopedBusyKey("toggle", pendingAction.scope, pendingAction.key)}
          details={[
            { label: t({ en: "Access key", fr: "Clé d'accès", de: "Zugriffsschlüssel" }), value: pendingAction.key.access_key_id, mono: true },
            ...(pendingAction.scope ? [{ label: t({ en: "Scope", fr: "Périmètre", de: "Scope" }), value: pendingAction.scope.label }] : []),
            { label: t({ en: "Endpoint", fr: "Endpoint", de: "Endpoint" }), value: actionEndpointLabel },
          ]}
          impacts={[
            t({ en: "External tools using this key stop authenticating until it is re-enabled.", fr: "Les outils externes utilisant cette clé ne pourront plus s'authentifier jusqu'à sa réactivation.", de: "Externe Werkzeuge mit diesem Schlüssel können sich nicht authentifizieren, bis er wieder aktiviert wird." }),
            t({ en: "The secret value cannot be displayed again from the Portal.", fr: "Le secret ne peut plus être affiché depuis le Portal.", de: "Das Secret kann im Portal nicht erneut angezeigt werden." }),
            t({ en: "The Portal itself is not affected.", fr: "Le Portal lui-même n'est pas affecté.", de: "Das Portal selbst ist nicht betroffen." }),
          ]}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => updateKeyStatus(pendingAction.key, false, pendingAction.scope)}
        />
      ) : null}

      {pendingAction?.type === "delete" ? (
        <ConfirmActionDialog
          title={t({ en: "Delete access key", fr: "Supprimer la clé d'accès", de: "Zugriffsschlüssel löschen" })}
          description={t({ en: "Confirm that you want to permanently delete this access key.", fr: "Confirmez que vous voulez supprimer définitivement cette clé d'accès.", de: "Bestätigen Sie, dass Sie diesen Zugriffsschlüssel dauerhaft löschen möchten." })}
          confirmLabel={t({ en: "Delete key", fr: "Supprimer la clé", de: "Schlüssel löschen" })}
          loading={busy === scopedBusyKey("delete", pendingAction.scope, pendingAction.key)}
          details={[
            { label: t({ en: "Access key", fr: "Clé d'accès", de: "Zugriffsschlüssel" }), value: pendingAction.key.access_key_id, mono: true },
            ...(pendingAction.scope ? [{ label: t({ en: "Scope", fr: "Périmètre", de: "Scope" }), value: pendingAction.scope.label }] : []),
            { label: t({ en: "Endpoint", fr: "Endpoint", de: "Endpoint" }), value: actionEndpointLabel },
          ]}
          impacts={[
            t({ en: "External tools using this key stop working immediately.", fr: "Les outils externes utilisant cette clé cessent immédiatement de fonctionner.", de: "Externe Werkzeuge mit diesem Schlüssel funktionieren sofort nicht mehr." }),
            t({ en: "The secret value cannot be recovered or shown again.", fr: "Le secret ne peut pas être récupéré ni affiché à nouveau.", de: "Das Secret kann nicht wiederhergestellt oder erneut angezeigt werden." }),
            t({ en: "This deletion cannot be undone from the Portal.", fr: "Cette suppression ne peut pas être annulée depuis le Portal.", de: "Diese Löschung kann im Portal nicht rückgängig gemacht werden." }),
          ]}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => confirmDeleteKey(pendingAction.key, pendingAction.scope)}
        />
      ) : null}
    </div>
  );
}
