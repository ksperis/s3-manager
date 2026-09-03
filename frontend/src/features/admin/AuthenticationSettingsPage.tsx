/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState, type FormEvent, type MouseEvent } from "react";
import PageShell from "../../components/PageShell";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import PageBanner from "../../components/PageBanner";
import {
  SettingsCard,
  SettingsFormCard,
  SettingsItem,
  SettingsSection,
  SettingsToggleAction,
  settingsCheckboxClassName,
  settingsHelperClassName,
  settingsInlineButtonClassName,
  settingsInputClassName,
  settingsLabelClassName,
  settingsPrimaryActionButtonClassName,
} from "../../components/settings/SettingsLayout";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { fetchAppSettings, fetchDefaultAppSettings, updateAppSettings, type AppSettings } from "../../api/appSettings";
import {
  createLdapAdminProvider,
  createOidcAdminProvider,
  deleteLdapAdminProvider,
  deleteOidcAdminProvider,
  fetchLdapAdminProviders,
  fetchOidcAdminProviders,
  updateLdapAdminProvider,
  updateOidcAdminProvider,
  type LdapProviderAdminItem,
  type LdapProviderAdminPayload,
  type OidcProviderAdminItem,
  type OidcProviderAdminPayload,
} from "../../api/authSettings";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";
import {
  isRecentWebAuthnVerificationCancelled,
  useRecentWebAuthnStepUp,
} from "../../auth/useRecentWebAuthnStepUp";
import { extractApiError } from "../../utils/apiError";

const CUSTOM_LOGIN_ENDPOINT_WARNING_MESSAGE =
  "Warning: custom endpoints are restricted to public HTTPS targets. Private/local hosts and insecure transport are rejected by the backend. Admin-managed HTTP endpoints remain possible only through the admin surfaces.";

type AuthenticationToggleField =
  | "allow_login_access_keys"
  | "allow_login_endpoint_list"
  | "allow_login_custom_endpoint"
  | "require_passkey_for_admins"
  | "require_passkey_for_users"
  | "allow_user_profile_name_edit"
  | "allow_user_external_identity_unlink";

type OidcProviderFormMode = "create" | "edit" | "view";
type LdapProviderFormMode = "create" | "edit" | "view";

type OidcProviderFormState = {
  provider_id: string;
  display_name: string;
  discovery_url: string;
  client_id: string;
  redirect_uri: string;
  scopesText: string;
  prompt: string;
  icon_url: string;
  enabled: boolean;
  use_pkce: boolean;
  use_nonce: boolean;
  client_secret: string;
  clear_client_secret: boolean;
  linking_policy: "manual" | "trusted_email";
  trustedEmailDomainsText: string;
};

type LdapProviderFormState = {
  provider_id: string;
  display_name: string;
  url: string;
  bind_dn: string;
  bind_password: string;
  user_base_dn: string;
  user_filter: string;
  email_attribute: string;
  name_attribute: string;
  subject_attribute: string;
  start_tls: boolean;
  tls_verify: boolean;
  tls_ca_file: string;
  allow_legacy_tls: boolean;
  timeout_seconds: string;
  enabled: boolean;
  allow_insecure: boolean;
};

type ProviderBadgeInput = {
  source: "environment" | "ui";
  enabled: boolean;
};

const LDAP_DEFAULT_USER_FILTER =
  "(|(mail={username})(uid={username})(sAMAccountName={username})(userPrincipalName={username}))";

const mobileProviderCardClassName =
  "rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] p-3";
const mobileProviderMetaLabelClassName =
  "ui-caption font-semibold uppercase text-slate-500 dark:text-slate-400";

function emptyOidcForm(): OidcProviderFormState {
  return {
    provider_id: "",
    display_name: "",
    discovery_url: "",
    client_id: "",
    redirect_uri: "",
    scopesText: "openid\nemail\nprofile",
    prompt: "",
    icon_url: "",
    enabled: true,
    use_pkce: true,
    use_nonce: true,
    client_secret: "",
    clear_client_secret: false,
    linking_policy: "manual",
    trustedEmailDomainsText: "",
  };
}

function oidcProviderToForm(provider: OidcProviderAdminItem): OidcProviderFormState {
  return {
    provider_id: provider.provider_id,
    display_name: provider.display_name,
    discovery_url: provider.discovery_url,
    client_id: provider.client_id,
    redirect_uri: provider.redirect_uri,
    scopesText: provider.scopes.join("\n"),
    prompt: provider.prompt ?? "",
    icon_url: provider.icon_url ?? "",
    enabled: provider.enabled,
    use_pkce: provider.use_pkce,
    use_nonce: provider.use_nonce,
    client_secret: "",
    clear_client_secret: false,
    linking_policy: provider.linking_policy ?? "manual",
    trustedEmailDomainsText: (provider.trusted_email_domains ?? []).join("\n"),
  };
}

function oidcPayloadFromForm(form: OidcProviderFormState): OidcProviderAdminPayload {
  const clientSecret = form.client_secret.trim();
  return {
    provider_id: form.provider_id.trim().toLowerCase(),
    display_name: form.display_name.trim(),
    discovery_url: form.discovery_url.trim(),
    client_id: form.client_id.trim(),
    redirect_uri: form.redirect_uri.trim(),
    scopes: form.scopesText
      .split(/[\n,]/)
      .map((scope) => scope.trim())
      .filter(Boolean),
    prompt: form.prompt.trim() || null,
    icon_url: form.icon_url.trim() || null,
    enabled: form.enabled,
    use_pkce: form.use_pkce,
    use_nonce: form.use_nonce,
    client_secret: clientSecret || null,
    clear_client_secret: form.clear_client_secret,
    linking_policy: form.linking_policy,
    trusted_email_domains: form.trustedEmailDomainsText
      .split(/[\n,]/)
      .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean),
  };
}

function emptyLdapForm(): LdapProviderFormState {
  return {
    provider_id: "",
    display_name: "",
    url: "ldaps://",
    bind_dn: "",
    bind_password: "",
    user_base_dn: "",
    user_filter: LDAP_DEFAULT_USER_FILTER,
    email_attribute: "mail",
    name_attribute: "displayName",
    subject_attribute: "",
    start_tls: false,
    tls_verify: true,
    tls_ca_file: "",
    allow_legacy_tls: false,
    timeout_seconds: "5",
    enabled: true,
    allow_insecure: false,
  };
}

function ldapProviderToForm(provider: LdapProviderAdminItem): LdapProviderFormState {
  return {
    provider_id: provider.provider_id,
    display_name: provider.display_name,
    url: provider.url,
    bind_dn: provider.bind_dn ?? "",
    bind_password: "",
    user_base_dn: provider.user_base_dn,
    user_filter: provider.user_filter,
    email_attribute: provider.email_attribute,
    name_attribute: provider.name_attribute ?? "",
    subject_attribute: provider.subject_attribute ?? "",
    start_tls: provider.start_tls,
    tls_verify: provider.tls_verify,
    tls_ca_file: provider.tls_ca_file ?? "",
    allow_legacy_tls: provider.allow_legacy_tls,
    timeout_seconds: String(provider.timeout_seconds),
    enabled: provider.enabled,
    allow_insecure: provider.allow_insecure,
  };
}

function ldapPayloadFromForm(form: LdapProviderFormState): LdapProviderAdminPayload {
  const bindDn = form.bind_dn.trim();
  const bindPassword = form.bind_password.trim();
  const timeoutSeconds = Number.parseFloat(form.timeout_seconds);
  return {
    provider_id: form.provider_id.trim().toLowerCase(),
    display_name: form.display_name.trim(),
    url: form.url.trim(),
    bind_dn: bindDn || null,
    bind_password: bindPassword || null,
    user_base_dn: form.user_base_dn.trim(),
    user_filter: form.user_filter.trim(),
    email_attribute: form.email_attribute.trim(),
    name_attribute: form.name_attribute.trim() || null,
    subject_attribute: form.subject_attribute.trim() || null,
    start_tls: form.start_tls,
    tls_verify: form.tls_verify,
    tls_ca_file: form.tls_ca_file.trim() || null,
    allow_legacy_tls: form.allow_legacy_tls,
    timeout_seconds: Number.isFinite(timeoutSeconds) ? timeoutSeconds : 5,
    enabled: form.enabled,
    allow_insecure: form.allow_insecure,
    clear_bind_password: !bindDn,
  };
}

function sourceBadge(provider: ProviderBadgeInput) {
  const isEnvironment = provider.source === "environment";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 ui-caption font-semibold ${
        isEnvironment
          ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100"
          : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100"
      }`}
    >
      {isEnvironment ? "Environment" : "UI"}
    </span>
  );
}

function statusBadge(provider: ProviderBadgeInput) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 ui-caption font-semibold ${
        provider.enabled
          ? "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-100"
          : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
      }`}
    >
      {provider.enabled ? "Enabled" : "Disabled"}
    </span>
  );
}

export default function AuthenticationSettingsPage() {
  const { setGeneralSettings } = useGeneralSettings();
  const authenticationConfirmation = useConfirmActionDialog();
  const { runWithStepUp, verificationDialog } = useRecentWebAuthnStepUp();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [oidcProviders, setOidcProviders] = useState<OidcProviderAdminItem[]>([]);
  const [oidcLoading, setOidcLoading] = useState(false);
  const [oidcSaving, setOidcSaving] = useState(false);
  const [oidcError, setOidcError] = useState<string | null>(null);
  const [oidcFormMode, setOidcFormMode] = useState<OidcProviderFormMode | null>(null);
  const [selectedOidcProvider, setSelectedOidcProvider] = useState<OidcProviderAdminItem | null>(null);
  const [oidcForm, setOidcForm] = useState<OidcProviderFormState>(() => emptyOidcForm());
  const [ldapProviders, setLdapProviders] = useState<LdapProviderAdminItem[]>([]);
  const [ldapLoading, setLdapLoading] = useState(false);
  const [ldapSaving, setLdapSaving] = useState(false);
  const [ldapError, setLdapError] = useState<string | null>(null);
  const [ldapFormMode, setLdapFormMode] = useState<LdapProviderFormMode | null>(null);
  const [selectedLdapProvider, setSelectedLdapProvider] = useState<LdapProviderAdminItem | null>(null);
  const [ldapForm, setLdapForm] = useState<LdapProviderFormState>(() => emptyLdapForm());

  const loadOidcProviders = useCallback(async () => {
    setOidcLoading(true);
    setOidcError(null);
    try {
      setOidcProviders(await fetchOidcAdminProviders());
    } catch (err) {
      console.error(err);
      setOidcError(extractApiError(err, "Unable to load OIDC providers."));
    } finally {
      setOidcLoading(false);
    }
  }, []);

  const loadLdapProviders = useCallback(async () => {
    setLdapLoading(true);
    setLdapError(null);
    try {
      setLdapProviders(await fetchLdapAdminProviders());
    } catch (err) {
      console.error(err);
      setLdapError(extractApiError(err, "Unable to load LDAP providers."));
    } finally {
      setLdapLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAppSettings()
      .then((data) => {
        setSettings(data);
        setGeneralSettings(data.general);
      })
      .catch((err) => setError(extractApiError(err, "Unable to load settings.")));
    void loadOidcProviders();
    void loadLdapProviders();
  }, [loadLdapProviders, loadOidcProviders, setGeneralSettings]);

  const handleToggle = (field: AuthenticationToggleField, value: boolean) => {
    if (field === "require_passkey_for_admins" && !value && settings?.general.require_passkey_for_admins) {
      authenticationConfirmation.requestConfirmation({
        title: "Disable required admin passkeys?",
        description: "Administrator sessions will no longer require a recent passkey verification for sensitive actions.",
        confirmLabel: "Disable protection",
        tone: "danger",
        impacts: ["Any active authorized Admin or Superadmin session will be sufficient for sensitive administration actions."],
        warning: "This weakens protection for every administrator account.",
        onConfirm: () => setSettings((prev) => (prev ? { ...prev, general: { ...prev.general, [field]: value } } : prev)),
      });
      return;
    }
    setSettings((prev) => (prev ? { ...prev, general: { ...prev.general, [field]: value } } : prev));
  };

  const showSavedMessage = (message: string) => {
    setSavedMessage(message);
    setTimeout(() => setSavedMessage(null), 3000);
  };

  const handleSave = async (event?: FormEvent | MouseEvent) => {
    event?.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await runWithStepUp(() => updateAppSettings(settings));
      setSettings(saved);
      setGeneralSettings(saved.general);
      showSavedMessage("Settings saved.");
    } catch (err) {
      if (!isRecentWebAuthnVerificationCancelled(err)) {
        console.error(err);
        setError(extractApiError(err, "Unable to save."));
      }
    } finally {
      setSaving(false);
    }
  };

  const resetDefaults = async () => {
    if (!settings) return;
    setResetting(true);
    setError(null);
    setSavedMessage(null);
    try {
      const defaults = await fetchDefaultAppSettings();
      setSettings((prev) =>
        prev
          ? {
              ...prev,
              general: {
                ...prev.general,
                allow_login_access_keys: defaults.general.allow_login_access_keys,
                allow_login_endpoint_list: defaults.general.allow_login_endpoint_list,
                allow_login_custom_endpoint: defaults.general.allow_login_custom_endpoint,
                require_passkey_for_admins: defaults.general.require_passkey_for_admins,
                require_passkey_for_users: defaults.general.require_passkey_for_users,
                allow_user_profile_name_edit: defaults.general.allow_user_profile_name_edit,
                allow_user_external_identity_unlink: defaults.general.allow_user_external_identity_unlink,
              },
            }
          : defaults
      );
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, "Unable to load default settings."));
    } finally {
      setResetting(false);
    }
  };

  const handleResetDefaults = () => {
    if (!settings) return;
    authenticationConfirmation.requestConfirmation({
      title: "Reset authentication settings draft?",
      description: "Load the default login options into this form.",
      confirmLabel: "Load defaults",
      tone: "primary",
      impacts: ["Your current login option edits will be replaced by the defaults."],
      warning: "The defaults are not applied until you save the form.",
      onConfirm: resetDefaults,
    });
  };

  const resetOidcProviderForm = () => {
    setSelectedOidcProvider(null);
    setOidcFormMode(null);
    setOidcForm(emptyOidcForm());
    setOidcError(null);
  };

  const resetLdapProviderForm = () => {
    setSelectedLdapProvider(null);
    setLdapFormMode(null);
    setLdapForm(emptyLdapForm());
    setLdapError(null);
  };

  const startCreateOidcProvider = () => {
    resetLdapProviderForm();
    setSelectedOidcProvider(null);
    setOidcFormMode("create");
    setOidcForm(emptyOidcForm());
    setOidcError(null);
  };

  const startEditOidcProvider = (provider: OidcProviderAdminItem) => {
    resetLdapProviderForm();
    setSelectedOidcProvider(provider);
    setOidcFormMode(provider.editable ? "edit" : "view");
    setOidcForm(oidcProviderToForm(provider));
    setOidcError(null);
  };

  const closeOidcForm = () => {
    resetOidcProviderForm();
  };

  const oidcFormReadOnly = oidcFormMode === "view" || selectedOidcProvider?.editable === false;

  const isOidcFieldLocked = (field: keyof OidcProviderFormState | "scopes" | "trusted_email_domains") => {
    if (oidcFormReadOnly) return true;
    if (field === "provider_id" && oidcFormMode === "edit") return true;
    const locks = selectedOidcProvider?.field_locks ?? {};
    return Boolean(locks[field]?.forced);
  };

  const oidcLockHint = (field: string) => {
    const lock = selectedOidcProvider?.field_locks?.[field];
    if (!lock?.forced) return null;
    return <p className={settingsHelperClassName}>Forced by {lock.source ?? "environment"}.</p>;
  };

  const updateOidcFormField = <K extends keyof OidcProviderFormState>(field: K, value: OidcProviderFormState[K]) => {
    setOidcForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleOidcProviderSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!oidcFormMode || oidcFormReadOnly) return;
    setOidcSaving(true);
    setOidcError(null);
    try {
      const payload = oidcPayloadFromForm(oidcForm);
      if (oidcFormMode === "create") {
        await runWithStepUp(() => createOidcAdminProvider(payload));
      } else {
        await runWithStepUp(() => updateOidcAdminProvider(
          selectedOidcProvider?.provider_id ?? payload.provider_id,
          payload,
        ));
      }
      await loadOidcProviders();
      closeOidcForm();
      showSavedMessage("OIDC provider saved.");
    } catch (err) {
      if (!isRecentWebAuthnVerificationCancelled(err)) {
        console.error(err);
        setOidcError(extractApiError(err, "Unable to save OIDC provider."));
      }
    } finally {
      setOidcSaving(false);
    }
  };

  const deleteOidcProvider = async (provider: OidcProviderAdminItem) => {
    if (!provider.editable) return;
    setOidcSaving(true);
    setOidcError(null);
    try {
      await runWithStepUp(() => deleteOidcAdminProvider(provider.provider_id));
      await loadOidcProviders();
      if (selectedOidcProvider?.provider_id === provider.provider_id) {
        closeOidcForm();
      }
      showSavedMessage("OIDC provider deleted.");
    } catch (err) {
      if (!isRecentWebAuthnVerificationCancelled(err)) {
        console.error(err);
        setOidcError(extractApiError(err, "Unable to delete OIDC provider."));
      }
    } finally {
      setOidcSaving(false);
    }
  };

  const handleDeleteOidcProvider = (provider: OidcProviderAdminItem) => {
    if (!provider.editable) return;
    authenticationConfirmation.requestConfirmation({
      title: "Delete OIDC provider?",
      description: "Remove this UI-managed identity provider from the application.",
      confirmLabel: "Delete provider",
      details: [
        { label: "Provider", value: provider.display_name },
        { label: "Provider ID", value: provider.provider_id, mono: true },
      ],
      impacts: ["Users will no longer be able to start new sign-ins with this provider."],
      onConfirm: () => deleteOidcProvider(provider),
    });
  };

  const startCreateLdapProvider = () => {
    resetOidcProviderForm();
    setSelectedLdapProvider(null);
    setLdapFormMode("create");
    setLdapForm(emptyLdapForm());
    setLdapError(null);
  };

  const startEditLdapProvider = (provider: LdapProviderAdminItem) => {
    resetOidcProviderForm();
    setSelectedLdapProvider(provider);
    setLdapFormMode(provider.editable ? "edit" : "view");
    setLdapForm(ldapProviderToForm(provider));
    setLdapError(null);
  };

  const closeLdapForm = () => {
    resetLdapProviderForm();
  };

  const ldapFormReadOnly = ldapFormMode === "view" || selectedLdapProvider?.editable === false;

  const isLdapFieldLocked = (field: keyof LdapProviderFormState) => {
    if (ldapFormReadOnly) return true;
    if (field === "provider_id" && ldapFormMode === "edit") return true;
    const locks = selectedLdapProvider?.field_locks ?? {};
    return Boolean(locks[field]?.forced);
  };

  const ldapLockHint = (field: string) => {
    const lock = selectedLdapProvider?.field_locks?.[field];
    if (!lock?.forced) return null;
    return <p className={settingsHelperClassName}>Forced by {lock.source ?? "environment"}.</p>;
  };

  const updateLdapFormField = <K extends keyof LdapProviderFormState>(field: K, value: LdapProviderFormState[K]) => {
    setLdapForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleLdapProviderSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ldapFormMode || ldapFormReadOnly) return;
    setLdapSaving(true);
    setLdapError(null);
    try {
      const payload = ldapPayloadFromForm(ldapForm);
      if (ldapFormMode === "create") {
        await runWithStepUp(() => createLdapAdminProvider(payload));
      } else {
        await runWithStepUp(() => updateLdapAdminProvider(
          selectedLdapProvider?.provider_id ?? payload.provider_id,
          payload,
        ));
      }
      await loadLdapProviders();
      closeLdapForm();
      showSavedMessage("LDAP provider saved.");
    } catch (err) {
      if (!isRecentWebAuthnVerificationCancelled(err)) {
        console.error(err);
        setLdapError(extractApiError(err, "Unable to save LDAP provider."));
      }
    } finally {
      setLdapSaving(false);
    }
  };

  const deleteLdapProvider = async (provider: LdapProviderAdminItem) => {
    if (!provider.editable) return;
    setLdapSaving(true);
    setLdapError(null);
    try {
      await runWithStepUp(() => deleteLdapAdminProvider(provider.provider_id));
      await loadLdapProviders();
      if (selectedLdapProvider?.provider_id === provider.provider_id) {
        closeLdapForm();
      }
      showSavedMessage("LDAP provider deleted.");
    } catch (err) {
      if (!isRecentWebAuthnVerificationCancelled(err)) {
        console.error(err);
        setLdapError(extractApiError(err, "Unable to delete LDAP provider."));
      }
    } finally {
      setLdapSaving(false);
    }
  };

  const handleDeleteLdapProvider = (provider: LdapProviderAdminItem) => {
    if (!provider.editable) return;
    authenticationConfirmation.requestConfirmation({
      title: "Delete LDAP provider?",
      description: "Remove this UI-managed directory provider from the application.",
      confirmLabel: "Delete provider",
      details: [
        { label: "Provider", value: provider.display_name },
        { label: "Provider ID", value: provider.provider_id, mono: true },
      ],
      impacts: ["Users will no longer be able to start new sign-ins with this provider."],
      onConfirm: () => deleteLdapProvider(provider),
    });
  };

  return (
    <PageShell
      title="Authentication settings"
      description="Configure login behavior, private connection access, OIDC providers, and LDAP providers."
      breadcrumbs={adminPageBreadcrumbs("authentication-settings")}
      actions={[
        {
          label: resetting ? "Resetting..." : "Reset to defaults",
          onClick: handleResetDefaults,
          variant: "ghost",
          disabled: !settings || saving || resetting,
        },
        {
          label: saving ? "Saving..." : "Save changes",
          onClick: handleSave,
          disabled: !settings || saving || resetting,
        },
      ]}
    >
      {error && <PageBanner tone="error">{error}</PageBanner>}
      {savedMessage && <PageBanner tone="success">{savedMessage}</PageBanner>}
      {!settings && !error && <PageBanner tone="info">Loading settings...</PageBanner>}
      {settings && (
        <SettingsFormCard onSubmit={handleSave}>
          <SettingsSection
            title="LOGIN OPTIONS"
            description="Control how access-key users authenticate and select endpoints."
            layout="grid"
            columns={1}
          >
            <SettingsItem
              title="Access-key login"
              description="Allow users to sign in with S3 access keys."
              action={
                <SettingsToggleAction
                  checked={Boolean(settings.general.allow_login_access_keys)}
                  onChange={(value) => handleToggle("allow_login_access_keys", value)}
                  ariaLabel="Access-key login"
                />
              }
            />
            <SettingsItem
              title="Access-key endpoint list"
              description="Allow the access-key login screen to display the configured endpoints."
              action={
                <SettingsToggleAction
                  checked={Boolean(settings.general.allow_login_endpoint_list)}
                  onChange={(value) => handleToggle("allow_login_endpoint_list", value)}
                  ariaLabel="Access-key endpoint list"
                />
              }
            />
            <SettingsItem
              title="Custom login endpoint"
              description="Allow access-key users to enter a custom endpoint URL on the login screen."
              action={
                <SettingsToggleAction
                  checked={Boolean(settings.general.allow_login_custom_endpoint)}
                  onChange={(value) => handleToggle("allow_login_custom_endpoint", value)}
                  ariaLabel="Custom login endpoint"
                />
              }
            >
              {settings.general.allow_login_custom_endpoint && (
                <p className="mt-2 ui-caption text-amber-700 dark:text-amber-200">
                  {CUSTOM_LOGIN_ENDPOINT_WARNING_MESSAGE}
                </p>
              )}
            </SettingsItem>
          </SettingsSection>
          <SettingsSection
            title="IDENTITY SECURITY POLICY"
            description="Choose which accounts require passkeys and which identity changes users may perform themselves."
            layout="grid"
            columns={1}
          >
            <SettingsItem
              title="Require passkeys for administrators"
              description="Require a passkey for Admin and Superadmin sign-in and recent WebAuthn verification for sensitive actions. Enabled by default."
              action={<SettingsToggleAction checked={settings.general.require_passkey_for_admins} onChange={(value) => handleToggle("require_passkey_for_admins", value)} ariaLabel="Require passkeys for administrators" />}
            />
            <SettingsItem
              title="Require passkeys for standard users"
              description="Require a passkey for ui_user and ui_none accounts at their next sign-in. Disabled by default."
              action={<SettingsToggleAction checked={settings.general.require_passkey_for_users} onChange={(value) => handleToggle("require_passkey_for_users", value)} ariaLabel="Require passkeys for standard users" />}
            />
            <SettingsItem
              title="Allow users to edit their profile name"
              description="Let users change their own display name. Disabled by default for enterprise-managed profiles."
              action={<SettingsToggleAction checked={settings.general.allow_user_profile_name_edit} onChange={(value) => handleToggle("allow_user_profile_name_edit", value)} ariaLabel="Allow users to edit their profile name" />}
            />
            <SettingsItem
              title="Allow users to unlink external identities"
              description="Let users unlink an identity only when another primary sign-in method remains. Disabled by default."
              action={<SettingsToggleAction checked={settings.general.allow_user_external_identity_unlink} onChange={(value) => handleToggle("allow_user_external_identity_unlink", value)} ariaLabel="Allow users to unlink external identities" />}
            />
          </SettingsSection>
        </SettingsFormCard>
      )}

      <SettingsCard>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="ui-caption font-semibold uppercase text-slate-500 dark:text-slate-400">OIDC PROVIDERS</p>
            <p className="ui-caption text-slate-500 dark:text-slate-400">
              Configure OpenID Connect login providers. Environment providers are shown as locked.
            </p>
          </div>
          <button
            type="button"
            className={settingsInlineButtonClassName}
            onClick={startCreateOidcProvider}
            disabled={oidcSaving}
          >
            Add OIDC provider
          </button>
        </div>
        {oidcError && <div className="mt-3"><PageBanner tone="error">{oidcError}</PageBanner></div>}
        {oidcLoading && <div className="mt-3"><PageBanner tone="info">Loading OIDC providers...</PageBanner></div>}
        <div className="mt-4 hidden overflow-x-auto md:block">
          <table className="min-w-full divide-y divide-[color:var(--ui-border)] text-left">
            <thead>
              <tr className="ui-caption uppercase text-slate-500 dark:text-slate-400">
                <th className="py-2 pr-4 font-semibold">Provider</th>
                <th className="px-4 py-2 font-semibold">Source</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">Redirect URI</th>
                <th className="py-2 pl-4 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--ui-border)]">
              {oidcProviders.length === 0 && !oidcLoading && (
                <tr>
                  <td className="py-4 ui-caption text-slate-500 dark:text-slate-400" colSpan={5}>
                    No OIDC providers configured.
                  </td>
                </tr>
              )}
              {oidcProviders.map((provider) => (
                <tr key={provider.provider_id} className="align-top">
                  <td className="py-3 pr-4">
                    <div className="ui-body font-semibold text-[var(--ui-text)]">{provider.display_name}</div>
                    <code className="ui-caption text-slate-500 dark:text-slate-400">{provider.provider_id}</code>
                  </td>
                  <td className="px-4 py-3">{sourceBadge(provider)}</td>
                  <td className="px-4 py-3">{statusBadge(provider)}</td>
                  <td className="max-w-md px-4 py-3 ui-caption text-slate-600 dark:text-slate-300">
                    <span className="break-all">{provider.redirect_uri}</span>
                  </td>
                  <td className="py-3 pl-4">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        className={tableActionButtonClasses}
                        onClick={() => startEditOidcProvider(provider)}
                        disabled={oidcSaving}
                        aria-label={`${provider.editable ? "Edit" : "View"} OIDC provider ${provider.provider_id}`}
                      >
                        {provider.editable ? "Edit" : "View"}
                      </button>
                      {provider.editable && (
                        <button
                          type="button"
                          className={tableDeleteActionClasses}
                          onClick={() => void handleDeleteOidcProvider(provider)}
                          disabled={oidcSaving}
                          aria-label={`Delete OIDC provider ${provider.provider_id}`}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 space-y-3 md:hidden">
          {oidcProviders.length === 0 && !oidcLoading && (
            <p className="ui-caption text-slate-500 dark:text-slate-400">No OIDC providers configured.</p>
          )}
          {oidcProviders.map((provider) => (
            <div key={provider.provider_id} className={mobileProviderCardClassName}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="ui-body font-semibold text-[var(--ui-text)]">{provider.display_name}</div>
                  <code className="ui-caption text-slate-500 dark:text-slate-400">{provider.provider_id}</code>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    className={tableActionButtonClasses}
                    onClick={() => startEditOidcProvider(provider)}
                    disabled={oidcSaving}
                    aria-label={`${provider.editable ? "Edit" : "View"} OIDC provider ${provider.provider_id}`}
                  >
                    {provider.editable ? "Edit" : "View"}
                  </button>
                  {provider.editable && (
                    <button
                      type="button"
                      className={tableDeleteActionClasses}
                      onClick={() => void handleDeleteOidcProvider(provider)}
                      disabled={oidcSaving}
                      aria-label={`Delete OIDC provider ${provider.provider_id}`}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <div className={mobileProviderMetaLabelClassName}>Source</div>
                  <div className="mt-1">{sourceBadge(provider)}</div>
                </div>
                <div>
                  <div className={mobileProviderMetaLabelClassName}>Status</div>
                  <div className="mt-1">{statusBadge(provider)}</div>
                </div>
              </div>
              <div className="mt-3">
                <div className={mobileProviderMetaLabelClassName}>Redirect URI</div>
                <p className="mt-1 break-all ui-caption text-slate-600 dark:text-slate-300">
                  {provider.redirect_uri}
                </p>
              </div>
            </div>
          ))}
        </div>

        {oidcFormMode && (
          <form className="mt-5 border-t border-[color:var(--ui-border)] pt-5" onSubmit={handleOidcProviderSubmit}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="ui-title text-[var(--ui-text)]">
                  {oidcFormMode === "create"
                    ? "Add OIDC provider"
                    : oidcFormMode === "view"
                      ? "View OIDC provider"
                      : "Edit OIDC provider"}
                </h2>
                {selectedOidcProvider?.source === "environment" && (
                  <p className={settingsHelperClassName}>This provider is managed by environment variables and cannot be edited here.</p>
                )}
                {selectedOidcProvider?.source === "ui" && selectedOidcProvider.has_client_secret && (
                  <p className={settingsHelperClassName}>A client secret is stored. Leave the secret field empty to keep it unchanged.</p>
                )}
              </div>
              <button
                type="button"
                className={tableActionButtonClasses}
                onClick={closeOidcForm}
                disabled={oidcSaving}
                aria-label="Close OIDC provider form"
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className={settingsLabelClassName}>Provider ID</span>
                <input
                  aria-label="Provider ID"
                className={settingsInputClassName}
                  value={oidcForm.provider_id}
                  onChange={(event) => updateOidcFormField("provider_id", event.target.value)}
                  disabled={isOidcFieldLocked("provider_id")}
                  required
                />
                {oidcLockHint("provider_id")}
              </label>
              <label className="block">
                <span className={settingsLabelClassName}>Display name</span>
                <input
                  aria-label="Display name"
                  className={settingsInputClassName}
                  value={oidcForm.display_name}
                  onChange={(event) => updateOidcFormField("display_name", event.target.value)}
                  disabled={isOidcFieldLocked("display_name")}
                  required
                />
                {oidcLockHint("display_name")}
              </label>
              <label className="block">
                <span className={settingsLabelClassName}>Discovery URL</span>
                <input
                  aria-label="Discovery URL"
                  className={settingsInputClassName}
                  value={oidcForm.discovery_url}
                  onChange={(event) => updateOidcFormField("discovery_url", event.target.value)}
                  disabled={isOidcFieldLocked("discovery_url")}
                  required
                />
                {oidcLockHint("discovery_url")}
              </label>
              <label className="block">
                <span className={settingsLabelClassName}>Client ID</span>
                <input
                  aria-label="Client ID"
                  className={settingsInputClassName}
                  value={oidcForm.client_id}
                  onChange={(event) => updateOidcFormField("client_id", event.target.value)}
                  disabled={isOidcFieldLocked("client_id")}
                  required
                />
                {oidcLockHint("client_id")}
              </label>
              <label className="block md:col-span-2">
                <span className={settingsLabelClassName}>Redirect URI</span>
                <input
                  aria-label="Redirect URI"
                  className={settingsInputClassName}
                  value={oidcForm.redirect_uri}
                  onChange={(event) => updateOidcFormField("redirect_uri", event.target.value)}
                  disabled={isOidcFieldLocked("redirect_uri")}
                  required
                />
                {oidcLockHint("redirect_uri")}
              </label>
              <label className="block">
                <span className={settingsLabelClassName}>Scopes</span>
                <textarea
                  aria-label="Scopes"
                  className={settingsInputClassName}
                  value={oidcForm.scopesText}
                  onChange={(event) => updateOidcFormField("scopesText", event.target.value)}
                  disabled={isOidcFieldLocked("scopes")}
                  rows={4}
                />
                {oidcLockHint("scopes")}
              </label>
              <div className="space-y-4">
                <label className="block">
                  <span className={settingsLabelClassName}>Prompt</span>
                  <input
                    aria-label="Prompt"
                    className={settingsInputClassName}
                    value={oidcForm.prompt}
                    onChange={(event) => updateOidcFormField("prompt", event.target.value)}
                    disabled={isOidcFieldLocked("prompt")}
                  />
                  {oidcLockHint("prompt")}
                </label>
                <label className="block">
                  <span className={settingsLabelClassName}>Icon URL</span>
                  <input
                    aria-label="Icon URL"
                    className={settingsInputClassName}
                    value={oidcForm.icon_url}
                    onChange={(event) => updateOidcFormField("icon_url", event.target.value)}
                    disabled={isOidcFieldLocked("icon_url")}
                  />
                  {oidcLockHint("icon_url")}
                </label>
              </div>
              <label className="block">
                <span className={settingsLabelClassName}>Identity linking policy</span>
                <select
                  aria-label="Identity linking policy"
                  className={settingsInputClassName}
                  value={oidcForm.linking_policy}
                  onChange={(event) => updateOidcFormField("linking_policy", event.target.value as "manual" | "trusted_email")}
                  disabled={isOidcFieldLocked("linking_policy")}
                >
                  <option value="manual">Manual approval</option>
                  <option value="trusted_email">Trusted verified email</option>
                </select>
                <p className={settingsHelperClassName}>Trusted email linking applies only to active standard local-password accounts without any prior external identity.</p>
                {oidcLockHint("linking_policy")}
              </label>
              <label className="block">
                <span className={settingsLabelClassName}>Trusted email domains</span>
                <textarea
                  aria-label="Trusted email domains"
                  className={settingsInputClassName}
                  value={oidcForm.trustedEmailDomainsText}
                  onChange={(event) => updateOidcFormField("trustedEmailDomainsText", event.target.value)}
                  disabled={isOidcFieldLocked("trusted_email_domains") || oidcForm.linking_policy !== "trusted_email"}
                  rows={3}
                  placeholder="example.com"
                />
                <p className={settingsHelperClassName}>Enter exact domains, one per line. Subdomains are not matched implicitly.</p>
                {oidcLockHint("trusted_email_domains")}
              </label>
              <label className="block md:col-span-2">
                <span className={settingsLabelClassName}>Client secret</span>
                <input
                  aria-label="Client secret"
                  className={settingsInputClassName}
                  type="password"
                  value={oidcForm.client_secret}
                  onChange={(event) => updateOidcFormField("client_secret", event.target.value)}
                  disabled={isOidcFieldLocked("client_secret") || oidcForm.clear_client_secret}
                  placeholder={selectedOidcProvider?.has_client_secret ? "Stored secret is not displayed" : ""}
                />
                {oidcLockHint("client_secret")}
              </label>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="inline-flex items-center gap-2 ui-body text-[var(--ui-text)]">
                <input
                  type="checkbox"
                  checked={oidcForm.enabled}
                  onChange={(event) => updateOidcFormField("enabled", event.target.checked)}
                  disabled={isOidcFieldLocked("enabled")}
                  className={settingsCheckboxClassName}
                />
                Enabled
              </label>
              <label className="inline-flex items-center gap-2 ui-body text-[var(--ui-text)]">
                <input
                  type="checkbox"
                  checked={oidcForm.use_pkce}
                  onChange={(event) => updateOidcFormField("use_pkce", event.target.checked)}
                  disabled={isOidcFieldLocked("use_pkce")}
                  className={settingsCheckboxClassName}
                />
                Use PKCE
              </label>
              <label className="inline-flex items-center gap-2 ui-body text-[var(--ui-text)]">
                <input
                  type="checkbox"
                  checked={oidcForm.use_nonce}
                  onChange={(event) => updateOidcFormField("use_nonce", event.target.checked)}
                  disabled={isOidcFieldLocked("use_nonce")}
                  className={settingsCheckboxClassName}
                />
                Use nonce
              </label>
              <label className="inline-flex items-center gap-2 ui-body text-[var(--ui-text)]">
                <input
                  type="checkbox"
                  checked={oidcForm.clear_client_secret}
                  onChange={(event) => updateOidcFormField("clear_client_secret", event.target.checked)}
                  disabled={oidcFormReadOnly || !selectedOidcProvider?.has_client_secret}
                  className={settingsCheckboxClassName}
                />
                Clear stored client secret
              </label>
            </div>

            {!oidcFormReadOnly && (
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" className={tableActionButtonClasses} onClick={closeOidcForm} disabled={oidcSaving}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className={settingsPrimaryActionButtonClassName}
                  disabled={oidcSaving}
                >
                  {oidcSaving ? "Saving..." : "Save OIDC provider"}
                </button>
              </div>
            )}
          </form>
        )}
      </SettingsCard>

      <SettingsCard>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="ui-caption font-semibold uppercase text-slate-500 dark:text-slate-400">LDAP PROVIDERS</p>
            <p className="ui-caption text-slate-500 dark:text-slate-400">
              Configure LDAP login providers. Environment providers are shown as locked.
            </p>
          </div>
          <button
            type="button"
            className={settingsInlineButtonClassName}
            onClick={startCreateLdapProvider}
            disabled={ldapSaving}
          >
            Add LDAP provider
          </button>
        </div>
        {ldapError && <div className="mt-3"><PageBanner tone="error">{ldapError}</PageBanner></div>}
        {ldapLoading && <div className="mt-3"><PageBanner tone="info">Loading LDAP providers...</PageBanner></div>}
        <div className="mt-4 hidden overflow-x-auto md:block">
          <table className="min-w-full divide-y divide-[color:var(--ui-border)] text-left">
            <thead>
              <tr className="ui-caption uppercase text-slate-500 dark:text-slate-400">
                <th className="py-2 pr-4 font-semibold">Provider</th>
                <th className="px-4 py-2 font-semibold">Source</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">URL</th>
                <th className="py-2 pl-4 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--ui-border)]">
              {ldapProviders.length === 0 && !ldapLoading && (
                <tr>
                  <td className="py-4 ui-caption text-slate-500 dark:text-slate-400" colSpan={5}>
                    No LDAP providers configured.
                  </td>
                </tr>
              )}
              {ldapProviders.map((provider) => (
                <tr key={provider.provider_id} className="align-top">
                  <td className="py-3 pr-4">
                    <div className="ui-body font-semibold text-[var(--ui-text)]">{provider.display_name}</div>
                    <code className="ui-caption text-slate-500 dark:text-slate-400">{provider.provider_id}</code>
                  </td>
                  <td className="px-4 py-3">{sourceBadge(provider)}</td>
                  <td className="px-4 py-3">{statusBadge(provider)}</td>
                  <td className="max-w-md px-4 py-3 ui-caption text-slate-600 dark:text-slate-300">
                    <span className="break-all">{provider.url}</span>
                  </td>
                  <td className="py-3 pl-4">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        className={tableActionButtonClasses}
                        onClick={() => startEditLdapProvider(provider)}
                        disabled={ldapSaving}
                        aria-label={`${provider.editable ? "Edit" : "View"} LDAP provider ${provider.provider_id}`}
                      >
                        {provider.editable ? "Edit" : "View"}
                      </button>
                      {provider.editable && (
                        <button
                          type="button"
                          className={tableDeleteActionClasses}
                          onClick={() => void handleDeleteLdapProvider(provider)}
                          disabled={ldapSaving}
                          aria-label={`Delete LDAP provider ${provider.provider_id}`}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 space-y-3 md:hidden">
          {ldapProviders.length === 0 && !ldapLoading && (
            <p className="ui-caption text-slate-500 dark:text-slate-400">No LDAP providers configured.</p>
          )}
          {ldapProviders.map((provider) => (
            <div key={provider.provider_id} className={mobileProviderCardClassName}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="ui-body font-semibold text-[var(--ui-text)]">{provider.display_name}</div>
                  <code className="ui-caption text-slate-500 dark:text-slate-400">{provider.provider_id}</code>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    className={tableActionButtonClasses}
                    onClick={() => startEditLdapProvider(provider)}
                    disabled={ldapSaving}
                    aria-label={`${provider.editable ? "Edit" : "View"} LDAP provider ${provider.provider_id}`}
                  >
                    {provider.editable ? "Edit" : "View"}
                  </button>
                  {provider.editable && (
                    <button
                      type="button"
                      className={tableDeleteActionClasses}
                      onClick={() => void handleDeleteLdapProvider(provider)}
                      disabled={ldapSaving}
                      aria-label={`Delete LDAP provider ${provider.provider_id}`}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <div className={mobileProviderMetaLabelClassName}>Source</div>
                  <div className="mt-1">{sourceBadge(provider)}</div>
                </div>
                <div>
                  <div className={mobileProviderMetaLabelClassName}>Status</div>
                  <div className="mt-1">{statusBadge(provider)}</div>
                </div>
              </div>
              <div className="mt-3">
                <div className={mobileProviderMetaLabelClassName}>URL</div>
                <p className="mt-1 break-all ui-caption text-slate-600 dark:text-slate-300">
                  {provider.url}
                </p>
              </div>
            </div>
          ))}
        </div>

        {ldapFormMode && (
          <form className="mt-5 border-t border-[color:var(--ui-border)] pt-5" onSubmit={handleLdapProviderSubmit}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="ui-title text-[var(--ui-text)]">
                  {ldapFormMode === "create"
                    ? "Add LDAP provider"
                    : ldapFormMode === "view"
                      ? "View LDAP provider"
                      : "Edit LDAP provider"}
                </h2>
                {selectedLdapProvider?.source === "environment" && (
                  <p className={settingsHelperClassName}>This provider is managed by environment variables and cannot be edited here.</p>
                )}
                {selectedLdapProvider?.source === "ui" && selectedLdapProvider.has_bind_password && (
                  <p className={settingsHelperClassName}>A bind password is stored. Leave the password field empty to keep it unchanged.</p>
                )}
              </div>
              <button
                type="button"
                className={tableActionButtonClasses}
                onClick={closeLdapForm}
                disabled={ldapSaving}
                aria-label="Close LDAP provider form"
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className={settingsLabelClassName}>Provider ID</span>
                <input
                  aria-label="LDAP Provider ID"
                  className={settingsInputClassName}
                  value={ldapForm.provider_id}
                  onChange={(event) => updateLdapFormField("provider_id", event.target.value)}
                  disabled={isLdapFieldLocked("provider_id")}
                  required
                />
                {ldapLockHint("provider_id")}
              </label>
              <label className="block">
                <span className={settingsLabelClassName}>Display name</span>
                <input
                  aria-label="LDAP Display name"
                  className={settingsInputClassName}
                  value={ldapForm.display_name}
                  onChange={(event) => updateLdapFormField("display_name", event.target.value)}
                  disabled={isLdapFieldLocked("display_name")}
                  required
                />
                {ldapLockHint("display_name")}
              </label>
              <label className="block md:col-span-2">
                <span className={settingsLabelClassName}>URL</span>
                <input
                  aria-label="LDAP URL"
                  className={settingsInputClassName}
                  value={ldapForm.url}
                  onChange={(event) => updateLdapFormField("url", event.target.value)}
                  disabled={isLdapFieldLocked("url")}
                  required
                />
                {ldapLockHint("url")}
              </label>
              <label className="block">
                <span className={settingsLabelClassName}>Bind DN (optional)</span>
                <input
                  aria-label="LDAP Bind DN"
                  className={settingsInputClassName}
                  value={ldapForm.bind_dn}
                  onChange={(event) => updateLdapFormField("bind_dn", event.target.value)}
                  disabled={isLdapFieldLocked("bind_dn")}
                />
                <p className={settingsHelperClassName}>Leave both bind fields empty to search the directory anonymously.</p>
                {ldapLockHint("bind_dn")}
              </label>
              <label className="block">
                <span className={settingsLabelClassName}>Bind password (optional)</span>
                <input
                  aria-label="LDAP Bind password"
                  className={settingsInputClassName}
                  type="password"
                  value={ldapForm.bind_password}
                  onChange={(event) => updateLdapFormField("bind_password", event.target.value)}
                  disabled={isLdapFieldLocked("bind_password")}
                  placeholder={selectedLdapProvider?.has_bind_password ? "Stored password is not displayed" : ""}
                  required={Boolean(ldapForm.bind_dn.trim()) && !selectedLdapProvider?.has_bind_password}
                />
                {ldapLockHint("bind_password")}
              </label>
              <label className="block md:col-span-2">
                <span className={settingsLabelClassName}>User base DN</span>
                <input
                  aria-label="LDAP User base DN"
                  className={settingsInputClassName}
                  value={ldapForm.user_base_dn}
                  onChange={(event) => updateLdapFormField("user_base_dn", event.target.value)}
                  disabled={isLdapFieldLocked("user_base_dn")}
                  required
                />
                {ldapLockHint("user_base_dn")}
              </label>
              <label className="block md:col-span-2">
                <span className={settingsLabelClassName}>User filter</span>
                <textarea
                  aria-label="LDAP User filter"
                  className={settingsInputClassName}
                  value={ldapForm.user_filter}
                  onChange={(event) => updateLdapFormField("user_filter", event.target.value)}
                  disabled={isLdapFieldLocked("user_filter")}
                  rows={3}
                  required
                />
                {ldapLockHint("user_filter")}
              </label>
              <label className="block">
                <span className={settingsLabelClassName}>Email attribute</span>
                <input
                  aria-label="LDAP Email attribute"
                  className={settingsInputClassName}
                  value={ldapForm.email_attribute}
                  onChange={(event) => updateLdapFormField("email_attribute", event.target.value)}
                  disabled={isLdapFieldLocked("email_attribute")}
                  required
                />
                {ldapLockHint("email_attribute")}
              </label>
              <label className="block">
                <span className={settingsLabelClassName}>Name attribute</span>
                <input
                  aria-label="LDAP Name attribute"
                  className={settingsInputClassName}
                  value={ldapForm.name_attribute}
                  onChange={(event) => updateLdapFormField("name_attribute", event.target.value)}
                  disabled={isLdapFieldLocked("name_attribute")}
                />
                {ldapLockHint("name_attribute")}
              </label>
              <label className="block">
                <span className={settingsLabelClassName}>Subject attribute</span>
                <input
                  aria-label="LDAP Subject attribute"
                  className={settingsInputClassName}
                  value={ldapForm.subject_attribute}
                  onChange={(event) => updateLdapFormField("subject_attribute", event.target.value)}
                  disabled={isLdapFieldLocked("subject_attribute")}
                />
                {ldapLockHint("subject_attribute")}
              </label>
              <label className="block">
                <span className={settingsLabelClassName}>TLS CA file</span>
                <input
                  aria-label="LDAP TLS CA file"
                  className={settingsInputClassName}
                  value={ldapForm.tls_ca_file}
                  onChange={(event) => updateLdapFormField("tls_ca_file", event.target.value)}
                  disabled={isLdapFieldLocked("tls_ca_file")}
                />
                {ldapLockHint("tls_ca_file")}
              </label>
              <label className="block">
                <span className={settingsLabelClassName}>Timeout seconds</span>
                <input
                  aria-label="LDAP Timeout seconds"
                  className={settingsInputClassName}
                  type="number"
                  min="0.1"
                  max="60"
                  step="0.1"
                  value={ldapForm.timeout_seconds}
                  onChange={(event) => updateLdapFormField("timeout_seconds", event.target.value)}
                  disabled={isLdapFieldLocked("timeout_seconds")}
                  required
                />
                {ldapLockHint("timeout_seconds")}
              </label>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="inline-flex items-center gap-2 ui-body text-[var(--ui-text)]">
                <input
                  type="checkbox"
                  checked={ldapForm.enabled}
                  onChange={(event) => updateLdapFormField("enabled", event.target.checked)}
                  disabled={isLdapFieldLocked("enabled")}
                  className={settingsCheckboxClassName}
                />
                Enabled
              </label>
              <label className="inline-flex items-center gap-2 ui-body text-[var(--ui-text)]">
                <input
                  type="checkbox"
                  checked={ldapForm.start_tls}
                  onChange={(event) => updateLdapFormField("start_tls", event.target.checked)}
                  disabled={isLdapFieldLocked("start_tls")}
                  className={settingsCheckboxClassName}
                />
                Start TLS
              </label>
              <label className="inline-flex items-center gap-2 ui-body text-[var(--ui-text)]">
                <input
                  type="checkbox"
                  checked={ldapForm.tls_verify}
                  onChange={(event) => updateLdapFormField("tls_verify", event.target.checked)}
                  disabled={isLdapFieldLocked("tls_verify")}
                  className={settingsCheckboxClassName}
                />
                Verify TLS
              </label>
              <label className="inline-flex items-center gap-2 ui-body text-[var(--ui-text)]">
                <input
                  type="checkbox"
                  aria-label="Allow legacy LDAP TLS ciphers"
                  checked={ldapForm.allow_legacy_tls}
                  onChange={(event) => updateLdapFormField("allow_legacy_tls", event.target.checked)}
                  disabled={isLdapFieldLocked("allow_legacy_tls")}
                  className={settingsCheckboxClassName}
                />
                Allow legacy TLS ciphers
              </label>
              <label className="inline-flex items-center gap-2 ui-body text-[var(--ui-text)]">
                <input
                  type="checkbox"
                  checked={ldapForm.allow_insecure}
                  onChange={(event) => updateLdapFormField("allow_insecure", event.target.checked)}
                  disabled={isLdapFieldLocked("allow_insecure")}
                  className={settingsCheckboxClassName}
                />
                Allow insecure LDAP
              </label>
            </div>
            {ldapForm.allow_legacy_tls && (
              <p className={settingsHelperClassName}>
                Legacy TLS compatibility enables the OpenSSL DEFAULT cipher set. Prefer enabling modern ECDHE
                cipher suites on the LDAP server.
              </p>
            )}

            {!ldapFormReadOnly && (
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" className={tableActionButtonClasses} onClick={closeLdapForm} disabled={ldapSaving}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className={settingsPrimaryActionButtonClassName}
                  disabled={ldapSaving}
                >
                  {ldapSaving ? "Saving..." : "Save LDAP provider"}
                </button>
              </div>
            )}
          </form>
        )}
      </SettingsCard>
      {authenticationConfirmation.confirmationDialog}
      {verificationDialog}
    </PageShell>
  );
}
