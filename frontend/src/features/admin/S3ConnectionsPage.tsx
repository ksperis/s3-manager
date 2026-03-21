/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Dispatch, FormEvent, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "../../components/PageHeader";
import Modal from "../../components/Modal";
import PageBanner from "../../components/PageBanner";
import TableEmptyState from "../../components/TableEmptyState";
import ListSectionCard from "../../components/list/ListSectionCard";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import PaginationControls from "../../components/PaginationControls";
import UiButton from "../../components/ui/UiButton";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { toolbarCompactInputClasses } from "../../components/toolbarControlClasses";
import {
  S3ConnectionAdminItem,
  createAdminS3Connection,
  deleteAdminS3Connection,
  listAdminS3Connections,
  listS3ConnectionUsers,
  removeS3ConnectionUser,
  rotateAdminS3ConnectionCredentials,
  upsertS3ConnectionUser,
  updateAdminS3Connection,
  validateAdminS3ConnectionCredentials,
} from "../../api/s3ConnectionsAdmin";
import { listMinimalUsers, UserSummary } from "../../api/users";
import { listStorageEndpoints, StorageEndpoint } from "../../api/storageEndpoints";
import { extractApiError } from "../../utils/apiError";
import { S3CredentialsValidationPayload, useLiveS3CredentialsValidation } from "../shared/useLiveS3CredentialsValidation";

const providerHintOptions = [
  { value: "", label: "(auto)" },
  { value: "aws", label: "AWS" },
  { value: "ceph", label: "Ceph RGW" },
  { value: "scality", label: "Scality" },
  { value: "minio", label: "MinIO" },
  { value: "other", label: "Other" },
];
const credentialOwnerTypeOptions = [
  { value: "", label: "(none)" },
  { value: "iam_user", label: "IAM user" },
  { value: "account_user", label: "Account user" },
  { value: "s3_user", label: "S3 user" },
];
type EditTab = "general" | "users";

export default function S3ConnectionsPage() {
  const [items, setItems] = useState<S3ConnectionAdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState("");

  const [storageEndpoints, setStorageEndpoints] = useState<StorageEndpoint[]>([]);
  const [loadingEndpoints, setLoadingEndpoints] = useState(false);
  const [portalUsers, setPortalUsers] = useState<UserSummary[]>([]);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createEndpointPresetId, setCreateEndpointPresetId] = useState("");
  const [createPresetTouched, setCreatePresetTouched] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "",
    provider_hint: "",
    access_manager: false,
    access_browser: true,
    endpoint_url: "",
    region: "",
    access_key_id: "",
    secret_access_key: "",
    force_path_style: false,
    verify_tls: true,
  });

  const [editing, setEditing] = useState<S3ConnectionAdminItem | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editEndpointPresetId, setEditEndpointPresetId] = useState("");
  const [editForm, setEditForm] = useState({
    name: "",
    provider_hint: "",
    access_manager: false,
    access_browser: true,
    credential_owner_type: "",
    credential_owner_identifier: "",
    endpoint_url: "",
    region: "",
    force_path_style: false,
    verify_tls: true,
  });
  const [editCredentials, setEditCredentials] = useState({
    access_key_id: "",
    secret_access_key: "",
  });
  const [editTab, setEditTab] = useState<EditTab>("general");
  const [editLinkedUserIds, setEditLinkedUserIds] = useState<number[]>([]);
  const [editUserSearch, setEditUserSearch] = useState("");
  const [showEditUserPanel, setShowEditUserPanel] = useState(false);
  const [editUserSelections, setEditUserSelections] = useState<number[]>([]);
  const maxLinkOptions = 10;

  const [deleteTarget, setDeleteTarget] = useState<S3ConnectionAdminItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkActivateBusy, setBulkActivateBusy] = useState(false);
  const [bulkDisableBusy, setBulkDisableBusy] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  const [selectAllFilteredBusy, setSelectAllFilteredBusy] = useState(false);
  const [allFilteredSelectableIds, setAllFilteredSelectableIds] = useState<number[] | null>(null);
  const [allFilteredSelectableIdsKey, setAllFilteredSelectableIdsKey] = useState<string | null>(null);
  const selectionHeaderRef = useRef<HTMLInputElement | null>(null);

  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const extractError = (err: unknown) => extractApiError(err, "Unexpected error");
  const normalizeLinkedUserIds = useCallback((ids: number[] | undefined): number[] => {
    return Array.from(new Set((ids ?? []).map((id) => Number(id))))
      .filter((id) => Number.isFinite(id) && id > 0)
      .sort((a, b) => a - b);
  }, []);
  const resetEditUsersState = useCallback(() => {
    setEditTab("general");
    setEditLinkedUserIds([]);
    setEditUserSearch("");
    setShowEditUserPanel(false);
    setEditUserSelections([]);
  }, []);
  const closeEditModal = useCallback(() => {
    setEditing(null);
    setEditError(null);
    setEditCredentials({ access_key_id: "", secret_access_key: "" });
    resetEditUsersState();
  }, [resetEditUsersState]);

  const resetCreateForm = () => {
    setCreateEndpointPresetId("");
    setCreatePresetTouched(false);
    setCreateError(null);
    setCreateForm({
      name: "",
      provider_hint: "",
      access_manager: false,
      access_browser: true,
      endpoint_url: "",
      region: "",
      access_key_id: "",
      secret_access_key: "",
      force_path_style: false,
      verify_tls: true,
    });
  };

  const openCreateModal = () => {
    resetCreateForm();
    setShowCreateModal(true);
  };

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await listAdminS3Connections({
        page,
        page_size: pageSize,
        search: filter.trim() || undefined,
      });
      const totalPages = Math.max(1, Math.ceil((response.total || 0) / pageSize));
      if (response.total > 0 && page > totalPages) {
        setPage(totalPages);
        return;
      }
      setItems(response.items);
      setTotal(response.total);
      setAllFilteredSelectableIds(null);
      setAllFilteredSelectableIdsKey(null);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  }, [filter, page, pageSize]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    const loadEndpoints = async () => {
      setLoadingEndpoints(true);
      try {
        const data = await listStorageEndpoints();
        setStorageEndpoints(data);
      } catch {
        setStorageEndpoints([]);
      } finally {
        setLoadingEndpoints(false);
      }
    };
    loadEndpoints();
  }, []);

  useEffect(() => {
    const loadPortalUsers = async () => {
      try {
        const data = await listMinimalUsers();
        setPortalUsers(data);
      } catch {
        setPortalUsers([]);
      }
    };
    loadPortalUsers();
  }, []);

  const createHasPreset = Boolean(createEndpointPresetId);
  const editHasPreset = Boolean(editEndpointPresetId);

  const createValidationPayload = useMemo(() => {
    const accessKeyId = createForm.access_key_id.trim();
    const secretAccessKey = createForm.secret_access_key.trim();
    if (!accessKeyId || !secretAccessKey) return null;
    if (createHasPreset) {
      if (!createEndpointPresetId) return null;
      return {
        storage_endpoint_id: Number(createEndpointPresetId),
        access_key_id: accessKeyId,
        secret_access_key: secretAccessKey,
      };
    }
    const endpointUrl = createForm.endpoint_url.trim();
    if (!endpointUrl) return null;
    return {
      endpoint_url: endpointUrl,
      region: createForm.region.trim() || null,
      access_key_id: accessKeyId,
      secret_access_key: secretAccessKey,
      force_path_style: createForm.force_path_style,
      verify_tls: createForm.verify_tls,
    };
  }, [
    createEndpointPresetId,
    createForm.access_key_id,
    createForm.endpoint_url,
    createForm.force_path_style,
    createForm.region,
    createForm.secret_access_key,
    createForm.verify_tls,
    createHasPreset,
  ]);

  const validateCreateCredentials = useCallback(
    (payload: S3CredentialsValidationPayload) => validateAdminS3ConnectionCredentials(payload),
    []
  );

  const createCredentialsValidation = useLiveS3CredentialsValidation({
    enabled: showCreateModal,
    payload: createValidationPayload,
    validate: validateCreateCredentials,
    debounceMs: 450,
  });

  const defaultEndpoint = storageEndpoints.find((ep) => ep.is_default);
  const endpointNameById = useMemo(() => {
    const map = new Map<number, string>();
    storageEndpoints.forEach((ep) => map.set(ep.id, ep.name));
    return map;
  }, [storageEndpoints]);
  const portalUserLabelById = useMemo(() => {
    const map = new Map<number, string>();
    portalUsers.forEach((user) => map.set(user.id, user.email));
    return map;
  }, [portalUsers]);
  const linkedEditUsers = useMemo(
    () =>
      editLinkedUserIds.map((id) => ({
        id,
        label: portalUserLabelById.get(id) ?? `User #${id}`,
      })),
    [editLinkedUserIds, portalUserLabelById]
  );
  const availableEditUsers = useMemo(() => {
    const query = editUserSearch.trim().toLowerCase();
    const selectedIds = new Set(editLinkedUserIds);
    return portalUsers
      .filter((user) => !selectedIds.has(user.id))
      .filter((user) => !query || user.email.toLowerCase().includes(query))
      .map((user) => ({ id: user.id, label: user.email }));
  }, [editLinkedUserIds, editUserSearch, portalUsers]);
  const visibleAvailableEditUsers = useMemo(() => availableEditUsers.slice(0, maxLinkOptions), [availableEditUsers, maxLinkOptions]);
  const editCredentialOwnerTypeOptions = useMemo(() => {
    const currentValue = editForm.credential_owner_type.trim();
    if (!currentValue) return credentialOwnerTypeOptions;
    if (credentialOwnerTypeOptions.some((opt) => opt.value === currentValue)) return credentialOwnerTypeOptions;
    return [...credentialOwnerTypeOptions, { value: currentValue, label: `${currentValue} (legacy)` }];
  }, [editForm.credential_owner_type]);
  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: items.length,
  });
  const selectionQueryKey = useMemo(
    () =>
      JSON.stringify({
        filter: filter.trim() || null,
      }),
    [filter]
  );
  const selectableOnPageIds = useMemo(
    () => items.map((item) => item.id),
    [items]
  );
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedOnPageIds = useMemo(
    () => selectableOnPageIds.filter((connectionId) => selectedIdSet.has(connectionId)),
    [selectableOnPageIds, selectedIdSet]
  );
  const allSelectedOnPage = selectableOnPageIds.length > 0 && selectedOnPageIds.length === selectableOnPageIds.length;
  const hasResolvedFilteredSelectableIds =
    allFilteredSelectableIdsKey === selectionQueryKey && Array.isArray(allFilteredSelectableIds);
  const selectedOnFilteredCount = hasResolvedFilteredSelectableIds
    ? allFilteredSelectableIds.reduce((count, connectionId) => count + (selectedIdSet.has(connectionId) ? 1 : 0), 0)
    : selectedOnPageIds.length;
  const allSelectedOnFiltered =
    hasResolvedFilteredSelectableIds && allFilteredSelectableIds.length > 0 && selectedOnFilteredCount === allFilteredSelectableIds.length;
  const hiddenSelectedCount = Math.max(selectedIds.length - selectedOnPageIds.length, 0);
  const headerChecked = hasResolvedFilteredSelectableIds ? allSelectedOnFiltered : allSelectedOnPage;
  const headerIndeterminate = hasResolvedFilteredSelectableIds
    ? selectedOnFilteredCount > 0 && !allSelectedOnFiltered
    : selectedOnPageIds.length > 0 && !allSelectedOnPage;

  useEffect(() => {
    if (!selectionHeaderRef.current) return;
    selectionHeaderRef.current.indeterminate = headerIndeterminate;
  }, [headerIndeterminate]);

  useEffect(() => {
    setAllFilteredSelectableIds(null);
    setAllFilteredSelectableIdsKey(null);
  }, [selectionQueryKey]);

  useEffect(() => {
    setSelectedIds([]);
  }, [page, pageSize]);

  useEffect(() => {
    if (!showCreateModal) return;
    if (createPresetTouched || createEndpointPresetId) return;
    if (!defaultEndpoint) return;
    if (createForm.endpoint_url.trim()) return;
    const defaultId = String(defaultEndpoint.id);
    setCreateEndpointPresetId(defaultId);
    setCreateForm((prev) => ({
      ...prev,
      endpoint_url: defaultEndpoint.endpoint_url,
      region: defaultEndpoint.region || "",
      force_path_style: false,
      verify_tls: true,
    }));
  }, [createEndpointPresetId, createForm.endpoint_url, createPresetTouched, defaultEndpoint, showCreateModal]);

  const handleFilterChange = (value: string) => {
    setFilter(value);
    setSelectedIds([]);
    setPage(1);
  };
  const handlePageChange = (nextPage: number) => {
    if (nextPage === page) return;
    setPage(Math.max(1, nextPage));
  };
  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };
  const toggleRowSelection = (connectionId: number) => {
    setSelectedIds((prev) => (prev.includes(connectionId) ? prev.filter((id) => id !== connectionId) : [...prev, connectionId]));
  };
  const toggleEditUserSelection = (userId: number) => {
    setEditUserSelections((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  };
  const loadAllSelectableFilteredIds = useCallback(async () => {
    if (allFilteredSelectableIdsKey === selectionQueryKey && allFilteredSelectableIds) {
      return allFilteredSelectableIds;
    }
    const ids = new Set<number>();
    let nextPage = 1;
    while (true) {
      const response = await listAdminS3Connections({
        page: nextPage,
        page_size: 200,
        search: filter.trim() || undefined,
      });
      response.items.forEach((item) => {
        ids.add(item.id);
      });
      if (!response.has_next) {
        break;
      }
      nextPage += 1;
    }
    const resolved = Array.from(ids.values());
    setAllFilteredSelectableIds(resolved);
    setAllFilteredSelectableIdsKey(selectionQueryKey);
    return resolved;
  }, [allFilteredSelectableIds, allFilteredSelectableIdsKey, filter, selectionQueryKey]);

  const setSelectionForFilteredResults = useCallback(
    async (checked: boolean) => {
      setSelectAllFilteredBusy(true);
      setError(null);
      try {
        const selectableFilteredIds = await loadAllSelectableFilteredIds();
        setSelectedIds(checked ? selectableFilteredIds : []);
      } catch (err) {
        setError(extractApiError(err, "Unexpected error"));
      } finally {
        setSelectAllFilteredBusy(false);
      }
    },
    [loadAllSelectableFilteredIds]
  );

  const openEdit = (conn: S3ConnectionAdminItem) => {
    const presetMatch =
      conn.storage_endpoint_id != null
        ? storageEndpoints.find((ep) => ep.id === conn.storage_endpoint_id)
        : storageEndpoints.find((ep) => ep.endpoint_url === conn.endpoint_url);
    if (conn.storage_endpoint_id != null) {
      setEditEndpointPresetId(String(conn.storage_endpoint_id));
    } else {
      setEditEndpointPresetId(presetMatch ? String(presetMatch.id) : "");
    }
    setEditing(conn);
    setEditForm({
      name: conn.name,
      provider_hint: conn.provider_hint || "",
      access_manager: conn.access_manager === true,
      access_browser: conn.access_browser !== false,
      credential_owner_type: conn.credential_owner_type || "",
      credential_owner_identifier: conn.credential_owner_identifier || "",
      endpoint_url: conn.endpoint_url,
      region: conn.region || "",
      force_path_style: Boolean(conn.force_path_style),
      verify_tls: conn.verify_tls !== false,
    });
    setEditTab("general");
    setEditLinkedUserIds(normalizeLinkedUserIds(conn.user_ids));
    setEditUserSearch("");
    setShowEditUserPanel(false);
    setEditUserSelections([]);
    setEditCredentials({ access_key_id: "", secret_access_key: "" });
    setEditError(null);
  };

  type ConnectionEndpointForm = {
    endpoint_url: string;
    region: string;
  };

  const applyEndpointPreset = <T extends ConnectionEndpointForm>(
    endpointId: string,
    setForm: Dispatch<SetStateAction<T>>
  ) => {
    const endpoint = storageEndpoints.find((ep) => String(ep.id) === endpointId);
    if (!endpoint) return;
    setForm((prev) => ({
      ...prev,
      endpoint_url: endpoint.endpoint_url,
      region: endpoint.region || "",
    }));
  };

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!createForm.access_manager && !createForm.access_browser) {
      setCreateError("Enable access to manager and/or browser.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const endpointPayload = createHasPreset
        ? {
            storage_endpoint_id: Number(createEndpointPresetId),
          }
        : {
            storage_endpoint_id: null,
            endpoint_url: createForm.endpoint_url,
            region: createForm.region || null,
            force_path_style: createForm.force_path_style,
            verify_tls: createForm.verify_tls,
            provider_hint: createForm.provider_hint || null,
          };
      await createAdminS3Connection({
        name: createForm.name,
        access_manager: createForm.access_manager,
        access_browser: createForm.access_browser,
        access_key_id: createForm.access_key_id,
        secret_access_key: createForm.secret_access_key,
        ...endpointPayload,
      });
      setShowCreateModal(false);
      resetCreateForm();
      setActionMessage("Connection created.");
      await fetchItems();
    } catch (err) {
      setCreateError(extractError(err));
    } finally {
      setCreating(false);
    }
  };

  const submitEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    if (!editForm.access_manager && !editForm.access_browser) {
      setEditError("Enable access to manager and/or browser.");
      return;
    }
    const accessKeyId = editCredentials.access_key_id.trim();
    const secretAccessKey = editCredentials.secret_access_key.trim();
    if ((accessKeyId && !secretAccessKey) || (!accessKeyId && secretAccessKey)) {
      setEditError("Provide both access key ID and secret access key to update credentials.");
      return;
    }
    setEditBusy(true);
    setEditError(null);
    try {
      const connectionId = editing.id;
      if (accessKeyId && secretAccessKey) {
        await rotateAdminS3ConnectionCredentials(connectionId, {
          access_key_id: accessKeyId,
          secret_access_key: secretAccessKey,
        });
      }
      const endpointPayload = editHasPreset
        ? {
            storage_endpoint_id: Number(editEndpointPresetId),
          }
        : {
            storage_endpoint_id: null,
            endpoint_url: editForm.endpoint_url || undefined,
            region: editForm.region || null,
            force_path_style: editForm.force_path_style,
            verify_tls: editForm.verify_tls,
            provider_hint: editForm.provider_hint || null,
          };
      await updateAdminS3Connection(connectionId, {
        name: editForm.name || undefined,
        access_manager: editForm.access_manager,
        access_browser: editForm.access_browser,
        credential_owner_type: editForm.credential_owner_type || null,
        credential_owner_identifier: editForm.credential_owner_identifier || null,
        ...endpointPayload,
      });
      const targetIds = normalizeLinkedUserIds(editLinkedUserIds);
      try {
        const currentLinks = await listS3ConnectionUsers(connectionId);
        const currentIds = normalizeLinkedUserIds(currentLinks.map((link) => link.user_id));
        const currentIdSet = new Set(currentIds);
        const targetIdSet = new Set(targetIds);
        const addIds = targetIds.filter((id) => !currentIdSet.has(id));
        const removeIds = currentIds.filter((id) => !targetIdSet.has(id));
        if (addIds.length > 0) {
          await Promise.all(addIds.map((userId) => upsertS3ConnectionUser(connectionId, { user_id: userId })));
        }
        if (removeIds.length > 0) {
          await Promise.all(removeIds.map((userId) => removeS3ConnectionUser(connectionId, userId)));
        }
      } catch (err) {
        setEditError(`Connection updated, but linked UI users could not be synced: ${extractError(err)}`);
        return;
      }
      setEditCredentials({ access_key_id: "", secret_access_key: "" });
      setActionMessage("Connection updated.");
      await fetchItems();
      closeEditModal();
    } catch (err) {
      setEditError(extractError(err));
    } finally {
      setEditBusy(false);
    }
  };

  const submitDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteAdminS3Connection(deleteTarget.id);
      setDeleteTarget(null);
      setSelectedIds((prev) => prev.filter((connectionId) => connectionId !== deleteTarget.id));
      setActionMessage("Connection deleted.");
      await fetchItems();
    } catch (err) {
      setDeleteError(extractError(err));
    } finally {
      setDeleteBusy(false);
    }
  };

  const submitToggleConnectionStatus = async (conn: S3ConnectionAdminItem) => {
    const nextIsActive = conn.is_active !== false ? false : true;
    setStatusBusyId(conn.id);
    setError(null);
    setActionMessage(null);
    try {
      await updateAdminS3Connection(conn.id, { is_active: nextIsActive });
      setActionMessage(nextIsActive ? "Connection activated." : "Connection disabled.");
      await fetchItems();
    } catch (err) {
      setError(extractError(err));
    } finally {
      setStatusBusyId(null);
    }
  };

  const submitBulkDisable = async () => {
    if (selectedIds.length === 0) return;
    setBulkDisableBusy(true);
    setError(null);
    setActionMessage(null);
    const results = await Promise.allSettled(
      selectedIds.map((connectionId) => updateAdminS3Connection(connectionId, { is_active: false }))
    );
    const failedIds = selectedIds.filter((_, index) => results[index].status === "rejected");
    const successCount = selectedIds.length - failedIds.length;
    setSelectedIds(failedIds);
    if (successCount > 0) {
      await fetchItems();
    }
    if (failedIds.length > 0) {
      setError(`${failedIds.length} connection${failedIds.length > 1 ? "s" : ""} could not be disabled.`);
    }
    setActionMessage(
      `${successCount} connection${successCount > 1 ? "s" : ""} disabled.` +
        (failedIds.length > 0 ? ` ${failedIds.length} failed.` : "")
    );
    setBulkDisableBusy(false);
  };

  const submitBulkActivate = async () => {
    if (selectedIds.length === 0) return;
    setBulkActivateBusy(true);
    setError(null);
    setActionMessage(null);
    const results = await Promise.allSettled(
      selectedIds.map((connectionId) => updateAdminS3Connection(connectionId, { is_active: true }))
    );
    const failedIds = selectedIds.filter((_, index) => results[index].status === "rejected");
    const successCount = selectedIds.length - failedIds.length;
    setSelectedIds(failedIds);
    if (successCount > 0) {
      await fetchItems();
    }
    if (failedIds.length > 0) {
      setError(`${failedIds.length} connection${failedIds.length > 1 ? "s" : ""} could not be activated.`);
    }
    setActionMessage(
      `${successCount} connection${successCount > 1 ? "s" : ""} activated.` +
        (failedIds.length > 0 ? ` ${failedIds.length} failed.` : "")
    );
    setBulkActivateBusy(false);
  };

  const submitBulkDelete = async () => {
    if (selectedIds.length === 0) {
      setBulkDeleteOpen(false);
      return;
    }
    setBulkDeleteBusy(true);
    setError(null);
    setActionMessage(null);
    const results = await Promise.allSettled(
      selectedIds.map((connectionId) => deleteAdminS3Connection(connectionId))
    );
    const failedIds = selectedIds.filter((_, index) => results[index].status === "rejected");
    const successCount = selectedIds.length - failedIds.length;
    setSelectedIds(failedIds);
    setBulkDeleteOpen(false);
    if (successCount > 0) {
      await fetchItems();
    }
    if (failedIds.length > 0) {
      setError(`${failedIds.length} connection${failedIds.length > 1 ? "s" : ""} could not be deleted.`);
    }
    setActionMessage(
      `${successCount} connection${successCount > 1 ? "s" : ""} deleted.` +
        (failedIds.length > 0 ? ` ${failedIds.length} failed.` : "")
    );
    setBulkDeleteBusy(false);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Shared S3 Connections"
        description="Admin-managed S3 connections shared with linked UI users."
        breadcrumbs={[{ label: "Admin" }, { label: "Shared S3 Connections" }]}
        actions={[{ label: "Add connection", onClick: openCreateModal }]}
      />

      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {error && <PageBanner tone="error">{error}</PageBanner>}

      <ListSectionCard
        title="Shared S3 Connections"
        subtitle={`${total} entr${total === 1 ? "y" : "ies"} · search matches all records`}
        rightContent={(
          <div className="flex items-center gap-2">
            <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Filter
            </span>
            <input
              type="text"
              value={filter}
              onChange={(e) => handleFilterChange(e.target.value)}
              placeholder="Search name, endpoint, created by..."
              className={`${toolbarCompactInputClasses} w-full sm:w-64`}
            />
          </div>
        )}
      >
        {selectedIds.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/50">
            <span className="ui-caption font-semibold text-slate-700 dark:text-slate-200">
              {selectedIds.length} selected
              {hiddenSelectedCount > 0 ? ` (${hiddenSelectedCount} not visible)` : ""}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={tableActionButtonClasses}
                onClick={() => void submitBulkActivate()}
                disabled={bulkActivateBusy || bulkDisableBusy || bulkDeleteBusy || selectAllFilteredBusy}
              >
                {bulkActivateBusy ? "Activating..." : "Activate selected"}
              </button>
              <button
                type="button"
                className={tableActionButtonClasses}
                onClick={() => void submitBulkDisable()}
                disabled={bulkActivateBusy || bulkDisableBusy || bulkDeleteBusy || selectAllFilteredBusy}
              >
                {bulkDisableBusy ? "Disabling..." : "Disable selected"}
              </button>
              <button
                type="button"
                className={tableDeleteActionClasses}
                onClick={() => setBulkDeleteOpen(true)}
                disabled={bulkActivateBusy || bulkDisableBusy || bulkDeleteBusy || selectAllFilteredBusy}
              >
                Delete selected
              </button>
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="compact-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr>
                <th className="px-3 py-3 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <input
                    ref={selectionHeaderRef}
                    type="checkbox"
                    aria-label="Select all filtered connections"
                    checked={headerChecked}
                    onChange={(e) => {
                      void setSelectionForFilteredResults(e.target.checked);
                    }}
                    disabled={loading || selectAllFilteredBusy || total === 0 || bulkActivateBusy || bulkDisableBusy || bulkDeleteBusy}
                    className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                  />
                </th>
                {["Name", "Endpoint", "Status", "Created by", "UI Users", "Actions"].map((label) => (
                  <th key={label} className="px-6 py-3 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {tableStatus === "loading" && <TableEmptyState colSpan={7} message="Loading connections..." />}
              {tableStatus === "error" && <TableEmptyState colSpan={7} message="Unable to load connections." tone="error" />}
              {tableStatus === "empty" && (
                <TableEmptyState colSpan={7} title="No connections" description="Create a shared connection." />
              )}
              {items.map((c) => {
                const isActive = c.is_active !== false;
                return (
                  <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-3 py-4">
                      <input
                        type="checkbox"
                        aria-label={`Select connection ${c.name}`}
                        checked={selectedIdSet.has(c.id)}
                        onChange={() => toggleRowSelection(c.id)}
                        disabled={bulkActivateBusy || bulkDisableBusy || bulkDeleteBusy || selectAllFilteredBusy}
                        className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                      />
                    </td>
                    <td className="px-6 py-4 ui-body font-semibold text-slate-900 dark:text-slate-100">{c.name}</td>
                    <td className="px-6 py-4 ui-body text-slate-600 dark:text-slate-300">
                      {c.storage_endpoint_id != null ? (
                        <span>{endpointNameById.get(c.storage_endpoint_id) || `Endpoint #${c.storage_endpoint_id}`}</span>
                      ) : (
                        <span className="ui-mono">{c.endpoint_url || "-"}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 ui-body text-slate-600 dark:text-slate-300">
                      <span
                        className={`rounded-full px-2 py-1 ui-caption font-semibold ${
                          isActive
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                            : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                        }`}
                      >
                        {isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-6 py-4 ui-body text-slate-600 dark:text-slate-300">
                      <span className="rounded-full bg-slate-100 px-2 py-1 ui-caption font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                        {c.created_by_email || c.created_by_user_id}
                      </span>
                    </td>
                    <td className="px-6 py-4 ui-body text-slate-600 dark:text-slate-300">
                      {c.user_ids && c.user_ids.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {c.user_ids.map((id) => (
                            <span
                              key={id}
                              className="rounded-full bg-slate-100 px-2 py-1 ui-caption font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                            >
                              {portalUserLabelById.get(id) ?? `User #${id}`}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="ui-caption text-slate-400">None</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          className={tableActionButtonClasses}
                          onClick={() => void submitToggleConnectionStatus(c)}
                          disabled={
                            statusBusyId === c.id ||
                            bulkActivateBusy ||
                            bulkDisableBusy ||
                            bulkDeleteBusy ||
                            selectAllFilteredBusy
                          }
                        >
                          {statusBusyId === c.id ? "Saving..." : isActive ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          className={tableActionButtonClasses}
                          onClick={() => openEdit(c)}
                        >
                          Edit
                        </button>
                        <button
                          className={tableDeleteActionClasses}
                          onClick={() => setDeleteTarget(c)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <PaginationControls
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          disabled={loading}
        />
      </ListSectionCard>

      {/* Create modal */}
      {showCreateModal && (
        <Modal title="Add S3 Connection" onClose={() => (!creating ? setShowCreateModal(false) : null)}>
          {createError && (
            <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/50 dark:text-rose-200">
              {createError}
            </div>
          )}
          <form className="space-y-3" onSubmit={submitCreate}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Name *</label>
                <input
                  className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  value={createForm.name}
                  onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))}
                  required
                />
              </div>
              {!createHasPreset && (
                <div className="flex flex-col gap-1">
                  <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Provider</label>
                  <select
                    className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    value={createForm.provider_hint}
                    onChange={(e) => setCreateForm((p) => ({ ...p, provider_hint: e.target.value }))}
                  >
                    {providerHintOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="rounded-lg border border-slate-200 px-3 py-2 sm:col-span-2 dark:border-slate-700 dark:bg-slate-900/50">
                <div className="ui-body text-slate-700 dark:text-slate-200">
                  Visibility: <span className="font-semibold">Shared</span>
                </div>
                <p className="ui-caption text-slate-500 dark:text-slate-300">
                  Admin connections are always shared with linked UI users.
                </p>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <div className="ui-body font-medium text-slate-700 dark:text-slate-200">Workspace access</div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-2">
                    <input
                      id="create-access-manager"
                      type="checkbox"
                      checked={createForm.access_manager}
                      onChange={(e) => setCreateForm((p) => ({ ...p, access_manager: e.target.checked }))}
                      className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                    />
                    <label htmlFor="create-access-manager" className="ui-body text-slate-700 dark:text-slate-200">
                      Access manager
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      id="create-access-browser"
                      type="checkbox"
                      checked={createForm.access_browser}
                      onChange={(e) => setCreateForm((p) => ({ ...p, access_browser: e.target.checked }))}
                      className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                    />
                    <label htmlFor="create-access-browser" className="ui-body text-slate-700 dark:text-slate-200">
                      Access browser
                    </label>
                  </div>
                </div>
                <div className="ui-caption text-slate-500 dark:text-slate-300">At least one access must be enabled.</div>
              </div>
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Existing endpoint</label>
                <select
                  className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  value={createEndpointPresetId}
                  onChange={(e) => {
                    const next = e.target.value;
                    setCreateEndpointPresetId(next);
                    setCreatePresetTouched(true);
                    if (next) {
                      applyEndpointPreset(next, setCreateForm);
                    }
                  }}
                  disabled={loadingEndpoints}
                >
                  <option value="">{loadingEndpoints ? "Loading endpoints..." : "Custom endpoint"}</option>
                  {storageEndpoints.map((ep) => (
                    <option key={ep.id} value={ep.id}>
                      {ep.name} {ep.is_default ? "(default)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              {!createHasPreset && (
                <>
                  <div className="flex flex-col gap-1 sm:col-span-2">
                    <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Endpoint URL *</label>
                    <input
                      className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      placeholder="https://s3.amazonaws.com"
                      value={createForm.endpoint_url}
                      onChange={(e) => setCreateForm((p) => ({ ...p, endpoint_url: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Region (optional)</label>
                    <input
                      className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      value={createForm.region}
                      onChange={(e) => setCreateForm((p) => ({ ...p, region: e.target.value }))}
                    />
                  </div>
                  <div className="flex items-center gap-4 pt-6">
                    <label className="ui-checkbox">
                      <input
                        type="checkbox"
                        checked={createForm.force_path_style}
                        onChange={(e) => setCreateForm((p) => ({ ...p, force_path_style: e.target.checked }))}
                      />
                      <span>Force path-style</span>
                    </label>
                    <label className="ui-checkbox">
                      <input
                        type="checkbox"
                        checked={createForm.verify_tls}
                        onChange={(e) => setCreateForm((p) => ({ ...p, verify_tls: e.target.checked }))}
                      />
                      <span>Verify TLS</span>
                    </label>
                  </div>
                </>
              )}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Access key ID *</label>
                <input
                  className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  value={createForm.access_key_id}
                  onChange={(e) => setCreateForm((p) => ({ ...p, access_key_id: e.target.value }))}
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Secret access key *</label>
                <input
                  className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  value={createForm.secret_access_key}
                  onChange={(e) => setCreateForm((p) => ({ ...p, secret_access_key: e.target.value }))}
                  required
                />
              </div>
            </div>
            {createCredentialsValidation.status === "loading" && (
              <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 ui-caption text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/40 dark:text-blue-100">
                Validating credentials...
              </div>
            )}
            {createCredentialsValidation.status === "done" && createCredentialsValidation.result && (
              <div
                className={`rounded-md px-3 py-2 ui-caption ${
                  createCredentialsValidation.result.severity === "success"
                    ? "border border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/50 dark:text-emerald-200"
                    : createCredentialsValidation.result.severity === "warning"
                      ? "border border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/60 dark:text-amber-100"
                      : "border border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/50 dark:text-rose-200"
                }`}
              >
                {createCredentialsValidation.result.message}
              </div>
            )}
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded-md border border-slate-200 px-4 py-2 ui-body font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                disabled={creating}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-primary px-4 py-2 ui-body font-medium text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
                disabled={creating}
              >
                {creating ? "Creating..." : "Create"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit modal */}
      {editing && (
        <Modal title={`Edit: ${editing.name}`} onClose={() => (!editBusy ? closeEditModal() : null)}>
          {editError && (
            <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/50 dark:text-rose-200">
              {editError}
            </div>
          )}
          <form className="space-y-4" onSubmit={submitEdit}>
            <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-900/60">
              <button
                type="button"
                onClick={() => setEditTab("general")}
                className={`rounded-md px-3 py-1.5 ui-caption font-semibold transition ${
                  editTab === "general"
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100"
                    : "text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                }`}
              >
                General
              </button>
              <button
                type="button"
                onClick={() => setEditTab("users")}
                className={`rounded-md px-3 py-1.5 ui-caption font-semibold transition ${
                  editTab === "users"
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100"
                    : "text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                }`}
              >
                Linked UI users
              </button>
            </div>

            {editTab === "general" && (
              <>
                <div className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/50">
                  <div className="ui-body text-slate-700 dark:text-slate-200">
                    Visibility: <span className="font-semibold">Shared</span>
                  </div>
                  <div className="ui-caption text-slate-500 dark:text-slate-300">
                    {`Created by: ${editing.created_by_email || editing.created_by_user_id}`}
                  </div>
                </div>

                <div className="space-y-3 rounded-lg border border-slate-200 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/50">
                  <div>
                    <div className="ui-body font-semibold text-slate-900 dark:text-slate-100">Connection details</div>
                    <div className="ui-caption text-slate-500 dark:text-slate-300">
                      Update the endpoint and transport options.
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Name *</label>
                      <input
                        className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        value={editForm.name}
                        onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
                        required
                      />
                    </div>
                    {!editHasPreset && (
                      <div className="flex flex-col gap-1">
                        <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Provider</label>
                        <select
                          className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                          value={editForm.provider_hint}
                          onChange={(e) => setEditForm((p) => ({ ...p, provider_hint: e.target.value }))}
                        >
                          {providerHintOptions.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="flex flex-col gap-1 sm:col-span-2">
                      <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Existing endpoint</label>
                      <select
                        className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        value={editEndpointPresetId}
                        onChange={(e) => {
                          const next = e.target.value;
                          setEditEndpointPresetId(next);
                          if (next) {
                            applyEndpointPreset(next, setEditForm);
                          }
                        }}
                        disabled={loadingEndpoints}
                      >
                        <option value="">{loadingEndpoints ? "Loading endpoints..." : "Custom endpoint"}</option>
                        {storageEndpoints.map((ep) => (
                          <option key={ep.id} value={ep.id}>
                            {ep.name} {ep.is_default ? "(default)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    {!editHasPreset && (
                      <>
                        <div className="flex flex-col gap-1 sm:col-span-2">
                          <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Endpoint URL *</label>
                          <input
                            className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                            value={editForm.endpoint_url}
                            onChange={(e) => setEditForm((p) => ({ ...p, endpoint_url: e.target.value }))}
                            required
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Region (optional)</label>
                          <input
                            className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                            value={editForm.region}
                            onChange={(e) => setEditForm((p) => ({ ...p, region: e.target.value }))}
                          />
                        </div>
                        <div className="flex items-center gap-4 pt-6">
                          <label className="ui-checkbox">
                            <input
                              type="checkbox"
                              checked={editForm.force_path_style}
                              onChange={(e) => setEditForm((p) => ({ ...p, force_path_style: e.target.checked }))}
                            />
                            <span>Force path-style</span>
                          </label>
                          <label className="ui-checkbox">
                            <input
                              type="checkbox"
                              checked={editForm.verify_tls}
                              onChange={(e) => setEditForm((p) => ({ ...p, verify_tls: e.target.checked }))}
                            />
                            <span>Verify TLS</span>
                          </label>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="space-y-3 rounded-lg border border-slate-200 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/50">
                  <div>
                    <div className="ui-body font-semibold text-slate-900 dark:text-slate-100">Credentials</div>
                    <div className="ui-caption text-slate-500 dark:text-slate-300">Leave blank to keep the current keys.</div>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Access key ID</label>
                      <input
                        className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        value={editCredentials.access_key_id}
                        onChange={(e) => setEditCredentials((p) => ({ ...p, access_key_id: e.target.value }))}
                        placeholder="AKIA..."
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Secret access key</label>
                      <input
                        className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        value={editCredentials.secret_access_key}
                        onChange={(e) => setEditCredentials((p) => ({ ...p, secret_access_key: e.target.value }))}
                        placeholder="••••••••"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-3 rounded-lg border border-slate-200 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/50">
                  <div>
                    <div className="ui-body font-semibold text-slate-900 dark:text-slate-100">Access and credential metadata</div>
                    <div className="ui-caption text-slate-500 dark:text-slate-300">
                      Store owner context for keys imported from manager/ceph-admin flows.
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={editForm.access_manager}
                        onChange={(e) => setEditForm((p) => ({ ...p, access_manager: e.target.checked }))}
                        className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                      />
                      Access manager
                    </label>
                    <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={editForm.access_browser}
                        onChange={(e) => setEditForm((p) => ({ ...p, access_browser: e.target.checked }))}
                        className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                      />
                      Access browser
                    </label>
                  </div>
                  <div className="ui-caption text-slate-500 dark:text-slate-300">At least one access must be enabled.</div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Owner type</label>
                      <select
                        className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        value={editForm.credential_owner_type}
                        onChange={(e) => setEditForm((p) => ({ ...p, credential_owner_type: e.target.value }))}
                      >
                        {editCredentialOwnerTypeOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Owner identifier</label>
                      <input
                        className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        value={editForm.credential_owner_identifier}
                        onChange={(e) => setEditForm((p) => ({ ...p, credential_owner_identifier: e.target.value }))}
                        placeholder="account-id / user-id"
                      />
                    </div>
                  </div>
                </div>
              </>
            )}

            {editTab === "users" && (
              <div className="space-y-3 rounded-lg border border-slate-200 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/50">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Linked UI users</label>
                    <span className="ui-caption text-slate-500 dark:text-slate-400">
                      {linkedEditUsers.length} linked
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowEditUserPanel((prev) => !prev)}
                    className={tableActionButtonClasses}
                  >
                    {showEditUserPanel ? "Close" : "Add UI users"}
                  </button>
                </div>
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                  <table className="compact-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
                    <thead className="bg-slate-50 dark:bg-slate-900/50">
                      <tr>
                        <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          User
                        </th>
                        <th className="px-3 py-2 text-right ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {linkedEditUsers.length === 0 ? (
                        <tr>
                          <td colSpan={2} className="px-3 py-3 ui-body text-slate-500 dark:text-slate-400">
                            No linked users yet.
                          </td>
                        </tr>
                      ) : (
                        linkedEditUsers.map((user) => (
                          <tr key={user.id}>
                            <td className="px-3 py-2 ui-body text-slate-700 dark:text-slate-200">{user.label}</td>
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                onClick={() => setEditLinkedUserIds((prev) => prev.filter((id) => id !== user.id))}
                                className={tableDeleteActionClasses}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {showEditUserPanel && (
                  <div className="space-y-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/30">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Add UI users</label>
                        <span className="ui-caption text-slate-500 dark:text-slate-400">(filter by email)</span>
                      </div>
                      <input
                        type="text"
                        value={editUserSearch}
                        onChange={(e) => setEditUserSearch(e.target.value)}
                        placeholder="Search..."
                        className="w-44 rounded-md border border-slate-200 px-2 py-1 ui-caption focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                      {availableEditUsers.length === 0 && (
                        <p className="ui-caption text-slate-500 dark:text-slate-400">No results.</p>
                      )}
                      {visibleAvailableEditUsers.map((option) => {
                        const isSelected = editUserSelections.includes(option.id);
                        return (
                          <div
                            key={option.id}
                            className={`flex items-center justify-between rounded-md px-2 py-1 ${
                              isSelected
                                ? "bg-slate-50 dark:bg-slate-800/60"
                                : "hover:bg-slate-100 dark:hover:bg-slate-800/60"
                            }`}
                          >
                            <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleEditUserSelection(option.id)}
                                className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
                              />
                              <span>{option.label}</span>
                            </label>
                          </div>
                        );
                      })}
                      {availableEditUsers.length > maxLinkOptions && (
                        <p className="ui-caption text-slate-500 dark:text-slate-400">
                          Showing first {maxLinkOptions} matches. Refine your search to see more.
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="ui-caption text-slate-500 dark:text-slate-400">{editUserSelections.length} selected</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setShowEditUserPanel(false);
                            setEditUserSelections([]);
                            setEditUserSearch("");
                          }}
                          className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={editUserSelections.length === 0}
                          onClick={() => {
                            if (editUserSelections.length === 0) return;
                            setEditLinkedUserIds((prev) => normalizeLinkedUserIds([...prev, ...editUserSelections]));
                            setEditUserSelections([]);
                            setEditUserSearch("");
                            setShowEditUserPanel(false);
                          }}
                          className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
                        >
                          Add selected
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={closeEditModal}
                className="rounded-md border border-slate-200 px-4 py-2 ui-body font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                disabled={editBusy}
              >
                Close
              </button>
              <button
                className="rounded-md bg-primary px-4 py-2 ui-body font-medium text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
                disabled={editBusy}
              >
                {editBusy ? "Saving..." : "Save"}
              </button>
            </div>
          </form>

        </Modal>
      )}

      {/* Bulk delete modal */}
      {bulkDeleteOpen && (
        <Modal title={`Delete selected (${selectedIds.length})`} onClose={() => (!bulkDeleteBusy ? setBulkDeleteOpen(false) : null)}>
          <div className="space-y-4">
            <p className="ui-body">
              This will permanently delete {selectedIds.length} selected connection{selectedIds.length > 1 ? "s" : ""}.
            </p>
            <div className="flex justify-end gap-2">
              <UiButton variant="secondary" onClick={() => setBulkDeleteOpen(false)} disabled={bulkDeleteBusy}>
                Cancel
              </UiButton>
              <UiButton variant="danger" onClick={() => void submitBulkDelete()} disabled={bulkDeleteBusy}>
                {bulkDeleteBusy ? "Deleting..." : "Delete selected connections"}
              </UiButton>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete modal */}
      {deleteTarget && (
        <Modal title={`Delete: ${deleteTarget.name}`} onClose={() => (!deleteBusy ? setDeleteTarget(null) : null)}>
          <div className="space-y-4">
            {deleteError && <PageBanner tone="error">{deleteError}</PageBanner>}
            <p className="ui-body">This will permanently delete the connection and its credentials.</p>
            <div className="flex justify-end gap-2">
              <UiButton variant="secondary" onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>
                Cancel
              </UiButton>
              <UiButton variant="danger" onClick={submitDelete} disabled={deleteBusy}>
                {deleteBusy ? "Deleting..." : "Delete"}
              </UiButton>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
