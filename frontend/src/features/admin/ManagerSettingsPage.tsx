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
  PortalSettingsToggleAction,
} from "../../components/PortalSettingsLayout";
import { AppSettings, fetchAppSettings, fetchDefaultAppSettings, updateAppSettings } from "../../api/appSettings";
import { extractApiError } from "../../utils/apiError";
import { confirmAction } from "../../utils/confirm";

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export default function ManagerSettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    fetchAppSettings()
      .then((data) => setSettings(data))
      .catch((err) => setError(extractApiError(err, "Unable to load settings.")));
  }, []);

  const handleToggleAllowManagerUserStats = (value: boolean) => {
    setSettings((prev) => (prev ? { ...prev, manager: { ...prev.manager, allow_manager_user_usage_stats: value } } : prev));
  };

  const handleToggleAllowUiUserBucketMigration = (value: boolean) => {
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            general: {
              ...prev.general,
              allow_ui_user_bucket_migration: value,
            },
          }
        : prev
    );
  };

  const handleToggleBucketMigrationTool = (value: boolean) => {
    setSettings((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        general: {
          ...prev.general,
          bucket_migration_enabled: value,
          allow_ui_user_bucket_migration: value ? prev.general.allow_ui_user_bucket_migration : false,
        },
      };
    });
  };

  const handleToggleBucketCompareTool = (value: boolean) => {
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            general: {
              ...prev.general,
              bucket_compare_enabled: value,
            },
          }
        : prev
    );
  };

  const handleToggleManagerCephS3UserKeysTool = (value: boolean) => {
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            general: {
              ...prev.general,
              manager_ceph_s3_user_keys_enabled: value,
            },
          }
        : prev
    );
  };

  const handleManagerParallelismDefaultChange = (rawValue: string) => {
    setSettings((prev) => {
      if (!prev) return prev;
      const nextValue = clampInt(
        Number(rawValue),
        1,
        prev.manager.bucket_migration_parallelism_max || 128,
        prev.manager.bucket_migration_parallelism_default
      );
      return {
        ...prev,
        manager: {
          ...prev.manager,
          bucket_migration_parallelism_default: nextValue,
        },
      };
    });
  };

  const handleManagerParallelismMaxChange = (rawValue: string) => {
    setSettings((prev) => {
      if (!prev) return prev;
      const nextMax = clampInt(Number(rawValue), 1, 128, prev.manager.bucket_migration_parallelism_max);
      const nextDefault = Math.min(prev.manager.bucket_migration_parallelism_default, nextMax);
      return {
        ...prev,
        manager: {
          ...prev.manager,
          bucket_migration_parallelism_max: nextMax,
          bucket_migration_parallelism_default: nextDefault,
        },
      };
    });
  };

  const handleManagerMaxActivePerEndpointChange = (rawValue: string) => {
    setSettings((prev) => {
      if (!prev) return prev;
      const nextValue = clampInt(Number(rawValue), 1, 64, prev.manager.bucket_migration_max_active_per_endpoint);
      return {
        ...prev,
        manager: {
          ...prev.manager,
          bucket_migration_max_active_per_endpoint: nextValue,
        },
      };
    });
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
      setError(extractApiError(err, "Unable to save."));
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
      setSettings((prev) =>
        prev
              ? {
                  ...prev,
                  manager: defaults.manager,
                  general: {
                    ...prev.general,
                    bucket_migration_enabled: defaults.general.bucket_migration_enabled,
                    bucket_compare_enabled: defaults.general.bucket_compare_enabled,
                    manager_ceph_s3_user_keys_enabled: defaults.general.manager_ceph_s3_user_keys_enabled,
                    allow_ui_user_bucket_migration: defaults.general.allow_ui_user_bucket_migration,
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Manager settings"
        description="Configure manager workspace access and extra operational tools."
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
          <div className="space-y-4 ui-surface-card p-5">
            <div className="rounded-xl border border-slate-200/80 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40">
              <PortalSettingsSection
                title="Workspace access"
                description="Manager workspace access rules for non-admin roles."
                layout="stack"
              >
                <PortalSettingsItem
                  title="Allow stats for all users"
                  description="Allows every non-admin profile to view bucket stats and usage from /manager."
                  action={
                    <PortalSettingsToggleAction
                      checked={Boolean(settings.manager.allow_manager_user_usage_stats)}
                      onChange={(value) => handleToggleAllowManagerUserStats(value)}
                      ariaLabel="Allow manager user stats"
                    />
                  }
                />
              </PortalSettingsSection>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40">
              <PortalSettingsSection
                title="Extra Tools"
                description="Optional manager tools and access policy for non-admin users."
                layout="stack"
              >
                <PortalSettingsItem
                  title="Bucket migration tool"
                  description="Enables the Manager bucket migration tool."
                  action={
                    <PortalSettingsToggleAction
                      checked={Boolean(settings.general.bucket_migration_enabled)}
                      onChange={(value) => handleToggleBucketMigrationTool(value)}
                      ariaLabel="Bucket migration tool"
                      badge={{ visible: true, label: "Experimental", tone: "warning" }}
                    />
                  }
                />
                <PortalSettingsItem
                  title="Bucket compare tool"
                  description="Enables the Manager bucket compare tool."
                  action={
                    <PortalSettingsToggleAction
                      checked={Boolean(settings.general.bucket_compare_enabled)}
                      onChange={(value) => handleToggleBucketCompareTool(value)}
                      ariaLabel="Bucket compare tool"
                    />
                  }
                />
                <PortalSettingsItem
                  title="Ceph S3 User keys manager"
                  description="Enables the Manager Ceph section for RGW access key management on eligible S3 User contexts."
                  action={
                    <PortalSettingsToggleAction
                      checked={Boolean(settings.general.manager_ceph_s3_user_keys_enabled)}
                      onChange={(value) => handleToggleManagerCephS3UserKeysTool(value)}
                      ariaLabel="Ceph S3 User keys manager"
                    />
                  }
                />
                <PortalSettingsItem
                  title="Allow UI User access to bucket migration"
                  description="When enabled, standard UI users can access the bucket migration tool. Otherwise it stays restricted to UI Admin."
                  action={
                    <PortalSettingsToggleAction
                      checked={Boolean(settings.general.allow_ui_user_bucket_migration)}
                      disabled={!settings.general.bucket_migration_enabled}
                      onChange={(value) => handleToggleAllowUiUserBucketMigration(value)}
                      ariaLabel="Allow UI User access to bucket migration"
                    />
                  }
                >
                  {!settings.general.bucket_migration_enabled && (
                    <p className="mt-2 ui-caption text-amber-700 dark:text-amber-200">Enable "Bucket migration tool" first.</p>
                  )}
                </PortalSettingsItem>
              </PortalSettingsSection>

              <div className="my-4 border-t border-slate-200 dark:border-slate-700" />

              <div>
                <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Bucket migration controls</p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Global limits applied to all manager bucket migrations.
                </p>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className="space-y-1 ui-caption">
                  <span className="font-semibold text-slate-700 dark:text-slate-200">Default parallelism</span>
                  <input
                    type="number"
                    min={1}
                    max={settings.manager.bucket_migration_parallelism_max || 128}
                    value={settings.manager.bucket_migration_parallelism_default}
                    onChange={(e) => handleManagerParallelismDefaultChange(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                  />
                </label>
                <label className="space-y-1 ui-caption">
                  <span className="font-semibold text-slate-700 dark:text-slate-200">Max parallelism per migration</span>
                  <input
                    type="number"
                    min={1}
                    max={128}
                    value={settings.manager.bucket_migration_parallelism_max}
                    onChange={(e) => handleManagerParallelismMaxChange(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                  />
                </label>
                <label className="space-y-1 ui-caption">
                  <span className="font-semibold text-slate-700 dark:text-slate-200">Max active migrations per endpoint</span>
                  <input
                    type="number"
                    min={1}
                    max={64}
                    value={settings.manager.bucket_migration_max_active_per_endpoint}
                    onChange={(e) => handleManagerMaxActivePerEndpointChange(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                  />
                </label>
              </div>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
