/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useRef, useState } from "react";
import PageHeader from "../../components/PageHeader";
import { adminBreadcrumbs } from "./adminBreadcrumbs";
import PageBanner from "../../components/PageBanner";
import {
  SettingsCard,
  SettingsItem,
  SettingsSection,
  SettingsToggleAction,
  settingsCheckboxClassName,
  settingsCompactInputClassName,
  settingsInlineButtonClassName,
  settingsTextareaClassName,
} from "../../components/settings/SettingsLayout";
import UiButton from "../../components/ui/UiButton";
import { AppSettings, fetchAppSettings, fetchDefaultAppSettings, updateAppSettings } from "../../api/appSettings";
import { extractApiError } from "../../utils/apiError";
import { confirmAction } from "../../utils/confirm";

const allowOverrideLabelClass = "inline-flex items-center gap-2 ui-caption font-semibold text-[var(--ui-text)]";
const corsOriginsTextareaClass = `mt-2 ${settingsTextareaClassName}`;

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
    setSettings((prev) => (prev ? { ...prev, portal: { ...prev.portal, allow_portal_user_bucket_create: value } } : prev));
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

  const handleOverrideToggle = (
    field: "allow_portal_user_bucket_create" | "allow_portal_named_bucket_create" | "allow_portal_user_access_key_create",
    value: boolean
  ) => {
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
    if (!Number.isInteger(settings.portal.max_portal_user_access_keys) || settings.portal.max_portal_user_access_keys < 1) {
      setError("Max IAM user keys per portal user must be a positive integer.");
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
  const portalNamedBucketCreateEnabled = Boolean(settings?.portal.allow_portal_named_bucket_create);
  const portalAccessKeyCreateEnabled = Boolean(settings?.portal.allow_portal_user_access_key_create);
  const portalMaxAccessKeys = settings?.portal.max_portal_user_access_keys ?? 2;
  const bucketVersioningEnabled = Boolean(settings?.portal.bucket_defaults.versioning);
  const bucketLifecycleEnabled = Boolean(settings?.portal.bucket_defaults.enable_lifecycle);
  const bucketCorsEnabled = Boolean(settings?.portal.bucket_defaults.enable_cors);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Portal settings"
        description="Configure portal behavior."
        breadcrumbs={adminBreadcrumbs({ label: "Portal" }, { label: "Settings" })}
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
        <SettingsCard>
          <SettingsSection title="UI" description="Portal UI switches and per-account override permissions." layout="grid">
            <SettingsItem
              title="Portal user Storage Space creation"
              description="Allow portal-user members to create their own Storage Spaces from the Portal. Storage-side permissions and the Portal service still enforce the actual bucket creation workflow."
              action={
                <div className="flex flex-col gap-2 sm:items-end">
                  <SettingsToggleAction
                    checked={portalBucketCreateEnabled}
                    onChange={(value) => handleToggleAllowPortalBucketCreate(value)}
                    disabled={!settings}
                    ariaLabel="Portal user Storage Space creation"
                  />
                  <label className={allowOverrideLabelClass}>
                    <span>Allow override</span>
                    <input
                      type="checkbox"
                      checked={Boolean(settings?.portal.override_policy.allow_portal_user_bucket_create)}
                      onChange={(e) => handleOverrideToggle("allow_portal_user_bucket_create", e.target.checked)}
                      className={settingsCheckboxClassName}
                      disabled={!settings}
                    />
                  </label>
                </div>
              }
            />
            <SettingsItem
              title="Named bucket creation"
              description="Allow the portal create form to create a locked Storage Space whose bucket name is based on the submitted name."
              action={
                <div className="flex flex-col gap-2 sm:items-end">
                  <SettingsToggleAction
                    checked={portalNamedBucketCreateEnabled}
                    onChange={(value) => handleToggleAllowPortalNamedBucketCreate(value)}
                    disabled={!settings}
                    ariaLabel="Portal named bucket creation"
                  />
                  <label className={allowOverrideLabelClass}>
                    <span>Allow override</span>
                    <input
                      type="checkbox"
                      checked={Boolean(settings?.portal.override_policy.allow_portal_named_bucket_create)}
                      onChange={(e) => handleOverrideToggle("allow_portal_named_bucket_create", e.target.checked)}
                      className={settingsCheckboxClassName}
                      disabled={!settings}
                    />
                  </label>
                </div>
              }
            />
            <SettingsItem
              title="Access key management"
              description="Allow portal users to create and delete their own IAM user keys from the portal."
              action={
                <div className="flex flex-col gap-2 sm:items-end">
                  <SettingsToggleAction
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
                      className={settingsCheckboxClassName}
                      disabled={!settings}
                    />
                  </label>
                </div>
              }
            />
            <SettingsItem
              title="Max IAM user keys per portal user"
              description="Global limit for IAM user access keys created from the portal."
              action={
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={portalMaxAccessKeys}
                  onChange={(e) => handleMaxPortalUserAccessKeysChange(e.target.value)}
                  disabled={!settings}
                  aria-label="Max IAM user keys per portal user"
                  className={`w-28 ${settingsCompactInputClassName}`}
                />
              }
            />
          </SettingsSection>
        </SettingsCard>
        <SettingsCard>
          <SettingsSection
            title="IAM POLICIES"
            description="Action lists applied to portal IAM groups and bucket access."
            layout="stack"
          >
            <div className="grid gap-x-6 md:grid-cols-2 md:[&>*:nth-child(2)]:border-t-0 md:[&>*:nth-child(2)]:pt-0">
              <SettingsItem
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
                        className={settingsCheckboxClassName}
                        disabled={!settings}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => handleResetPolicy("manager")}
                      disabled={!settings || saving || resetting || Boolean(resettingPolicy)}
                      className={settingsInlineButtonClassName}
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
                    className={settingsTextareaClassName}
                    rows={6}
                    placeholder="s3:ListAllMyBuckets"
                    disabled={!settings}
                  />
                </div>
              </SettingsItem>
              <SettingsItem
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
                        className={settingsCheckboxClassName}
                        disabled={!settings}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => handleResetPolicy("user")}
                      disabled={!settings || saving || resetting || Boolean(resettingPolicy)}
                      className={settingsInlineButtonClassName}
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
                    className={settingsTextareaClassName}
                    rows={4}
                    placeholder="s3:ListAllMyBuckets"
                    disabled={!settings}
                  />
                </div>
              </SettingsItem>
            </div>
            <SettingsItem
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
                      className={settingsCheckboxClassName}
                      disabled={!settings}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => handleResetPolicy("bucket")}
                    disabled={!settings || saving || resetting || Boolean(resettingPolicy)}
                    className={settingsInlineButtonClassName}
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
                  className={settingsTextareaClassName}
                  rows={8}
                  placeholder="s3:GetObject"
                  disabled={!settings}
                />
                <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                  The PortalUserBuckets statement receives bucket resources automatically.
                </p>
              </div>
            </SettingsItem>
          </SettingsSection>
        </SettingsCard>
        <SettingsCard>
          <SettingsSection
            title="BUCKET DEFAULTS"
            description="Defaults applied when a bucket is created from the portal."
            layout="grid"
          >
            <SettingsItem
              title="Versioning"
              description="Enable bucket versioning by default."
              action={
                <div className="flex flex-col gap-2 sm:items-end">
                  <SettingsToggleAction
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
                      className={settingsCheckboxClassName}
                      disabled={!settings}
                    />
                  </label>
                </div>
              }
            />
            <SettingsItem
              title="Lifecycle baseline"
              description="Remove obsolete delete markers and non-current versions after 90 days."
              action={
                <div className="flex flex-col gap-2 sm:items-end">
                  <SettingsToggleAction
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
                      className={settingsCheckboxClassName}
                      disabled={!settings}
                    />
                  </label>
                </div>
              }
            />
            <SettingsItem
              title="Portal CORS"
              description="Apply a CORS rule to allow the portal UI to access the bucket."
              action={
                <div className="flex flex-col gap-2 sm:items-end">
                  <SettingsToggleAction
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
                      className={settingsCheckboxClassName}
                      disabled={!settings}
                    />
                  </label>
                </div>
              }
            />
            <SettingsItem
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
                    className={settingsCheckboxClassName}
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
            </SettingsItem>
          </SettingsSection>
        </SettingsCard>
      </form>
    </div>
  );
}
