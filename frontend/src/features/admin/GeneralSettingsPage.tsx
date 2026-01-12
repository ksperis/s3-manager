/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import { AppSettings, fetchAppSettings, fetchDefaultAppSettings, updateAppSettings } from "../../api/appSettings";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { confirmAction } from "../../utils/confirm";

export default function GeneralSettingsPage() {
  const { setGeneralSettings } = useGeneralSettings();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
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
      | "browser_enabled"
      | "portal_enabled"
      | "allow_login_access_keys"
      | "allow_login_endpoint_list"
      | "allow_login_custom_endpoint",
    value: boolean
  ) => {
    setSettings((prev) => (prev ? { ...prev, general: { ...prev.general, [field]: value } } : prev));
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await updateAppSettings(settings);
      setSettings(saved);
      setGeneralSettings(saved.general);
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
      />
      <form className="space-y-4" onSubmit={handleSave}>
        {error && <PageBanner tone="error">{error}</PageBanner>}
        {savedMessage && <PageBanner tone="success">{savedMessage}</PageBanner>}
        {!settings && !error && <PageBanner tone="info">Loading settings...</PageBanner>}
        {settings && (
          <div className="grid gap-4">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Manager feature</p>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    Enables the /manager environment for account administrators.
                  </p>
                </div>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={Boolean(settings.general.manager_enabled)}
                    onChange={(e) => handleToggle("manager_enabled", e.target.checked)}
                    aria-label="Manager feature"
                  />
                  <span className="h-5 w-9 rounded-full bg-slate-200 transition peer-checked:bg-emerald-500 dark:bg-slate-700" />
                  <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
                </label>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Browser feature</p>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    Enables the /browser environment for object navigation.
                  </p>
                </div>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={Boolean(settings.general.browser_enabled)}
                    onChange={(e) => handleToggle("browser_enabled", e.target.checked)}
                    aria-label="Browser feature"
                  />
                  <span className="h-5 w-9 rounded-full bg-slate-200 transition peer-checked:bg-emerald-500 dark:bg-slate-700" />
                  <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
                </label>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Portal feature</p>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    Enables the /portal environment for end users.
                  </p>
                </div>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={Boolean(settings.general.portal_enabled)}
                    onChange={(e) => handleToggle("portal_enabled", e.target.checked)}
                    aria-label="Portal feature"
                  />
                  <span className="h-5 w-9 rounded-full bg-slate-200 transition peer-checked:bg-emerald-500 dark:bg-slate-700" />
                  <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
                </label>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Access-key login</p>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    Allow users to sign in with S3 access keys.
                  </p>
                </div>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={Boolean(settings.general.allow_login_access_keys)}
                    onChange={(e) => handleToggle("allow_login_access_keys", e.target.checked)}
                    aria-label="Access-key login"
                  />
                  <span className="h-5 w-9 rounded-full bg-slate-200 transition peer-checked:bg-emerald-500 dark:bg-slate-700" />
                  <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
                </label>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Access-key endpoint list</p>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    Allow the access-key login screen to display the configured endpoints.
                  </p>
                </div>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={Boolean(settings.general.allow_login_endpoint_list)}
                    onChange={(e) => handleToggle("allow_login_endpoint_list", e.target.checked)}
                    aria-label="Access-key endpoint list"
                  />
                  <span className="h-5 w-9 rounded-full bg-slate-200 transition peer-checked:bg-emerald-500 dark:bg-slate-700" />
                  <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
                </label>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Custom login endpoint</p>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    Allow access-key users to enter a custom endpoint URL on the login screen.
                  </p>
                </div>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={Boolean(settings.general.allow_login_custom_endpoint)}
                    onChange={(e) => handleToggle("allow_login_custom_endpoint", e.target.checked)}
                    aria-label="Custom login endpoint"
                  />
                  <span className="h-5 w-9 rounded-full bg-slate-200 transition peer-checked:bg-emerald-500 dark:bg-slate-700" />
                  <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
                </label>
              </div>
            </div>
          </div>
        )}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={handleResetDefaults}
            disabled={!settings || saving || resetting}
            className="rounded-md border border-slate-200 px-4 py-2 ui-body font-medium text-slate-600 shadow-sm transition hover:border-slate-300 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200"
          >
            {resetting ? "Resetting..." : "Reset to defaults"}
          </button>
          <button
            type="submit"
            disabled={!settings || saving || resetting}
            className="rounded-md bg-primary px-4 py-2 ui-body font-medium text-white shadow-sm transition hover:bg-sky-500 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
