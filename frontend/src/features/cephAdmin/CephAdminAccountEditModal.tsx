/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import {
  CephAdminEntityMetrics,
  CephAdminRgwAccountDetail,
  getCephAdminAccountDetail,
  getCephAdminAccountMetrics,
  updateCephAdminAccountConfig,
} from "../../api/cephAdmin";
import Modal from "../../components/Modal";
import PageBanner from "../../components/PageBanner";
import PageTabs from "../../components/PageTabs";
import UsageTile from "../../components/UsageTile";

type Props = {
  endpointId: number;
  accountId: string;
  canViewMetrics?: boolean;
  onClose: () => void;
  onSaved?: (detail: CephAdminRgwAccountDetail) => void;
};

type QuotaUnit = "MiB" | "GiB" | "TiB";

type TabId = "overview" | "config" | "metrics";

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

export default function CephAdminAccountEditModal({
  endpointId,
  accountId,
  canViewMetrics = true,
  onClose,
  onSaved,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [detail, setDetail] = useState<CephAdminRgwAccountDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<CephAdminEntityMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const [accountName, setAccountName] = useState("");
  const [email, setEmail] = useState("");
  const [maxUsers, setMaxUsers] = useState("");
  const [maxBuckets, setMaxBuckets] = useState("");
  const [maxRoles, setMaxRoles] = useState("");
  const [maxGroups, setMaxGroups] = useState("");
  const [maxAccessKeys, setMaxAccessKeys] = useState("");
  const [quotaEnabled, setQuotaEnabled] = useState(true);
  const [quotaSize, setQuotaSize] = useState("");
  const [quotaUnit, setQuotaUnit] = useState<QuotaUnit>("GiB");
  const [quotaObjects, setQuotaObjects] = useState("");
  const [bucketQuotaEnabled, setBucketQuotaEnabled] = useState(true);
  const [bucketQuotaSize, setBucketQuotaSize] = useState("");
  const [bucketQuotaUnit, setBucketQuotaUnit] = useState<QuotaUnit>("GiB");
  const [bucketQuotaObjects, setBucketQuotaObjects] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const payload = await getCephAdminAccountDetail(endpointId, accountId);
        if (cancelled) return;
        setDetail(payload);
        setAccountName(payload.account_name ?? "");
        setEmail(payload.email ?? "");
        setMaxUsers(payload.max_users != null ? String(payload.max_users) : "");
        setMaxBuckets(payload.max_buckets != null ? String(payload.max_buckets) : "");
        setMaxRoles(payload.max_roles != null ? String(payload.max_roles) : "");
        setMaxGroups(payload.max_groups != null ? String(payload.max_groups) : "");
        setMaxAccessKeys(payload.max_access_keys != null ? String(payload.max_access_keys) : "");
        const quotaConfigured = Boolean(
          payload.quota && (payload.quota.max_size_bytes != null || payload.quota.max_objects != null)
        );
        setQuotaEnabled(payload.quota?.enabled ?? quotaConfigured);
        const quotaForm = quotaBytesToForm(payload.quota?.max_size_bytes);
        setQuotaSize(quotaForm.value);
        setQuotaUnit(quotaForm.unit);
        setQuotaObjects(payload.quota?.max_objects != null ? String(payload.quota.max_objects) : "");
        const bucketQuotaConfigured = Boolean(
          payload.bucket_quota && (payload.bucket_quota.max_size_bytes != null || payload.bucket_quota.max_objects != null)
        );
        setBucketQuotaEnabled(payload.bucket_quota?.enabled ?? bucketQuotaConfigured);
        const bucketQuotaForm = quotaBytesToForm(payload.bucket_quota?.max_size_bytes);
        setBucketQuotaSize(bucketQuotaForm.value);
        setBucketQuotaUnit(bucketQuotaForm.unit);
        setBucketQuotaObjects(payload.bucket_quota?.max_objects != null ? String(payload.bucket_quota.max_objects) : "");
      } catch (err) {
        if (!cancelled) {
          setDetailError(extractError(err));
          setDetail(null);
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
  }, [accountId, endpointId]);

  useEffect(() => {
    if (!canViewMetrics || activeTab !== "metrics") return;
    let cancelled = false;
    const load = async () => {
      setMetricsLoading(true);
      setMetricsError(null);
      try {
        const payload = await getCephAdminAccountMetrics(endpointId, accountId);
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
  }, [activeTab, canViewMetrics, endpointId, accountId]);

  useEffect(() => {
    if (!canViewMetrics && activeTab === "metrics") {
      setActiveTab("overview");
    }
  }, [activeTab, canViewMetrics]);

  const submit = async () => {
    setSaveError(null);
    setSaveStatus(null);

    const parsedMaxUsers = maxUsers.trim() === "" ? null : Number(maxUsers);
    const parsedMaxBuckets = maxBuckets.trim() === "" ? null : Number(maxBuckets);
    const parsedMaxRoles = maxRoles.trim() === "" ? null : Number(maxRoles);
    const parsedMaxGroups = maxGroups.trim() === "" ? null : Number(maxGroups);
    const parsedMaxAccessKeys = maxAccessKeys.trim() === "" ? null : Number(maxAccessKeys);
    const parsedQuotaBytes = quotaEnabled ? formToQuotaBytes(quotaSize, quotaUnit) : null;
    const parsedQuotaObjects = quotaEnabled ? (quotaObjects.trim() === "" ? null : Number(quotaObjects)) : null;
    const parsedBucketQuotaBytes = bucketQuotaEnabled ? formToQuotaBytes(bucketQuotaSize, bucketQuotaUnit) : null;
    const parsedBucketQuotaObjects = bucketQuotaEnabled
      ? (bucketQuotaObjects.trim() === "" ? null : Number(bucketQuotaObjects))
      : null;

    if (parsedMaxUsers != null && (!Number.isInteger(parsedMaxUsers) || parsedMaxUsers < 0)) {
      setSaveError("Max users must be a positive integer.");
      return;
    }
    if (parsedMaxBuckets != null && (!Number.isInteger(parsedMaxBuckets) || parsedMaxBuckets < 0)) {
      setSaveError("Max buckets must be a positive integer.");
      return;
    }
    if (parsedMaxRoles != null && (!Number.isInteger(parsedMaxRoles) || parsedMaxRoles < 0)) {
      setSaveError("Max roles must be a positive integer.");
      return;
    }
    if (parsedMaxGroups != null && (!Number.isInteger(parsedMaxGroups) || parsedMaxGroups < 0)) {
      setSaveError("Max groups must be a positive integer.");
      return;
    }
    if (parsedMaxAccessKeys != null && (!Number.isInteger(parsedMaxAccessKeys) || parsedMaxAccessKeys < 0)) {
      setSaveError("Max access keys must be a positive integer.");
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
    if (parsedBucketQuotaObjects != null && (!Number.isInteger(parsedBucketQuotaObjects) || parsedBucketQuotaObjects < 0)) {
      setSaveError("Bucket quota objects must be a positive integer.");
      return;
    }
    if (bucketQuotaEnabled && bucketQuotaSize.trim() !== "" && parsedBucketQuotaBytes == null) {
      setSaveError("Bucket storage quota value is invalid.");
      return;
    }

    setSaving(true);
    try {
      const updated = await updateCephAdminAccountConfig(endpointId, accountId, {
        account_name: accountName.trim() || null,
        email: email.trim() || null,
        max_users: parsedMaxUsers,
        max_buckets: parsedMaxBuckets,
        max_roles: parsedMaxRoles,
        max_groups: parsedMaxGroups,
        max_access_keys: parsedMaxAccessKeys,
        quota_enabled: quotaEnabled,
        quota_max_size_bytes: parsedQuotaBytes,
        quota_max_objects: parsedQuotaObjects,
        bucket_quota_enabled: bucketQuotaEnabled,
        bucket_quota_max_size_bytes: parsedBucketQuotaBytes,
        bucket_quota_max_objects: parsedBucketQuotaObjects,
      });
      setDetail(updated);
      setSaveStatus("Account configuration updated.");
      onSaved?.(updated);
      if (activeTab === "metrics") {
        try {
          const refreshedMetrics = await getCephAdminAccountMetrics(endpointId, accountId);
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

  const overviewQuota = detail?.quota ?? null;

  const overviewTab = (
    <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <header className="space-y-1">
        <p className="ui-caption font-semibold uppercase tracking-wide text-primary">Overview</p>
        <h3 className="ui-subtitle font-semibold text-slate-900 dark:text-slate-100">Account {accountId}</h3>
        <p className="ui-caption text-slate-500 dark:text-slate-400">Core identifiers and current limits.</p>
      </header>
      {detailLoading && <PageBanner tone="info">Loading account details...</PageBanner>}
      {detailError && <PageBanner tone="error">{detailError}</PageBanner>}
      {detail && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <UsageTile
              label="Buckets"
              used={detail.bucket_count ?? null}
              quota={detail.max_buckets ?? null}
              formatter={formatNumber}
              quotaFormatter={(value) => (value != null ? value.toLocaleString() : "-")}
              unitHint="buckets"
              emptyHint="No bucket limit defined."
            />
            <UsageTile
              label="Users"
              used={detail.user_count ?? null}
              quota={detail.max_users ?? null}
              formatter={formatNumber}
              quotaFormatter={(value) => (value != null ? value.toLocaleString() : "-")}
              unitHint="users"
              emptyHint="No user limit defined."
            />
          </div>
          <div className="rounded-xl border border-slate-200/80 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40">
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Name</dt>
                <dd className="ui-body font-semibold text-slate-800 dark:text-slate-100">{detail.account_name ?? "-"}</dd>
              </div>
              <div>
                <dt className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Email</dt>
                <dd className="ui-body font-semibold text-slate-800 dark:text-slate-100">{detail.email ?? "-"}</dd>
              </div>
              <div>
                <dt className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Quota (size)
                </dt>
                <dd className="ui-body font-semibold text-slate-800 dark:text-slate-100">
                  {overviewQuota?.max_size_bytes != null ? formatBytes(overviewQuota.max_size_bytes) : "-"}
                </dd>
              </div>
              <div>
                <dt className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Quota (objects)
                </dt>
                <dd className="ui-body font-semibold text-slate-800 dark:text-slate-100">
                  {overviewQuota?.max_objects != null ? formatNumber(overviewQuota.max_objects) : "-"}
                </dd>
              </div>
            </dl>
          </div>
        </>
      )}
    </section>
  );

  const configTab = (
    <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <header className="space-y-1">
        <p className="ui-caption font-semibold uppercase tracking-wide text-primary">Configuration</p>
        <h3 className="ui-subtitle font-semibold text-slate-900 dark:text-slate-100">Ceph Admin API settings</h3>
      </header>
      {saveError && <PageBanner tone="error">{saveError}</PageBanner>}
      {saveStatus && <PageBanner tone="success">{saveStatus}</PageBanner>}
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
          Account name
          <input
            type="text"
            value={accountName}
            onChange={(event) => setAccountName(event.target.value)}
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
          Max users
          <input
            type="number"
            min={0}
            value={maxUsers}
            onChange={(event) => setMaxUsers(event.target.value)}
            placeholder="Leave empty to clear"
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
          Max roles
          <input
            type="number"
            min={0}
            value={maxRoles}
            onChange={(event) => setMaxRoles(event.target.value)}
            placeholder="Leave empty to clear"
            className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
        <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
          Max groups
          <input
            type="number"
            min={0}
            value={maxGroups}
            onChange={(event) => setMaxGroups(event.target.value)}
            placeholder="Leave empty to clear"
            className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
        <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
          Max access keys
          <input
            type="number"
            min={0}
            value={maxAccessKeys}
            onChange={(event) => setMaxAccessKeys(event.target.value)}
            placeholder="Leave empty to clear"
            className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
      </div>

      <div className="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40">
        <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={quotaEnabled}
            onChange={(event) => setQuotaEnabled(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
          />
          Enable account quota
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

      <div className="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40">
        <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={bucketQuotaEnabled}
            onChange={(event) => setBucketQuotaEnabled(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
          />
          Enable bucket quota
        </label>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)]">
          <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
            Storage quota
            <input
              type="number"
              min={0}
              step="any"
              value={bucketQuotaSize}
              onChange={(event) => setBucketQuotaSize(event.target.value)}
              placeholder="Leave empty to clear"
              disabled={!bucketQuotaEnabled}
              className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
          <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
            Unit
            <select
              value={bucketQuotaUnit}
              onChange={(event) => setBucketQuotaUnit(event.target.value as QuotaUnit)}
              disabled={!bucketQuotaEnabled}
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
              value={bucketQuotaObjects}
              onChange={(event) => setBucketQuotaObjects(event.target.value)}
              placeholder="Leave empty to clear"
              disabled={!bucketQuotaEnabled}
              className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
        </div>
      </div>

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

  const metricsTab = (
    <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <header className="space-y-1">
        <p className="ui-caption font-semibold uppercase tracking-wide text-primary">Metrics</p>
        <h3 className="ui-subtitle font-semibold text-slate-900 dark:text-slate-100">RGW usage</h3>
        <p className="ui-caption text-slate-500 dark:text-slate-400">Live usage and top buckets for this account.</p>
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
      { id: "config", label: "Configuration", content: configTab },
    ];
    if (canViewMetrics) {
      baseTabs.push({ id: "metrics", label: "Metrics", content: metricsTab });
    }
    return baseTabs;
  }, [canViewMetrics, configTab, metricsTab, overviewTab]);

  return (
    <Modal title={`Configure account · ${accountId}`} onClose={onClose} maxWidthClass="max-w-6xl" maxBodyHeightClass="max-h-[85vh]">
      <PageTabs tabs={tabs} activeTab={activeTab} onChange={(tab) => setActiveTab(tab as TabId)} />
    </Modal>
  );
}
