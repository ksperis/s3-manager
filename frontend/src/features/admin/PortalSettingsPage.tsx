/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useRef, useState } from "react";
import PageShell from "../../components/PageShell";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import PageBanner from "../../components/PageBanner";
import {
  SettingsCard,
  SettingsItem,
  SettingsSection,
  SettingsToggleAction,
  settingsCompactInputClassName,
  settingsTextareaClassName,
} from "../../components/settings/SettingsLayout";
import { AppSettings, fetchAppSettings, fetchDefaultAppSettings, updateAppSettings } from "../../api/appSettings";
import { extractApiError } from "../../utils/apiError";
import { confirmAction } from "../../utils/confirm";

const corsOriginsTextareaClass = `mt-2 ${settingsTextareaClassName}`;

export default function PortalSettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [corsOriginsText, setCorsOriginsText] = useState("");
  const initRef = useRef(false);

  const normalizeListInput = (value: string): string[] =>
    value
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);

  const normalizePositiveInt = (value: string, fallback: number): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.trunc(parsed));
  };

  useEffect(() => {
    fetchAppSettings()
      .then((data) => setSettings(data))
      .catch((err) => setError(extractApiError(err, "Unable to load settings.")));
  }, []);

  useEffect(() => {
    if (!settings || initRef.current) return;
    setCorsOriginsText((settings.portal.bucket_defaults.cors_allowed_origins || []).join("\n"));
    initRef.current = true;
  }, [settings]);

  const handleToggleAllowPortalBucketCreate = (value: boolean) => {
    setSettings((prev) => (prev ? { ...prev, portal: { ...prev.portal, allow_private_storage_space_create: value } } : prev));
  };

  const handleToggleBrowserAccess = (value: boolean) => {
    setSettings((prev) =>
      prev ? { ...prev, portal: { ...prev.portal, browser_access_enabled: value } } : prev
    );
  };

  const handleToggleAllowPortalNamedBucketCreate = (value: boolean) => {
    setSettings((prev) =>
      prev ? { ...prev, portal: { ...prev.portal, allow_portal_named_bucket_create: value } } : prev
    );
  };

  const handleToggleAllowPortalAccessKeyCreate = (value: boolean) => {
    setSettings((prev) =>
      prev ? { ...prev, portal: { ...prev.portal, allow_portal_user_access_key_create: value } } : prev
    );
  };

  const handleToggleServerAccessLogging = (value: boolean) => {
    setSettings((prev) =>
      prev ? { ...prev, portal: { ...prev.portal, server_access_logging_enabled: value } } : prev
    );
  };

  const handleServerAccessLogRetentionChange = (value: string) => {
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            portal: {
              ...prev.portal,
              server_access_log_retention_days: normalizePositiveInt(
                value,
                prev.portal.server_access_log_retention_days
              ),
            },
          }
        : prev
    );
  };

  const handleToggleStorageSpaceVersionCleanup = (value: boolean) => {
    setSettings((prev) =>
      prev ? { ...prev, portal: { ...prev.portal, storage_space_version_cleanup_enabled: value } } : prev
    );
  };

  const handleMaxPortalUserAccessKeysChange = (value: string) => {
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            portal: {
              ...prev.portal,
              max_portal_user_access_keys: normalizePositiveInt(value, prev.portal.max_portal_user_access_keys),
            },
          }
        : prev
    );
  };

  const handleBucketDefault = <Key extends keyof AppSettings["portal"]["bucket_defaults"]>(
    key: Key,
    value: AppSettings["portal"]["bucket_defaults"][Key]
  ) => {
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            portal: {
              ...prev.portal,
              bucket_defaults: { ...prev.portal.bucket_defaults, [key]: value },
            },
          }
        : prev
    );
  };

  const handleBucketCorsOrigins = (value: string) => {
    setCorsOriginsText(value);
    handleBucketDefault("cors_allowed_origins", normalizeListInput(value));
  };

  const handleSave = async (event?: React.FormEvent | React.MouseEvent) => {
    event?.preventDefault();
    if (!settings) return;
    if (!Number.isInteger(settings.portal.max_portal_user_access_keys) || settings.portal.max_portal_user_access_keys < 1) {
      setError("Max S3 access keys per portal user must be a positive integer.");
      return;
    }
    if (!Number.isInteger(settings.portal.server_access_log_retention_days) || settings.portal.server_access_log_retention_days < 1) {
      setError("Server access log retention must be a positive integer.");
      return;
    }
    if (
      !Number.isInteger(settings.portal.bucket_defaults.noncurrent_version_expiration_days) ||
      settings.portal.bucket_defaults.noncurrent_version_expiration_days < 1
    ) {
      setError("Version history retention must be a positive integer.");
      return;
    }
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
    if (!confirmAction("Reset portal settings to defaults? Save changes to apply.")) return;
    setResetting(true);
    setError(null);
    setSavedMessage(null);
    try {
      const defaults = await fetchDefaultAppSettings();
      initRef.current = false;
      setSettings((prev) =>
        prev
          ? {
              ...prev,
              portal: defaults.portal,
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

  const portalBucketCreateEnabled = Boolean(settings?.portal.allow_private_storage_space_create);
  const portalBrowserAccessEnabled = Boolean(settings?.portal.browser_access_enabled);
  const portalNamedBucketCreateEnabled = Boolean(settings?.portal.allow_portal_named_bucket_create);
  const portalAccessKeyCreateEnabled = Boolean(settings?.portal.allow_portal_user_access_key_create);
  const portalServerAccessLoggingEnabled = Boolean(settings?.portal.server_access_logging_enabled);
  const portalStorageSpaceVersionCleanupEnabled = Boolean(settings?.portal.storage_space_version_cleanup_enabled);
  const portalMaxAccessKeys = settings?.portal.max_portal_user_access_keys ?? 2;
  const portalServerAccessLogRetentionDays = settings?.portal.server_access_log_retention_days ?? 30;
  const bucketVersioningEnabled = Boolean(settings?.portal.bucket_defaults.versioning);
  const bucketLifecycleEnabled = Boolean(settings?.portal.bucket_defaults.enable_lifecycle);
  const noncurrentVersionExpirationDays = settings?.portal.bucket_defaults.noncurrent_version_expiration_days ?? "";
  const bucketCorsEnabled = Boolean(settings?.portal.bucket_defaults.enable_cors);

  return (
    <PageShell
      title="Portal settings"
      description="Configure Portal self-service behavior and backing storage defaults."
      breadcrumbs={adminPageBreadcrumbs("portal-settings")}
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
        <SettingsCard>
          <SettingsSection title="UI" description="Portal UI switches and account defaults." layout="grid">
            <SettingsItem
              title="Browser workspace access"
              description="Allow Portal projects to appear in the standalone /browser workspace. Portal file browsing remains available when disabled."
              action={
                <SettingsToggleAction
                  checked={portalBrowserAccessEnabled}
                  onChange={(value) => handleToggleBrowserAccess(value)}
                  disabled={!settings}
                  ariaLabel="Portal Browser workspace access"
                />
              }
            />
            <SettingsItem
              title="Private Storage Space creation"
              description="Allow Portal users and Portal managers to create private Storage Spaces. Team Storage Spaces remain manager-only."
              action={
                <SettingsToggleAction
                  checked={portalBucketCreateEnabled}
                  onChange={(value) => handleToggleAllowPortalBucketCreate(value)}
                  disabled={!settings}
                  ariaLabel="Private Storage Space creation"
                />
              }
            />
            <SettingsItem
              title="Named storage creation"
              description="Allow the Portal create form to create a locked Storage Space whose backing storage name is based on the submitted name."
              action={
                <SettingsToggleAction
                  checked={portalNamedBucketCreateEnabled}
                  onChange={(value) => handleToggleAllowPortalNamedBucketCreate(value)}
                  disabled={!settings}
                  ariaLabel="Portal named storage creation"
                />
              }
            />
            <SettingsItem
              title="Access key management"
              description="Allow Portal users to create and delete their own S3 access keys from the Portal."
              action={
                <SettingsToggleAction
                  checked={portalAccessKeyCreateEnabled}
                  onChange={(value) => handleToggleAllowPortalAccessKeyCreate(value)}
                  disabled={!settings}
                  ariaLabel="Portal user access key management"
                />
              }
            />
            <SettingsItem
              title="Server access logging"
              description="Enable object-level S3 audit on Portal Storage Spaces and retain logs in the account technical bucket. Without it, the application has no exhaustive object audit."
              action={
                <SettingsToggleAction
                  checked={portalServerAccessLoggingEnabled}
                  onChange={(value) => handleToggleServerAccessLogging(value)}
                  disabled={!settings}
                  ariaLabel="Portal Server Access Logging"
                />
              }
            />
            <SettingsItem
              title="Server access log retention"
              description="Expire objects written by Portal Server Access Logging in newly created technical log buckets."
              action={
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={portalServerAccessLogRetentionDays}
                  onChange={(e) => handleServerAccessLogRetentionChange(e.target.value)}
                  disabled={!settings || !portalServerAccessLoggingEnabled}
                  aria-label="Server access log retention days"
                  className={`w-28 ${settingsCompactInputClassName}`}
                />
              }
            />
            <SettingsItem
              title="Storage Space history cleanup"
              description="Allow Storage Space owners to remove historical object versions and orphan delete markers from the Portal."
              action={
                <SettingsToggleAction
                  checked={portalStorageSpaceVersionCleanupEnabled}
                  onChange={(value) => handleToggleStorageSpaceVersionCleanup(value)}
                  disabled={!settings}
                  ariaLabel="Portal Storage Space history cleanup"
                />
              }
            />
            <SettingsItem
              title="Max S3 access keys per portal user"
              description="Global limit for S3 access keys created from the Portal."
              action={
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={portalMaxAccessKeys}
                  onChange={(e) => handleMaxPortalUserAccessKeysChange(e.target.value)}
                  disabled={!settings}
                  aria-label="Max S3 access keys per portal user"
                  className={`w-28 ${settingsCompactInputClassName}`}
                />
              }
            />
          </SettingsSection>
        </SettingsCard>
        <SettingsCard>
          <SettingsSection
            title="STORAGE DEFAULTS"
            description="Defaults applied when backing storage is created from the Portal."
            layout="grid"
          >
            <SettingsItem
              title="Versioning"
              description="Enable versioning by default on newly provisioned Portal storage."
              action={
                <SettingsToggleAction
                  checked={bucketVersioningEnabled}
                  onChange={(value) => handleBucketDefault("versioning", value)}
                  disabled={!settings}
                  ariaLabel="Bucket versioning default"
                />
              }
            />
            <SettingsItem
              title="Lifecycle baseline"
              description="Remove obsolete delete markers and expire non-current versions on newly created Storage Spaces."
              action={
                <SettingsToggleAction
                  checked={bucketLifecycleEnabled}
                  onChange={(value) => handleBucketDefault("enable_lifecycle", value)}
                  disabled={!settings}
                  ariaLabel="Bucket lifecycle default"
                />
              }
            />
            <SettingsItem
              title="Version history retention"
              description="Retention for older versions on new Storage Spaces. Existing buckets are unchanged."
              action={
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={noncurrentVersionExpirationDays}
                  onChange={(e) =>
                    handleBucketDefault("noncurrent_version_expiration_days", Number(e.target.value))
                  }
                  disabled={!settings || !bucketLifecycleEnabled}
                  aria-label="Version history retention days"
                  className={`w-28 ${settingsCompactInputClassName}`}
                />
              }
            />
            <SettingsItem
              title="Portal CORS"
              description="Apply a CORS rule to allow the Portal UI to access Storage Space backing storage."
              action={
                <SettingsToggleAction
                  checked={bucketCorsEnabled}
                  onChange={(value) => handleBucketDefault("enable_cors", value)}
                  disabled={!settings}
                  ariaLabel="Portal CORS default"
                />
              }
            />
            <SettingsItem
              title="CORS allowed origins"
              description="One URL per line. These origins are added to the Portal CORS rule."
              className="md:col-span-2"
            >
              <textarea
                value={corsOriginsText}
                onChange={(e) => handleBucketCorsOrigins(e.target.value)}
                className={corsOriginsTextareaClass}
                rows={4}
                placeholder="https://s3-manager.example.com"
                disabled={!settings || !bucketCorsEnabled}
              />
            </SettingsItem>
          </SettingsSection>
        </SettingsCard>
      </form>
    </PageShell>
  );
}
