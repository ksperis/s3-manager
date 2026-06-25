/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useEffect, useMemo, useState } from "react";
import { fetchCurrentUser, updateCurrentUser, type User, type UiPreferences } from "../../api/users";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import { UiLanguagePreference, useLanguage } from "../../components/language";
import { useTheme } from "../../components/theme";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import { cx, uiCardMutedClass, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { formatBytes } from "../../utils/format";
import { readStoredUser } from "../../utils/workspaces";
import { updateStoredUserProfile } from "../shared/profileStoredUser";
import { usePortalAccountContext } from "./PortalAccountContext";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

type SaveTarget = "profile" | "preferences" | "password" | null;

const inputClasses = "ui-control h-9 text-sm";
const labelClasses = "ui-caption font-semibold uppercase tracking-wide text-[var(--ui-text-muted)]";

function persistStoredUser(user: User) {
  if (typeof window === "undefined") return;
  updateStoredUserProfile(
    {
      fullName: user.full_name ?? null,
      displayName: user.display_name ?? user.full_name ?? null,
      uiLanguage: user.ui_language ?? null,
      uiPreferences: user.ui_preferences ?? {},
    },
    { createIfMissing: true }
  );
}

function resolveWorkspaceAccess(user: User | null, selectedAccountId: string | null): string {
  if (!user || !selectedAccountId) return "Limited access";
  const numericId = Number(selectedAccountId);
  const link = user.account_links?.find((item) => Number(item.account_id) === numericId);
  if (!link?.account_role || link.account_role === "portal_none") return "Limited access";
  if (link.account_role === "portal_manager") return "Manager";
  if (link.account_role === "portal_user") return "User";
  return "Limited access";
}

function normalizeUiPreferences(value?: UiPreferences | null): UiPreferences {
  return {
    theme: value?.theme === "dark" || value?.theme === "light" ? value.theme : null,
    selected_portal_account_id: value?.selected_portal_account_id ?? null,
  };
}

export default function PortalSettingsPage() {
  const { accounts, selectedAccount, selectedAccountId, setSelectedAccountId, loading: accountsLoading } = usePortalAccountContext();
  const { workspace, loading: workspaceLoading } = usePortalWorkspaceData();
  const { theme, setTheme } = useTheme();
  const { languagePreference, setLanguagePreference } = useLanguage();
  const storedUser = useMemo(() => readStoredUser(), []);
  const authType = storedUser?.authType ?? null;
  const canChangePassword = authType !== "s3_session" && authType !== "oidc";
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<SaveTarget>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [languageDraft, setLanguageDraft] = useState<UiLanguagePreference>(languagePreference);
  const [themeDraft, setThemeDraft] = useState<"light" | "dark">(theme);
  const [quotaAlertsEnabled, setQuotaAlertsEnabled] = useState(true);
  const [defaultPortalAccountId, setDefaultPortalAccountId] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const selectedWorkspaceAccess = useMemo(
    () => resolveWorkspaceAccess(user, selectedAccountId),
    [selectedAccountId, user]
  );
  const activeSpaces = workspace.spaces.filter((space) => space.status !== "Archived");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchCurrentUser()
      .then((currentUser) => {
        if (cancelled) return;
        const preferences = normalizeUiPreferences(currentUser.ui_preferences);
        setUser(currentUser);
        setFullName(currentUser.full_name ?? "");
        setLanguageDraft(currentUser.ui_language ?? "auto");
        setQuotaAlertsEnabled(currentUser.quota_alerts_enabled !== false);
        setThemeDraft(preferences.theme ?? theme);
        setDefaultPortalAccountId(preferences.selected_portal_account_id ?? selectedAccountId ?? "");
        persistStoredUser(currentUser);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setError(extractApiError(err, "Unable to load your profile."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAccountId, theme]);

  useEffect(() => {
    if (accounts.length === 0) {
      setDefaultPortalAccountId("");
      return;
    }
    setDefaultPortalAccountId((current) => {
      if (current && accounts.some((account) => account.id === current)) return current;
      const preferred = normalizeUiPreferences(user?.ui_preferences).selected_portal_account_id;
      if (preferred && accounts.some((account) => account.id === preferred)) return preferred;
      if (selectedAccountId && accounts.some((account) => account.id === selectedAccountId)) return selectedAccountId;
      return accounts[0].id;
    });
  }, [accounts, selectedAccountId, user?.ui_preferences]);

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setSaving("profile");
    setError(null);
    setMessage(null);
    try {
      const updated = await updateCurrentUser({ full_name: fullName.trim() || null });
      setUser(updated);
      setFullName(updated.full_name ?? "");
      persistStoredUser(updated);
      setMessage("Profile updated.");
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, "Unable to save your profile."));
    } finally {
      setSaving(null);
    }
  };

  const savePreferences = async (event: FormEvent) => {
    event.preventDefault();
    setSaving("preferences");
    setError(null);
    setMessage(null);
    const uiPreferences: UiPreferences = {
      theme: themeDraft,
      selected_portal_account_id: defaultPortalAccountId || null,
    };
    try {
      const updated = await updateCurrentUser({
        ui_language: languageDraft === "auto" ? null : languageDraft,
        quota_alerts_enabled: quotaAlertsEnabled,
        ui_preferences: uiPreferences,
      });
      setUser(updated);
      persistStoredUser(updated);
      setLanguagePreference(updated.ui_language ?? "auto");
      if (updated.ui_preferences?.theme === "light" || updated.ui_preferences?.theme === "dark") {
        setTheme(updated.ui_preferences.theme);
      }
      if (updated.ui_preferences?.selected_portal_account_id) {
        localStorage.setItem("selectedPortalAccountId", updated.ui_preferences.selected_portal_account_id);
        setSelectedAccountId(updated.ui_preferences.selected_portal_account_id);
      }
      setMessage("Preferences updated.");
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, "Unable to save your preferences."));
    } finally {
      setSaving(null);
    }
  };

  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!canChangePassword) return;
    setSaving("password");
    setError(null);
    setMessage(null);
    if (!currentPassword || !newPassword) {
      setError("Enter your current password and a new password.");
      setSaving(null);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Password confirmation does not match.");
      setSaving(null);
      return;
    }
    try {
      await updateCurrentUser({ current_password: currentPassword, new_password: newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage("Password updated.");
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, "Unable to update your password."));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Settings"
        description="Manage your portal profile, security and personal defaults."
        breadcrumbs={portalBreadcrumbs({ label: "Settings" })}
      />

      {loading || accountsLoading ? <PageBanner tone="info">Loading settings...</PageBanner> : null}
      {message ? <PageBanner tone="success">{message}</PageBanner> : null}
      {error ? <PageBanner tone="warning">{error}</PageBanner> : null}

      <section className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <form onSubmit={saveProfile}>
            <UiCard title="Profile">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className={labelClasses}>Display name</span>
                  <input
                    className={inputClasses}
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    disabled={loading}
                    autoComplete="name"
                  />
                </label>
                <label className="block">
                  <span className={labelClasses}>Email</span>
                  <input className={inputClasses} value={user?.email ?? storedUser?.email ?? ""} readOnly />
                </label>
              </div>
              <div className="mt-4">
                <UiButton type="submit" disabled={saving === "profile" || loading} className="h-9 px-3 py-1.5">
                  {saving === "profile" ? "Saving..." : "Save profile"}
                </UiButton>
              </div>
            </UiCard>
          </form>

          <form onSubmit={savePreferences}>
            <UiCard title="Preferences">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <label className="block">
                  <span className={labelClasses}>Language</span>
                  <select
                    className={inputClasses}
                    value={languageDraft}
                    onChange={(event) => setLanguageDraft(event.target.value as UiLanguagePreference)}
                  >
                    <option value="en">English</option>
                    <option value="fr">French</option>
                    <option value="de">Deutsch</option>
                    <option value="auto">Auto</option>
                  </select>
                </label>
                <label className="block">
                  <span className={labelClasses}>Theme</span>
                  <select
                    className={inputClasses}
                    value={themeDraft}
                    onChange={(event) => setThemeDraft(event.target.value as "light" | "dark")}
                  >
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </label>
                <label className="block md:col-span-2">
                  <span className={labelClasses}>Default portal account</span>
                  <select
                    className={inputClasses}
                    value={defaultPortalAccountId}
                    onChange={(event) => setDefaultPortalAccountId(event.target.value)}
                    disabled={accounts.length === 0}
                  >
                    {accounts.length === 0 ? <option value="">No portal account</option> : null}
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="mt-4 flex items-center gap-2 rounded-md border border-[color:var(--ui-border)] px-3 py-2">
                <input
                  type="checkbox"
                  checked={quotaAlertsEnabled}
                  onChange={(event) => setQuotaAlertsEnabled(event.target.checked)}
                />
                <span className="ui-body text-[var(--ui-text)]">Receive quota alert emails</span>
              </label>
              <div className="mt-4">
                <UiButton type="submit" disabled={saving === "preferences" || loading} className="h-9 px-3 py-1.5">
                  {saving === "preferences" ? "Saving..." : "Save preferences"}
                </UiButton>
              </div>
            </UiCard>
          </form>

          <form onSubmit={savePassword}>
            <UiCard title="Security">
              {!canChangePassword ? (
                <div className={cx(uiCardMutedClass, "p-3 text-xs font-semibold", uiMutedTextClass)}>
                  Password changes are managed by your sign-in provider.
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-3">
                  <label className="block">
                    <span className={labelClasses}>Current password</span>
                    <input
                      className={inputClasses}
                      type="password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      autoComplete="current-password"
                    />
                  </label>
                  <label className="block">
                    <span className={labelClasses}>New password</span>
                    <input
                      className={inputClasses}
                      type="password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      autoComplete="new-password"
                    />
                  </label>
                  <label className="block">
                    <span className={labelClasses}>Confirm password</span>
                    <input
                      className={inputClasses}
                      type="password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      autoComplete="new-password"
                    />
                  </label>
                </div>
              )}
              <div className="mt-4">
                <UiButton
                  type="submit"
                  disabled={!canChangePassword || saving === "password" || loading}
                  className="h-9 px-3 py-1.5"
                >
                  {saving === "password" ? "Updating..." : "Change password"}
                </UiButton>
              </div>
            </UiCard>
          </form>
        </div>

        <aside className="space-y-4">
          <UiCard title="Portal account">
            <dl className="space-y-3 text-xs">
              <div>
                <dt className={labelClasses}>Selected account</dt>
                <dd className={cx("mt-1 font-bold", uiTitleTextClass)}>{selectedAccount?.name ?? "-"}</dd>
              </div>
              <div>
                <dt className={labelClasses}>Workspace access</dt>
                <dd className="mt-1"><UiBadge tone="primary">{selectedWorkspaceAccess}</UiBadge></dd>
              </div>
              <div>
                <dt className={labelClasses}>Storage service</dt>
                <dd className={cx("mt-1 break-words font-semibold", uiTitleTextClass)}>
                  {selectedAccount?.storage_endpoint_name ?? selectedAccount?.storage_endpoint_url ?? "-"}
                </dd>
              </div>
              <div>
                <dt className={labelClasses}>Storage Spaces</dt>
                <dd className={cx("mt-1 font-bold", uiTitleTextClass)}>
                  {workspaceLoading ? "Loading..." : `${activeSpaces.length} active / ${workspace.spaces.length} total`}
                </dd>
              </div>
              <div>
                <dt className={labelClasses}>Storage used</dt>
                <dd className={cx("mt-1 font-bold", uiTitleTextClass)}>{formatBytes(workspace.usedBytes)}</dd>
              </div>
            </dl>
          </UiCard>
        </aside>
      </section>
    </div>
  );
}
