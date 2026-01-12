/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import {
  PortalAccountSettings,
  PortalState,
  fetchPortalAccountSettings,
  fetchPortalState,
  updatePortalAccountSettings,
} from "../../api/portal";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import {
  PortalSettingsItem,
  PortalSettingsSection,
  PortalSettingsSwitch,
} from "../../components/PortalSettingsLayout";
import { confirmAction } from "../../utils/confirm";
import { usePortalAccountContext } from "./PortalAccountContext";

type TriState = "inherit" | "enabled" | "disabled";
type PolicyMode = "inherit" | "actions";

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

export default function PortalSettingsPage() {
  const { accountIdForApi, selectedAccount, hasAccountContext, loading: accountLoading, error: accountError } =
    usePortalAccountContext();
  const [portalState, setPortalState] = useState<PortalState | null>(null);
  const [stateLoading, setStateLoading] = useState(false);
  const [stateError, setStateError] = useState<string | null>(null);
  const [portalAccountSettings, setPortalAccountSettings] = useState<PortalAccountSettings | null>(null);
  const [portalSettingsLoading, setPortalSettingsLoading] = useState(false);
  const [portalSettingsError, setPortalSettingsError] = useState<string | null>(null);
  const [portalSettingsSaving, setPortalSettingsSaving] = useState(false);
  const [portalSettingsMessage, setPortalSettingsMessage] = useState<string | null>(null);
  const [overridePortalKey, setOverridePortalKey] = useState<TriState>("inherit");
  const [overridePortalBucketCreate, setOverridePortalBucketCreate] = useState<TriState>("inherit");
  const [bucketVersioningOverride, setBucketVersioningOverride] = useState<TriState>("inherit");
  const [bucketLifecycleOverride, setBucketLifecycleOverride] = useState<TriState>("inherit");
  const [bucketCorsOverride, setBucketCorsOverride] = useState<TriState>("inherit");
  const [bucketCorsOriginsOverride, setBucketCorsOriginsOverride] = useState(false);
  const [bucketCorsOriginsText, setBucketCorsOriginsText] = useState("");
  const [managerPolicyMode, setManagerPolicyMode] = useState<PolicyMode>("inherit");
  const [managerPolicyActionsText, setManagerPolicyActionsText] = useState("");
  const [userPolicyMode, setUserPolicyMode] = useState<PolicyMode>("inherit");
  const [userPolicyActionsText, setUserPolicyActionsText] = useState("");
  const [bucketPolicyMode, setBucketPolicyMode] = useState<PolicyMode>("inherit");
  const [bucketPolicyActionsText, setBucketPolicyActionsText] = useState("");
  const accountName = selectedAccount?.name ?? "compte selectionne";

  const canManagePortalUsers = Boolean(portalState?.can_manage_portal_users) || portalState?.account_role === "portal_manager";
  const effectivePortalSettings = portalAccountSettings?.effective ?? null;
  const overridePolicy = portalAccountSettings?.override_policy ?? null;
  const adminOverride = portalAccountSettings?.admin_override ?? null;
  const portalKeyEnabled = Boolean(effectivePortalSettings?.allow_portal_key);
  const portalBucketCreateEnabled = Boolean(effectivePortalSettings?.allow_portal_user_bucket_create);
  const bucketVersioningEnabled = Boolean(effectivePortalSettings?.bucket_defaults.versioning);
  const bucketLifecycleEnabled = Boolean(effectivePortalSettings?.bucket_defaults.enable_lifecycle);
  const bucketCorsEnabled = Boolean(effectivePortalSettings?.bucket_defaults.enable_cors);
  const hasAdminOverrides = useMemo(() => {
    if (!adminOverride) return false;
    if (adminOverride.allow_portal_key != null || adminOverride.allow_portal_user_bucket_create != null) {
      return true;
    }
    if (adminOverride.bucket_defaults) {
      if (
        adminOverride.bucket_defaults.versioning != null ||
        adminOverride.bucket_defaults.enable_cors != null ||
        adminOverride.bucket_defaults.enable_lifecycle != null ||
        adminOverride.bucket_defaults.cors_allowed_origins != null
      ) {
        return true;
      }
    }
    const managerPolicy = adminOverride.iam_group_manager_policy;
    if (hasOwn(managerPolicy as Record<string, unknown> | null, "actions") || hasOwn(managerPolicy as Record<string, unknown> | null, "advanced_policy")) {
      return true;
    }
    const userPolicy = adminOverride.iam_group_user_policy;
    if (hasOwn(userPolicy as Record<string, unknown> | null, "actions") || hasOwn(userPolicy as Record<string, unknown> | null, "advanced_policy")) {
      return true;
    }
    const bucketPolicy = adminOverride.bucket_access_policy;
    if (hasOwn(bucketPolicy as Record<string, unknown> | null, "actions") || hasOwn(bucketPolicy as Record<string, unknown> | null, "advanced_policy")) {
      return true;
    }
    return false;
  }, [adminOverride]);

  useEffect(() => {
    if (!accountIdForApi) {
      setPortalState(null);
      setStateError(null);
      setStateLoading(false);
      return;
    }
    setStateLoading(true);
    setStateError(null);
    fetchPortalState(accountIdForApi)
      .then((data) => {
        setPortalState(data);
      })
      .catch((err) => {
        console.error(err);
        setPortalState(null);
        setStateError("Unable to load portal context.");
      })
      .finally(() => setStateLoading(false));
  }, [accountIdForApi]);

  useEffect(() => {
    setPortalAccountSettings(null);
    setPortalSettingsError(null);
    setPortalSettingsLoading(false);
    if (!accountIdForApi || !canManagePortalUsers) return;
    setPortalSettingsLoading(true);
    fetchPortalAccountSettings(accountIdForApi)
      .then((data) => setPortalAccountSettings(data))
      .catch((err) => {
        console.error(err);
        setPortalSettingsError("Unable to load portal settings.");
      })
      .finally(() => setPortalSettingsLoading(false));
  }, [accountIdForApi, canManagePortalUsers]);

  useEffect(() => {
    if (!portalAccountSettings) {
      setOverridePortalKey("inherit");
      setOverridePortalBucketCreate("inherit");
      setBucketVersioningOverride("inherit");
      setBucketLifecycleOverride("inherit");
      setBucketCorsOverride("inherit");
      setBucketCorsOriginsOverride(false);
      setBucketCorsOriginsText("");
      setManagerPolicyMode("inherit");
      setManagerPolicyActionsText("");
      setUserPolicyMode("inherit");
      setUserPolicyActionsText("");
      setBucketPolicyMode("inherit");
      setBucketPolicyActionsText("");
      return;
    }
    const override = portalAccountSettings.portal_manager_override;
    const effective = portalAccountSettings.effective;
    setOverridePortalKey(resolveTriState(override.allow_portal_key));
    setOverridePortalBucketCreate(resolveTriState(override.allow_portal_user_bucket_create));

    const bucketDefaultsOverride = override.bucket_defaults;
    setBucketVersioningOverride(resolveTriState(bucketDefaultsOverride?.versioning));
    setBucketLifecycleOverride(resolveTriState(bucketDefaultsOverride?.enable_lifecycle));
    setBucketCorsOverride(resolveTriState(bucketDefaultsOverride?.enable_cors));
    if (bucketDefaultsOverride && bucketDefaultsOverride.cors_allowed_origins != null) {
      setBucketCorsOriginsOverride(true);
      setBucketCorsOriginsText(bucketDefaultsOverride.cors_allowed_origins.join("\n"));
    } else {
      setBucketCorsOriginsOverride(false);
      setBucketCorsOriginsText((effective.bucket_defaults.cors_allowed_origins || []).join("\n"));
    }

    const managerOverride = override.iam_group_manager_policy;
    const managerHasActions = hasOwn(managerOverride as Record<string, unknown> | null, "actions");
    setManagerPolicyMode(managerHasActions ? "actions" : "inherit");
    setManagerPolicyActionsText((managerOverride?.actions ?? (effective.iam_group_manager_policy.actions || [])).join("\n"));

    const userOverride = override.iam_group_user_policy;
    const userHasActions = hasOwn(userOverride as Record<string, unknown> | null, "actions");
    setUserPolicyMode(userHasActions ? "actions" : "inherit");
    setUserPolicyActionsText((userOverride?.actions ?? (effective.iam_group_user_policy.actions || [])).join("\n"));

    const bucketOverride = override.bucket_access_policy;
    const bucketHasActions = hasOwn(bucketOverride as Record<string, unknown> | null, "actions");
    setBucketPolicyMode(bucketHasActions ? "actions" : "inherit");
    setBucketPolicyActionsText((bucketOverride?.actions ?? (effective.bucket_access_policy.actions || [])).join("\n"));
  }, [portalAccountSettings]);

  const handleSavePortalOverrides = async () => {
    if (!accountIdForApi || !portalAccountSettings || portalSettingsSaving) return;
    setPortalSettingsSaving(true);
    setPortalSettingsError(null);
    setPortalSettingsMessage(null);

    const payload: PortalAccountSettings["portal_manager_override"] = {};
    const allowPortalKeyValue = toOverrideValue(overridePortalKey);
    if (allowPortalKeyValue !== undefined) {
      payload.allow_portal_key = allowPortalKeyValue;
    }
    const allowBucketCreateValue = toOverrideValue(overridePortalBucketCreate);
    if (allowBucketCreateValue !== undefined) {
      payload.allow_portal_user_bucket_create = allowBucketCreateValue;
    }

    const bucketDefaults: NonNullable<PortalAccountSettings["portal_manager_override"]["bucket_defaults"]> = {};
    const versioningValue = toOverrideValue(bucketVersioningOverride);
    if (versioningValue !== undefined) {
      bucketDefaults.versioning = versioningValue;
    }
    const lifecycleValue = toOverrideValue(bucketLifecycleOverride);
    if (lifecycleValue !== undefined) {
      bucketDefaults.enable_lifecycle = lifecycleValue;
    }
    const corsValue = toOverrideValue(bucketCorsOverride);
    if (corsValue !== undefined) {
      bucketDefaults.enable_cors = corsValue;
    }
    if (bucketCorsOriginsOverride) {
      bucketDefaults.cors_allowed_origins = normalizeListInput(bucketCorsOriginsText);
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

    try {
      const updated = await updatePortalAccountSettings(accountIdForApi, payload);
      setPortalAccountSettings(updated);
      setPortalSettingsMessage("Portal settings updated.");
    } catch (err) {
      console.error(err);
      setPortalSettingsError("Unable to save portal settings.");
    } finally {
      setPortalSettingsSaving(false);
    }
  };

  const handleResetPortalOverrides = async () => {
    if (!accountIdForApi || portalSettingsSaving) return;
    if (!confirmAction("Reset portal overrides for this account?")) return;
    setPortalSettingsSaving(true);
    setPortalSettingsError(null);
    setPortalSettingsMessage(null);
    try {
      const updated = await updatePortalAccountSettings(accountIdForApi, {});
      setPortalAccountSettings(updated);
      setPortalSettingsMessage("Portal overrides reset.");
    } catch (err) {
      console.error(err);
      setPortalSettingsError("Unable to reset overrides.");
    } finally {
      setPortalSettingsSaving(false);
    }
  };

  const pageDescription = selectedAccount
    ? `Configure portal settings for ${accountName}.`
    : "Configure portal settings.";

  const headerActions = [{ label: "Back to portal", to: "/portal", variant: "ghost" as const }];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Portal settings"
        description={pageDescription}
        breadcrumbs={[{ label: "Portal", to: "/portal" }, { label: "Settings" }]}
        actions={headerActions}
      />

      {accountLoading && <PageBanner tone="info">Loading portal context...</PageBanner>}
      {accountError && <PageBanner tone="error">{accountError}</PageBanner>}
      {!accountLoading && !hasAccountContext && (
        <PageBanner tone="warning">Select an account in the top bar to continue.</PageBanner>
      )}
      {stateError && <PageBanner tone="error">{stateError}</PageBanner>}
      {!stateLoading && !stateError && hasAccountContext && !canManagePortalUsers && (
        <PageBanner tone="warning">Access restricted to portal managers.</PageBanner>
      )}

      {hasAccountContext && canManagePortalUsers && (
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-4 py-4 dark:border-slate-800">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">Portal settings</p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Overrides of global settings for this account.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleResetPortalOverrides}
                  disabled={!portalAccountSettings || portalSettingsSaving}
                  className="rounded-md border border-slate-200 px-3 py-2 ui-caption font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={handleSavePortalOverrides}
                  disabled={!portalAccountSettings || portalSettingsSaving}
                  className="rounded-md bg-primary px-3 py-2 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
                >
                  {portalSettingsSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
          <div className="px-4 py-4">
            {portalSettingsError && <PageBanner tone="error">{portalSettingsError}</PageBanner>}
            {portalSettingsMessage && <PageBanner tone="success">{portalSettingsMessage}</PageBanner>}
            {!portalSettingsError && portalSettingsLoading && <PageBanner tone="info">Loading settings...</PageBanner>}
            {hasAdminOverrides && (
              <PageBanner tone="warning">Some settings are locked by the admin.</PageBanner>
            )}
            {portalAccountSettings && effectivePortalSettings && overridePolicy && (
              <div className="space-y-4">
                <PortalSettingsSection title="UI" layout="grid">
                  <PortalSettingsItem
                    title="Portal key"
                    description="Show the active portal key in the portal."
                    action={
                      <div className="flex flex-col items-end gap-2">
                        <PortalSettingsSwitch
                          checked={portalKeyEnabled}
                          disabled={
                            portalSettingsLoading ||
                            portalSettingsSaving ||
                            overridePortalKey === "inherit" ||
                            !overridePolicy.allow_portal_key ||
                            adminOverride?.allow_portal_key != null
                          }
                          ariaLabel="Toggle portal key"
                          onChange={(value) => setOverridePortalKey(value ? "enabled" : "disabled")}
                        />
                        <label className="inline-flex items-center gap-2 ui-caption font-semibold text-slate-700 dark:text-slate-200">
                          <span>Inherit</span>
                          <input
                            type="checkbox"
                            checked={overridePortalKey === "inherit"}
                            onChange={(e) =>
                              setOverridePortalKey(
                                e.target.checked ? "inherit" : portalKeyEnabled ? "enabled" : "disabled"
                              )
                            }
                            className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                            disabled={
                              portalSettingsLoading ||
                              portalSettingsSaving ||
                              !overridePolicy.allow_portal_key ||
                              adminOverride?.allow_portal_key != null
                            }
                          />
                        </label>
                      </div>
                    }
                  >
                    {!overridePolicy.allow_portal_key && (
                      <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">Override disabled by admin.</p>
                    )}
                    {adminOverride?.allow_portal_key != null && (
                      <p className="mt-2 ui-caption text-amber-600 dark:text-amber-300">Locked by admin.</p>
                    )}
                  </PortalSettingsItem>
                  <PortalSettingsItem
                    title="Bucket creation"
                    description="Allow bucket creation from the portal."
                    action={
                      <div className="flex flex-col items-end gap-2">
                        <PortalSettingsSwitch
                          checked={portalBucketCreateEnabled}
                          disabled={
                            portalSettingsLoading ||
                            portalSettingsSaving ||
                            overridePortalBucketCreate === "inherit" ||
                            !overridePolicy.allow_portal_user_bucket_create ||
                            adminOverride?.allow_portal_user_bucket_create != null
                          }
                          ariaLabel="Toggle bucket creation for portal users"
                          onChange={(value) => setOverridePortalBucketCreate(value ? "enabled" : "disabled")}
                        />
                        <label className="inline-flex items-center gap-2 ui-caption font-semibold text-slate-700 dark:text-slate-200">
                          <span>Inherit</span>
                          <input
                            type="checkbox"
                            checked={overridePortalBucketCreate === "inherit"}
                            onChange={(e) =>
                              setOverridePortalBucketCreate(
                                e.target.checked ? "inherit" : portalBucketCreateEnabled ? "enabled" : "disabled"
                              )
                            }
                            className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                            disabled={
                              portalSettingsLoading ||
                              portalSettingsSaving ||
                              !overridePolicy.allow_portal_user_bucket_create ||
                              adminOverride?.allow_portal_user_bucket_create != null
                            }
                          />
                        </label>
                      </div>
                    }
                  >
                    {!overridePolicy.allow_portal_user_bucket_create && (
                      <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">Override disabled by admin.</p>
                    )}
                    {adminOverride?.allow_portal_user_bucket_create != null && (
                      <p className="mt-2 ui-caption text-amber-600 dark:text-amber-300">Locked by admin.</p>
                    )}
                  </PortalSettingsItem>
                </PortalSettingsSection>

                <PortalSettingsSection title="IAM POLICIES" layout="stack">
                  <PortalSettingsItem
                    title="Policy portal-manager"
                    description="Actions granted to the portal-manager IAM group."
                    action={
                      <label className="inline-flex items-center gap-2 ui-caption font-semibold text-slate-700 dark:text-slate-200">
                        <span>Inherit</span>
                        <input
                          type="checkbox"
                          checked={managerPolicyMode === "inherit"}
                          onChange={(e) => {
                            const inherited = e.target.checked;
                            setManagerPolicyMode(inherited ? "inherit" : "actions");
                            if (!inherited && !managerPolicyActionsText) {
                              setManagerPolicyActionsText(
                                (effectivePortalSettings.iam_group_manager_policy.actions || []).join("\n")
                              );
                            }
                          }}
                          className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                          disabled={
                            portalSettingsLoading ||
                            portalSettingsSaving ||
                            !overridePolicy.iam_group_manager_policy.actions ||
                            hasOwn(adminOverride?.iam_group_manager_policy as Record<string, unknown> | null, "actions") ||
                            hasOwn(adminOverride?.iam_group_manager_policy as Record<string, unknown> | null, "advanced_policy")
                          }
                        />
                      </label>
                    }
                  >
                    <textarea
                      value={managerPolicyActionsText}
                      onChange={(e) => setManagerPolicyActionsText(e.target.value)}
                      className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      rows={4}
                      disabled={
                        managerPolicyMode === "inherit" ||
                        portalSettingsLoading ||
                        portalSettingsSaving ||
                        !overridePolicy.iam_group_manager_policy.actions ||
                        hasOwn(adminOverride?.iam_group_manager_policy as Record<string, unknown> | null, "actions") ||
                        hasOwn(adminOverride?.iam_group_manager_policy as Record<string, unknown> | null, "advanced_policy")
                      }
                    />
                    {!overridePolicy.iam_group_manager_policy.actions && (
                      <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">Override disabled by admin.</p>
                    )}
                    {(hasOwn(adminOverride?.iam_group_manager_policy as Record<string, unknown> | null, "actions") ||
                      hasOwn(adminOverride?.iam_group_manager_policy as Record<string, unknown> | null, "advanced_policy")) && (
                      <p className="mt-2 ui-caption text-amber-600 dark:text-amber-300">Locked by admin.</p>
                    )}
                  </PortalSettingsItem>

                  <PortalSettingsItem
                    title="Policy portal-user"
                    description="Actions granted to the portal-user IAM group."
                    action={
                      <label className="inline-flex items-center gap-2 ui-caption font-semibold text-slate-700 dark:text-slate-200">
                        <span>Inherit</span>
                        <input
                          type="checkbox"
                          checked={userPolicyMode === "inherit"}
                          onChange={(e) => {
                            const inherited = e.target.checked;
                            setUserPolicyMode(inherited ? "inherit" : "actions");
                            if (!inherited && !userPolicyActionsText) {
                              setUserPolicyActionsText(
                                (effectivePortalSettings.iam_group_user_policy.actions || []).join("\n")
                              );
                            }
                          }}
                          className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                          disabled={
                            portalSettingsLoading ||
                            portalSettingsSaving ||
                            !overridePolicy.iam_group_user_policy.actions ||
                            hasOwn(adminOverride?.iam_group_user_policy as Record<string, unknown> | null, "actions") ||
                            hasOwn(adminOverride?.iam_group_user_policy as Record<string, unknown> | null, "advanced_policy")
                          }
                        />
                      </label>
                    }
                  >
                    <textarea
                      value={userPolicyActionsText}
                      onChange={(e) => setUserPolicyActionsText(e.target.value)}
                      className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      rows={4}
                      disabled={
                        userPolicyMode === "inherit" ||
                        portalSettingsLoading ||
                        portalSettingsSaving ||
                        !overridePolicy.iam_group_user_policy.actions ||
                        hasOwn(adminOverride?.iam_group_user_policy as Record<string, unknown> | null, "actions") ||
                        hasOwn(adminOverride?.iam_group_user_policy as Record<string, unknown> | null, "advanced_policy")
                      }
                    />
                    {!overridePolicy.iam_group_user_policy.actions && (
                      <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">Override disabled by admin.</p>
                    )}
                    {(hasOwn(adminOverride?.iam_group_user_policy as Record<string, unknown> | null, "actions") ||
                      hasOwn(adminOverride?.iam_group_user_policy as Record<string, unknown> | null, "advanced_policy")) && (
                      <p className="mt-2 ui-caption text-amber-600 dark:text-amber-300">Locked by admin.</p>
                    )}
                  </PortalSettingsItem>

                  <PortalSettingsItem
                    title="Policy bucket access"
                    description="Actions applied when granting bucket access."
                    action={
                      <label className="inline-flex items-center gap-2 ui-caption font-semibold text-slate-700 dark:text-slate-200">
                        <span>Inherit</span>
                        <input
                          type="checkbox"
                          checked={bucketPolicyMode === "inherit"}
                          onChange={(e) => {
                            const inherited = e.target.checked;
                            setBucketPolicyMode(inherited ? "inherit" : "actions");
                            if (!inherited && !bucketPolicyActionsText) {
                              setBucketPolicyActionsText(
                                (effectivePortalSettings.bucket_access_policy.actions || []).join("\n")
                              );
                            }
                          }}
                          className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                          disabled={
                            portalSettingsLoading ||
                            portalSettingsSaving ||
                            !overridePolicy.bucket_access_policy.actions ||
                            hasOwn(adminOverride?.bucket_access_policy as Record<string, unknown> | null, "actions") ||
                            hasOwn(adminOverride?.bucket_access_policy as Record<string, unknown> | null, "advanced_policy")
                          }
                        />
                      </label>
                    }
                  >
                    <textarea
                      value={bucketPolicyActionsText}
                      onChange={(e) => setBucketPolicyActionsText(e.target.value)}
                      className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      rows={4}
                      disabled={
                        bucketPolicyMode === "inherit" ||
                        portalSettingsLoading ||
                        portalSettingsSaving ||
                        !overridePolicy.bucket_access_policy.actions ||
                        hasOwn(adminOverride?.bucket_access_policy as Record<string, unknown> | null, "actions") ||
                        hasOwn(adminOverride?.bucket_access_policy as Record<string, unknown> | null, "advanced_policy")
                      }
                    />
                    {!overridePolicy.bucket_access_policy.actions && (
                      <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">Override disabled by admin.</p>
                    )}
                    {(hasOwn(adminOverride?.bucket_access_policy as Record<string, unknown> | null, "actions") ||
                      hasOwn(adminOverride?.bucket_access_policy as Record<string, unknown> | null, "advanced_policy")) && (
                      <p className="mt-2 ui-caption text-amber-600 dark:text-amber-300">Locked by admin.</p>
                    )}
                  </PortalSettingsItem>
                </PortalSettingsSection>

                <PortalSettingsSection title="BUCKET DEFAULTS" layout="grid">
                  <PortalSettingsItem
                    title="Versioning"
                    description="Enable versioning by default."
                    action={
                      <div className="flex flex-col items-end gap-2">
                        <PortalSettingsSwitch
                          checked={bucketVersioningEnabled}
                          disabled={
                            portalSettingsLoading ||
                            portalSettingsSaving ||
                            bucketVersioningOverride === "inherit" ||
                            !overridePolicy.bucket_defaults.versioning ||
                            adminOverride?.bucket_defaults?.versioning != null
                          }
                          ariaLabel="Toggle default versioning"
                          onChange={(value) => setBucketVersioningOverride(value ? "enabled" : "disabled")}
                        />
                        <label className="inline-flex items-center gap-2 ui-caption font-semibold text-slate-700 dark:text-slate-200">
                          <span>Inherit</span>
                          <input
                            type="checkbox"
                            checked={bucketVersioningOverride === "inherit"}
                            onChange={(e) =>
                              setBucketVersioningOverride(
                                e.target.checked ? "inherit" : bucketVersioningEnabled ? "enabled" : "disabled"
                              )
                            }
                            className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                            disabled={
                              portalSettingsLoading ||
                              portalSettingsSaving ||
                              !overridePolicy.bucket_defaults.versioning ||
                              adminOverride?.bucket_defaults?.versioning != null
                            }
                          />
                        </label>
                      </div>
                    }
                  >
                    {!overridePolicy.bucket_defaults.versioning && (
                      <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">Override disabled by admin.</p>
                    )}
                    {adminOverride?.bucket_defaults?.versioning != null && (
                      <p className="mt-2 ui-caption text-amber-600 dark:text-amber-300">Locked by admin.</p>
                    )}
                  </PortalSettingsItem>
                  <PortalSettingsItem
                    title="Lifecycle"
                    description="Apply lifecycle policy by default."
                    action={
                      <div className="flex flex-col items-end gap-2">
                        <PortalSettingsSwitch
                          checked={bucketLifecycleEnabled}
                          disabled={
                            portalSettingsLoading ||
                            portalSettingsSaving ||
                            bucketLifecycleOverride === "inherit" ||
                            !overridePolicy.bucket_defaults.enable_lifecycle ||
                            adminOverride?.bucket_defaults?.enable_lifecycle != null
                          }
                          ariaLabel="Toggle default lifecycle"
                          onChange={(value) => setBucketLifecycleOverride(value ? "enabled" : "disabled")}
                        />
                        <label className="inline-flex items-center gap-2 ui-caption font-semibold text-slate-700 dark:text-slate-200">
                          <span>Inherit</span>
                          <input
                            type="checkbox"
                            checked={bucketLifecycleOverride === "inherit"}
                            onChange={(e) =>
                              setBucketLifecycleOverride(
                                e.target.checked ? "inherit" : bucketLifecycleEnabled ? "enabled" : "disabled"
                              )
                            }
                            className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                            disabled={
                              portalSettingsLoading ||
                              portalSettingsSaving ||
                              !overridePolicy.bucket_defaults.enable_lifecycle ||
                              adminOverride?.bucket_defaults?.enable_lifecycle != null
                            }
                          />
                        </label>
                      </div>
                    }
                  >
                    {!overridePolicy.bucket_defaults.enable_lifecycle && (
                      <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">Override disabled by admin.</p>
                    )}
                    {adminOverride?.bucket_defaults?.enable_lifecycle != null && (
                      <p className="mt-2 ui-caption text-amber-600 dark:text-amber-300">Locked by admin.</p>
                    )}
                  </PortalSettingsItem>
                  <PortalSettingsItem
                    title="CORS"
                    description="Enable CORS by default."
                    action={
                      <div className="flex flex-col items-end gap-2">
                        <PortalSettingsSwitch
                          checked={bucketCorsEnabled}
                          disabled={
                            portalSettingsLoading ||
                            portalSettingsSaving ||
                            bucketCorsOverride === "inherit" ||
                            !overridePolicy.bucket_defaults.enable_cors ||
                            adminOverride?.bucket_defaults?.enable_cors != null
                          }
                          ariaLabel="Toggle default CORS"
                          onChange={(value) => setBucketCorsOverride(value ? "enabled" : "disabled")}
                        />
                        <label className="inline-flex items-center gap-2 ui-caption font-semibold text-slate-700 dark:text-slate-200">
                          <span>Inherit</span>
                          <input
                            type="checkbox"
                            checked={bucketCorsOverride === "inherit"}
                            onChange={(e) =>
                              setBucketCorsOverride(
                                e.target.checked ? "inherit" : bucketCorsEnabled ? "enabled" : "disabled"
                              )
                            }
                            className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                            disabled={
                              portalSettingsLoading ||
                              portalSettingsSaving ||
                              !overridePolicy.bucket_defaults.enable_cors ||
                              adminOverride?.bucket_defaults?.enable_cors != null
                            }
                          />
                        </label>
                      </div>
                    }
                  >
                    {!overridePolicy.bucket_defaults.enable_cors && (
                      <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">Override disabled by admin.</p>
                    )}
                    {adminOverride?.bucket_defaults?.enable_cors != null && (
                      <p className="mt-2 ui-caption text-amber-600 dark:text-amber-300">Locked by admin.</p>
                    )}
                  </PortalSettingsItem>
                  <PortalSettingsItem
                    title="CORS origins"
                    description="One URL per line for the CORS rule."
                    className="md:col-span-2"
                    action={
                      <label className="inline-flex items-center gap-2 ui-caption font-semibold text-slate-700 dark:text-slate-200">
                        <span>Inherit</span>
                        <input
                          type="checkbox"
                          checked={!bucketCorsOriginsOverride}
                          onChange={(e) => {
                            const inherited = e.target.checked;
                            setBucketCorsOriginsOverride(!inherited);
                            if (inherited) {
                              setBucketCorsOriginsText(
                                (effectivePortalSettings.bucket_defaults.cors_allowed_origins || []).join("\n")
                              );
                            }
                          }}
                          className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                          disabled={
                            portalSettingsLoading ||
                            portalSettingsSaving ||
                            !overridePolicy.bucket_defaults.cors_allowed_origins ||
                            adminOverride?.bucket_defaults?.cors_allowed_origins != null
                          }
                        />
                      </label>
                    }
                  >
                    <textarea
                      value={bucketCorsOriginsText}
                      onChange={(e) => setBucketCorsOriginsText(e.target.value)}
                      className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      rows={3}
                      placeholder="https://portal.example.com"
                      disabled={
                        !bucketCorsOriginsOverride ||
                        portalSettingsLoading ||
                        portalSettingsSaving ||
                        !overridePolicy.bucket_defaults.cors_allowed_origins ||
                        adminOverride?.bucket_defaults?.cors_allowed_origins != null
                      }
                    />
                    {!overridePolicy.bucket_defaults.cors_allowed_origins && (
                      <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">Override disabled by admin.</p>
                    )}
                    {adminOverride?.bucket_defaults?.cors_allowed_origins != null && (
                      <p className="mt-2 ui-caption text-amber-600 dark:text-amber-300">Locked by admin.</p>
                    )}
                  </PortalSettingsItem>
                </PortalSettingsSection>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
