/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isApiError } from "../../api/client";
import { useSearchParams } from "react-router-dom";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import WorkflowPage, { workflowPageHostClass } from "../../components/WorkflowPage";
import PaginationControls from "../../components/PaginationControls";
import UiTagBadgeList from "../../components/UiTagBadgeList";
import UiTagEditor from "../../components/UiTagEditor";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import UiButton from "../../components/ui/UiButton";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import UserAvatar from "../../components/UserAvatar";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { toolbarCompactInputClasses } from "../../components/toolbarControlClasses";
import { cx, uiDataTableClass } from "../../components/ui/styles";
import { useTheme } from "../../components/theme";
import { UiLanguagePreference, useLanguage } from "../../components/language";
import {
  deleteCurrentUserAvatar,
  fetchCurrentUser,
  updateCurrentUser,
  uploadCurrentUserAvatar,
  type UserAvatarDescriptor,
  type UserAvatarPreference,
} from "../../api/users";
import {
  S3Connection,
  createConnection,
  deleteConnection,
  listConnections,
  listPrivateConnectionStorageEndpoints,
  type PrivateConnectionStorageEndpoint,
  updateConnection,
  validateConnectionCredentials,
} from "../../api/connections";
import type { S3CredentialsValidationPayload } from "../../api/s3CredentialsValidation";
import { retryManagedPrivateAccessCleanup } from "../../api/managedPrivateAccess";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { useLiveS3CredentialsValidation } from "./useLiveS3CredentialsValidation";
import { notifyExecutionContextsRefresh } from "../../utils/executionContextRefresh";
import { stableSignature } from "../../utils/stableSignature";
import { removeClientStorage, writeClientStorage } from "../../utils/clientStorage";
import { updateStoredUserProfile } from "./profileStoredUser";
import {
  WORKSPACE_STORAGE_KEY,
  canAccessPrivateConnectionsSection,
  canCreateManualPrivateConnections,
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
import { buildUiTagItems } from "../../utils/uiTags";
import { useTagCatalog } from "../../hooks/useTagCatalog";
import S3ConnectionAccessFields from "./S3ConnectionAccessFields";
import S3ConnectionCredentialFields from "./S3ConnectionCredentialFields";
import S3ConnectionEndpointFields from "./S3ConnectionEndpointFields";
import S3CredentialsValidationMessage from "./S3CredentialsValidationMessage";
import {
  buildCreatePrivateConnectionSignature,
  buildEditPrivateConnectionSignature,
  buildPrivateConnectionDraft,
  buildPrivateConnectionEditorState,
  buildPrivateConnectionsProjection,
  buildPrivateStorageEndpointLabelById,
  buildS3CredentialsValidationPayload,
  createDefaultPrivateConnectionForm,
  createEmptyConnectionCredentialDraft,
  type ConnectionCredentialDraft,
  type CreatePrivateConnectionForm,
  type PrivateConnectionDraft,
  type S3ConnectionEndpointMode,
  prepareCreatePrivateConnectionPayload,
  prepareUpdatePrivateConnectionPayload,
} from "./s3ConnectionFormModel";

type PendingPrivateConnectionDelete = {
  scope: "single" | "bulk";
  connections: S3Connection[];
};

const privateConnectionsTableClass = cx(uiDataTableClass, "compact-table min-w-full");

function persistStoredUser(values: {
  fullName?: string | null;
  uiLanguage?: "en" | "fr" | "de" | null;
  avatar?: UserAvatarDescriptor | null;
}) {
  if (typeof window === "undefined") return;
  updateStoredUserProfile(values);
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (isApiError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
    if (detail && typeof detail === "object" && "message" in detail && typeof detail.message === "string") {
      return detail.message;
    }
  }
  return fallback;
}

function avatarSourceLabel(avatar?: UserAvatarDescriptor | null): string {
  if (avatar?.source === "uploaded") return "Uploaded profile image";
  if (avatar?.source === "provider") return "Identity provider image";
  if (avatar?.source === "gravatar") return "Gravatar";
  return "Initials";
}

function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

type ProfilePageProps = {
  showPageHeader?: boolean;
  showSettingsCards?: boolean;
  showConnectionsSection?: boolean;
  onUnsavedChangesChange?: (dirty: boolean) => void;
};

export default function ProfilePage({
  showPageHeader = true,
  showSettingsCards: showSettingsCardsProp = true,
  showConnectionsSection: showConnectionsSectionProp = false,
  onUnsavedChangesChange,
}: ProfilePageProps) {
  const [searchParams] = useSearchParams();
  const profileView = searchParams.get("view");
  const showConnectionsSection = showConnectionsSectionProp || profileView === "connections";
  const showSettingsCards = showSettingsCardsProp && profileView !== "connections";
  const storedUser = useMemo<SessionUser | null>(() => readStoredUser(), []);
  const authType = storedUser?.authType ?? null;
  const isS3Session = authType === "s3_session";
  const { generalSettings } = useGeneralSettings();
  const canEditProfileName = !isS3Session && generalSettings.allow_user_profile_name_edit;
  const { theme, setTheme } = useTheme();
  const { languagePreference, setLanguagePreference } = useLanguage();
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [fullName, setFullName] = useState("");
  const [avatar, setAvatar] = useState<UserAvatarDescriptor | null>(storedUser?.avatar ?? null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
  const [profileTouched, setProfileTouched] = useState(false);
  const [profileInitialSignature, setProfileInitialSignature] = useState(() => stableSignature({ fullName: "" }));
  const [preferencesMessage, setPreferencesMessage] = useState<string | null>(null);
  const [preferencesMessageTone, setPreferencesMessageTone] = useState<"success" | "error">("success");
  const [preferencesTheme, setPreferencesTheme] = useState<"light" | "dark">(theme);
  const [preferencesLanguage, setPreferencesLanguage] = useState<UiLanguagePreference>(languagePreference);
  const [preferencesShowSelectorTags, setPreferencesShowSelectorTags] = useState<boolean>(() => readSelectorTagsPreference());
  const [preferencesTouched, setPreferencesTouched] = useState(false);
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
  const [pendingConnectionDelete, setPendingConnectionDelete] = useState<PendingPrivateConnectionDelete | null>(null);
  const [editingConnectionId, setEditingConnectionId] = useState<number | null>(null);
  const [createConnectionForm, setCreateConnectionForm] = useState(createDefaultPrivateConnectionForm);
  const [createConnectionEndpointMode, setCreateConnectionEndpointMode] = useState<S3ConnectionEndpointMode>("custom");
  const [createConnectionEndpointId, setCreateConnectionEndpointId] = useState("");
  const [editConnectionEndpointMode, setEditConnectionEndpointMode] = useState<S3ConnectionEndpointMode>("custom");
  const [editConnectionEndpointId, setEditConnectionEndpointId] = useState("");
  const [createConnectionInitialSignature, setCreateConnectionInitialSignature] = useState(() =>
    buildCreatePrivateConnectionSignature(createDefaultPrivateConnectionForm(), "custom", "")
  );
  const [editConnectionInitialSignature, setEditConnectionInitialSignature] = useState(() =>
    buildEditPrivateConnectionSignature(
      buildPrivateConnectionDraft({ id: 0 } as S3Connection),
      createEmptyConnectionCredentialDraft(),
      "custom",
      "",
    )
  );
  const [availableStorageEndpoints, setAvailableStorageEndpoints] = useState<PrivateConnectionStorageEndpoint[]>([]);
  const [loadingStorageEndpoints, setLoadingStorageEndpoints] = useState(false);
  const [storageEndpointsError, setStorageEndpointsError] = useState<string | null>(null);
  const [connectionDrafts, setConnectionDrafts] = useState<Record<number, PrivateConnectionDraft>>({});
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
  const [preferencesInitialSignature, setPreferencesInitialSignature] = useState(() =>
    stableSignature({
      preferencesTheme: theme,
      preferencesLanguage: languagePreference,
      preferredWorkspace: readStoredWorkspaceId(),
      preferencesShowSelectorTags: readSelectorTagsPreference(),
      quotaAlertsEnabled: true,
      quotaAlertsGlobalWatch: false,
    })
  );
  const canConfigureGlobalQuotaWatch = isAdminLikeRole(storedUser?.role);
  const canCreateManualConnections =
    !isS3Session && canCreateManualPrivateConnections(storedUser);
  const canAccessConnectionsSection =
    !isS3Session && canAccessPrivateConnectionsSection(storedUser);

  const profileCurrentSignature = useMemo(() => stableSignature({ fullName }), [fullName]);
  const preferencesCurrentSignature = useMemo(
    () =>
      stableSignature({
        preferencesTheme,
        preferencesLanguage,
        preferredWorkspace,
        preferencesShowSelectorTags,
        quotaAlertsEnabled,
        quotaAlertsGlobalWatch: canConfigureGlobalQuotaWatch ? quotaAlertsGlobalWatch : false,
      }),
    [
      canConfigureGlobalQuotaWatch,
      preferencesLanguage,
      preferencesShowSelectorTags,
      preferencesTheme,
      preferredWorkspace,
      quotaAlertsEnabled,
      quotaAlertsGlobalWatch,
    ]
  );
  const settingsHaveUnsavedChanges =
    showSettingsCards &&
    ((profileTouched && profileCurrentSignature !== profileInitialSignature) ||
      (preferencesTouched && preferencesCurrentSignature !== preferencesInitialSignature));

  useEffect(() => {
    if (!showSettingsCards || profileTouched) return;
    setProfileInitialSignature(profileCurrentSignature);
  }, [profileCurrentSignature, profileTouched, showSettingsCards]);

  useEffect(() => {
    if (!showSettingsCards || preferencesTouched) return;
    setPreferencesInitialSignature(preferencesCurrentSignature);
  }, [preferencesCurrentSignature, preferencesTouched, showSettingsCards]);

  const createConnectionValidationPayload = useMemo(
    () =>
      buildS3CredentialsValidationPayload(
        createConnectionForm,
        createConnectionEndpointMode,
        createConnectionEndpointId,
      ),
    [createConnectionEndpointId, createConnectionEndpointMode, createConnectionForm],
  );

  const validatePrivateCreateCredentials = useCallback(
    (payload: S3CredentialsValidationPayload) => validateConnectionCredentials(payload),
    []
  );

  const createConnectionValidation = useLiveS3CredentialsValidation({
    enabled: showCreateConnectionModal && canCreateManualConnections,
    payload: createConnectionValidationPayload,
    validate: validatePrivateCreateCredentials,
    debounceMs: 450,
  });

  const {
    allFilteredConnectionsSelected,
    filteredConnectionIdSet,
    filteredConnectionIds,
    filteredConnections,
    hiddenSelectedConnectionCount,
    pagedConnections,
    selectedFilteredConnectionIdSet,
    selectedFilteredConnectionIds,
  } = useMemo(
    () =>
      buildPrivateConnectionsProjection({
        connections,
        filter: connectionsFilter,
        page: connectionsPage,
        pageSize: connectionsPageSize,
        selectedConnectionIds,
      }),
    [
      connections,
      connectionsFilter,
      connectionsPage,
      connectionsPageSize,
      selectedConnectionIds,
    ],
  );
  const storageEndpointLabelById = useMemo(
    () => buildPrivateStorageEndpointLabelById(availableStorageEndpoints),
    [availableStorageEndpoints],
  );

  const editingConnection = useMemo(
    () =>
      editingConnectionId == null ? null : connections.find((connection) => connection.id === editingConnectionId) ?? null,
    [connections, editingConnectionId]
  );

  const createConnectionCurrentSignature = useMemo(
    () =>
      buildCreatePrivateConnectionSignature(
        createConnectionForm,
        createConnectionEndpointMode,
        createConnectionEndpointId
      ),
    [createConnectionEndpointId, createConnectionEndpointMode, createConnectionForm]
  );

  const closeCreateConnectionModal = useCallback(() => {
    if (creatingConnection) return;
    setShowCreateConnectionModal(false);
    setCreateConnectionForm(createDefaultPrivateConnectionForm());
    setCreateConnectionEndpointMode("custom");
    setCreateConnectionEndpointId("");
  }, [creatingConnection]);

  const closeEditConnectionModal = useCallback(() => {
    if (editingConnection && savingConnectionBusyId === editingConnection.id) return;
    if (editingConnection) {
      setConnectionDrafts((prev) => ({
        ...prev,
        [editingConnection.id]: buildPrivateConnectionDraft(editingConnection),
      }));
      setConnectionCredentialDrafts((prev) => ({
        ...prev,
        [editingConnection.id]: createEmptyConnectionCredentialDraft(),
      }));
    }
    setEditingConnectionId(null);
  }, [editingConnection, savingConnectionBusyId]);

  const editConnectionCurrentSignature = useMemo(() => {
    if (!editingConnection) return editConnectionInitialSignature;
    const draft = connectionDrafts[editingConnection.id] ?? buildPrivateConnectionDraft(editingConnection);
    const credentialDraft =
      connectionCredentialDrafts[editingConnection.id] ?? createEmptyConnectionCredentialDraft();
    return buildEditPrivateConnectionSignature(
      draft,
      credentialDraft,
      editConnectionEndpointMode,
      editConnectionEndpointId
    );
  }, [
    connectionCredentialDrafts,
    connectionDrafts,
    editConnectionEndpointId,
    editConnectionEndpointMode,
    editConnectionInitialSignature,
    editingConnection,
  ]);

  const connectionHasUnsavedChanges =
    (showCreateConnectionModal && createConnectionCurrentSignature !== createConnectionInitialSignature) ||
    (Boolean(editingConnection) && editConnectionCurrentSignature !== editConnectionInitialSignature);

  useEffect(() => {
    onUnsavedChangesChange?.(settingsHaveUnsavedChanges || connectionHasUnsavedChanges);
  }, [connectionHasUnsavedChanges, onUnsavedChangesChange, settingsHaveUnsavedChanges]);

  const createConnectionCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showCreateConnectionModal && createConnectionCurrentSignature !== createConnectionInitialSignature,
    onClose: closeCreateConnectionModal,
    disabled: creatingConnection,
    zIndexClass: "z-[70]",
  });

  const editConnectionCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: Boolean(editingConnection) && editConnectionCurrentSignature !== editConnectionInitialSignature,
    onClose: closeEditConnectionModal,
    disabled: editingConnection ? savingConnectionBusyId === editingConnection.id : false,
    zIndexClass: "z-[70]",
  });

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
        const nextFullName = user.full_name ?? "";
        const nextLanguage = user.ui_language ?? "auto";
        const nextQuotaAlertsEnabled = user.quota_alerts_enabled !== false;
        const nextQuotaAlertsGlobalWatch = Boolean(user.quota_alerts_global_watch);
        setFullName(nextFullName);
        setAvatar(user.avatar ?? null);
        setProfileTouched(false);
        setLanguagePreference(nextLanguage);
        setPreferencesLanguage(nextLanguage);
        setQuotaAlertsEnabled(nextQuotaAlertsEnabled);
        setQuotaAlertsGlobalWatch(nextQuotaAlertsGlobalWatch);
        setPreferencesTouched(false);
        persistStoredUser({ uiLanguage: user.ui_language ?? null, avatar: user.avatar ?? null });
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
    if (!showConnectionsSection || !canAccessConnectionsSection) {
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
        const editorState = buildPrivateConnectionEditorState(items);
        setConnections(items);
        setConnectionDrafts(editorState.drafts);
        setConnectionCredentialDrafts(editorState.credentialDrafts);
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
  }, [canAccessConnectionsSection, showConnectionsSection]);

  useEffect(() => {
    if (!showConnectionsSection || !canCreateManualConnections) {
      setAvailableStorageEndpoints([]);
      setStorageEndpointsError(null);
      setLoadingStorageEndpoints(false);
      return;
    }
    let cancelled = false;
    setLoadingStorageEndpoints(true);
    setStorageEndpointsError(null);
    listPrivateConnectionStorageEndpoints()
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
  }, [canCreateManualConnections, showConnectionsSection]);

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
    if (!canCreateManualConnections || editingConnection.server_managed) return;
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
    canCreateManualConnections,
    editConnectionEndpointId,
    editConnectionEndpointMode,
    editingConnection,
  ]);

  const refreshConnections = async () => {
    if (!showConnectionsSection || !canAccessConnectionsSection) return;
    setConnectionsLoading(true);
    setConnectionsError(null);
    try {
      const items = await listConnections();
      const editorState = buildPrivateConnectionEditorState(items);
      setConnections(items);
      setConnectionDrafts(editorState.drafts);
      setConnectionCredentialDrafts(editorState.credentialDrafts);
    } catch (error) {
      console.error(error);
      setConnectionsError(getErrorMessage(error, "Unable to refresh private S3 connections."));
    } finally {
      setConnectionsLoading(false);
    }
  };

  const openCreateConnectionModal = () => {
    if (!canCreateManualConnections) return;
    setConnectionsError(null);
    setConnectionsMessage(null);
    const nextForm: CreatePrivateConnectionForm =
      createDefaultPrivateConnectionForm();
    let nextEndpointMode: S3ConnectionEndpointMode = "custom";
    let nextEndpointId = "";
    if (availableStorageEndpoints.length > 0) {
      const preferred = availableStorageEndpoints.find((item) => item.is_default) ?? availableStorageEndpoints[0];
      nextEndpointMode = "preset";
      nextEndpointId = String(preferred.id);
    }
    setCreateConnectionForm(nextForm);
    setCreateConnectionEndpointMode(nextEndpointMode);
    setCreateConnectionEndpointId(nextEndpointId);
    setCreateConnectionInitialSignature(
      buildCreatePrivateConnectionSignature(
        nextForm,
        nextEndpointMode,
        nextEndpointId,
      ),
    );
    setShowCreateConnectionModal(true);
  };

  const openEditConnectionModal = (connection: S3Connection) => {
    setConnectionsError(null);
    setConnectionsMessage(null);
    const nextDraft = buildPrivateConnectionDraft(connection);
    const nextCredentialDraft = createEmptyConnectionCredentialDraft();
    setConnectionDrafts((prev) => ({
      ...prev,
      [connection.id]: nextDraft,
    }));
    let nextEndpointMode: S3ConnectionEndpointMode = "custom";
    let nextEndpointId = "";
    if (connection.storage_endpoint_id != null) {
      nextEndpointMode = "preset";
      nextEndpointId = String(connection.storage_endpoint_id);
    }
    setEditConnectionEndpointMode(nextEndpointMode);
    setEditConnectionEndpointId(nextEndpointId);
    setConnectionCredentialDrafts((prev) => ({
      ...prev,
      [connection.id]: nextCredentialDraft,
    }));
    setEditConnectionInitialSignature(
      buildEditPrivateConnectionSignature(
        nextDraft,
        nextCredentialDraft,
        nextEndpointMode,
        nextEndpointId,
      ),
    );
    setEditingConnectionId(connection.id);
  };

  const handleProfileSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEditProfileName) return;
    setProfileSaving(true);
    setProfileError(null);
    setProfileMessage(null);
    try {
      const updated = await updateCurrentUser({ full_name: fullName.trim() || null });
      const updatedName = updated.full_name ?? null;
      setFullName(updatedName ?? "");
      setProfileInitialSignature(stableSignature({ fullName: updatedName ?? "" }));
      setProfileTouched(false);
      persistStoredUser({ fullName: updatedName });
      setProfileMessage("Profile updated.");
    } catch (error) {
      console.error(error);
      setProfileError(getErrorMessage(error, "Unable to save profile."));
    } finally {
      setProfileSaving(false);
    }
  };

  const applyAvatarResponse = (updatedAvatar?: UserAvatarDescriptor | null) => {
    const nextAvatar = updatedAvatar ?? null;
    setAvatar(nextAvatar);
    persistStoredUser({ avatar: nextAvatar });
  };

  const handleAvatarPreferenceChange = async (preference: UserAvatarPreference) => {
    if (isS3Session || avatarBusy) return;
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      const updated = await updateCurrentUser({ avatar_preference: preference });
      applyAvatarResponse(updated.avatar);
      setProfileMessage("Avatar updated.");
    } catch (error) {
      console.error(error);
      setAvatarError(getErrorMessage(error, "Unable to update avatar."));
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleAvatarUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || isS3Session || avatarBusy) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      setAvatarError("Choose a PNG or JPEG image.");
      return;
    }
    if (file.size > 1024 * 1024) {
      setAvatarError("Avatar image must be 1 MiB or smaller.");
      return;
    }
    setAvatarBusy(true);
    setAvatarError(null);
    setProfileMessage(null);
    try {
      const updated = await uploadCurrentUserAvatar(file);
      applyAvatarResponse(updated.avatar);
      setProfileMessage("Profile image uploaded.");
    } catch (error) {
      console.error(error);
      setAvatarError(getErrorMessage(error, "Unable to upload profile image."));
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleAvatarDelete = async () => {
    if (isS3Session || avatarBusy) return;
    setAvatarBusy(true);
    setAvatarError(null);
    setProfileMessage(null);
    try {
      const updated = await deleteCurrentUserAvatar();
      applyAvatarResponse(updated.avatar);
      setProfileMessage("Profile image removed.");
    } catch (error) {
      console.error(error);
      setAvatarError(getErrorMessage(error, "Unable to remove profile image."));
    } finally {
      setAvatarBusy(false);
    }
  };

  const handlePreferencesSave = async (event: FormEvent) => {
    event.preventDefault();
    setPreferencesMessage(null);
    setPreferencesMessageTone("success");
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
        setPreferencesMessageTone("error");
        setPreferencesMessage(getErrorMessage(error, "Unable to save language preference."));
        return;
      }
    } else {
      setLanguagePreference(preferencesLanguage);
    }
    if (preferredWorkspace) {
      writeClientStorage(WORKSPACE_STORAGE_KEY, preferredWorkspace);
    } else {
      removeClientStorage(WORKSPACE_STORAGE_KEY);
    }
    writeSelectorTagsPreference(preferencesShowSelectorTags);
    setPreferencesInitialSignature(preferencesCurrentSignature);
    setPreferencesTouched(false);
    setPreferencesMessageTone("success");
    setPreferencesMessage("Preferences saved.");
  };

  const handleCreatePrivateConnection = async (event: FormEvent) => {
    event.preventDefault();
    if (!canCreateManualConnections) return;
    setConnectionsError(null);
    setConnectionsMessage(null);
    const prepared = prepareCreatePrivateConnectionPayload(
      createConnectionForm,
      createConnectionEndpointMode,
      createConnectionEndpointId,
    );
    if (prepared.payload === null) {
      setConnectionsError(prepared.error);
      return;
    }
    setCreatingConnection(true);
    try {
      await createConnection(prepared.payload);
      setCreateConnectionForm(createDefaultPrivateConnectionForm());
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
    field: keyof PrivateConnectionDraft,
    value: PrivateConnectionDraft[keyof PrivateConnectionDraft]
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
    if (!canAccessConnectionsSection) return false;
    const draft = connectionDrafts[connectionId];
    if (!draft) return false;
    const credentialDraft =
      connectionCredentialDrafts[connectionId] ??
      createEmptyConnectionCredentialDraft();
    const connection = connections.find((item) => item.id === connectionId);
    const serverManaged = Boolean(connection?.server_managed);
    setConnectionsError(null);
    setConnectionsMessage(null);
    const prepared = prepareUpdatePrivateConnectionPayload({
      canManageCredentials: canCreateManualConnections,
      credentialDraft,
      draft,
      endpointId: editConnectionEndpointId,
      endpointMode: editConnectionEndpointMode,
      serverManaged,
    });
    if (prepared.payload === null) {
      setConnectionsError(prepared.error);
      return false;
    }
    setSavingConnectionBusyId(connectionId);
    try {
      await updateConnection(connectionId, prepared.payload);
      setConnectionCredentialDrafts((prev) => ({
        ...prev,
        [connectionId]: createEmptyConnectionCredentialDraft(),
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
    if (!editingConnection || editingConnection.server_managed) return null;
    const draft =
      connectionDrafts[editingConnection.id] ??
      buildPrivateConnectionDraft(editingConnection);
    const credentialDraft =
      connectionCredentialDrafts[editingConnection.id] ??
      createEmptyConnectionCredentialDraft();
    return buildS3CredentialsValidationPayload(
      { ...draft, ...credentialDraft },
      editConnectionEndpointMode,
      editConnectionEndpointId,
    );
  }, [
    connectionCredentialDrafts,
    connectionDrafts,
    editConnectionEndpointId,
    editConnectionEndpointMode,
    editingConnection,
  ]);

  const editConnectionValidation = useLiveS3CredentialsValidation({
    enabled: Boolean(editingConnection) && !editingConnection?.server_managed && canCreateManualConnections,
    payload: editConnectionValidationPayload,
    validate: validatePrivateCreateCredentials,
    debounceMs: 450,
  });

  const handleDeletePrivateConnection = (connection: S3Connection) => {
    if (!canAccessConnectionsSection) return;
    setPendingConnectionDelete({ scope: "single", connections: [connection] });
  };

  const confirmDeletePrivateConnection = async (connectionId: number) => {
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

  const handleRetryManagedCleanup = async (connectionId: number) => {
    setConnectionsError(null);
    setConnectionsMessage(null);
    setDeletingConnectionBusyId(connectionId);
    try {
      await retryManagedPrivateAccessCleanup(connectionId);
      setConnectionsMessage("Managed private access cleanup completed.");
      await refreshConnections();
      notifyExecutionContextsRefresh();
    } catch (error) {
      console.error(error);
      setConnectionsError(getErrorMessage(error, "Unable to complete managed private access cleanup."));
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
    if (!canAccessConnectionsSection || selectedFilteredConnectionIds.length === 0) return;
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
    if (!canAccessConnectionsSection) return;
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
    if (!canAccessConnectionsSection || selectedFilteredConnectionIds.length === 0) return;
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

  const handleBulkDeletePrivateConnections = () => {
    if (!canAccessConnectionsSection || selectedFilteredConnectionIds.length === 0) return;
    const selectedIdSet = new Set(selectedFilteredConnectionIds);
    setPendingConnectionDelete({
      scope: "bulk",
      connections: connections.filter((connection) => selectedIdSet.has(connection.id)),
    });
  };

  const confirmBulkDeletePrivateConnections = async (connectionIds: number[]) => {
    setConnectionsError(null);
    setConnectionsMessage(null);
    setBulkDeletingConnections(true);
    try {
      const results = await Promise.allSettled(connectionIds.map((connectionId) => deleteConnection(connectionId)));
      const failedIds = connectionIds.filter((_, index) => results[index].status === "rejected");
      const successCount = connectionIds.length - failedIds.length;
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
    } finally {
      setBulkDeletingConnections(false);
    }
  };

  const confirmPendingConnectionDelete = async () => {
    if (!pendingConnectionDelete) return;
    try {
      if (pendingConnectionDelete.scope === "single") {
        const connection = pendingConnectionDelete.connections[0];
        if (connection) await confirmDeletePrivateConnection(connection.id);
      } else {
        await confirmBulkDeletePrivateConnections(pendingConnectionDelete.connections.map((connection) => connection.id));
      }
    } finally {
      setPendingConnectionDelete(null);
    }
  };

  const handleConnectionsFilterChange = (value: string) => {
    setConnectionsFilter(value);
    setSelectedConnectionIds([]);
    setConnectionsPage(1);
  };

  const cardClasses = "ui-surface-card";
  const sectionHeadingClasses = "ui-body font-semibold text-slate-900 dark:text-slate-100";
  const sectionDescriptionClasses = "ui-caption text-slate-500 dark:text-slate-400";

  return (
    <div className={workflowPageHostClass(showConnectionsSection && (showCreateConnectionModal || Boolean(editingConnection)))}>
      {showPageHeader && (
        <PageHeader
          title={showConnectionsSection && !showSettingsCards ? "Private S3 connections" : "User profile"}
          description={showConnectionsSection && !showSettingsCards ? "Manage your personal storage connections and credentials." : "Configure your account and preferences."}
          breadcrumbs={[{ label: "Profile" }]}
        />
      )}

      {showSettingsCards && profileLoading && <PageBanner tone="info">Loading profile...</PageBanner>}
      {showSettingsCards && profileError && <PageBanner tone="error">{profileError}</PageBanner>}

      {showSettingsCards && <div className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={handleProfileSave} className={cardClasses}>
          <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
            <h2 className={sectionHeadingClasses}>Identity</h2>
            <p className={sectionDescriptionClasses}>
              {isS3Session
                ? "Review the identity assigned to this temporary session."
                : canEditProfileName
                  ? "Update the display name for your account."
                  : "Review your account identity and profile image."}
            </p>
          </div>
          <div className="space-y-4 px-5 py-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <UiInput
                label="Email"
                type="email"
                value={storedUser?.email ?? ""}
                disabled
                className="cursor-not-allowed opacity-70"
              />
              <UiInput
                label="Name"
                value={fullName}
                onChange={(event) => {
                  setProfileTouched(true);
                  setFullName(event.target.value);
                }}
                disabled={!canEditProfileName}
                className={!canEditProfileName ? "cursor-not-allowed opacity-70" : undefined}
                placeholder="Your name"
              />
            </div>
            <div className="rounded-md border border-[color:var(--ui-border-soft)] bg-[var(--ui-surface-muted)] p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <UserAvatar
                  avatar={avatar}
                  name={fullName || storedUser?.email}
                  email={storedUser?.email}
                  size="xl"
                />
                <div className="min-w-0 flex-1 space-y-3">
                  <div>
                    <div className="text-sm font-bold text-[var(--ui-text)]">Profile image</div>
                    <div className="ui-caption text-[var(--ui-text-muted)]">
                      {avatarSourceLabel(avatar)}. Automatic mode uses an uploaded image, then the image from your identity provider, then Gravatar, with initials as fallback.
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <UiButton
                      size="xs"
                      variant={avatar?.preference === "auto" ? "primary" : "secondary"}
                      aria-pressed={avatar?.preference === "auto"}
                      disabled={isS3Session || avatarBusy}
                      onClick={() => void handleAvatarPreferenceChange("auto")}
                    >
                      Automatic
                    </UiButton>
                    <UiButton
                      size="xs"
                      variant={avatar?.preference === "gravatar" ? "primary" : "secondary"}
                      aria-pressed={avatar?.preference === "gravatar"}
                      disabled={isS3Session || avatarBusy}
                      onClick={() => void handleAvatarPreferenceChange("gravatar")}
                    >
                      Gravatar
                    </UiButton>
                    <UiButton
                      size="xs"
                      variant={avatar?.preference === "initials" ? "primary" : "secondary"}
                      aria-pressed={avatar?.preference === "initials"}
                      disabled={isS3Session || avatarBusy}
                      onClick={() => void handleAvatarPreferenceChange("initials")}
                    >
                      Initials
                    </UiButton>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={avatarFileInputRef}
                      type="file"
                      accept="image/png,image/jpeg"
                      className="sr-only"
                      tabIndex={-1}
                      onChange={handleAvatarUpload}
                    />
                    <UiButton
                      size="xs"
                      variant="secondary"
                      disabled={isS3Session || avatarBusy}
                      loading={avatarBusy}
                      onClick={() => avatarFileInputRef.current?.click()}
                    >
                      Upload image
                    </UiButton>
                    {avatar?.source === "uploaded" ? (
                      <UiButton
                        size="xs"
                        variant="ghost"
                        disabled={isS3Session || avatarBusy}
                        onClick={() => void handleAvatarDelete()}
                      >
                        Remove uploaded image
                      </UiButton>
                    ) : null}
                    <span className="ui-caption text-[var(--ui-text-muted)]">PNG or JPEG, maximum 1 MiB.</span>
                  </div>
                  {avatarError ? <UiInlineMessage tone="error">{avatarError}</UiInlineMessage> : null}
                </div>
              </div>
            </div>
            {isS3Session && (
              <p className="ui-caption text-slate-500 dark:text-slate-400">
                Temporary S3 session: user profile is not editable.
              </p>
            )}
            {!isS3Session && !canEditProfileName && (
              <p className="ui-caption text-slate-500 dark:text-slate-400">
                Your display name is managed by an application administrator.
              </p>
            )}
            {profileMessage && <UiInlineMessage tone="success">{profileMessage}</UiInlineMessage>}
            <div>
              <UiButton type="submit" size="sm" disabled={profileSaving || !canEditProfileName}>
                {profileSaving ? "Saving..." : "Save profile"}
              </UiButton>
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
              <UiSelect
                label="Language"
                value={preferencesLanguage}
                onChange={(event) => {
                  setPreferencesTouched(true);
                  setPreferencesLanguage(event.target.value as UiLanguagePreference);
                }}
              >
                <option value="en">English</option>
                <option value="fr">French</option>
                <option value="de">Deutsch</option>
                <option value="auto">Auto (browser)</option>
              </UiSelect>
              <UiSelect
                label="Theme"
                value={preferencesTheme}
                onChange={(event) => {
                  setPreferencesTouched(true);
                  setPreferencesTheme(event.target.value as "light" | "dark");
                }}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </UiSelect>
              <UiSelect
                label="Default workspace"
                value={preferredWorkspace ?? ""}
                onChange={(event) => {
                  setPreferencesTouched(true);
                  setPreferredWorkspace((event.target.value as WorkspaceId) || null);
                }}
                disabled={availableWorkspaces.length === 0}
              >
                {availableWorkspaces.length === 0 && <option value="">No workspace available</option>}
                {availableWorkspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.label}
                  </option>
                ))}
              </UiSelect>
            </div>
            <UiCheckboxField
                checked={preferencesShowSelectorTags}
                onChange={(event) => {
                  setPreferencesTouched(true);
                  setPreferencesShowSelectorTags(event.target.checked);
                }}
                className="flex items-start rounded-md border border-[color:var(--ui-border)] px-3 py-3"
                checkboxClassName="mt-1"
            >
              <span>
                <span className="ui-body text-slate-700 dark:text-slate-200">Show tags in top selectors</span>
                <span className="mt-1 block ui-caption text-slate-500 dark:text-slate-400">
                  Display compact endpoint and context tags in the topbar selectors on this browser only.
                </span>
              </span>
            </UiCheckboxField>
            {!isS3Session && (
              <div className="grid gap-3 md:grid-cols-2">
                <UiCheckboxField
                  checked={quotaAlertsEnabled}
                  onChange={(event) => {
                    setPreferencesTouched(true);
                    setQuotaAlertsEnabled(event.target.checked);
                  }}
                  className="flex rounded-md border border-[color:var(--ui-border)] px-3 py-2"
                >
                  <span className="ui-body text-slate-700 dark:text-slate-200">Receive quota alert emails</span>
                </UiCheckboxField>
                {canConfigureGlobalQuotaWatch && (
                  <UiCheckboxField
                    checked={quotaAlertsGlobalWatch}
                    onChange={(event) => {
                      setPreferencesTouched(true);
                      setQuotaAlertsGlobalWatch(event.target.checked);
                    }}
                    className="flex rounded-md border border-[color:var(--ui-border)] px-3 py-2"
                  >
                    <span className="ui-body text-slate-700 dark:text-slate-200">
                      Global quota watch (all storage spaces)
                    </span>
                  </UiCheckboxField>
                )}
              </div>
            )}
            {preferencesMessage && <UiInlineMessage tone={preferencesMessageTone}>{preferencesMessage}</UiInlineMessage>}
            <div>
              <UiButton type="submit" size="sm">
                Save preferences
              </UiButton>
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
          {canCreateManualConnections && (
            <UiButton size="sm" onClick={openCreateConnectionModal}>
              Add connection
            </UiButton>
          )}
        </div>

        <div className="space-y-4 px-5 py-5">
          {!canCreateManualConnections && (
            <PageBanner tone="info">
              Creation, endpoint changes, identity changes, and credential replacement are disabled. Existing connections remain available for metadata, workspace access, activation, cleanup, and deletion.
            </PageBanner>
          )}
            <>
              {connectionsError && <PageBanner tone="error">{connectionsError}</PageBanner>}
              {connectionsMessage && <PageBanner tone="success">{connectionsMessage}</PageBanner>}
              <div className="rounded-lg border border-[color:var(--ui-border)]">
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
                        onClick={handleBulkDeletePrivateConnections}
                        disabled={bulkActivatingConnections || bulkDisablingConnections || bulkDeletingConnections}
                      >
                        {bulkDeletingConnections ? "Deleting..." : "Delete selected"}
                      </button>
                    </div>
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className={privateConnectionsTableClass}>
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
                                    {connection.server_managed && (
                                      <span className="mt-1 inline-flex rounded border border-primary-200 bg-primary-50 px-1.5 py-0.5 text-[10px] font-semibold text-primary-700 dark:border-primary-900/50 dark:bg-primary-950/50 dark:text-primary-100">
                                        Server managed{connection.managed_access_state === "cleanup_pending" ? " - cleanup required" : ""}
                                      </span>
                                    )}
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
                                  {connection.managed_access_state === "cleanup_pending" && (
                                    <button
                                      type="button"
                                      className={tableActionButtonClasses}
                                      disabled={deletingConnectionBusyId === connection.id}
                                      onClick={() => void handleRetryManagedCleanup(connection.id)}
                                    >
                                      {deletingConnectionBusyId === connection.id ? "Retrying..." : "Retry cleanup"}
                                    </button>
                                  )}
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
                                    onClick={() => handleDeletePrivateConnection(connection)}
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
        </div>
      </section>}

      {pendingConnectionDelete && (
        <ConfirmActionDialog
          title={pendingConnectionDelete.scope === "single" ? "Delete private S3 connection?" : "Delete selected private S3 connections?"}
          description={
            pendingConnectionDelete.scope === "single"
              ? "Remove this private connection from your profile."
              : "Remove all selected private connections from your profile."
          }
          confirmLabel={pendingConnectionDelete.scope === "single" ? "Delete connection" : "Delete selected connections"}
          details={
            pendingConnectionDelete.scope === "single"
              ? [
                  {
                    label: "Connection",
                    value: pendingConnectionDelete.connections[0]?.name || `#${pendingConnectionDelete.connections[0]?.id}`,
                  },
                  {
                    label: "Endpoint",
                    value: pendingConnectionDelete.connections[0]?.endpoint_url || "Managed endpoint",
                    mono: true,
                  },
                ]
              : [{ label: "Connections", value: pendingConnectionDelete.connections.length }]
          }
          impacts={[
            "Access through the selected connection will be removed from Manager and Browser.",
            "Remote buckets and their objects will not be deleted.",
          ]}
          loading={
            pendingConnectionDelete.scope === "bulk"
              ? bulkDeletingConnections
              : deletingConnectionBusyId === pendingConnectionDelete.connections[0]?.id
          }
          onCancel={() => setPendingConnectionDelete(null)}
          onConfirm={() => void confirmPendingConnectionDelete()}
        />
      )}

      {showConnectionsSection && canCreateManualConnections && showCreateConnectionModal && (
        <WorkflowPage
          title="Add private S3 connection"
          description="Configure endpoint access, credentials, and workspace availability for this private connection."
          breadcrumbs={[{ label: "Profile", to: "/profile" }, { label: "Private connections", to: "/profile?view=connections" }, { label: "Create" }]}
          backLabel="Back to connections"
          onBack={createConnectionCloseGuard.requestClose}
          width="standard"
        >
          {connectionsError && (
            <UiInlineMessage tone="error" className="mb-3">
              {connectionsError}
            </UiInlineMessage>
          )}
          <form onSubmit={handleCreatePrivateConnection} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
                <UiInput
                  label="Name"
                  value={createConnectionForm.name}
                  onChange={(event) => setCreateConnectionForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Mon endpoint S3"
                />
                <div className="space-y-3 sm:pt-6">
                  {privateTagCatalogError && <PageBanner tone="warning">{privateTagCatalogError}</PageBanner>}
                  <UiTagEditor
                    label="Tags"
                    tags={createConnectionForm.tags}
                    catalog={privateTagCatalog}
                    onChange={(tags) => setCreateConnectionForm((prev) => ({ ...prev, tags }))}
                    catalogMode="private"
                    placeholder="Add a tag for this private connection"
                    hint={privateTagCatalogLoading ? "Loading existing private tags..." : undefined}
                    hideLabel
                    compact
                  />
                </div>
                <div className="sm:col-span-2">
                  <S3ConnectionEndpointFields
                    mode={createConnectionEndpointMode}
                    onModeChange={setCreateConnectionEndpointMode}
                    modeInputName="create-connection-endpoint-mode"
                    endpointId={createConnectionEndpointId}
                    onEndpointIdChange={setCreateConnectionEndpointId}
                    endpoints={availableStorageEndpoints}
                    loadingEndpoints={loadingStorageEndpoints}
                    form={createConnectionForm}
                    onFormChange={(field, value) =>
                      setCreateConnectionForm((prev) => ({
                        ...prev,
                        [field]: value,
                      }))
                    }
                    errorMessage={
                      storageEndpointsError
                        ? `Unable to load configured endpoints (${storageEndpointsError}). Use custom mode.`
                        : null
                    }
                  />
                </div>
                <S3ConnectionCredentialFields
                  accessKeyId={createConnectionForm.access_key_id}
                  secretAccessKey={createConnectionForm.secret_access_key}
                  onAccessKeyIdChange={(value) =>
                    setCreateConnectionForm((prev) => ({ ...prev, access_key_id: value }))
                  }
                  onSecretAccessKeyChange={(value) =>
                    setCreateConnectionForm((prev) => ({ ...prev, secret_access_key: value }))
                  }
                  className="sm:col-span-2"
                />
                <div className="sm:col-span-2">
                  <S3CredentialsValidationMessage validation={createConnectionValidation} />
                </div>
                <S3ConnectionAccessFields
                  accessManager={createConnectionForm.access_manager}
                  accessBrowser={createConnectionForm.access_browser}
                  onAccessManagerChange={(checked) =>
                    setCreateConnectionForm((prev) => ({ ...prev, access_manager: checked }))
                  }
                  onAccessBrowserChange={(checked) =>
                    setCreateConnectionForm((prev) => ({ ...prev, access_browser: checked }))
                  }
                  className="sm:col-span-2"
                  variant="panel"
                />
              </div>
            <div className="flex justify-end gap-2">
              <UiButton
                variant="secondary"
                size="sm"
                onClick={createConnectionCloseGuard.requestClose}
                disabled={creatingConnection}
              >
                Cancel
              </UiButton>
              <UiButton type="submit" size="sm" disabled={creatingConnection}>
                {creatingConnection ? "Creating..." : "Create connection"}
              </UiButton>
            </div>
          </form>
          {createConnectionCloseGuard.confirmationDialog}
        </WorkflowPage>
      )}

      {showConnectionsSection && editingConnection && (
        <WorkflowPage
          title={`Edit connection - ${editingConnection.name}`}
          description={editingConnection.server_managed
            ? "Manage the name, tags, status, and workspace availability. Endpoint and credentials are controlled by server provisioning."
            : "Manage endpoint access, credentials, and workspace availability for this private connection."}
          breadcrumbs={[{ label: "Profile", to: "/profile" }, { label: "Private connections", to: "/profile?view=connections" }, { label: "Edit" }]}
          backLabel="Back to connections"
          onBack={editConnectionCloseGuard.requestClose}
          width="standard"
        >
          {connectionsError && (
            <UiInlineMessage tone="error" className="mb-3">
              {connectionsError}
            </UiInlineMessage>
          )}
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              const success = await handleUpdatePrivateConnection(editingConnection.id);
              if (success) closeEditConnectionModal();
            }}
          >
            {(() => {
              const draft =
                connectionDrafts[editingConnection.id] ??
                buildPrivateConnectionDraft(editingConnection);
              const credentialDraft =
                connectionCredentialDrafts[editingConnection.id] ??
                createEmptyConnectionCredentialDraft();
              return (
                <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <UiInput
                          label="Name"
                          value={draft.name}
                          onChange={(event) => handleUpdateConnectionDraft(editingConnection.id, "name", event.target.value)}
                        />
                        <div className="space-y-3 sm:pt-6">
                          {privateTagCatalogError && <PageBanner tone="warning">{privateTagCatalogError}</PageBanner>}
                          <UiTagEditor
                            label="Tags"
                            tags={draft.tags}
                            catalog={privateTagCatalog}
                            onChange={(tags) => handleUpdateConnectionDraft(editingConnection.id, "tags", tags)}
                            catalogMode="private"
                            placeholder="Add a tag for this private connection"
                            hint={privateTagCatalogLoading ? "Loading existing private tags..." : undefined}
                            hideLabel
                            compact
                          />
                        </div>
                      </div>

                      {canCreateManualConnections && !editingConnection.server_managed && <S3ConnectionEndpointFields
                        mode={editConnectionEndpointMode}
                        onModeChange={setEditConnectionEndpointMode}
                        modeInputName={`edit-connection-endpoint-mode-${editingConnection.id}`}
                        endpointId={editConnectionEndpointId}
                        onEndpointIdChange={setEditConnectionEndpointId}
                        endpoints={availableStorageEndpoints}
                        loadingEndpoints={loadingStorageEndpoints}
                        form={draft}
                        onFormChange={(field, value) => handleUpdateConnectionDraft(editingConnection.id, field, value)}
                        errorMessage={
                          storageEndpointsError
                            ? `Unable to load configured endpoints (${storageEndpointsError}). Use custom mode.`
                            : null
                        }
                      />}

                      {editingConnection.server_managed ? (
                        <PageBanner tone="info">
                          This connection is server managed. Its source context, endpoint, remote principal, access key, and secret are immutable here.
                        </PageBanner>
                      ) : !canCreateManualConnections ? (
                        <PageBanner tone="info">
                          Endpoint, identity, and credentials are locked because manual private connection creation is not granted. You can still edit the name, tags, and workspace access.
                        </PageBanner>
                      ) : <div className="space-y-2 rounded-lg border border-slate-200 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/40">
                        <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Credentials
                        </p>
                        <p className="ui-caption text-slate-500 dark:text-slate-400">
                          Current Access Key: <span className="ui-mono">{editingConnection.access_key_id || "-"}</span>
                        </p>
                        <p className="ui-caption text-slate-500 dark:text-slate-400">
                          Leave blank to keep current credentials.
                        </p>
                        <S3ConnectionCredentialFields
                          accessKeyId={credentialDraft.access_key_id}
                          secretAccessKey={credentialDraft.secret_access_key}
                          onAccessKeyIdChange={(value) =>
                            handleUpdateConnectionCredentialDraft(editingConnection.id, "access_key_id", value)
                          }
                          onSecretAccessKeyChange={(value) =>
                            handleUpdateConnectionCredentialDraft(editingConnection.id, "secret_access_key", value)
                          }
                        />
                        <S3CredentialsValidationMessage validation={editConnectionValidation} />
                      </div>}

                      <S3ConnectionAccessFields
                        accessManager={Boolean(draft.access_manager)}
                        accessBrowser={Boolean(draft.access_browser)}
                        onAccessManagerChange={(checked) =>
                          handleUpdateConnectionDraft(editingConnection.id, "access_manager", checked)
                        }
                        onAccessBrowserChange={(checked) =>
                          handleUpdateConnectionDraft(editingConnection.id, "access_browser", checked)
                        }
                        variant="panel"
                      />
                </>
              );
            })()}
            <div className="flex justify-end gap-2">
              <UiButton
                variant="secondary"
                size="sm"
                onClick={editConnectionCloseGuard.requestClose}
                disabled={savingConnectionBusyId === editingConnection.id}
              >
                Cancel
              </UiButton>
              <UiButton
                type="submit"
                size="sm"
                disabled={savingConnectionBusyId === editingConnection.id}
              >
                {savingConnectionBusyId === editingConnection.id ? "Saving..." : "Save"}
              </UiButton>
            </div>
          </form>
          {editConnectionCloseGuard.confirmationDialog}
        </WorkflowPage>
      )}
    </div>
  );
}
