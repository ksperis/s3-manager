/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createPortalAccessKey,
  deletePortalAccessKey,
  fetchPortalAccessKeysState,
  updatePortalAccessKeyStatus,
  type PortalAccessKey,
  type PortalAccessKeysState,
} from "../../api/portal";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import ListToolbar from "../../components/ListToolbar";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import TableEmptyState from "../../components/TableEmptyState";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { usePortalAccountContext } from "./PortalAccountContext";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import { portalAccessKeyStatusLabel, portalDateTimeLabel } from "./portalI18n";

type PendingAccessKeyAction =
  | { type: "disable"; key: PortalAccessKey }
  | { type: "delete"; key: PortalAccessKey };

function isKeyActive(key: PortalAccessKey): boolean {
  if (typeof key.is_active === "boolean") {
    return key.is_active;
  }
  const normalized = (key.status || "").toLowerCase();
  if (["inactive", "disabled", "suspended"].includes(normalized)) return false;
  if (["active", "enabled"].includes(normalized)) return true;
  return true;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const handleCopy = () => {
    if (!value || typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
    navigator.clipboard.writeText(value).catch(() => {});
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center rounded-full bg-slate-900 px-3 py-1 ui-caption font-semibold text-white shadow-sm transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
    >
      {label}
    </button>
  );
}

export default function PortalAccessKeysPage() {
  const { locale, t } = useI18n();
  const { accountIdForApi, hasAccountContext, loading: accountLoading, error: accountError } = usePortalAccountContext();
  const [state, setState] = useState<PortalAccessKeysState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<PortalAccessKey | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAccessKeyAction | null>(null);

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
  }, [accountIdForApi, hasAccountContext]);

  useEffect(() => {
    setCreatedKey(null);
    setActionMessage(null);
    void loadKeys();
  }, [loadKeys]);

  const visibleKeys = useMemo(() => (state?.access_keys ?? []).filter((key) => !key.is_portal), [state?.access_keys]);
  const canManageAccessKeys = Boolean(state?.can_manage_access_keys);
  const maxAccessKeys = state?.max_access_keys ?? 0;
  const maxReached = maxAccessKeys > 0 && visibleKeys.length >= maxAccessKeys;
  const tableStatus = resolveListTableStatus({ loading, error, rowCount: visibleKeys.length });

  const handleCreateKey = async () => {
    if (!accountIdForApi || !canManageAccessKeys || maxReached) return;
    setBusy("create");
    setError(null);
    setActionMessage(null);
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

  const createDisabled = !state || !canManageAccessKeys || maxReached || Boolean(busy);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t({ en: "Access keys", fr: "Clés d'accès", de: "Zugriffsschlüssel" })}
        description={t({ en: "Create S3 access keys for external tools. Use the endpoint shown here; each secret is shown only once.", fr: "Créez des clés d'accès S3 pour les outils externes. Utilisez le point de terminaison indiqué ici; chaque secret n'est affiché qu'une seule fois.", de: "Erstellen Sie S3-Zugriffsschlüssel für externe Werkzeuge. Verwenden Sie den hier angezeigten Endpunkt; jedes Secret wird nur einmal angezeigt." })}
        breadcrumbs={portalBreadcrumbs({ label: t({ en: "Access keys", fr: "Clés d'accès", de: "Zugriffsschlüssel" }) })}
        actions={[
          {
            label: busy === "create" ? t({ en: "Creating...", fr: "Création...", de: "Wird erstellt..." }) : t({ en: "New key", fr: "Nouvelle clé", de: "Neuer Schlüssel" }),
            onClick: handleCreateKey,
            variant: "primary",
            disabled: createDisabled,
          },
        ]}
      />

      {accountError && <PageBanner tone="error">{accountError}</PageBanner>}
      {error && <PageBanner tone="error">{error}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {state && !canManageAccessKeys && (
        <PageBanner tone="warning">{t({ en: "Access-key management is disabled for this portal account.", fr: "La gestion des clés d'accès est désactivée pour ce compte Portal.", de: "Die Verwaltung von Zugriffsschlüsseln ist für dieses Portal-Konto deaktiviert." })}</PageBanner>
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
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 ui-body text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/60 dark:text-amber-100">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">{t({ en: "Access key created", fr: "Clé d'accès créée", de: "Zugriffsschlüssel erstellt" })}</p>
              <p className="ui-caption text-amber-700 dark:text-amber-200">{t({ en: "The secret is shown only once.", fr: "Le secret n'est affiché qu'une seule fois.", de: "Das Secret wird nur einmal angezeigt." })}</p>
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
        <PageBanner tone="info">{t({ en: "Loading portal account...", fr: "Chargement du compte Portal...", de: "Portal-Konto wird geladen..." })}</PageBanner>
      ) : !hasAccountContext ? (
        <PageEmptyState
          title={t({ en: "Select a portal account before managing access keys", fr: "Sélectionnez un compte Portal avant de gérer les clés d'accès", de: "Wählen Sie ein Portal-Konto aus, bevor Sie Zugriffsschlüssel verwalten" })}
          description={t({ en: "Access keys are scoped to the selected portal account.", fr: "Les clés d'accès sont limitées au compte Portal sélectionné.", de: "Zugriffsschlüssel sind auf das ausgewählte Portal-Konto beschränkt." })}
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
          <table className="manager-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr>
                <th className="px-6 py-3 text-left ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {t({ en: "Access key", fr: "Clé d'accès", de: "Zugriffsschlüssel" })}
                </th>
                <th className="px-6 py-3 text-left ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {t({ en: "Status", fr: "Statut", de: "Status" })}
                </th>
                <th className="px-6 py-3 text-left ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {t({ en: "Created on", fr: "Créée le", de: "Erstellt am" })}
                </th>
                <th className="px-6 py-3 text-right ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {t({ en: "Actions", fr: "Actions", de: "Aktionen" })}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {tableStatus === "loading" && <TableEmptyState colSpan={4} message={t({ en: "Loading keys...", fr: "Chargement des clés...", de: "Schlüssel werden geladen..." })} />}
              {tableStatus === "error" && <TableEmptyState colSpan={4} message={t({ en: "Unable to load keys.", fr: "Impossible de charger les clés.", de: "Schlüssel können nicht geladen werden." })} tone="error" />}
              {tableStatus === "empty" && <TableEmptyState colSpan={4} message={t({ en: "No external access keys.", fr: "Aucune clé d'accès externe.", de: "Keine externen Zugriffsschlüssel." })} />}
              {visibleKeys.map((key) => {
                const active = isKeyActive(key);
                const disabled = Boolean(busy) || !canManageAccessKeys;
                return (
                  <tr
                    key={key.access_key_id}
                    className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 ${active ? "" : "bg-slate-50/70 dark:bg-slate-800/40"}`}
                  >
                    <td className="manager-table-cell max-w-[18rem] break-all px-6 py-4 font-mono text-slate-800 dark:text-slate-100">
                      {key.access_key_id}
                    </td>
                    <td className="manager-table-cell px-6 py-4 ui-body text-slate-700 dark:text-slate-200">
                      {portalAccessKeyStatusLabel(key.status, active, t)}
                    </td>
                    <td className="manager-table-cell px-6 py-4 ui-body text-slate-600 dark:text-slate-300">
                      {portalDateTimeLabel(key.created_at, locale)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pendingAction?.type === "disable" ? (
        <ConfirmActionDialog
          title={t({ en: "Disable access key", fr: "Désactiver la clé d'accès", de: "Zugriffsschlüssel deaktivieren" })}
          description={t({ en: "Confirm that you want to disable this access key.", fr: "Confirmez que vous voulez désactiver cette clé d'accès.", de: "Bestätigen Sie, dass Sie diesen Zugriffsschlüssel deaktivieren möchten." })}
          confirmLabel={t({ en: "Disable key", fr: "Désactiver la clé", de: "Schlüssel deaktivieren" })}
          loading={busy === `toggle:${pendingAction.key.access_key_id}`}
          details={[
            { label: t({ en: "Access key", fr: "Clé d'accès", de: "Zugriffsschlüssel" }), value: pendingAction.key.access_key_id, mono: true },
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
