/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createConnection } from "../api/connections";
import { listStorageEndpoints, StorageEndpoint } from "../api/storageEndpoints";
import Modal from "./Modal";

type EndpointMode = "preset" | "custom";

type Props = {
  isOpen: boolean;
  title?: string;
  zIndexClass?: string;
  lockEndpoint?: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  defaultName: string;
  defaultEndpointId?: number | null;
  defaultEndpointUrl?: string | null;
  defaultRegion?: string | null;
  defaultProviderHint?: string | null;
  defaultAccessManager?: boolean;
  defaultAccessBrowser?: boolean;
  defaultOwnerType?: string | null;
  defaultOwnerIdentifier?: string | null;
  onClose: () => void;
  onCreated?: () => void;
};

const providerHintOptions = [
  { value: "", label: "(auto)" },
  { value: "aws", label: "AWS" },
  { value: "ceph", label: "Ceph RGW" },
  { value: "scality", label: "Scality" },
  { value: "minio", label: "MinIO" },
  { value: "other", label: "Other" },
];

const normalizeProviderHint = (value?: string | null): string => {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "ceph" || normalized === "aws" || normalized === "scality" || normalized === "minio" || normalized === "other") {
    return normalized;
  }
  return "";
};

const normalizeEndpointUrl = (value?: string | null): string => (value || "").trim().replace(/\/+$/, "");

const extractError = (err: unknown): string => {
  if (axios.isAxiosError(err)) {
    return ((err.response?.data as { detail?: string } | undefined)?.detail || err.message || "Unexpected error");
  }
  return err instanceof Error ? err.message : "Unexpected error";
};

export default function AddS3ConnectionFromKeyModal({
  isOpen,
  title = "Ajouter comme S3 Connection",
  zIndexClass,
  lockEndpoint = false,
  accessKeyId,
  secretAccessKey,
  defaultName,
  defaultEndpointId,
  defaultEndpointUrl,
  defaultRegion,
  defaultProviderHint,
  defaultAccessManager = false,
  defaultAccessBrowser = true,
  defaultOwnerType,
  defaultOwnerIdentifier,
  onClose,
  onCreated,
}: Props) {
  const normalizedDefaultEndpointUrl = normalizeEndpointUrl(defaultEndpointUrl);
  const hasFixedEndpoint = defaultEndpointId != null || Boolean(normalizedDefaultEndpointUrl);
  const endpointLocked = Boolean(lockEndpoint && hasFixedEndpoint);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [endpointMode, setEndpointMode] = useState<EndpointMode>("custom");
  const [selectedEndpointId, setSelectedEndpointId] = useState("");

  const [endpoints, setEndpoints] = useState<StorageEndpoint[]>([]);
  const [loadingEndpoints, setLoadingEndpoints] = useState(false);
  const [endpointLoadError, setEndpointLoadError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    endpoint_url: "",
    region: "",
    provider_hint: "",
    force_path_style: false,
    verify_tls: true,
    access_manager: false,
    access_browser: true,
  });

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setEndpointLoadError(null);
    setSaving(false);
    setEndpointMode(defaultEndpointId != null ? "preset" : "custom");
    setSelectedEndpointId(defaultEndpointId != null ? String(defaultEndpointId) : "");
    setForm({
      name: defaultName,
      endpoint_url: defaultEndpointUrl || "",
      region: defaultRegion || "",
      provider_hint: normalizeProviderHint(defaultProviderHint),
      force_path_style: false,
      verify_tls: true,
      access_manager: Boolean(defaultAccessManager),
      access_browser: defaultAccessBrowser !== false,
    });
  }, [
    defaultEndpointId,
    defaultEndpointUrl,
    defaultAccessBrowser,
    defaultAccessManager,
    defaultName,
    defaultProviderHint,
    defaultRegion,
    isOpen,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    if (endpointLocked) {
      setEndpoints([]);
      setLoadingEndpoints(false);
      setEndpointLoadError(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoadingEndpoints(true);
      setEndpointLoadError(null);
      try {
        const data = await listStorageEndpoints();
        if (cancelled) return;
        setEndpoints(data);
      } catch (err) {
        if (cancelled) return;
        setEndpoints([]);
        setEndpointLoadError(extractError(err));
      } finally {
        if (!cancelled) {
          setLoadingEndpoints(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [endpointLocked, isOpen]);

  useEffect(() => {
    if (!isOpen || endpointMode !== "preset") return;
    if (endpoints.length === 0) {
      setEndpointMode("custom");
      return;
    }
    if (selectedEndpointId && endpoints.some((ep) => String(ep.id) === selectedEndpointId)) {
      return;
    }
    if (defaultEndpointId != null) {
      const match = endpoints.find((ep) => ep.id === defaultEndpointId);
      if (match) {
        setSelectedEndpointId(String(match.id));
        return;
      }
    }
    const normalizedDefaultUrl = normalizeEndpointUrl(defaultEndpointUrl);
    if (normalizedDefaultUrl) {
      const match = endpoints.find((ep) => normalizeEndpointUrl(ep.endpoint_url) === normalizedDefaultUrl);
      if (match) {
        setSelectedEndpointId(String(match.id));
        return;
      }
    }
    const fallback = endpoints.find((ep) => ep.is_default) || endpoints[0];
    setSelectedEndpointId(String(fallback.id));
  }, [defaultEndpointId, defaultEndpointUrl, endpointMode, endpoints, isOpen, selectedEndpointId]);

  const ownerSummary = useMemo(() => {
    if (!defaultOwnerType && !defaultOwnerIdentifier) return null;
    if (defaultOwnerType && defaultOwnerIdentifier) return `${defaultOwnerType}: ${defaultOwnerIdentifier}`;
    return defaultOwnerType || defaultOwnerIdentifier || null;
  }, [defaultOwnerIdentifier, defaultOwnerType]);
  const showEndpointSection = !endpointLocked;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setError("Name is required.");
      return;
    }
    if (!accessKeyId.trim() || !secretAccessKey.trim()) {
      setError("Access key and secret key are required.");
      return;
    }
    if (!endpointLocked && endpointMode === "preset" && !selectedEndpointId) {
      setError("Select an existing endpoint.");
      return;
    }
    if (!endpointLocked && endpointMode === "custom" && !form.endpoint_url.trim()) {
      setError("Endpoint URL is required for a custom endpoint.");
      return;
    }
    if (endpointLocked && !hasFixedEndpoint) {
      setError("Endpoint is fixed by context but not available.");
      return;
    }

    const resolvedStorageEndpointId = endpointLocked ? defaultEndpointId ?? null : endpointMode === "preset" ? Number(selectedEndpointId) : null;
    const resolvedEndpointUrl = endpointLocked
      ? normalizedDefaultEndpointUrl
      : endpointMode === "custom"
        ? form.endpoint_url.trim()
        : "";

    if (!resolvedStorageEndpointId && !resolvedEndpointUrl) {
      setError("Endpoint URL is required.");
      return;
    }
    if (!form.access_manager && !form.access_browser) {
      setError("Enable access to manager and/or browser.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createConnection({
        name,
        storage_endpoint_id: resolvedStorageEndpointId,
        endpoint_url: resolvedStorageEndpointId ? undefined : resolvedEndpointUrl,
        region: !resolvedStorageEndpointId ? form.region.trim() || null : undefined,
        provider_hint: !resolvedStorageEndpointId ? form.provider_hint || null : undefined,
        force_path_style: !resolvedStorageEndpointId ? form.force_path_style : undefined,
        verify_tls: !resolvedStorageEndpointId ? form.verify_tls : undefined,
        access_key_id: accessKeyId.trim(),
        secret_access_key: secretAccessKey.trim(),
        access_manager: Boolean(form.access_manager),
        access_browser: Boolean(form.access_browser),
        credential_owner_type: defaultOwnerType || null,
        credential_owner_identifier: defaultOwnerIdentifier || null,
      });
      onCreated?.();
      onClose();
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal title={title} onClose={() => (!saving ? onClose() : null)} maxWidthClass="max-w-3xl" zIndexClass={zIndexClass}>
      <form className="space-y-4" onSubmit={submit}>
        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/50 dark:text-rose-200">
            {error}
          </div>
        )}
        <section className="space-y-3 rounded-lg border border-slate-200 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/40">
          <div>
            <div className="ui-body font-semibold text-slate-900 dark:text-slate-100">Connection</div>
            <div className="ui-caption text-slate-500 dark:text-slate-300">This creates a private S3 connection (owner only).</div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1 sm:col-span-2">
              <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Name *</label>
              <input
                className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                required
              />
            </div>
          </div>
        </section>

        {showEndpointSection && (
          <section className="space-y-3 rounded-lg border border-slate-200 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/40">
            <div>
              <div className="ui-body font-semibold text-slate-900 dark:text-slate-100">Endpoint</div>
              <div className="ui-caption text-slate-500 dark:text-slate-300">
                Choose an endpoint configured in UI, or switch to a custom endpoint.
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
                <input
                  type="radio"
                  name="endpoint-mode"
                  checked={endpointMode === "preset"}
                  onChange={() => setEndpointMode("preset")}
                  disabled={endpoints.length === 0}
                  className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary disabled:opacity-50"
                />
                Endpoint UI existant
              </label>
              <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
                <input
                  type="radio"
                  name="endpoint-mode"
                  checked={endpointMode === "custom"}
                  onChange={() => setEndpointMode("custom")}
                  className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
                />
                Endpoint custom
              </label>
            </div>

            {endpointMode === "preset" ? (
              <div className="space-y-2">
                <div className="flex flex-col gap-1">
                  <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Configured endpoints</label>
                  <select
                    value={selectedEndpointId}
                    onChange={(event) => setSelectedEndpointId(event.target.value)}
                    disabled={loadingEndpoints || endpoints.length === 0}
                    className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="">
                      {loadingEndpoints ? "Loading endpoints..." : endpoints.length === 0 ? "No endpoint available" : "Select endpoint"}
                    </option>
                    {endpoints.map((endpoint) => (
                      <option key={endpoint.id} value={endpoint.id}>
                        {endpoint.name} ({endpoint.endpoint_url})
                      </option>
                    ))}
                  </select>
                </div>
                {endpointLoadError && (
                  <p className="ui-caption text-amber-700 dark:text-amber-300">
                    Endpoint list unavailable ({endpointLoadError}). Use custom endpoint mode.
                  </p>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Endpoint URL *</label>
                  <input
                    className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    placeholder="https://s3.amazonaws.com"
                    value={form.endpoint_url}
                    onChange={(event) => setForm((prev) => ({ ...prev, endpoint_url: event.target.value }))}
                    required
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Region (optional)</label>
                  <input
                    className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    value={form.region}
                    onChange={(event) => setForm((prev) => ({ ...prev, region: event.target.value }))}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Provider</label>
                  <select
                    className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    value={form.provider_hint}
                    onChange={(event) => setForm((prev) => ({ ...prev, provider_hint: event.target.value }))}
                  >
                    {providerHintOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-4 sm:col-span-2">
                  <label className="ui-checkbox">
                    <input
                      type="checkbox"
                      checked={form.force_path_style}
                      onChange={(event) => setForm((prev) => ({ ...prev, force_path_style: event.target.checked }))}
                    />
                    <span>Force path-style</span>
                  </label>
                  <label className="ui-checkbox">
                    <input
                      type="checkbox"
                      checked={form.verify_tls}
                      onChange={(event) => setForm((prev) => ({ ...prev, verify_tls: event.target.checked }))}
                    />
                    <span>Verify TLS</span>
                  </label>
                </div>
              </div>
            )}
          </section>
        )}

        <section className="space-y-3 rounded-lg border border-slate-200 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/40">
          <div className="ui-body font-semibold text-slate-900 dark:text-slate-100">Access</div>
          <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={form.access_manager}
              onChange={(event) => setForm((prev) => ({ ...prev, access_manager: event.target.checked }))}
              className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
            />
            Access manager
          </label>
          <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={form.access_browser}
              onChange={(event) => setForm((prev) => ({ ...prev, access_browser: event.target.checked }))}
              className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
            />
            Access browser
          </label>
          <p className="ui-caption text-slate-500 dark:text-slate-300">At least one access must be enabled.</p>
          {ownerSummary && <p className="ui-caption text-slate-500 dark:text-slate-300">Owner metadata: {ownerSummary}</p>}
        </section>

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-slate-200 px-4 py-2 ui-body font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-primary px-4 py-2 ui-body font-medium text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
          >
            {saving ? "Creating..." : "Create private connection"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
