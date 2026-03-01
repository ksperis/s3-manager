/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { uiCheckboxClass } from "../../components/ui/styles";
import {
  CephAdminEntityMetrics,
  CephAdminRgwAccessKey,
  CephAdminRgwGeneratedAccessKey,
  CephAdminRgwUserDetail,
  createCephAdminUserKey,
  deleteCephAdminUserKey,
  getCephAdminUserDetail,
  getCephAdminUserMetrics,
  listCephAdminUserKeys,
  updateCephAdminUserConfig,
  updateCephAdminUserKeyStatus,
} from "../../api/cephAdmin";
import AddS3ConnectionFromKeyModal from "../../components/AddS3ConnectionFromKeyModal";
import Modal from "../../components/Modal";
import PageBanner from "../../components/PageBanner";
import PageTabs from "../../components/PageTabs";
import UsageTile from "../../components/UsageTile";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { confirmAction } from "../../utils/confirm";
import { buildCephConnectionDefaults } from "../shared/s3ConnectionFromKey";

type Props = {
  endpointId: number;
  endpointUrl?: string | null;
  uid: string;
  tenant?: string | null;
  canViewMetrics?: boolean;
  onClose: () => void;
  onSaved?: (detail: CephAdminRgwUserDetail) => void;
};

type QuotaUnit = "MiB" | "GiB" | "TiB";
type TabId = "overview" | "ceph" | "s3" | "metrics";
type CapsMode = "replace" | "add" | "remove";

const extractError = (err: unknown): string => {
  if (axios.isAxiosError(err)) {
    return ((err.response?.data as { detail?: string } | undefined)?.detail || err.message || "Unexpected error");
  }
  return err instanceof Error ? err.message : "Unexpected error";
};

const formatBytes = (value?: number | null) => {
  if (value === undefined || value === null) return "-";
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let size = value;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  const decimals = size >= 10 || idx === 0 ? 0 : 1;
  return `${size.toFixed(decimals)} ${units[idx]}`;
};

const formatNumber = (value?: number | null) => {
  if (value === undefined || value === null) return "-";
  return value.toLocaleString();
};

const UNIT_FACTORS: Record<QuotaUnit, number> = {
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4,
};

const quotaBytesToForm = (bytes?: number | null): { value: string; unit: QuotaUnit } => {
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

const formToQuotaBytes = (value: string, unit: QuotaUnit): number | null => {
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
  const [adminFlag, setAdminFlag] = useState(false);
  const [systemFlag, setSystemFlag] = useState(false);
  const [quotaEnabled, setQuotaEnabled] = useState(true);
  const [quotaSize, setQuotaSize] = useState("");
  const [quotaUnit, setQuotaUnit] = useState<QuotaUnit>("GiB");
  const [quotaObjects, setQuotaObjects] = useState("");
  const [capsMode, setCapsMode] = useState<CapsMode>("replace");
  const [capsText, setCapsText] = useState("");

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

    setSaving(true);
    try {
      const updated = await updateCephAdminUserConfig(
        endpointId,
        uid,
        {
          display_name: displayName.trim() || null,
          email: email.trim() || null,
          suspended,
          max_buckets: parsedMaxBuckets,
          op_mask: opMask.trim() || null,
          admin: adminFlag,
          system: systemFlag,
          account_root: accountRootEnabled ? true : undefined,
          quota_enabled: quotaEnabled,
          quota_max_size_bytes: parsedQuotaBytes,
          quota_max_objects: parsedQuotaObjects,
          caps: {
            mode: capsMode,
            values: capsTextToValues(capsText),
          },
        },
        tenant
      );
      setDetail(updated);
      setKeys(updated.keys ?? []);
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
    <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <header className="space-y-1">
        <p className="ui-caption font-semibold uppercase tracking-wide text-primary">Overview</p>
        <h3 className="ui-subtitle font-semibold text-slate-900 dark:text-slate-100">User {identityLabel}</h3>
        <p className="ui-caption text-slate-500 dark:text-slate-400">Identity, status, and quotas at a glance.</p>
      </header>
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
          <div className="rounded-xl border border-slate-200/80 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40">
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
    <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <header className="space-y-1">
        <p className="ui-caption font-semibold uppercase tracking-wide text-primary">Ceph Admin</p>
        <h3 className="ui-subtitle font-semibold text-slate-900 dark:text-slate-100">Admin Ops configuration</h3>
      </header>
      {saveError && <PageBanner tone="error">{saveError}</PageBanner>}
      {saveStatus && <PageBanner tone="success">{saveStatus}</PageBanner>}

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
          Display name
          <input
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
        <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
        <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
          Max buckets
          <input
            type="number"
            min={0}
            value={maxBuckets}
            onChange={(event) => setMaxBuckets(event.target.value)}
            placeholder="Leave empty to clear"
            className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
        <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
          Op mask
          <input
            type="text"
            value={opMask}
            onChange={(event) => setOpMask(event.target.value)}
            placeholder="read,write,delete"
            className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
      </div>

      <div className="grid gap-2 rounded-xl border border-slate-200/80 bg-slate-50 px-4 py-3 sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-900/40">
        <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={suspended}
            onChange={(event) => setSuspended(event.target.checked)}
            className={uiCheckboxClass}
          />
          Suspended
        </label>
        <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={adminFlag}
            onChange={(event) => setAdminFlag(event.target.checked)}
            className={uiCheckboxClass}
          />
          Admin
        </label>
        <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={systemFlag}
            onChange={(event) => setSystemFlag(event.target.checked)}
            className={uiCheckboxClass}
          />
          System
        </label>
      </div>

      <div className="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40">
        <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={quotaEnabled}
            onChange={(event) => setQuotaEnabled(event.target.checked)}
            className={uiCheckboxClass}
          />
          Enable user quota
        </label>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)]">
          <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
            Storage quota
            <input
              type="number"
              min={0}
              step="any"
              value={quotaSize}
              onChange={(event) => setQuotaSize(event.target.value)}
              placeholder="Leave empty to clear"
              disabled={!quotaEnabled}
              className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
          <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
            Unit
            <select
              value={quotaUnit}
              onChange={(event) => setQuotaUnit(event.target.value as QuotaUnit)}
              disabled={!quotaEnabled}
              className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="MiB">MiB</option>
              <option value="GiB">GiB</option>
              <option value="TiB">TiB</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
            Object quota
            <input
              type="number"
              min={0}
              step={1}
              value={quotaObjects}
              onChange={(event) => setQuotaObjects(event.target.value)}
              placeholder="Leave empty to clear"
              disabled={!quotaEnabled}
              className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
          Caps update mode
          <select
            value={capsMode}
            onChange={(event) => setCapsMode(event.target.value as CapsMode)}
            className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            <option value="replace">Replace</option>
            <option value="add">Add</option>
            <option value="remove">Remove</option>
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
        Caps (one per line, e.g. users=read)
        <textarea
          value={capsText}
          onChange={(event) => setCapsText(event.target.value)}
          rows={4}
          className="rounded-md border border-slate-200 px-3 py-2 font-mono ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          spellCheck={false}
        />
      </label>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={saving || detailLoading}
          className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save configuration"}
        </button>
      </div>
    </section>
  );

  const s3Tab = (
    <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <header className="space-y-1">
        <p className="ui-caption font-semibold uppercase tracking-wide text-primary">S3 API</p>
        <h3 className="ui-subtitle font-semibold text-slate-900 dark:text-slate-100">Access keys</h3>
        <p className="ui-caption text-slate-500 dark:text-slate-400">
          Manage S3 credentials for this user without leaving the listing context.
        </p>
      </header>

      {keysError && <PageBanner tone="error">{keysError}</PageBanner>}
      {keysStatus && <PageBanner tone="success">{keysStatus}</PageBanner>}

      {createdKey && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 ui-body text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/60 dark:text-amber-100">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">Key created. Secret is shown only once.</p>
            <button
              type="button"
              onClick={() => setShowAddConnectionModal(true)}
              className="rounded-md border border-amber-300 bg-white/70 px-3 py-1.5 ui-caption font-semibold text-amber-700 hover:bg-amber-100/70 disabled:opacity-60 dark:border-amber-700 dark:bg-amber-950/20 dark:text-amber-100 dark:hover:bg-amber-950/40"
            >
              Ajouter comme S3 Connection
            </button>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <p className="ui-caption uppercase tracking-wide text-amber-700 dark:text-amber-200">Access key</p>
              <p className="rounded border border-amber-200 bg-white/80 px-3 py-2 font-mono ui-caption text-slate-800 dark:border-amber-800 dark:bg-amber-50/10 dark:text-amber-100">
                {createdKey.access_key}
              </p>
            </div>
            <div>
              <p className="ui-caption uppercase tracking-wide text-amber-700 dark:text-amber-200">Secret key</p>
              <p className="rounded border border-amber-200 bg-white/80 px-3 py-2 font-mono ui-caption text-slate-800 dark:border-amber-800 dark:bg-amber-50/10 dark:text-amber-100">
                {createdKey.secret_key}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={refreshKeys}
          disabled={keysLoading}
          className="rounded-md border border-slate-200 px-2.5 py-1.5 ui-caption font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
        >
          {keysLoading ? "Loading..." : "Refresh"}
        </button>
        <button
          type="button"
          onClick={handleCreateKey}
          disabled={keysBusy === "create"}
          className="rounded-md bg-primary px-2.5 py-1.5 ui-caption font-semibold text-white shadow-sm hover:bg-primary-600 disabled:opacity-60"
        >
          {keysBusy === "create" ? "Creating..." : "New key"}
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="compact-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
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
              const toggleBusy = keysBusy === `toggle:${key.access_key}`;
              const deleteBusy = keysBusy === `delete:${key.access_key}`;
              return (
                <tr key={key.access_key}>
                  <td className="px-3 py-2 font-mono ui-body font-semibold text-slate-800 dark:text-slate-100">{key.access_key}</td>
                  <td className="px-3 py-2 ui-body text-slate-600 dark:text-slate-300">{key.status ?? (active ? "enabled" : "disabled")}</td>
                  <td className="px-3 py-2 ui-body text-slate-600 dark:text-slate-300">{formatDate(key.created_at)}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleToggleKey(key, !active)}
                        disabled={toggleBusy || deleteBusy}
                        className={tableActionButtonClasses}
                      >
                        {toggleBusy ? "Saving..." : active ? "Disable" : "Enable"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteKey(key)}
                        disabled={toggleBusy || deleteBusy}
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
    <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <header className="space-y-1">
        <p className="ui-caption font-semibold uppercase tracking-wide text-primary">Metrics</p>
        <h3 className="ui-subtitle font-semibold text-slate-900 dark:text-slate-100">RGW usage</h3>
        <p className="ui-caption text-slate-500 dark:text-slate-400">Live usage and top buckets for this user.</p>
      </header>

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
          <div className="rounded-xl border border-slate-200/80 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40">
            <div className="flex items-center justify-between gap-2">
              <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Top buckets by usage</p>
              <p className="ui-caption text-slate-500 dark:text-slate-400">{metrics.bucket_count} bucket(s)</p>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="compact-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
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

  const tabs = useMemo(() => {
    const baseTabs = [
      { id: "overview", label: "Overview", content: overviewTab },
      { id: "ceph", label: "Ceph Admin", content: cephTab },
      { id: "s3", label: "S3 API", content: s3Tab },
    ];
    if (canViewMetrics) {
      baseTabs.push({ id: "metrics", label: "Metrics", content: metricsTab });
    }
    return baseTabs;
  }, [canViewMetrics, cephTab, metricsTab, overviewTab, s3Tab]);
  const addConnectionDefaults = useMemo(() => {
    if (!createdKey) return null;
    return buildCephConnectionDefaults(uid, createdKey.access_key, {
      accountId: detail?.account_id,
      tenant,
    });
  }, [createdKey, detail?.account_id, tenant, uid]);

  return (
    <Modal title={`Configure user · ${identityLabel}`} onClose={onClose} maxWidthClass="max-w-6xl" maxBodyHeightClass="max-h-[85vh]">
      <PageTabs tabs={tabs} activeTab={activeTab} onChange={(tab) => setActiveTab(tab as TabId)} />
      {showAddConnectionModal && createdKey && addConnectionDefaults && (
        <AddS3ConnectionFromKeyModal
          isOpen={showAddConnectionModal}
          title="Ajouter cette clé comme S3 Connection"
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
    </Modal>
  );
}
