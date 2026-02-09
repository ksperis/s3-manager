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
import { AppSettings, fetchAppSettings, fetchDefaultAppSettings, updateAppSettings } from "../../api/appSettings";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { confirmAction } from "../../utils/confirm";

const CEPH_ADMIN_WARNING_MESSAGE =
  "Ceph Admin is an advanced Ceph cluster mass-management feature (accounts, users, buckets). " +
  "It is not recommended to enable it on the same s3-manager instance exposed to end users.";
const BILLING_CRON_REMINDER_MESSAGE =
  "Billing feature enabled. Think about enabling the billing collection cron job.";

export default function GeneralSettingsPage() {
  const { setGeneralSettings } = useGeneralSettings();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [billingReminder, setBillingReminder] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    fetchAppSettings()
      .then((data) => {
        setSettings(data);
        setGeneralSettings(data.general);
      })
      .catch(() => setError("Unable to load settings."));
  }, [setGeneralSettings]);

  const handleToggle = (
    field:
      | "manager_enabled"
      | "ceph_admin_enabled"
      | "browser_enabled"
      | "portal_enabled"
      | "billing_enabled"
      | "endpoint_status_enabled"
      | "allow_login_access_keys"
      | "allow_login_endpoint_list"
      | "allow_login_custom_endpoint",
    value: boolean
  ) => {
    if (field === "billing_enabled") {
      const wasEnabled = Boolean(settings?.general.billing_enabled);
      if (value && !wasEnabled) {
        setBillingReminder(BILLING_CRON_REMINDER_MESSAGE);
      } else if (!value) {
        setBillingReminder(null);
      }
    }
    if (field === "ceph_admin_enabled" && value) {
      const wasEnabled = Boolean(settings?.general.ceph_admin_enabled);
      if (!wasEnabled) {
        const confirmed = confirmAction(
          "Enable Ceph Admin advanced mode?\n\n" +
            "This enables cluster-wide mass management operations and carries high risk.\n" +
            "Do not enable this on an instance exposed to end users.\n\n" +
            "Enable anyway?"
        );
        if (!confirmed) return;
      }
    }
    setSettings((prev) => (prev ? { ...prev, general: { ...prev.general, [field]: value } } : prev));
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
    if (!confirmAction("Reset general settings to defaults? Save changes to apply.")) return;
    setResetting(true);
    setError(null);
    setSavedMessage(null);
    try {
      const defaults = await fetchDefaultAppSettings();
      setSettings((prev) => (prev ? { ...prev, general: defaults.general } : defaults));
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
              disabled={!settings || saving || resetting}
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
        {settings?.general.ceph_admin_enabled && (
          <PageBanner tone="warning">
            Ceph Admin is currently enabled on this instance. {CEPH_ADMIN_WARNING_MESSAGE}
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
                  description="Enables the /manager environment for account administrators."
                  action={
                    <PortalSettingsSwitch
                      checked={Boolean(settings.general.manager_enabled)}
                      onChange={(value) => handleToggle("manager_enabled", value)}
                      ariaLabel="Manager feature"
                    />
                  }
                />
                <PortalSettingsItem
                  title="Browser feature"
                  description="Enables the /browser environment for object navigation."
                  action={
                    <PortalSettingsSwitch
                      checked={Boolean(settings.general.browser_enabled)}
                      onChange={(value) => handleToggle("browser_enabled", value)}
                      ariaLabel="Browser feature"
                    />
                  }
                />
                <PortalSettingsItem
                  title="Portal feature"
                  description="Enables the /portal environment for end users."
                  action={
                    <PortalSettingsSwitch
                      checked={Boolean(settings.general.portal_enabled)}
                      onChange={(value) => handleToggle("portal_enabled", value)}
                      ariaLabel="Portal feature"
                    />
                  }
                />
                <PortalSettingsItem
                  title="Billing feature"
                  description="Enables the billing dashboards for admin and portal."
                  action={
                    <PortalSettingsSwitch
                      checked={Boolean(settings.general.billing_enabled)}
                      onChange={(value) => handleToggle("billing_enabled", value)}
                      ariaLabel="Billing feature"
                    />
                  }
                />
                <PortalSettingsItem
                  title="Endpoint Status feature"
                  description="Enables the Endpoint Status workspace for endpoint healthchecks."
                  action={
                    <PortalSettingsSwitch
                      checked={Boolean(settings.general.endpoint_status_enabled)}
                      onChange={(value) => handleToggle("endpoint_status_enabled", value)}
                      ariaLabel="Endpoint Status feature"
                    />
                  }
                />
                <PortalSettingsItem
                  title="Ceph Admin feature"
                  description="Enables the /ceph-admin workspace for explicitly authorized UI admins."
                  action={
                    <PortalSettingsSwitch
                      checked={Boolean(settings.general.ceph_admin_enabled)}
                      onChange={(value) => handleToggle("ceph_admin_enabled", value)}
                      ariaLabel="Ceph Admin feature"
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
                />
              </PortalSettingsSection>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
