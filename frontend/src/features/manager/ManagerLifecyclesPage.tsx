/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listBucketLifecycles, type BucketLifecycleInventoryItem } from "../../api/buckets";
import ListToolbar from "../../components/ListToolbar";
import Modal from "../../components/Modal";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import TableEmptyState from "../../components/TableEmptyState";
import { tableActionButtonClasses } from "../../components/tableActionClasses";
import UiBadge from "../../components/ui/UiBadge";
import { cx, uiDataTableClass, uiTableContainerClass } from "../../components/ui/styles";
import { toolbarCompactInputClasses, toolbarCompactSelectClasses } from "../../components/toolbarControlClasses";
import { extractApiError } from "../../utils/apiError";
import {
  describeLifecycleActions,
  formatLifecycleFilter,
  getLifecycleRuleId,
  getLifecycleRuleStatus,
} from "./lifecycleDisplay";
import { useS3AccountContext } from "./S3AccountContext";

type StatusFilter = "all" | "with_rules" | "no_rules" | "unavailable";

type LifecycleInventoryRow = {
  bucketName: string;
  bucketStatus: "Configured" | "No rules" | "Unavailable";
  rule: Record<string, unknown> | null;
  ruleIndex: number;
  ruleId: string;
  ruleStatus: string;
  filterLabel: string;
  actionsLabel: string;
  error?: string | null;
};

type JsonModalState = {
  bucketName: string;
  ruleId: string;
  rule: Record<string, unknown>;
};

function bucketStatusTone(status: LifecycleInventoryRow["bucketStatus"]) {
  if (status === "Configured") return "success";
  if (status === "Unavailable") return "warning";
  return "neutral";
}

function ruleStatusTone(status: string) {
  return status === "Disabled" ? "neutral" : "success";
}

function buildRows(items: BucketLifecycleInventoryItem[]): LifecycleInventoryRow[] {
  return items
    .flatMap((item) => {
      if (item.error) {
        return [
          {
            bucketName: item.bucket_name,
            bucketStatus: "Unavailable" as const,
            rule: null,
            ruleIndex: -1,
            ruleId: "-",
            ruleStatus: "-",
            filterLabel: "-",
            actionsLabel: item.error,
            error: item.error,
          },
        ];
      }
      const rules = Array.isArray(item.rules) ? item.rules : [];
      if (rules.length === 0) {
        return [
          {
            bucketName: item.bucket_name,
            bucketStatus: "No rules" as const,
            rule: null,
            ruleIndex: -1,
            ruleId: "-",
            ruleStatus: "-",
            filterLabel: "-",
            actionsLabel: "No lifecycle rules configured",
          },
        ];
      }
      return rules.map((rule, index) => ({
        bucketName: item.bucket_name,
        bucketStatus: "Configured" as const,
        rule,
        ruleIndex: index,
        ruleId: getLifecycleRuleId(rule, index),
        ruleStatus: getLifecycleRuleStatus(rule),
        filterLabel: formatLifecycleFilter(rule),
        actionsLabel: describeLifecycleActions(rule),
      }));
    })
    .sort((left, right) => {
      const bucketOrder = left.bucketName.localeCompare(right.bucketName);
      if (bucketOrder !== 0) return bucketOrder;
      return left.ruleIndex - right.ruleIndex;
    });
}

function matchesStatus(row: LifecycleInventoryRow, statusFilter: StatusFilter) {
  if (statusFilter === "all") return true;
  if (statusFilter === "with_rules") return row.bucketStatus === "Configured";
  if (statusFilter === "no_rules") return row.bucketStatus === "No rules";
  return row.bucketStatus === "Unavailable";
}

function matchesSearch(row: LifecycleInventoryRow, query: string) {
  if (!query) return true;
  const haystack = [
    row.bucketName,
    row.bucketStatus,
    row.ruleId,
    row.ruleStatus,
    row.filterLabel,
    row.actionsLabel,
    row.rule ? JSON.stringify(row.rule) : "",
    row.error ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export default function ManagerLifecyclesPage() {
  const { accountIdForApi, requiresS3AccountSelection } = useS3AccountContext();
  const [items, setItems] = useState<BucketLifecycleInventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [jsonModal, setJsonModal] = useState<JsonModalState | null>(null);
  const needsS3AccountSelection = requiresS3AccountSelection && !accountIdForApi;

  const loadInventory = async () => {
    if (needsS3AccountSelection) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setItems(await listBucketLifecycles(accountIdForApi));
    } catch (err) {
      setItems([]);
      setError(extractApiError(err, "Unable to load lifecycle inventory."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadInventory();
  }, [accountIdForApi, needsS3AccountSelection]);

  const rows = useMemo(() => buildRows(items), [items]);
  const filteredRows = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return rows.filter((row) => matchesStatus(row, statusFilter) && matchesSearch(row, query));
  }, [filter, rows, statusFilter]);

  const configuredBucketCount = useMemo(
    () => items.filter((item) => !item.error && Array.isArray(item.rules) && item.rules.length > 0).length,
    [items]
  );
  const unavailableBucketCount = useMemo(() => items.filter((item) => Boolean(item.error)).length, [items]);
  const ruleCount = useMemo(
    () => items.reduce((count, item) => count + (Array.isArray(item.rules) ? item.rules.length : 0), 0),
    [items]
  );
  const colSpan = 8;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Lifecycles"
        description="Read-only lifecycle inventory across every bucket in the active manager context."
        breadcrumbs={[{ label: "Manager" }, { label: "Lifecycles" }]}
        actions={[{ label: "Refresh", onClick: loadInventory, variant: "ghost" }]}
      />

      {error && <PageBanner tone="error">{error}</PageBanner>}
      {unavailableBucketCount > 0 && (
        <PageBanner tone="warning">
          {unavailableBucketCount} bucket(s) could not return lifecycle details. Other buckets remain visible.
        </PageBanner>
      )}

      {needsS3AccountSelection ? (
        <PageEmptyState
          title="Select an account before reviewing lifecycles"
          description="The lifecycle inventory uses the active manager execution context and stays disabled until one is selected."
          primaryAction={{ label: "Open dashboard", to: "/manager" }}
          secondaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : (
        <div className="ui-surface-card">
          <ListToolbar
            title="Bucket lifecycles"
            description="All buckets are listed, including buckets with no lifecycle rules."
            countLabel={`${items.length} bucket(s) · ${ruleCount} rule(s) · ${configuredBucketCount} configured`}
            search={
              <div className="flex items-center gap-2 sm:justify-end">
                <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Search
                </span>
                <input
                  type="text"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Bucket, rule, filter"
                  className={`${toolbarCompactInputClasses} w-full sm:w-64 md:w-72`}
                />
              </div>
            }
            filters={
              <label className="flex items-center gap-2 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Status
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                  className={toolbarCompactSelectClasses}
                >
                  <option value="all">All</option>
                  <option value="with_rules">With rules</option>
                  <option value="no_rules">No rules</option>
                  <option value="unavailable">Unavailable</option>
                </select>
              </label>
            }
          />
          <div className={cx(uiTableContainerClass, "rounded-t-none border-x-0 border-b-0")}>
            <table className={cx(uiDataTableClass, "min-w-[980px]")}>
              <thead>
                <tr>
                  <th>Bucket</th>
                  <th>Bucket status</th>
                  <th>Rule ID</th>
                  <th>Rule status</th>
                  <th>Filter</th>
                  <th>Actions summary</th>
                  <th className="text-right">JSON</th>
                  <th className="text-right">Configure</th>
                </tr>
              </thead>
              <tbody>
                {loading && <TableEmptyState colSpan={colSpan} message="Loading lifecycle inventory..." />}
                {!loading && !error && filteredRows.length === 0 && (
                  <TableEmptyState colSpan={colSpan} message={rows.length === 0 ? "No buckets." : "No lifecycle rows match the filters."} />
                )}
                {!loading &&
                  filteredRows.map((row) => (
                    <tr key={`${row.bucketName}-${row.ruleId}-${row.ruleIndex}`}>
                      <td className="font-semibold text-slate-900 dark:text-slate-100">
                        <Link
                          to={`/manager/buckets/${encodeURIComponent(row.bucketName)}`}
                          className="hover:text-primary-700 dark:hover:text-primary-200"
                        >
                          {row.bucketName}
                        </Link>
                      </td>
                      <td>
                        <UiBadge tone={bucketStatusTone(row.bucketStatus)}>{row.bucketStatus}</UiBadge>
                      </td>
                      <td>{row.ruleId}</td>
                      <td>
                        {row.rule ? <UiBadge tone={ruleStatusTone(row.ruleStatus)}>{row.ruleStatus}</UiBadge> : "-"}
                      </td>
                      <td>{row.filterLabel}</td>
                      <td className={row.error ? "font-semibold text-amber-700 dark:text-amber-200" : undefined}>
                        {row.actionsLabel}
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          className={tableActionButtonClasses}
                          disabled={!row.rule}
                          onClick={() =>
                            row.rule &&
                            setJsonModal({
                              bucketName: row.bucketName,
                              ruleId: row.ruleId,
                              rule: row.rule,
                            })
                          }
                        >
                          View JSON
                        </button>
                      </td>
                      <td className="text-right">
                        <Link to={`/manager/buckets/${encodeURIComponent(row.bucketName)}`} className={tableActionButtonClasses}>
                          Configure
                        </Link>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {jsonModal && (
        <Modal
          title={`Lifecycle rule JSON · ${jsonModal.bucketName}`}
          onClose={() => setJsonModal(null)}
          maxWidthClass="max-w-3xl"
        >
          <div className="space-y-3">
            <p className="ui-caption text-slate-500 dark:text-slate-400">
              Rule: <span className="font-semibold text-slate-700 dark:text-slate-100">{jsonModal.ruleId}</span>
            </p>
            <pre className="max-h-[52vh] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono ui-caption text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
              {JSON.stringify(jsonModal.rule, null, 2)}
            </pre>
          </div>
        </Modal>
      )}
    </div>
  );
}
