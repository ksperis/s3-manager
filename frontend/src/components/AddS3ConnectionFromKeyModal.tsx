/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createConnection } from "../api/connections";
import { listStorageEndpoints, StorageEndpoint } from "../api/storageEndpoints";
import { notifyExecutionContextsRefresh } from "../utils/executionContextRefresh";
import { extractApiError } from "../utils/apiError";
import { stableSignature } from "../utils/stableSignature";
import S3ConnectionEndpointFields, { type S3ConnectionEndpointMode } from "../features/shared/S3ConnectionEndpointFields";
import Modal from "./Modal";
import UiButton from "./ui/UiButton";
import UiCheckboxField from "./ui/UiCheckboxField";
import UiInlineMessage from "./ui/UiInlineMessage";
import UiInput from "./ui/UiInput";
import { cx, uiMutedTextClass, uiPanelMutedClass, uiTitleTextClass } from "./ui/styles";
import { useUnsavedChangesGuard } from "./useUnsavedChangesGuard";

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

const normalizeProviderHint = (value?: string | null): string => {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "ceph" || normalized === "aws" || normalized === "scality" || normalized === "minio" || normalized === "other") {
    return normalized;
  }
  return "";
};

const normalizeEndpointUrl = (value?: string | null): string => (value || "").trim().replace(/\/+$/, "");

const extractError = (err: unknown): string => extractApiError(err, "Unexpected error");

export default function AddS3ConnectionFromKeyModal({
  isOpen,
  title = "Add as S3 Connection",
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

  const [endpointMode, setEndpointMode] = useState<S3ConnectionEndpointMode>("custom");
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
  const [initialSignature, setInitialSignature] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setEndpointLoadError(null);
    setSaving(false);
    const nextEndpointMode: S3ConnectionEndpointMode = defaultEndpointId != null ? "preset" : "custom";
    const nextSelectedEndpointId = defaultEndpointId != null ? String(defaultEndpointId) : "";
    const nextForm = {
      name: defaultName,
      endpoint_url: defaultEndpointUrl || "",
      region: defaultRegion || "",
      provider_hint: normalizeProviderHint(defaultProviderHint),
      force_path_style: false,
      verify_tls: true,
      access_manager: Boolean(defaultAccessManager),
      access_browser: defaultAccessBrowser !== false,
    };
    setEndpointMode(nextEndpointMode);
    setSelectedEndpointId(nextSelectedEndpointId);
    setForm(nextForm);
    setInitialSignature(stableSignature({ endpointMode: nextEndpointMode, selectedEndpointId: nextSelectedEndpointId, form: nextForm }));
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
  const currentSignature = useMemo(
    () => stableSignature({ endpointMode, selectedEndpointId, form }),
    [endpointMode, form, selectedEndpointId]
  );
  const hasUnsavedChanges = Boolean(initialSignature) && currentSignature !== initialSignature;
  const closeGuard = useUnsavedChangesGuard({
    hasUnsavedChanges,
    disabled: saving,
    onClose,
    zIndexClass: "z-[80]",
  });

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
      notifyExecutionContextsRefresh();
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
    <Modal title={title} onClose={closeGuard.requestClose} maxWidthClass="max-w-3xl" zIndexClass={zIndexClass}>
      <form className="space-y-4" onSubmit={submit}>
        {error && (
          <UiInlineMessage tone="error">
            {error}
          </UiInlineMessage>
        )}
        <section className={cx("space-y-3 px-3 py-3", uiPanelMutedClass)}>
          <div>
            <div className={cx("ui-body font-semibold", uiTitleTextClass)}>Connection</div>
            <div className={cx("ui-caption", uiMutedTextClass)}>This creates a private S3 connection (owner only).</div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <UiInput
              label="Name *"
              fieldClassName="sm:col-span-2"
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              required
            />
          </div>
        </section>

        {showEndpointSection && (
          <S3ConnectionEndpointFields
            mode={endpointMode}
            onModeChange={setEndpointMode}
            modeInputName="add-s3-connection-endpoint-mode"
            endpointId={selectedEndpointId}
            onEndpointIdChange={setSelectedEndpointId}
            endpoints={endpoints}
            loadingEndpoints={loadingEndpoints}
            form={form}
            onFormChange={(field, value) =>
              setForm((prev) => ({
                ...prev,
                [field]: value,
              }))
            }
            errorMessage={
              endpointLoadError
                ? `Endpoint list unavailable (${endpointLoadError}). Use custom endpoint mode.`
                : null
            }
          />
        )}

        <section className={cx("space-y-3 px-3 py-3", uiPanelMutedClass)}>
          <div className={cx("ui-body font-semibold", uiTitleTextClass)}>Access</div>
          <UiCheckboxField
            checked={form.access_manager}
            onChange={(event) => setForm((prev) => ({ ...prev, access_manager: event.target.checked }))}
            className={cx("ui-body font-medium", uiTitleTextClass)}
          >
            Access manager
          </UiCheckboxField>
          <UiCheckboxField
            checked={form.access_browser}
            onChange={(event) => setForm((prev) => ({ ...prev, access_browser: event.target.checked }))}
            className={cx("ui-body font-medium", uiTitleTextClass)}
          >
            Access browser
          </UiCheckboxField>
          <p className={cx("ui-caption", uiMutedTextClass)}>At least one access must be enabled.</p>
          {ownerSummary ? <p className={cx("ui-caption", uiMutedTextClass)}>Owner metadata: {ownerSummary}</p> : null}
        </section>

        <div className="flex items-center justify-end gap-3">
          <UiButton
            type="button"
            onClick={closeGuard.requestClose}
            disabled={saving}
            variant="secondary"
          >
            Cancel
          </UiButton>
          <UiButton
            type="submit"
            disabled={saving}
          >
            {saving ? "Creating..." : "Create private connection"}
          </UiButton>
        </div>
      </form>
      {closeGuard.confirmationDialog}
    </Modal>
  );
}
