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
} from "../../components/settings/SettingsLayout";
import { AppSettings, fetchAppSettings, fetchDefaultAppSettings, updateAppSettings } from "../../api/appSettings";
import { extractApiError } from "../../utils/apiError";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";

const PARALLELISM_MIN = 1;
const PARALLELISM_MAX = 20;
const ZIP_STREAM_THRESHOLD_MIN = 0;
const ZIP_STREAM_THRESHOLD_MAX = 10240;
const BROWSER_MANAGER_WARNING_MESSAGE =
  "Not recommended: /manager is intended for storage administration, not day-to-day bucket usage. " +
  "Using admin/root identities for bucket operations should be avoided.";
const BROWSER_CEPH_ADMIN_WARNING_MESSAGE =
  "Ceph Admin browser uses endpoint-wide ceph-admin credentials. This can cause owner mismatches on bucket/object operations. " +
  "Prefer using an S3 Connection with the expected owner for day-to-day actions.";

const normalizeParallelism = (value: number) => {
  if (!Number.isFinite(value)) return PARALLELISM_MIN;
  return Math.min(PARALLELISM_MAX, Math.max(PARALLELISM_MIN, Math.floor(value)));
};

const normalizeZipStreamThreshold = (value: number) => {
  if (!Number.isFinite(value)) return ZIP_STREAM_THRESHOLD_MIN;
  return Math.min(ZIP_STREAM_THRESHOLD_MAX, Math.max(ZIP_STREAM_THRESHOLD_MIN, Math.floor(value)));
};

export default function BrowserSettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const resetConfirmation = useConfirmActionDialog();

  useEffect(() => {
    fetchAppSettings()
      .then((data) => setSettings(data))
      .catch((err) => setError(extractApiError(err, "Unable to load settings.")));
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

  const handleZipThresholdChange = (value: string) => {
    const parsed = Number(value);
    const normalized = normalizeZipStreamThreshold(parsed);
    setSettings((prev) =>
      prev ? { ...prev, browser: { ...prev.browser, streaming_zip_threshold_mb: normalized } } : prev
    );
  };

  const handleToggleChange = (checked: boolean) => {
    setSettings((prev) =>
      prev ? { ...prev, browser: { ...prev.browser, allow_proxy_transfers: checked } } : prev
    );
  };

  const handleWorkspaceToggle = (
    field:
      | "browser_root_enabled"
      | "browser_manager_enabled"
      | "browser_portal_enabled"
      | "browser_ceph_admin_enabled",
    checked: boolean
  ) => {
    setSettings((prev) => (prev ? { ...prev, general: { ...prev.general, [field]: checked } } : prev));
  };

  const handleSave = async (event?: React.FormEvent | React.MouseEvent) => {
    event?.preventDefault();
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
          streaming_zip_threshold_mb: normalizeZipStreamThreshold(settings.browser.streaming_zip_threshold_mb),
        },
      };
      const saved = await updateAppSettings(payload);
      setSettings(saved);
      setSavedMessage("Settings saved.");
      setTimeout(() => setSavedMessage(null), 3000);
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, "Unable to save."));
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
              browser: defaults.browser,
              general: {
              ...prev.general,
              browser_root_enabled: defaults.general.browser_root_enabled,
              browser_manager_enabled: defaults.general.browser_manager_enabled,
              browser_portal_enabled: defaults.general.browser_portal_enabled,
              browser_ceph_admin_enabled: defaults.general.browser_ceph_admin_enabled,
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
    resetConfirmation.requestConfirmation({
      title: "Reset Browser settings draft?",
      description: "Replace the current Browser availability and transfer values with application defaults.",
      confirmLabel: "Load defaults",
      tone: "primary",
      warning: "Defaults are loaded into this form only. Review them, then use Save changes to apply them.",
      onConfirm: resetDefaults,
    });
  };

  return (
    <PageShell
      title="Browser settings"
      description="Configure upload concurrency for the browser."
      breadcrumbs={adminPageBreadcrumbs("browser-settings")}
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
      <form className="space-y-4" onSubmit={handleSave}>
        {error && <PageBanner tone="error">{error}</PageBanner>}
        {savedMessage && <PageBanner tone="success">{savedMessage}</PageBanner>}
        {!settings && !error && <PageBanner tone="info">Loading settings...</PageBanner>}
        {settings && (
          <div className="grid gap-4">
            <SettingsCard>
              <SettingsSection
                title="BROWSER WORKSPACES"
                description="Enable the browser in specific workspaces."
                layout="stack"
              >
                <SettingsItem
                  title="/browser"
                  description="Standalone browser workspace."
                  action={
                    <SettingsToggleAction
                      checked={settings.general.browser_root_enabled}
                      onChange={(value) => handleWorkspaceToggle("browser_root_enabled", value)}
                      ariaLabel="Enable /browser workspace"
                    />
                  }
                />
                <SettingsItem
                  title="/manager/browser"
                  description="Browser tab inside the manager workspace."
                  action={
                    <SettingsToggleAction
                      checked={settings.general.browser_manager_enabled}
                      onChange={(value) => handleWorkspaceToggle("browser_manager_enabled", value)}
                      ariaLabel="Enable /manager/browser workspace"
                    />
                  }
                >
                  {settings.general.browser_manager_enabled && (
                    <p className="mt-2 ui-caption text-amber-700 dark:text-amber-200">{BROWSER_MANAGER_WARNING_MESSAGE}</p>
                  )}
                </SettingsItem>
                <SettingsItem
                  title="/portal/storage-spaces/:spaceId"
                  description="Minimal locked Browser inside Portal Storage Spaces."
                  action={
                    <SettingsToggleAction
                      checked={settings.general.browser_portal_enabled}
                      onChange={(value) => handleWorkspaceToggle("browser_portal_enabled", value)}
                      ariaLabel="Enable Browser in Portal Storage Spaces"
                    />
                  }
                />
                <SettingsItem
                  title="/ceph-admin/browser"
                  description="Browser tab inside the Ceph Admin workspace."
                  action={
                    <SettingsToggleAction
                      checked={settings.general.browser_ceph_admin_enabled}
                      onChange={(value) => handleWorkspaceToggle("browser_ceph_admin_enabled", value)}
                      ariaLabel="Enable /ceph-admin/browser workspace"
                    />
                  }
                >
                  {settings.general.browser_ceph_admin_enabled && (
                    <p className="mt-2 ui-caption text-amber-700 dark:text-amber-200">{BROWSER_CEPH_ADMIN_WARNING_MESSAGE}</p>
                  )}
                </SettingsItem>
              </SettingsSection>
            </SettingsCard>
            <SettingsCard>
              <SettingsSection
                title="ZIP DOWNLOADS"
                description="Stream ZIP generation in the browser for large folder downloads."
                layout="stack"
              >
                <SettingsItem
                  title="Streaming threshold (MB)"
                  description="ZIP streaming is used only above this size. Set to 0 to always stream when supported."
                >
                  <div className="mt-3 max-w-xs">
                    <input
                      type="number"
                      min={ZIP_STREAM_THRESHOLD_MIN}
                      max={ZIP_STREAM_THRESHOLD_MAX}
                      className={settingsInputClassName}
                      value={settings.browser.streaming_zip_threshold_mb}
                      onChange={(e) => handleZipThresholdChange(e.target.value)}
                    />
                  </div>
                </SettingsItem>
              </SettingsSection>
            </SettingsCard>
            <SettingsCard>
              <SettingsSection
                title="PROXY TRANSFERS"
                description="Allow the backend to proxy uploads/downloads when direct browser-to-S3 transfers are unavailable."
                layout="stack"
              >
                <SettingsItem
                  title="Enable proxy mode"
                  description="Use the backend as a relay when direct transfers are blocked."
                  action={
                    <SettingsToggleAction
                      checked={settings.browser.allow_proxy_transfers}
                      onChange={(value) => handleToggleChange(value)}
                      ariaLabel="Enable proxy mode"
                    />
                  }
                />
              </SettingsSection>
            </SettingsCard>
            <SettingsCard>
              <SettingsSection
                title="UPLOAD PARALLELISM"
                description="Direct mode uses browser-to-S3 transfers. Proxy mode is used when the backend proxies uploads."
                layout="grid"
                columns={2}
              >
                <SettingsItem
                  title="Direct uploads"
                  description={`Limits concurrent direct uploads (${PARALLELISM_MIN}-${PARALLELISM_MAX}).`}
                >
                  <div className="mt-3">
                    <input
                      type="number"
                      min={PARALLELISM_MIN}
                      max={PARALLELISM_MAX}
                      className={settingsInputClassName}
                      value={settings.browser.direct_upload_parallelism}
                      onChange={(e) => handleParallelismChange("direct_upload_parallelism", e.target.value)}
                    />
                  </div>
                </SettingsItem>
                <SettingsItem
                  title="Proxy uploads"
                  description={`Limits concurrent uploads when the backend proxies traffic (${PARALLELISM_MIN}-${PARALLELISM_MAX}).`}
                >
                  <div className="mt-3">
                    <input
                      type="number"
                      min={PARALLELISM_MIN}
                      max={PARALLELISM_MAX}
                      className={settingsInputClassName}
                      value={settings.browser.proxy_upload_parallelism}
                      onChange={(e) => handleParallelismChange("proxy_upload_parallelism", e.target.value)}
                    />
                  </div>
                </SettingsItem>
              </SettingsSection>
            </SettingsCard>
            <SettingsCard>
              <SettingsSection
                title="DOWNLOAD PARALLELISM"
                description="Applies to folder downloads, with separate limits for direct and proxy modes."
                layout="grid"
                columns={2}
              >
                <SettingsItem
                  title="Direct downloads"
                  description={`Limits concurrent direct downloads (${PARALLELISM_MIN}-${PARALLELISM_MAX}).`}
                >
                  <div className="mt-3">
                    <input
                      type="number"
                      min={PARALLELISM_MIN}
                      max={PARALLELISM_MAX}
                      className={settingsInputClassName}
                      value={settings.browser.direct_download_parallelism}
                      onChange={(e) => handleParallelismChange("direct_download_parallelism", e.target.value)}
                    />
                  </div>
                </SettingsItem>
                <SettingsItem
                  title="Proxy downloads"
                  description={`Limits concurrent downloads when the backend proxies traffic (${PARALLELISM_MIN}-${PARALLELISM_MAX}).`}
                >
                  <div className="mt-3">
                    <input
                      type="number"
                      min={PARALLELISM_MIN}
                      max={PARALLELISM_MAX}
                      className={settingsInputClassName}
                      value={settings.browser.proxy_download_parallelism}
                      onChange={(e) => handleParallelismChange("proxy_download_parallelism", e.target.value)}
                    />
                  </div>
                </SettingsItem>
              </SettingsSection>
            </SettingsCard>
            <SettingsCard>
              <SettingsSection
                title="OTHER OPERATIONS"
                description="Parallelism for operations like recursive deletes or server-side copies."
                layout="grid"
                columns={1}
              >
                <SettingsItem
                  title="Parallel operations"
                  description={`Limits concurrent non-upload/download tasks (${PARALLELISM_MIN}-${PARALLELISM_MAX}).`}
                >
                  <div className="mt-3 max-w-xs">
                    <input
                      type="number"
                      min={PARALLELISM_MIN}
                      max={PARALLELISM_MAX}
                      className={settingsInputClassName}
                      value={settings.browser.other_operations_parallelism}
                      onChange={(e) => handleParallelismChange("other_operations_parallelism", e.target.value)}
                    />
                  </div>
                </SettingsItem>
              </SettingsSection>
            </SettingsCard>
          </div>
        )}
      </form>
      {resetConfirmation.confirmationDialog}
    </PageShell>
  );
}
