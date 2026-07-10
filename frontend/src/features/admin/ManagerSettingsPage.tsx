/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader";
import { adminBreadcrumbs } from "./adminBreadcrumbs";
import PageBanner from "../../components/PageBanner";
import {
  SettingsCard,
  SettingsItem,
  SettingsSection,
  SettingsToggleAction,
  settingsInputClassName,
  settingsLabelClassName,
} from "../../components/settings/SettingsLayout";
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

  const handleToggleBucketMigrationTool = (value: boolean) => {
    setSettings((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        general: {
          ...prev.general,
          bucket_migration_enabled: value,
        },
      };
    });
  };

  const handleToggleBucketPurgeTool = (value: boolean) => {
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            general: {
              ...prev.general,
              bucket_purge_enabled: value,
            },
          }
        : prev
    );
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

  const handleToggleBucketIntegrityCheckTool = (value: boolean) => {
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            general: {
              ...prev.general,
              bucket_integrity_check_enabled: value,
            },
          }
        : prev
    );
  };

  const handleToggleBucketUsageStats = (value: boolean) => {
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            general: {
              ...prev.general,
              bucket_usage_stats_enabled: value,
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
                    bucket_purge_enabled: defaults.general.bucket_purge_enabled,
                    bucket_compare_enabled: defaults.general.bucket_compare_enabled,
                    bucket_integrity_check_enabled: defaults.general.bucket_integrity_check_enabled,
                    bucket_usage_stats_enabled: defaults.general.bucket_usage_stats_enabled,
                    manager_ceph_s3_user_keys_enabled: defaults.general.manager_ceph_s3_user_keys_enabled,
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
        breadcrumbs={adminBreadcrumbs({ label: "Manager" }, { label: "Settings" })}
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
      />
      <form className="space-y-4" onSubmit={handleSave}>
        {error && <PageBanner tone="error">{error}</PageBanner>}
        {savedMessage && <PageBanner tone="success">{savedMessage}</PageBanner>}
        {!settings && !error && <PageBanner tone="info">Loading settings...</PageBanner>}
        {settings && (
          <div className="grid gap-4">
            <SettingsCard>
              <SettingsSection
                title="Workspace access"
                description="Manager workspace access rules for non-admin roles."
                layout="stack"
              >
                <SettingsItem
                  title="Allow stats for all users"
                  description="Allows every non-admin profile to view bucket stats and usage from /manager."
                  action={
                    <SettingsToggleAction
                      checked={Boolean(settings.manager.allow_manager_user_usage_stats)}
                      onChange={(value) => handleToggleAllowManagerUserStats(value)}
                      ariaLabel="Allow manager user stats"
                    />
                  }
                />
              </SettingsSection>
            </SettingsCard>
            <SettingsCard>
              <SettingsSection
                title="Extra Tools"
                description="Optional manager tools and access policy for non-admin users."
                layout="stack"
              >
                <SettingsItem
                  title="Bucket migration tool"
                  description="Enables the Manager bucket migration tool."
                  action={
                    <SettingsToggleAction
                      checked={Boolean(settings.general.bucket_migration_enabled)}
                      onChange={(value) => handleToggleBucketMigrationTool(value)}
                      ariaLabel="Bucket migration tool"
                      badge={{ visible: true, label: "Experimental", tone: "warning" }}
                    />
                  }
                />
                <SettingsItem
                  title="Bucket purge tool"
                  description="Enables the Manager bucket purge tool and purge actions for Storage Ops."
                  action={
                    <SettingsToggleAction
                      checked={Boolean(settings.general.bucket_purge_enabled)}
                      onChange={(value) => handleToggleBucketPurgeTool(value)}
                      ariaLabel="Bucket purge tool"
                    />
                  }
                />
                <SettingsItem
                  title="Bucket compare tool"
                  description="Enables the Manager bucket compare tool."
                  action={
                    <SettingsToggleAction
                      checked={Boolean(settings.general.bucket_compare_enabled)}
                      onChange={(value) => handleToggleBucketCompareTool(value)}
                      ariaLabel="Bucket compare tool"
                    />
                  }
                />
                <SettingsItem
                  title="Bucket integrity check tool"
                  description="Enables the Manager bucket integrity diagnostic tool."
                  action={
                    <SettingsToggleAction
                      checked={Boolean(settings.general.bucket_integrity_check_enabled)}
                      onChange={(value) => handleToggleBucketIntegrityCheckTool(value)}
                      ariaLabel="Bucket integrity check tool"
                    />
                  }
                />
                <SettingsItem
                  title="Bucket usage stats"
                  description="Enables bucket usage statistics on Manager pages and bucket details."
                  action={
                    <SettingsToggleAction
                      checked={Boolean(settings.general.bucket_usage_stats_enabled)}
                      onChange={(value) => handleToggleBucketUsageStats(value)}
                      ariaLabel="Bucket usage stats"
                    />
                  }
                />
                <SettingsItem
                  title="Ceph S3 User keys manager"
                  description="Enables the Manager Ceph section for RGW access key management on eligible S3 User contexts."
                  action={
                    <SettingsToggleAction
                      checked={Boolean(settings.general.manager_ceph_s3_user_keys_enabled)}
                      onChange={(value) => handleToggleManagerCephS3UserKeysTool(value)}
                      ariaLabel="Ceph S3 User keys manager"
                    />
                  }
                />
              </SettingsSection>

              <div className="my-4 border-t border-slate-200 dark:border-slate-700" />

              <div>
                <p className="ui-body font-semibold text-[var(--ui-text)]">Bucket migration controls</p>
                <p className="ui-caption text-[var(--ui-text-muted)]">
                  Global limits applied to all manager bucket migrations.
                </p>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className="space-y-1 ui-caption">
                  <span className={settingsLabelClassName}>Default parallelism</span>
                  <input
                    type="number"
                    min={1}
                    max={settings.manager.bucket_migration_parallelism_max || 128}
                    value={settings.manager.bucket_migration_parallelism_default}
                    onChange={(e) => handleManagerParallelismDefaultChange(e.target.value)}
                    className={settingsInputClassName}
                  />
                </label>
                <label className="space-y-1 ui-caption">
                  <span className={settingsLabelClassName}>Max parallelism per migration</span>
                  <input
                    type="number"
                    min={1}
                    max={128}
                    value={settings.manager.bucket_migration_parallelism_max}
                    onChange={(e) => handleManagerParallelismMaxChange(e.target.value)}
                    className={settingsInputClassName}
                  />
                </label>
                <label className="space-y-1 ui-caption">
                  <span className={settingsLabelClassName}>Max active migrations per endpoint</span>
                  <input
                    type="number"
                    min={1}
                    max={64}
                    value={settings.manager.bucket_migration_max_active_per_endpoint}
                    onChange={(e) => handleManagerMaxActivePerEndpointChange(e.target.value)}
                    className={settingsInputClassName}
                  />
                </label>
              </div>
            </SettingsCard>
          </div>
        )}
      </form>
    </div>
  );
}
