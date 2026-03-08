/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  AdminStats,
  AdminTrafficStats,
  TrafficWindow,
  fetchAdminStorage,
  fetchAdminTraffic,
} from "../../api/stats";
import { listStorageEndpoints, type StorageEndpoint } from "../../api/storageEndpoints";
import MetricsTrafficOverview, { MetricsSnapshotCard } from "../../components/MetricsTrafficOverview";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import UsageBreakdown from "../../components/UsageBreakdown";
import { formatBytes, formatCompactNumber } from "../../utils/format";

function extractError(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const detail = (err.response?.data as { detail?: string } | undefined)?.detail;
    if (detail && detail.trim()) {
      return detail;
    }
  }
  if (err instanceof Error && err.message.trim()) {
    return err.message;
  }
  return fallback;
}

export default function AdminMetricsPage() {
  const [storage, setStorage] = useState<AdminStats | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [storageLoading, setStorageLoading] = useState<boolean>(true);

  const [endpoints, setEndpoints] = useState<StorageEndpoint[]>([]);
  const [selectedEndpointId, setSelectedEndpointId] = useState<number | null>(null);
  const [endpointLoading, setEndpointLoading] = useState<boolean>(true);
  const [endpointError, setEndpointError] = useState<string | null>(null);

  const [traffic, setTraffic] = useState<AdminTrafficStats | null>(null);
  const [trafficError, setTrafficError] = useState<string | null>(null);
  const [trafficLoading, setTrafficLoading] = useState<boolean>(false);

  const [window, setWindow] = useState<TrafficWindow>("week");

  useEffect(() => {
    let cancelled = false;
    async function loadEndpoints() {
      setEndpointLoading(true);
      setEndpointError(null);
      try {
        const data = await listStorageEndpoints();
        if (cancelled) {
          return;
        }
        const cephEndpoints = data.filter((endpoint) => endpoint.provider === "ceph");
        setEndpoints(cephEndpoints);
        if (cephEndpoints.length === 0) {
          setSelectedEndpointId(null);
          setEndpointError("No Ceph endpoint available for metrics.");
        } else {
          const preferred = cephEndpoints.find((ep) => ep.is_default) || cephEndpoints[0];
          setSelectedEndpointId((current) => current ?? preferred.id);
        }
      } catch (err) {
        if (!cancelled) {
          setEndpoints([]);
          setSelectedEndpointId(null);
          setEndpointError(extractError(err, "Unable to retrieve the endpoint list."));
        }
      } finally {
        if (!cancelled) {
          setEndpointLoading(false);
        }
      }
    }
    loadEndpoints();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadStorage() {
      if (endpointLoading) {
        return;
      }
      if (selectedEndpointId == null) {
        setStorage(null);
        setStorageLoading(false);
        return;
      }
      setStorage(null);
      setStorageLoading(true);
      setStorageError(null);
      try {
        const data = await fetchAdminStorage(selectedEndpointId);
        if (!cancelled) {
          setStorage(data);
        }
      } catch (err) {
        if (!cancelled) {
          setStorageError(extractError(err, "Unable to load admin storage metrics."));
          setStorage(null);
        }
      } finally {
        if (!cancelled) {
          setStorageLoading(false);
        }
      }
    }
    loadStorage();
    return () => {
      cancelled = true;
    };
  }, [endpointLoading, selectedEndpointId]);

  useEffect(() => {
    let cancelled = false;
    async function loadTraffic() {
      if (endpointLoading) {
        return;
      }
      if (selectedEndpointId == null) {
        setTraffic(null);
        setTrafficLoading(false);
        return;
      }
      setTraffic(null);
      setTrafficLoading(true);
      setTrafficError(null);
      try {
        const data = await fetchAdminTraffic(window, selectedEndpointId);
        if (!cancelled) {
          setTraffic(data);
        }
      } catch (err) {
        if (!cancelled) {
          setTrafficError(extractError(err, "Unable to retrieve RGW logs."));
          setTraffic(null);
        }
      } finally {
        if (!cancelled) {
          setTrafficLoading(false);
        }
      }
    }
    loadTraffic();
    return () => {
      cancelled = true;
    };
  }, [endpointLoading, selectedEndpointId, window]);

  const storageTotals = storage?.storage_totals;
  const selectedEndpoint = useMemo(
    () => endpoints.find((endpoint) => endpoint.id === selectedEndpointId) ?? null,
    [endpoints, selectedEndpointId]
  );

  const accountUsageItems = useMemo(
    () =>
      (storage?.account_usage ?? []).map((account) => ({
        id: account.account_id,
        label: account.account_name || account.account_id,
        usedBytes: account.used_bytes ?? null,
        objectCount: account.object_count ?? null,
      })),
    [storage?.account_usage]
  );

  const userUsageItems = useMemo(
    () =>
      (storage?.s3_user_usage ?? []).map((user) => ({
        id: user.rgw_user_uid || `s3-user-${user.user_id}`,
        label: user.user_name || user.rgw_user_uid || `User #${user.user_id}`,
        usedBytes: user.used_bytes ?? null,
        objectCount: user.object_count ?? null,
      })),
    [storage?.s3_user_usage]
  );

  const pageError = endpointError || storageError;
  const missingTraffic = selectedEndpointId != null && !traffic && !trafficLoading && !trafficError;

  return (
    <div className="space-y-4 ui-caption leading-relaxed">
      <PageHeader
        title="Metrics"
        description={pageError || "Centralized view of platform storage and traffic."}
        breadcrumbs={[{ label: "Admin" }, { label: "Overview", to: "/admin" }, { label: "Metrics" }]}
      />

      <div className="ui-surface-card p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="ui-caption font-semibold uppercase tracking-wide text-primary">Ceph endpoint</p>
            <p className="ui-body text-slate-500 dark:text-slate-400">
              Choose the storage to analyze (Ceph endpoints only).
            </p>
          </div>
          <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-3">
            <select
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 ui-body font-semibold text-slate-800 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              value={selectedEndpointId ?? ""}
              onChange={(event) => setSelectedEndpointId(event.target.value ? Number(event.target.value) : null)}
              disabled={endpointLoading || endpoints.length === 0}
            >
              {endpointLoading && <option value="">Loading...</option>}
              {!endpointLoading && endpoints.length === 0 && <option value="">No Ceph endpoint</option>}
              {!endpointLoading &&
                endpoints.map((endpoint) => (
                  <option key={endpoint.id} value={endpoint.id} title={endpoint.endpoint_url}>
                    {endpoint.is_default ? `${endpoint.name} (default)` : endpoint.name}
                  </option>
                ))}
            </select>
            {selectedEndpoint && (
              <span
                className="max-w-[320px] truncate ui-caption text-slate-500 dark:text-slate-400"
                title={selectedEndpoint.endpoint_url}
              >
                {selectedEndpoint.endpoint_url}
              </span>
            )}
          </div>
        </div>
      </div>

      {pageError && <PageBanner tone="warning">{pageError}</PageBanner>}

      <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-slate-100 p-5 shadow-sm dark:border-slate-800 dark:from-slate-900 dark:via-slate-900 dark:to-slate-950">
        <header className="flex flex-col justify-between gap-2 md:flex-row md:items-center">
          <div>
            <p className="ui-caption font-semibold uppercase tracking-wide text-primary">Storage snapshot</p>
            <h3 className="ui-section font-semibold text-slate-900 dark:text-slate-100">Stored volume & objects</h3>
            <p className="ui-body text-slate-500 dark:text-slate-400">Aggregated stats across known S3 accounts.</p>
          </div>
          {storage?.generated_at && (
            <p className="ui-caption text-slate-500 dark:text-slate-400">
              Updated:&nbsp;{new Date(storage.generated_at).toLocaleString()}
            </p>
          )}
        </header>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricsSnapshotCard
            label="Stored volume"
            value={storageTotals?.used_bytes != null ? formatBytes(storageTotals.used_bytes) : "—"}
            hint="Sum of known buckets"
            loading={storageLoading}
          />
          <MetricsSnapshotCard
            label="Objects"
            value={storageTotals?.object_count != null ? formatCompactNumber(storageTotals.object_count) : "—"}
            hint="Instant count"
            loading={storageLoading}
          />
          <MetricsSnapshotCard
            label="Visible buckets"
            value={storageTotals?.bucket_count != null ? formatCompactNumber(storageTotals.bucket_count) : "—"}
            hint="Based on root credentials"
            loading={storageLoading}
          />
          <MetricsSnapshotCard
            label="S3 accounts"
            value={storage ? formatCompactNumber(storage.total_accounts) : "—"}
            hint={`${formatCompactNumber(storage?.total_s3_users ?? 0)} S3 users`}
            loading={storageLoading}
          />
        </div>
      </section>

      <MetricsTrafficOverview
        traffic={traffic}
        window={window}
        onWindowChange={setWindow}
        loading={trafficLoading}
        error={trafficError}
        showEmpty={missingTraffic}
      />

      <section className="space-y-4 ui-surface-card p-5">
        <header className="space-y-1">
          <p className="ui-caption font-semibold uppercase tracking-wide text-primary">Storage breakdown</p>
          <h3 className="ui-section font-semibold text-slate-900 dark:text-slate-100">Accounts & users</h3>
          <p className="ui-body text-slate-500 dark:text-slate-400">Account scan with graphical breakdown.</p>
        </header>
        <div className="grid gap-6 xl:grid-cols-2">
          <UsageBreakdown
            title="Accounts (volume)"
            subtitle="Volume used per account (top 8)."
            loading={storageLoading}
            metric="bytes"
            items={accountUsageItems}
            emptyMessage="No volume data available."
          />
          <UsageBreakdown
            title="Accounts (objects)"
            subtitle="Object count per account (top 8)."
            loading={storageLoading}
            metric="objects"
            items={accountUsageItems}
            emptyMessage="No object data available."
          />
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          <UsageBreakdown
            title="S3 users (volume)"
            subtitle="Volume consumed per user."
            loading={storageLoading}
            metric="bytes"
            items={userUsageItems}
            emptyMessage="No S3 users with metrics."
          />
          <UsageBreakdown
            title="S3 users (objects)"
            subtitle="Object count per user."
            loading={storageLoading}
            metric="objects"
            items={userUsageItems}
            emptyMessage="No S3 users with metrics."
          />
        </div>
      </section>
    </div>
  );
}
