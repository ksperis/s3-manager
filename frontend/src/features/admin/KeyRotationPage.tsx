/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import {
  KeyRotationResponse,
  KeyRotationResultItem,
  KeyRotationType,
  rotateS3Keys,
} from "../../api/keyRotation";
import { StorageEndpoint, listStorageEndpoints } from "../../api/storageEndpoints";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import ListToolbar from "../../components/ListToolbar";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import { adminBreadcrumbs } from "./adminBreadcrumbs";
import UiButton from "../../components/ui/UiButton";
import { SettingsCard, SettingsChoiceRow } from "../../components/settings/SettingsLayout";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { extractApiError } from "../../utils/apiError";

type RotationTypeOption = {
  value: KeyRotationType;
  label: string;
  description: string;
};

type KeyRotationResultRow = KeyRotationResultItem & {
  rowKey: string;
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

const ENV_MANAGED_ENDPOINT_KEY_TYPES: KeyRotationType[] = [
  "endpoint_admin",
  "endpoint_supervision",
  "ceph_admin",
];

function isEndpointEligible(endpoint: StorageEndpoint): boolean {
  if (endpoint.provider !== "ceph") return false;
  const adminEnabled = endpoint.capabilities?.admin ?? endpoint.features?.admin?.enabled ?? false;
  return Boolean(adminEnabled);
}

function extractError(err: unknown): string {
  return extractApiError(err, "Unable to run key rotation.");
}

function statusBadgeClassName(status: KeyRotationResultItem["status"]): string {
  if (status === "rotated") {
    return "inline-flex rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-100";
  }
  if (status === "failed") {
    return "inline-flex rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700 dark:bg-rose-900/30 dark:text-rose-100";
  }
  return "inline-flex rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200";
}

const resultTableColumns: Array<DataTableColumn<KeyRotationResultRow>> = [
  {
    id: "endpoint",
    label: "Endpoint",
    primary: true,
    render: (item) => item.endpoint_name,
  },
  {
    id: "type",
    label: "Type",
    render: (item) => KEY_TYPE_LABEL[item.key_type],
  },
  {
    id: "target",
    label: "Target",
    render: (item) => item.target_label || item.target_type,
  },
  {
    id: "status",
    label: "Status",
    render: (item) => <span className={statusBadgeClassName(item.status)}>{item.status}</span>,
  },
  {
    id: "details",
    label: "Details",
    render: (item) => (
      <>
        {item.message}
        {item.old_access_key && item.new_access_key ? (
          <span className="ml-1 text-slate-500 dark:text-slate-400">
            ({item.old_access_key} -&gt; {item.new_access_key})
          </span>
        ) : null}
      </>
    ),
  },
];

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
  const selectedEnvManagedEndpoints = useMemo(
    () =>
      eligibleEndpoints.filter(
        (endpoint) => selectedEndpointIds.includes(endpoint.id) && endpoint.is_editable === false
      ),
    [eligibleEndpoints, selectedEndpointIds]
  );
  const hasSelectedEnvManagedEndpointKeys =
    selectedEnvManagedEndpoints.length > 0 &&
    selectedTypes.some((type) => ENV_MANAGED_ENDPOINT_KEY_TYPES.includes(type));
  const resultRows = useMemo<KeyRotationResultRow[]>(
    () =>
      (result?.results ?? []).map((item, index) => ({
        ...item,
        rowKey: `${item.endpoint_id}-${item.key_type}-${item.target_id ?? "none"}-${index}`,
      })),
    [result?.results]
  );
  const resultTableStatus = resolveListTableStatus({
    loading: false,
    error: null,
    rowCount: resultRows.length,
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
      } else if (response.summary.skipped > 0) {
        setActionMessage("Rotation completed with skipped items. Review details below.");
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
        breadcrumbs={adminBreadcrumbs({ label: "Settings" }, { label: "Key rotation" })}
        actions={[
          {
            label: running ? "Rotating..." : "Run rotation",
            onClick: runRotation,
            disabled: runDisabled,
          },
        ]}
      />

      {loading && <PageBanner tone="info">Loading endpoints...</PageBanner>}
      {error && <PageBanner tone="error">{error}</PageBanner>}
      {actionMessage && (
        <PageBanner tone={result?.summary.failed || result?.summary.skipped ? "warning" : "success"}>
          {actionMessage}
        </PageBanner>
      )}
      {hasSelectedEnvManagedEndpointKeys && (
        <PageBanner tone="warning">
          Endpoint admin, supervision, and Ceph-admin keys managed by ENV_STORAGE_ENDPOINTS will be
          skipped. Rotate them externally and redeploy with the updated environment values. Account
          and S3 user keys remain eligible.
        </PageBanner>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <SettingsCard>
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Endpoints</p>
              <p className="ui-caption text-slate-500 dark:text-slate-400">
                Select one or more Ceph endpoints with admin API enabled.
              </p>
            </div>
            <div className="flex gap-2">
              <UiButton
                type="button"
                onClick={selectAllEndpoints}
                variant="secondary"
                size="xs"
              >
                Select all
              </UiButton>
              <UiButton
                type="button"
                onClick={clearAllEndpoints}
                variant="secondary"
                size="xs"
              >
                Clear
              </UiButton>
            </div>
          </div>
          <div>
            {endpoints.map((endpoint) => {
              const eligible = isEndpointEligible(endpoint);
              const envManaged = endpoint.is_editable === false;
              return (
                <SettingsChoiceRow
                  key={endpoint.id}
                  title={endpoint.name}
                  description={`${endpoint.endpoint_url} · ${endpoint.provider}${
                    envManaged ? " · managed by environment" : ""
                  }`}
                  checked={selectedEndpointIds.includes(endpoint.id)}
                  disabled={!eligible}
                  onChange={() => toggleEndpoint(endpoint.id)}
                >
                  {!eligible && (
                    <span className="block text-amber-700 dark:text-amber-300">
                      Unsupported: endpoint is not Ceph or admin feature is disabled.
                    </span>
                  )}
                  {eligible && envManaged && (
                    <span className="block text-amber-700 dark:text-amber-300">
                      Endpoint credentials must be rotated through ENV_STORAGE_ENDPOINTS.
                    </span>
                  )}
                </SettingsChoiceRow>
              );
            })}
            {!loading && endpoints.length === 0 && (
              <p className="ui-caption text-slate-500 dark:text-slate-400">No storage endpoints found.</p>
            )}
          </div>
        </SettingsCard>

        <SettingsCard>
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Key types</p>
              <p className="ui-caption text-slate-500 dark:text-slate-400">Choose the key categories to rotate.</p>
            </div>
            <div className="flex gap-2">
              <UiButton
                type="button"
                onClick={selectAllTypes}
                variant="secondary"
                size="xs"
              >
                Select all
              </UiButton>
              <UiButton
                type="button"
                onClick={clearAllTypes}
                variant="secondary"
                size="xs"
              >
                Clear
              </UiButton>
            </div>
          </div>
          <div>
            {ROTATION_TYPE_OPTIONS.map((option) => (
              <SettingsChoiceRow
                key={option.value}
                title={option.label}
                description={option.description}
                checked={selectedTypes.includes(option.value)}
                onChange={() => toggleType(option.value)}
              />
            ))}
          </div>

          <div className="mt-4 border-t border-[color:var(--ui-border-soft)] pt-4">
            <SettingsChoiceRow
              title="Disable old keys only"
              description="Keep previous keys but suspend them instead of deleting them."
              checked={deactivateOnly}
              onChange={setDeactivateOnly}
            />
          </div>
        </SettingsCard>
      </div>

      {result && (
        <SettingsCard padded={false}>
          <ListToolbar
            title="Execution summary"
            description={`Mode: ${result.mode === "deactivate_old_keys" ? "Deactivate old keys" : "Delete old keys"}`}
            countLabel={`${result.results.length} detailed result${result.results.length === 1 ? "" : "s"}`}
          />
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

            <DataTableShell
              columns={resultTableColumns}
              rows={resultRows}
              rowKey={(item) => item.rowKey}
              status={resultTableStatus}
              loadingMessage="Loading rotation results..."
              errorMessage="Unable to load rotation results."
              emptyMessage="No details returned by the backend."
              primaryColumnId="endpoint"
              responsiveCards
              tableClassName="compact-table"
            />
          </div>
        </SettingsCard>
      )}
    </div>
  );
}
