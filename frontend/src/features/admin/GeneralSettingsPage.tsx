/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import PageShell from "../../components/PageShell";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import PageBanner from "../../components/PageBanner";
import {
  SettingsCard,
  SettingsItem,
  SettingsSection,
  SettingsToggleAction,
  settingsInputClassName,
  settingsInlineButtonClassName,
  settingsLabelClassName,
} from "../../components/settings/SettingsLayout";
import {
  AppSettings,
  GeneralFeatureLocks,
  fetchAppSettings,
  fetchDefaultAppSettings,
  fetchGeneralFeatureLocks,
  sendQuotaNotificationTestEmail,
  updateAppSettings,
} from "../../api/appSettings";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { applyBranding } from "../../components/ui/brandingRuntime";
import { extractApiError } from "../../utils/apiError";
import { confirmAction } from "../../utils/confirm";

const CEPH_ADMIN_WARNING_MESSAGE =
  "Ceph Admin is an advanced Ceph cluster mass-management feature (accounts, users, buckets). " +
  "It is not recommended to enable it on the same s3-manager instance exposed to end users.";
const BILLING_CRON_REMINDER_MESSAGE =
  "Billing feature enabled. Think about enabling the billing collection cron job.";
const BRANDING_PRESET_COLORS = [
  "#0ea5e9",
  "#2563eb",
  "#0f766e",
  "#16a34a",
  "#d97706",
  "#dc2626",
  "#be123c",
  "#7c3aed",
] as const;
const FEATURE_FIELDS = [
  "manager_enabled",
  "ceph_admin_enabled",
  "storage_ops_enabled",
  "browser_enabled",
  "portal_enabled",
  "billing_enabled",
  "endpoint_status_enabled",
] as const;
type FeatureField = (typeof FEATURE_FIELDS)[number];
type ToggleField =
  | FeatureField
  | "quota_alerts_enabled"
  | "usage_history_enabled";

function isFeatureField(field: ToggleField): field is FeatureField {
  return FEATURE_FIELDS.includes(field as FeatureField);
}

function isValidLoginLogoUrl(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return true;
  if (normalized.startsWith("/")) return true;
  if (normalized.startsWith("data:image/")) return true;
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  return extractApiError(error, fallback);
}

export default function GeneralSettingsPage() {
  const { setGeneralSettings } = useGeneralSettings();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [featureLocks, setFeatureLocks] = useState<GeneralFeatureLocks | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [billingReminder, setBillingReminder] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testEmailError, setTestEmailError] = useState<string | null>(null);
  const [testEmailMessage, setTestEmailMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sendingTestEmail, setSendingTestEmail] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [loginLogoUrlDraft, setLoginLogoUrlDraft] = useState("");

  useEffect(() => {
    Promise.all([fetchAppSettings(), fetchGeneralFeatureLocks()])
      .then(([data, locks]) => {
        setSettings(data);
        setFeatureLocks(locks);
        setGeneralSettings(data.general);
        setLoginLogoUrlDraft(data.branding.login_logo_url ?? "");
        applyBranding(data.branding.primary_color);
      })
      .catch((err) => setError(extractApiError(err, "Unable to load settings.")));
  }, [setGeneralSettings]);
  const isLogoUrlValid = isValidLoginLogoUrl(loginLogoUrlDraft);
  const quotaThreshold = settings?.quota_notifications.threshold_percent ?? 85;
  const isQuotaThresholdValid = quotaThreshold >= 1 && quotaThreshold <= 100;

  const isFeatureLocked = (field: FeatureField): boolean => Boolean(featureLocks?.[field]?.forced);
  const getFeatureLockHint = (field: FeatureField): string | null => {
    const lock = featureLocks?.[field];
    if (!lock?.forced || lock.value == null) return null;
    const source = lock.source ? `${lock.source}=` : "";
    return `Forced by environment (${source}${lock.value ? "true" : "false"}).`;
  };
  const forcedFeaturesCount = featureLocks
    ? FEATURE_FIELDS.filter((field) => featureLocks[field]?.forced).length
    : 0;

  const handleToggle = (field: ToggleField, value: boolean) => {
    if (isFeatureField(field) && isFeatureLocked(field)) return;
    if (field === "billing_enabled") {
      const wasEnabled = Boolean(settings?.general.billing_enabled);
      if (value && !wasEnabled) {
        setBillingReminder(BILLING_CRON_REMINDER_MESSAGE);
      } else if (!value) {
        setBillingReminder(null);
      }
    }
    setSettings((prev) => (prev ? { ...prev, general: { ...prev.general, [field]: value } } : prev));
  };

  const handleBrandingColorChange = (value: string) => {
    const normalized = value.trim().toLowerCase();
    applyBranding(normalized);
    setSettings((prev) => (prev ? { ...prev, branding: { ...prev.branding, primary_color: normalized } } : prev));
  };

  const handleLoginLogoUrlChange = (value: string) => {
    setLoginLogoUrlDraft(value);
    if (!isValidLoginLogoUrl(value)) return;
    const normalized = value.trim();
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            branding: {
              ...prev.branding,
              login_logo_url: normalized || null,
            },
          }
        : prev
    );
  };

  const handleQuotaNotificationsChange = <K extends keyof AppSettings["quota_notifications"]>(
    field: K,
    value: AppSettings["quota_notifications"][K]
  ) => {
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            quota_notifications: {
              ...prev.quota_notifications,
              [field]: value,
            },
          }
        : prev
    );
  };

  const handleSave = async (event?: React.FormEvent | React.MouseEvent) => {
    event?.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await updateAppSettings(settings);
      setSettings(saved);
      setGeneralSettings(saved.general);
      setLoginLogoUrlDraft(saved.branding.login_logo_url ?? "");
      applyBranding(saved.branding.primary_color);
      if (!saved.general.billing_enabled) {
        setBillingReminder(null);
      }
      setSavedMessage("Settings saved.");
      setTimeout(() => setSavedMessage(null), 3000);
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, "Unable to save."));
    } finally {
      setSaving(false);
    }
  };

  const handleSendTestEmail = async () => {
    if (!settings) return;
    setSendingTestEmail(true);
    setTestEmailError(null);
    setTestEmailMessage(null);
    try {
      const result = await sendQuotaNotificationTestEmail(settings.quota_notifications);
      setTestEmailMessage(`Test email sent to ${result.recipient}.`);
    } catch (err) {
      console.error(err);
      setTestEmailError(getErrorMessage(err, "Unable to send test email."));
    } finally {
      setSendingTestEmail(false);
    }
  };

  const handleResetDefaults = async () => {
    if (!settings) return;
    if (!confirmAction("Reset general and branding settings to defaults? Save changes to apply.")) return;
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
                ...defaults.general,
                bucket_migration_enabled: prev.general.bucket_migration_enabled,
                bucket_purge_enabled: prev.general.bucket_purge_enabled,
                bucket_compare_enabled: prev.general.bucket_compare_enabled,
                bucket_integrity_check_enabled: prev.general.bucket_integrity_check_enabled,
                bucket_quota_management_enabled: prev.general.bucket_quota_management_enabled,
                ceph_s3_user_access_key_management_enabled: prev.general.ceph_s3_user_access_key_management_enabled,
                allow_login_access_keys: prev.general.allow_login_access_keys,
                allow_login_endpoint_list: prev.general.allow_login_endpoint_list,
                allow_login_custom_endpoint: prev.general.allow_login_custom_endpoint,
              },
              quota_notifications: defaults.quota_notifications,
              branding: defaults.branding,
            }
          : defaults
      );
      setLoginLogoUrlDraft(defaults.branding.login_logo_url ?? "");
      applyBranding(defaults.branding.primary_color);
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, "Unable to load default settings."));
    } finally {
      setResetting(false);
    }
  };

  return (
    <PageShell
      title="General settings"
      description="Global options for the platform."
      breadcrumbs={adminPageBreadcrumbs("general-settings")}
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
          disabled: !settings || saving || resetting || !isLogoUrlValid || !isQuotaThresholdValid,
        },
      ]}
    >
      <form className="space-y-4" onSubmit={handleSave}>
        {error && <PageBanner tone="error">{error}</PageBanner>}
        {testEmailError && <PageBanner tone="error">{testEmailError}</PageBanner>}
        {testEmailMessage && <PageBanner tone="success">{testEmailMessage}</PageBanner>}
        {savedMessage && <PageBanner tone="success">{savedMessage}</PageBanner>}
        {billingReminder && <PageBanner tone="info">{billingReminder}</PageBanner>}
        {!isQuotaThresholdValid && (
          <PageBanner tone="error">Quota threshold must be between 1 and 100.</PageBanner>
        )}
        {forcedFeaturesCount > 0 && (
          <PageBanner tone="info">
            {forcedFeaturesCount} feature switch(es) are currently forced by environment variables.
          </PageBanner>
        )}
        {!settings && !error && <PageBanner tone="info">Loading settings...</PageBanner>}
        {settings && (
          <div className="grid gap-4">
            <SettingsCard>
              <SettingsSection
                title="CORE FEATURES"
                description="Main application feature set available to your users."
                layout="grid"
                columns={1}
              >
                <SettingsItem
                  title="Manager feature"
                  description="Tenant administration workspace."
                  action={
                    <SettingsToggleAction
                      checked={Boolean(settings.general.manager_enabled)}
                      disabled={isFeatureLocked("manager_enabled")}
                      onChange={(value) => handleToggle("manager_enabled", value)}
                      ariaLabel="Manager feature"
                    />
                  }
                >
                  {getFeatureLockHint("manager_enabled") && (
                    <p className="mt-2 ui-caption text-amber-700 dark:text-amber-200">
                      {getFeatureLockHint("manager_enabled")}
                    </p>
                  )}
                </SettingsItem>
                <SettingsItem
                  title="Browser feature"
                  description="Object and bucket navigation workspace."
                  action={
                    <SettingsToggleAction
                      checked={Boolean(settings.general.browser_enabled)}
                      disabled={isFeatureLocked("browser_enabled")}
                      onChange={(value) => handleToggle("browser_enabled", value)}
                      ariaLabel="Browser feature"
                    />
                  }
                >
                  {getFeatureLockHint("browser_enabled") && (
                    <p className="mt-2 ui-caption text-amber-700 dark:text-amber-200">
                      {getFeatureLockHint("browser_enabled")}
                    </p>
                  )}
                </SettingsItem>
                <SettingsItem
                  title="Portal feature"
                  description="Self-service workspace governed by explicit per-account portal roles."
                  action={
                    <SettingsToggleAction
                      checked={Boolean(settings.general.portal_enabled)}
                      disabled={isFeatureLocked("portal_enabled")}
                      onChange={(value) => handleToggle("portal_enabled", value)}
                      ariaLabel="Portal feature"
                      badge={{ visible: true, label: "Experimental", tone: "warning" }}
                    />
                  }
                >
                  {getFeatureLockHint("portal_enabled") && (
                    <p className="mt-2 ui-caption text-amber-700 dark:text-amber-200">
                      {getFeatureLockHint("portal_enabled")}
                    </p>
                  )}
                </SettingsItem>
                <SettingsItem
                  title="Ceph Admin feature"
                  description="Cluster-wide advanced operations."
                  action={
                    <SettingsToggleAction
                      checked={Boolean(settings.general.ceph_admin_enabled)}
                      disabled={isFeatureLocked("ceph_admin_enabled")}
                      onChange={(value) => handleToggle("ceph_admin_enabled", value)}
                      ariaLabel="Ceph Admin feature"
                    />
                  }
                >
                  {settings.general.ceph_admin_enabled && (
                    <p className="mt-2 ui-caption text-amber-700 dark:text-amber-200">{CEPH_ADMIN_WARNING_MESSAGE}</p>
                  )}
                  {getFeatureLockHint("ceph_admin_enabled") && (
                    <p className="mt-2 ui-caption text-amber-700 dark:text-amber-200">
                      {getFeatureLockHint("ceph_admin_enabled")}
                    </p>
                  )}
                </SettingsItem>
                <SettingsItem
                  title="Storage Ops feature"
                  description="Cross-account and cross-connection bucket operations workspace."
                  action={
                    <SettingsToggleAction
                      checked={Boolean(settings.general.storage_ops_enabled)}
                      disabled={isFeatureLocked("storage_ops_enabled")}
                      onChange={(value) => handleToggle("storage_ops_enabled", value)}
                      ariaLabel="Storage Ops feature"
                    />
                  }
                >
                  {getFeatureLockHint("storage_ops_enabled") && (
                    <p className="mt-2 ui-caption text-amber-700 dark:text-amber-200">
                      {getFeatureLockHint("storage_ops_enabled")}
                    </p>
                  )}
                </SettingsItem>
              </SettingsSection>
            </SettingsCard>
            <SettingsCard>
              <SettingsSection
                title="EXTRA FEATURES"
                description="Optional capabilities that extend operations visibility."
                layout="grid"
                columns={1}
              >
                <SettingsItem
                  title="Billing feature"
                  description="Enables the billing dashboards."
                  action={
                    <SettingsToggleAction
                      checked={Boolean(settings.general.billing_enabled)}
                      disabled={isFeatureLocked("billing_enabled")}
                      onChange={(value) => handleToggle("billing_enabled", value)}
                      ariaLabel="Billing feature"
                    />
                  }
                >
                  {getFeatureLockHint("billing_enabled") && (
                    <p className="mt-2 ui-caption text-amber-700 dark:text-amber-200">
                      {getFeatureLockHint("billing_enabled")}
                    </p>
                  )}
                </SettingsItem>
                <SettingsItem
                  title="Endpoint Status feature"
                  description="Enables the Endpoint Status workspace for endpoint healthchecks."
                  action={
                    <SettingsToggleAction
                      checked={Boolean(settings.general.endpoint_status_enabled)}
                      disabled={isFeatureLocked("endpoint_status_enabled")}
                      onChange={(value) => handleToggle("endpoint_status_enabled", value)}
                      ariaLabel="Endpoint Status feature"
                    />
                  }
                >
                  {getFeatureLockHint("endpoint_status_enabled") && (
                    <p className="mt-2 ui-caption text-amber-700 dark:text-amber-200">
                      {getFeatureLockHint("endpoint_status_enabled")}
                    </p>
                  )}
                </SettingsItem>
                <SettingsItem
                  title="Quota alerts feature"
                  description="Enables quota threshold/full email notifications for S3 Accounts and S3 Users."
                  action={
                    <SettingsToggleAction
                      checked={Boolean(settings.general.quota_alerts_enabled)}
                      onChange={(value) => handleToggle("quota_alerts_enabled", value)}
                      ariaLabel="Quota alerts feature"
                    />
                  }
                />
                <SettingsItem
                  title="Usage history feature"
                  description="Collects quota usage history snapshots for future metrics trends."
                  action={
                    <SettingsToggleAction
                      checked={Boolean(settings.general.usage_history_enabled)}
                      onChange={(value) => handleToggle("usage_history_enabled", value)}
                      ariaLabel="Usage history feature"
                    />
                  }
                />
              </SettingsSection>
            </SettingsCard>
            <SettingsCard>
              <SettingsSection
                title="QUOTA NOTIFICATIONS"
                description="Configure threshold notifications and SMTP delivery."
                layout="grid"
                columns={1}
              >
                <SettingsItem
                  title="Threshold percent"
                  description="Alert when usage reaches this percent of quota (full alerts are always sent at 100%)."
                >
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={settings.quota_notifications.threshold_percent}
                    onChange={(event) =>
                      handleQuotaNotificationsChange(
                        "threshold_percent",
                        Math.max(1, Math.min(100, Number(event.target.value || 0)))
                      )
                    }
                    className={`mt-3 ${settingsInputClassName}`}
                  />
                </SettingsItem>
                <SettingsItem
                  title="Include subject contact email"
                  description="Also send alerts to account.email / s3_user.email when defined."
                  action={
                    <SettingsToggleAction
                      checked={Boolean(settings.quota_notifications.include_subject_contact_email)}
                      onChange={(value) => handleQuotaNotificationsChange("include_subject_contact_email", value)}
                      ariaLabel="Include subject contact email"
                    />
                  }
                />
                <SettingsItem
                  title="SMTP host"
                  description="SMTP host used to send quota notifications."
                >
                  <input
                    type="text"
                    value={settings.quota_notifications.smtp_host ?? ""}
                    onChange={(event) => handleQuotaNotificationsChange("smtp_host", event.target.value || null)}
                    placeholder="smtp.example.com"
                    className={`mt-3 ${settingsInputClassName}`}
                  />
                </SettingsItem>
                <SettingsItem
                  title="SMTP port"
                  description="SMTP server port."
                >
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={settings.quota_notifications.smtp_port}
                    onChange={(event) =>
                      handleQuotaNotificationsChange(
                        "smtp_port",
                        Math.max(1, Math.min(65535, Number(event.target.value || 0)))
                      )
                    }
                    className={`mt-3 ${settingsInputClassName}`}
                  />
                </SettingsItem>
                <SettingsItem
                  title="SMTP username"
                  description="Optional SMTP username (required if SMTP_PASSWORD is set)."
                >
                  <input
                    type="text"
                    value={settings.quota_notifications.smtp_username ?? ""}
                    onChange={(event) => handleQuotaNotificationsChange("smtp_username", event.target.value || null)}
                    className={`mt-3 ${settingsInputClassName}`}
                  />
                </SettingsItem>
                <SettingsItem
                  title="SMTP from email"
                  description="Sender email address used for notifications."
                >
                  <input
                    type="email"
                    value={settings.quota_notifications.smtp_from_email ?? ""}
                    onChange={(event) => handleQuotaNotificationsChange("smtp_from_email", event.target.value || null)}
                    placeholder="alerts@example.com"
                    className={`mt-3 ${settingsInputClassName}`}
                  />
                </SettingsItem>
                <SettingsItem
                  title="SMTP from name"
                  description="Optional sender display name."
                >
                  <input
                    type="text"
                    value={settings.quota_notifications.smtp_from_name ?? ""}
                    onChange={(event) => handleQuotaNotificationsChange("smtp_from_name", event.target.value || null)}
                    className={`mt-3 ${settingsInputClassName}`}
                  />
                </SettingsItem>
                <SettingsItem
                  title="SMTP STARTTLS"
                  description="Enable STARTTLS upgrade for SMTP transport."
                  action={
                    <SettingsToggleAction
                      checked={Boolean(settings.quota_notifications.smtp_starttls)}
                      onChange={(value) => handleQuotaNotificationsChange("smtp_starttls", value)}
                      ariaLabel="SMTP STARTTLS"
                    />
                  }
                />
                <SettingsItem
                  title="SMTP timeout (seconds)"
                  description="Connection timeout used by SMTP delivery."
                >
                  <input
                    type="number"
                    min={1}
                    max={300}
                    value={settings.quota_notifications.smtp_timeout_seconds}
                    onChange={(event) =>
                      handleQuotaNotificationsChange(
                        "smtp_timeout_seconds",
                        Math.max(1, Math.min(300, Number(event.target.value || 0)))
                      )
                    }
                    className={`mt-3 ${settingsInputClassName}`}
                  />
                  <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">
                    SMTP password must be provided through the backend environment variable <code>SMTP_PASSWORD</code>.
                  </p>
                  <button
                    type="button"
                    onClick={handleSendTestEmail}
                    disabled={sendingTestEmail || saving || resetting}
                    className={`mt-3 ${settingsInlineButtonClassName}`}
                  >
                    {sendingTestEmail ? "Sending test..." : "Send test email"}
                  </button>
                </SettingsItem>
              </SettingsSection>
            </SettingsCard>
            <SettingsCard>
              <SettingsSection
                title="BRANDING"
                description="Customize the primary accent color used across the application."
                layout="grid"
                columns={1}
              >
                <SettingsItem
                  title="Primary accent color"
                  description="Used for primary buttons, links, focus states and selected elements."
                >
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {BRANDING_PRESET_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={`Use preset color ${color}`}
                        onClick={() => handleBrandingColorChange(color)}
                        className={`h-7 w-7 rounded-full border shadow-sm transition hover:scale-105 ${
                          settings.branding.primary_color === color
                            ? "border-slate-900 ring-2 ring-primary/50 dark:border-slate-100"
                            : "border-slate-300 dark:border-slate-600"
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                    <div className="relative ml-1">
                      <label
                        htmlFor="branding-primary-picker"
                      className={settingsInlineButtonClassName}
                      >
                        <span
                          className="inline-block h-3.5 w-3.5 rounded-full border border-slate-300 dark:border-slate-600"
                          style={{ backgroundColor: settings.branding.primary_color }}
                        />
                        Custom color
                      </label>
                      <input
                        id="branding-primary-picker"
                        aria-label="Primary color picker"
                        type="color"
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                        value={settings.branding.primary_color}
                        onChange={(event) => handleBrandingColorChange(event.target.value)}
                      />
                    </div>
                    <span className="ui-caption font-semibold text-slate-700 dark:text-slate-100">
                      {settings.branding.primary_color}
                    </span>
                  </div>
                  <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">
                    Save changes to apply this color across the whole UI, including the login page.
                  </p>
                  <div className="mt-3 space-y-1.5">
                    <label
                      htmlFor="branding-login-logo-url"
                      className={settingsLabelClassName}
                    >
                      Login logo URL
                    </label>
                    <input
                      id="branding-login-logo-url"
                      aria-label="Login logo URL"
                      type="url"
                      value={loginLogoUrlDraft}
                      onChange={(event) => handleLoginLogoUrlChange(event.target.value)}
                      placeholder="https://cdn.example.com/logo.svg"
                      className={settingsInputClassName}
                    />
                    {!isLogoUrlValid && (
                      <p className="ui-caption text-rose-700 dark:text-rose-200">
                        Use an `http(s)` URL, a root-relative URL (`/logo.svg`) or a `data:image/...` URL.
                      </p>
                    )}
                    {isLogoUrlValid && loginLogoUrlDraft.trim() && (
                      <div className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] px-3 py-2">
                        <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Login preview
                        </p>
                        <img
                          src={loginLogoUrlDraft.trim()}
                          alt="Company logo preview"
                          className="mt-2 max-h-16 w-auto object-contain"
                        />
                      </div>
                    )}
                  </div>
                </SettingsItem>
              </SettingsSection>
            </SettingsCard>
          </div>
        )}
      </form>
    </PageShell>
  );
}
