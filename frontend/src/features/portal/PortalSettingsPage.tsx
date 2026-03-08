/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import {
  PortalAccountSettings,
  PortalState,
  fetchPortalAccountSettings,
  fetchPortalState,
  updatePortalAccountSettings,
} from "../../api/portal";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import {
  PortalSettingsItem,
  PortalSettingsSection,
  PortalSettingsSwitch,
} from "../../components/PortalSettingsLayout";
import UiButton from "../../components/ui/UiButton";
import { cx, uiCheckboxClass, uiInputClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { confirmAction } from "../../utils/confirm";
import { usePortalAccountContext } from "./PortalAccountContext";

type TriState = "inherit" | "enabled" | "disabled";
type PolicyMode = "inherit" | "actions";

const hasOwn = (value: Record<string, unknown> | null | undefined, key: string) =>
  Boolean(value && Object.prototype.hasOwnProperty.call(value, key));

const normalizeListInput = (value: string): string[] =>
  value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const resolveTriState = (value?: boolean | null): TriState => {
  if (value == null) return "inherit";
  return value ? "enabled" : "disabled";
};

const toOverrideValue = (value: TriState): boolean | undefined => {
  if (value === "inherit") return undefined;
  return value === "enabled";
};

const inheritToggleLabelClass = "inline-flex items-center gap-2 ui-caption font-semibold text-slate-700 dark:text-slate-200";
const policyActionsTextareaClass = cx("mt-2 ui-caption", uiInputClass);

export default function PortalSettingsPage() {
  const { t } = useI18n();
  const { accountIdForApi, selectedAccount, hasAccountContext, loading: accountLoading, error: accountError } =
    usePortalAccountContext();
  const [portalState, setPortalState] = useState<PortalState | null>(null);
  const [stateLoading, setStateLoading] = useState(false);
  const [stateError, setStateError] = useState<string | null>(null);
  const [portalAccountSettings, setPortalAccountSettings] = useState<PortalAccountSettings | null>(null);
  const [portalSettingsLoading, setPortalSettingsLoading] = useState(false);
  const [portalSettingsError, setPortalSettingsError] = useState<string | null>(null);
  const [portalSettingsSaving, setPortalSettingsSaving] = useState(false);
  const [portalSettingsMessage, setPortalSettingsMessage] = useState<string | null>(null);
  const [overridePortalKey, setOverridePortalKey] = useState<TriState>("inherit");
  const [overridePortalBucketCreate, setOverridePortalBucketCreate] = useState<TriState>("inherit");
  const [overridePortalAccessKeyCreate, setOverridePortalAccessKeyCreate] = useState<TriState>("inherit");
  const [bucketVersioningOverride, setBucketVersioningOverride] = useState<TriState>("inherit");
  const [bucketLifecycleOverride, setBucketLifecycleOverride] = useState<TriState>("inherit");
  const [bucketCorsOverride, setBucketCorsOverride] = useState<TriState>("inherit");
  const [bucketCorsOriginsOverride, setBucketCorsOriginsOverride] = useState(false);
  const [bucketCorsOriginsText, setBucketCorsOriginsText] = useState("");
  const [managerPolicyMode, setManagerPolicyMode] = useState<PolicyMode>("inherit");
  const [managerPolicyActionsText, setManagerPolicyActionsText] = useState("");
  const [userPolicyMode, setUserPolicyMode] = useState<PolicyMode>("inherit");
  const [userPolicyActionsText, setUserPolicyActionsText] = useState("");
  const [bucketPolicyMode, setBucketPolicyMode] = useState<PolicyMode>("inherit");
  const [bucketPolicyActionsText, setBucketPolicyActionsText] = useState("");
  const accountName = selectedAccount?.name ?? t({ en: "selected account", fr: "compte selectionne", de: "ausgewahltes Konto" });
  const inheritLabel = t({ en: "Inherit", fr: "Heriter", de: "Vererben" });
  const overrideDisabledLabel = t({ en: "Override disabled by admin.", fr: "Surcharge desactivee par l'admin.", de: "Override vom Admin deaktiviert." });
  const lockedByAdminLabel = t({ en: "Locked by admin.", fr: "Verrouille par l'admin.", de: "Vom Admin gesperrt." });

  const canManagePortalUsers = Boolean(portalState?.can_manage_portal_users) || portalState?.account_role === "portal_manager";
  const effectivePortalSettings = portalAccountSettings?.effective ?? null;
  const overridePolicy = portalAccountSettings?.override_policy ?? null;
  const adminOverride = portalAccountSettings?.admin_override ?? null;
  const portalKeyEnabled = Boolean(effectivePortalSettings?.allow_portal_key);
  const portalBucketCreateEnabled = Boolean(effectivePortalSettings?.allow_portal_user_bucket_create);
  const portalAccessKeyCreateEnabled = Boolean(effectivePortalSettings?.allow_portal_user_access_key_create);
  const bucketVersioningEnabled = Boolean(effectivePortalSettings?.bucket_defaults.versioning);
  const bucketLifecycleEnabled = Boolean(effectivePortalSettings?.bucket_defaults.enable_lifecycle);
  const bucketCorsEnabled = Boolean(effectivePortalSettings?.bucket_defaults.enable_cors);
  const hasAdminOverrides = useMemo(() => {
    if (!adminOverride) return false;
    if (
      adminOverride.allow_portal_key != null ||
      adminOverride.allow_portal_user_bucket_create != null ||
      adminOverride.allow_portal_user_access_key_create != null
    ) {
      return true;
    }
    if (adminOverride.bucket_defaults) {
      if (
        adminOverride.bucket_defaults.versioning != null ||
        adminOverride.bucket_defaults.enable_cors != null ||
        adminOverride.bucket_defaults.enable_lifecycle != null ||
        adminOverride.bucket_defaults.cors_allowed_origins != null
      ) {
        return true;
      }
    }
    const managerPolicy = adminOverride.iam_group_manager_policy;
    if (hasOwn(managerPolicy as Record<string, unknown> | null, "actions") || hasOwn(managerPolicy as Record<string, unknown> | null, "advanced_policy")) {
      return true;
    }
    const userPolicy = adminOverride.iam_group_user_policy;
    if (hasOwn(userPolicy as Record<string, unknown> | null, "actions") || hasOwn(userPolicy as Record<string, unknown> | null, "advanced_policy")) {
      return true;
    }
    const bucketPolicy = adminOverride.bucket_access_policy;
    if (hasOwn(bucketPolicy as Record<string, unknown> | null, "actions") || hasOwn(bucketPolicy as Record<string, unknown> | null, "advanced_policy")) {
      return true;
    }
    return false;
  }, [adminOverride]);

  useEffect(() => {
    if (!accountIdForApi) {
      setPortalState(null);
      setStateError(null);
      setStateLoading(false);
      return;
    }
    setStateLoading(true);
    setStateError(null);
    fetchPortalState(accountIdForApi)
      .then((data) => {
        setPortalState(data);
      })
      .catch((err) => {
        console.error(err);
        setPortalState(null);
        setStateError(t({ en: "Unable to load portal context.", fr: "Impossible de charger le contexte portail.", de: "Portal-Kontext kann nicht geladen werden." }));
      })
      .finally(() => setStateLoading(false));
  }, [accountIdForApi, t]);

  useEffect(() => {
    setPortalAccountSettings(null);
    setPortalSettingsError(null);
    setPortalSettingsLoading(false);
    if (!accountIdForApi || !canManagePortalUsers) return;
    setPortalSettingsLoading(true);
    fetchPortalAccountSettings(accountIdForApi)
      .then((data) => setPortalAccountSettings(data))
      .catch((err) => {
        console.error(err);
        setPortalSettingsError(t({ en: "Unable to load portal settings.", fr: "Impossible de charger les parametres du portail.", de: "Portal-Einstellungen konnen nicht geladen werden." }));
      })
      .finally(() => setPortalSettingsLoading(false));
  }, [accountIdForApi, canManagePortalUsers, t]);

  useEffect(() => {
    if (!portalAccountSettings) {
      setOverridePortalKey("inherit");
      setOverridePortalBucketCreate("inherit");
      setOverridePortalAccessKeyCreate("inherit");
      setBucketVersioningOverride("inherit");
      setBucketLifecycleOverride("inherit");
      setBucketCorsOverride("inherit");
      setBucketCorsOriginsOverride(false);
      setBucketCorsOriginsText("");
      setManagerPolicyMode("inherit");
      setManagerPolicyActionsText("");
      setUserPolicyMode("inherit");
      setUserPolicyActionsText("");
      setBucketPolicyMode("inherit");
      setBucketPolicyActionsText("");
      return;
    }
    const override = portalAccountSettings.portal_manager_override;
    const effective = portalAccountSettings.effective;
    setOverridePortalKey(resolveTriState(override.allow_portal_key));
    setOverridePortalBucketCreate(resolveTriState(override.allow_portal_user_bucket_create));
    setOverridePortalAccessKeyCreate(resolveTriState(override.allow_portal_user_access_key_create));

    const bucketDefaultsOverride = override.bucket_defaults;
    setBucketVersioningOverride(resolveTriState(bucketDefaultsOverride?.versioning));
    setBucketLifecycleOverride(resolveTriState(bucketDefaultsOverride?.enable_lifecycle));
    setBucketCorsOverride(resolveTriState(bucketDefaultsOverride?.enable_cors));
    if (bucketDefaultsOverride && bucketDefaultsOverride.cors_allowed_origins != null) {
      setBucketCorsOriginsOverride(true);
      setBucketCorsOriginsText(bucketDefaultsOverride.cors_allowed_origins.join("\n"));
    } else {
      setBucketCorsOriginsOverride(false);
      setBucketCorsOriginsText((effective.bucket_defaults.cors_allowed_origins || []).join("\n"));
    }

    const managerOverride = override.iam_group_manager_policy;
    const managerHasActions = hasOwn(managerOverride as Record<string, unknown> | null, "actions");
    setManagerPolicyMode(managerHasActions ? "actions" : "inherit");
    setManagerPolicyActionsText((managerOverride?.actions ?? (effective.iam_group_manager_policy.actions || [])).join("\n"));

    const userOverride = override.iam_group_user_policy;
    const userHasActions = hasOwn(userOverride as Record<string, unknown> | null, "actions");
    setUserPolicyMode(userHasActions ? "actions" : "inherit");
    setUserPolicyActionsText((userOverride?.actions ?? (effective.iam_group_user_policy.actions || [])).join("\n"));

    const bucketOverride = override.bucket_access_policy;
    const bucketHasActions = hasOwn(bucketOverride as Record<string, unknown> | null, "actions");
    setBucketPolicyMode(bucketHasActions ? "actions" : "inherit");
    setBucketPolicyActionsText((bucketOverride?.actions ?? (effective.bucket_access_policy.actions || [])).join("\n"));
  }, [portalAccountSettings]);

  const handleSavePortalOverrides = async () => {
    if (!accountIdForApi || !portalAccountSettings || portalSettingsSaving) return;
    setPortalSettingsSaving(true);
    setPortalSettingsError(null);
    setPortalSettingsMessage(null);

    const payload: PortalAccountSettings["portal_manager_override"] = {};
    const allowPortalKeyValue = toOverrideValue(overridePortalKey);
    if (allowPortalKeyValue !== undefined) {
      payload.allow_portal_key = allowPortalKeyValue;
    }
    const allowBucketCreateValue = toOverrideValue(overridePortalBucketCreate);
    if (allowBucketCreateValue !== undefined) {
      payload.allow_portal_user_bucket_create = allowBucketCreateValue;
    }
    const allowAccessKeyCreateValue = toOverrideValue(overridePortalAccessKeyCreate);
    if (allowAccessKeyCreateValue !== undefined) {
      payload.allow_portal_user_access_key_create = allowAccessKeyCreateValue;
    }

    const bucketDefaults: NonNullable<PortalAccountSettings["portal_manager_override"]["bucket_defaults"]> = {};
    const versioningValue = toOverrideValue(bucketVersioningOverride);
    if (versioningValue !== undefined) {
      bucketDefaults.versioning = versioningValue;
    }
    const lifecycleValue = toOverrideValue(bucketLifecycleOverride);
    if (lifecycleValue !== undefined) {
      bucketDefaults.enable_lifecycle = lifecycleValue;
    }
    const corsValue = toOverrideValue(bucketCorsOverride);
    if (corsValue !== undefined) {
      bucketDefaults.enable_cors = corsValue;
    }
    if (bucketCorsOriginsOverride) {
      bucketDefaults.cors_allowed_origins = normalizeListInput(bucketCorsOriginsText);
    }
    if (Object.keys(bucketDefaults).length > 0) {
      payload.bucket_defaults = bucketDefaults;
    }

    if (managerPolicyMode === "actions") {
      payload.iam_group_manager_policy = { actions: normalizeListInput(managerPolicyActionsText) };
    }
    if (userPolicyMode === "actions") {
      payload.iam_group_user_policy = { actions: normalizeListInput(userPolicyActionsText) };
    }
    if (bucketPolicyMode === "actions") {
      payload.bucket_access_policy = { actions: normalizeListInput(bucketPolicyActionsText) };
    }

    try {
      const updated = await updatePortalAccountSettings(accountIdForApi, payload);
      setPortalAccountSettings(updated);
      setPortalSettingsMessage(t({ en: "Portal settings updated.", fr: "Parametres portail mis a jour.", de: "Portal-Einstellungen aktualisiert." }));
    } catch (err) {
      console.error(err);
      setPortalSettingsError(t({ en: "Unable to save portal settings.", fr: "Impossible d'enregistrer les parametres portail.", de: "Portal-Einstellungen konnen nicht gespeichert werden." }));
    } finally {
      setPortalSettingsSaving(false);
    }
  };

  const handleResetPortalOverrides = async () => {
    if (!accountIdForApi || portalSettingsSaving) return;
    if (
      !confirmAction(
        t({
          en: "Reset portal overrides for this account?",
          fr: "Reinitialiser les surcharges portail pour ce compte ?",
          de: "Portal-Overrides fur dieses Konto zurucksetzen?",
        })
      )
    )
      return;
    setPortalSettingsSaving(true);
    setPortalSettingsError(null);
    setPortalSettingsMessage(null);
    try {
      const updated = await updatePortalAccountSettings(accountIdForApi, {});
      setPortalAccountSettings(updated);
      setPortalSettingsMessage(t({ en: "Portal overrides reset.", fr: "Surcharges portail reinitialisees.", de: "Portal-Overrides zuruckgesetzt." }));
    } catch (err) {
      console.error(err);
      setPortalSettingsError(t({ en: "Unable to reset overrides.", fr: "Impossible de reinitialiser les surcharges.", de: "Overrides konnen nicht zuruckgesetzt werden." }));
    } finally {
      setPortalSettingsSaving(false);
    }
  };

  const pageDescription = selectedAccount
    ? t({
        en: `Configure portal settings for ${accountName}.`,
        fr: `Configurez les parametres du portail pour ${accountName}.`,
        de: `Konfigurieren Sie die Portal-Einstellungen fur ${accountName}.`,
      })
    : t({
        en: "Configure portal settings.",
        fr: "Configurez les parametres du portail.",
        de: "Portal-Einstellungen konfigurieren.",
      });

  const headerActions = [];

  return (
    <div className="space-y-4">
      <PageHeader
        title={t({ en: "Portal settings", fr: "Parametres portail", de: "Portal-Einstellungen" })}
        description={pageDescription}
        breadcrumbs={[
          { label: t({ en: "Portal", fr: "Portail", de: "Portal" }), to: "/portal" },
          { label: t({ en: "Settings", fr: "Parametres", de: "Einstellungen" }) },
        ]}
        actions={headerActions}
      />

      {accountLoading && (
        <PageBanner tone="info">
          {t({ en: "Loading portal context...", fr: "Chargement du contexte portail...", de: "Portal-Kontext wird geladen..." })}
        </PageBanner>
      )}
      {accountError && <PageBanner tone="error">{accountError}</PageBanner>}
      {!accountLoading && !hasAccountContext && (
        <PageBanner tone="warning">
          {t({ en: "Select an account in the top bar to continue.", fr: "Selectionnez un compte dans la barre superieure pour continuer.", de: "Wahlen Sie ein Konto in der oberen Leiste, um fortzufahren." })}
        </PageBanner>
      )}
      {stateError && <PageBanner tone="error">{stateError}</PageBanner>}
      {!stateLoading && !stateError && hasAccountContext && !canManagePortalUsers && (
        <PageBanner tone="warning">{t({ en: "Access restricted to portal managers.", fr: "Acces reserve aux managers du portail.", de: "Zugriff nur fur Portal-Manager." })}</PageBanner>
      )}

      {hasAccountContext && canManagePortalUsers && (
        <div className="ui-surface-card">
          <div className="border-b border-slate-200 px-4 py-4 dark:border-slate-800">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">
                  {t({ en: "Portal settings", fr: "Parametres portail", de: "Portal-Einstellungen" })}
                </p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  {t({ en: "Overrides of global settings for this account.", fr: "Surcharges des parametres globaux pour ce compte.", de: "Uberschreibungen globaler Einstellungen fur dieses Konto." })}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <UiButton
                  variant="secondary"
                  onClick={handleResetPortalOverrides}
                  disabled={!portalAccountSettings || portalSettingsSaving}
                  className="text-slate-600 dark:text-slate-200"
                >
                  {t({ en: "Reset", fr: "Reinitialiser", de: "Zurucksetzen" })}
                </UiButton>
                <UiButton
                  onClick={handleSavePortalOverrides}
                  disabled={!portalAccountSettings || portalSettingsSaving}
                >
                  {portalSettingsSaving
                    ? t({ en: "Saving...", fr: "Enregistrement...", de: "Wird gespeichert..." })
                    : t({ en: "Save", fr: "Enregistrer", de: "Speichern" })}
                </UiButton>
              </div>
            </div>
          </div>
          <div className="px-4 py-4">
            {portalSettingsError && <PageBanner tone="error">{portalSettingsError}</PageBanner>}
            {portalSettingsMessage && <PageBanner tone="success">{portalSettingsMessage}</PageBanner>}
            {!portalSettingsError && portalSettingsLoading && (
              <PageBanner tone="info">{t({ en: "Loading settings...", fr: "Chargement des parametres...", de: "Einstellungen werden geladen..." })}</PageBanner>
            )}
            {hasAdminOverrides && (
              <PageBanner tone="warning">
                {t({ en: "Some settings are locked by the admin.", fr: "Certains parametres sont verrouilles par l'admin.", de: "Einige Einstellungen sind vom Admin gesperrt." })}
              </PageBanner>
            )}
            {portalAccountSettings && effectivePortalSettings && overridePolicy && (
              <div className="space-y-4">
                <PortalSettingsSection title={t({ en: "UI", fr: "UI", de: "UI" })} layout="grid">
                  <PortalSettingsItem
                    title={t({ en: "Portal key", fr: "Cle portail", de: "Portal-Schlussel" })}
                    description={t({ en: "Show the active portal key to portal users.", fr: "Afficher la cle portail active aux utilisateurs portail.", de: "Aktiven Portal-Schlussel fur Portal-Benutzer anzeigen." })}
                    action={
                      <div className="flex flex-col items-end gap-2">
                        <PortalSettingsSwitch
                          checked={portalKeyEnabled}
                          disabled={
                            portalSettingsLoading ||
                            portalSettingsSaving ||
                            overridePortalKey === "inherit" ||
                            !overridePolicy.allow_portal_key ||
                            adminOverride?.allow_portal_key != null
                          }
                          ariaLabel={t({ en: "Toggle portal key", fr: "Basculer la cle portail", de: "Portal-Schlussel umschalten" })}
                          onChange={(value) => setOverridePortalKey(value ? "enabled" : "disabled")}
                        />
                        <label className={inheritToggleLabelClass}>
                          <span>{inheritLabel}</span>
                          <input
                            type="checkbox"
                            checked={overridePortalKey === "inherit"}
                            onChange={(e) =>
                              setOverridePortalKey(
                                e.target.checked ? "inherit" : portalKeyEnabled ? "enabled" : "disabled"
                              )
                            }
                            className={uiCheckboxClass}
                            disabled={
                              portalSettingsLoading ||
                              portalSettingsSaving ||
                              !overridePolicy.allow_portal_key ||
                              adminOverride?.allow_portal_key != null
                            }
                          />
                        </label>
                      </div>
                    }
                  >
                    {!overridePolicy.allow_portal_key && (
                      <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">{overrideDisabledLabel}</p>
                    )}
                    {adminOverride?.allow_portal_key != null && (
                      <p className="mt-2 ui-caption text-amber-600 dark:text-amber-300">{lockedByAdminLabel}</p>
                    )}
                  </PortalSettingsItem>
                  <PortalSettingsItem
                    title={t({ en: "Bucket creation", fr: "Creation de bucket", de: "Bucket-Erstellung" })}
                    description={t({ en: "Allow portal users to create buckets from the portal.", fr: "Autoriser les utilisateurs portail a creer des buckets.", de: "Portal-Benutzern das Erstellen von Buckets erlauben." })}
                    action={
                      <div className="flex flex-col items-end gap-2">
                        <PortalSettingsSwitch
                          checked={portalBucketCreateEnabled}
                          disabled={
                            portalSettingsLoading ||
                            portalSettingsSaving ||
                            overridePortalBucketCreate === "inherit" ||
                            !overridePolicy.allow_portal_user_bucket_create ||
                            adminOverride?.allow_portal_user_bucket_create != null
                          }
                          ariaLabel={t({ en: "Toggle bucket creation for portal users", fr: "Basculer la creation de bucket pour les utilisateurs portail", de: "Bucket-Erstellung fur Portal-Benutzer umschalten" })}
                          onChange={(value) => setOverridePortalBucketCreate(value ? "enabled" : "disabled")}
                        />
                        <label className={inheritToggleLabelClass}>
                          <span>{inheritLabel}</span>
                          <input
                            type="checkbox"
                            checked={overridePortalBucketCreate === "inherit"}
                            onChange={(e) =>
                              setOverridePortalBucketCreate(
                                e.target.checked ? "inherit" : portalBucketCreateEnabled ? "enabled" : "disabled"
                              )
                            }
                            className={uiCheckboxClass}
                            disabled={
                              portalSettingsLoading ||
                              portalSettingsSaving ||
                              !overridePolicy.allow_portal_user_bucket_create ||
                              adminOverride?.allow_portal_user_bucket_create != null
                            }
                          />
                        </label>
                      </div>
                    }
                  >
                    {!overridePolicy.allow_portal_user_bucket_create && (
                      <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">{overrideDisabledLabel}</p>
                    )}
                    {adminOverride?.allow_portal_user_bucket_create != null && (
                      <p className="mt-2 ui-caption text-amber-600 dark:text-amber-300">{lockedByAdminLabel}</p>
                    )}
                  </PortalSettingsItem>
                  <PortalSettingsItem
                    title={t({ en: "Access key creation", fr: "Creation de cles d'acces", de: "Zugriffsschlussel-Erstellung" })}
                    description={t({ en: "Allow portal users to create access keys from the portal.", fr: "Autoriser les utilisateurs portail a creer des cles d'acces.", de: "Portal-Benutzern das Erstellen von Zugriffsschlusseln erlauben." })}
                    action={
                      <div className="flex flex-col items-end gap-2">
                        <PortalSettingsSwitch
                          checked={portalAccessKeyCreateEnabled}
                          disabled={
                            portalSettingsLoading ||
                            portalSettingsSaving ||
                            overridePortalAccessKeyCreate === "inherit" ||
                            !overridePolicy.allow_portal_user_access_key_create ||
                            adminOverride?.allow_portal_user_access_key_create != null
                          }
                          ariaLabel={t({ en: "Toggle access key creation for portal users", fr: "Basculer la creation de cles d'acces pour les utilisateurs portail", de: "Erstellung von Zugriffsschlusseln fur Portal-Benutzer umschalten" })}
                          onChange={(value) => setOverridePortalAccessKeyCreate(value ? "enabled" : "disabled")}
                        />
                        <label className={inheritToggleLabelClass}>
                          <span>{inheritLabel}</span>
                          <input
                            type="checkbox"
                            checked={overridePortalAccessKeyCreate === "inherit"}
                            onChange={(e) =>
                              setOverridePortalAccessKeyCreate(
                                e.target.checked ? "inherit" : portalAccessKeyCreateEnabled ? "enabled" : "disabled"
                              )
                            }
                            className={uiCheckboxClass}
                            disabled={
                              portalSettingsLoading ||
                              portalSettingsSaving ||
                              !overridePolicy.allow_portal_user_access_key_create ||
                              adminOverride?.allow_portal_user_access_key_create != null
                            }
                          />
                        </label>
                      </div>
                    }
                  >
                    {!overridePolicy.allow_portal_user_access_key_create && (
                      <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">{overrideDisabledLabel}</p>
                    )}
                    {adminOverride?.allow_portal_user_access_key_create != null && (
                      <p className="mt-2 ui-caption text-amber-600 dark:text-amber-300">{lockedByAdminLabel}</p>
                    )}
                  </PortalSettingsItem>
                </PortalSettingsSection>

                <PortalSettingsSection title={t({ en: "IAM POLICIES", fr: "POLITIQUES IAM", de: "IAM-RICHTLINIEN" })} layout="stack">
                  <PortalSettingsItem
                    title={t({ en: "Policy portal-manager", fr: "Politique portal-manager", de: "Richtlinie portal-manager" })}
                    description={t({ en: "Actions granted to the portal-manager IAM group.", fr: "Actions accordees au groupe IAM portal-manager.", de: "Aktionen fur die IAM-Gruppe portal-manager." })}
                    action={
                      <label className={inheritToggleLabelClass}>
                        <span>{inheritLabel}</span>
                        <input
                          type="checkbox"
                          checked={managerPolicyMode === "inherit"}
                          onChange={(e) => {
                            const inherited = e.target.checked;
                            setManagerPolicyMode(inherited ? "inherit" : "actions");
                            if (!inherited && !managerPolicyActionsText) {
                              setManagerPolicyActionsText(
                                (effectivePortalSettings.iam_group_manager_policy.actions || []).join("\n")
                              );
                            }
                          }}
                          className={uiCheckboxClass}
                          disabled={
                            portalSettingsLoading ||
                            portalSettingsSaving ||
                            !overridePolicy.iam_group_manager_policy.actions ||
                            hasOwn(adminOverride?.iam_group_manager_policy as Record<string, unknown> | null, "actions") ||
                            hasOwn(adminOverride?.iam_group_manager_policy as Record<string, unknown> | null, "advanced_policy")
                          }
                        />
                      </label>
                    }
                  >
                    <textarea
                      value={managerPolicyActionsText}
                      onChange={(e) => setManagerPolicyActionsText(e.target.value)}
                      className={policyActionsTextareaClass}
                      rows={4}
                      disabled={
                        managerPolicyMode === "inherit" ||
                        portalSettingsLoading ||
                        portalSettingsSaving ||
                        !overridePolicy.iam_group_manager_policy.actions ||
                        hasOwn(adminOverride?.iam_group_manager_policy as Record<string, unknown> | null, "actions") ||
                        hasOwn(adminOverride?.iam_group_manager_policy as Record<string, unknown> | null, "advanced_policy")
                      }
                    />
                    {!overridePolicy.iam_group_manager_policy.actions && (
                      <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">{overrideDisabledLabel}</p>
                    )}
                    {(hasOwn(adminOverride?.iam_group_manager_policy as Record<string, unknown> | null, "actions") ||
                      hasOwn(adminOverride?.iam_group_manager_policy as Record<string, unknown> | null, "advanced_policy")) && (
                      <p className="mt-2 ui-caption text-amber-600 dark:text-amber-300">{lockedByAdminLabel}</p>
                    )}
                  </PortalSettingsItem>

                  <PortalSettingsItem
                    title={t({ en: "Policy portal-user", fr: "Politique portal-user", de: "Richtlinie portal-user" })}
                    description={t({ en: "Actions granted to the portal-user IAM group.", fr: "Actions accordees au groupe IAM portal-user.", de: "Aktionen fur die IAM-Gruppe portal-user." })}
                    action={
                      <label className={inheritToggleLabelClass}>
                        <span>{inheritLabel}</span>
                        <input
                          type="checkbox"
                          checked={userPolicyMode === "inherit"}
                          onChange={(e) => {
                            const inherited = e.target.checked;
                            setUserPolicyMode(inherited ? "inherit" : "actions");
                            if (!inherited && !userPolicyActionsText) {
                              setUserPolicyActionsText(
                                (effectivePortalSettings.iam_group_user_policy.actions || []).join("\n")
                              );
                            }
                          }}
                          className={uiCheckboxClass}
                          disabled={
                            portalSettingsLoading ||
                            portalSettingsSaving ||
                            !overridePolicy.iam_group_user_policy.actions ||
                            hasOwn(adminOverride?.iam_group_user_policy as Record<string, unknown> | null, "actions") ||
                            hasOwn(adminOverride?.iam_group_user_policy as Record<string, unknown> | null, "advanced_policy")
                          }
                        />
                      </label>
                    }
                  >
                    <textarea
                      value={userPolicyActionsText}
                      onChange={(e) => setUserPolicyActionsText(e.target.value)}
                      className={policyActionsTextareaClass}
                      rows={4}
                      disabled={
                        userPolicyMode === "inherit" ||
                        portalSettingsLoading ||
                        portalSettingsSaving ||
                        !overridePolicy.iam_group_user_policy.actions ||
                        hasOwn(adminOverride?.iam_group_user_policy as Record<string, unknown> | null, "actions") ||
                        hasOwn(adminOverride?.iam_group_user_policy as Record<string, unknown> | null, "advanced_policy")
                      }
                    />
                    {!overridePolicy.iam_group_user_policy.actions && (
                      <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">{overrideDisabledLabel}</p>
                    )}
                    {(hasOwn(adminOverride?.iam_group_user_policy as Record<string, unknown> | null, "actions") ||
                      hasOwn(adminOverride?.iam_group_user_policy as Record<string, unknown> | null, "advanced_policy")) && (
                      <p className="mt-2 ui-caption text-amber-600 dark:text-amber-300">{lockedByAdminLabel}</p>
                    )}
                  </PortalSettingsItem>

                  <PortalSettingsItem
                    title={t({ en: "Policy bucket access", fr: "Politique acces bucket", de: "Richtlinie Bucket-Zugriff" })}
                    description={t({ en: "Actions applied when granting bucket access.", fr: "Actions appliquees lors de l'octroi d'acces bucket.", de: "Aktionen beim Gewahren von Bucket-Zugriff." })}
                    action={
                      <label className={inheritToggleLabelClass}>
                        <span>{inheritLabel}</span>
                        <input
                          type="checkbox"
                          checked={bucketPolicyMode === "inherit"}
                          onChange={(e) => {
                            const inherited = e.target.checked;
                            setBucketPolicyMode(inherited ? "inherit" : "actions");
                            if (!inherited && !bucketPolicyActionsText) {
                              setBucketPolicyActionsText(
                                (effectivePortalSettings.bucket_access_policy.actions || []).join("\n")
                              );
                            }
                          }}
                          className={uiCheckboxClass}
                          disabled={
                            portalSettingsLoading ||
                            portalSettingsSaving ||
                            !overridePolicy.bucket_access_policy.actions ||
                            hasOwn(adminOverride?.bucket_access_policy as Record<string, unknown> | null, "actions") ||
                            hasOwn(adminOverride?.bucket_access_policy as Record<string, unknown> | null, "advanced_policy")
                          }
                        />
                      </label>
                    }
                  >
                    <textarea
                      value={bucketPolicyActionsText}
                      onChange={(e) => setBucketPolicyActionsText(e.target.value)}
                      className={policyActionsTextareaClass}
                      rows={4}
                      disabled={
                        bucketPolicyMode === "inherit" ||
                        portalSettingsLoading ||
                        portalSettingsSaving ||
                        !overridePolicy.bucket_access_policy.actions ||
                        hasOwn(adminOverride?.bucket_access_policy as Record<string, unknown> | null, "actions") ||
                        hasOwn(adminOverride?.bucket_access_policy as Record<string, unknown> | null, "advanced_policy")
                      }
                    />
                    {!overridePolicy.bucket_access_policy.actions && (
                      <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">{overrideDisabledLabel}</p>
                    )}
                    {(hasOwn(adminOverride?.bucket_access_policy as Record<string, unknown> | null, "actions") ||
                      hasOwn(adminOverride?.bucket_access_policy as Record<string, unknown> | null, "advanced_policy")) && (
                      <p className="mt-2 ui-caption text-amber-600 dark:text-amber-300">{lockedByAdminLabel}</p>
                    )}
                  </PortalSettingsItem>
                </PortalSettingsSection>

                <PortalSettingsSection title={t({ en: "BUCKET DEFAULTS", fr: "DEFAUTS BUCKET", de: "BUCKET-STANDARDWERTE" })} layout="grid">
                  <PortalSettingsItem
                    title={t({ en: "Versioning", fr: "Versioning", de: "Versionierung" })}
                    description={t({ en: "Enable versioning by default.", fr: "Activer le versioning par defaut.", de: "Versionierung standardmassig aktivieren." })}
                    action={
                      <div className="flex flex-col items-end gap-2">
                        <PortalSettingsSwitch
                          checked={bucketVersioningEnabled}
                          disabled={
                            portalSettingsLoading ||
                            portalSettingsSaving ||
                            bucketVersioningOverride === "inherit" ||
                            !overridePolicy.bucket_defaults.versioning ||
                            adminOverride?.bucket_defaults?.versioning != null
                          }
                          ariaLabel={t({ en: "Toggle default versioning", fr: "Basculer le versioning par defaut", de: "Standard-Versionierung umschalten" })}
                          onChange={(value) => setBucketVersioningOverride(value ? "enabled" : "disabled")}
                        />
                        <label className={inheritToggleLabelClass}>
                          <span>{inheritLabel}</span>
                          <input
                            type="checkbox"
                            checked={bucketVersioningOverride === "inherit"}
                            onChange={(e) =>
                              setBucketVersioningOverride(
                                e.target.checked ? "inherit" : bucketVersioningEnabled ? "enabled" : "disabled"
                              )
                            }
                            className={uiCheckboxClass}
                            disabled={
                              portalSettingsLoading ||
                              portalSettingsSaving ||
                              !overridePolicy.bucket_defaults.versioning ||
                              adminOverride?.bucket_defaults?.versioning != null
                            }
                          />
                        </label>
                      </div>
                    }
                  >
                    {!overridePolicy.bucket_defaults.versioning && (
                      <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">{overrideDisabledLabel}</p>
                    )}
                    {adminOverride?.bucket_defaults?.versioning != null && (
                      <p className="mt-2 ui-caption text-amber-600 dark:text-amber-300">{lockedByAdminLabel}</p>
                    )}
                  </PortalSettingsItem>
                  <PortalSettingsItem
                    title={t({ en: "Lifecycle", fr: "Lifecycle", de: "Lifecycle" })}
                    description={t({ en: "Apply lifecycle policy by default.", fr: "Appliquer la politique lifecycle par defaut.", de: "Lifecycle-Richtlinie standardmassig anwenden." })}
                    action={
                      <div className="flex flex-col items-end gap-2">
                        <PortalSettingsSwitch
                          checked={bucketLifecycleEnabled}
                          disabled={
                            portalSettingsLoading ||
                            portalSettingsSaving ||
                            bucketLifecycleOverride === "inherit" ||
                            !overridePolicy.bucket_defaults.enable_lifecycle ||
                            adminOverride?.bucket_defaults?.enable_lifecycle != null
                          }
                          ariaLabel={t({ en: "Toggle default lifecycle", fr: "Basculer le lifecycle par defaut", de: "Standard-Lifecycle umschalten" })}
                          onChange={(value) => setBucketLifecycleOverride(value ? "enabled" : "disabled")}
                        />
                        <label className={inheritToggleLabelClass}>
                          <span>{inheritLabel}</span>
                          <input
                            type="checkbox"
                            checked={bucketLifecycleOverride === "inherit"}
                            onChange={(e) =>
                              setBucketLifecycleOverride(
                                e.target.checked ? "inherit" : bucketLifecycleEnabled ? "enabled" : "disabled"
                              )
                            }
                            className={uiCheckboxClass}
                            disabled={
                              portalSettingsLoading ||
                              portalSettingsSaving ||
                              !overridePolicy.bucket_defaults.enable_lifecycle ||
                              adminOverride?.bucket_defaults?.enable_lifecycle != null
                            }
                          />
                        </label>
                      </div>
                    }
                  >
                    {!overridePolicy.bucket_defaults.enable_lifecycle && (
                      <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">{overrideDisabledLabel}</p>
                    )}
                    {adminOverride?.bucket_defaults?.enable_lifecycle != null && (
                      <p className="mt-2 ui-caption text-amber-600 dark:text-amber-300">{lockedByAdminLabel}</p>
                    )}
                  </PortalSettingsItem>
                  <PortalSettingsItem
                    title={t({ en: "CORS", fr: "CORS", de: "CORS" })}
                    description={t({ en: "Enable CORS by default.", fr: "Activer CORS par defaut.", de: "CORS standardmassig aktivieren." })}
                    action={
                      <div className="flex flex-col items-end gap-2">
                        <PortalSettingsSwitch
                          checked={bucketCorsEnabled}
                          disabled={
                            portalSettingsLoading ||
                            portalSettingsSaving ||
                            bucketCorsOverride === "inherit" ||
                            !overridePolicy.bucket_defaults.enable_cors ||
                            adminOverride?.bucket_defaults?.enable_cors != null
                          }
                          ariaLabel={t({ en: "Toggle default CORS", fr: "Basculer CORS par defaut", de: "Standard-CORS umschalten" })}
                          onChange={(value) => setBucketCorsOverride(value ? "enabled" : "disabled")}
                        />
                        <label className={inheritToggleLabelClass}>
                          <span>{inheritLabel}</span>
                          <input
                            type="checkbox"
                            checked={bucketCorsOverride === "inherit"}
                            onChange={(e) =>
                              setBucketCorsOverride(
                                e.target.checked ? "inherit" : bucketCorsEnabled ? "enabled" : "disabled"
                              )
                            }
                            className={uiCheckboxClass}
                            disabled={
                              portalSettingsLoading ||
                              portalSettingsSaving ||
                              !overridePolicy.bucket_defaults.enable_cors ||
                              adminOverride?.bucket_defaults?.enable_cors != null
                            }
                          />
                        </label>
                      </div>
                    }
                  >
                    {!overridePolicy.bucket_defaults.enable_cors && (
                      <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">{overrideDisabledLabel}</p>
                    )}
                    {adminOverride?.bucket_defaults?.enable_cors != null && (
                      <p className="mt-2 ui-caption text-amber-600 dark:text-amber-300">{lockedByAdminLabel}</p>
                    )}
                  </PortalSettingsItem>
                  <PortalSettingsItem
                    title={t({ en: "CORS origins", fr: "Origines CORS", de: "CORS-Ursprunge" })}
                    description={t({ en: "One URL per line for the CORS rule.", fr: "Une URL par ligne pour la regle CORS.", de: "Eine URL pro Zeile fur die CORS-Regel." })}
                    className="md:col-span-2"
                    action={
                      <label className={inheritToggleLabelClass}>
                        <span>{inheritLabel}</span>
                        <input
                          type="checkbox"
                          checked={!bucketCorsOriginsOverride}
                          onChange={(e) => {
                            const inherited = e.target.checked;
                            setBucketCorsOriginsOverride(!inherited);
                            if (inherited) {
                              setBucketCorsOriginsText(
                                (effectivePortalSettings.bucket_defaults.cors_allowed_origins || []).join("\n")
                              );
                            }
                          }}
                          className={uiCheckboxClass}
                          disabled={
                            portalSettingsLoading ||
                            portalSettingsSaving ||
                            !overridePolicy.bucket_defaults.cors_allowed_origins ||
                            adminOverride?.bucket_defaults?.cors_allowed_origins != null
                          }
                        />
                      </label>
                    }
                  >
                    <textarea
                      value={bucketCorsOriginsText}
                      onChange={(e) => setBucketCorsOriginsText(e.target.value)}
                      className={policyActionsTextareaClass}
                      rows={3}
                      placeholder="https://portal.example.com"
                      disabled={
                        !bucketCorsOriginsOverride ||
                        portalSettingsLoading ||
                        portalSettingsSaving ||
                        !overridePolicy.bucket_defaults.cors_allowed_origins ||
                        adminOverride?.bucket_defaults?.cors_allowed_origins != null
                      }
                    />
                    {!overridePolicy.bucket_defaults.cors_allowed_origins && (
                      <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">{overrideDisabledLabel}</p>
                    )}
                    {adminOverride?.bucket_defaults?.cors_allowed_origins != null && (
                      <p className="mt-2 ui-caption text-amber-600 dark:text-amber-300">{lockedByAdminLabel}</p>
                    )}
                  </PortalSettingsItem>
                </PortalSettingsSection>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
