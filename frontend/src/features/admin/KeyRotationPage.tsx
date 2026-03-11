/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { KeyRotationResponse, KeyRotationType, rotateS3Keys } from "../../api/keyRotation";
import { StorageEndpoint, listStorageEndpoints } from "../../api/storageEndpoints";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import TableEmptyState from "../../components/TableEmptyState";
import ListSectionCard from "../../components/list/ListSectionCard";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { extractApiError } from "../../utils/apiError";

type RotationTypeOption = {
  value: KeyRotationType;
  label: string;
  description: string;
};

const ROTATION_TYPE_OPTIONS: RotationTypeOption[] = [
  {
    value: "endpoint_admin",
    label: "Endpoint admin keys",
    description: "Rotate admin credentials configured on each selected endpoint.",
  },
  {
    value: "endpoint_supervision",
    label: "Endpoint supervision keys",
    description: "Rotate supervision credentials used for usage and metrics collection.",
  },
  {
    value: "account",
    label: "Account keys",
    description: "Rotate interface keys for managed RGW accounts.",
  },
  {
    value: "s3_user",
    label: "S3 user keys",
    description: "Rotate interface keys for managed standalone S3 users.",
  },
  {
    value: "ceph_admin",
    label: "Ceph-admin keys",
    description: "Rotate dedicated Ceph Admin credentials configured on endpoints.",
  },
];

const KEY_TYPE_LABEL: Record<KeyRotationType, string> = {
  endpoint_admin: "Endpoint admin",
  endpoint_supervision: "Endpoint supervision",
  account: "Account",
  s3_user: "S3 user",
  ceph_admin: "Ceph-admin",
};

function isEndpointEligible(endpoint: StorageEndpoint): boolean {
  if (endpoint.provider !== "ceph") return false;
  const adminEnabled = endpoint.capabilities?.admin ?? endpoint.features?.admin?.enabled ?? false;
  return Boolean(adminEnabled);
}

function extractError(err: unknown): string {
  return extractApiError(err, "Unable to run key rotation.");
}

export default function KeyRotationPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [result, setResult] = useState<KeyRotationResponse | null>(null);
  const [endpoints, setEndpoints] = useState<StorageEndpoint[]>([]);
  const [selectedEndpointIds, setSelectedEndpointIds] = useState<number[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<KeyRotationType[]>([
    "endpoint_admin",
    "endpoint_supervision",
    "account",
    "s3_user",
    "ceph_admin",
  ]);
  const [deactivateOnly, setDeactivateOnly] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const loadedEndpoints = await listStorageEndpoints();
        if (!mounted) return;
        setEndpoints(loadedEndpoints);
        const eligibleIds = loadedEndpoints.filter((endpoint) => isEndpointEligible(endpoint)).map((endpoint) => endpoint.id);
        setSelectedEndpointIds(eligibleIds);
      } catch (err) {
        if (!mounted) return;
        setError(extractError(err));
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const eligibleEndpoints = useMemo(
    () => endpoints.filter((endpoint) => isEndpointEligible(endpoint)),
    [endpoints]
  );
  const resultTableStatus = resolveListTableStatus({
    loading: false,
    error: null,
    rowCount: result?.results.length ?? 0,
  });

  const runDisabled = running || selectedEndpointIds.length === 0 || selectedTypes.length === 0;

  const toggleEndpoint = (endpointId: number) => {
    setSelectedEndpointIds((prev) =>
      prev.includes(endpointId) ? prev.filter((id) => id !== endpointId) : [...prev, endpointId]
    );
  };

  const toggleType = (type: KeyRotationType) => {
    setSelectedTypes((prev) => (prev.includes(type) ? prev.filter((entry) => entry !== type) : [...prev, type]));
  };

  const selectAllEndpoints = () => {
    setSelectedEndpointIds(eligibleEndpoints.map((endpoint) => endpoint.id));
  };

  const clearAllEndpoints = () => {
    setSelectedEndpointIds([]);
  };

  const selectAllTypes = () => {
    setSelectedTypes(ROTATION_TYPE_OPTIONS.map((option) => option.value));
  };

  const clearAllTypes = () => {
    setSelectedTypes([]);
  };

  const runRotation = async () => {
    if (runDisabled) return;
    setRunning(true);
    setError(null);
    setActionMessage(null);
    try {
      const response = await rotateS3Keys({
        endpoint_ids: selectedEndpointIds,
        key_types: selectedTypes,
        deactivate_only: deactivateOnly,
      });
      setResult(response);
      if (response.summary.failed > 0) {
        setActionMessage("Rotation completed with errors. Review details below.");
      } else {
        setActionMessage("Rotation completed successfully.");
      }
    } catch (err) {
      setError(extractError(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="S3 key rotation"
        description="Rotate endpoint and managed RGW keys across selected storage endpoints."
        breadcrumbs={[
          { label: "Admin" },
          { label: "Settings" },
          { label: "Key rotation" },
        ]}
        rightContent={
          <button
            type="button"
            onClick={runRotation}
            disabled={runDisabled}
            className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:pointer-events-none disabled:opacity-60"
          >
            {running ? "Rotating..." : "Run rotation"}
          </button>
        }
      />

      {loading && <PageBanner tone="info">Loading endpoints...</PageBanner>}
      {error && <PageBanner tone="error">{error}</PageBanner>}
      {actionMessage && <PageBanner tone={result?.summary.failed ? "warning" : "success"}>{actionMessage}</PageBanner>}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="ui-surface-card p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Endpoints</p>
              <p className="ui-caption text-slate-500 dark:text-slate-400">
                Select one or more Ceph endpoints with admin API enabled.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={selectAllEndpoints}
                className="rounded-md border border-slate-200 px-2.5 py-1 ui-caption font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-200"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={clearAllEndpoints}
                className="rounded-md border border-slate-200 px-2.5 py-1 ui-caption font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-200"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {endpoints.map((endpoint) => {
              const eligible = isEndpointEligible(endpoint);
              return (
                <label
                  key={endpoint.id}
                  className={`flex items-start gap-3 rounded-lg border px-3 py-2 ui-caption ${
                    eligible
                      ? "border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-200"
                      : "border-slate-100 text-slate-400 dark:border-slate-800 dark:text-slate-500"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedEndpointIds.includes(endpoint.id)}
                    disabled={!eligible}
                    onChange={() => toggleEndpoint(endpoint.id)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                  />
                  <span className="flex-1">
                    <span className="block font-semibold">{endpoint.name}</span>
                    <span className="block text-slate-500 dark:text-slate-400">
                      {endpoint.endpoint_url} · {endpoint.provider}
                    </span>
                    {!eligible && (
                      <span className="block text-amber-700 dark:text-amber-300">
                        Unsupported: endpoint is not Ceph or admin feature is disabled.
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
            {!loading && endpoints.length === 0 && (
              <p className="ui-caption text-slate-500 dark:text-slate-400">No storage endpoints found.</p>
            )}
          </div>
        </div>

        <div className="ui-surface-card p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Key types</p>
              <p className="ui-caption text-slate-500 dark:text-slate-400">Choose the key categories to rotate.</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={selectAllTypes}
                className="rounded-md border border-slate-200 px-2.5 py-1 ui-caption font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-200"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={clearAllTypes}
                className="rounded-md border border-slate-200 px-2.5 py-1 ui-caption font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-200"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {ROTATION_TYPE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className="flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                <input
                  type="checkbox"
                  checked={selectedTypes.includes(option.value)}
                  onChange={() => toggleType(option.value)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                />
                <span className="flex-1">
                  <span className="block font-semibold">{option.label}</span>
                  <span className="block text-slate-500 dark:text-slate-400">{option.description}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 px-3 py-3 dark:border-slate-700">
            <label className="flex items-start gap-3 ui-caption text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={deactivateOnly}
                onChange={(event) => setDeactivateOnly(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
              />
              <span>
                <span className="block font-semibold">Disable old keys only</span>
                <span className="block text-slate-500 dark:text-slate-400">
                  Keep previous keys but suspend them instead of deleting them.
                </span>
              </span>
            </label>
          </div>
        </div>
      </div>

      {result && (
        <ListSectionCard
          title="Execution summary"
          subtitle={`Mode: ${result.mode === "deactivate_old_keys" ? "Deactivate old keys" : "Delete old keys"}`}
        >
          <div className="space-y-3 px-5 pb-5 pt-3">
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-lg bg-slate-50 px-3 py-2 ui-caption dark:bg-slate-800/60">Total: {result.summary.total}</div>
            <div className="rounded-lg bg-emerald-50 px-3 py-2 ui-caption text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-100">
              Rotated: {result.summary.rotated}
            </div>
            <div className="rounded-lg bg-rose-50 px-3 py-2 ui-caption text-rose-700 dark:bg-rose-900/30 dark:text-rose-100">
              Failed: {result.summary.failed}
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2 ui-caption dark:bg-slate-800/60">Skipped: {result.summary.skipped}</div>
            <div className="rounded-lg bg-slate-50 px-3 py-2 ui-caption dark:bg-slate-800/60">
              Old keys deleted: {result.summary.deleted_old_keys}
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2 ui-caption dark:bg-slate-800/60">
              Old keys disabled: {result.summary.disabled_old_keys}
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="compact-table min-w-full divide-y divide-slate-200 dark:divide-slate-700">
              <thead className="bg-slate-50 dark:bg-slate-900/60">
                <tr>
                  <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Endpoint
                  </th>
                  <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Type
                  </th>
                  <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Target
                  </th>
                  <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Status
                  </th>
                  <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {result.results.map((item, index) => (
                  <tr key={`${item.endpoint_id}-${item.key_type}-${item.target_id ?? "none"}-${index}`}>
                    <td className="px-3 py-2 ui-caption text-slate-700 dark:text-slate-200">{item.endpoint_name}</td>
                    <td className="px-3 py-2 ui-caption text-slate-700 dark:text-slate-200">{KEY_TYPE_LABEL[item.key_type]}</td>
                    <td className="px-3 py-2 ui-caption text-slate-700 dark:text-slate-200">{item.target_label || item.target_type}</td>
                    <td className="px-3 py-2 ui-caption">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 font-semibold ${
                          item.status === "rotated"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-100"
                            : item.status === "failed"
                              ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-100"
                              : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                        }`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 ui-caption text-slate-600 dark:text-slate-300">
                      {item.message}
                      {item.old_access_key && item.new_access_key && (
                        <span className="ml-1 text-slate-500 dark:text-slate-400">
                          ({item.old_access_key} → {item.new_access_key})
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {resultTableStatus === "empty" && (
                  <TableEmptyState colSpan={5} message="No details returned by the backend." />
                )}
              </tbody>
            </table>
          </div>
          </div>
        </ListSectionCard>
      )}
    </div>
  );
}
