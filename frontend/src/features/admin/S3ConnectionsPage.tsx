/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";
import { Dispatch, FormEvent, SetStateAction, useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "../../components/PageHeader";
import Modal from "../../components/Modal";
import PageBanner from "../../components/PageBanner";
import TableEmptyState from "../../components/TableEmptyState";
import ListSectionCard from "../../components/list/ListSectionCard";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import PaginationControls from "../../components/PaginationControls";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { toolbarCompactInputClasses } from "../../components/toolbarControlClasses";
import {
  S3ConnectionAdminItem,
  createAdminS3Connection,
  deleteAdminS3Connection,
  listAdminS3Connections,
  rotateAdminS3ConnectionCredentials,
  updateAdminS3Connection,
  validateAdminS3ConnectionCredentials,
} from "../../api/s3ConnectionsAdmin";
import { listMinimalUsers, UserSummary } from "../../api/users";
import { listStorageEndpoints, StorageEndpoint } from "../../api/storageEndpoints";
import { S3CredentialsValidationPayload, useLiveS3CredentialsValidation } from "../shared/useLiveS3CredentialsValidation";

const providerHintOptions = [
  { value: "", label: "(auto)" },
  { value: "aws", label: "AWS" },
  { value: "ceph", label: "Ceph RGW" },
  { value: "scality", label: "Scality" },
  { value: "minio", label: "MinIO" },
  { value: "other", label: "Other" },
];

export default function S3ConnectionsPage() {
  const [items, setItems] = useState<S3ConnectionAdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState("");
  const currentUser = useMemo(() => {
    const raw = localStorage.getItem("user");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as { id?: number | null };
    } catch {
      return null;
    }
  }, []);
  const currentUserId = currentUser?.id ?? null;

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
    visibility: "private" as "private" | "shared" | "public",
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
    visibility: "private" as "private" | "shared" | "public",
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

  const [deleteTarget, setDeleteTarget] = useState<S3ConnectionAdminItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const extractError = (err: unknown) => {
    if (axios.isAxiosError(err)) {
      return ((err.response?.data as { detail?: string })?.detail || err.message || "Unexpected error");
    }
    return err instanceof Error ? err.message : "Unexpected error";
  };

  const resetCreateForm = () => {
    setCreateEndpointPresetId("");
    setCreatePresetTouched(false);
    setCreateError(null);
    setCreateForm({
      name: "",
      provider_hint: "",
      visibility: "private",
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
  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: items.length,
  });

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
      visibility: (conn.visibility as "private" | "shared" | "public") || (conn.is_public ? "public" : conn.is_shared ? "shared" : "private"),
      access_manager: conn.access_manager === true,
      access_browser: conn.access_browser !== false,
      credential_owner_type: conn.credential_owner_type || "",
      credential_owner_identifier: conn.credential_owner_identifier || "",
      endpoint_url: conn.endpoint_url,
      region: conn.region || "",
      force_path_style: Boolean(conn.force_path_style),
      verify_tls: conn.verify_tls !== false,
    });
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
        visibility: createForm.visibility,
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
      if (accessKeyId && secretAccessKey) {
        await rotateAdminS3ConnectionCredentials(editing.id, {
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
      await updateAdminS3Connection(editing.id, {
        name: editForm.name || undefined,
        visibility: editForm.visibility,
        access_manager: editForm.access_manager,
        access_browser: editForm.access_browser,
        credential_owner_type: editForm.credential_owner_type || null,
        credential_owner_identifier: editForm.credential_owner_identifier || null,
        ...endpointPayload,
      });
      setEditCredentials({ access_key_id: "", secret_access_key: "" });
      setActionMessage("Connection updated.");
      await fetchItems();
      setEditing(null);
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
      setActionMessage("Connection deleted.");
      await fetchItems();
    } catch (err) {
      setDeleteError(extractError(err));
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="S3 Connections"
        description="Private connections are owner-only. Shared connections are owner + linked users. Public connections are visible to everyone."
        breadcrumbs={[{ label: "Admin" }, { label: "Connections" }]}
        actions={[{ label: "Add connection", onClick: openCreateModal }]}
      />

      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {error && <PageBanner tone="error">{error}</PageBanner>}

      <ListSectionCard
        title="Connections"
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
              placeholder="Search name, endpoint, owner..."
              className={`${toolbarCompactInputClasses} w-full sm:w-64`}
            />
          </div>
        )}
      >
        <div className="overflow-x-auto">
          <table className="compact-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr>
                {["Name", "Endpoint", "Visibility", "Owner", "UI Users", "Actions"].map((label) => (
                  <th key={label} className="px-6 py-3 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {tableStatus === "loading" && <TableEmptyState colSpan={6} message="Loading connections..." />}
              {tableStatus === "error" && <TableEmptyState colSpan={6} message="Unable to load connections." tone="error" />}
              {tableStatus === "empty" && (
                <TableEmptyState colSpan={6} title="No connections" description="Create a private, shared, or public connection." />
              )}
              {items.map((c) => {
                const visibility = c.visibility || (c.is_public ? "public" : c.is_shared ? "shared" : "private");
                const canManage =
                  visibility === "public" || visibility === "shared" || (currentUserId != null && c.owner_user_id === currentUserId);
                return (
                  <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-6 py-4 ui-body font-semibold text-slate-900 dark:text-slate-100">{c.name}</td>
                    <td className="px-6 py-4 ui-body text-slate-600 dark:text-slate-300">
                      {c.storage_endpoint_id != null ? (
                        <span>{endpointNameById.get(c.storage_endpoint_id) || `Endpoint #${c.storage_endpoint_id}`}</span>
                      ) : (
                        <span className="ui-mono">{c.endpoint_url || "-"}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 ui-body text-slate-600 dark:text-slate-300">
                      {visibility === "public" ? "Public" : visibility === "shared" ? "Shared" : "Private"}
                    </td>
                    <td className="px-6 py-4 ui-body text-slate-600 dark:text-slate-300">
                      {visibility === "public" ? (
                        "—"
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-1 ui-caption font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                          {c.owner_email || c.owner_user_id}
                        </span>
                      )}
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
                          className={tableActionButtonClasses}
                          onClick={() => openEdit(c)}
                          disabled={!canManage}
                          title={canManage ? undefined : "Only the owner can manage private connections."}
                        >
                          Edit
                        </button>
                        <button
                          className={tableDeleteActionClasses}
                          onClick={() => setDeleteTarget(c)}
                          disabled={!canManage}
                          title={canManage ? undefined : "Only the owner can manage private connections."}
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
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Visibility</label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
                    <input
                      type="radio"
                      name="create-visibility"
                      value="private"
                      checked={createForm.visibility === "private"}
                      onChange={() => setCreateForm((p) => ({ ...p, visibility: "private" }))}
                      className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
                    />
                    Private (owner only)
                  </label>
                  <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
                    <input
                      type="radio"
                      name="create-visibility"
                      value="shared"
                      checked={createForm.visibility === "shared"}
                      onChange={() => setCreateForm((p) => ({ ...p, visibility: "shared" }))}
                      className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
                    />
                    Shared (owner + linked users)
                  </label>
                  <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
                    <input
                      type="radio"
                      name="create-visibility"
                      value="public"
                      checked={createForm.visibility === "public"}
                      onChange={() => setCreateForm((p) => ({ ...p, visibility: "public" }))}
                      className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
                    />
                    Public (visible to all)
                  </label>
                </div>
                <p className="ui-caption text-slate-500 dark:text-slate-300">
                  Shared connections are configurable by UI admins only. Public connections are visible to everyone.
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
        <Modal title={`Edit: ${editing.name}`} onClose={() => (!editBusy ? setEditing(null) : null)}>
          {editError && (
            <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/50 dark:text-rose-200">
              {editError}
            </div>
          )}
          <form className="space-y-4" onSubmit={submitEdit}>

            <div className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/50">
              <div className="ui-body text-slate-700 dark:text-slate-200">
                Visibility:{" "}
                <span className="font-semibold">
                  {editForm.visibility === "public" ? "Public" : editForm.visibility === "shared" ? "Shared" : "Private"}
                </span>
              </div>
              <div className="ui-caption text-slate-500 dark:text-slate-300">
                {editForm.visibility === "public"
                  ? "Visible to all UI users. Public connections have no owner."
                  : editForm.visibility === "shared"
                    ? `Owner: ${editing.owner_email || editing.owner_user_id} (owner + linked users)`
                  : `Owner: ${editing.owner_email || editing.owner_user_id}`}
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

            <div className="space-y-2 rounded-lg border border-slate-200 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/50">
              <div className="ui-body font-semibold text-slate-900 dark:text-slate-100">Visibility</div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
                  <input
                    type="radio"
                    name="visibility"
                    value="private"
                    checked={editForm.visibility === "private"}
                    onChange={() => setEditForm((p) => ({ ...p, visibility: "private" }))}
                    className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
                  />
                  Private (owner only)
                </label>
                <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
                  <input
                    type="radio"
                    name="visibility"
                    value="shared"
                    checked={editForm.visibility === "shared"}
                    onChange={() => setEditForm((p) => ({ ...p, visibility: "shared" }))}
                    className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
                  />
                  Shared (owner + linked users)
                </label>
                <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
                  <input
                    type="radio"
                    name="visibility"
                    value="public"
                    checked={editForm.visibility === "public"}
                    onChange={() => setEditForm((p) => ({ ...p, visibility: "public" }))}
                    className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
                  />
                  Public (visible to all)
                </label>
              </div>
              <div className="ui-caption text-slate-500 dark:text-slate-300">
                Private is strictly owner-only. Shared can be linked to multiple UI users.
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
                  <input
                    className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    value={editForm.credential_owner_type}
                    onChange={(e) => setEditForm((p) => ({ ...p, credential_owner_type: e.target.value }))}
                    placeholder="iam_user | account_user | s3_user"
                  />
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

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditing(null)}
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

      {/* Delete modal */}
      {deleteTarget && (
        <Modal title={`Delete: ${deleteTarget.name}`} onClose={() => (!deleteBusy ? setDeleteTarget(null) : null)}>
          <div className="space-y-4">
            {deleteError && <PageBanner tone="error">{deleteError}</PageBanner>}
            <p className="ui-body">This will permanently delete the connection and its credentials.</p>
            <div className="flex justify-end gap-2">
              <button className="ui-btn" onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>
                Cancel
              </button>
              <button className="ui-btn ui-btn-danger" onClick={submitDelete} disabled={deleteBusy}>
                {deleteBusy ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
