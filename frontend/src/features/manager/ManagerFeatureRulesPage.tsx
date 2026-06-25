/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ListToolbar from "../../components/ListToolbar";
import Modal from "../../components/Modal";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import PropertySummaryChip from "../../components/PropertySummaryChip";
import TableEmptyState from "../../components/TableEmptyState";
import ManagerTable, {
  managerTableActionCellClass,
  managerTableCellClass,
  managerTableErrorCellClass,
  managerTableMutedCellClass,
  managerTableMutedRowClass,
  managerTablePrimaryCellClass,
  managerTableWideCellClass,
} from "../../components/list/ManagerTable";
import { tableActionButtonClasses } from "../../components/tableActionClasses";
import { toolbarCompactInputClasses } from "../../components/toolbarControlClasses";
import {
  FeatureRuleFeature,
  FeatureRuleInventoryBucket,
  FeatureRuleInventoryRule,
  FeatureRuleInventoryStatus,
  listFeatureRuleInventory,
} from "../../api/buckets";
import { S3AccountSelector } from "../../api/accountParams";
import { extractApiError } from "../../utils/apiError";
import { useS3AccountContext } from "./S3AccountContext";

type StatusFilter = "all" | FeatureRuleInventoryStatus;

type SelectedRule = {
  bucketName: string;
  rule: FeatureRuleInventoryRule;
};

const FEATURE_OPTIONS: Array<{ id: FeatureRuleFeature; label: string }> = [
  { id: "lifecycle", label: "Lifecycle" },
  { id: "policy", label: "Bucket policy" },
  { id: "cors", label: "CORS" },
  { id: "notifications", label: "Notifications" },
  { id: "tags", label: "Bucket tags" },
];

const STATUS_OPTIONS: Array<{ id: StatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "configured", label: "Configured" },
  { id: "empty", label: "Empty" },
  { id: "unavailable", label: "Unavailable" },
];

const statusTone: Record<FeatureRuleInventoryStatus, "active" | "inactive" | "unknown"> = {
  configured: "active",
  empty: "inactive",
  unavailable: "unknown",
};

const statusLabel: Record<FeatureRuleInventoryStatus, string> = {
  configured: "Configured",
  empty: "No rules",
  unavailable: "Unavailable",
};

function extractError(err: unknown): string {
  return extractApiError(err, "Unexpected error");
}

function ruleSearchText(row: FeatureRuleInventoryBucket): string {
  return [
    row.bucket_name,
    row.status,
    row.error ?? "",
    ...row.rules.flatMap((rule) => [rule.id, rule.type, rule.title, rule.summary, ...rule.chips]),
  ]
    .join(" ")
    .toLowerCase();
}

export default function ManagerFeatureRulesPage() {
  const { accounts, selectedS3AccountId, requiresS3AccountSelection, accountIdForApi } = useS3AccountContext();
  const [feature, setFeature] = useState<FeatureRuleFeature>("lifecycle");
  const [statusFilterValue, setStatusFilterValue] = useState<StatusFilter>("all");
  const [filter, setFilter] = useState("");
  const [items, setItems] = useState<FeatureRuleInventoryBucket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRule, setSelectedRule] = useState<SelectedRule | null>(null);

  const selectedS3Account = useMemo(
    () => accounts.find((account) => account.id === selectedS3AccountId),
    [accounts, selectedS3AccountId]
  );
  const snsFeatureEnabled = selectedS3Account?.storage_endpoint_capabilities?.sns !== false;
  const needsS3AccountSelection = requiresS3AccountSelection && !accountIdForApi;

  useEffect(() => {
    if (feature === "notifications" && !snsFeatureEnabled) {
      setFeature("lifecycle");
    }
  }, [feature, snsFeatureEnabled]);

  useEffect(() => {
    let cancelled = false;
    async function load(accountId: S3AccountSelector) {
      setLoading(true);
      setError(null);
      try {
        const result = await listFeatureRuleInventory(accountId, feature);
        if (!cancelled) {
          setItems(result);
        }
      } catch (err) {
        if (!cancelled) {
          setError(extractError(err));
          setItems([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    if (needsS3AccountSelection) {
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }
    void load(accountIdForApi ?? null);
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, feature, needsS3AccountSelection]);

  const filteredItems = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilterValue !== "all" && item.status !== statusFilterValue) return false;
      if (!needle) return true;
      return ruleSearchText(item).includes(needle);
    });
  }, [filter, items, statusFilterValue]);

  const configuredCount = items.filter((item) => item.status === "configured").length;
  const ruleCount = items.reduce((sum, item) => sum + item.rules.length, 0);
  const selectedFeatureLabel = FEATURE_OPTIONS.find((option) => option.id === feature)?.label ?? "Feature";
  const selectedItemLabel = feature === "tags" ? "tag(s)" : "rule(s)";
  const emptyRulesLabel = feature === "tags" ? "No tags" : "No rules";
  const readErrorFallback = feature === "tags" ? "Unable to read tags" : "Unable to read rules";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Feature rule inventory"
        description="Read-only inventory of bucket feature rules and tags in the active manager context."
        breadcrumbs={[{ label: "Manager" }, { label: "Tools" }, { label: "Feature rules" }]}
      />

      {error && <PageBanner tone="error">{error}</PageBanner>}

      {needsS3AccountSelection ? (
        <PageEmptyState
          title="Select an account before inventorying feature rules"
          description="The rule inventory uses the selected manager execution context to read bucket configuration."
          primaryAction={{ label: "Open dashboard", to: "/manager" }}
          secondaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : (
        <div className="ui-surface-card">
          <ListToolbar
            title="Feature rules"
            countLabel={`${filteredItems.length} bucket(s) · ${ruleCount} ${selectedItemLabel} · ${configuredCount} configured`}
            search={
              <div className="flex items-center gap-2">
                <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Search
                </span>
                <input
                  type="text"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Bucket, rule, tag"
                  className={`${toolbarCompactInputClasses} w-full sm:w-64`}
                />
              </div>
            }
            filters={
              <>
                <label className="flex items-center gap-2 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Feature
                  <select
                    aria-label="Feature"
                    value={feature}
                    onChange={(event) => setFeature(event.target.value as FeatureRuleFeature)}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 ui-body normal-case tracking-normal text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    {FEATURE_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id} disabled={option.id === "notifications" && !snsFeatureEnabled}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex flex-wrap gap-1" role="group" aria-label="Status">
                  {STATUS_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setStatusFilterValue(option.id)}
                      className={`rounded-md border px-2.5 py-1 ui-caption font-semibold ${
                        statusFilterValue === option.id
                          ? "border-primary bg-primary text-white"
                          : "border-slate-200 text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-200"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </>
            }
          />

          <ManagerTable
            columns={[
              { key: "bucket", label: "Bucket" },
              { key: "status", label: "Status" },
              { key: "rule", label: feature === "tags" ? "Tag" : "Rule" },
              { key: "summary", label: feature === "tags" ? "Value" : "Summary" },
              { key: "json", label: "JSON", align: "right" },
            ]}
          >
            {loading ? (
              <TableEmptyState colSpan={5} message={`Loading ${selectedFeatureLabel.toLowerCase()}...`} />
            ) : filteredItems.length === 0 ? (
              <TableEmptyState colSpan={5} message="No buckets match the current filters." />
            ) : (
              filteredItems.flatMap((item) => {
                const bucketRow = (
                  <tr key={`${item.bucket_name}:bucket`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className={managerTablePrimaryCellClass}>
                      <Link
                        to={`/manager/buckets/${encodeURIComponent(item.bucket_name)}`}
                        className="hover:text-primary-700 dark:hover:text-primary-200"
                      >
                        {item.bucket_name}
                      </Link>
                    </td>
                    <td className={managerTableCellClass}>
                      <PropertySummaryChip compact state={statusLabel[item.status]} tone={statusTone[item.status]} />
                    </td>
                    <td className={managerTableMutedCellClass}>
                      {item.rules.length > 0 ? `${item.rules.length} ${selectedItemLabel}` : "-"}
                    </td>
                    <td className={managerTableMutedCellClass}>
                      {item.status === "unavailable" ? item.error || readErrorFallback : selectedFeatureLabel}
                    </td>
                    <td className={managerTableActionCellClass} />
                  </tr>
                );

                if (item.status === "empty") {
                  return [
                    bucketRow,
                    <tr key={`${item.bucket_name}:empty`} className={managerTableMutedRowClass}>
                      <td className={managerTableMutedCellClass} />
                      <td className={managerTableMutedCellClass} />
                      <td colSpan={3} className={managerTableMutedCellClass}>
                        {emptyRulesLabel}
                      </td>
                    </tr>,
                  ];
                }

                if (item.status === "unavailable") {
                  return [
                    bucketRow,
                    <tr key={`${item.bucket_name}:unavailable`} className={managerTableMutedRowClass}>
                      <td className={managerTableMutedCellClass} />
                      <td className={managerTableMutedCellClass} />
                      <td colSpan={3} className={managerTableErrorCellClass}>
                        {item.error || readErrorFallback}
                      </td>
                    </tr>,
                  ];
                }

                return [
                  bucketRow,
                  ...item.rules.map((rule) => (
                    <tr key={`${item.bucket_name}:${rule.type}:${rule.id}`} className={managerTableMutedRowClass}>
                      <td className={managerTableMutedCellClass} />
                      <td className={managerTableMutedCellClass} />
                      <td className={`${managerTableCellClass} max-w-xs font-semibold text-slate-800 dark:text-slate-100`}>
                        <div className="truncate" title={rule.title}>
                          {rule.title}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {rule.chips.slice(0, 3).map((chip) => (
                            <span
                              key={chip}
                              className="max-w-[12rem] truncate rounded-full bg-slate-100 px-2 py-0.5 ui-caption font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-200"
                              title={chip}
                            >
                              {chip}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className={`${managerTableWideCellClass} max-w-2xl text-slate-700 dark:text-slate-200`}>
                        <div className="truncate" title={rule.summary}>
                          {rule.summary}
                        </div>
                      </td>
                      <td className={managerTableActionCellClass}>
                        <button
                          type="button"
                          onClick={() => setSelectedRule({ bucketName: item.bucket_name, rule })}
                          className={tableActionButtonClasses}
                        >
                          JSON
                        </button>
                      </td>
                    </tr>
                  )),
                ];
              })
            )}
          </ManagerTable>
        </div>
      )}

      {selectedRule && (
        <Modal
          title={`${selectedRule.bucketName} / ${selectedRule.rule.title}`}
          onClose={() => setSelectedRule(null)}
          maxWidthClass="max-w-4xl"
          maxBodyHeightClass="max-h-[80vh]"
        >
          <pre className="overflow-x-auto rounded-md bg-slate-950 px-4 py-3 font-mono text-[12px] leading-5 text-slate-100">
            {JSON.stringify(selectedRule.rule.raw, null, 2)}
          </pre>
        </Modal>
      )}
    </div>
  );
}
