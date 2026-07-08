/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useEffect, useMemo, useState } from "react";
import { fetchCurrentUser, updateCurrentUser, type User, type UiPreferences } from "../../api/users";
import Modal from "../../components/Modal";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import PageTabs from "../../components/PageTabs";
import { UiLanguagePreference, useLanguage } from "../../components/language";
import { useTheme } from "../../components/theme";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import { cx, uiCardMutedClass, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { formatBytes } from "../../utils/format";
import { readStoredUser } from "../../utils/workspaces";
import { updateStoredUserProfile } from "../shared/profileStoredUser";
import { usePortalAccountContext } from "./PortalAccountContext";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

type SaveTarget = "profile" | "preferences" | "password" | null;
type SettingsTab = "profile" | "preferences" | "security" | "project";

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

type WorkspaceAccessLabel = "limited" | "manager" | "user";

function resolveWorkspaceAccess(user: User | null, selectedAccountId: string | null): WorkspaceAccessLabel {
  if (!user || !selectedAccountId) return "limited";
  const numericId = Number(selectedAccountId);
  const link = user.account_links?.find((item) => Number(item.account_id) === numericId);
  if (!link?.account_role || link.account_role === "portal_none") return "limited";
  if (link.account_role === "portal_manager") return "manager";
  if (link.account_role === "portal_user") return "user";
  return "limited";
}

function normalizeUiPreferences(value?: UiPreferences | null): UiPreferences {
  return {
    theme: value?.theme === "dark" || value?.theme === "light" ? value.theme : null,
    selected_portal_account_id: value?.selected_portal_account_id ?? null,
  };
}

export default function PortalSettingsPage() {
  const { t } = useI18n();
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
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
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
        if (!cancelled) setError(extractApiError(err, t({ en: "Unable to load your profile.", fr: "Impossible de charger votre profil.", de: "Ihr Profil kann nicht geladen werden." })));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAccountId, t, theme]);

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
      setMessage(t({ en: "Profile updated.", fr: "Profil mis à jour.", de: "Profil aktualisiert." }));
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, t({ en: "Unable to save your profile.", fr: "Impossible d'enregistrer votre profil.", de: "Ihr Profil kann nicht gespeichert werden." })));
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
      setMessage(t({ en: "Preferences updated.", fr: "Préférences mises à jour.", de: "Einstellungen aktualisiert." }));
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, t({ en: "Unable to save your preferences.", fr: "Impossible d'enregistrer vos préférences.", de: "Ihre Einstellungen können nicht gespeichert werden." })));
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
      setError(t({ en: "Enter your current password and a new password.", fr: "Saisissez votre mot de passe actuel et un nouveau mot de passe.", de: "Geben Sie Ihr aktuelles Passwort und ein neues Passwort ein." }));
      setSaving(null);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t({ en: "Password confirmation does not match.", fr: "La confirmation du mot de passe ne correspond pas.", de: "Die Passwortbestätigung stimmt nicht überein." }));
      setSaving(null);
      return;
    }
    try {
      await updateCurrentUser({ current_password: currentPassword, new_password: newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordDialogOpen(false);
      setMessage(t({ en: "Password updated.", fr: "Mot de passe mis à jour.", de: "Passwort aktualisiert." }));
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, t({ en: "Unable to update your password.", fr: "Impossible de mettre à jour votre mot de passe.", de: "Ihr Passwort kann nicht aktualisiert werden." })));
    } finally {
      setSaving(null);
    }
  };

  const closePasswordDialog = () => {
    if (saving === "password") return;
    setPasswordDialogOpen(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t({ en: "Settings", fr: "Paramètres", de: "Einstellungen" })}
        description={t({ en: "Manage your portal profile, security and personal defaults.", fr: "Gérez votre profil Portal, votre sécurité et vos préférences personnelles.", de: "Verwalten Sie Ihr Portal-Profil, Ihre Sicherheit und persönliche Vorgaben." })}
        breadcrumbs={portalBreadcrumbs({ label: t({ en: "Settings", fr: "Paramètres", de: "Einstellungen" }) })}
      />

      {loading || accountsLoading ? <PageBanner tone="info">{t({ en: "Loading settings...", fr: "Chargement des paramètres...", de: "Einstellungen werden geladen..." })}</PageBanner> : null}
      {message ? <PageBanner tone="success">{message}</PageBanner> : null}
      {error ? <PageBanner tone="warning">{error}</PageBanner> : null}

      <PageTabs
        tabs={[
          { id: "profile", label: t({ en: "Profile", fr: "Profil", de: "Profil" }) },
          { id: "preferences", label: t({ en: "Preferences", fr: "Préférences", de: "Einstellungen" }) },
          { id: "security", label: t({ en: "Security", fr: "Sécurité", de: "Sicherheit" }) },
          { id: "project", label: t({ en: "Project", fr: "Projet", de: "Projekt" }) },
        ]}
        activeTab={activeTab}
        onChange={(tabId) => setActiveTab(tabId as SettingsTab)}
        variant="bar"
      />

      {activeTab === "profile" ? (
        <form onSubmit={saveProfile}>
          <UiCard
            title={t({ en: "Profile", fr: "Profil", de: "Profil" })}
            description={t({
              en: "Choose the name collaborators see in this workspace.",
              fr: "Choisissez le nom que les collaborateurs voient dans cet espace de travail.",
              de: "Wählen Sie den Namen, den Mitwirkende in diesem Arbeitsbereich sehen.",
            })}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <UiInput
                label={t({ en: "Display name", fr: "Nom affiché", de: "Anzeigename" })}
                className="h-9"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                disabled={loading}
                autoComplete="name"
              />
              <UiInput
                label={t({ en: "Email", fr: "Email", de: "E-Mail" })}
                className="h-9"
                value={user?.email ?? storedUser?.email ?? ""}
                readOnly
              />
            </div>
            <div className="mt-4">
              <UiButton type="submit" disabled={saving === "profile" || loading} className="h-9 px-3 py-1.5">
                {saving === "profile" ? t({ en: "Saving...", fr: "Enregistrement...", de: "Wird gespeichert..." }) : t({ en: "Save profile", fr: "Enregistrer le profil", de: "Profil speichern" })}
              </UiButton>
            </div>
          </UiCard>
        </form>
      ) : null}

      {activeTab === "preferences" ? (
        <form onSubmit={savePreferences}>
          <UiCard
            title={t({ en: "Preferences", fr: "Préférences", de: "Einstellungen" })}
            description={t({
              en: "Set the language, theme and default project used when you open the Portal.",
              fr: "Définissez la langue, le thème et le projet par défaut utilisés à l'ouverture du Portal.",
              de: "Legen Sie Sprache, Design und Standardprojekt beim Öffnen des Portals fest.",
            })}
          >
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <UiSelect
                label={t({ en: "Language", fr: "Langue", de: "Sprache" })}
                className="h-9"
                value={languageDraft}
                onChange={(event) => setLanguageDraft(event.target.value as UiLanguagePreference)}
              >
                <option value="en">English</option>
                <option value="fr">Français</option>
                <option value="de">Deutsch</option>
                <option value="auto">{t({ en: "Auto", fr: "Auto", de: "Automatisch" })}</option>
              </UiSelect>
              <UiSelect
                label={t({ en: "Theme", fr: "Thème", de: "Design" })}
                className="h-9"
                value={themeDraft}
                onChange={(event) => setThemeDraft(event.target.value as "light" | "dark")}
              >
                <option value="light">{t({ en: "Light", fr: "Clair", de: "Hell" })}</option>
                <option value="dark">{t({ en: "Dark", fr: "Sombre", de: "Dunkel" })}</option>
              </UiSelect>
              <UiSelect
                label={t({ en: "Default project", fr: "Projet par défaut", de: "Standardprojekt" })}
                fieldClassName="md:col-span-2"
                className="h-9"
                value={defaultPortalAccountId}
                onChange={(event) => setDefaultPortalAccountId(event.target.value)}
                disabled={accounts.length === 0}
              >
                {accounts.length === 0 ? <option value="">{t({ en: "No project", fr: "Aucun projet", de: "Kein Projekt" })}</option> : null}
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </UiSelect>
            </div>
            <UiCheckboxField
              className="mt-4 flex rounded-md border border-[color:var(--ui-border)] px-3 py-2"
              checked={quotaAlertsEnabled}
              onChange={(event) => setQuotaAlertsEnabled(event.target.checked)}
            >
              <span className="ui-body text-[var(--ui-text)]">{t({ en: "Receive quota alert emails", fr: "Recevoir les emails d'alerte de quota", de: "E-Mails zu Quotenwarnungen erhalten" })}</span>
            </UiCheckboxField>
            <div className="mt-4">
              <UiButton type="submit" disabled={saving === "preferences" || loading} className="h-9 px-3 py-1.5">
                {saving === "preferences" ? t({ en: "Saving...", fr: "Enregistrement...", de: "Wird gespeichert..." }) : t({ en: "Save preferences", fr: "Enregistrer les préférences", de: "Einstellungen speichern" })}
              </UiButton>
            </div>
          </UiCard>
        </form>
      ) : null}

      {activeTab === "security" ? (
        <UiCard
          title={t({ en: "Security", fr: "Sécurité", de: "Sicherheit" })}
          description={t({
            en: "Keep sign-in changes focused and separate from the rest of your settings.",
            fr: "Gardez les changements de connexion séparés du reste de vos paramètres.",
            de: "Halten Sie Anmeldeänderungen vom Rest Ihrer Einstellungen getrennt.",
          })}
          actions={
            <UiButton
              type="button"
              disabled={!canChangePassword || saving === "password" || loading}
              onClick={() => {
                setError(null);
                setPasswordDialogOpen(true);
              }}
              className="h-9 px-3 py-1.5"
            >
              {t({ en: "Change password", fr: "Changer le mot de passe", de: "Passwort ändern" })}
            </UiButton>
          }
        >
          {!canChangePassword ? (
            <div className={cx(uiCardMutedClass, "p-3 text-xs font-semibold", uiMutedTextClass)}>
              {t({ en: "Password changes are managed by your sign-in provider.", fr: "Les changements de mot de passe sont gérés par votre fournisseur de connexion.", de: "Passwortänderungen werden von Ihrem Anmeldeanbieter verwaltet." })}
            </div>
          ) : (
            <p className={cx("ui-body", uiMutedTextClass)}>
              {t({
                en: "Open the password form only when you need it. Your current page stays clear while the change is in progress.",
                fr: "Ouvrez le formulaire de mot de passe uniquement quand vous en avez besoin. La page reste claire pendant le changement.",
                de: "Öffnen Sie das Passwortformular nur bei Bedarf. Die Seite bleibt während der Änderung übersichtlich.",
              })}
            </p>
          )}
        </UiCard>
      ) : null}

      {activeTab === "project" ? (
        <UiCard
          title={t({ en: "Project", fr: "Projet", de: "Projekt" })}
          description={t({
            en: "Read-only context for the project currently selected in the Portal.",
            fr: "Contexte en lecture seule pour le projet actuellement sélectionné dans le Portal.",
            de: "Schreibgeschützter Kontext für das aktuell im Portal ausgewählte Projekt.",
          })}
        >
          <dl className="grid gap-4 text-xs md:grid-cols-2 xl:grid-cols-3">
            <div>
              <dt className={labelClasses}>{t({ en: "Selected project", fr: "Projet sélectionné", de: "Ausgewähltes Projekt" })}</dt>
              <dd className={cx("mt-1 font-bold", uiTitleTextClass)}>{selectedAccount?.name ?? "-"}</dd>
            </div>
            <div>
              <dt className={labelClasses}>{t({ en: "Workspace access", fr: "Accès à l'espace de travail", de: "Arbeitsbereichszugriff" })}</dt>
              <dd className="mt-1">
                <UiBadge tone="primary">
                  {selectedWorkspaceAccess === "manager"
                    ? t({ en: "Manager", fr: "Gestionnaire", de: "Manager" })
                    : selectedWorkspaceAccess === "user"
                      ? t({ en: "User", fr: "Utilisateur", de: "Benutzer" })
                      : t({ en: "Limited access", fr: "Accès limité", de: "Eingeschränkter Zugriff" })}
                </UiBadge>
              </dd>
            </div>
            <div>
              <dt className={labelClasses}>{t({ en: "Storage service", fr: "Service de stockage", de: "Speicherdienst" })}</dt>
              <dd className={cx("mt-1 break-words font-semibold", uiTitleTextClass)}>
                {selectedAccount?.storage_endpoint_name ?? selectedAccount?.storage_endpoint_url ?? "-"}
              </dd>
            </div>
            <div>
              <dt className={labelClasses}>{t({ en: "Storage Spaces", fr: "Espaces de stockage", de: "Speicherbereiche" })}</dt>
              <dd className={cx("mt-1 font-bold", uiTitleTextClass)}>
                {workspaceLoading
                  ? t({ en: "Loading...", fr: "Chargement...", de: "Wird geladen..." })
                  : t({ en: `${activeSpaces.length} active / ${workspace.spaces.length} total`, fr: `${activeSpaces.length} actifs / ${workspace.spaces.length} au total`, de: `${activeSpaces.length} aktiv / ${workspace.spaces.length} gesamt` })}
              </dd>
            </div>
            <div>
              <dt className={labelClasses}>{t({ en: "Storage used", fr: "Stockage utilisé", de: "Genutzter Speicher" })}</dt>
              <dd className={cx("mt-1 font-bold", uiTitleTextClass)}>{formatBytes(workspace.usedBytes)}</dd>
            </div>
          </dl>
        </UiCard>
      ) : null}

      {passwordDialogOpen ? (
        <Modal
          title={t({ en: "Change password", fr: "Changer le mot de passe", de: "Passwort ändern" })}
          onClose={closePasswordDialog}
          closeOnBackdropClick={saving !== "password"}
          closeOnEscape={saving !== "password"}
        >
          <form onSubmit={savePassword} className="space-y-4">
            <UiInput
              label={t({ en: "Current password", fr: "Mot de passe actuel", de: "Aktuelles Passwort" })}
              className="h-9"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
            />
            <UiInput
              label={t({ en: "New password", fr: "Nouveau mot de passe", de: "Neues Passwort" })}
              className="h-9"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
            />
            <UiInput
              label={t({ en: "Confirm password", fr: "Confirmer le mot de passe", de: "Passwort bestätigen" })}
              className="h-9"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
            />
            <div className="flex flex-wrap justify-end gap-2">
              <UiButton type="button" variant="secondary" onClick={closePasswordDialog} disabled={saving === "password"}>
                {t({ en: "Cancel", fr: "Annuler", de: "Abbrechen" })}
              </UiButton>
              <UiButton
                type="submit"
                disabled={!canChangePassword || saving === "password" || loading}
                loading={saving === "password"}
              >
                {saving === "password" ? t({ en: "Updating...", fr: "Mise à jour...", de: "Wird aktualisiert..." }) : t({ en: "Update password", fr: "Mettre à jour le mot de passe", de: "Passwort aktualisieren" })}
              </UiButton>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
