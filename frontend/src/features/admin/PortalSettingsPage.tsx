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
  settingsCompactInputClassName,
  settingsInlineButtonClassName,
  settingsTextareaClassName,
} from "../../components/settings/SettingsLayout";
import UiButton from "../../components/ui/UiButton";
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
      setError("Max S3 access keys per portal user must be a positive integer.");
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
        description="Configure Portal self-service behavior and storage projections."
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
          <SettingsSection title="UI" description="Portal UI switches and account defaults." layout="grid">
            <SettingsItem
              title="Portal user Storage Space creation"
              description="Allow portal-user members to create their own Storage Spaces from the Portal. Storage-side permissions and the Portal service still enforce the actual bucket creation workflow."
              action={
                <SettingsToggleAction
                  checked={portalBucketCreateEnabled}
                  onChange={(value) => handleToggleAllowPortalBucketCreate(value)}
                  disabled={!settings}
                  ariaLabel="Portal user Storage Space creation"
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
            title="STORAGE ACCESS PROJECTIONS"
            description="Action lists used by Portal IAM bootstrap groups and Storage Space access projections."
            layout="stack"
          >
            <div className="grid gap-x-6 md:grid-cols-2 md:[&>*:nth-child(2)]:border-t-0 md:[&>*:nth-child(2)]:pt-0">
              <SettingsItem
                title="Portal manager bootstrap policy"
                description="Actions granted to the portal-manager IAM group before Storage Space-specific projections are applied."
                action={
                  <button
                    type="button"
                    onClick={() => handleResetPolicy("manager")}
                    disabled={!settings || saving || resetting || Boolean(resettingPolicy)}
                    className={settingsInlineButtonClassName}
                  >
                    {resettingPolicy === "manager" ? "Resetting..." : "Reset policy"}
                  </button>
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
                title="Portal user bootstrap policy"
                description="Actions granted to the portal-user IAM group before Storage Space-specific projections are applied."
                action={
                  <button
                    type="button"
                    onClick={() => handleResetPolicy("user")}
                    disabled={!settings || saving || resetting || Boolean(resettingPolicy)}
                    className={settingsInlineButtonClassName}
                  >
                    {resettingPolicy === "user" ? "Resetting..." : "Reset policy"}
                  </button>
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
              title="Storage Space access policy"
              description="Actions projected when a Portal grant gives a user access to a Storage Space."
              action={
                <button
                  type="button"
                  onClick={() => handleResetPolicy("bucket")}
                  disabled={!settings || saving || resetting || Boolean(resettingPolicy)}
                  className={settingsInlineButtonClassName}
                >
                  {resettingPolicy === "bucket" ? "Resetting..." : "Reset policy"}
                </button>
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
                  Storage Space grant projections receive storage resources automatically from Portal grants.
                </p>
              </div>
            </SettingsItem>
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
                  onChange={(value) => handleBucketDefaultVersioning(value)}
                  disabled={!settings}
                  ariaLabel="Bucket versioning default"
                />
              }
            />
            <SettingsItem
              title="Lifecycle baseline"
              description="Remove obsolete delete markers and non-current versions after 90 days."
              action={
                <SettingsToggleAction
                  checked={bucketLifecycleEnabled}
                  onChange={(value) => handleBucketDefaultLifecycle(value)}
                  disabled={!settings}
                  ariaLabel="Bucket lifecycle default"
                />
              }
            />
            <SettingsItem
              title="Portal CORS"
              description="Apply a CORS rule to allow the Portal UI to access Storage Space backing storage."
              action={
                <SettingsToggleAction
                  checked={bucketCorsEnabled}
                  onChange={(value) => handleBucketDefaultCors(value)}
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
    </div>
  );
}
