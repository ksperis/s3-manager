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
  setDefaultStorageEndpoint,
  updateStorageEndpoint,
} from "../../api/storageEndpoints";
import Modal from "../../components/Modal";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";

type FormState = {
  name: string;
  endpoint_url: string;
  region: string;
  provider: StorageProvider;
  admin_access_key: string;
  admin_secret_key: string;
  supervision_access_key: string;
  supervision_secret_key: string;
  features: FeaturesState;
};

type FeatureKey = "admin" | "sts" | "usage" | "metrics" | "static_website";

type FeatureState = {
  enabled: boolean;
  endpoint: string;
};

type FeaturesState = Record<FeatureKey, FeatureState>;

const FEATURE_KEYS: FeatureKey[] = ["admin", "sts", "usage", "metrics", "static_website"];

function createEmptyFeatures(): FeaturesState {
  return {
    admin: { enabled: false, endpoint: "" },
    sts: { enabled: false, endpoint: "" },
    usage: { enabled: false, endpoint: "" },
    metrics: { enabled: false, endpoint: "" },
    static_website: { enabled: false, endpoint: "" },
  };
}

function applyFeatureConstraints(features: FeaturesState, provider: StorageProvider): FeaturesState {
  const next: FeaturesState = {
    admin: { ...features.admin },
    sts: { ...features.sts },
    usage: { ...features.usage },
    metrics: { ...features.metrics },
    static_website: { ...features.static_website },
  };
  if (provider !== "ceph") {
    next.admin.enabled = false;
    next.usage.enabled = false;
    next.metrics.enabled = false;
  }
  if (!next.admin.enabled) {
    next.admin.endpoint = "";
    next.usage.enabled = false;
    next.metrics.enabled = false;
  }
  if (!next.sts.enabled) {
    next.sts.endpoint = "";
  }
  return next;
}

function buildFeaturesYaml(features: FeaturesState): string {
  const lines: string[] = ["features:"];
  FEATURE_KEYS.forEach((key) => {
    const entry = features[key];
    lines.push(`  ${key}:`);
    lines.push(`    enabled: ${entry.enabled ? "true" : "false"}`);
    if ((key === "admin" || key === "sts") && entry.endpoint.trim()) {
      lines.push(`    endpoint: ${entry.endpoint.trim()}`);
    }
  });
  return lines.join("\n");
}

function createEmptyForm(): FormState {
  const features = createEmptyFeatures();
  return {
    name: "",
    endpoint_url: "",
    region: "",
    provider: "ceph",
    admin_access_key: "",
    admin_secret_key: "",
    supervision_access_key: "",
    supervision_secret_key: "",
    features,
  };
}

const EMPTY_FORM: FormState = createEmptyForm();

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
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ui-caption font-semibold ${
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
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 ui-caption font-semibold text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-200">
      🔒 {label}
    </span>
  );
}

function StatusBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 ui-caption font-semibold text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-200">
      {label}
    </span>
  );
}

function resolveCapability(endpoint: StorageEndpoint, key: string, fallback = false) {
  return endpoint.capabilities?.[key] ?? fallback;
}

function resolveFeatureState(endpoint: StorageEndpoint, provider: StorageProvider): FeaturesState {
  if (endpoint.features) {
    return applyFeatureConstraints(
      {
        admin: {
          enabled: Boolean(endpoint.features.admin?.enabled),
          endpoint: endpoint.features.admin?.endpoint ?? "",
        },
        sts: {
          enabled: Boolean(endpoint.features.sts?.enabled),
          endpoint: endpoint.features.sts?.endpoint ?? "",
        },
        usage: {
          enabled: Boolean(endpoint.features.usage?.enabled),
          endpoint: "",
        },
        metrics: {
          enabled: Boolean(endpoint.features.metrics?.enabled),
          endpoint: "",
        },
        static_website: {
          enabled: Boolean(endpoint.features.static_website?.enabled),
          endpoint: "",
        },
      },
      provider
    );
  }
  const fallback: FeaturesState = {
    admin: { enabled: resolveCapability(endpoint, "admin"), endpoint: endpoint.admin_endpoint ?? "" },
    sts: { enabled: resolveCapability(endpoint, "sts"), endpoint: "" },
    usage: { enabled: resolveCapability(endpoint, "usage"), endpoint: "" },
    metrics: { enabled: resolveCapability(endpoint, "metrics"), endpoint: "" },
    static_website: { enabled: resolveCapability(endpoint, "static_website"), endpoint: "" },
  };
  return applyFeatureConstraints(fallback, provider);
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
  const [defaultError, setDefaultError] = useState<string | null>(null);
  const [defaultBusyId, setDefaultBusyId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StorageEndpoint | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const resetForm = useCallback(() => {
    setForm(createEmptyForm());
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
  const updateFeatures = useCallback(
    (updater: (current: FeaturesState) => FeaturesState, providerOverride?: StorageProvider) => {
      setForm((prev) => {
        const provider = providerOverride ?? prev.provider;
        const nextRaw = updater(prev.features);
        const constrained = applyFeatureConstraints(nextRaw, provider);
        return {
          ...prev,
          provider,
          features: constrained,
        };
      });
    },
    []
  );

  const handleProviderChange = (provider: StorageProvider) => {
    setForm((prev) => {
      const constrained = applyFeatureConstraints(prev.features, provider);
      return {
        ...prev,
        provider,
        admin_access_key: provider === "ceph" ? prev.admin_access_key : "",
        admin_secret_key: provider === "ceph" ? prev.admin_secret_key : "",
        supervision_access_key: provider === "ceph" ? prev.supervision_access_key : "",
        supervision_secret_key: provider === "ceph" ? prev.supervision_secret_key : "",
        features: constrained,
      };
    });
  };

  const startCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const startEdit = (endpoint: StorageEndpoint) => {
    const features = resolveFeatureState(endpoint, endpoint.provider);
    setEditingId(endpoint.id);
    setForm({
      name: endpoint.name ?? "",
      endpoint_url: endpoint.endpoint_url ?? "",
      region: endpoint.region ?? "",
      provider: endpoint.provider,
      admin_access_key: endpoint.admin_access_key ?? "",
      admin_secret_key: "",
      supervision_access_key: endpoint.supervision_access_key ?? "",
      supervision_secret_key: "",
      features,
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

  const handleSetDefault = async (endpoint: StorageEndpoint) => {
    if (endpoint.is_default) return;
    setDefaultError(null);
    setDefaultBusyId(endpoint.id);
    try {
      await setDefaultStorageEndpoint(endpoint.id);
      setActionMessage("Default endpoint updated.");
      loadEndpoints();
    } catch (err) {
      setDefaultError(extractError(err));
    } finally {
      setDefaultBusyId(null);
    }
  };

  const buildPayload = (): StorageEndpointPayload | null => {
    const trimmedName = form.name.trim();
    const trimmedEndpoint = form.endpoint_url.trim();
    const trimmedRegion = form.region.trim();
    const trimmedAdminAccess = form.admin_access_key.trim();
    const trimmedAdminSecret = form.admin_secret_key.trim();
    const trimmedSupervisionAccess = form.supervision_access_key.trim();
    const trimmedSupervisionSecret = form.supervision_secret_key.trim();
    const constrainedFeatures = applyFeatureConstraints(form.features, form.provider);
    const featuresConfig = buildFeaturesYaml(constrainedFeatures);

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
      region: trimmedRegion || null,
      provider: form.provider,
      features_config: featuresConfig,
    };

    if (form.provider === "ceph") {
      const adminEnabled = constrainedFeatures.admin.enabled;
      if (editingId) {
        if (trimmedAdminAccess) {
          payload.admin_access_key = trimmedAdminAccess;
          if (trimmedAdminSecret) payload.admin_secret_key = trimmedAdminSecret;
        } else {
          payload.admin_access_key = null;
          payload.admin_secret_key = null;
        }
        if (trimmedSupervisionAccess) {
          payload.supervision_access_key = trimmedSupervisionAccess;
          if (trimmedSupervisionSecret) payload.supervision_secret_key = trimmedSupervisionSecret;
        } else {
          payload.supervision_access_key = null;
          payload.supervision_secret_key = null;
        }
      } else {
        payload.admin_access_key = trimmedAdminAccess || null;
        payload.admin_secret_key = trimmedAdminSecret || null;
        payload.supervision_access_key = trimmedSupervisionAccess || null;
        payload.supervision_secret_key = trimmedSupervisionSecret || null;
        if (adminEnabled && (!payload.admin_access_key || !payload.admin_secret_key)) {
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
    const showSupervision = endpoint.supervision_access_key || endpoint.has_supervision_secret;
    const features = resolveFeatureState(endpoint, endpoint.provider);
    const adminEnabled = features.admin.enabled;
    const stsEnabled = features.sts.enabled;
    const usageEnabled = features.usage.enabled;
    const metricsEnabled = features.metrics.enabled;
    const staticWebsiteEnabled = features.static_website.enabled;
    const settingDefault = defaultBusyId === endpoint.id;
    const adminEndpointOverride = features.admin.endpoint.trim();
    const stsEndpointOverride = features.sts.endpoint.trim();
    const showAdminEndpoint =
      adminEnabled &&
      Boolean(adminEndpointOverride) &&
      adminEndpointOverride !== endpoint.endpoint_url;
    const showStsEndpoint =
      stsEnabled &&
      Boolean(stsEndpointOverride) &&
      stsEndpointOverride !== endpoint.endpoint_url;

    return (
      <div
        key={endpoint.id}
        className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/70 ui-body"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="ui-section font-semibold text-slate-900 dark:text-white">{endpoint.name}</h3>
              <ProviderBadge provider={endpoint.provider} />
              {endpoint.is_default && <StatusBadge label="Default" />}
              {!endpoint.is_editable && <LockBadge label="Protected" />}
            </div>
            <div className="flex flex-wrap items-center gap-2 ui-body text-slate-600 dark:text-slate-300">
              <span className="font-semibold text-slate-700 dark:text-slate-100">Endpoint:</span>
              <code className="rounded bg-slate-100 px-2 py-1 ui-caption text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                {endpoint.endpoint_url}
              </code>
            </div>
            {showAdminEndpoint && (
              <div className="flex flex-wrap items-center gap-2 ui-body text-slate-600 dark:text-slate-300">
                <span className="font-semibold text-slate-700 dark:text-slate-100">Admin endpoint:</span>
                <code className="rounded bg-slate-100 px-2 py-1 ui-caption text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                  {adminEndpointOverride}
                </code>
              </div>
            )}
            {showStsEndpoint && (
              <div className="flex flex-wrap items-center gap-2 ui-body text-slate-600 dark:text-slate-300">
                <span className="font-semibold text-slate-700 dark:text-slate-100">STS endpoint:</span>
                <code className="rounded bg-slate-100 px-2 py-1 ui-caption text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                  {stsEndpointOverride}
                </code>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!endpoint.is_default && (
              <button
                className="rounded-lg border border-slate-200 px-3 py-1.5 ui-body font-semibold text-slate-700 transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-400 dark:hover:text-primary-100"
                onClick={() => handleSetDefault(endpoint)}
                type="button"
                disabled={Boolean(defaultBusyId)}
              >
                {settingDefault ? "Setting..." : "Set as default"}
              </button>
            )}
            {endpoint.is_editable ? (
              <>
                <button
                  className="rounded-lg border border-slate-200 px-3 py-1.5 ui-body font-semibold text-slate-700 transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-400 dark:hover:text-primary-100"
                  onClick={() => startEdit(endpoint)}
                  type="button"
                >
                  Edit
                </button>
                <button
                  className="rounded-lg bg-rose-600 px-3 py-1.5 ui-body font-semibold text-white shadow-sm transition hover:bg-rose-700"
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
              <span className="ui-caption font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Read-only
              </span>
            )}
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl bg-slate-50 px-4 py-3 ui-body text-slate-700 shadow-inner dark:bg-slate-800 dark:text-slate-100">
            <p className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">Region</p>
            <p className="font-semibold">{endpoint.region || "Default"}</p>
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3 ui-body text-slate-700 shadow-inner dark:bg-slate-800 dark:text-slate-100">
            <p className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">Admin key</p>
            {endpoint.provider === "ceph" ? (
              <p className="font-semibold">
                {endpoint.admin_access_key ? endpoint.admin_access_key : "Not configured"}
                {endpoint.has_admin_secret && <span className="ml-2 ui-caption text-emerald-500">(secret stored)</span>}
              </p>
            ) : (
              <p className="font-semibold text-slate-500">Not required</p>
            )}
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3 ui-body text-slate-700 shadow-inner dark:bg-slate-800 dark:text-slate-100">
            <p className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">Supervision</p>
            {showSupervision ? (
              <p className="font-semibold">
                {endpoint.supervision_access_key || "—"}
                {endpoint.has_supervision_secret && (
                  <span className="ml-2 ui-caption text-emerald-500">(secret stored)</span>
                )}
              </p>
            ) : (
              <p className="font-semibold text-slate-500">Not set</p>
            )}
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3 ui-body text-slate-700 shadow-inner dark:bg-slate-800 dark:text-slate-100">
            <p className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">Features</p>
            <div className="mt-1 flex flex-wrap gap-2 ui-caption font-semibold">
              <span
                className={`rounded-full px-2 py-0.5 ui-caption font-semibold ${
                  adminEnabled
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100"
                    : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                }`}
              >
                Admin {adminEnabled ? "on" : "off"}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 ui-caption font-semibold ${
                  stsEnabled
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100"
                    : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                }`}
              >
                STS {stsEnabled ? "on" : "off"}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 ui-caption font-semibold ${
                  usageEnabled
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100"
                    : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                }`}
              >
                Usage {usageEnabled ? "on" : "off"}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 ui-caption font-semibold ${
                  metricsEnabled
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100"
                    : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                }`}
              >
                Metrics {metricsEnabled ? "on" : "off"}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 ui-caption font-semibold ${
                  staticWebsiteEnabled
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100"
                    : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                }`}
              >
                Static website {staticWebsiteEnabled ? "on" : "off"}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4 ui-caption leading-relaxed">
      <PageHeader
        title="Storage endpoints"
        description="Manage the S3/Ceph endpoints used by the console."
        breadcrumbs={[{ label: "Admin" }, { label: "Endpoints" }]}
        actions={[{ label: "New endpoint", onClick: startCreate }]}
        inlineContent={
          endpoints.length > 0 ? (
            <span className="ui-body font-semibold text-slate-500 dark:text-slate-300">
              Default endpoint: {defaultEndpoint ? defaultEndpoint.name : "None"}
            </span>
          ) : null
        }
      />

      {error && <PageBanner tone="error">{error}</PageBanner>}
      {defaultError && <PageBanner tone="error">{defaultError}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white/70 px-5 py-6 ui-body text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300">
          Loading endpoints...
        </div>
      ) : endpoints.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-8 text-center ui-body text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
          No endpoints configured yet.
        </div>
      ) : (
        <div className="grid gap-4">{endpoints.map((ep) => renderEndpointCard(ep))}</div>
      )}

      {showForm && (
        <Modal title={editingId ? "Edit endpoint" : "New endpoint"} onClose={onCloseForm}>
          <form onSubmit={handleSubmit} className="space-y-4">
            {formError && <PageBanner tone="error">{formError}</PageBanner>}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1 ui-body font-semibold text-slate-700 dark:text-slate-100">
                Storage name
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 ui-body font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  required
                />
              </label>
              <div className="space-y-2">
                <span className="ui-body font-semibold text-slate-700 dark:text-slate-100">Type</span>
                <div className="flex gap-3">
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 ui-body font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-400 dark:hover:text-primary-100">
                    <input
                      type="radio"
                      name="provider"
                      value="ceph"
                      checked={form.provider === "ceph"}
                      onChange={() => handleProviderChange("ceph")}
                    />
                    <span>Ceph</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 ui-body font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-400 dark:hover:text-primary-100">
                    <input
                      type="radio"
                      name="provider"
                      value="other"
                      checked={form.provider === "other"}
                      onChange={() => handleProviderChange("other")}
                    />
                    <span>Other</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1 ui-body font-semibold text-slate-700 dark:text-slate-100">
                Endpoint S3
                <input
                  type="text"
                  value={form.endpoint_url}
                  onChange={(e) => setForm((prev) => ({ ...prev, endpoint_url: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 ui-body font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  placeholder="https://s3.example.com"
                  required
                />
              </label>
              <label className="space-y-1 ui-body font-semibold text-slate-700 dark:text-slate-100">
                Region (optional)
                <input
                  type="text"
                  value={form.region}
                  onChange={(e) => setForm((prev) => ({ ...prev, region: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 ui-body font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  placeholder="us-east-1"
                />
              </label>
            </div>

            {cephMode && (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1 ui-body font-semibold text-slate-700 dark:text-slate-100">
                    Admin Ops
                    <div className="grid gap-3">
                      <input
                        type="text"
                        value={form.admin_access_key}
                        onChange={(e) => setForm((prev) => ({ ...prev, admin_access_key: e.target.value }))}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 ui-body font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        placeholder="Access key admin"
                        required={!editingId && form.features.admin.enabled}
                      />
                      <input
                        type="password"
                        value={form.admin_secret_key}
                        onChange={(e) => setForm((prev) => ({ ...prev, admin_secret_key: e.target.value }))}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 ui-body font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        placeholder={editingId ? "Secret key admin (leave blank to keep)" : "Secret key admin"}
                        required={!editingId && form.features.admin.enabled}
                      />
                    </div>
                    <p className="ui-caption font-normal text-slate-500 dark:text-slate-400">
                      {editingId ? "Leave the secret key empty to keep the current one." : "Required when admin is enabled."}
                    </p>
                  </div>
                  <div className="space-y-1 ui-body font-semibold text-slate-700 dark:text-slate-100">
                    Supervision Ops
                    <div className="grid gap-3">
                      <input
                        type="text"
                        value={form.supervision_access_key}
                        onChange={(e) => setForm((prev) => ({ ...prev, supervision_access_key: e.target.value }))}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 ui-body font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        placeholder="Access key supervision"
                      />
                      <input
                        type="password"
                        value={form.supervision_secret_key}
                        onChange={(e) => setForm((prev) => ({ ...prev, supervision_secret_key: e.target.value }))}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 ui-body font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        placeholder="Secret key supervision"
                      />
                    </div>
                    <p className="ui-caption font-normal text-slate-500 dark:text-slate-400">
                      Use these keys for read-only monitoring actions.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 ui-body text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Features</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 ui-caption font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                    Admin enabled
                    <input
                      type="checkbox"
                      checked={form.features.admin.enabled}
                      onChange={(e) =>
                        updateFeatures((current) => ({
                          ...current,
                          admin: { ...current.admin, enabled: e.target.checked },
                        }))
                      }
                      className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary disabled:opacity-50 dark:border-slate-600"
                      disabled={!cephMode}
                    />
                  </label>
                  <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 ui-caption font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                    STS enabled
                    <input
                      type="checkbox"
                      checked={form.features.sts.enabled}
                      onChange={(e) =>
                        updateFeatures((current) => ({
                          ...current,
                          sts: { ...current.sts, enabled: e.target.checked },
                        }))
                      }
                      className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                    />
                  </label>
                  <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 ui-caption font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                    Usage enabled
                    <input
                      type="checkbox"
                      checked={form.features.usage.enabled}
                      onChange={(e) =>
                        updateFeatures((current) => ({
                          ...current,
                          usage: { ...current.usage, enabled: e.target.checked },
                        }))
                      }
                      className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary disabled:opacity-50 dark:border-slate-600"
                      disabled={!cephMode || !form.features.admin.enabled}
                    />
                  </label>
                  <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 ui-caption font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                    Metrics enabled
                    <input
                      type="checkbox"
                      checked={form.features.metrics.enabled}
                      onChange={(e) =>
                        updateFeatures((current) => ({
                          ...current,
                          metrics: { ...current.metrics, enabled: e.target.checked },
                        }))
                      }
                      className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary disabled:opacity-50 dark:border-slate-600"
                      disabled={!cephMode || !form.features.admin.enabled}
                    />
                  </label>
                  <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 ui-caption font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                    Static website enabled
                    <input
                      type="checkbox"
                      checked={form.features.static_website.enabled}
                      onChange={(e) =>
                        updateFeatures((current) => ({
                          ...current,
                          static_website: { ...current.static_website, enabled: e.target.checked },
                        }))
                      }
                      className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                    />
                  </label>
                </div>
                <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">
                  Admin, usage, and metrics require a Ceph endpoint. Usage/metrics require admin.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 ui-caption font-semibold text-slate-700 dark:text-slate-100">
                    Admin endpoint override (optional)
                    <input
                      type="text"
                      value={form.features.admin.endpoint}
                      onChange={(e) =>
                        updateFeatures((current) => ({
                          ...current,
                          admin: { ...current.admin, endpoint: e.target.value },
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 ui-body font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      placeholder="http://rgw-admin.local"
                      disabled={!cephMode || !form.features.admin.enabled}
                    />
                  </label>
                  <label className="space-y-1 ui-caption font-semibold text-slate-700 dark:text-slate-100">
                    STS endpoint override (optional)
                    <input
                      type="text"
                      value={form.features.sts.endpoint}
                      onChange={(e) =>
                        updateFeatures((current) => ({
                          ...current,
                          sts: { ...current.sts, endpoint: e.target.value },
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 ui-body font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      placeholder="https://sts.example.com"
                      disabled={!form.features.sts.enabled}
                    />
                  </label>
                </div>
              </div>

            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onCloseForm}
                className="rounded-lg border border-slate-200 px-4 py-2 ui-body font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-400 dark:hover:text-primary-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-primary px-4 py-2 ui-body font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
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
            {deleteError && <PageBanner tone="error">{deleteError}</PageBanner>}
            <p className="ui-body text-slate-700 dark:text-slate-100">
              Are you sure you want to delete <strong>{deleteTarget.name}</strong>? This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 ui-body font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-400 dark:hover:text-primary-100"
                type="button"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteBusy}
                className="rounded-lg bg-rose-600 px-4 py-2 ui-body font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:opacity-70"
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
