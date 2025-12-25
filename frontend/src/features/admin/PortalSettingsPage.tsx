/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useRef, useState } from "react";
import PageHeader from "../../components/PageHeader";
import { AppSettings, fetchAppSettings, updateAppSettings } from "../../api/appSettings";

export default function PortalSettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [managerPolicyAdvanced, setManagerPolicyAdvanced] = useState(false);
  const [managerPolicyText, setManagerPolicyText] = useState("");
  const [managerPolicyError, setManagerPolicyError] = useState<string | null>(null);
  const [userPolicyAdvanced, setUserPolicyAdvanced] = useState(false);
  const [userPolicyText, setUserPolicyText] = useState("");
  const [userPolicyError, setUserPolicyError] = useState<string | null>(null);
  const [bucketPolicyAdvanced, setBucketPolicyAdvanced] = useState(false);
  const [bucketPolicyText, setBucketPolicyText] = useState("");
  const [bucketPolicyError, setBucketPolicyError] = useState<string | null>(null);
  const [corsOriginsText, setCorsOriginsText] = useState("");
  const initRef = useRef(false);

  const normalizeListInput = (value: string): string[] =>
    value
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);

  const buildGroupPolicy = (actions: string[]) => ({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: actions,
        Resource: ["*"],
      },
    ],
  });

  const buildBucketPolicy = (actions: string[]) => ({
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "PortalUserBuckets",
        Effect: "Allow",
        Action: actions,
        Resource: [],
      },
    ],
  });

  useEffect(() => {
    fetchAppSettings()
      .then((data) => setSettings(data))
      .catch(() => setError("Unable to load settings."));
  }, []);

  useEffect(() => {
    if (!settings || initRef.current) return;
    const managerPolicy = settings.portal.iam_group_manager_policy;
    const userPolicy = settings.portal.iam_group_user_policy;
    const bucketPolicy = settings.portal.bucket_access_policy;

    setManagerPolicyAdvanced(Boolean(managerPolicy.advanced_policy));
    setUserPolicyAdvanced(Boolean(userPolicy.advanced_policy));
    setBucketPolicyAdvanced(Boolean(bucketPolicy.advanced_policy));

    const managerDoc = managerPolicy.advanced_policy ?? buildGroupPolicy(managerPolicy.actions || []);
    const userDoc = userPolicy.advanced_policy ?? buildGroupPolicy(userPolicy.actions || []);
    const bucketDoc = bucketPolicy.advanced_policy ?? buildBucketPolicy(bucketPolicy.actions || []);

    setManagerPolicyText(JSON.stringify(managerDoc, null, 2));
    setUserPolicyText(JSON.stringify(userDoc, null, 2));
    setBucketPolicyText(JSON.stringify(bucketDoc, null, 2));

    setCorsOriginsText((settings.portal.bucket_defaults.cors_allowed_origins || []).join("\n"));
    initRef.current = true;
  }, [settings]);

  const handleToggleAllowPortalKey = (value: boolean) => {
    setSettings((prev) => (prev ? { ...prev, portal: { ...prev.portal, allow_portal_key: value } } : prev));
  };

  const handleToggleAllowPortalBucketCreate = (value: boolean) => {
    setSettings((prev) => (prev ? { ...prev, portal: { ...prev.portal, allow_portal_user_bucket_create: value } } : prev));
  };

  const handleToggleAllowManagerUserStats = (value: boolean) => {
    setSettings((prev) => (prev ? { ...prev, manager: { ...prev.manager, allow_manager_user_usage_stats: value } } : prev));
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
      prev ? { ...prev, portal: { ...prev.portal, iam_group_manager_policy: { ...prev.portal.iam_group_manager_policy, actions } } } : prev
    );
  };

  const handleUserActionsChange = (value: string) => {
    const actions = normalizeListInput(value);
    setSettings((prev) =>
      prev ? { ...prev, portal: { ...prev.portal, iam_group_user_policy: { ...prev.portal.iam_group_user_policy, actions } } } : prev
    );
  };

  const handleBucketActionsChange = (value: string) => {
    const actions = normalizeListInput(value);
    setSettings((prev) =>
      prev ? { ...prev, portal: { ...prev.portal, bucket_access_policy: { ...prev.portal.bucket_access_policy, actions } } } : prev
    );
  };

  const handleManagerAdvancedToggle = (value: boolean) => {
    setManagerPolicyAdvanced(value);
    setManagerPolicyError(null);
    if (!settings) return;
    if (!value) {
      setSettings((prev) =>
        prev ? { ...prev, portal: { ...prev.portal, iam_group_manager_policy: { ...prev.portal.iam_group_manager_policy, advanced_policy: null } } } : prev
      );
      return;
    }
    const next = settings.portal.iam_group_manager_policy.advanced_policy ?? buildGroupPolicy(settings.portal.iam_group_manager_policy.actions || []);
    setManagerPolicyText(JSON.stringify(next, null, 2));
    setSettings((prev) =>
      prev ? { ...prev, portal: { ...prev.portal, iam_group_manager_policy: { ...prev.portal.iam_group_manager_policy, advanced_policy: next } } } : prev
    );
  };

  const handleUserAdvancedToggle = (value: boolean) => {
    setUserPolicyAdvanced(value);
    setUserPolicyError(null);
    if (!settings) return;
    if (!value) {
      setSettings((prev) =>
        prev ? { ...prev, portal: { ...prev.portal, iam_group_user_policy: { ...prev.portal.iam_group_user_policy, advanced_policy: null } } } : prev
      );
      return;
    }
    const next = settings.portal.iam_group_user_policy.advanced_policy ?? buildGroupPolicy(settings.portal.iam_group_user_policy.actions || []);
    setUserPolicyText(JSON.stringify(next, null, 2));
    setSettings((prev) =>
      prev ? { ...prev, portal: { ...prev.portal, iam_group_user_policy: { ...prev.portal.iam_group_user_policy, advanced_policy: next } } } : prev
    );
  };

  const handleBucketAdvancedToggle = (value: boolean) => {
    setBucketPolicyAdvanced(value);
    setBucketPolicyError(null);
    if (!settings) return;
    if (!value) {
      setSettings((prev) =>
        prev ? { ...prev, portal: { ...prev.portal, bucket_access_policy: { ...prev.portal.bucket_access_policy, advanced_policy: null } } } : prev
      );
      return;
    }
    const next = settings.portal.bucket_access_policy.advanced_policy ?? buildBucketPolicy(settings.portal.bucket_access_policy.actions || []);
    setBucketPolicyText(JSON.stringify(next, null, 2));
    setSettings((prev) =>
      prev ? { ...prev, portal: { ...prev.portal, bucket_access_policy: { ...prev.portal.bucket_access_policy, advanced_policy: next } } } : prev
    );
  };

  const handleManagerPolicyText = (value: string) => {
    setManagerPolicyText(value);
    if (!settings) return;
    try {
      const parsed = JSON.parse(value);
      setManagerPolicyError(null);
      setSettings((prev) =>
        prev ? { ...prev, portal: { ...prev.portal, iam_group_manager_policy: { ...prev.portal.iam_group_manager_policy, advanced_policy: parsed } } } : prev
      );
    } catch (err) {
      console.error(err);
      setManagerPolicyError("Invalid JSON policy.");
    }
  };

  const handleUserPolicyText = (value: string) => {
    setUserPolicyText(value);
    if (!settings) return;
    try {
      const parsed = JSON.parse(value);
      setUserPolicyError(null);
      setSettings((prev) =>
        prev ? { ...prev, portal: { ...prev.portal, iam_group_user_policy: { ...prev.portal.iam_group_user_policy, advanced_policy: parsed } } } : prev
      );
    } catch (err) {
      console.error(err);
      setUserPolicyError("Invalid JSON policy.");
    }
  };

  const handleBucketPolicyText = (value: string) => {
    setBucketPolicyText(value);
    if (!settings) return;
    try {
      const parsed = JSON.parse(value);
      setBucketPolicyError(null);
      setSettings((prev) =>
        prev ? { ...prev, portal: { ...prev.portal, bucket_access_policy: { ...prev.portal.bucket_access_policy, advanced_policy: parsed } } } : prev
      );
    } catch (err) {
      console.error(err);
      setBucketPolicyError("Invalid JSON policy.");
    }
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!settings || managerPolicyError || userPolicyError || bucketPolicyError) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await updateAppSettings(settings);
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

  const hasPolicyError = Boolean(managerPolicyError || userPolicyError || bucketPolicyError);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Portal dashboard"
        description="Configure user portal behavior."
        breadcrumbs={[
          { label: "Admin" },
          { label: "Portal" },
          { label: "Settings" },
        ]}
      />
      <form className="space-y-4" onSubmit={handleSave}>
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 shadow-sm dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100">
            {error}
          </div>
        )}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Show portal key</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Allows displaying and retrieving the active portal key in the user dashboard.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={Boolean(settings?.portal.allow_portal_key)}
                onChange={(e) => handleToggleAllowPortalKey(e.target.checked)}
                className="h-5 w-5 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                disabled={!settings}
              />
              <span>{settings?.portal.allow_portal_key ? "Enabled" : "Disabled"}</span>
            </label>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Bucket creation by portal_user</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Allows a portal_user to create a bucket from the portal (uses the account admin keys).
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={Boolean(settings?.portal.allow_portal_user_bucket_create)}
                onChange={(e) => handleToggleAllowPortalBucketCreate(e.target.checked)}
                className="h-5 w-5 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                disabled={!settings}
              />
              <span>{settings?.portal.allow_portal_user_bucket_create ? "Enabled" : "Disabled"}</span>
            </label>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Portal bucket defaults</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Defaults applied when a bucket is created from the portal.
            </p>
          </div>
          <div className="mt-4 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Versioning</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Enable bucket versioning by default.</p>
              </div>
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={Boolean(settings?.portal.bucket_defaults.versioning)}
                  onChange={(e) => handleBucketDefaultVersioning(e.target.checked)}
                  className="h-5 w-5 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                  disabled={!settings}
                />
                <span>{settings?.portal.bucket_defaults.versioning ? "Enabled" : "Disabled"}</span>
              </label>
            </div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Lifecycle baseline</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Remove obsolete delete markers and non-current versions after 90 days.
                </p>
              </div>
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={Boolean(settings?.portal.bucket_defaults.enable_lifecycle)}
                  onChange={(e) => handleBucketDefaultLifecycle(e.target.checked)}
                  className="h-5 w-5 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                  disabled={!settings}
                />
                <span>{settings?.portal.bucket_defaults.enable_lifecycle ? "Enabled" : "Disabled"}</span>
              </label>
            </div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Portal CORS</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Apply a CORS rule to allow the portal UI to access the bucket.
                </p>
              </div>
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={Boolean(settings?.portal.bucket_defaults.enable_cors)}
                  onChange={(e) => handleBucketDefaultCors(e.target.checked)}
                  className="h-5 w-5 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                  disabled={!settings}
                />
                <span>{settings?.portal.bucket_defaults.enable_cors ? "Enabled" : "Disabled"}</span>
              </label>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">CORS allowed origins</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                One URL per line. These origins are added to the portal bucket CORS rule.
              </p>
              <textarea
                value={corsOriginsText}
                onChange={(e) => handleBucketCorsOrigins(e.target.value)}
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                rows={4}
                placeholder="https://s3-manager.example.com"
                disabled={!settings || !settings.portal.bucket_defaults.enable_cors}
              />
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Portal manager IAM group policy</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Actions granted to the portal-manager IAM group.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={managerPolicyAdvanced}
                onChange={(e) => handleManagerAdvancedToggle(e.target.checked)}
                className="h-5 w-5 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                disabled={!settings}
              />
              <span>Advanced JSON</span>
            </label>
          </div>
          <div className="mt-3">
            {managerPolicyAdvanced ? (
              <>
                <textarea
                  value={managerPolicyText}
                  onChange={(e) => handleManagerPolicyText(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  rows={8}
                  disabled={!settings}
                />
                {managerPolicyError && <p className="mt-1 text-xs text-rose-600 dark:text-rose-300">{managerPolicyError}</p>}
              </>
            ) : (
              <textarea
                value={(settings?.portal.iam_group_manager_policy.actions || []).join("\n")}
                onChange={(e) => handleManagerActionsChange(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                rows={6}
                placeholder="iam:*"
                disabled={!settings}
              />
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Portal user IAM group policy</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Actions granted to the portal-user IAM group.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={userPolicyAdvanced}
                onChange={(e) => handleUserAdvancedToggle(e.target.checked)}
                className="h-5 w-5 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                disabled={!settings}
              />
              <span>Advanced JSON</span>
            </label>
          </div>
          <div className="mt-3">
            {userPolicyAdvanced ? (
              <>
                <textarea
                  value={userPolicyText}
                  onChange={(e) => handleUserPolicyText(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  rows={8}
                  disabled={!settings}
                />
                {userPolicyError && <p className="mt-1 text-xs text-rose-600 dark:text-rose-300">{userPolicyError}</p>}
              </>
            ) : (
              <textarea
                value={(settings?.portal.iam_group_user_policy.actions || []).join("\n")}
                onChange={(e) => handleUserActionsChange(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                rows={4}
                placeholder="s3:ListAllMyBuckets"
                disabled={!settings}
              />
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Bucket access policy</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Actions added when granting a portal user access to a bucket.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={bucketPolicyAdvanced}
                onChange={(e) => handleBucketAdvancedToggle(e.target.checked)}
                className="h-5 w-5 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                disabled={!settings}
              />
              <span>Advanced JSON</span>
            </label>
          </div>
          <div className="mt-3">
            {bucketPolicyAdvanced ? (
              <>
                <textarea
                  value={bucketPolicyText}
                  onChange={(e) => handleBucketPolicyText(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  rows={9}
                  disabled={!settings}
                />
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  The PortalUserBuckets statement receives bucket resources automatically.
                </p>
                {bucketPolicyError && <p className="mt-1 text-xs text-rose-600 dark:text-rose-300">{bucketPolicyError}</p>}
              </>
            ) : (
              <textarea
                value={(settings?.portal.bucket_access_policy.actions || []).join("\n")}
                onChange={(e) => handleBucketActionsChange(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                rows={8}
                placeholder="s3:GetObject"
                disabled={!settings}
              />
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Manager stats for portal_user</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Allows a non-admin user to view bucket stats and usage from /manager.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={Boolean(settings?.manager.allow_manager_user_usage_stats)}
                onChange={(e) => handleToggleAllowManagerUserStats(e.target.checked)}
                className="h-5 w-5 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                disabled={!settings}
              />
              <span>{settings?.manager.allow_manager_user_usage_stats ? "Enabled" : "Disabled"}</span>
            </label>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!settings || saving || hasPolicyError}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          {savedMessage && <span className="text-xs text-emerald-600 dark:text-emerald-300">{savedMessage}</span>}
        </div>
      </form>
    </div>
  );
}
