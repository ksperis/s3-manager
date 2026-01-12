/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import { AppSettings, fetchAppSettings, fetchDefaultAppSettings, updateAppSettings } from "../../api/appSettings";
import { confirmAction } from "../../utils/confirm";

const PARALLELISM_MIN = 1;
const PARALLELISM_MAX = 20;

const normalizeParallelism = (value: number) => {
  if (!Number.isFinite(value)) return PARALLELISM_MIN;
  return Math.min(PARALLELISM_MAX, Math.max(PARALLELISM_MIN, Math.floor(value)));
};

export default function BrowserSettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    fetchAppSettings()
      .then((data) => setSettings(data))
      .catch(() => setError("Unable to load settings."));
  }, []);

  const handleParallelismChange = (
    field:
      | "direct_upload_parallelism"
      | "proxy_upload_parallelism"
      | "direct_download_parallelism"
      | "proxy_download_parallelism"
      | "other_operations_parallelism",
    value: string
  ) => {
    const parsed = Number(value);
    const normalized = normalizeParallelism(parsed);
    setSettings((prev) =>
      prev ? { ...prev, browser: { ...prev.browser, [field]: normalized } } : prev
    );
  };

  const handleToggleChange = (checked: boolean) => {
    setSettings((prev) =>
      prev ? { ...prev, browser: { ...prev.browser, allow_proxy_transfers: checked } } : prev
    );
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const payload: AppSettings = {
        ...settings,
        browser: {
          ...settings.browser,
          direct_upload_parallelism: normalizeParallelism(settings.browser.direct_upload_parallelism),
          proxy_upload_parallelism: normalizeParallelism(settings.browser.proxy_upload_parallelism),
          direct_download_parallelism: normalizeParallelism(settings.browser.direct_download_parallelism),
          proxy_download_parallelism: normalizeParallelism(settings.browser.proxy_download_parallelism),
          other_operations_parallelism: normalizeParallelism(settings.browser.other_operations_parallelism),
        },
      };
      const saved = await updateAppSettings(payload);
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
    if (!confirmAction("Reset browser settings to defaults? Save changes to apply.")) return;
    setResetting(true);
    setError(null);
    setSavedMessage(null);
    try {
      const defaults = await fetchDefaultAppSettings();
      setSettings((prev) => (prev ? { ...prev, browser: defaults.browser } : defaults));
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
        title="Browser settings"
        description="Configure upload concurrency for the browser."
        breadcrumbs={[
          { label: "Admin" },
          { label: "Browser" },
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
              <div>
                <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Proxy transfers</p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Allow the backend to proxy uploads/downloads when direct browser-to-S3 transfers are unavailable.
                </p>
              </div>
              <div className="mt-4 flex items-center justify-between rounded-lg border border-slate-200 px-3 py-3 ui-body text-slate-700 dark:border-slate-800 dark:text-slate-200">
                <span>Enable proxy mode</span>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={settings.browser.allow_proxy_transfers}
                    onChange={(e) => handleToggleChange(e.target.checked)}
                  />
                  <span className="h-5 w-9 rounded-full bg-slate-200 transition peer-checked:bg-emerald-500 dark:bg-slate-700" />
                  <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
                </label>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div>
                <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Upload parallelism</p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Direct mode uses browser-to-S3 transfers. Proxy mode is used when the backend proxies uploads.
                </p>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Direct uploads</label>
                  <input
                    type="number"
                    min={PARALLELISM_MIN}
                    max={PARALLELISM_MAX}
                    className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    value={settings.browser.direct_upload_parallelism}
                    onChange={(e) => handleParallelismChange("direct_upload_parallelism", e.target.value)}
                  />
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    Limits concurrent direct uploads ({PARALLELISM_MIN}-{PARALLELISM_MAX}).
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Proxy uploads</label>
                  <input
                    type="number"
                    min={PARALLELISM_MIN}
                    max={PARALLELISM_MAX}
                    className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    value={settings.browser.proxy_upload_parallelism}
                    onChange={(e) => handleParallelismChange("proxy_upload_parallelism", e.target.value)}
                  />
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    Limits concurrent uploads when the backend proxies traffic ({PARALLELISM_MIN}-{PARALLELISM_MAX}).
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div>
                <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Download parallelism</p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Applies to folder downloads, with separate limits for direct and proxy modes.
                </p>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Direct downloads</label>
                  <input
                    type="number"
                    min={PARALLELISM_MIN}
                    max={PARALLELISM_MAX}
                    className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    value={settings.browser.direct_download_parallelism}
                    onChange={(e) => handleParallelismChange("direct_download_parallelism", e.target.value)}
                  />
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    Limits concurrent direct downloads ({PARALLELISM_MIN}-{PARALLELISM_MAX}).
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Proxy downloads</label>
                  <input
                    type="number"
                    min={PARALLELISM_MIN}
                    max={PARALLELISM_MAX}
                    className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    value={settings.browser.proxy_download_parallelism}
                    onChange={(e) => handleParallelismChange("proxy_download_parallelism", e.target.value)}
                  />
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    Limits concurrent downloads when the backend proxies traffic ({PARALLELISM_MIN}-{PARALLELISM_MAX}).
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div>
                <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Other operations</p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Parallelism for operations like recursive deletes or server-side copies.
                </p>
              </div>
              <div className="mt-4 max-w-xs">
                <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Parallel operations</label>
                <input
                  type="number"
                  min={PARALLELISM_MIN}
                  max={PARALLELISM_MAX}
                  className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  value={settings.browser.other_operations_parallelism}
                  onChange={(e) => handleParallelismChange("other_operations_parallelism", e.target.value)}
                />
                <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                  Limits concurrent non-upload/download tasks ({PARALLELISM_MIN}-{PARALLELISM_MAX}).
                </p>
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
