/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import { AppSettings, fetchAppSettings, fetchDefaultAppSettings, updateAppSettings } from "../../api/appSettings";
import { confirmAction } from "../../utils/confirm";

export default function ManagerSettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    fetchAppSettings()
      .then((data) => setSettings(data))
      .catch(() => setError("Unable to load settings."));
  }, []);

  const handleToggleAllowManagerUserStats = (value: boolean) => {
    setSettings((prev) => (prev ? { ...prev, manager: { ...prev.manager, allow_manager_user_usage_stats: value } } : prev));
  };

  const handleSave = async (event?: React.FormEvent | React.MouseEvent) => {
    event?.preventDefault();
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

  const handleResetDefaults = async () => {
    if (!settings) return;
    if (!confirmAction("Reset manager settings to defaults? Save changes to apply.")) return;
    setResetting(true);
    setError(null);
    setSavedMessage(null);
    try {
      const defaults = await fetchDefaultAppSettings();
      setSettings((prev) => (prev ? { ...prev, manager: defaults.manager } : defaults));
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
        title="Manager settings"
        description="Configure manager dashboard visibility."
        breadcrumbs={[
          { label: "Admin" },
          { label: "Manager" },
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
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={Boolean(settings.manager.allow_manager_user_usage_stats)}
                  onChange={(e) => handleToggleAllowManagerUserStats(e.target.checked)}
                  aria-label="Allow manager user stats"
                />
                <span className="h-5 w-9 rounded-full bg-slate-200 transition peer-checked:bg-emerald-500 dark:bg-slate-700" />
                <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
              </label>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
