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
  settingsLabelClassName,
} from "../../components/settings/SettingsLayout";
import { AppSettings, fetchAppSettings, fetchDefaultAppSettings, updateAppSettings } from "../../api/appSettings";
import { extractApiError } from "../../utils/apiError";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";

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
  const resetConfirmation = useConfirmActionDialog();

  useEffect(() => {
    fetchAppSettings()
      .then((data) => setSettings(data))
      .catch((err) => setError(extractApiError(err, "Unable to load settings.")));
  }, []);

  const handleToggleManagerRgwUsageMetrics = (value: boolean) => {
    setSettings((prev) => (prev ? { ...prev, manager: { ...prev.manager, manager_rgw_usage_metrics_enabled: value } } : prev));
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

  const handleToggleManagerCephS3UserKeys = (value: boolean) => {
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

  const handleToggleBucketQuotaManagement = (value: boolean) => {
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            general: {
              ...prev.general,
              bucket_quota_management_enabled: value,
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
                  manager: defaults.manager,
                  general: {
                    ...prev.general,
                    bucket_migration_enabled: defaults.general.bucket_migration_enabled,
                    bucket_purge_enabled: defaults.general.bucket_purge_enabled,
                    bucket_compare_enabled: defaults.general.bucket_compare_enabled,
                    bucket_integrity_check_enabled: defaults.general.bucket_integrity_check_enabled,
                    bucket_usage_stats_enabled: defaults.general.bucket_usage_stats_enabled,
                    bucket_quota_management_enabled: defaults.general.bucket_quota_management_enabled,
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

  const handleResetDefaults = () => {
    resetConfirmation.requestConfirmation({
      title: "Reset Manager settings draft?",
      description: "Replace the current Manager metrics, tools, and migration limits with application defaults.",
      confirmLabel: "Load defaults",
      tone: "primary",
      warning: "Defaults are loaded into this form only. Review them, then use Save changes to apply them.",
      onConfirm: resetDefaults,
    });
  };

  return (
    <PageShell
      title="Manager settings"
      description="Configure global usage, metrics, and operational tools for Manager."
      breadcrumbs={adminPageBreadcrumbs("manager-settings")}
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
                title="Usage and metrics"
                description="Global controls for scan-based bucket composition and RGW-provided metrics."
                layout="stack"
              >
                <SettingsItem
                  title="Bucket composition statistics"
                  description="Enables scan-calculated bucket composition statistics in Manager and Portal."
                  action={
                    <SettingsToggleAction
                      checked={Boolean(settings.general.bucket_usage_stats_enabled)}
                      onChange={(value) => handleToggleBucketUsageStats(value)}
                      ariaLabel="Bucket composition statistics"
                    />
                  }
                />
                <SettingsItem
                  title="RGW traffic and usage metrics"
                  description="Enables RGW traffic and usage metrics in Manager when context and endpoint prerequisites are met."
                  action={
                    <SettingsToggleAction
                      checked={Boolean(settings.manager.manager_rgw_usage_metrics_enabled)}
                      onChange={(value) => handleToggleManagerRgwUsageMetrics(value)}
                      ariaLabel="RGW traffic and usage metrics"
                    />
                  }
                />
              </SettingsSection>

              <div className="my-4 border-t border-slate-200 dark:border-slate-700" />

              <SettingsSection
                title="Manager tools"
                description="Optional administrative and operational tools available in Manager."
                layout="stack"
              >
                <SettingsItem
                  title="Bucket quota management"
                  description="Enables Ceph bucket quota management for eligible S3 Account and RGW User contexts in Manager."
                  action={
                    <SettingsToggleAction
                      checked={Boolean(settings.general.bucket_quota_management_enabled)}
                      onChange={(value) => handleToggleBucketQuotaManagement(value)}
                      ariaLabel="Bucket quota management"
                    />
                  }
                />
                <SettingsItem
                  title="Ceph S3 User access-key management"
                  description="Enables the Manager Ceph section for RGW access-key management on eligible S3 User contexts."
                  action={
                    <SettingsToggleAction
                      checked={Boolean(settings.general.manager_ceph_s3_user_keys_enabled)}
                      onChange={(value) => handleToggleManagerCephS3UserKeys(value)}
                      ariaLabel="Ceph S3 User access-key management"
                    />
                  }
                />
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
                  title="Bucket purge tool"
                  description="Enables the Manager bucket purge tool and purge actions for Ceph Admin and Storage Ops."
                  action={
                    <SettingsToggleAction
                      checked={Boolean(settings.general.bucket_purge_enabled)}
                      onChange={(value) => handleToggleBucketPurgeTool(value)}
                      ariaLabel="Bucket purge tool"
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
      {resetConfirmation.confirmationDialog}
    </PageShell>
  );
}
