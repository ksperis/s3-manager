/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import { AppSettings, fetchAppSettings, updateAppSettings } from "../../api/appSettings";

export default function ManagerSettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchAppSettings()
      .then((data) => setSettings(data))
      .catch(() => setError("Unable to load settings."));
  }, []);

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
    <div className="space-y-4">
      <PageHeader
        title="Manager settings"
        description="Configure manager dashboard visibility."
        breadcrumbs={[
          { label: "Admin" },
          { label: "Manager" },
          { label: "Settings" },
        ]}
      />
      <form className="space-y-4" onSubmit={handleSave}>
        {error && <PageBanner tone="error">{error}</PageBanner>}
        {savedMessage && <PageBanner tone="success">{savedMessage}</PageBanner>}
        {!settings && !error && <PageBanner tone="info">Loading settings...</PageBanner>}
        {settings && (
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Allow stats for all users</p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Allows every non-admin profile to view bucket stats and usage from /manager.
                </p>
              </div>
              <label className="inline-flex items-center gap-2 ui-body font-semibold text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={Boolean(settings.manager.allow_manager_user_usage_stats)}
                  onChange={(e) => handleToggleAllowManagerUserStats(e.target.checked)}
                  className="h-5 w-5 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                />
                <span>{settings.manager.allow_manager_user_usage_stats ? "Enabled" : "Disabled"}</span>
              </label>
            </div>
          </div>
        )}
        <div className="flex items-center justify-end gap-3">
          <button
            type="submit"
            disabled={!settings || saving}
            className="rounded-md bg-primary px-4 py-2 ui-body font-medium text-white shadow-sm transition hover:bg-sky-500 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
