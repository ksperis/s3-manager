/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useEffect, useMemo, useState } from "react";
import axios from "axios";
import Modal from "../../components/Modal";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import PaginationControls from "../../components/PaginationControls";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { toolbarCompactInputClasses } from "../../components/toolbarControlClasses";
import { useTheme } from "../../components/theme";
import { UiLanguagePreference, useLanguage } from "../../components/language";
import { fetchCurrentUser, updateCurrentUser } from "../../api/users";
import {
  S3Connection,
  createConnection,
  deleteConnection,
  listConnections,
  rotateConnectionCredentials,
  updateConnection,
} from "../../api/connections";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import {
  WORKSPACE_STORAGE_KEY,
  type SessionUser,
  type WorkspaceId,
  readStoredUser,
  readStoredWorkspaceId,
  resolveAvailableWorkspacesWithFlags,
} from "../../utils/workspaces";

const defaultCreateConnectionForm = {
  name: "",
  provider_hint: "",
  endpoint_url: "",
  region: "",
  access_key_id: "",
  secret_access_key: "",
  force_path_style: false,
  verify_tls: true,
};

type ConnectionDraft = {
  name: string;
  provider_hint: string;
  endpoint_url: string;
  region: string;
  force_path_style: boolean;
  verify_tls: boolean;
  storage_endpoint_id?: number | null;
};

type ConnectionCredentialDraft = {
  access_key_id: string;
  secret_access_key: string;
};

function persistStoredUser(values: { fullName?: string | null; uiLanguage?: "en" | "fr" | "de" | null }) {
  if (typeof window === "undefined") return;
  const raw = localStorage.getItem("user");
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if ("fullName" in values) {
      parsed.full_name = values.fullName ?? null;
      parsed.display_name = values.fullName ?? null;
    }
    if ("uiLanguage" in values) {
      parsed.ui_language = values.uiLanguage ?? null;
    }
    localStorage.setItem("user", JSON.stringify(parsed));
  } catch (error) {
    console.warn("Unable to update stored user profile", error);
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
  }
  return fallback;
}

function buildConnectionDraft(connection: S3Connection): ConnectionDraft {
  return {
    name: connection.name ?? "",
    provider_hint: connection.provider_hint ?? "",
    endpoint_url: connection.endpoint_url ?? "",
    region: connection.region ?? "",
    force_path_style: Boolean(connection.force_path_style),
    verify_tls: connection.verify_tls !== false,
    storage_endpoint_id: connection.storage_endpoint_id ?? null,
  };
}

function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function parseConnectionSortDate(connection: S3Connection): number {
  const raw = connection.updated_at ?? connection.created_at;
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

type ProfilePageProps = {
  showPageHeader?: boolean;
  showSettingsCards?: boolean;
  showConnectionsSection?: boolean;
};

export default function ProfilePage({
  showPageHeader = true,
  showSettingsCards = true,
  showConnectionsSection = false,
}: ProfilePageProps) {
  const storedUser = useMemo<SessionUser | null>(() => readStoredUser(), []);
  const authType = storedUser?.authType ?? null;
  const isRgwSession = authType === "rgw_session";
  const canChangePassword = authType !== "rgw_session" && authType !== "oidc";
  const { generalSettings } = useGeneralSettings();
  const { theme, setTheme } = useTheme();
  const { languagePreference, setLanguagePreference } = useLanguage();
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [fullName, setFullName] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [preferencesMessage, setPreferencesMessage] = useState<string | null>(null);
  const [preferencesTheme, setPreferencesTheme] = useState<"light" | "dark">(theme);
  const [preferencesLanguage, setPreferencesLanguage] = useState<UiLanguagePreference>(languagePreference);
  const [connections, setConnections] = useState<S3Connection[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);
  const [connectionsMessage, setConnectionsMessage] = useState<string | null>(null);
  const [showCreateConnectionModal, setShowCreateConnectionModal] = useState(false);
  const [creatingConnection, setCreatingConnection] = useState(false);
  const [savingConnectionBusyId, setSavingConnectionBusyId] = useState<number | null>(null);
  const [rotatingConnectionBusyId, setRotatingConnectionBusyId] = useState<number | null>(null);
  const [deletingConnectionBusyId, setDeletingConnectionBusyId] = useState<number | null>(null);
  const [editingConnectionId, setEditingConnectionId] = useState<number | null>(null);
  const [rotatingCredentialsConnectionId, setRotatingCredentialsConnectionId] = useState<number | null>(null);
  const [createConnectionForm, setCreateConnectionForm] = useState(defaultCreateConnectionForm);
  const [connectionDrafts, setConnectionDrafts] = useState<Record<number, ConnectionDraft>>({});
  const [connectionCredentialDrafts, setConnectionCredentialDrafts] = useState<Record<number, ConnectionCredentialDraft>>(
    {}
  );
  const [connectionsFilter, setConnectionsFilter] = useState("");
  const [connectionsPage, setConnectionsPage] = useState(1);
  const [connectionsPageSize, setConnectionsPageSize] = useState(10);
  const availableWorkspaces = useMemo(
    () => resolveAvailableWorkspacesWithFlags(storedUser, generalSettings),
    [generalSettings, storedUser]
  );
  const [preferredWorkspace, setPreferredWorkspace] = useState<WorkspaceId | null>(() => readStoredWorkspaceId());
  const canManagePrivateConnections =
    !isRgwSession &&
    (storedUser?.role === "ui_admin" || (storedUser?.role === "ui_user" && generalSettings.allow_user_private_connections));

  const sortedConnections = useMemo(
    () =>
      [...connections].sort((a, b) => {
        const dateDiff = parseConnectionSortDate(b) - parseConnectionSortDate(a);
        if (dateDiff !== 0) return dateDiff;
        return b.id - a.id;
      }),
    [connections]
  );

  const filteredConnections = useMemo(() => {
    const query = connectionsFilter.trim().toLowerCase();
    if (!query) return sortedConnections;
    return sortedConnections.filter((connection) => {
      const values = [
        connection.name,
        connection.endpoint_url,
        connection.region,
        connection.provider_hint,
        connection.access_key_id,
      ];
      return values.some((value) => String(value ?? "").toLowerCase().includes(query));
    });
  }, [connectionsFilter, sortedConnections]);

  const pagedConnections = useMemo(() => {
    const start = (connectionsPage - 1) * connectionsPageSize;
    return filteredConnections.slice(start, start + connectionsPageSize);
  }, [connectionsPage, connectionsPageSize, filteredConnections]);

  const editingConnection = useMemo(
    () =>
      editingConnectionId == null ? null : connections.find((connection) => connection.id === editingConnectionId) ?? null,
    [connections, editingConnectionId]
  );
  const rotatingConnection = useMemo(
    () =>
      rotatingCredentialsConnectionId == null
        ? null
        : connections.find((connection) => connection.id === rotatingCredentialsConnectionId) ?? null,
    [connections, rotatingCredentialsConnectionId]
  );

  useEffect(() => {
    setPreferencesTheme(theme);
  }, [theme]);

  useEffect(() => {
    setPreferencesLanguage(languagePreference);
  }, [languagePreference]);

  useEffect(() => {
    if (!showSettingsCards) return;
    if (availableWorkspaces.length === 0) {
      setPreferredWorkspace(null);
      return;
    }
    setPreferredWorkspace((previous) => {
      if (previous && availableWorkspaces.some((workspace) => workspace.id === previous)) return previous;
      const stored = readStoredWorkspaceId();
      if (stored && availableWorkspaces.some((workspace) => workspace.id === stored)) return stored;
      return availableWorkspaces[0].id;
    });
  }, [availableWorkspaces, showSettingsCards]);

  useEffect(() => {
    if (!showSettingsCards || isRgwSession) return;
    setProfileLoading(true);
    setProfileError(null);
    fetchCurrentUser()
      .then((user) => {
        setFullName(user.full_name ?? "");
        setLanguagePreference(user.ui_language ?? "auto");
        persistStoredUser({ uiLanguage: user.ui_language ?? null });
      })
      .catch((error) => {
        console.error(error);
        setProfileError(getErrorMessage(error, "Unable to load user profile."));
      })
      .finally(() => {
        setProfileLoading(false);
      });
  }, [isRgwSession, showSettingsCards]);

  useEffect(() => {
    if (!showConnectionsSection || !canManagePrivateConnections) {
      setConnections([]);
      setConnectionDrafts({});
      setConnectionCredentialDrafts({});
      setConnectionsError(null);
      setConnectionsLoading(false);
      setShowCreateConnectionModal(false);
      setEditingConnectionId(null);
      setRotatingCredentialsConnectionId(null);
      setConnectionsFilter("");
      setConnectionsPage(1);
      return;
    }
    let cancelled = false;
    setConnectionsLoading(true);
    setConnectionsError(null);
    listConnections()
      .then((items) => {
        if (cancelled) return;
        setConnections(items);
        setConnectionDrafts(
          items.reduce<Record<number, ConnectionDraft>>((acc, item) => {
            acc[item.id] = buildConnectionDraft(item);
            return acc;
          }, {})
        );
        setConnectionCredentialDrafts(
          items.reduce<Record<number, ConnectionCredentialDraft>>((acc, item) => {
            acc[item.id] = { access_key_id: "", secret_access_key: "" };
            return acc;
          }, {})
        );
      })
      .catch((error) => {
        if (cancelled) return;
        console.error(error);
        setConnections([]);
        setConnectionDrafts({});
        setConnectionCredentialDrafts({});
        setConnectionsError(getErrorMessage(error, "Unable to load private S3 connections."));
      })
      .finally(() => {
        if (!cancelled) {
          setConnectionsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canManagePrivateConnections, showConnectionsSection]);

  useEffect(() => {
    if (!showConnectionsSection) return;
    const totalPages = Math.max(1, Math.ceil(filteredConnections.length / (connectionsPageSize || 1)));
    if (connectionsPage > totalPages) {
      setConnectionsPage(totalPages);
    }
  }, [connectionsPage, connectionsPageSize, filteredConnections.length, showConnectionsSection]);

  useEffect(() => {
    if (!showConnectionsSection) return;
    if (editingConnectionId != null && !connections.some((item) => item.id === editingConnectionId)) {
      setEditingConnectionId(null);
    }
    if (
      rotatingCredentialsConnectionId != null &&
      !connections.some((item) => item.id === rotatingCredentialsConnectionId)
    ) {
      setRotatingCredentialsConnectionId(null);
    }
  }, [connections, editingConnectionId, rotatingCredentialsConnectionId, showConnectionsSection]);

  const refreshConnections = async () => {
    if (!showConnectionsSection || !canManagePrivateConnections) return;
    setConnectionsLoading(true);
    setConnectionsError(null);
    try {
      const items = await listConnections();
      setConnections(items);
      setConnectionDrafts(
        items.reduce<Record<number, ConnectionDraft>>((acc, item) => {
          acc[item.id] = buildConnectionDraft(item);
          return acc;
        }, {})
      );
      setConnectionCredentialDrafts(
        items.reduce<Record<number, ConnectionCredentialDraft>>((acc, item) => {
          acc[item.id] = { access_key_id: "", secret_access_key: "" };
          return acc;
        }, {})
      );
    } catch (error) {
      console.error(error);
      setConnectionsError(getErrorMessage(error, "Unable to refresh private S3 connections."));
    } finally {
      setConnectionsLoading(false);
    }
  };

  const openCreateConnectionModal = () => {
    setConnectionsError(null);
    setConnectionsMessage(null);
    setCreateConnectionForm(defaultCreateConnectionForm);
    setShowCreateConnectionModal(true);
  };

  const openEditConnectionModal = (connection: S3Connection) => {
    setConnectionsError(null);
    setConnectionsMessage(null);
    setConnectionDrafts((prev) => ({
      ...prev,
      [connection.id]: prev[connection.id] ?? buildConnectionDraft(connection),
    }));
    setEditingConnectionId(connection.id);
  };

  const openRotateCredentialsModal = (connection: S3Connection) => {
    setConnectionsError(null);
    setConnectionsMessage(null);
    setConnectionCredentialDrafts((prev) => ({
      ...prev,
      [connection.id]: { access_key_id: "", secret_access_key: "" },
    }));
    setRotatingCredentialsConnectionId(connection.id);
  };

  const handleProfileSave = async (event: FormEvent) => {
    event.preventDefault();
    if (isRgwSession) return;
    setProfileSaving(true);
    setProfileError(null);
    setProfileMessage(null);
    try {
      const updated = await updateCurrentUser({ full_name: fullName.trim() || null });
      const updatedName = updated.full_name ?? null;
      setFullName(updatedName ?? "");
      persistStoredUser({ fullName: updatedName });
      setProfileMessage("Profile updated.");
    } catch (error) {
      console.error(error);
      setProfileError(getErrorMessage(error, "Unable to save profile."));
    } finally {
      setProfileSaving(false);
    }
  };

  const handlePasswordSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!canChangePassword || isRgwSession) return;
    setPasswordError(null);
    setPasswordMessage(null);
    if (!currentPassword || !newPassword) {
      setPasswordError("Enter the current password and the new password.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Password confirmation does not match.");
      return;
    }
    setPasswordSaving(true);
    try {
      await updateCurrentUser({
        current_password: currentPassword,
        new_password: newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage("Password modifie.");
    } catch (error) {
      console.error(error);
      setPasswordError(getErrorMessage(error, "Unable to change password."));
    } finally {
      setPasswordSaving(false);
    }
  };

  const handlePreferencesSave = async (event: FormEvent) => {
    event.preventDefault();
    setTheme(preferencesTheme);
    if (!isRgwSession) {
      try {
        const updated = await updateCurrentUser({
          ui_language: preferencesLanguage === "auto" ? null : preferencesLanguage,
        });
        setLanguagePreference(updated.ui_language ?? "auto");
        persistStoredUser({ uiLanguage: updated.ui_language ?? null });
      } catch (error) {
        console.error(error);
        setPreferencesMessage(getErrorMessage(error, "Unable to save language preference."));
        return;
      }
    } else {
      setLanguagePreference(preferencesLanguage);
    }
    if (preferredWorkspace) {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, preferredWorkspace);
    } else {
      localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    }
    setPreferencesMessage("Preferences saved.");
  };

  const handleCreatePrivateConnection = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManagePrivateConnections) return;
    setConnectionsError(null);
    setConnectionsMessage(null);
    if (!createConnectionForm.name.trim()) {
      setConnectionsError("Connection name is required.");
      return;
    }
    if (!createConnectionForm.endpoint_url.trim()) {
      setConnectionsError("Endpoint URL is required.");
      return;
    }
    if (!createConnectionForm.access_key_id.trim() || !createConnectionForm.secret_access_key.trim()) {
      setConnectionsError("S3 credentials are required.");
      return;
    }
    setCreatingConnection(true);
    try {
      await createConnection({
        name: createConnectionForm.name.trim(),
        provider_hint: createConnectionForm.provider_hint.trim() || undefined,
        endpoint_url: createConnectionForm.endpoint_url.trim(),
        region: createConnectionForm.region.trim() || undefined,
        access_key_id: createConnectionForm.access_key_id.trim(),
        secret_access_key: createConnectionForm.secret_access_key,
        force_path_style: createConnectionForm.force_path_style,
        verify_tls: createConnectionForm.verify_tls,
        is_public: false,
      });
      setCreateConnectionForm(defaultCreateConnectionForm);
      setShowCreateConnectionModal(false);
      setConnectionsPage(1);
      setConnectionsMessage("Private S3 connection created.");
      await refreshConnections();
    } catch (error) {
      console.error(error);
      setConnectionsError(getErrorMessage(error, "Unable to create private S3 connection."));
    } finally {
      setCreatingConnection(false);
    }
  };

  const handleUpdateConnectionDraft = (connectionId: number, field: keyof ConnectionDraft, value: string | boolean) => {
    setConnectionDrafts((prev) => ({
      ...prev,
      [connectionId]: {
        ...prev[connectionId],
        [field]: value,
      },
    }));
  };

  const handleUpdateConnectionCredentialDraft = (
    connectionId: number,
    field: keyof ConnectionCredentialDraft,
    value: string
  ) => {
    setConnectionCredentialDrafts((prev) => ({
      ...prev,
      [connectionId]: {
        ...prev[connectionId],
        [field]: value,
      },
    }));
  };

  const handleUpdatePrivateConnection = async (connectionId: number): Promise<boolean> => {
    if (!canManagePrivateConnections) return false;
    const draft = connectionDrafts[connectionId];
    if (!draft) return false;
    setConnectionsError(null);
    setConnectionsMessage(null);
    if (!draft.name.trim()) {
      setConnectionsError("Connection name is required.");
      return false;
    }
    if (!draft.storage_endpoint_id && !draft.endpoint_url.trim()) {
      setConnectionsError("Endpoint URL is required.");
      return false;
    }
    setSavingConnectionBusyId(connectionId);
    try {
      await updateConnection(connectionId, {
        name: draft.name.trim(),
        provider_hint: draft.provider_hint.trim() || undefined,
        endpoint_url: draft.storage_endpoint_id ? undefined : draft.endpoint_url.trim(),
        region: draft.region.trim() || undefined,
        force_path_style: draft.force_path_style,
        verify_tls: draft.verify_tls,
      });
      setConnectionsMessage("Private S3 connection updated.");
      await refreshConnections();
      return true;
    } catch (error) {
      console.error(error);
      setConnectionsError(getErrorMessage(error, "Unable to update private S3 connection."));
      return false;
    } finally {
      setSavingConnectionBusyId(null);
    }
  };

  const handleRotatePrivateConnectionCredentials = async (connectionId: number): Promise<boolean> => {
    if (!canManagePrivateConnections) return false;
    const draft = connectionCredentialDrafts[connectionId];
    if (!draft) return false;
    setConnectionsError(null);
    setConnectionsMessage(null);
    if (!draft.access_key_id.trim() || !draft.secret_access_key.trim()) {
      setConnectionsError("Enter the new Access Key and Secret Key.");
      return false;
    }
    setRotatingConnectionBusyId(connectionId);
    try {
      await rotateConnectionCredentials(connectionId, {
        access_key_id: draft.access_key_id.trim(),
        secret_access_key: draft.secret_access_key,
      });
      setConnectionsMessage("Credentials S3 modifies.");
      await refreshConnections();
      return true;
    } catch (error) {
      console.error(error);
      setConnectionsError(getErrorMessage(error, "Unable to update S3 credentials."));
      return false;
    } finally {
      setRotatingConnectionBusyId(null);
    }
  };

  const handleDeletePrivateConnection = async (connectionId: number) => {
    if (!canManagePrivateConnections) return;
    if (!window.confirm("Delete this private S3 connection?")) return;
    setConnectionsError(null);
    setConnectionsMessage(null);
    setDeletingConnectionBusyId(connectionId);
    try {
      await deleteConnection(connectionId);
      setConnectionsMessage("Private S3 connection deleted.");
      await refreshConnections();
    } catch (error) {
      console.error(error);
      setConnectionsError(getErrorMessage(error, "Unable to delete private S3 connection."));
    } finally {
      setDeletingConnectionBusyId(null);
    }
  };

  const handleConnectionsFilterChange = (value: string) => {
    setConnectionsFilter(value);
    setConnectionsPage(1);
  };

  const inputClasses =
    "mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 ui-body text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
  const primaryButtonClasses =
    "inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:pointer-events-none disabled:opacity-60";
  const cardClasses = "rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900";
  const sectionHeadingClasses = "ui-body font-semibold text-slate-900 dark:text-slate-100";
  const sectionDescriptionClasses = "ui-caption text-slate-500 dark:text-slate-400";
  const secondaryButtonClasses =
    "inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-3 py-1.5 ui-caption font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800";

  return (
    <div className="space-y-4">
      {showPageHeader && (
        <PageHeader
          title="User profile"
          description="Configure your account and preferences."
          breadcrumbs={[{ label: "Profile" }]}
        />
      )}

      {showSettingsCards && profileLoading && <PageBanner tone="info">Loading profile...</PageBanner>}
      {showSettingsCards && profileError && <PageBanner tone="error">{profileError}</PageBanner>}

      {showSettingsCards && <div className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={handleProfileSave} className={cardClasses}>
          <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
            <h2 className={sectionHeadingClasses}>Identity</h2>
            <p className={sectionDescriptionClasses}>Update the display name for your account.</p>
          </div>
          <div className="space-y-4 px-5 py-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Email
                </span>
                <input
                  type="email"
                  value={storedUser?.email ?? ""}
                  disabled
                  className={`${inputClasses} cursor-not-allowed opacity-70`}
                />
              </label>
              <label className="block">
                <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Name
                </span>
                <input
                  type="text"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  disabled={isRgwSession}
                  className={`${inputClasses} ${isRgwSession ? "cursor-not-allowed opacity-70" : ""}`}
                  placeholder="Your name"
                />
              </label>
            </div>
            {isRgwSession && (
              <p className="ui-caption text-slate-500 dark:text-slate-400">
                Temporary S3 session: user profile is not editable.
              </p>
            )}
            {profileMessage && (
              <p className="ui-caption font-semibold text-emerald-700 dark:text-emerald-300">{profileMessage}</p>
            )}
            <div>
              <button type="submit" disabled={profileSaving || isRgwSession} className={primaryButtonClasses}>
                {profileSaving ? "Saving..." : "Save profile"}
              </button>
            </div>
          </div>
        </form>

        <form onSubmit={handlePasswordSave} className={cardClasses}>
          <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
            <h2 className={sectionHeadingClasses}>Password</h2>
            <p className={sectionDescriptionClasses}>Update your sign-in password.</p>
          </div>
          <div className="space-y-4 px-5 py-5">
            {!canChangePassword ? (
              <PageBanner tone="info">
                Password change is not available for this authentication mode.
              </PageBanner>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Current
                  </span>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    className={inputClasses}
                    autoComplete="current-password"
                  />
                </label>
                <label className="block">
                  <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    New
                  </span>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    className={inputClasses}
                    autoComplete="new-password"
                  />
                </label>
                <label className="block">
                  <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Confirm
                  </span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className={inputClasses}
                    autoComplete="new-password"
                  />
                </label>
              </div>
            )}
            {passwordError && <p className="ui-caption font-semibold text-rose-600">{passwordError}</p>}
            {passwordMessage && (
              <p className="ui-caption font-semibold text-emerald-700 dark:text-emerald-300">{passwordMessage}</p>
            )}
            <div>
              <button type="submit" disabled={passwordSaving || !canChangePassword} className={primaryButtonClasses}>
                {passwordSaving ? "Updating..." : "Change password"}
              </button>
            </div>
          </div>
        </form>

        <form onSubmit={handlePreferencesSave} className={cardClasses}>
          <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
            <h2 className={sectionHeadingClasses}>Preferences</h2>
            <p className={sectionDescriptionClasses}>Language, theme, and default workspace after sign-in.</p>
          </div>
          <div className="space-y-4 px-5 py-5">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="block">
                <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Language
                </span>
                <select
                  value={preferencesLanguage}
                  onChange={(event) => setPreferencesLanguage(event.target.value as UiLanguagePreference)}
                  className={inputClasses}
                >
                  <option value="en">English</option>
                  <option value="fr">French</option>
                  <option value="de">Deutsch</option>
                  <option value="auto">Auto (browser)</option>
                </select>
              </label>
              <label className="block">
                <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Theme
                </span>
                <select
                  value={preferencesTheme}
                  onChange={(event) => setPreferencesTheme(event.target.value as "light" | "dark")}
                  className={inputClasses}
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
              <label className="block">
                <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Default workspace
                </span>
                <select
                  value={preferredWorkspace ?? ""}
                  onChange={(event) => setPreferredWorkspace((event.target.value as WorkspaceId) || null)}
                  className={inputClasses}
                  disabled={availableWorkspaces.length === 0}
                >
                  {availableWorkspaces.length === 0 && <option value="">No workspace available</option>}
                  {availableWorkspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {preferencesMessage && (
              <p className="ui-caption font-semibold text-emerald-700 dark:text-emerald-300">{preferencesMessage}</p>
            )}
            <div>
              <button type="submit" className={primaryButtonClasses}>
                Save preferences
              </button>
            </div>
          </div>
        </form>
      </div>}

      {showConnectionsSection && <section className={cardClasses}>
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className={sectionHeadingClasses}>Private S3 connections</h2>
            <p className={sectionDescriptionClasses}>List your connections and manage credentials.</p>
          </div>
          {canManagePrivateConnections && (
            <button type="button" className={primaryButtonClasses} onClick={openCreateConnectionModal}>
              Add connection
            </button>
          )}
        </div>

        <div className="space-y-4 px-5 py-5">
          {!canManagePrivateConnections ? (
            <PageBanner tone="info">
              {storedUser?.role === "ui_user"
                ? "Private S3 connection management is disabled for UI users on this instance."
                : "This session cannot manage private S3 connections."}
            </PageBanner>
          ) : (
            <>
              {connectionsError && <PageBanner tone="error">{connectionsError}</PageBanner>}
              {connectionsMessage && <PageBanner tone="success">{connectionsMessage}</PageBanner>}
              <div className="rounded-xl border border-slate-200/80 dark:border-slate-800">
                <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    {filteredConnections.length} connections shown
                    {filteredConnections.length !== connections.length ? ` of ${connections.length}` : ""}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Search
                    </span>
                    <input
                      type="text"
                      value={connectionsFilter}
                      onChange={(event) => handleConnectionsFilterChange(event.target.value)}
                      placeholder="Name, endpoint, provider..."
                      className={`${toolbarCompactInputClasses} w-full sm:w-72`}
                    />
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="compact-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
                    <thead className="bg-slate-50 dark:bg-slate-900/50">
                      <tr>
                        {["Connection", "Endpoint", "Provider", "Last update", "Last used", "Actions"].map(
                          (label) => (
                            <th
                              key={label}
                              className="px-4 py-3 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                            >
                              {label}
                            </th>
                          )
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {connectionsLoading && (
                        <tr>
                          <td colSpan={6} className="px-4 py-4 ui-body text-slate-500 dark:text-slate-400">
                            Loading connections...
                          </td>
                        </tr>
                      )}
                      {!connectionsLoading && pagedConnections.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-4 py-4 ui-body text-slate-500 dark:text-slate-400">
                            No private S3 connection configured.
                          </td>
                        </tr>
                      )}
                      {!connectionsLoading &&
                        pagedConnections.map((connection) => {
                          const endpointLabel = connection.storage_endpoint_id
                            ? `Managed endpoint #${connection.storage_endpoint_id}`
                            : connection.endpoint_url || "-";
                          return (
                            <tr key={connection.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                              <td className="px-4 py-4">
                                <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">
                                  {connection.name || "-"}
                                </p>
                                <p className="ui-caption text-slate-500 dark:text-slate-400">Access Key: {connection.access_key_id || "-"}</p>
                              </td>
                              <td className="px-4 py-4 ui-caption text-slate-600 dark:text-slate-300">
                                {connection.storage_endpoint_id ? (
                                  <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                                    {endpointLabel}
                                  </span>
                                ) : (
                                  <span className="ui-mono">{endpointLabel}</span>
                                )}
                              </td>
                              <td className="px-4 py-4 ui-caption text-slate-600 dark:text-slate-300">
                                {connection.provider_hint || "-"}
                              </td>
                              <td className="px-4 py-4 ui-caption text-slate-600 dark:text-slate-300">
                                {formatDateTime(connection.updated_at ?? connection.created_at)}
                              </td>
                              <td className="px-4 py-4 ui-caption text-slate-600 dark:text-slate-300">
                                {formatDateTime(connection.last_used_at)}
                              </td>
                              <td className="px-4 py-4 text-right">
                                <div className="flex justify-end gap-2">
                                  <button
                                    type="button"
                                    className={tableActionButtonClasses}
                                    onClick={() => openEditConnectionModal(connection)}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    className={tableActionButtonClasses}
                                    onClick={() => openRotateCredentialsModal(connection)}
                                  >
                                    Credentials
                                  </button>
                                  <button
                                    type="button"
                                    className={tableDeleteActionClasses}
                                    disabled={deletingConnectionBusyId === connection.id}
                                    onClick={() => void handleDeletePrivateConnection(connection.id)}
                                  >
                                    {deletingConnectionBusyId === connection.id ? "Deleting..." : "Delete"}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
                {!connectionsLoading && filteredConnections.length > 0 && (
                  <PaginationControls
                    page={connectionsPage}
                    pageSize={connectionsPageSize}
                    total={filteredConnections.length}
                    onPageChange={(page) => setConnectionsPage(Math.max(1, page))}
                    onPageSizeChange={(size) => {
                      setConnectionsPageSize(size);
                      setConnectionsPage(1);
                    }}
                    pageSizeOptions={[5, 10, 25, 50]}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </section>}

      {showConnectionsSection && showCreateConnectionModal && (
        <Modal
          title="Add private S3 connection"
          onClose={() => (!creatingConnection ? setShowCreateConnectionModal(false) : null)}
          maxWidthClass="max-w-3xl"
        >
          {connectionsError && (
            <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-caption font-semibold text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/50 dark:text-rose-200">
              {connectionsError}
            </div>
          )}
          <form onSubmit={handleCreatePrivateConnection} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Name
                </span>
                <input
                  type="text"
                  value={createConnectionForm.name}
                  onChange={(event) => setCreateConnectionForm((prev) => ({ ...prev, name: event.target.value }))}
                  className={inputClasses}
                  placeholder="Mon endpoint S3"
                />
              </label>
              <label className="block">
                <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Provider
                </span>
                <input
                  type="text"
                  value={createConnectionForm.provider_hint}
                  onChange={(event) =>
                    setCreateConnectionForm((prev) => ({ ...prev, provider_hint: event.target.value }))
                  }
                  className={inputClasses}
                  placeholder="aws | minio | ceph ..."
                />
              </label>
              <label className="block">
                <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Endpoint URL
                </span>
                <input
                  type="url"
                  value={createConnectionForm.endpoint_url}
                  onChange={(event) =>
                    setCreateConnectionForm((prev) => ({ ...prev, endpoint_url: event.target.value }))
                  }
                  className={inputClasses}
                  placeholder="https://s3.example.com"
                />
              </label>
              <label className="block">
                <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Region
                </span>
                <input
                  type="text"
                  value={createConnectionForm.region}
                  onChange={(event) => setCreateConnectionForm((prev) => ({ ...prev, region: event.target.value }))}
                  className={inputClasses}
                  placeholder="us-east-1"
                />
              </label>
              <label className="block">
                <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Access Key
                </span>
                <input
                  type="text"
                  value={createConnectionForm.access_key_id}
                  onChange={(event) =>
                    setCreateConnectionForm((prev) => ({ ...prev, access_key_id: event.target.value }))
                  }
                  className={inputClasses}
                  placeholder="AKIA..."
                />
              </label>
              <label className="block">
                <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Secret Key
                </span>
                <input
                  type="password"
                  value={createConnectionForm.secret_access_key}
                  onChange={(event) =>
                    setCreateConnectionForm((prev) => ({ ...prev, secret_access_key: event.target.value }))
                  }
                  className={inputClasses}
                  placeholder="********"
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 ui-caption font-semibold text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={createConnectionForm.force_path_style}
                  onChange={(event) =>
                    setCreateConnectionForm((prev) => ({ ...prev, force_path_style: event.target.checked }))
                  }
                  className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                />
                Force path style
              </label>
              <label className="flex items-center gap-2 ui-caption font-semibold text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={createConnectionForm.verify_tls}
                  onChange={(event) =>
                    setCreateConnectionForm((prev) => ({ ...prev, verify_tls: event.target.checked }))
                  }
                  className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                />
                Verify TLS
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className={secondaryButtonClasses}
                onClick={() => setShowCreateConnectionModal(false)}
                disabled={creatingConnection}
              >
                Cancel
              </button>
              <button type="submit" className={primaryButtonClasses} disabled={creatingConnection}>
                {creatingConnection ? "Creating..." : "Create connection"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showConnectionsSection && editingConnection && (
        <Modal
          title={`Edit connection - ${editingConnection.name}`}
          onClose={() => (savingConnectionBusyId === editingConnection.id ? null : setEditingConnectionId(null))}
          maxWidthClass="max-w-3xl"
        >
          {connectionsError && (
            <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-caption font-semibold text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/50 dark:text-rose-200">
              {connectionsError}
            </div>
          )}
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              const success = await handleUpdatePrivateConnection(editingConnection.id);
              if (success) setEditingConnectionId(null);
            }}
          >
            {(() => {
              const draft = connectionDrafts[editingConnection.id] ?? buildConnectionDraft(editingConnection);
              const isManagedEndpoint = Boolean(draft.storage_endpoint_id);
              return (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Name
                      </span>
                      <input
                        type="text"
                        value={draft.name}
                        onChange={(event) => handleUpdateConnectionDraft(editingConnection.id, "name", event.target.value)}
                        className={inputClasses}
                      />
                    </label>
                    <label className="block">
                      <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Provider
                      </span>
                      <input
                        type="text"
                        value={draft.provider_hint}
                        onChange={(event) =>
                          handleUpdateConnectionDraft(editingConnection.id, "provider_hint", event.target.value)
                        }
                        className={inputClasses}
                      />
                    </label>
                    <label className="block">
                      <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Endpoint URL
                      </span>
                      <input
                        type="url"
                        value={draft.endpoint_url}
                        onChange={(event) =>
                          handleUpdateConnectionDraft(editingConnection.id, "endpoint_url", event.target.value)
                        }
                        disabled={isManagedEndpoint}
                        className={`${inputClasses} ${isManagedEndpoint ? "cursor-not-allowed opacity-70" : ""}`}
                      />
                    </label>
                    <label className="block">
                      <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Region
                      </span>
                      <input
                        type="text"
                        value={draft.region}
                        onChange={(event) =>
                          handleUpdateConnectionDraft(editingConnection.id, "region", event.target.value)
                        }
                        disabled={isManagedEndpoint}
                        className={`${inputClasses} ${isManagedEndpoint ? "cursor-not-allowed opacity-70" : ""}`}
                      />
                    </label>
                  </div>
                  {isManagedEndpoint && (
                    <p className="ui-caption text-slate-500 dark:text-slate-400">
                      This connection uses a platform-managed endpoint.
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2 ui-caption font-semibold text-slate-600 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={Boolean(draft.force_path_style)}
                        onChange={(event) =>
                          handleUpdateConnectionDraft(editingConnection.id, "force_path_style", event.target.checked)
                        }
                        disabled={isManagedEndpoint}
                        className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                      />
                      Force path style
                    </label>
                    <label className="flex items-center gap-2 ui-caption font-semibold text-slate-600 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={Boolean(draft.verify_tls)}
                        onChange={(event) =>
                          handleUpdateConnectionDraft(editingConnection.id, "verify_tls", event.target.checked)
                        }
                        disabled={isManagedEndpoint}
                        className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                      />
                      Verify TLS
                    </label>
                  </div>
                </>
              );
            })()}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className={secondaryButtonClasses}
                onClick={() => setEditingConnectionId(null)}
                disabled={savingConnectionBusyId === editingConnection.id}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={primaryButtonClasses}
                disabled={savingConnectionBusyId === editingConnection.id}
              >
                {savingConnectionBusyId === editingConnection.id ? "Sauvegarde..." : "Sauvegarder"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showConnectionsSection && rotatingConnection && (
        <Modal
          title={`Rotation credentials - ${rotatingConnection.name}`}
          onClose={() =>
            rotatingConnectionBusyId === rotatingConnection.id ? null : setRotatingCredentialsConnectionId(null)
          }
          maxWidthClass="max-w-2xl"
        >
          {connectionsError && (
            <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-caption font-semibold text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/50 dark:text-rose-200">
              {connectionsError}
            </div>
          )}
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              const success = await handleRotatePrivateConnectionCredentials(rotatingConnection.id);
              if (success) setRotatingCredentialsConnectionId(null);
            }}
          >
            <p className="ui-caption text-slate-500 dark:text-slate-400">
              Current Access Key: <span className="ui-mono">{rotatingConnection.access_key_id || "-"}</span>
            </p>
            {(() => {
              const credentialDraft = connectionCredentialDrafts[rotatingConnection.id] ?? {
                access_key_id: "",
                secret_access_key: "",
              };
              return (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      New Access Key
                    </span>
                    <input
                      type="text"
                      value={credentialDraft.access_key_id}
                      onChange={(event) =>
                        handleUpdateConnectionCredentialDraft(rotatingConnection.id, "access_key_id", event.target.value)
                      }
                      className={inputClasses}
                    />
                  </label>
                  <label className="block">
                    <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      New Secret Key
                    </span>
                    <input
                      type="password"
                      value={credentialDraft.secret_access_key}
                      onChange={(event) =>
                        handleUpdateConnectionCredentialDraft(
                          rotatingConnection.id,
                          "secret_access_key",
                          event.target.value
                        )
                      }
                      className={inputClasses}
                    />
                  </label>
                </div>
              );
            })()}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className={secondaryButtonClasses}
                onClick={() => setRotatingCredentialsConnectionId(null)}
                disabled={rotatingConnectionBusyId === rotatingConnection.id}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={primaryButtonClasses}
                disabled={rotatingConnectionBusyId === rotatingConnection.id}
              >
                {rotatingConnectionBusyId === rotatingConnection.id ? "Rotation..." : "Update credentials"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
