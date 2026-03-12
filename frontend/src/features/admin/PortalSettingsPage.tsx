/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useRef, useState } from "react";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import {
  PortalSettingsItem,
  PortalSettingsSection,
  PortalSettingsToggleAction,
} from "../../components/PortalSettingsLayout";
import UiButton from "../../components/ui/UiButton";
import { cx, uiCheckboxClass, uiInputClass } from "../../components/ui/styles";
import { AppSettings, fetchAppSettings, fetchDefaultAppSettings, updateAppSettings } from "../../api/appSettings";
import { extractApiError } from "../../utils/apiError";
import { confirmAction } from "../../utils/confirm";

const allowOverrideLabelClass = "inline-flex items-center gap-2 ui-caption font-semibold text-slate-700 dark:text-slate-200";
const corsOriginsTextareaClass = cx("mt-2 ui-caption", uiInputClass);

export default function PortalSettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [corsOriginsText, setCorsOriginsText] = useState("");
  const initRef = useRef(false);
  const [resettingPolicy, setResettingPolicy] = useState<"manager" | "user" | "bucket" | null>(null);

  const normalizeListInput = (value: string): string[] =>
    value
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);

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
    setSettings((prev) => (prev ? { ...prev, portal: { ...prev.portal, allow_portal_user_bucket_create: value } } : prev));
  };

  const handleToggleAllowPortalAccessKeyCreate = (value: boolean) => {
    setSettings((prev) =>
      prev ? { ...prev, portal: { ...prev.portal, allow_portal_user_access_key_create: value } } : prev
    );
  };

  const handleToggleAllowPortalManagerWorkspace = (value: boolean) => {
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            general: {
              ...prev.general,
              allow_portal_manager_workspace: value,
            },
          }
        : prev
    );
  };

  const handleBucketDefaultVersioning = (value: boolean) => {
    setSettings((prev) =>
      prev ? { ...prev, portal: { ...prev.portal, bucket_defaults: { ...prev.portal.bucket_defaults, versioning: value } } } : prev
    );
  };

  const handleBucketDefaultLifecycle = (value: boolean) => {
    setSettings((prev) =>
      prev ? { ...prev, portal: { ...prev.portal, bucket_defaults: { ...prev.portal.bucket_defaults, enable_lifecycle: value } } } : prev
    );
  };

  const handleBucketDefaultCors = (value: boolean) => {
    setSettings((prev) =>
      prev ? { ...prev, portal: { ...prev.portal, bucket_defaults: { ...prev.portal.bucket_defaults, enable_cors: value } } } : prev
    );
  };

  const handleBucketCorsOrigins = (value: string) => {
    setCorsOriginsText(value);
    const origins = normalizeListInput(value);
    setSettings((prev) =>
      prev ? { ...prev, portal: { ...prev.portal, bucket_defaults: { ...prev.portal.bucket_defaults, cors_allowed_origins: origins } } } : prev
    );
  };

  const updateOverridePolicy = (
    updater: (policy: AppSettings["portal"]["override_policy"]) => AppSettings["portal"]["override_policy"]
  ) => {
    setSettings((prev) =>
      prev ? { ...prev, portal: { ...prev.portal, override_policy: updater(prev.portal.override_policy) } } : prev
    );
  };

  const handleOverrideToggle = (field: "allow_portal_user_bucket_create" | "allow_portal_user_access_key_create", value: boolean) => {
    updateOverridePolicy((policy) => ({ ...policy, [field]: value }));
  };

  const handleOverridePolicyToggle = (
    section: "iam_group_manager_policy" | "iam_group_user_policy" | "bucket_access_policy",
    field: "actions",
    value: boolean
  ) => {
    updateOverridePolicy((policy) => ({
      ...policy,
      [section]: {
        ...policy[section],
        [field]: value,
      },
    }));
  };

  const handleOverrideBucketDefaultsToggle = (
    field: "versioning" | "enable_cors" | "enable_lifecycle" | "cors_allowed_origins",
    value: boolean
  ) => {
    updateOverridePolicy((policy) => ({
      ...policy,
      bucket_defaults: {
        ...policy.bucket_defaults,
        [field]: value,
      },
    }));
  };

  const handleManagerActionsChange = (value: string) => {
    const actions = normalizeListInput(value);
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            portal: {
              ...prev.portal,
              iam_group_manager_policy: { ...prev.portal.iam_group_manager_policy, actions, advanced_policy: null },
            },
          }
        : prev
    );
  };

  const handleUserActionsChange = (value: string) => {
    const actions = normalizeListInput(value);
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            portal: {
              ...prev.portal,
              iam_group_user_policy: { ...prev.portal.iam_group_user_policy, actions, advanced_policy: null },
            },
          }
        : prev
    );
  };

  const handleBucketActionsChange = (value: string) => {
    const actions = normalizeListInput(value);
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            portal: {
              ...prev.portal,
              bucket_access_policy: { ...prev.portal.bucket_access_policy, actions, advanced_policy: null },
            },
          }
        : prev
    );
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
              general: {
                ...prev.general,
                allow_portal_manager_workspace: defaults.general.allow_portal_manager_workspace,
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

  const handleResetPolicy = async (scope: "manager" | "user" | "bucket") => {
    if (!settings) return;
    setResettingPolicy(scope);
    setError(null);
    setSavedMessage(null);
    try {
      const defaults = await fetchDefaultAppSettings();
      setSettings((prev) => {
        if (!prev) return defaults;
        const portal = { ...prev.portal };
        if (scope === "manager") {
          portal.iam_group_manager_policy = defaults.portal.iam_group_manager_policy;
        } else if (scope === "user") {
          portal.iam_group_user_policy = defaults.portal.iam_group_user_policy;
        } else {
          portal.bucket_access_policy = defaults.portal.bucket_access_policy;
        }
        return { ...prev, portal };
      });
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, "Unable to load default settings."));
    } finally {
      setResettingPolicy(null);
    }
  };

  const portalBucketCreateEnabled = Boolean(settings?.portal.allow_portal_user_bucket_create);
  const portalAccessKeyCreateEnabled = Boolean(settings?.portal.allow_portal_user_access_key_create);
  const bucketVersioningEnabled = Boolean(settings?.portal.bucket_defaults.versioning);
  const bucketLifecycleEnabled = Boolean(settings?.portal.bucket_defaults.enable_lifecycle);
  const bucketCorsEnabled = Boolean(settings?.portal.bucket_defaults.enable_cors);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Portal settings"
        description="Configure portal behavior."
        breadcrumbs={[
          { label: "Admin" },
          { label: "Portal" },
          { label: "Settings" },
        ]}
        rightContent={
          <div className="flex flex-wrap gap-2">
            <UiButton
              variant="ghost"
              onClick={handleResetDefaults}
              disabled={!settings || saving || resetting || Boolean(resettingPolicy)}
              className="py-1.5 disabled:pointer-events-none"
            >
              {resetting ? "Resetting..." : "Reset to defaults"}
            </UiButton>
            <UiButton
              onClick={handleSave}
              disabled={!settings || saving || resetting || Boolean(resettingPolicy)}
              className="py-1.5 disabled:pointer-events-none"
            >
              {saving ? "Saving..." : "Save changes"}
            </UiButton>
          </div>
        }
      />
      <form className="space-y-4" onSubmit={handleSave}>
        {error && <PageBanner tone="error">{error}</PageBanner>}
        {savedMessage && <PageBanner tone="success">{savedMessage}</PageBanner>}
        <div className="ui-surface-card p-5">
          <PortalSettingsSection title="UI" description="Portal UI switches and per-account override permissions." layout="grid">
            <PortalSettingsItem
              title="Bucket creation"
              description="Allow portal users to create buckets from the portal."
              action={
                <div className="flex flex-col gap-2 sm:items-end">
                  <PortalSettingsToggleAction
                    checked={portalBucketCreateEnabled}
                    onChange={(value) => handleToggleAllowPortalBucketCreate(value)}
                    disabled={!settings}
                    ariaLabel="Portal user bucket creation"
                  />
                  <label className={allowOverrideLabelClass}>
                    <span>Allow override</span>
                    <input
                      type="checkbox"
                      checked={Boolean(settings?.portal.override_policy.allow_portal_user_bucket_create)}
                      onChange={(e) => handleOverrideToggle("allow_portal_user_bucket_create", e.target.checked)}
                      className={uiCheckboxClass}
                      disabled={!settings}
                    />
                  </label>
                </div>
              }
            />
            <PortalSettingsItem
              title="Access key management"
              description="Allow portal users to create and delete their own IAM user keys from the portal."
              action={
                <div className="flex flex-col gap-2 sm:items-end">
                  <PortalSettingsToggleAction
                    checked={portalAccessKeyCreateEnabled}
                    onChange={(value) => handleToggleAllowPortalAccessKeyCreate(value)}
                    disabled={!settings}
                    ariaLabel="Portal user access key management"
                  />
                  <label className={allowOverrideLabelClass}>
                    <span>Allow override</span>
                    <input
                      type="checkbox"
                      checked={Boolean(settings?.portal.override_policy.allow_portal_user_access_key_create)}
                      onChange={(e) => handleOverrideToggle("allow_portal_user_access_key_create", e.target.checked)}
                      className={uiCheckboxClass}
                      disabled={!settings}
                    />
                  </label>
                </div>
              }
            />
            <PortalSettingsItem
              title="Allow portal managers in Manager workspace"
              description="When enabled, users with role portal_manager can use /manager for their linked accounts."
              action={
                <PortalSettingsToggleAction
                  checked={Boolean(settings?.general.allow_portal_manager_workspace)}
                  onChange={(value) => handleToggleAllowPortalManagerWorkspace(value)}
                  disabled={!settings}
                  ariaLabel="Allow portal manager workspace"
                  badge={{ visible: true, label: "Deprecated", tone: "warning" }}
                />
              }
            />
          </PortalSettingsSection>
        </div>
        <div className="ui-surface-card p-5">
          <PortalSettingsSection
            title="IAM POLICIES"
            description="Action lists applied to portal IAM groups and bucket access."
            layout="stack"
          >
            <div className="grid gap-3 md:grid-cols-2">
              <PortalSettingsItem
                title="Policy portal-manager"
                description="Actions granted to the portal-manager IAM group."
                action={
                  <div className="flex flex-wrap items-center gap-2">
                    <label className={allowOverrideLabelClass}>
                      <span>Allow override</span>
                      <input
                        type="checkbox"
                        checked={Boolean(settings?.portal.override_policy.iam_group_manager_policy.actions)}
                        onChange={(e) => handleOverridePolicyToggle("iam_group_manager_policy", "actions", e.target.checked)}
                        className={uiCheckboxClass}
                        disabled={!settings}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => handleResetPolicy("manager")}
                      disabled={!settings || saving || resetting || Boolean(resettingPolicy)}
                      className="rounded-md border border-slate-200 px-2.5 py-1 ui-caption font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200"
                    >
                      {resettingPolicy === "manager" ? "Resetting..." : "Reset policy"}
                    </button>
                  </div>
                }
              >
                <div className="mt-3">
                  <textarea
                    value={(settings?.portal.iam_group_manager_policy.actions || []).join("\n")}
                    onChange={(e) => handleManagerActionsChange(e.target.value)}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 ui-caption text-slate-800 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    rows={6}
                    placeholder="iam:*"
                    disabled={!settings}
                  />
                </div>
              </PortalSettingsItem>
              <PortalSettingsItem
                title="Policy portal-user"
                description="Actions granted to the portal-user IAM group."
                action={
                  <div className="flex flex-wrap items-center gap-2">
                    <label className={allowOverrideLabelClass}>
                      <span>Allow override</span>
                      <input
                        type="checkbox"
                        checked={Boolean(settings?.portal.override_policy.iam_group_user_policy.actions)}
                        onChange={(e) => handleOverridePolicyToggle("iam_group_user_policy", "actions", e.target.checked)}
                        className={uiCheckboxClass}
                        disabled={!settings}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => handleResetPolicy("user")}
                      disabled={!settings || saving || resetting || Boolean(resettingPolicy)}
                      className="rounded-md border border-slate-200 px-2.5 py-1 ui-caption font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200"
                    >
                      {resettingPolicy === "user" ? "Resetting..." : "Reset policy"}
                    </button>
                  </div>
                }
              >
                <div className="mt-3">
                  <textarea
                    value={(settings?.portal.iam_group_user_policy.actions || []).join("\n")}
                    onChange={(e) => handleUserActionsChange(e.target.value)}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 ui-caption text-slate-800 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    rows={4}
                    placeholder="s3:ListAllMyBuckets"
                    disabled={!settings}
                  />
                </div>
              </PortalSettingsItem>
            </div>
            <PortalSettingsItem
              title="Policy bucket access"
              description="Actions added when granting a portal user access to a bucket."
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <label className={allowOverrideLabelClass}>
                    <span>Allow override</span>
                    <input
                      type="checkbox"
                      checked={Boolean(settings?.portal.override_policy.bucket_access_policy.actions)}
                      onChange={(e) => handleOverridePolicyToggle("bucket_access_policy", "actions", e.target.checked)}
                      className={uiCheckboxClass}
                      disabled={!settings}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => handleResetPolicy("bucket")}
                    disabled={!settings || saving || resetting || Boolean(resettingPolicy)}
                    className="rounded-md border border-slate-200 px-2.5 py-1 ui-caption font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200"
                  >
                    {resettingPolicy === "bucket" ? "Resetting..." : "Reset policy"}
                  </button>
                </div>
              }
            >
              <div className="mt-3">
                <textarea
                  value={(settings?.portal.bucket_access_policy.actions || []).join("\n")}
                  onChange={(e) => handleBucketActionsChange(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 ui-caption text-slate-800 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  rows={8}
                  placeholder="s3:GetObject"
                  disabled={!settings}
                />
                <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                  The PortalUserBuckets statement receives bucket resources automatically.
                </p>
              </div>
            </PortalSettingsItem>
          </PortalSettingsSection>
        </div>
        <div className="ui-surface-card p-5">
          <PortalSettingsSection
            title="BUCKET DEFAULTS"
            description="Defaults applied when a bucket is created from the portal."
            layout="grid"
          >
            <PortalSettingsItem
              title="Versioning"
              description="Enable bucket versioning by default."
              action={
                <div className="flex flex-col gap-2 sm:items-end">
                  <PortalSettingsToggleAction
                    checked={bucketVersioningEnabled}
                    onChange={(value) => handleBucketDefaultVersioning(value)}
                    disabled={!settings}
                    ariaLabel="Bucket versioning default"
                  />
                  <label className={allowOverrideLabelClass}>
                    <span>Allow override</span>
                    <input
                      type="checkbox"
                      checked={Boolean(settings?.portal.override_policy.bucket_defaults.versioning)}
                      onChange={(e) => handleOverrideBucketDefaultsToggle("versioning", e.target.checked)}
                      className={uiCheckboxClass}
                      disabled={!settings}
                    />
                  </label>
                </div>
              }
            />
            <PortalSettingsItem
              title="Lifecycle baseline"
              description="Remove obsolete delete markers and non-current versions after 90 days."
              action={
                <div className="flex flex-col gap-2 sm:items-end">
                  <PortalSettingsToggleAction
                    checked={bucketLifecycleEnabled}
                    onChange={(value) => handleBucketDefaultLifecycle(value)}
                    disabled={!settings}
                    ariaLabel="Bucket lifecycle default"
                  />
                  <label className={allowOverrideLabelClass}>
                    <span>Allow override</span>
                    <input
                      type="checkbox"
                      checked={Boolean(settings?.portal.override_policy.bucket_defaults.enable_lifecycle)}
                      onChange={(e) => handleOverrideBucketDefaultsToggle("enable_lifecycle", e.target.checked)}
                      className={uiCheckboxClass}
                      disabled={!settings}
                    />
                  </label>
                </div>
              }
            />
            <PortalSettingsItem
              title="Portal CORS"
              description="Apply a CORS rule to allow the portal UI to access the bucket."
              action={
                <div className="flex flex-col gap-2 sm:items-end">
                  <PortalSettingsToggleAction
                    checked={bucketCorsEnabled}
                    onChange={(value) => handleBucketDefaultCors(value)}
                    disabled={!settings}
                    ariaLabel="Portal CORS default"
                  />
                  <label className={allowOverrideLabelClass}>
                    <span>Allow override</span>
                    <input
                      type="checkbox"
                      checked={Boolean(settings?.portal.override_policy.bucket_defaults.enable_cors)}
                      onChange={(e) => handleOverrideBucketDefaultsToggle("enable_cors", e.target.checked)}
                      className={uiCheckboxClass}
                      disabled={!settings}
                    />
                  </label>
                </div>
              }
            />
            <PortalSettingsItem
              title="CORS allowed origins"
              description="One URL per line. These origins are added to the portal bucket CORS rule."
              className="md:col-span-2"
              action={
                <label className={allowOverrideLabelClass}>
                  <span>Allow override</span>
                  <input
                    type="checkbox"
                    checked={Boolean(settings?.portal.override_policy.bucket_defaults.cors_allowed_origins)}
                    onChange={(e) => handleOverrideBucketDefaultsToggle("cors_allowed_origins", e.target.checked)}
                    className={uiCheckboxClass}
                    disabled={!settings}
                  />
                </label>
              }
            >
              <textarea
                value={corsOriginsText}
                onChange={(e) => handleBucketCorsOrigins(e.target.value)}
                className={corsOriginsTextareaClass}
                rows={4}
                placeholder="https://s3-manager.example.com"
                disabled={!settings || !bucketCorsEnabled}
              />
            </PortalSettingsItem>
          </PortalSettingsSection>
        </div>
      </form>
    </div>
  );
}
