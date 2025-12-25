/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  StorageEndpoint,
  StorageEndpointPayload,
  StorageProvider,
  createStorageEndpoint,
  deleteStorageEndpoint,
  listStorageEndpoints,
  updateStorageEndpoint,
} from "../../api/storageEndpoints";
import Modal from "../../components/Modal";
import PageHeader from "../../components/PageHeader";

type FormState = {
  name: string;
  endpoint_url: string;
  admin_endpoint: string;
  region: string;
  provider: StorageProvider;
  admin_access_key: string;
  admin_secret_key: string;
  supervision_access_key: string;
  supervision_secret_key: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  endpoint_url: "",
  admin_endpoint: "",
  region: "",
  provider: "ceph",
  admin_access_key: "",
  admin_secret_key: "",
  supervision_access_key: "",
  supervision_secret_key: "",
};

function extractError(err: unknown): string {
  if (!err) return "Action failed.";
  if (typeof err === "string") return err;
  if (typeof err === "object" && err !== null) {
    const axiosErr = err as { response?: { data?: unknown; status?: number } };
    const data = axiosErr.response?.data;
    if (typeof data === "string") return data;
    if (typeof data === "object" && data && "detail" in data) {
      const detail = (data as { detail?: unknown }).detail;
      if (typeof detail === "string") return detail;
      if (Array.isArray(detail) && detail.length > 0 && typeof detail[0] === "string") return detail[0];
    }
  }
  return "An error occurred.";
}

function ProviderBadge({ provider }: { provider: StorageProvider }) {
  const isCeph = provider === "ceph";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
        isCeph
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100"
          : "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-100"
      }`}
    >
      {isCeph ? "Ceph" : "Other"}
    </span>
  );
}

function LockBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-200">
      🔒 {label}
    </span>
  );
}

export default function StorageEndpointsPage() {
  const [endpoints, setEndpoints] = useState<StorageEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StorageEndpoint | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const resetForm = useCallback(() => {
    setForm(EMPTY_FORM);
    setFormError(null);
    setEditingId(null);
  }, []);

  const loadEndpoints = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listStorageEndpoints();
      setEndpoints(data);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEndpoints();
  }, [loadEndpoints]);

  const cephMode = useMemo(() => form.provider === "ceph", [form.provider]);
  const defaultEndpoint = useMemo(() => endpoints.find((ep) => ep.is_default), [endpoints]);

  const startCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const startEdit = (endpoint: StorageEndpoint) => {
    setEditingId(endpoint.id);
    setForm({
      name: endpoint.name ?? "",
      endpoint_url: endpoint.endpoint_url ?? "",
      admin_endpoint: endpoint.admin_endpoint ?? "",
      region: endpoint.region ?? "",
      provider: endpoint.provider,
      admin_access_key: endpoint.admin_access_key ?? "",
      admin_secret_key: "",
      supervision_access_key: endpoint.supervision_access_key ?? "",
      supervision_secret_key: "",
    });
    setFormError(null);
    setShowForm(true);
  };

  const onCloseForm = () => {
    setShowForm(false);
    resetForm();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteStorageEndpoint(deleteTarget.id);
      setDeleteTarget(null);
      setActionMessage("Endpoint deleted.");
      loadEndpoints();
    } catch (err) {
      setDeleteError(extractError(err));
    } finally {
      setDeleteBusy(false);
    }
  };

  const buildPayload = (): StorageEndpointPayload | null => {
    const trimmedName = form.name.trim();
    const trimmedEndpoint = form.endpoint_url.trim();
    const trimmedAdminEndpoint = form.admin_endpoint.trim();
    const trimmedRegion = form.region.trim();
    const trimmedAdminAccess = form.admin_access_key.trim();
    const trimmedAdminSecret = form.admin_secret_key.trim();
    const trimmedSupervisionAccess = form.supervision_access_key.trim();
    const trimmedSupervisionSecret = form.supervision_secret_key.trim();

    if (!trimmedName) {
      setFormError("Storage name is required.");
      return null;
    }
    if (!trimmedEndpoint) {
      setFormError("Endpoint URL is required.");
      return null;
    }

    const payload: StorageEndpointPayload = {
      name: trimmedName,
      endpoint_url: trimmedEndpoint,
      admin_endpoint: trimmedAdminEndpoint || null,
      region: trimmedRegion || null,
      provider: form.provider,
    };

    if (form.provider === "ceph") {
      if (editingId) {
        if (trimmedAdminAccess) payload.admin_access_key = trimmedAdminAccess;
        if (trimmedAdminSecret) payload.admin_secret_key = trimmedAdminSecret;
        if (trimmedSupervisionAccess) payload.supervision_access_key = trimmedSupervisionAccess;
        if (trimmedSupervisionSecret) payload.supervision_secret_key = trimmedSupervisionSecret;
      } else {
        payload.admin_access_key = trimmedAdminAccess;
        payload.admin_secret_key = trimmedAdminSecret;
        payload.supervision_access_key = trimmedSupervisionAccess || null;
        payload.supervision_secret_key = trimmedSupervisionSecret || null;
        if (!payload.admin_access_key || !payload.admin_secret_key) {
          setFormError("Admin credentials are required for a Ceph endpoint.");
          return null;
        }
      }
    }

    return payload;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const payload = buildPayload();
    if (!payload) return;
    setSaving(true);
    try {
      if (editingId) {
        await updateStorageEndpoint(editingId, payload);
        setActionMessage("Endpoint updated.");
      } else {
        await createStorageEndpoint(payload);
        setActionMessage("Endpoint added.");
      }
      setShowForm(false);
      resetForm();
      loadEndpoints();
    } catch (err) {
      setFormError(extractError(err));
    } finally {
      setSaving(false);
    }
  };

  const renderEndpointCard = (endpoint: StorageEndpoint) => {
    const isLocked = !endpoint.is_editable || endpoint.is_default;
    const showSupervision = endpoint.supervision_access_key || endpoint.has_supervision_secret;

    return (
      <div
        key={endpoint.id}
        className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/70"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{endpoint.name}</h3>
              <ProviderBadge provider={endpoint.provider} />
              {endpoint.is_default && <LockBadge label="Default (env)" />}
              {!endpoint.is_editable && !endpoint.is_default && <LockBadge label="Protected" />}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <span className="font-semibold text-slate-700 dark:text-slate-100">Endpoint:</span>
              <code className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                {endpoint.endpoint_url}
              </code>
            </div>
            {endpoint.admin_endpoint && endpoint.admin_endpoint !== endpoint.endpoint_url && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <span className="font-semibold text-slate-700 dark:text-slate-100">Admin endpoint:</span>
                <code className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                  {endpoint.admin_endpoint}
                </code>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {endpoint.is_editable && !endpoint.is_default ? (
              <>
                <button
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-400 dark:hover:text-primary-100"
                  onClick={() => startEdit(endpoint)}
                  type="button"
                >
                  Edit
                </button>
                <button
                  className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700"
                  onClick={() => {
                    setDeleteTarget(endpoint);
                    setDeleteError(null);
                  }}
                  type="button"
                >
                  Delete
                </button>
              </>
            ) : (
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Read-only
              </span>
            )}
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700 shadow-inner dark:bg-slate-800 dark:text-slate-100">
            <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Region</p>
            <p className="font-semibold">{endpoint.region || "Default"}</p>
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700 shadow-inner dark:bg-slate-800 dark:text-slate-100">
            <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Admin key</p>
            {endpoint.provider === "ceph" ? (
              <p className="font-semibold">
                {endpoint.admin_access_key ? endpoint.admin_access_key : "Not configured"}
                {endpoint.has_admin_secret && <span className="ml-2 text-xs text-emerald-500">(secret stored)</span>}
              </p>
            ) : (
              <p className="font-semibold text-slate-500">Not required</p>
            )}
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700 shadow-inner dark:bg-slate-800 dark:text-slate-100">
            <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Supervision</p>
            {showSupervision ? (
              <p className="font-semibold">
                {endpoint.supervision_access_key || "—"}
                {endpoint.has_supervision_secret && (
                  <span className="ml-2 text-xs text-emerald-500">(secret stored)</span>
                )}
              </p>
            ) : (
              <p className="font-semibold text-slate-500">Not set</p>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Storage endpoints"
        description="Manage the S3/Ceph endpoints used by the console."
        rightContent={[
          <button
            key="new-endpoint"
            className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-600"
            onClick={startCreate}
            type="button"
          >
            New endpoint
          </button>,
        ]}
        inlineContent={
          defaultEndpoint ? (
            <span className="text-sm font-semibold text-slate-500 dark:text-slate-300">
              Default endpoint: {defaultEndpoint.name}
            </span>
          ) : null
        }
      />

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 shadow-sm dark:border-rose-900/50 dark:bg-rose-900/20 dark:text-rose-100">
          {error}
        </div>
      )}
      {actionMessage && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 shadow-sm dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-50">
          {actionMessage}
        </div>
      )}
      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white/70 px-5 py-6 text-sm text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300">
          Loading endpoints...
        </div>
      ) : endpoints.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-8 text-center text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
          No endpoints configured yet.
        </div>
      ) : (
        <div className="grid gap-4">{endpoints.map((ep) => renderEndpointCard(ep))}</div>
      )}

      {showForm && (
        <Modal title={editingId ? "Edit endpoint" : "New endpoint"} onClose={onCloseForm}>
          <form onSubmit={handleSubmit} className="space-y-4">
            {formError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 shadow-sm dark:border-rose-900/50 dark:bg-rose-900/30 dark:text-rose-100">
                {formError}
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1 text-sm font-semibold text-slate-700 dark:text-slate-100">
                Storage name
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  required
                />
              </label>
              <div className="space-y-2">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-100">Type</span>
                <div className="flex gap-3">
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-400 dark:hover:text-primary-100">
                    <input
                      type="radio"
                      name="provider"
                      value="ceph"
                      checked={form.provider === "ceph"}
                      onChange={() => setForm((prev) => ({ ...prev, provider: "ceph" }))}
                    />
                    <span>Ceph</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-400 dark:hover:text-primary-100">
                    <input
                      type="radio"
                      name="provider"
                      value="other"
                      checked={form.provider === "other"}
                      onChange={() =>
                        setForm((prev) => ({
                          ...prev,
                          provider: "other",
                          admin_access_key: "",
                          admin_secret_key: "",
                          supervision_access_key: "",
                          supervision_secret_key: "",
                        }))
                      }
                    />
                    <span>Other</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1 text-sm font-semibold text-slate-700 dark:text-slate-100">
                Endpoint S3
                <input
                  type="text"
                  value={form.endpoint_url}
                  onChange={(e) => setForm((prev) => ({ ...prev, endpoint_url: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  placeholder="https://s3.example.com"
                  required
                />
              </label>
              <label className="space-y-1 text-sm font-semibold text-slate-700 dark:text-slate-100">
                Admin endpoint (optional)
                <input
                  type="text"
                  value={form.admin_endpoint}
                  onChange={(e) => setForm((prev) => ({ ...prev, admin_endpoint: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  placeholder="http://rgw-admin.local"
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1 text-sm font-semibold text-slate-700 dark:text-slate-100">
                Region (optional)
                <input
                  type="text"
                  value={form.region}
                  onChange={(e) => setForm((prev) => ({ ...prev, region: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  placeholder="us-east-1"
                />
              </label>
              {cephMode && (
                <label className="space-y-1 text-sm font-semibold text-slate-700 dark:text-slate-100">
                  Access key admin
                  <input
                    type="text"
                    value={form.admin_access_key}
                    onChange={(e) => setForm((prev) => ({ ...prev, admin_access_key: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    placeholder="AKIA..."
                    required={!editingId}
                  />
                </label>
              )}
            </div>

            {cephMode && (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1 text-sm font-semibold text-slate-700 dark:text-slate-100">
                  Admin secret key {editingId ? <span className="text-xs font-normal text-slate-500">(leave blank to keep)</span> : null}
                  <input
                    type="password"
                    value={form.admin_secret_key}
                    onChange={(e) => setForm((prev) => ({ ...prev, admin_secret_key: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    placeholder="••••••"
                    required={!editingId}
                  />
                </label>
                <div className="space-y-1 text-sm font-semibold text-slate-700 dark:text-slate-100">
                  Supervision (optional)
                  <div className="grid gap-3">
                    <input
                      type="text"
                      value={form.supervision_access_key}
                      onChange={(e) => setForm((prev) => ({ ...prev, supervision_access_key: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      placeholder="Access key supervision"
                    />
                    <input
                      type="password"
                      value={form.supervision_secret_key}
                      onChange={(e) => setForm((prev) => ({ ...prev, supervision_secret_key: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      placeholder="Secret key supervision"
                    />
                  </div>
                  <p className="text-xs font-normal text-slate-500 dark:text-slate-400">
                    Use these keys for read-only monitoring actions.
                  </p>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onCloseForm}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-400 dark:hover:text-primary-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Saving..." : editingId ? "Update" : "Create"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteTarget && (
        <Modal title="Delete endpoint" onClose={() => setDeleteTarget(null)}>
          <div className="space-y-4">
            {deleteError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 shadow-sm dark:border-rose-900/50 dark:bg-rose-900/30 dark:text-rose-100">
                {deleteError}
              </div>
            )}
            <p className="text-sm text-slate-700 dark:text-slate-100">
              Are you sure you want to delete <strong>{deleteTarget.name}</strong>? This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-400 dark:hover:text-primary-100"
                type="button"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteBusy}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:opacity-70"
                type="button"
              >
                {deleteBusy ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
