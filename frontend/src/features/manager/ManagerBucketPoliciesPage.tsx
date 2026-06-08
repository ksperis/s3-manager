/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listBucketPolicies, type BucketPolicyInventoryItem } from "../../api/buckets";
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
  describeBucketPolicyActions,
  formatBucketPolicyPrincipal,
  formatBucketPolicyResources,
  getBucketPolicyStatementEffect,
  getBucketPolicyStatementSid,
  getBucketPolicyStatements,
  hasBucketPolicyDocument,
} from "./bucketPolicyDisplay";
import { useS3AccountContext } from "./S3AccountContext";

type StatusFilter = "all" | "with_policy" | "no_policy" | "unavailable";

type BucketPolicyInventoryRow = {
  bucketName: string;
  policyStatus: "Configured" | "No policy" | "Unavailable";
  policy: Record<string, unknown> | null;
  statement: Record<string, unknown> | null;
  statementIndex: number;
  statementSid: string;
  effect: string;
  principalLabel: string;
  actionsLabel: string;
  error?: string | null;
};

type JsonModalState = {
  bucketName: string;
  statementSid: string;
  policy: Record<string, unknown>;
};

function policyStatusTone(status: BucketPolicyInventoryRow["policyStatus"]) {
  if (status === "Configured") return "success";
  if (status === "Unavailable") return "warning";
  return "neutral";
}

function effectTone(effect: string) {
  if (effect === "Allow") return "success";
  if (effect === "Deny") return "warning";
  return "neutral";
}

function buildRows(items: BucketPolicyInventoryItem[]): BucketPolicyInventoryRow[] {
  return items
    .flatMap((item) => {
      if (item.error) {
        return [
          {
            bucketName: item.bucket_name,
            policyStatus: "Unavailable" as const,
            policy: null,
            statement: null,
            statementIndex: -1,
            statementSid: "-",
            effect: "-",
            principalLabel: "-",
            actionsLabel: item.error,
            error: item.error,
          },
        ];
      }
      if (!hasBucketPolicyDocument(item.policy)) {
        return [
          {
            bucketName: item.bucket_name,
            policyStatus: "No policy" as const,
            policy: null,
            statement: null,
            statementIndex: -1,
            statementSid: "-",
            effect: "-",
            principalLabel: "-",
            actionsLabel: "No bucket policy configured",
          },
        ];
      }

      const statements = getBucketPolicyStatements(item.policy);
      if (statements.length === 0) {
        return [
          {
            bucketName: item.bucket_name,
            policyStatus: "Configured" as const,
            policy: item.policy,
            statement: null,
            statementIndex: -1,
            statementSid: "-",
            effect: "-",
            principalLabel: "-",
            actionsLabel: "Policy document has no statements",
          },
        ];
      }

      return statements.map((statement, index) => {
        const resourcesLabel = formatBucketPolicyResources(statement);
        return {
          bucketName: item.bucket_name,
          policyStatus: "Configured" as const,
          policy: item.policy,
          statement,
          statementIndex: index,
          statementSid: getBucketPolicyStatementSid(statement, index),
          effect: getBucketPolicyStatementEffect(statement),
          principalLabel: formatBucketPolicyPrincipal(statement),
          actionsLabel: [describeBucketPolicyActions(statement), resourcesLabel].filter(Boolean).join(" · "),
        };
      });
    })
    .sort((left, right) => {
      const bucketOrder = left.bucketName.localeCompare(right.bucketName);
      if (bucketOrder !== 0) return bucketOrder;
      return left.statementIndex - right.statementIndex;
    });
}

function matchesStatus(row: BucketPolicyInventoryRow, statusFilter: StatusFilter) {
  if (statusFilter === "all") return true;
  if (statusFilter === "with_policy") return row.policyStatus === "Configured";
  if (statusFilter === "no_policy") return row.policyStatus === "No policy";
  return row.policyStatus === "Unavailable";
}

function matchesSearch(row: BucketPolicyInventoryRow, query: string) {
  if (!query) return true;
  const haystack = [
    row.bucketName,
    row.policyStatus,
    row.statementSid,
    row.effect,
    row.principalLabel,
    row.actionsLabel,
    row.policy ? JSON.stringify(row.policy) : "",
    row.statement ? JSON.stringify(row.statement) : "",
    row.error ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export default function ManagerBucketPoliciesPage() {
  const { accountIdForApi, requiresS3AccountSelection } = useS3AccountContext();
  const [items, setItems] = useState<BucketPolicyInventoryItem[]>([]);
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
      setItems(await listBucketPolicies(accountIdForApi));
    } catch (err) {
      setItems([]);
      setError(extractApiError(err, "Unable to load bucket policy inventory."));
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
    () => items.filter((item) => !item.error && hasBucketPolicyDocument(item.policy)).length,
    [items]
  );
  const unavailableBucketCount = useMemo(() => items.filter((item) => Boolean(item.error)).length, [items]);
  const statementCount = useMemo(
    () => items.reduce((count, item) => count + getBucketPolicyStatements(item.policy).length, 0),
    [items]
  );
  const colSpan = 8;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bucket policies"
        description="Read-only bucket policy inventory across every bucket in the active manager context."
        breadcrumbs={[{ label: "Manager" }, { label: "Bucket policies" }]}
        actions={[{ label: "Refresh", onClick: loadInventory, variant: "ghost" }]}
      />

      {error && <PageBanner tone="error">{error}</PageBanner>}
      {unavailableBucketCount > 0 && (
        <PageBanner tone="warning">
          {unavailableBucketCount} bucket(s) could not return bucket policy details. Other buckets remain visible.
        </PageBanner>
      )}

      {needsS3AccountSelection ? (
        <PageEmptyState
          title="Select an account before reviewing bucket policies"
          description="The bucket policy inventory uses the active manager execution context and stays disabled until one is selected."
          primaryAction={{ label: "Open dashboard", to: "/manager" }}
          secondaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : (
        <div className="ui-surface-card">
          <ListToolbar
            title="Bucket policies"
            description="All buckets are listed, including buckets with no bucket policy."
            countLabel={`${items.length} bucket(s) · ${statementCount} statement(s) · ${configuredBucketCount} configured`}
            search={
              <div className="flex items-center gap-2 sm:justify-end">
                <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Search
                </span>
                <input
                  type="text"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Bucket, statement, action"
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
                  <option value="with_policy">With policy</option>
                  <option value="no_policy">No policy</option>
                  <option value="unavailable">Unavailable</option>
                </select>
              </label>
            }
          />
          <div className={cx(uiTableContainerClass, "rounded-t-none border-x-0 border-b-0")}>
            <table className={cx(uiDataTableClass, "min-w-[1080px]")}>
              <thead>
                <tr>
                  <th>Bucket</th>
                  <th>Policy status</th>
                  <th>Statement SID</th>
                  <th>Effect</th>
                  <th>Principal</th>
                  <th>Actions summary</th>
                  <th className="text-right">JSON</th>
                  <th className="text-right">Configure</th>
                </tr>
              </thead>
              <tbody>
                {loading && <TableEmptyState colSpan={colSpan} message="Loading bucket policy inventory..." />}
                {!loading && !error && filteredRows.length === 0 && (
                  <TableEmptyState
                    colSpan={colSpan}
                    message={rows.length === 0 ? "No buckets." : "No bucket policy rows match the filters."}
                  />
                )}
                {!loading &&
                  filteredRows.map((row) => (
                    <tr key={`${row.bucketName}-${row.statementSid}-${row.statementIndex}`}>
                      <td className="font-semibold text-slate-900 dark:text-slate-100">
                        <Link
                          to={`/manager/buckets/${encodeURIComponent(row.bucketName)}`}
                          className="hover:text-primary-700 dark:hover:text-primary-200"
                        >
                          {row.bucketName}
                        </Link>
                      </td>
                      <td>
                        <UiBadge tone={policyStatusTone(row.policyStatus)}>{row.policyStatus}</UiBadge>
                      </td>
                      <td>{row.statementSid}</td>
                      <td>{row.effect !== "-" ? <UiBadge tone={effectTone(row.effect)}>{row.effect}</UiBadge> : "-"}</td>
                      <td className="max-w-[260px] truncate" title={row.principalLabel}>
                        {row.principalLabel}
                      </td>
                      <td
                        className={row.error ? "font-semibold text-amber-700 dark:text-amber-200" : undefined}
                        title={row.actionsLabel}
                      >
                        {row.actionsLabel}
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          className={tableActionButtonClasses}
                          disabled={!row.policy}
                          onClick={() =>
                            row.policy &&
                            setJsonModal({
                              bucketName: row.bucketName,
                              statementSid: row.statementSid,
                              policy: row.policy,
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
          title={`Bucket policy JSON · ${jsonModal.bucketName}`}
          onClose={() => setJsonModal(null)}
          maxWidthClass="max-w-3xl"
        >
          <div className="space-y-3">
            <p className="ui-caption text-slate-500 dark:text-slate-400">
              Statement: <span className="font-semibold text-slate-700 dark:text-slate-100">{jsonModal.statementSid}</span>
            </p>
            <pre className="max-h-[52vh] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono ui-caption text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
              {JSON.stringify(jsonModal.policy, null, 2)}
            </pre>
          </div>
        </Modal>
      )}
    </div>
  );
}
