/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import ListPageSection from "../../components/list/ListPageSection";
import Modal from "../../components/Modal";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import PageShell from "../../components/PageShell";
import UiSegmentedControl from "../../components/ui/UiSegmentedControl";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import {
  FeatureRuleFeature,
  FeatureRuleInventoryBucket,
  FeatureRuleInventoryRule,
  FeatureRuleInventoryStatus,
  listFeatureRuleInventory,
} from "../../api/managerBuckets";
import { S3AccountSelector } from "../../api/accountParams";
import { extractApiError } from "../../utils/apiError";
import { useS3AccountContext } from "./S3AccountContext";
import FeatureRulesTable from "./FeatureRulesTable";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";

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

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "configured", label: "Configured" },
  { value: "empty", label: "Empty" },
  { value: "unavailable", label: "Unavailable" },
];

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
  const tableStatus = resolveListTableStatus({
    loading,
    rowCount: filteredItems.length,
  });

  const configuredCount = items.filter((item) => item.status === "configured").length;
  const ruleCount = items.reduce((sum, item) => sum + item.rules.length, 0);
  const selectedFeatureLabel = FEATURE_OPTIONS.find((option) => option.id === feature)?.label ?? "Feature";
  const selectedItemLabel = feature === "tags" ? "tag(s)" : "rule(s)";
  const emptyRulesLabel = feature === "tags" ? "No tags" : "No rules";
  const readErrorFallback = feature === "tags" ? "Unable to read tags" : "Unable to read rules";

  return (
    <PageShell
      title="Feature rule inventory"
      description="Read-only inventory of bucket feature rules and tags in the active manager context."
      breadcrumbs={managerPageBreadcrumbs("feature-rules")}
    >
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
        <ListPageSection
            title="Feature rules"
            showHeading
            countLabel={`${filteredItems.length} bucket(s) · ${ruleCount} ${selectedItemLabel} · ${configuredCount} configured`}
            search={
              <UiInput
                label="Search"
                type="search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Bucket, rule, tag"
                fieldClassName="w-full sm:w-64"
                size="compact"
              />
            }
            filters={
              <>
                <UiSelect
                  label="Feature"
                  value={feature}
                  onChange={(event) => setFeature(event.target.value as FeatureRuleFeature)}
                  size="compact"
                >
                  {FEATURE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id} disabled={option.id === "notifications" && !snsFeatureEnabled}>
                      {option.label}
                    </option>
                  ))}
                </UiSelect>
                <UiSegmentedControl
                  ariaLabel="Status"
                  options={STATUS_OPTIONS}
                  value={statusFilterValue}
                  onChange={setStatusFilterValue}
                />
              </>
            }
        >

          <FeatureRulesTable
            emptyMessage="No buckets match the current filters."
            emptyRulesLabel={emptyRulesLabel}
            errorMessage="Unable to load buckets."
            feature={feature}
            featureLabel={selectedFeatureLabel}
            items={filteredItems}
            itemLabel={selectedItemLabel}
            loadingMessage={`Loading ${selectedFeatureLabel.toLowerCase()}...`}
            onOpenRule={(bucketName, rule) => setSelectedRule({ bucketName, rule })}
            readErrorFallback={readErrorFallback}
            status={tableStatus}
          />
        </ListPageSection>
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
    </PageShell>
  );
}
