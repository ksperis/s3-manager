/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import Modal from "../../components/Modal";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import PaginationControls from "../../components/PaginationControls";
import UiTagBadgeList from "../../components/UiTagBadgeList";
import UiTagEditor from "../../components/UiTagEditor";
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
  updateConnection,
  validateConnectionCredentials,
} from "../../api/connections";
import { listStorageEndpoints, StorageEndpoint } from "../../api/storageEndpoints";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { S3CredentialsValidationPayload, useLiveS3CredentialsValidation } from "./useLiveS3CredentialsValidation";
import { notifyExecutionContextsRefresh } from "../../utils/executionContextRefresh";
import {
  WORKSPACE_STORAGE_KEY,
  isAdminLikeRole,
  type SessionUser,
  type WorkspaceId,
  readStoredUser,
  readStoredWorkspaceId,
  resolveAvailableWorkspacesWithFlags,
} from "../../utils/workspaces";
import {
  readSelectorTagsPreference,
  writeSelectorTagsPreference,
} from "../../utils/selectorTagsPreference";
import { buildUiTagItems, extractUiTagLabels, normalizeUiTags, type UiTagDefinition } from "../../utils/uiTags";
import { useTagCatalog } from "../../hooks/useTagCatalog";

const defaultCreateConnectionForm = {
  name: "",
  tags: [] as UiTagDefinition[],
  provider_hint: "",
  endpoint_url: "",
  region: "",
  access_key_id: "",
  secret_access_key: "",
  access_manager: false,
  access_browser: true,
  force_path_style: false,
  verify_tls: true,
};

type CreateConnectionEndpointMode = "preset" | "custom";

type ConnectionDraft = {
  name: string;
  tags: UiTagDefinition[];
  provider_hint: string;
  endpoint_url: string;
  region: string;
  access_manager: boolean;
  access_browser: boolean;
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
    tags: normalizeUiTags(connection.tags),
    provider_hint: connection.provider_hint ?? "",
    endpoint_url: connection.endpoint_url ?? "",
    region: connection.region ?? "",
    access_manager: connection.access_manager === true,
    access_browser: connection.access_browser !== false,
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
  const isS3Session = authType === "s3_session";
  const canChangePassword = authType !== "s3_session" && authType !== "oidc";
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
  const [preferencesShowSelectorTags, setPreferencesShowSelectorTags] = useState<boolean>(() => readSelectorTagsPreference());
  const [quotaAlertsEnabled, setQuotaAlertsEnabled] = useState(true);
  const [quotaAlertsGlobalWatch, setQuotaAlertsGlobalWatch] = useState(false);
  const [connections, setConnections] = useState<S3Connection[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);
  const [connectionsMessage, setConnectionsMessage] = useState<string | null>(null);
  const [showCreateConnectionModal, setShowCreateConnectionModal] = useState(false);
  const [creatingConnection, setCreatingConnection] = useState(false);
  const [savingConnectionBusyId, setSavingConnectionBusyId] = useState<number | null>(null);
  const [deletingConnectionBusyId, setDeletingConnectionBusyId] = useState<number | null>(null);
  const [togglingConnectionBusyId, setTogglingConnectionBusyId] = useState<number | null>(null);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<number[]>([]);
  const [bulkActivatingConnections, setBulkActivatingConnections] = useState(false);
  const [bulkDisablingConnections, setBulkDisablingConnections] = useState(false);
  const [bulkDeletingConnections, setBulkDeletingConnections] = useState(false);
  const [editingConnectionId, setEditingConnectionId] = useState<number | null>(null);
  const [createConnectionForm, setCreateConnectionForm] = useState(defaultCreateConnectionForm);
  const [createConnectionEndpointMode, setCreateConnectionEndpointMode] = useState<CreateConnectionEndpointMode>("custom");
  const [createConnectionEndpointId, setCreateConnectionEndpointId] = useState("");
  const [editConnectionEndpointMode, setEditConnectionEndpointMode] = useState<CreateConnectionEndpointMode>("custom");
  const [editConnectionEndpointId, setEditConnectionEndpointId] = useState("");
  const [availableStorageEndpoints, setAvailableStorageEndpoints] = useState<StorageEndpoint[]>([]);
  const [loadingStorageEndpoints, setLoadingStorageEndpoints] = useState(false);
  const [storageEndpointsError, setStorageEndpointsError] = useState<string | null>(null);
  const [connectionDrafts, setConnectionDrafts] = useState<Record<number, ConnectionDraft>>({});
  const [connectionCredentialDrafts, setConnectionCredentialDrafts] = useState<Record<number, ConnectionCredentialDraft>>(
    {}
  );
  const [connectionsFilter, setConnectionsFilter] = useState("");
  const [connectionsPage, setConnectionsPage] = useState(1);
  const [connectionsPageSize, setConnectionsPageSize] = useState(10);
  const { catalog: privateTagCatalog, loading: privateTagCatalogLoading, error: privateTagCatalogError } = useTagCatalog(
    { kind: "private" },
    Boolean(showCreateConnectionModal || editingConnectionId != null)
  );
  const availableWorkspaces = useMemo(
    () => resolveAvailableWorkspacesWithFlags(storedUser, generalSettings),
    [generalSettings, storedUser]
  );
  const [preferredWorkspace, setPreferredWorkspace] = useState<WorkspaceId | null>(() => readStoredWorkspaceId());
  const canConfigureGlobalQuotaWatch = isAdminLikeRole(storedUser?.role);
  const canManagePrivateConnections =
    !isS3Session &&
    (isAdminLikeRole(storedUser?.role) ||
      (storedUser?.role === "ui_user" && generalSettings.allow_user_private_connections));

  const createConnectionValidationPayload = useMemo(() => {
    const accessKeyId = createConnectionForm.access_key_id.trim();
    const secretAccessKey = createConnectionForm.secret_access_key.trim();
    if (!accessKeyId || !secretAccessKey) return null;
    if (createConnectionEndpointMode === "preset") {
      if (!createConnectionEndpointId) return null;
      return {
        storage_endpoint_id: Number(createConnectionEndpointId),
        access_key_id: accessKeyId,
        secret_access_key: secretAccessKey,
      };
    }
    const endpointUrl = createConnectionForm.endpoint_url.trim();
    if (!endpointUrl) return null;
    return {
      endpoint_url: endpointUrl,
      region: createConnectionForm.region.trim() || null,
      access_key_id: accessKeyId,
      secret_access_key: secretAccessKey,
      force_path_style: createConnectionForm.force_path_style,
      verify_tls: createConnectionForm.verify_tls,
    };
  }, [
    createConnectionEndpointId,
    createConnectionEndpointMode,
    createConnectionForm.access_key_id,
    createConnectionForm.endpoint_url,
    createConnectionForm.force_path_style,
    createConnectionForm.region,
    createConnectionForm.secret_access_key,
    createConnectionForm.verify_tls,
  ]);

  const validatePrivateCreateCredentials = useCallback(
    (payload: S3CredentialsValidationPayload) => validateConnectionCredentials(payload),
    []
  );

  const createConnectionValidation = useLiveS3CredentialsValidation({
    enabled: showCreateConnectionModal && canManagePrivateConnections,
    payload: createConnectionValidationPayload,
    validate: validatePrivateCreateCredentials,
    debounceMs: 450,
  });

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
        ...extractUiTagLabels(connection.tags),
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
  const filteredConnectionIds = useMemo(() => filteredConnections.map((connection) => connection.id), [filteredConnections]);
  const filteredConnectionIdSet = useMemo(() => new Set(filteredConnectionIds), [filteredConnectionIds]);
  const pagedConnectionIds = useMemo(() => pagedConnections.map((connection) => connection.id), [pagedConnections]);
  const selectedFilteredConnectionIds = useMemo(
    () => selectedConnectionIds.filter((connectionId) => filteredConnectionIdSet.has(connectionId)),
    [filteredConnectionIdSet, selectedConnectionIds]
  );
  const selectedFilteredConnectionIdSet = useMemo(
    () => new Set(selectedFilteredConnectionIds),
    [selectedFilteredConnectionIds]
  );
  const selectedPagedConnectionIds = useMemo(
    () => pagedConnectionIds.filter((connectionId) => selectedFilteredConnectionIdSet.has(connectionId)),
    [pagedConnectionIds, selectedFilteredConnectionIdSet]
  );
  const allFilteredConnectionsSelected =
    filteredConnectionIds.length > 0 && selectedFilteredConnectionIds.length === filteredConnectionIds.length;
  const hiddenSelectedConnectionCount = Math.max(selectedFilteredConnectionIds.length - selectedPagedConnectionIds.length, 0);
  const storageEndpointLabelById = useMemo(() => {
    const labels = new Map<number, string>();
    availableStorageEndpoints.forEach((endpoint) => {
      const label = endpoint.name?.trim() || endpoint.endpoint_url || `Endpoint #${endpoint.id}`;
      labels.set(endpoint.id, label);
    });
    return labels;
  }, [availableStorageEndpoints]);

  const editingConnection = useMemo(
    () =>
      editingConnectionId == null ? null : connections.find((connection) => connection.id === editingConnectionId) ?? null,
    [connections, editingConnectionId]
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
    if (!showSettingsCards || isS3Session) return;
    setProfileLoading(true);
    setProfileError(null);
    fetchCurrentUser()
      .then((user) => {
        setFullName(user.full_name ?? "");
        setLanguagePreference(user.ui_language ?? "auto");
        setQuotaAlertsEnabled(user.quota_alerts_enabled !== false);
        setQuotaAlertsGlobalWatch(Boolean(user.quota_alerts_global_watch));
        persistStoredUser({ uiLanguage: user.ui_language ?? null });
      })
      .catch((error) => {
        console.error(error);
        setProfileError(getErrorMessage(error, "Unable to load user profile."));
      })
      .finally(() => {
        setProfileLoading(false);
      });
  }, [isS3Session, setLanguagePreference, showSettingsCards]);

  useEffect(() => {
    if (!showConnectionsSection || !canManagePrivateConnections) {
      setConnections([]);
      setConnectionDrafts({});
      setConnectionCredentialDrafts({});
      setConnectionsError(null);
      setConnectionsLoading(false);
      setShowCreateConnectionModal(false);
      setEditingConnectionId(null);
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
    if (!showConnectionsSection || !canManagePrivateConnections) {
      setAvailableStorageEndpoints([]);
      setStorageEndpointsError(null);
      setLoadingStorageEndpoints(false);
      return;
    }
    let cancelled = false;
    setLoadingStorageEndpoints(true);
    setStorageEndpointsError(null);
    listStorageEndpoints()
      .then((items) => {
        if (cancelled) return;
        setAvailableStorageEndpoints(items);
      })
      .catch((error) => {
        if (cancelled) return;
        setAvailableStorageEndpoints([]);
        setStorageEndpointsError(getErrorMessage(error, "Unable to load configured endpoints."));
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingStorageEndpoints(false);
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
  }, [connections, editingConnectionId, showConnectionsSection]);

  useEffect(() => {
    if (!showConnectionsSection) return;
    setSelectedConnectionIds((prev) => {
      const next = prev.filter((connectionId) => filteredConnectionIdSet.has(connectionId));
      return next.length === prev.length ? prev : next;
    });
  }, [filteredConnectionIdSet, showConnectionsSection]);

  useEffect(() => {
    if (!showConnectionsSection) return;
    setSelectedConnectionIds([]);
  }, [connectionsPage, connectionsPageSize, showConnectionsSection]);

  useEffect(() => {
    if (!showCreateConnectionModal) return;
    if (createConnectionEndpointMode !== "preset") return;
    if (availableStorageEndpoints.length === 0) {
      setCreateConnectionEndpointMode("custom");
      setCreateConnectionEndpointId("");
      return;
    }
    if (
      createConnectionEndpointId &&
      availableStorageEndpoints.some((item) => String(item.id) === createConnectionEndpointId)
    ) {
      return;
    }
    const preferred = availableStorageEndpoints.find((item) => item.is_default) ?? availableStorageEndpoints[0];
    setCreateConnectionEndpointId(String(preferred.id));
  }, [
    availableStorageEndpoints,
    createConnectionEndpointId,
    createConnectionEndpointMode,
    showCreateConnectionModal,
  ]);

  useEffect(() => {
    if (!editingConnection) return;
    if (editConnectionEndpointMode !== "preset") return;
    if (availableStorageEndpoints.length === 0) {
      setEditConnectionEndpointMode("custom");
      setEditConnectionEndpointId("");
      return;
    }
    if (
      editConnectionEndpointId &&
      availableStorageEndpoints.some((item) => String(item.id) === editConnectionEndpointId)
    ) {
      return;
    }
    const preferred = availableStorageEndpoints.find((item) => item.is_default) ?? availableStorageEndpoints[0];
    setEditConnectionEndpointId(String(preferred.id));
  }, [
    availableStorageEndpoints,
    editConnectionEndpointId,
    editConnectionEndpointMode,
    editingConnection,
  ]);

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
    if (availableStorageEndpoints.length > 0) {
      const preferred = availableStorageEndpoints.find((item) => item.is_default) ?? availableStorageEndpoints[0];
      setCreateConnectionEndpointMode("preset");
      setCreateConnectionEndpointId(String(preferred.id));
    } else {
      setCreateConnectionEndpointMode("custom");
      setCreateConnectionEndpointId("");
    }
    setShowCreateConnectionModal(true);
  };

  const openEditConnectionModal = (connection: S3Connection) => {
    setConnectionsError(null);
    setConnectionsMessage(null);
    setConnectionDrafts((prev) => ({
      ...prev,
      [connection.id]: prev[connection.id] ?? buildConnectionDraft(connection),
    }));
    if (connection.storage_endpoint_id != null) {
      setEditConnectionEndpointMode("preset");
      setEditConnectionEndpointId(String(connection.storage_endpoint_id));
    } else {
      setEditConnectionEndpointMode("custom");
      setEditConnectionEndpointId("");
    }
    setConnectionCredentialDrafts((prev) => ({
      ...prev,
      [connection.id]: { access_key_id: "", secret_access_key: "" },
    }));
    setEditingConnectionId(connection.id);
  };

  const handleProfileSave = async (event: FormEvent) => {
    event.preventDefault();
    if (isS3Session) return;
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
    if (!canChangePassword || isS3Session) return;
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
    if (!isS3Session) {
      try {
        const updated = await updateCurrentUser({
          ui_language: preferencesLanguage === "auto" ? null : preferencesLanguage,
          quota_alerts_enabled: quotaAlertsEnabled,
          quota_alerts_global_watch: canConfigureGlobalQuotaWatch ? quotaAlertsGlobalWatch : false,
        });
        setLanguagePreference(updated.ui_language ?? "auto");
        setQuotaAlertsEnabled(updated.quota_alerts_enabled !== false);
        setQuotaAlertsGlobalWatch(Boolean(updated.quota_alerts_global_watch));
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
    writeSelectorTagsPreference(preferencesShowSelectorTags);
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
    if (createConnectionEndpointMode === "preset" && !createConnectionEndpointId) {
      setConnectionsError("Select a configured endpoint.");
      return;
    }
    if (createConnectionEndpointMode === "custom" && !createConnectionForm.endpoint_url.trim()) {
      setConnectionsError("Endpoint URL is required.");
      return;
    }
    if (!createConnectionForm.access_key_id.trim() || !createConnectionForm.secret_access_key.trim()) {
      setConnectionsError("S3 credentials are required.");
      return;
    }
    if (!createConnectionForm.access_manager && !createConnectionForm.access_browser) {
      setConnectionsError("Enable access to manager and/or browser.");
      return;
    }
    const storageEndpointId =
      createConnectionEndpointMode === "preset" && createConnectionEndpointId
        ? Number(createConnectionEndpointId)
        : null;
    setCreatingConnection(true);
    try {
      await createConnection({
        name: createConnectionForm.name.trim(),
        tags: normalizeUiTags(createConnectionForm.tags),
        provider_hint:
          createConnectionEndpointMode === "custom" ? createConnectionForm.provider_hint.trim() || undefined : undefined,
        storage_endpoint_id: storageEndpointId,
        endpoint_url: storageEndpointId ? undefined : createConnectionForm.endpoint_url.trim(),
        region: storageEndpointId ? undefined : createConnectionForm.region.trim() || undefined,
        access_key_id: createConnectionForm.access_key_id.trim(),
        secret_access_key: createConnectionForm.secret_access_key,
        access_manager: createConnectionForm.access_manager,
        access_browser: createConnectionForm.access_browser,
        force_path_style: storageEndpointId ? undefined : createConnectionForm.force_path_style,
        verify_tls: storageEndpointId ? undefined : createConnectionForm.verify_tls,
      });
      setCreateConnectionForm(defaultCreateConnectionForm);
      setCreateConnectionEndpointMode(availableStorageEndpoints.length > 0 ? "preset" : "custom");
      setCreateConnectionEndpointId("");
      setShowCreateConnectionModal(false);
      setConnectionsPage(1);
      setConnectionsMessage("Private S3 connection created.");
      await refreshConnections();
      notifyExecutionContextsRefresh();
    } catch (error) {
      console.error(error);
      setConnectionsError(getErrorMessage(error, "Unable to create private S3 connection."));
    } finally {
      setCreatingConnection(false);
    }
  };

  const handleUpdateConnectionDraft = (
    connectionId: number,
    field: keyof ConnectionDraft,
    value: ConnectionDraft[keyof ConnectionDraft]
  ) => {
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
    const credentialDraft = connectionCredentialDrafts[connectionId] ?? { access_key_id: "", secret_access_key: "" };
    const accessKeyId = credentialDraft.access_key_id.trim();
    const secretAccessKey = credentialDraft.secret_access_key.trim();
    const usePresetEndpoint = editConnectionEndpointMode === "preset";
    setConnectionsError(null);
    setConnectionsMessage(null);
    if (!draft.name.trim()) {
      setConnectionsError("Connection name is required.");
      return false;
    }
    if (usePresetEndpoint && !editConnectionEndpointId) {
      setConnectionsError("Select a configured endpoint.");
      return false;
    }
    if (!usePresetEndpoint && !draft.endpoint_url.trim()) {
      setConnectionsError("Endpoint URL is required.");
      return false;
    }
    if (!draft.access_manager && !draft.access_browser) {
      setConnectionsError("Enable access to manager and/or browser.");
      return false;
    }
    if ((accessKeyId && !secretAccessKey) || (!accessKeyId && secretAccessKey)) {
      setConnectionsError("Provide both access key ID and secret access key to update credentials.");
      return false;
    }
    setSavingConnectionBusyId(connectionId);
    try {
      const endpointPayload = usePresetEndpoint
        ? {
            storage_endpoint_id: Number(editConnectionEndpointId),
          }
        : {
            storage_endpoint_id: null,
            provider_hint: draft.provider_hint.trim() || undefined,
            endpoint_url: draft.endpoint_url.trim(),
            region: draft.region.trim() || undefined,
            force_path_style: draft.force_path_style,
            verify_tls: draft.verify_tls,
          };
      await updateConnection(connectionId, {
        name: draft.name.trim(),
        tags: normalizeUiTags(draft.tags),
        access_manager: draft.access_manager,
        access_browser: draft.access_browser,
        ...endpointPayload,
        ...(accessKeyId && secretAccessKey
          ? {
              access_key_id: accessKeyId,
              secret_access_key: secretAccessKey,
            }
          : {}),
      });
      setConnectionCredentialDrafts((prev) => ({
        ...prev,
        [connectionId]: { access_key_id: "", secret_access_key: "" },
      }));
      setConnectionsMessage("Private S3 connection updated.");
      await refreshConnections();
      notifyExecutionContextsRefresh();
      return true;
    } catch (error) {
      console.error(error);
      setConnectionsError(getErrorMessage(error, "Unable to update private S3 connection."));
      return false;
    } finally {
      setSavingConnectionBusyId(null);
    }
  };

  const editConnectionValidationPayload = useMemo(() => {
    if (!editingConnection) return null;
    const draft = connectionDrafts[editingConnection.id] ?? buildConnectionDraft(editingConnection);
    const credentialDraft = connectionCredentialDrafts[editingConnection.id] ?? { access_key_id: "", secret_access_key: "" };
    const accessKeyId = credentialDraft.access_key_id.trim();
    const secretAccessKey = credentialDraft.secret_access_key.trim();
    if (!accessKeyId || !secretAccessKey) return null;
    if (editConnectionEndpointMode === "preset") {
      if (!editConnectionEndpointId) return null;
      return {
        storage_endpoint_id: Number(editConnectionEndpointId),
        access_key_id: accessKeyId,
        secret_access_key: secretAccessKey,
      };
    }
    const endpointUrl = draft.endpoint_url.trim();
    if (!endpointUrl) return null;
    return {
      endpoint_url: endpointUrl,
      region: draft.region.trim() || null,
      access_key_id: accessKeyId,
      secret_access_key: secretAccessKey,
      force_path_style: draft.force_path_style,
      verify_tls: draft.verify_tls,
    };
  }, [
    connectionCredentialDrafts,
    connectionDrafts,
    editConnectionEndpointId,
    editConnectionEndpointMode,
    editingConnection,
  ]);

  const editConnectionValidation = useLiveS3CredentialsValidation({
    enabled: Boolean(editingConnection) && canManagePrivateConnections,
    payload: editConnectionValidationPayload,
    validate: validatePrivateCreateCredentials,
    debounceMs: 450,
  });

  const handleDeletePrivateConnection = async (connectionId: number) => {
    if (!canManagePrivateConnections) return;
    if (!window.confirm("Delete this private S3 connection?")) return;
    setConnectionsError(null);
    setConnectionsMessage(null);
    setDeletingConnectionBusyId(connectionId);
    try {
      await deleteConnection(connectionId);
      setSelectedConnectionIds((prev) => prev.filter((id) => id !== connectionId));
      setConnectionsMessage("Private S3 connection deleted.");
      await refreshConnections();
      notifyExecutionContextsRefresh();
    } catch (error) {
      console.error(error);
      setConnectionsError(getErrorMessage(error, "Unable to delete private S3 connection."));
    } finally {
      setDeletingConnectionBusyId(null);
    }
  };
  const togglePrivateConnectionSelection = (connectionId: number) => {
    setSelectedConnectionIds((prev) =>
      prev.includes(connectionId) ? prev.filter((id) => id !== connectionId) : [...prev, connectionId]
    );
  };

  const toggleSelectAllFilteredConnections = () => {
    if (allFilteredConnectionsSelected) {
      setSelectedConnectionIds([]);
      return;
    }
    setSelectedConnectionIds(filteredConnectionIds);
  };

  const handleBulkActivatePrivateConnections = async () => {
    if (!canManagePrivateConnections || selectedFilteredConnectionIds.length === 0) return;
    setConnectionsError(null);
    setConnectionsMessage(null);
    setBulkActivatingConnections(true);
    const results = await Promise.allSettled(
      selectedFilteredConnectionIds.map((connectionId) => updateConnection(connectionId, { is_active: true }))
    );
    const failedIds = selectedFilteredConnectionIds.filter((_, index) => results[index].status === "rejected");
    const successCount = selectedFilteredConnectionIds.length - failedIds.length;
    setSelectedConnectionIds(failedIds);
    if (successCount > 0) {
      await refreshConnections();
      notifyExecutionContextsRefresh();
    }
    if (failedIds.length > 0) {
      setConnectionsError(`${failedIds.length} private connection${failedIds.length > 1 ? "s" : ""} failed to activate.`);
    }
    setConnectionsMessage(
      `${successCount} private connection${successCount > 1 ? "s" : ""} activated.` +
        (failedIds.length > 0 ? ` ${failedIds.length} failed.` : "")
    );
    setBulkActivatingConnections(false);
  };

  const handleTogglePrivateConnectionStatus = async (connection: S3Connection) => {
    if (!canManagePrivateConnections) return;
    const nextIsActive = connection.is_active !== false ? false : true;
    setConnectionsError(null);
    setConnectionsMessage(null);
    setTogglingConnectionBusyId(connection.id);
    try {
      await updateConnection(connection.id, { is_active: nextIsActive });
      setConnectionsMessage(nextIsActive ? "Private S3 connection activated." : "Private S3 connection disabled.");
      await refreshConnections();
      notifyExecutionContextsRefresh();
    } catch (error) {
      console.error(error);
      setConnectionsError(getErrorMessage(error, "Unable to update private S3 connection."));
    } finally {
      setTogglingConnectionBusyId(null);
    }
  };

  const handleBulkDisablePrivateConnections = async () => {
    if (!canManagePrivateConnections || selectedFilteredConnectionIds.length === 0) return;
    setConnectionsError(null);
    setConnectionsMessage(null);
    setBulkDisablingConnections(true);
    const results = await Promise.allSettled(
      selectedFilteredConnectionIds.map((connectionId) => updateConnection(connectionId, { is_active: false }))
    );
    const failedIds = selectedFilteredConnectionIds.filter((_, index) => results[index].status === "rejected");
    const successCount = selectedFilteredConnectionIds.length - failedIds.length;
    setSelectedConnectionIds(failedIds);
    if (successCount > 0) {
      await refreshConnections();
      notifyExecutionContextsRefresh();
    }
    if (failedIds.length > 0) {
      setConnectionsError(`${failedIds.length} private connection${failedIds.length > 1 ? "s" : ""} failed to disable.`);
    }
    setConnectionsMessage(
      `${successCount} private connection${successCount > 1 ? "s" : ""} disabled.` +
        (failedIds.length > 0 ? ` ${failedIds.length} failed.` : "")
    );
    setBulkDisablingConnections(false);
  };

  const handleBulkDeletePrivateConnections = async () => {
    if (!canManagePrivateConnections || selectedFilteredConnectionIds.length === 0) return;
    const count = selectedFilteredConnectionIds.length;
    if (!window.confirm(`Delete ${count} selected private S3 connection${count > 1 ? "s" : ""}?`)) return;
    setConnectionsError(null);
    setConnectionsMessage(null);
    setBulkDeletingConnections(true);
    const results = await Promise.allSettled(
      selectedFilteredConnectionIds.map((connectionId) => deleteConnection(connectionId))
    );
    const failedIds = selectedFilteredConnectionIds.filter((_, index) => results[index].status === "rejected");
    const successCount = selectedFilteredConnectionIds.length - failedIds.length;
    setSelectedConnectionIds(failedIds);
    if (successCount > 0) {
      await refreshConnections();
      notifyExecutionContextsRefresh();
    }
    if (failedIds.length > 0) {
      setConnectionsError(`${failedIds.length} private connection${failedIds.length > 1 ? "s" : ""} failed to delete.`);
    }
    setConnectionsMessage(
      `${successCount} private connection${successCount > 1 ? "s" : ""} deleted.` +
        (failedIds.length > 0 ? ` ${failedIds.length} failed.` : "")
    );
    setBulkDeletingConnections(false);
  };

  const handleConnectionsFilterChange = (value: string) => {
    setConnectionsFilter(value);
    setSelectedConnectionIds([]);
    setConnectionsPage(1);
  };

  const inputClasses =
    "mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 ui-body text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
  const primaryButtonClasses =
    "inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:pointer-events-none disabled:opacity-60";
  const cardClasses = "ui-surface-card";
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
                  disabled={isS3Session}
                  className={`${inputClasses} ${isS3Session ? "cursor-not-allowed opacity-70" : ""}`}
                  placeholder="Your name"
                />
              </label>
            </div>
            {isS3Session && (
              <p className="ui-caption text-slate-500 dark:text-slate-400">
                Temporary S3 session: user profile is not editable.
              </p>
            )}
            {profileMessage && (
              <p className="ui-caption font-semibold text-emerald-700 dark:text-emerald-300">{profileMessage}</p>
            )}
            <div>
              <button type="submit" disabled={profileSaving || isS3Session} className={primaryButtonClasses}>
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
            <label className="flex items-start gap-3 rounded-md border border-slate-200 px-3 py-3 dark:border-slate-700">
              <input
                type="checkbox"
                checked={preferencesShowSelectorTags}
                onChange={(event) => setPreferencesShowSelectorTags(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
              />
              <span>
                <span className="ui-body text-slate-700 dark:text-slate-200">Show tags in top selectors</span>
                <span className="mt-1 block ui-caption text-slate-500 dark:text-slate-400">
                  Display compact endpoint and context tags in the topbar selectors on this browser only.
                </span>
              </span>
            </label>
            {!isS3Session && (
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700">
                  <input
                    type="checkbox"
                    checked={quotaAlertsEnabled}
                    onChange={(event) => setQuotaAlertsEnabled(event.target.checked)}
                  />
                  <span className="ui-body text-slate-700 dark:text-slate-200">Receive quota alert emails</span>
                </label>
                {canConfigureGlobalQuotaWatch && (
                  <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700">
                    <input
                      type="checkbox"
                      checked={quotaAlertsGlobalWatch}
                      onChange={(event) => setQuotaAlertsGlobalWatch(event.target.checked)}
                    />
                    <span className="ui-body text-slate-700 dark:text-slate-200">
                      Global quota watch (all storage spaces)
                    </span>
                  </label>
                )}
              </div>
            )}
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
                      placeholder="Name, endpoint, provider, tag..."
                      className={`${toolbarCompactInputClasses} w-full sm:w-72`}
                    />
                  </div>
                </div>
                {selectedFilteredConnectionIds.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 dark:border-slate-800 dark:bg-slate-900/50">
                    <span className="ui-caption font-semibold text-slate-700 dark:text-slate-200">
                      {selectedFilteredConnectionIds.length} selected
                      {hiddenSelectedConnectionCount > 0 ? ` (${hiddenSelectedConnectionCount} not visible)` : ""}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className={tableActionButtonClasses}
                        onClick={() => void handleBulkActivatePrivateConnections()}
                        disabled={bulkActivatingConnections || bulkDisablingConnections || bulkDeletingConnections}
                      >
                        {bulkActivatingConnections ? "Activating..." : "Activate selected"}
                      </button>
                      <button
                        type="button"
                        className={tableActionButtonClasses}
                        onClick={() => void handleBulkDisablePrivateConnections()}
                        disabled={bulkActivatingConnections || bulkDisablingConnections || bulkDeletingConnections}
                      >
                        {bulkDisablingConnections ? "Disabling..." : "Disable selected"}
                      </button>
                      <button
                        type="button"
                        className={tableDeleteActionClasses}
                        onClick={() => void handleBulkDeletePrivateConnections()}
                        disabled={bulkActivatingConnections || bulkDisablingConnections || bulkDeletingConnections}
                      >
                        {bulkDeletingConnections ? "Deleting..." : "Delete selected"}
                      </button>
                    </div>
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="compact-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
                    <thead className="bg-slate-50 dark:bg-slate-900/50">
                      <tr>
                        <th className="px-4 py-3 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          <input
                            type="checkbox"
                            aria-label="Select all filtered private connections"
                            checked={allFilteredConnectionsSelected}
                            onChange={toggleSelectAllFilteredConnections}
                            disabled={
                              filteredConnectionIds.length === 0 ||
                              bulkActivatingConnections ||
                              bulkDisablingConnections ||
                              bulkDeletingConnections
                            }
                            className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                          />
                        </th>
                        {["Connection", "Endpoint", "Provider", "Status", "Last update", "Last used", "Actions"].map(
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
                          <td colSpan={8} className="px-4 py-4 ui-body text-slate-500 dark:text-slate-400">
                            Loading connections...
                          </td>
                        </tr>
                      )}
                      {!connectionsLoading && pagedConnections.length === 0 && (
                        <tr>
                          <td colSpan={8} className="px-4 py-4 ui-body text-slate-500 dark:text-slate-400">
                            No private S3 connection configured.
                          </td>
                        </tr>
                      )}
                      {!connectionsLoading &&
                        pagedConnections.map((connection) => {
                          const isActive = connection.is_active !== false;
                          const connectionTagItems = buildUiTagItems(connection.tags);
                          const endpointLabel = connection.storage_endpoint_id
                            ? storageEndpointLabelById.get(connection.storage_endpoint_id) ||
                              `Managed endpoint #${connection.storage_endpoint_id}`
                            : connection.endpoint_url || "-";
                          return (
                            <tr key={connection.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                              <td className="px-4 py-4">
                                <input
                                  type="checkbox"
                                  aria-label={`Select private connection ${connection.name || connection.id}`}
                                  checked={selectedFilteredConnectionIdSet.has(connection.id)}
                                  onChange={() => togglePrivateConnectionSelection(connection.id)}
                                  disabled={bulkActivatingConnections || bulkDisablingConnections || bulkDeletingConnections}
                                  className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                                />
                              </td>
                              <td className="px-4 py-4">
                                <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate ui-body font-semibold text-slate-900 dark:text-slate-100">
                                      {connection.name || "-"}
                                    </p>
                                    <p className="ui-caption text-slate-500 dark:text-slate-400">
                                      Access Key: {connection.access_key_id || "-"}
                                    </p>
                                  </div>
                                  {connectionTagItems.length > 0 && (
                                    <UiTagBadgeList
                                      items={connectionTagItems}
                                      variant="listing-compact"
                                      layout="inline-compact"
                                      className="ml-auto max-w-full"
                                      maxVisible={4}
                                    />
                                  )}
                                </div>
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
                                <span
                                  className={`inline-flex rounded-full px-2 py-1 font-semibold ${
                                    isActive
                                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                                      : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                                  }`}
                                >
                                  {isActive ? "Active" : "Inactive"}
                                </span>
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
                                    disabled={
                                      togglingConnectionBusyId === connection.id ||
                                      bulkActivatingConnections ||
                                      bulkDisablingConnections ||
                                      bulkDeletingConnections
                                    }
                                    onClick={() => void handleTogglePrivateConnectionStatus(connection)}
                                  >
                                    {togglingConnectionBusyId === connection.id ? "Saving..." : isActive ? "Deactivate" : "Activate"}
                                  </button>
                                  <button
                                    type="button"
                                    className={tableActionButtonClasses}
                                    onClick={() => openEditConnectionModal(connection)}
                                    disabled={bulkActivatingConnections || bulkDisablingConnections || bulkDeletingConnections}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    className={tableDeleteActionClasses}
                                    disabled={
                                      deletingConnectionBusyId === connection.id ||
                                      bulkActivatingConnections ||
                                      bulkDisablingConnections ||
                                      bulkDeletingConnections
                                    }
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
                    onPageChange={(page) => {
                      setConnectionsPage(Math.max(1, page));
                      setSelectedConnectionIds([]);
                    }}
                    onPageSizeChange={(size) => {
                      setConnectionsPageSize(size);
                      setSelectedConnectionIds([]);
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
          onClose={() => {
            if (creatingConnection) return null;
            setShowCreateConnectionModal(false);
            return null;
          }}
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
                <div className="sm:col-span-2 space-y-3 rounded-lg border border-slate-200 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/40">
                  <div>
                    <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Endpoint
                    </p>
                    <p className="ui-caption text-slate-500 dark:text-slate-400">
                      Choose a configured endpoint or enter a public HTTPS custom endpoint.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <label className="flex items-center gap-2 ui-caption font-semibold text-slate-600 dark:text-slate-300">
                      <input
                        type="radio"
                        name="create-connection-endpoint-mode"
                        checked={createConnectionEndpointMode === "preset"}
                        onChange={() => setCreateConnectionEndpointMode("preset")}
                        disabled={availableStorageEndpoints.length === 0}
                        className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary disabled:opacity-60"
                      />
                      Configured endpoint
                    </label>
                    <label className="flex items-center gap-2 ui-caption font-semibold text-slate-600 dark:text-slate-300">
                      <input
                        type="radio"
                        name="create-connection-endpoint-mode"
                        checked={createConnectionEndpointMode === "custom"}
                        onChange={() => setCreateConnectionEndpointMode("custom")}
                        className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                      />
                      Custom endpoint
                    </label>
                  </div>
                  {createConnectionEndpointMode === "preset" ? (
                    <label className="block">
                      <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Configured endpoint
                      </span>
                      <select
                        value={createConnectionEndpointId}
                        onChange={(event) => setCreateConnectionEndpointId(event.target.value)}
                        disabled={loadingStorageEndpoints || availableStorageEndpoints.length === 0}
                        className={inputClasses}
                      >
                        <option value="">
                          {loadingStorageEndpoints
                            ? "Loading endpoints..."
                            : availableStorageEndpoints.length === 0
                              ? "No configured endpoint"
                              : "Select endpoint"}
                        </option>
                        {availableStorageEndpoints.map((endpoint) => (
                          <option key={endpoint.id} value={endpoint.id}>
                            {endpoint.name} ({endpoint.endpoint_url})
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
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
                      <label className="block sm:col-span-2">
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
                      <div className="sm:col-span-2 flex flex-wrap items-center gap-4">
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
                    </div>
                  )}
                  {storageEndpointsError && (
                    <p className="ui-caption text-amber-700 dark:text-amber-300">
                      Unable to load configured endpoints ({storageEndpointsError}). Use custom mode.
                    </p>
                  )}
                </div>
                <div className="sm:col-span-2 space-y-3">
                  {privateTagCatalogError && <PageBanner tone="warning">{privateTagCatalogError}</PageBanner>}
                  <UiTagEditor
                    label="Tags"
                    tags={createConnectionForm.tags}
                    catalog={privateTagCatalog}
                    onChange={(tags) => setCreateConnectionForm((prev) => ({ ...prev, tags }))}
                    catalogMode="private"
                    placeholder="Add a tag for this private connection"
                    hint={
                      privateTagCatalogLoading
                        ? "Loading existing private tags..."
                        : "Private tags are used for filtering and optional selector display."
                    }
                  />
                </div>
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
                <div className="sm:col-span-2">
                  {createConnectionValidation.status === "loading" && (
                    <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 ui-caption text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/40 dark:text-blue-100">
                      Validating credentials...
                    </p>
                  )}
                  {createConnectionValidation.status === "done" && createConnectionValidation.result && (
                    <p
                      className={`rounded-md px-3 py-2 ui-caption ${
                        createConnectionValidation.result.severity === "success"
                          ? "border border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/50 dark:text-emerald-200"
                          : createConnectionValidation.result.severity === "warning"
                            ? "border border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/60 dark:text-amber-100"
                            : "border border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/50 dark:text-rose-200"
                      }`}
                    >
                      {createConnectionValidation.result.message}
                    </p>
                  )}
                </div>
                <div className="sm:col-span-2 space-y-2 rounded-lg border border-slate-200 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/40">
                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Workspace access</p>
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2 ui-caption font-semibold text-slate-600 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={createConnectionForm.access_manager}
                        onChange={(event) =>
                          setCreateConnectionForm((prev) => ({ ...prev, access_manager: event.target.checked }))
                        }
                        className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                      />
                      Access manager
                    </label>
                    <label className="flex items-center gap-2 ui-caption font-semibold text-slate-600 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={createConnectionForm.access_browser}
                        onChange={(event) =>
                          setCreateConnectionForm((prev) => ({ ...prev, access_browser: event.target.checked }))
                        }
                        className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                      />
                      Access browser
                    </label>
                  </div>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">At least one access must be enabled.</p>
                </div>
              </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className={secondaryButtonClasses}
                onClick={() => {
                  setShowCreateConnectionModal(false);
                }}
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
          onClose={() => {
            if (savingConnectionBusyId === editingConnection.id) return null;
            setEditingConnectionId(null);
            return null;
          }}
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
              const credentialDraft = connectionCredentialDrafts[editingConnection.id] ?? {
                access_key_id: "",
                secret_access_key: "",
              };
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
                      </div>

                      <div className="space-y-3">
                        {privateTagCatalogError && <PageBanner tone="warning">{privateTagCatalogError}</PageBanner>}
                        <UiTagEditor
                          label="Tags"
                          tags={draft.tags}
                          catalog={privateTagCatalog}
                          onChange={(tags) => handleUpdateConnectionDraft(editingConnection.id, "tags", tags)}
                          catalogMode="private"
                          placeholder="Add a tag for this private connection"
                          hint={
                            privateTagCatalogLoading
                              ? "Loading existing private tags..."
                              : "Private tags are used for filtering and optional selector display."
                          }
                        />
                      </div>

                      <div className="space-y-3 rounded-lg border border-slate-200 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/40">
                        <div>
                          <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Endpoint
                          </p>
                          <p className="ui-caption text-slate-500 dark:text-slate-400">
                            Choose a configured endpoint or enter a public HTTPS custom endpoint.
                          </p>
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <label className="flex items-center gap-2 ui-caption font-semibold text-slate-600 dark:text-slate-300">
                            <input
                              type="radio"
                              name={`edit-connection-endpoint-mode-${editingConnection.id}`}
                              checked={editConnectionEndpointMode === "preset"}
                              onChange={() => setEditConnectionEndpointMode("preset")}
                              disabled={availableStorageEndpoints.length === 0}
                              className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary disabled:opacity-60"
                            />
                            Configured endpoint
                          </label>
                          <label className="flex items-center gap-2 ui-caption font-semibold text-slate-600 dark:text-slate-300">
                            <input
                              type="radio"
                              name={`edit-connection-endpoint-mode-${editingConnection.id}`}
                              checked={editConnectionEndpointMode === "custom"}
                              onChange={() => setEditConnectionEndpointMode("custom")}
                              className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                            />
                            Custom endpoint
                          </label>
                        </div>
                        {editConnectionEndpointMode === "preset" ? (
                          <label className="block">
                            <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Configured endpoint
                            </span>
                            <select
                              value={editConnectionEndpointId}
                              onChange={(event) => setEditConnectionEndpointId(event.target.value)}
                              disabled={loadingStorageEndpoints || availableStorageEndpoints.length === 0}
                              className={inputClasses}
                            >
                              <option value="">
                                {loadingStorageEndpoints
                                  ? "Loading endpoints..."
                                  : availableStorageEndpoints.length === 0
                                    ? "No configured endpoint"
                                    : "Select endpoint"}
                              </option>
                              {availableStorageEndpoints.map((endpoint) => (
                                <option key={endpoint.id} value={endpoint.id}>
                                  {endpoint.name} ({endpoint.endpoint_url})
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <div className="grid gap-3 sm:grid-cols-2">
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
                                placeholder="aws | minio | ceph ..."
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
                                className={inputClasses}
                                placeholder="us-east-1"
                              />
                            </label>
                            <label className="block sm:col-span-2">
                              <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                Endpoint URL
                              </span>
                              <input
                                type="url"
                                value={draft.endpoint_url}
                                onChange={(event) =>
                                  handleUpdateConnectionDraft(editingConnection.id, "endpoint_url", event.target.value)
                                }
                                className={inputClasses}
                                placeholder="https://s3.example.com"
                              />
                            </label>
                            <div className="sm:col-span-2 flex flex-wrap items-center gap-4">
                              <label className="flex items-center gap-2 ui-caption font-semibold text-slate-600 dark:text-slate-300">
                                <input
                                  type="checkbox"
                                  checked={Boolean(draft.force_path_style)}
                                  onChange={(event) =>
                                    handleUpdateConnectionDraft(
                                      editingConnection.id,
                                      "force_path_style",
                                      event.target.checked
                                    )
                                  }
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
                                  className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                                />
                                Verify TLS
                              </label>
                            </div>
                          </div>
                        )}
                        {storageEndpointsError && (
                          <p className="ui-caption text-amber-700 dark:text-amber-300">
                            Unable to load configured endpoints ({storageEndpointsError}). Use custom mode.
                          </p>
                        )}
                      </div>

                      <div className="space-y-2 rounded-lg border border-slate-200 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/40">
                        <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Credentials
                        </p>
                        <p className="ui-caption text-slate-500 dark:text-slate-400">
                          Current Access Key: <span className="ui-mono">{editingConnection.access_key_id || "-"}</span>
                        </p>
                        <p className="ui-caption text-slate-500 dark:text-slate-400">
                          Leave blank to keep current credentials.
                        </p>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="block">
                            <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Access key ID
                            </span>
                            <input
                              type="text"
                              value={credentialDraft.access_key_id}
                              onChange={(event) =>
                                handleUpdateConnectionCredentialDraft(editingConnection.id, "access_key_id", event.target.value)
                              }
                              className={inputClasses}
                              placeholder="AKIA..."
                            />
                          </label>
                          <label className="block">
                            <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Secret access key
                            </span>
                            <input
                              type="password"
                              value={credentialDraft.secret_access_key}
                              onChange={(event) =>
                                handleUpdateConnectionCredentialDraft(
                                  editingConnection.id,
                                  "secret_access_key",
                                  event.target.value
                                )
                              }
                              className={inputClasses}
                              placeholder="********"
                            />
                          </label>
                        </div>
                        {editConnectionValidation.status === "loading" && (
                          <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 ui-caption text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/40 dark:text-blue-100">
                            Validating credentials...
                          </p>
                        )}
                        {editConnectionValidation.status === "done" && editConnectionValidation.result && (
                          <p
                            className={`rounded-md px-3 py-2 ui-caption ${
                              editConnectionValidation.result.severity === "success"
                                ? "border border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/50 dark:text-emerald-200"
                                : editConnectionValidation.result.severity === "warning"
                                  ? "border border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/60 dark:text-amber-100"
                                  : "border border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/50 dark:text-rose-200"
                            }`}
                          >
                            {editConnectionValidation.result.message}
                          </p>
                        )}
                      </div>

                      <div className="space-y-2 rounded-lg border border-slate-200 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/40">
                        <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Workspace access</p>
                        <div className="flex flex-wrap items-center gap-4">
                          <label className="flex items-center gap-2 ui-caption font-semibold text-slate-600 dark:text-slate-300">
                            <input
                              type="checkbox"
                              checked={Boolean(draft.access_manager)}
                              onChange={(event) =>
                                handleUpdateConnectionDraft(editingConnection.id, "access_manager", event.target.checked)
                              }
                              className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                            />
                            Access manager
                          </label>
                          <label className="flex items-center gap-2 ui-caption font-semibold text-slate-600 dark:text-slate-300">
                            <input
                              type="checkbox"
                              checked={Boolean(draft.access_browser)}
                              onChange={(event) =>
                                handleUpdateConnectionDraft(editingConnection.id, "access_browser", event.target.checked)
                              }
                              className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                            />
                            Access browser
                          </label>
                        </div>
                        <p className="ui-caption text-slate-500 dark:text-slate-400">At least one access must be enabled.</p>
                      </div>
                </>
              );
            })()}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className={secondaryButtonClasses}
                onClick={() => {
                  setEditingConnectionId(null);
                }}
                disabled={savingConnectionBusyId === editingConnection.id}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={primaryButtonClasses}
                disabled={savingConnectionBusyId === editingConnection.id}
              >
                {savingConnectionBusyId === editingConnection.id ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
