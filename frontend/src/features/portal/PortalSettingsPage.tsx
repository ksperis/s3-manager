/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PortalSettingsOverride } from "../../api/appSettings";
import {
  fetchPortalProjectSettings,
  updatePortalProjectSettings,
  type PortalProjectSettings,
} from "../../api/portal";
import { fetchCurrentUser, type User } from "../../api/users";
import PageBanner from "../../components/PageBanner";
import PageShell from "../../components/PageShell";
import { PortalSettingsItem, PortalSettingsSection } from "../../components/PortalSettingsLayout";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import { cx, uiCheckboxClass, uiTitleTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { confirmAction } from "../../utils/confirm";
import { formatBytes } from "../../utils/format";
import { usePortalAccountContext } from "./PortalAccountContext";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

const labelClasses = "ui-caption font-semibold uppercase tracking-wide text-[var(--ui-text-muted)]";

type WorkspaceAccessLabel = "limited" | "manager" | "user";
type TriState = "inherit" | "enabled" | "disabled";

type ProjectSettingsForm = {
  browserAccess: TriState;
  bucketCreate: TriState;
  namedBucketCreate: TriState;
  accessKeyCreate: TriState;
  serverAccessLogging: TriState;
  versionCleanup: TriState;
  versioning: TriState;
  lifecycle: TriState;
  versionHistoryRetentionOverride: boolean;
  versionHistoryRetentionDays: string;
  cors: TriState;
  corsOriginsOverride: boolean;
  corsOriginsText: string;
};

const emptyForm: ProjectSettingsForm = {
  browserAccess: "inherit",
  bucketCreate: "inherit",
  namedBucketCreate: "inherit",
  accessKeyCreate: "inherit",
  serverAccessLogging: "inherit",
  versionCleanup: "inherit",
  versioning: "inherit",
  lifecycle: "inherit",
  versionHistoryRetentionOverride: false,
  versionHistoryRetentionDays: "",
  cors: "inherit",
  corsOriginsOverride: false,
  corsOriginsText: "",
};

function resolveWorkspaceAccess(user: User | null, selectedAccountId: string | null): WorkspaceAccessLabel {
  if (!user || !selectedAccountId) return "limited";
  const numericId = Number(selectedAccountId);
  const link = user.account_links?.find((item) => Number(item.account_id) === numericId);
  if (!link?.role) return "limited";
  if (link.role === "portal_manager" || link.role === "account_administrator") return "manager";
  if (link.role === "portal_user") return "user";
  return "limited";
}

function resolveTriState(value?: boolean | null): TriState {
  if (value == null) return "inherit";
  return value ? "enabled" : "disabled";
}

function toOverrideValue(value: TriState): boolean | undefined {
  if (value === "inherit") return undefined;
  return value === "enabled";
}

function formFromSettings(settings: PortalProjectSettings): ProjectSettingsForm {
  const override = settings.project_override;
  const defaults = override.bucket_defaults;
  const effectiveDefaults = settings.effective.bucket_defaults;
  const retentionOverride = defaults?.noncurrent_version_expiration_days != null;
  const originsOverride = defaults?.cors_allowed_origins != null;
  return {
    browserAccess: resolveTriState(override.browser_access_enabled),
    bucketCreate: resolveTriState(override.allow_private_storage_space_create),
    namedBucketCreate: resolveTriState(override.allow_portal_named_bucket_create),
    accessKeyCreate: resolveTriState(override.allow_portal_user_access_key_create),
    serverAccessLogging: resolveTriState(override.server_access_logging_enabled),
    versionCleanup: resolveTriState(override.storage_space_version_cleanup_enabled),
    versioning: resolveTriState(defaults?.versioning),
    lifecycle: resolveTriState(defaults?.enable_lifecycle),
    versionHistoryRetentionOverride: retentionOverride,
    versionHistoryRetentionDays: String(
      defaults?.noncurrent_version_expiration_days ?? effectiveDefaults.noncurrent_version_expiration_days
    ),
    cors: resolveTriState(defaults?.enable_cors),
    corsOriginsOverride: originsOverride,
    corsOriginsText: (originsOverride
      ? defaults?.cors_allowed_origins ?? []
      : effectiveDefaults.cors_allowed_origins ?? []
    ).join("\n"),
  };
}

function buildOverride(form: ProjectSettingsForm): PortalSettingsOverride {
  const payload: PortalSettingsOverride = {};
  const directValues: Array<[keyof PortalSettingsOverride, TriState]> = [
    ["browser_access_enabled", form.browserAccess],
    ["allow_private_storage_space_create", form.bucketCreate],
    ["allow_portal_named_bucket_create", form.namedBucketCreate],
    ["allow_portal_user_access_key_create", form.accessKeyCreate],
    ["server_access_logging_enabled", form.serverAccessLogging],
    ["storage_space_version_cleanup_enabled", form.versionCleanup],
  ];
  directValues.forEach(([key, state]) => {
    const value = toOverrideValue(state);
    if (value !== undefined) {
      Object.assign(payload, { [key]: value });
    }
  });

  const bucketDefaults: NonNullable<PortalSettingsOverride["bucket_defaults"]> = {};
  const versioning = toOverrideValue(form.versioning);
  const lifecycle = toOverrideValue(form.lifecycle);
  const cors = toOverrideValue(form.cors);
  if (versioning !== undefined) bucketDefaults.versioning = versioning;
  if (lifecycle !== undefined) bucketDefaults.enable_lifecycle = lifecycle;
  if (form.versionHistoryRetentionOverride) {
    bucketDefaults.noncurrent_version_expiration_days = Number(form.versionHistoryRetentionDays);
  }
  if (cors !== undefined) bucketDefaults.enable_cors = cors;
  if (form.corsOriginsOverride) {
    bucketDefaults.cors_allowed_origins = form.corsOriginsText
      .split(/[\n,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
  }
  if (Object.keys(bucketDefaults).length > 0) payload.bucket_defaults = bucketDefaults;
  return payload;
}

export default function PortalSettingsPage() {
  const { t } = useI18n();
  const { selectedAccount, selectedAccountId, loading: accountsLoading } = usePortalAccountContext();
  const { workspace, loading: workspaceLoading } = usePortalWorkspaceData();
  const [user, setUser] = useState<User | null>(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const [settings, setSettings] = useState<PortalProjectSettings | null>(null);
  const [form, setForm] = useState<ProjectSettingsForm>(emptyForm);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectedWorkspaceAccess = useMemo(
    () => resolveWorkspaceAccess(user, selectedAccountId),
    [selectedAccountId, user]
  );
  const activeSpaces = workspace.spaces.filter((space) => space.status !== "Archived");
  const editable = Boolean(settings?.can_update);
  const controlsDisabled = settingsLoading || saving || !editable;

  const applySettings = useCallback((next: PortalProjectSettings) => {
    setSettings(next);
    setForm(formFromSettings(next));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setAccessLoading(true);
    fetchCurrentUser()
      .then((currentUser) => {
        if (!cancelled) setUser(currentUser);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setError(extractApiError(err, t({ en: "Unable to load your project access.", fr: "Impossible de charger votre accès au projet.", de: "Ihr Projektzugriff konnte nicht geladen werden." })));
        }
      })
      .finally(() => {
        if (!cancelled) setAccessLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAccountId, t]);

  useEffect(() => {
    let cancelled = false;
    setSettings(null);
    setForm(emptyForm);
    setMessage(null);
    setError(null);
    if (!selectedAccountId) return () => { cancelled = true; };
    setSettingsLoading(true);
    fetchPortalProjectSettings(selectedAccountId)
      .then((next) => {
        if (!cancelled) applySettings(next);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setError(extractApiError(err, t({ en: "Unable to load project settings.", fr: "Impossible de charger les paramètres du projet.", de: "Projekteinstellungen konnten nicht geladen werden." })));
        }
      })
      .finally(() => {
        if (!cancelled) setSettingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applySettings, selectedAccountId, t]);

  const updateField = <K extends keyof ProjectSettingsForm>(key: K, value: ProjectSettingsForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleSave = async () => {
    if (!selectedAccountId || !editable || saving) return;
    if (form.versionHistoryRetentionOverride) {
      const days = Number(form.versionHistoryRetentionDays);
      if (!Number.isInteger(days) || days < 1) {
        setMessage(null);
        setError(t({ en: "Version history retention must be a positive integer.", fr: "La conservation de l’historique des versions doit être un entier positif.", de: "Die Aufbewahrung des Versionsverlaufs muss eine positive ganze Zahl sein." }));
        return;
      }
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      applySettings(await updatePortalProjectSettings(selectedAccountId, buildOverride(form)));
      setMessage(t({ en: "Project settings saved.", fr: "Paramètres du projet enregistrés.", de: "Projekteinstellungen gespeichert." }));
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, t({ en: "Unable to save project settings.", fr: "Impossible d’enregistrer les paramètres du projet.", de: "Projekteinstellungen konnten nicht gespeichert werden." })));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!selectedAccountId || !editable || saving) return;
    if (!confirmAction(t({ en: "Reset all project overrides?", fr: "Réinitialiser tous les overrides du projet ?", de: "Alle Projektüberschreibungen zurücksetzen?" }))) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      applySettings(await updatePortalProjectSettings(selectedAccountId, {}));
      setMessage(t({ en: "Project overrides reset.", fr: "Overrides du projet réinitialisés.", de: "Projektüberschreibungen zurückgesetzt." }));
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, t({ en: "Unable to reset project settings.", fr: "Impossible de réinitialiser les paramètres du projet.", de: "Projekteinstellungen konnten nicht zurückgesetzt werden." })));
    } finally {
      setSaving(false);
    }
  };

  const triStateControl = (label: string, value: TriState, onChange: (value: TriState) => void) => (
    <UiSelect
      size="compact"
      value={value}
      onChange={(event) => onChange(event.target.value as TriState)}
      disabled={controlsDisabled}
      aria-label={label}
    >
      <option value="inherit">{t({ en: "Inherit", fr: "Hériter", de: "Übernehmen" })}</option>
      <option value="enabled">{t({ en: "Enable", fr: "Activer", de: "Aktivieren" })}</option>
      <option value="disabled">{t({ en: "Disable", fr: "Désactiver", de: "Deaktivieren" })}</option>
    </UiSelect>
  );

  const effectiveLabel = (enabled: boolean) =>
    enabled
      ? t({ en: "Enabled", fr: "Activé", de: "Aktiviert" })
      : t({ en: "Disabled", fr: "Désactivé", de: "Deaktiviert" });

  return (
    <PageShell
      title={t({ en: "Settings", fr: "Paramètres", de: "Einstellungen" })}
      description={t({ en: "Review the effective settings for the selected project.", fr: "Consultez les paramètres effectifs du projet sélectionné.", de: "Prüfen Sie die wirksamen Einstellungen für das ausgewählte Projekt." })}
      breadcrumbs={portalBreadcrumbs({ label: t({ en: "Settings", fr: "Paramètres", de: "Einstellungen" }) })}
    >
      {accessLoading || accountsLoading || settingsLoading ? (
        <PageBanner tone="info">{t({ en: "Loading project settings...", fr: "Chargement des paramètres du projet...", de: "Projekteinstellungen werden geladen..." })}</PageBanner>
      ) : null}
      {error ? <PageBanner tone="warning">{error}</PageBanner> : null}
      {message ? <PageBanner tone="success">{message}</PageBanner> : null}

      <UiCard
        title={t({ en: "Project", fr: "Projet", de: "Projekt" })}
        description={t({ en: "Context for the project currently selected in the Portal.", fr: "Contexte du projet actuellement sélectionné dans le Portal.", de: "Kontext für das aktuell im Portal ausgewählte Projekt." })}
      >
        <dl className="grid gap-4 text-xs md:grid-cols-2 xl:grid-cols-3">
          <div>
            <dt className={labelClasses}>{t({ en: "Selected project", fr: "Projet sélectionné", de: "Ausgewähltes Projekt" })}</dt>
            <dd className={cx("mt-1 font-bold", uiTitleTextClass)}>{selectedAccount?.name ?? "-"}</dd>
          </div>
          <div>
            <dt className={labelClasses}>{t({ en: "Workspace access", fr: "Accès à l'espace de travail", de: "Arbeitsbereichszugriff" })}</dt>
            <dd className="mt-1"><UiBadge tone="primary">{selectedWorkspaceAccess === "manager" ? t({ en: "Manager", fr: "Gestionnaire", de: "Manager" }) : selectedWorkspaceAccess === "user" ? t({ en: "User", fr: "Utilisateur", de: "Benutzer" }) : t({ en: "Limited access", fr: "Accès limité", de: "Eingeschränkter Zugriff" })}</UiBadge></dd>
          </div>
          <div>
            <dt className={labelClasses}>{t({ en: "Storage service", fr: "Service de stockage", de: "Speicherdienst" })}</dt>
            <dd className={cx("mt-1 break-words font-semibold", uiTitleTextClass)}>{selectedAccount?.storage_endpoint_name ?? selectedAccount?.storage_endpoint_url ?? "-"}</dd>
          </div>
          <div>
            <dt className={labelClasses}>{t({ en: "Storage Spaces", fr: "Espaces de stockage", de: "Speicherbereiche" })}</dt>
            <dd className={cx("mt-1 font-bold", uiTitleTextClass)}>{workspaceLoading ? t({ en: "Loading...", fr: "Chargement...", de: "Wird geladen..." }) : t({ en: `${activeSpaces.length} active / ${workspace.spaces.length} total`, fr: `${activeSpaces.length} actifs / ${workspace.spaces.length} au total`, de: `${activeSpaces.length} aktiv / ${workspace.spaces.length} gesamt` })}</dd>
          </div>
          <div>
            <dt className={labelClasses}>{t({ en: "Storage used", fr: "Stockage utilisé", de: "Genutzter Speicher" })}</dt>
            <dd className={cx("mt-1 font-bold", uiTitleTextClass)}>{formatBytes(workspace.usedBytes)}</dd>
          </div>
        </dl>
      </UiCard>

      {settings ? (
        <UiCard
          title={t({ en: "Project settings", fr: "Paramètres du projet", de: "Projekteinstellungen" })}
          description={editable
            ? t({ en: "Delegated project overrides are shared with administrators.", fr: "Les overrides délégués du projet sont partagés avec les administrateurs.", de: "Delegierte Projektüberschreibungen werden mit Administratoren geteilt." })
            : t({ en: "Effective values are read-only because settings delegation is not enabled for your role.", fr: "Les valeurs effectives sont en lecture seule car la délégation n’est pas active pour votre rôle.", de: "Die wirksamen Werte sind schreibgeschützt, da die Delegierung für Ihre Rolle nicht aktiv ist." })}
          actions={editable ? <div className="flex gap-2"><UiButton size="sm" variant="secondary" disabled={saving} onClick={handleReset}>{t({ en: "Reset overrides", fr: "Réinitialiser", de: "Zurücksetzen" })}</UiButton><UiButton size="sm" disabled={saving} onClick={handleSave}>{saving ? t({ en: "Saving...", fr: "Enregistrement...", de: "Speichern..." }) : t({ en: "Save", fr: "Enregistrer", de: "Speichern" })}</UiButton></div> : undefined}
        >
          <div className="space-y-4">
            <PortalSettingsSection title={t({ en: "Portal capabilities", fr: "Fonctions du Portal", de: "Portal-Funktionen" })} layout="grid">
              <PortalSettingsItem title={t({ en: "Browser workspace access", fr: "Accès à l’espace Browser", de: "Browser-Arbeitsbereich" })} description={`${t({ en: "Effective", fr: "Effectif", de: "Wirksam" })}: ${effectiveLabel(settings.effective.browser_access_enabled)}`} action={triStateControl("Browser workspace access override", form.browserAccess, (value) => updateField("browserAccess", value))} />
              <PortalSettingsItem title={t({ en: "Private Storage Space creation", fr: "Création d’espaces privés", de: "Private Speicherbereiche erstellen" })} description={`${t({ en: "Effective", fr: "Effectif", de: "Wirksam" })}: ${effectiveLabel(settings.effective.allow_private_storage_space_create)}`} action={triStateControl("Private Storage Space creation override", form.bucketCreate, (value) => updateField("bucketCreate", value))} />
              <PortalSettingsItem title={t({ en: "Named bucket creation", fr: "Création de buckets nommés", de: "Benannte Buckets erstellen" })} description={`${t({ en: "Effective", fr: "Effectif", de: "Wirksam" })}: ${effectiveLabel(settings.effective.allow_portal_named_bucket_create)}`} action={triStateControl("Named bucket creation override", form.namedBucketCreate, (value) => updateField("namedBucketCreate", value))} />
              <PortalSettingsItem title={t({ en: "Access key management", fr: "Gestion des clés d’accès", de: "Zugriffsschlüssel verwalten" })} description={`${t({ en: "Effective", fr: "Effectif", de: "Wirksam" })}: ${effectiveLabel(settings.effective.allow_portal_user_access_key_create)}`} action={triStateControl("Access key management override", form.accessKeyCreate, (value) => updateField("accessKeyCreate", value))} />
              <PortalSettingsItem title={t({ en: "Server access logging", fr: "Journalisation des accès serveur", de: "Server-Zugriffsprotokollierung" })} description={`${t({ en: "Effective", fr: "Effectif", de: "Wirksam" })}: ${effectiveLabel(settings.effective.server_access_logging_enabled)}`} action={triStateControl("Server access logging override", form.serverAccessLogging, (value) => updateField("serverAccessLogging", value))} />
              <PortalSettingsItem title={t({ en: "Storage Space history cleanup", fr: "Nettoyage de l’historique", de: "Versionsverlauf bereinigen" })} description={`${t({ en: "Effective", fr: "Effectif", de: "Wirksam" })}: ${effectiveLabel(settings.effective.storage_space_version_cleanup_enabled)}`} action={triStateControl("Storage Space history cleanup override", form.versionCleanup, (value) => updateField("versionCleanup", value))} />
            </PortalSettingsSection>

            <PortalSettingsSection title={t({ en: "Storage Space defaults", fr: "Valeurs par défaut des espaces", de: "Standardwerte für Speicherbereiche" })} layout="grid">
              <PortalSettingsItem title="Versioning" description={`${t({ en: "Effective for new spaces", fr: "Effectif pour les nouveaux espaces", de: "Wirksam für neue Bereiche" })}: ${effectiveLabel(settings.effective.bucket_defaults.versioning)}`} action={triStateControl("Versioning override", form.versioning, (value) => updateField("versioning", value))} />
              <PortalSettingsItem title="Lifecycle" description={`${t({ en: "Effective for new spaces", fr: "Effectif pour les nouveaux espaces", de: "Wirksam für neue Bereiche" })}: ${effectiveLabel(settings.effective.bucket_defaults.enable_lifecycle)}`} action={triStateControl("Lifecycle override", form.lifecycle, (value) => updateField("lifecycle", value))} />
              <PortalSettingsItem
                title={t({ en: "Version history retention", fr: "Conservation de l’historique des versions", de: "Aufbewahrung des Versionsverlaufs" })}
                description={t({ en: `${settings.effective.bucket_defaults.noncurrent_version_expiration_days} days for new spaces. Existing spaces are unchanged.`, fr: `${settings.effective.bucket_defaults.noncurrent_version_expiration_days} jours pour les nouveaux espaces. Les espaces existants ne changent pas.`, de: `${settings.effective.bucket_defaults.noncurrent_version_expiration_days} Tage für neue Bereiche. Bestehende Bereiche bleiben unverändert.` })}
                action={<label className="inline-flex items-center gap-2 ui-caption font-semibold"><input type="checkbox" className={uiCheckboxClass} checked={form.versionHistoryRetentionOverride} disabled={controlsDisabled} onChange={(event) => updateField("versionHistoryRetentionOverride", event.target.checked)} aria-label="Override version history retention" />{t({ en: "Override", fr: "Override", de: "Überschreiben" })}</label>}
              >
                <UiInput type="number" min={1} step={1} size="compact" className="mt-2 w-28" value={form.versionHistoryRetentionDays} disabled={controlsDisabled || !form.versionHistoryRetentionOverride} onChange={(event) => updateField("versionHistoryRetentionDays", event.target.value)} aria-label="Version history retention days" />
              </PortalSettingsItem>
              <PortalSettingsItem title="CORS" description={`${t({ en: "Effective for new spaces", fr: "Effectif pour les nouveaux espaces", de: "Wirksam für neue Bereiche" })}: ${effectiveLabel(settings.effective.bucket_defaults.enable_cors)}`} action={triStateControl("CORS override", form.cors, (value) => updateField("cors", value))} />
              <PortalSettingsItem
                title={t({ en: "CORS origins", fr: "Origines CORS", de: "CORS-Ursprünge" })}
                description={form.corsOriginsOverride ? t({ en: "Override active", fr: "Override actif", de: "Überschreibung aktiv" }) : t({ en: "Inherited", fr: "Hérité", de: "Übernommen" })}
                className="md:col-span-2"
                action={<label className="inline-flex items-center gap-2 ui-caption font-semibold"><input type="checkbox" className={uiCheckboxClass} checked={form.corsOriginsOverride} disabled={controlsDisabled} onChange={(event) => updateField("corsOriginsOverride", event.target.checked)} aria-label="Override CORS origins" />{t({ en: "Override", fr: "Override", de: "Überschreiben" })}</label>}
              >
                <textarea className="mt-2 w-full rounded-md border border-[color:var(--ui-border)] bg-[color:var(--ui-surface)] px-3 py-2 ui-caption disabled:opacity-60" rows={3} value={form.corsOriginsText} disabled={controlsDisabled || !form.corsOriginsOverride} onChange={(event) => updateField("corsOriginsText", event.target.value)} aria-label="CORS origins" />
              </PortalSettingsItem>
            </PortalSettingsSection>
          </div>
        </UiCard>
      ) : null}
    </PageShell>
  );
}
