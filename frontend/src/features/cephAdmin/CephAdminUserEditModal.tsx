/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { cx, uiDataTableClass, uiPanelMutedClass, uiTableContainerClass } from "../../components/ui/styles";
import {
  CephAdminEntityMetrics,
  CephAdminRgwAccessKey,
  CephAdminRgwGeneratedAccessKey,
  CephAdminRgwUserDetail,
  UpdateCephAdminUserPayload,
  createCephAdminUserKey,
  deleteCephAdminUserKey,
  getCephAdminUserDetail,
  getCephAdminUserMetrics,
  listCephAdminUserKeys,
  updateCephAdminUserConfig,
  updateCephAdminUserKeyStatus,
} from "../../api/cephAdmin";
import AddS3ConnectionFromKeyModal from "../../components/AddS3ConnectionFromKeyModal";
import WorkflowPage from "../../components/WorkflowPage";
import OneTimeSecretPanel from "../../components/OneTimeSecretPanel";
import PageBanner from "../../components/PageBanner";
import PageTabs from "../../components/PageTabs";
import UiButton from "../../components/ui/UiButton";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import UiTextarea from "../../components/ui/UiTextarea";
import UsageTile from "../../components/UsageTile";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { extractApiError } from "../../utils/apiError";
import { confirmAction } from "../../utils/confirm";
import { formatBytes, formatNumber } from "../../utils/format";
import { stableSignature } from "../../utils/stableSignature";
import { buildCephConnectionDefaults } from "../shared/s3ConnectionFromKey";
import CephAdminQuotaFields, { type CephAdminQuotaUnit } from "./CephAdminQuotaFields";
import { buildCephAdminQuotaPatch } from "./quotaPatch";
import { cephAdminPageBreadcrumbs } from "./cephAdminBreadcrumbs";

type Props = {
  endpointId: number;
  endpointUrl?: string | null;
  uid: string;
  tenant?: string | null;
  canViewMetrics?: boolean;
  onClose: () => void;
  onSaved?: (detail: CephAdminRgwUserDetail) => void;
};

type TabId = "overview" | "ceph" | "s3" | "metrics";
type CapsMode = "replace" | "add" | "remove";

const extractError = (err: unknown): string => extractApiError(err, "Unexpected error");

const UNIT_FACTORS: Record<CephAdminQuotaUnit, number> = {
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4,
};

const quotaBytesToForm = (bytes?: number | null): { value: string; unit: CephAdminQuotaUnit } => {
  if (bytes == null || bytes <= 0) {
    return { value: "", unit: "GiB" };
  }
  if (bytes % UNIT_FACTORS.TiB === 0) {
    return { value: String(bytes / UNIT_FACTORS.TiB), unit: "TiB" };
  }
  if (bytes % UNIT_FACTORS.GiB === 0) {
    return { value: String(bytes / UNIT_FACTORS.GiB), unit: "GiB" };
  }
  if (bytes % UNIT_FACTORS.MiB === 0) {
    return { value: String(bytes / UNIT_FACTORS.MiB), unit: "MiB" };
  }
  return { value: String((bytes / UNIT_FACTORS.GiB).toFixed(2)), unit: "GiB" };
};

const formToQuotaBytes = (value: string, unit: CephAdminQuotaUnit): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * UNIT_FACTORS[unit]);
};

const keyActive = (key: CephAdminRgwAccessKey): boolean => {
  if (key.is_active !== undefined && key.is_active !== null) return Boolean(key.is_active);
  const status = (key.status || "").toLowerCase();
  if (["disabled", "inactive", "suspended"].includes(status)) return false;
  if (["active", "enabled"].includes(status)) return true;
  return true;
};

const formatDate = (value?: string | null) => {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

const capsTextToValues = (value: string): string[] => {
  const parts = value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return Array.from(new Set(parts));
};

export default function CephAdminUserEditModal({
  endpointId,
  endpointUrl,
  uid,
  tenant,
  canViewMetrics = true,
  onClose,
  onSaved,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [detail, setDetail] = useState<CephAdminRgwUserDetail | null>(null);
  const [keys, setKeys] = useState<CephAdminRgwAccessKey[]>([]);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [metrics, setMetrics] = useState<CephAdminEntityMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const [keysLoading, setKeysLoading] = useState(false);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [keysStatus, setKeysStatus] = useState<string | null>(null);
  const [keysBusy, setKeysBusy] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<CephAdminRgwGeneratedAccessKey | null>(null);
  const [showAddConnectionModal, setShowAddConnectionModal] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [suspended, setSuspended] = useState(false);
  const [maxBuckets, setMaxBuckets] = useState("");
  const [opMask, setOpMask] = useState("");
  const [defaultPlacement, setDefaultPlacement] = useState("");
  const [defaultStorageClass, setDefaultStorageClass] = useState("");
  const [adminFlag, setAdminFlag] = useState(false);
  const [systemFlag, setSystemFlag] = useState(false);
  const [quotaEnabled, setQuotaEnabled] = useState(true);
  const [quotaSize, setQuotaSize] = useState("");
  const [quotaUnit, setQuotaUnit] = useState<CephAdminQuotaUnit>("GiB");
  const [quotaObjects, setQuotaObjects] = useState("");
  const [capsMode, setCapsMode] = useState<CapsMode>("replace");
  const [capsText, setCapsText] = useState("");
  const currentSignature = useMemo(
    () =>
      stableSignature({
        displayName,
        email,
        suspended,
        maxBuckets,
        opMask,
        defaultPlacement,
        defaultStorageClass,
        adminFlag,
        systemFlag,
        quotaEnabled,
        quotaSize,
        quotaUnit,
        quotaObjects,
        capsMode,
        capsText,
      }),
    [
      adminFlag,
      capsMode,
      capsText,
      defaultPlacement,
      defaultStorageClass,
      displayName,
      email,
      maxBuckets,
      opMask,
      quotaEnabled,
      quotaObjects,
      quotaSize,
      quotaUnit,
      suspended,
      systemFlag,
    ]
  );
  const [initialSignature, setInitialSignature] = useState(currentSignature);
  const closeGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: !detailLoading && currentSignature !== initialSignature,
    onClose,
    disabled: saving,
  });

  const refreshKeys = async () => {
    setKeysLoading(true);
    setKeysError(null);
    try {
      const payload = await listCephAdminUserKeys(endpointId, uid, tenant);
      setKeys(payload);
    } catch (err) {
      setKeysError(extractError(err));
    } finally {
      setKeysLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const payload = await getCephAdminUserDetail(endpointId, uid, tenant);
        if (cancelled) return;
        setDetail(payload);
        setKeys(payload.keys ?? []);
        setDisplayName(payload.display_name ?? "");
        setEmail(payload.email ?? "");
        setSuspended(Boolean(payload.suspended));
        setMaxBuckets(payload.max_buckets != null ? String(payload.max_buckets) : "");
        setOpMask(payload.op_mask ?? "");
        setDefaultPlacement(payload.default_placement ?? "");
        setDefaultStorageClass(payload.default_storage_class ?? "");
        setAdminFlag(Boolean(payload.admin));
        setSystemFlag(Boolean(payload.system));
        const quotaConfigured = Boolean(
          payload.quota && (payload.quota.max_size_bytes != null || payload.quota.max_objects != null)
        );
        setQuotaEnabled(payload.quota?.enabled ?? quotaConfigured);
        const quotaForm = quotaBytesToForm(payload.quota?.max_size_bytes);
        setQuotaSize(quotaForm.value);
        setQuotaUnit(quotaForm.unit);
        setQuotaObjects(payload.quota?.max_objects != null ? String(payload.quota.max_objects) : "");
        setCapsText((payload.caps ?? []).join("\n"));
        setInitialSignature(
          stableSignature({
            displayName: payload.display_name ?? "",
            email: payload.email ?? "",
            suspended: Boolean(payload.suspended),
            maxBuckets: payload.max_buckets != null ? String(payload.max_buckets) : "",
            opMask: payload.op_mask ?? "",
            defaultPlacement: payload.default_placement ?? "",
            defaultStorageClass: payload.default_storage_class ?? "",
            adminFlag: Boolean(payload.admin),
            systemFlag: Boolean(payload.system),
            quotaEnabled: payload.quota?.enabled ?? quotaConfigured,
            quotaSize: quotaForm.value,
            quotaUnit: quotaForm.unit,
            quotaObjects: payload.quota?.max_objects != null ? String(payload.quota.max_objects) : "",
            capsMode: "replace",
            capsText: (payload.caps ?? []).join("\n"),
          })
        );
      } catch (err) {
        if (!cancelled) {
          setDetailError(extractError(err));
          setDetail(null);
          setKeys([]);
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [endpointId, uid, tenant]);

  useEffect(() => {
    if (!canViewMetrics || activeTab !== "metrics") return;
    let cancelled = false;
    const load = async () => {
      setMetricsLoading(true);
      setMetricsError(null);
      try {
        const payload = await getCephAdminUserMetrics(endpointId, uid, tenant);
        if (!cancelled) {
          setMetrics(payload);
        }
      } catch (err) {
        if (!cancelled) {
          setMetricsError(extractError(err));
          setMetrics(null);
        }
      } finally {
        if (!cancelled) {
          setMetricsLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeTab, canViewMetrics, endpointId, uid, tenant]);

  useEffect(() => {
    if (!canViewMetrics && activeTab === "metrics") {
      setActiveTab("overview");
    }
  }, [activeTab, canViewMetrics]);

  const submit = async () => {
    setSaveError(null);
    setSaveStatus(null);
    const accountRootEnabled = Boolean(detail?.account_id);

    const parsedMaxBuckets = maxBuckets.trim() === "" ? null : Number(maxBuckets);
    const parsedQuotaBytes = quotaEnabled ? formToQuotaBytes(quotaSize, quotaUnit) : null;
    const parsedQuotaObjects = quotaEnabled ? (quotaObjects.trim() === "" ? null : Number(quotaObjects)) : null;

    if (parsedMaxBuckets != null && (!Number.isInteger(parsedMaxBuckets) || parsedMaxBuckets < 0)) {
      setSaveError("Max buckets must be a positive integer.");
      return;
    }
    if (parsedQuotaObjects != null && (!Number.isInteger(parsedQuotaObjects) || parsedQuotaObjects < 0)) {
      setSaveError("Quota objects must be a positive integer.");
      return;
    }
    if (quotaEnabled && quotaSize.trim() !== "" && parsedQuotaBytes == null) {
      setSaveError("Storage quota value is invalid.");
      return;
    }
    const nextDefaultPlacement = defaultPlacement.trim();
    const nextDefaultStorageClass = defaultStorageClass.trim();

    setSaving(true);
    try {
      const payload: UpdateCephAdminUserPayload = {
        display_name: displayName.trim() || null,
        email: email.trim() || null,
        suspended,
        max_buckets: parsedMaxBuckets,
        op_mask: opMask.trim() || null,
        admin: adminFlag,
        system: systemFlag,
        account_root: accountRootEnabled ? true : undefined,
        caps: {
          mode: capsMode,
          values: capsTextToValues(capsText),
        },
        extra_params: {
          "default-placement": nextDefaultPlacement || "",
          "default-storage-class": nextDefaultStorageClass || "",
        },
        ...buildCephAdminQuotaPatch(
          {
            enabled: "quota_enabled",
            maxSizeBytes: "quota_max_size_bytes",
            maxObjects: "quota_max_objects",
          },
          detail?.quota,
          {
            enabled: quotaEnabled,
            maxSizeBytes: parsedQuotaBytes,
            maxObjects: parsedQuotaObjects,
          }
        ),
      };
      const updated = await updateCephAdminUserConfig(
        endpointId,
        uid,
        payload,
        tenant
      );
      setDetail(updated);
      setKeys(updated.keys ?? []);
      setInitialSignature(currentSignature);
      setSaveStatus("User configuration updated.");
      onSaved?.(updated);
      if (activeTab === "metrics") {
        try {
          const refreshedMetrics = await getCephAdminUserMetrics(endpointId, uid, tenant);
          setMetrics(refreshedMetrics);
          setMetricsError(null);
        } catch {
          // Metrics refresh is best effort.
        }
      }
    } catch (err) {
      setSaveError(extractError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleCreateKey = async () => {
    setKeysError(null);
    setKeysStatus(null);
    setCreatedKey(null);
    setKeysBusy("create");
    try {
      const created = await createCephAdminUserKey(endpointId, uid, tenant);
      setCreatedKey(created);
      await refreshKeys();
      setKeysStatus("Access key created.");
    } catch (err) {
      setKeysError(extractError(err));
    } finally {
      setKeysBusy(null);
    }
  };

  const handleToggleKey = async (key: CephAdminRgwAccessKey, nextActive: boolean) => {
    if (key.is_private_access_managed) return;
    const marker = `toggle:${key.access_key}`;
    setKeysBusy(marker);
    setKeysError(null);
    setKeysStatus(null);
    try {
      await updateCephAdminUserKeyStatus(endpointId, uid, key.access_key, nextActive, tenant);
      await refreshKeys();
      setKeysStatus(nextActive ? "Access key enabled." : "Access key disabled.");
    } catch (err) {
      setKeysError(extractError(err));
    } finally {
      setKeysBusy(null);
    }
  };

  const handleDeleteKey = async (key: CephAdminRgwAccessKey) => {
    if (key.is_private_access_managed) return;
    if (!confirmAction(`Delete key ${key.access_key}?`)) return;
    const marker = `delete:${key.access_key}`;
    setKeysBusy(marker);
    setKeysError(null);
    setKeysStatus(null);
    try {
      await deleteCephAdminUserKey(endpointId, uid, key.access_key, tenant);
      await refreshKeys();
      setKeysStatus("Access key deleted.");
    } catch (err) {
      setKeysError(extractError(err));
    } finally {
      setKeysBusy(null);
    }
  };

  const identityLabel = useMemo(() => {
    if (tenant) return `${tenant}$${uid}`;
    return uid;
  }, [tenant, uid]);

  const overviewTab = (
    <section className="space-y-4">
      {detailLoading && <PageBanner tone="info">Loading user details...</PageBanner>}
      {detailError && <PageBanner tone="error">{detailError}</PageBanner>}
      {detail && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <UsageTile
              label="Buckets"
              used={metrics?.bucket_count ?? null}
              quota={detail.max_buckets ?? null}
              formatter={formatNumber}
              quotaFormatter={(value) => (value != null ? value.toLocaleString() : "-")}
              unitHint="buckets"
              emptyHint="No bucket limit defined."
            />
            <UsageTile
              label="Storage quota"
              used={metrics?.total_bytes ?? null}
              quota={detail.quota?.max_size_bytes ?? null}
              formatter={formatBytes}
              quotaFormatter={formatBytes}
              emptyHint="No storage quota defined."
            />
          </div>
          <div className={cx(uiPanelMutedClass, "px-4 py-3")}>
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Account</dt>
                <dd className="ui-body font-semibold text-slate-800 dark:text-slate-100">
                  {detail.account_name ?? detail.account_id ?? "-"}
                </dd>
              </div>
              <div>
                <dt className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Email</dt>
                <dd className="ui-body font-semibold text-slate-800 dark:text-slate-100">{detail.email ?? "-"}</dd>
              </div>
              <div>
                <dt className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Status</dt>
                <dd className="ui-body font-semibold text-slate-800 dark:text-slate-100">
                  {detail.suspended ? "Suspended" : "Active"}
                </dd>
              </div>
              <div>
                <dt className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Flags</dt>
                <dd className="ui-body font-semibold text-slate-800 dark:text-slate-100">
                  {[detail.admin ? "admin" : null, detail.system ? "system" : null, detail.account_root ? "root" : null]
                    .filter(Boolean)
                    .join(" · ") || "none"}
                </dd>
              </div>
            </dl>
          </div>
        </>
      )}
    </section>
  );

  const cephTab = (
    <section className="space-y-4">
      {saveError && <PageBanner tone="error">{saveError}</PageBanner>}
      {saveStatus && <PageBanner tone="success">{saveStatus}</PageBanner>}

      <div className="grid gap-3 md:grid-cols-2">
        <UiInput
          label="Display name"
          type="text"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          size="compact"
        />
        <UiInput
          label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          size="compact"
        />
        <UiInput
          label="Max buckets"
          type="number"
          min={0}
          value={maxBuckets}
          onChange={(event) => setMaxBuckets(event.target.value)}
          placeholder="Leave empty to clear"
          size="compact"
        />
        <UiInput
          label="Op mask"
          type="text"
          value={opMask}
          onChange={(event) => setOpMask(event.target.value)}
          placeholder="read,write,delete"
          size="compact"
        />
        <UiInput
          label="Default placement"
          type="text"
          value={defaultPlacement}
          onChange={(event) => setDefaultPlacement(event.target.value)}
          placeholder="e.g. default-placement"
          size="compact"
        />
        <UiInput
          label="Default storage class"
          type="text"
          value={defaultStorageClass}
          onChange={(event) => setDefaultStorageClass(event.target.value)}
          placeholder="e.g. STANDARD"
          size="compact"
        />
      </div>

      <div className={cx(uiPanelMutedClass, "grid gap-2 px-4 py-3 sm:grid-cols-2")}>
        <UiCheckboxField
          checked={suspended}
          onChange={(event) => setSuspended(event.target.checked)}
          className="ui-body text-slate-700 dark:text-slate-200"
        >
          Suspended
        </UiCheckboxField>
        <UiCheckboxField
          checked={adminFlag}
          onChange={(event) => setAdminFlag(event.target.checked)}
          className="ui-body text-slate-700 dark:text-slate-200"
        >
          Admin
        </UiCheckboxField>
        <UiCheckboxField
          checked={systemFlag}
          onChange={(event) => setSystemFlag(event.target.checked)}
          className="ui-body text-slate-700 dark:text-slate-200"
        >
          System
        </UiCheckboxField>
      </div>

      <CephAdminQuotaFields
        title="User quota"
        enabledLabel="Enable user quota"
        enabled={quotaEnabled}
        onEnabledChange={setQuotaEnabled}
        sizeValue={quotaSize}
        onSizeChange={setQuotaSize}
        unitValue={quotaUnit}
        onUnitChange={setQuotaUnit}
        objectValue={quotaObjects}
        onObjectChange={setQuotaObjects}
        sizePlaceholder="Leave empty to clear"
        objectPlaceholder="Leave empty to clear"
      />

      <div className="grid gap-3 md:grid-cols-2">
        <UiSelect
          label="Caps update mode"
          value={capsMode}
          onChange={(event) => setCapsMode(event.target.value as CapsMode)}
          size="compact"
        >
          <option value="replace">Replace</option>
          <option value="add">Add</option>
          <option value="remove">Remove</option>
        </UiSelect>
      </div>

      <UiTextarea
        label="Caps (one per line, e.g. users=read)"
        value={capsText}
        onChange={(event) => setCapsText(event.target.value)}
        rows={4}
        className="font-mono"
        spellCheck={false}
        size="compact"
      />

      <div className="flex items-center justify-end gap-2">
        <UiButton
          type="button"
          onClick={submit}
          disabled={saving || detailLoading}
          size="sm"
        >
          {saving ? "Saving..." : "Save configuration"}
        </UiButton>
      </div>
    </section>
  );

  const s3Tab = (
    <section className="space-y-4">

      {keysError && <PageBanner tone="error">{keysError}</PageBanner>}
      {keysStatus && <PageBanner tone="success">{keysStatus}</PageBanner>}

      {createdKey && (
        <OneTimeSecretPanel
          title="Key created"
          description="Secret is shown only once."
          values={[
            { label: "Access key", value: createdKey.access_key, copyLabel: "Copy" },
            { label: "Secret key", value: createdKey.secret_key, copyLabel: "Copy" },
          ]}
          actions={
            <UiButton
              type="button"
              onClick={() => setShowAddConnectionModal(true)}
              variant="secondary"
              size="xs"
            >
              Add as S3 Connection
            </UiButton>
          }
        />
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <UiButton
          type="button"
          onClick={refreshKeys}
          disabled={keysLoading}
          variant="secondary"
          size="sm"
        >
          {keysLoading ? "Loading..." : "Refresh"}
        </UiButton>
        <UiButton
          type="button"
          onClick={handleCreateKey}
          disabled={keysBusy === "create"}
          size="sm"
        >
          {keysBusy === "create" ? "Creating..." : "New key"}
        </UiButton>
      </div>

      <div className={uiTableContainerClass}>
        <table className={cx(uiDataTableClass, "compact-table min-w-full")}>
          <thead className="bg-slate-50 dark:bg-slate-900/50">
            <tr>
              <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Access key
              </th>
              <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Status
              </th>
              <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Created
              </th>
              <th className="px-3 py-2 text-right ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {keys.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-3 ui-body text-slate-500 dark:text-slate-400">
                  No access keys for this user.
                </td>
              </tr>
            )}
            {keys.map((key) => {
              const active = keyActive(key);
              const managedPrivate = Boolean(key.is_private_access_managed);
              const toggleBusy = keysBusy === `toggle:${key.access_key}`;
              const deleteBusy = keysBusy === `delete:${key.access_key}`;
              return (
                <tr key={key.access_key}>
                  <td className="px-3 py-2 font-mono ui-body font-semibold text-slate-800 dark:text-slate-100">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{key.access_key}</span>
                      {managedPrivate && (
                        <span className="rounded border px-1.5 py-0.5 text-[10px] font-semibold" title="Managed private access key">
                          Private access
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 ui-body text-slate-600 dark:text-slate-300">{key.status ?? (active ? "enabled" : "disabled")}</td>
                  <td className="px-3 py-2 ui-body text-slate-600 dark:text-slate-300">{formatDate(key.created_at)}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleToggleKey(key, !active)}
                        disabled={toggleBusy || deleteBusy || managedPrivate}
                        title={managedPrivate ? "Update the linked private connection instead" : undefined}
                        className={tableActionButtonClasses}
                      >
                        {toggleBusy ? "Saving..." : active ? "Disable" : "Enable"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteKey(key)}
                        disabled={toggleBusy || deleteBusy || managedPrivate}
                        title={managedPrivate ? "Delete the linked private connection instead" : undefined}
                        className={tableDeleteActionClasses}
                      >
                        {deleteBusy ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );

  const metricsTab = (
    <section className="space-y-4">

      {metricsLoading && <PageBanner tone="info">Loading metrics...</PageBanner>}
      {metricsError && <PageBanner tone="error">{metricsError}</PageBanner>}
      {metrics && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <UsageTile
              label="Storage"
              used={metrics.total_bytes ?? null}
              quota={detail?.quota?.max_size_bytes ?? null}
              formatter={formatBytes}
              quotaFormatter={formatBytes}
              emptyHint="No storage quota defined."
            />
            <UsageTile
              label="Objects"
              used={metrics.total_objects ?? null}
              quota={detail?.quota?.max_objects ?? null}
              formatter={formatNumber}
              quotaFormatter={(value) => (value != null ? value.toLocaleString() : "-")}
              unitHint="objects"
              emptyHint="No object quota defined."
            />
          </div>
          <div className={cx(uiPanelMutedClass, "px-4 py-3")}>
            <div className="flex items-center justify-between gap-2">
              <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Top buckets by usage</p>
              <p className="ui-caption text-slate-500 dark:text-slate-400">{metrics.bucket_count} bucket(s)</p>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className={cx(uiDataTableClass, "compact-table min-w-full")}>
                <thead className="bg-slate-100/80 dark:bg-slate-900/60">
                  <tr>
                    <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Bucket
                    </th>
                    <th className="px-3 py-2 text-right ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Used
                    </th>
                    <th className="px-3 py-2 text-right ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Objects
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {metrics.bucket_usage.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-3 py-3 ui-body text-slate-500 dark:text-slate-400">
                        No bucket usage data available.
                      </td>
                    </tr>
                  )}
                  {metrics.bucket_usage.slice(0, 50).map((entry) => (
                    <tr key={entry.name}>
                      <td className="px-3 py-2 ui-body font-semibold text-slate-800 dark:text-slate-100">{entry.name}</td>
                      <td className="px-3 py-2 text-right ui-body text-slate-600 dark:text-slate-300">
                        {formatBytes(entry.used_bytes)}
                      </td>
                      <td className="px-3 py-2 text-right ui-body text-slate-600 dark:text-slate-300">
                        {formatNumber(entry.object_count)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );

  const tabs = [
    { id: "overview", label: "Overview", content: overviewTab },
    { id: "ceph", label: "Ceph Admin", content: cephTab },
    { id: "s3", label: "Key Management", content: s3Tab },
    ...(canViewMetrics ? [{ id: "metrics", label: "Metrics", content: metricsTab }] : []),
  ];
  const addConnectionDefaults = useMemo(() => {
    if (!createdKey) return null;
    return buildCephConnectionDefaults(uid, createdKey.access_key, {
      accountId: detail?.account_id,
      tenant,
    });
  }, [createdKey, detail?.account_id, tenant, uid]);

  return (
    <WorkflowPage
      title={`Configure user · ${identityLabel}`}
      description="Review configuration, key management, capabilities and metrics on a full workspace page."
      breadcrumbs={cephAdminPageBreadcrumbs("users", { label: identityLabel })}
      backLabel="Back to users"
      onBack={closeGuard.requestClose}
      contentClassName="min-w-0"
      contentVariant="plain"
    >
      <PageTabs
        tabs={tabs}
        activeTab={activeTab}
        onChange={(tab) => setActiveTab(tab as TabId)}
        variant="line"
        ariaLabel="User configuration sections"
        idPrefix="ceph-admin-user-editor"
      />
      {showAddConnectionModal && createdKey && addConnectionDefaults && (
        <AddS3ConnectionFromKeyModal
          isOpen={showAddConnectionModal}
          title="Add this key as S3 Connection"
          zIndexClass="z-[60]"
          lockEndpoint
          accessKeyId={createdKey.access_key}
          secretAccessKey={createdKey.secret_key}
          defaultName={addConnectionDefaults.name}
          defaultEndpointId={endpointId}
          defaultEndpointUrl={endpointUrl ?? null}
          defaultProviderHint="ceph"
          defaultAccessManager={false}
          defaultAccessBrowser
          defaultOwnerType={addConnectionDefaults.owner.ownerType}
          defaultOwnerIdentifier={addConnectionDefaults.owner.ownerIdentifier}
          onClose={() => setShowAddConnectionModal(false)}
          onCreated={() => {
            setKeysStatus("S3 connection created.");
            setKeysError(null);
          }}
        />
      )}
      {closeGuard.confirmationDialog}
    </WorkflowPage>
  );
}
