/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import type { PortalSettings, PortalSettingsOverride } from "../../api/appSettings";
import PageBanner from "../../components/PageBanner";
import { PortalSettingsItem, PortalSettingsSection } from "../../components/PortalSettingsLayout";
import { uiCheckboxClass } from "../../components/ui/styles";

type PortalOverridesSettings = {
  effective: PortalSettings;
  admin_override: PortalSettingsOverride;
};

type TriState = "inherit" | "enabled" | "disabled";
type PolicyMode = "inherit" | "actions";

type PortalOverridesPanelProps = {
  settings: PortalOverridesSettings | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  message: string | null;
  targetLabel: string;
  onSave: (payload: PortalSettingsOverride) => void;
  onReset: () => void;
};

const hasOwn = (value: Record<string, unknown> | null | undefined, key: string) =>
  Boolean(value && Object.prototype.hasOwnProperty.call(value, key));

const normalizeListInput = (value: string): string[] =>
  value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const resolveTriState = (value?: boolean | null): TriState => {
  if (value == null) return "inherit";
  return value ? "enabled" : "disabled";
};

const toOverrideValue = (value: TriState): boolean | undefined => {
  if (value === "inherit") return undefined;
  return value === "enabled";
};

export default function PortalOverridesPanel({
  settings,
  loading,
  saving,
  error,
  message,
  targetLabel,
  onSave,
  onReset,
}: PortalOverridesPanelProps) {
  const [bucketCreate, setBucketCreate] = useState<TriState>("inherit");
  const [namedBucketCreate, setNamedBucketCreate] = useState<TriState>("inherit");
  const [accessKeyCreate, setAccessKeyCreate] = useState<TriState>("inherit");
  const [versioning, setVersioning] = useState<TriState>("inherit");
  const [lifecycle, setLifecycle] = useState<TriState>("inherit");
  const [cors, setCors] = useState<TriState>("inherit");
  const [corsOriginsOverride, setCorsOriginsOverride] = useState(false);
  const [corsOriginsText, setCorsOriginsText] = useState("");
  const [managerPolicyMode, setManagerPolicyMode] = useState<PolicyMode>("inherit");
  const [managerPolicyActionsText, setManagerPolicyActionsText] = useState("");
  const [userPolicyMode, setUserPolicyMode] = useState<PolicyMode>("inherit");
  const [userPolicyActionsText, setUserPolicyActionsText] = useState("");
  const [bucketPolicyMode, setBucketPolicyMode] = useState<PolicyMode>("inherit");
  const [bucketPolicyActionsText, setBucketPolicyActionsText] = useState("");

  useEffect(() => {
    if (!settings) {
      setBucketCreate("inherit");
      setNamedBucketCreate("inherit");
      setAccessKeyCreate("inherit");
      setVersioning("inherit");
      setLifecycle("inherit");
      setCors("inherit");
      setCorsOriginsOverride(false);
      setCorsOriginsText("");
      setManagerPolicyMode("inherit");
      setManagerPolicyActionsText("");
      setUserPolicyMode("inherit");
      setUserPolicyActionsText("");
      setBucketPolicyMode("inherit");
      setBucketPolicyActionsText("");
      return;
    }

    const override = settings.admin_override;
    const effective = settings.effective;
    const bucketDefaultsOverride = override.bucket_defaults;
    const managerOverride = override.iam_group_manager_policy;
    const userOverride = override.iam_group_user_policy;
    const bucketOverride = override.bucket_access_policy;

    setBucketCreate(resolveTriState(override.allow_portal_user_bucket_create));
    setNamedBucketCreate(resolveTriState(override.allow_portal_named_bucket_create));
    setAccessKeyCreate(resolveTriState(override.allow_portal_user_access_key_create));
    setVersioning(resolveTriState(bucketDefaultsOverride?.versioning));
    setLifecycle(resolveTriState(bucketDefaultsOverride?.enable_lifecycle));
    setCors(resolveTriState(bucketDefaultsOverride?.enable_cors));
    setCorsOriginsOverride(Boolean(bucketDefaultsOverride && bucketDefaultsOverride.cors_allowed_origins != null));
    setCorsOriginsText(
      bucketDefaultsOverride && bucketDefaultsOverride.cors_allowed_origins != null
        ? (bucketDefaultsOverride.cors_allowed_origins ?? []).join("\n")
        : (effective.bucket_defaults.cors_allowed_origins || []).join("\n")
    );
    setManagerPolicyMode(hasOwn(managerOverride as Record<string, unknown> | null, "actions") ? "actions" : "inherit");
    setManagerPolicyActionsText(
      (managerOverride?.actions ?? (effective.iam_group_manager_policy.actions || [])).join("\n")
    );
    setUserPolicyMode(hasOwn(userOverride as Record<string, unknown> | null, "actions") ? "actions" : "inherit");
    setUserPolicyActionsText((userOverride?.actions ?? (effective.iam_group_user_policy.actions || [])).join("\n"));
    setBucketPolicyMode(hasOwn(bucketOverride as Record<string, unknown> | null, "actions") ? "actions" : "inherit");
    setBucketPolicyActionsText((bucketOverride?.actions ?? (effective.bucket_access_policy.actions || [])).join("\n"));
  }, [settings]);

  const effective = settings?.effective ?? null;

  const buildPayload = (): PortalSettingsOverride => {
    const payload: PortalSettingsOverride = {};
    const allowBucketCreateValue = toOverrideValue(bucketCreate);
    if (allowBucketCreateValue !== undefined) {
      payload.allow_portal_user_bucket_create = allowBucketCreateValue;
    }
    const allowNamedBucketCreateValue = toOverrideValue(namedBucketCreate);
    if (allowNamedBucketCreateValue !== undefined) {
      payload.allow_portal_named_bucket_create = allowNamedBucketCreateValue;
    }
    const allowAccessKeyCreateValue = toOverrideValue(accessKeyCreate);
    if (allowAccessKeyCreateValue !== undefined) {
      payload.allow_portal_user_access_key_create = allowAccessKeyCreateValue;
    }

    const bucketDefaults: NonNullable<PortalSettingsOverride["bucket_defaults"]> = {};
    const versioningValue = toOverrideValue(versioning);
    if (versioningValue !== undefined) {
      bucketDefaults.versioning = versioningValue;
    }
    const lifecycleValue = toOverrideValue(lifecycle);
    if (lifecycleValue !== undefined) {
      bucketDefaults.enable_lifecycle = lifecycleValue;
    }
    const corsValue = toOverrideValue(cors);
    if (corsValue !== undefined) {
      bucketDefaults.enable_cors = corsValue;
    }
    if (corsOriginsOverride) {
      bucketDefaults.cors_allowed_origins = normalizeListInput(corsOriginsText);
    }
    if (Object.keys(bucketDefaults).length > 0) {
      payload.bucket_defaults = bucketDefaults;
    }

    if (managerPolicyMode === "actions") {
      payload.iam_group_manager_policy = { actions: normalizeListInput(managerPolicyActionsText) };
    }
    if (userPolicyMode === "actions") {
      payload.iam_group_user_policy = { actions: normalizeListInput(userPolicyActionsText) };
    }
    if (bucketPolicyMode === "actions") {
      payload.bucket_access_policy = { actions: normalizeListInput(bucketPolicyActionsText) };
    }
    return payload;
  };

  return (
    <div className="ui-surface-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">Portal overrides</p>
          <p className="ui-caption text-slate-500 dark:text-slate-400">
            Force Portal settings for this {targetLabel}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onReset}
            disabled={!settings || saving}
            className="rounded-md border border-slate-200 px-3 py-2 ui-caption font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200"
          >
            Reset overrides
          </button>
          <button
            type="button"
            onClick={() => onSave(buildPayload())}
            disabled={!settings || saving}
            className="rounded-md bg-primary px-3 py-2 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save overrides"}
          </button>
        </div>
      </div>
      <div className="mt-3 space-y-3">
        {error ? <PageBanner tone="error">{error}</PageBanner> : null}
        {message ? <PageBanner tone="success">{message}</PageBanner> : null}
        {loading && !error ? <PageBanner tone="info">Loading portal settings...</PageBanner> : null}
        {settings && effective ? (
          <div className="space-y-4">
            <PortalSettingsSection title="UI" layout="grid">
              <PortalSettingsItem
                title="Portal user Storage Space creation"
                description={`Effective for portal users: ${effective.allow_portal_user_bucket_create ? "enabled" : "disabled"}`}
                action={
                  <select
                    value={bucketCreate}
                    onChange={(event) => setBucketCreate(event.target.value as TriState)}
                    className="rounded-md border border-slate-200 px-2 py-1 ui-caption font-semibold text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    disabled={loading || saving}
                  >
                    <option value="inherit">Inherit</option>
                    <option value="enabled">Enable</option>
                    <option value="disabled">Disable</option>
                  </select>
                }
              />
              <PortalSettingsItem
                title="Named bucket creation"
                description={`Effective for portal users: ${effective.allow_portal_named_bucket_create ? "enabled" : "disabled"}`}
                action={
                  <select
                    value={namedBucketCreate}
                    onChange={(event) => setNamedBucketCreate(event.target.value as TriState)}
                    className="rounded-md border border-slate-200 px-2 py-1 ui-caption font-semibold text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    disabled={loading || saving}
                  >
                    <option value="inherit">Inherit</option>
                    <option value="enabled">Enable</option>
                    <option value="disabled">Disable</option>
                  </select>
                }
              />
              <PortalSettingsItem
                title="Access key management"
                description={`Effective for portal users: ${effective.allow_portal_user_access_key_create ? "enabled" : "disabled"}`}
                action={
                  <select
                    value={accessKeyCreate}
                    onChange={(event) => setAccessKeyCreate(event.target.value as TriState)}
                    className="rounded-md border border-slate-200 px-2 py-1 ui-caption font-semibold text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    disabled={loading || saving}
                  >
                    <option value="inherit">Inherit</option>
                    <option value="enabled">Enable</option>
                    <option value="disabled">Disable</option>
                  </select>
                }
              />
            </PortalSettingsSection>

            <PortalSettingsSection title="IAM POLICIES" layout="stack">
              <PortalSettingsItem
                title="Policy portal-manager"
                description={`Mode: ${managerPolicyMode}`}
                action={
                  <select
                    value={managerPolicyMode}
                    onChange={(event) => {
                      const mode = event.target.value as PolicyMode;
                      setManagerPolicyMode(mode);
                      if (mode === "actions" && !managerPolicyActionsText) {
                        setManagerPolicyActionsText((effective.iam_group_manager_policy.actions || []).join("\n"));
                      }
                    }}
                    className="rounded-md border border-slate-200 px-2 py-1 ui-caption font-semibold text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    disabled={loading || saving}
                  >
                    <option value="inherit">Inherit</option>
                    <option value="actions">Actions</option>
                  </select>
                }
              >
                {managerPolicyMode === "actions" ? (
                  <textarea
                    value={managerPolicyActionsText}
                    onChange={(event) => setManagerPolicyActionsText(event.target.value)}
                    className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    rows={4}
                    disabled={loading || saving}
                  />
                ) : null}
              </PortalSettingsItem>

              <PortalSettingsItem
                title="Policy portal-user"
                description={`Mode: ${userPolicyMode}`}
                action={
                  <select
                    value={userPolicyMode}
                    onChange={(event) => {
                      const mode = event.target.value as PolicyMode;
                      setUserPolicyMode(mode);
                      if (mode === "actions" && !userPolicyActionsText) {
                        setUserPolicyActionsText((effective.iam_group_user_policy.actions || []).join("\n"));
                      }
                    }}
                    className="rounded-md border border-slate-200 px-2 py-1 ui-caption font-semibold text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    disabled={loading || saving}
                  >
                    <option value="inherit">Inherit</option>
                    <option value="actions">Actions</option>
                  </select>
                }
              >
                {userPolicyMode === "actions" ? (
                  <textarea
                    value={userPolicyActionsText}
                    onChange={(event) => setUserPolicyActionsText(event.target.value)}
                    className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    rows={4}
                    disabled={loading || saving}
                  />
                ) : null}
              </PortalSettingsItem>

              <PortalSettingsItem
                title="Policy bucket access"
                description={`Mode: ${bucketPolicyMode}`}
                action={
                  <select
                    value={bucketPolicyMode}
                    onChange={(event) => {
                      const mode = event.target.value as PolicyMode;
                      setBucketPolicyMode(mode);
                      if (mode === "actions" && !bucketPolicyActionsText) {
                        setBucketPolicyActionsText((effective.bucket_access_policy.actions || []).join("\n"));
                      }
                    }}
                    className="rounded-md border border-slate-200 px-2 py-1 ui-caption font-semibold text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    disabled={loading || saving}
                  >
                    <option value="inherit">Inherit</option>
                    <option value="actions">Actions</option>
                  </select>
                }
              >
                {bucketPolicyMode === "actions" ? (
                  <textarea
                    value={bucketPolicyActionsText}
                    onChange={(event) => setBucketPolicyActionsText(event.target.value)}
                    className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    rows={4}
                    disabled={loading || saving}
                  />
                ) : null}
              </PortalSettingsItem>
            </PortalSettingsSection>

            <PortalSettingsSection title="BUCKET DEFAULTS" layout="grid">
              <PortalSettingsItem
                title="Versioning"
                description={`Effective: ${effective.bucket_defaults.versioning ? "enabled" : "disabled"}`}
                action={
                  <select
                    value={versioning}
                    onChange={(event) => setVersioning(event.target.value as TriState)}
                    className="rounded-md border border-slate-200 px-2 py-1 ui-caption font-semibold text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    disabled={loading || saving}
                  >
                    <option value="inherit">Inherit</option>
                    <option value="enabled">Enable</option>
                    <option value="disabled">Disable</option>
                  </select>
                }
              />
              <PortalSettingsItem
                title="Lifecycle"
                description={`Effective: ${effective.bucket_defaults.enable_lifecycle ? "enabled" : "disabled"}`}
                action={
                  <select
                    value={lifecycle}
                    onChange={(event) => setLifecycle(event.target.value as TriState)}
                    className="rounded-md border border-slate-200 px-2 py-1 ui-caption font-semibold text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    disabled={loading || saving}
                  >
                    <option value="inherit">Inherit</option>
                    <option value="enabled">Enable</option>
                    <option value="disabled">Disable</option>
                  </select>
                }
              />
              <PortalSettingsItem
                title="CORS"
                description={`Effective: ${effective.bucket_defaults.enable_cors ? "enabled" : "disabled"}`}
                action={
                  <select
                    value={cors}
                    onChange={(event) => setCors(event.target.value as TriState)}
                    className="rounded-md border border-slate-200 px-2 py-1 ui-caption font-semibold text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    disabled={loading || saving}
                  >
                    <option value="inherit">Inherit</option>
                    <option value="enabled">Enable</option>
                    <option value="disabled">Disable</option>
                  </select>
                }
              />
              <PortalSettingsItem
                title="CORS origins"
                description={corsOriginsOverride ? "Override active" : "Inherits defaults"}
                className="md:col-span-2"
                action={
                  <label className="inline-flex items-center gap-2 ui-caption font-semibold text-slate-700 dark:text-slate-200">
                    <input
                      type="checkbox"
                      checked={corsOriginsOverride}
                      onChange={(event) => setCorsOriginsOverride(event.target.checked)}
                      className={uiCheckboxClass}
                      disabled={loading || saving}
                    />
                    <span>Override</span>
                  </label>
                }
              >
                <textarea
                  value={corsOriginsText}
                  onChange={(event) => setCorsOriginsText(event.target.value)}
                  className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  rows={3}
                  placeholder="https://portal.example.com"
                  disabled={!corsOriginsOverride || loading || saving}
                />
              </PortalSettingsItem>
            </PortalSettingsSection>
          </div>
        ) : null}
      </div>
    </div>
  );
}
