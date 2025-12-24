/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader";
import { AppSettings, fetchAppSettings, updateAppSettings } from "../../api/appSettings";

export default function PortalSettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchAppSettings()
      .then((data) => setSettings(data))
      .catch(() => setError("Unable to load settings."));
  }, []);

  const handleToggleAllowPortalKey = (value: boolean) => {
    setSettings((prev) => (prev ? { ...prev, portal: { ...prev.portal, allow_portal_key: value } } : prev));
  };

  const handleToggleAllowManagerUserStats = (value: boolean) => {
    setSettings((prev) => (prev ? { ...prev, manager: { ...prev.manager, allow_manager_user_usage_stats: value } } : prev));
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await updateAppSettings(settings);
      setSettings(saved);
      setSavedMessage("Settings saved.");
      setTimeout(() => setSavedMessage(null), 3000);
    } catch (err) {
      console.error(err);
      setError("Unable to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Portal dashboard"
        description="Configure user portal behavior."
        breadcrumbs={[
          { label: "Admin" },
          { label: "Portal" },
          { label: "Settings" },
        ]}
      />
      <form className="space-y-4" onSubmit={handleSave}>
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 shadow-sm dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100">
            {error}
          </div>
        )}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Show portal key</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Allows displaying and retrieving the active portal key in the user dashboard.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={Boolean(settings?.portal.allow_portal_key)}
                onChange={(e) => handleToggleAllowPortalKey(e.target.checked)}
                className="h-5 w-5 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                disabled={!settings}
              />
              <span>{settings?.portal.allow_portal_key ? "Enabled" : "Disabled"}</span>
            </label>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Bucket creation by portal_user</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Allows a portal_user to create a bucket from the portal (uses the account admin keys).
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={Boolean(settings?.portal.allow_portal_user_bucket_create)}
                onChange={(e) =>
                  setSettings((prev) => (prev ? { ...prev, portal: { ...prev.portal, allow_portal_user_bucket_create: e.target.checked } } : prev))
                }
                className="h-5 w-5 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                disabled={!settings}
              />
              <span>{settings?.portal.allow_portal_user_bucket_create ? "Enabled" : "Disabled"}</span>
            </label>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Manager stats for portal_user</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Allows a non-admin user to view bucket stats and usage from /manager.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={Boolean(settings?.manager.allow_manager_user_usage_stats)}
                onChange={(e) => handleToggleAllowManagerUserStats(e.target.checked)}
                className="h-5 w-5 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                disabled={!settings}
              />
              <span>{settings?.manager.allow_manager_user_usage_stats ? "Enabled" : "Disabled"}</span>
            </label>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!settings || saving}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          {savedMessage && <span className="text-xs text-emerald-600 dark:text-emerald-300">{savedMessage}</span>}
        </div>
      </form>
    </div>
  );
}
