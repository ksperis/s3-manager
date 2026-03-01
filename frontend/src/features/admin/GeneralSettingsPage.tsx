/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import {
  PortalSettingsItem,
  PortalSettingsSection,
  PortalSettingsSwitch,
} from "../../components/PortalSettingsLayout";
import {
  AppSettings,
  GeneralFeatureLocks,
  fetchAppSettings,
  fetchDefaultAppSettings,
  fetchGeneralFeatureLocks,
  updateAppSettings,
} from "../../api/appSettings";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { applyBranding } from "../../components/ui/brandingRuntime";
import { confirmAction } from "../../utils/confirm";

const CEPH_ADMIN_WARNING_MESSAGE =
  "Ceph Admin is an advanced Ceph cluster mass-management feature (accounts, users, buckets). " +
  "It is not recommended to enable it on the same s3-manager instance exposed to end users.";
const PORTAL_EXPERIMENTAL_WARNING_MESSAGE = "Portal is an experimental feature.";
const BILLING_CRON_REMINDER_MESSAGE =
  "Billing feature enabled. Think about enabling the billing collection cron job.";
const CUSTOM_LOGIN_ENDPOINT_WARNING_MESSAGE =
  "Warning: custom endpoints are intended for trusted/local environments. Enabling this may expose users to malicious endpoints if misconfigured.";
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
  "browser_enabled",
  "portal_enabled",
  "billing_enabled",
  "endpoint_status_enabled",
] as const;
type FeatureField = (typeof FEATURE_FIELDS)[number];
type ToggleField =
  | FeatureField
  | "bucket_migration_enabled"
  | "allow_ui_user_bucket_migration"
  | "allow_login_access_keys"
  | "allow_login_endpoint_list"
  | "allow_login_custom_endpoint"
  | "allow_user_private_connections";

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

export default function GeneralSettingsPage() {
  const { setGeneralSettings } = useGeneralSettings();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [featureLocks, setFeatureLocks] = useState<GeneralFeatureLocks | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [billingReminder, setBillingReminder] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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
      .catch(() => setError("Unable to load settings."));
  }, [setGeneralSettings]);
  const isLogoUrlValid = isValidLoginLogoUrl(loginLogoUrlDraft);

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
      setError("Unable to save.");
    } finally {
      setSaving(false);
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
          ? { ...prev, general: defaults.general, branding: defaults.branding }
          : defaults
      );
      setLoginLogoUrlDraft(defaults.branding.login_logo_url ?? "");
      applyBranding(defaults.branding.primary_color);
    } catch (err) {
      console.error(err);
      setError("Unable to load default settings.");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="General settings"
        description="Global options for the platform."
        breadcrumbs={[
          { label: "Admin" },
          { label: "General" },
          { label: "Settings" },
        ]}
        rightContent={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleResetDefaults}
              disabled={!settings || saving || resetting}
              className="inline-flex items-center justify-center rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary disabled:pointer-events-none disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-200"
            >
              {resetting ? "Resetting..." : "Reset to defaults"}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!settings || saving || resetting || !isLogoUrlValid}
              className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:pointer-events-none disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        }
      />
      <form className="space-y-4" onSubmit={handleSave}>
        {error && <PageBanner tone="error">{error}</PageBanner>}
        {savedMessage && <PageBanner tone="success">{savedMessage}</PageBanner>}
        {billingReminder && <PageBanner tone="info">{billingReminder}</PageBanner>}
        {forcedFeaturesCount > 0 && (
          <PageBanner tone="info">
            {forcedFeaturesCount} feature switch(es) are currently forced by environment variables.
          </PageBanner>
        )}
        {!settings && !error && <PageBanner tone="info">Loading settings...</PageBanner>}
        {settings && (
          <div className="grid gap-4">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <PortalSettingsSection
                title="CORE FEATURES"
                description="Main application feature set available to your users."
                layout="grid"
                columns={1}
              >
                <PortalSettingsItem
                  title="Manager feature"
                  description="Tenant administration workspace."
                  action={
                    <PortalSettingsSwitch
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
                </PortalSettingsItem>
                <PortalSettingsItem
                  title="Browser feature"
                  description="Object and bucket navigation workspace."
                  action={
                    <PortalSettingsSwitch
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
                </PortalSettingsItem>
                <PortalSettingsItem
                  title="Portal feature"
                  description="End-user self-service workspace."
                  action={
                    <PortalSettingsSwitch
                      checked={Boolean(settings.general.portal_enabled)}
                      disabled={isFeatureLocked("portal_enabled")}
                      onChange={(value) => handleToggle("portal_enabled", value)}
                      ariaLabel="Portal feature"
                    />
                  }
                >
                  {settings.general.portal_enabled && (
                    <p className="mt-2 ui-caption text-amber-700 dark:text-amber-200">{PORTAL_EXPERIMENTAL_WARNING_MESSAGE}</p>
                  )}
                  {getFeatureLockHint("portal_enabled") && (
                    <p className="mt-2 ui-caption text-amber-700 dark:text-amber-200">
                      {getFeatureLockHint("portal_enabled")}
                    </p>
                  )}
                </PortalSettingsItem>
                <PortalSettingsItem
                  title="Ceph Admin feature"
                  description="Cluster-wide advanced operations."
                  action={
                    <PortalSettingsSwitch
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
                </PortalSettingsItem>
              </PortalSettingsSection>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <PortalSettingsSection
                title="EXTRA FEATURES"
                description="Optional capabilities that extend operations visibility."
                layout="grid"
                columns={1}
              >
                <PortalSettingsItem
                  title="Billing feature"
                  description="Enables the billing dashboards for admin and portal."
                  action={
                    <PortalSettingsSwitch
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
                </PortalSettingsItem>
                <PortalSettingsItem
                  title="Endpoint Status feature"
                  description="Enables the Endpoint Status workspace for endpoint healthchecks."
                  action={
                    <PortalSettingsSwitch
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
                </PortalSettingsItem>
                <PortalSettingsItem
                  title="Bucket migration tool"
                  description="Enables the Manager bucket migration tool."
                  action={
                    <PortalSettingsSwitch
                      checked={Boolean(settings.general.bucket_migration_enabled)}
                      onChange={(value) => {
                        handleToggle("bucket_migration_enabled", value);
                        if (!value) {
                          handleToggle("allow_ui_user_bucket_migration", false);
                        }
                      }}
                      ariaLabel="Bucket migration tool"
                    />
                  }
                />
              </PortalSettingsSection>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <PortalSettingsSection
                title="LOGIN OPTIONS"
                description="Control how access-key users authenticate and select endpoints."
                layout="grid"
                columns={1}
              >
                <PortalSettingsItem
                  title="Access-key login"
                  description="Allow users to sign in with S3 access keys."
                  action={
                    <PortalSettingsSwitch
                      checked={Boolean(settings.general.allow_login_access_keys)}
                      onChange={(value) => handleToggle("allow_login_access_keys", value)}
                      ariaLabel="Access-key login"
                    />
                  }
                />
                <PortalSettingsItem
                  title="Access-key endpoint list"
                  description="Allow the access-key login screen to display the configured endpoints."
                  action={
                    <PortalSettingsSwitch
                      checked={Boolean(settings.general.allow_login_endpoint_list)}
                      onChange={(value) => handleToggle("allow_login_endpoint_list", value)}
                      ariaLabel="Access-key endpoint list"
                    />
                  }
                />
                <PortalSettingsItem
                  title="Custom login endpoint"
                  description="Allow access-key users to enter a custom endpoint URL on the login screen."
                  action={
                    <PortalSettingsSwitch
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
                </PortalSettingsItem>
                <PortalSettingsItem
                  title="Private S3 connections for UI users"
                  description="Allow standard UI users to create and manage their own private S3 connections."
                  action={
                    <PortalSettingsSwitch
                      checked={Boolean(settings.general.allow_user_private_connections)}
                      onChange={(value) => handleToggle("allow_user_private_connections", value)}
                      ariaLabel="Private S3 connections for UI users"
                    />
                  }
                />
              </PortalSettingsSection>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <PortalSettingsSection
                title="BRANDING"
                description="Customize the primary accent color used across the application."
                layout="grid"
                columns={1}
              >
                <PortalSettingsItem
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
                        className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-white px-2 ui-caption font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      >
                        <span
                          className="inline-block h-3.5 w-3.5 rounded-full border border-slate-300 dark:border-slate-600"
                          style={{ backgroundColor: settings.branding.primary_color }}
                        />
                        Couleur personnalisée
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
                      className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
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
                      className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body text-slate-700 shadow-sm transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                    {!isLogoUrlValid && (
                      <p className="ui-caption text-rose-700 dark:text-rose-200">
                        Use an `http(s)` URL, a root-relative URL (`/logo.svg`) or a `data:image/...` URL.
                      </p>
                    )}
                    {isLogoUrlValid && loginLogoUrlDraft.trim() && (
                      <div className="rounded-md border border-slate-200/80 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/50">
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
                </PortalSettingsItem>
              </PortalSettingsSection>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
