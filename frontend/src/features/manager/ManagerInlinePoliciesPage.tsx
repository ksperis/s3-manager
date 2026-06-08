/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listIamInlinePolicyInventory, type InlinePolicyInventoryItem } from "../../api/managerIamPolicies";
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
import { summarizeInlinePolicyDocument } from "./inlinePolicySummary";
import { useS3AccountContext } from "./S3AccountContext";

type StatusFilter = "all" | "with_policies" | "no_policies" | "unavailable";
type EntityTypeFilter = "all" | "user" | "group" | "role";

type InlinePolicyInventoryRow = {
  entityType: "user" | "group" | "role";
  entityName: string;
  entityStatus: "Configured" | "No inline policies" | "Unavailable";
  policyName: string;
  document: Record<string, unknown> | null;
  policyIndex: number;
  summary: string;
  error?: string | null;
};

type JsonModalState = {
  entityLabel: string;
  policyName: string;
  document: Record<string, unknown>;
};

const ENTITY_LABELS: Record<InlinePolicyInventoryRow["entityType"], string> = {
  user: "User",
  group: "Group",
  role: "Role",
};

const ENTITY_ROUTES: Record<InlinePolicyInventoryRow["entityType"], string> = {
  user: "users",
  group: "groups",
  role: "roles",
};

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function entityStatusTone(status: InlinePolicyInventoryRow["entityStatus"]) {
  if (status === "Configured") return "success";
  if (status === "Unavailable") return "warning";
  return "neutral";
}

function buildManagePath(entityType: InlinePolicyInventoryRow["entityType"], entityName: string) {
  return `/manager/${ENTITY_ROUTES[entityType]}/${encodeURIComponent(entityName)}/policies`;
}

function buildRows(items: InlinePolicyInventoryItem[]): InlinePolicyInventoryRow[] {
  return items
    .flatMap((item) => {
      if (item.error) {
        return [
          {
            entityType: item.entity_type,
            entityName: item.entity_name,
            entityStatus: "Unavailable" as const,
            policyName: "-",
            document: null,
            policyIndex: -1,
            summary: item.error,
            error: item.error,
          },
        ];
      }
      const policies = Array.isArray(item.policies) ? item.policies : [];
      if (policies.length === 0) {
        return [
          {
            entityType: item.entity_type,
            entityName: item.entity_name,
            entityStatus: "No inline policies" as const,
            policyName: "-",
            document: null,
            policyIndex: -1,
            summary: "No inline policies configured",
          },
        ];
      }
      return policies.map((policy, index) => ({
        entityType: item.entity_type,
        entityName: item.entity_name,
        entityStatus: "Configured" as const,
        policyName: policy.name,
        document: policy.document,
        policyIndex: index,
        summary: summarizeInlinePolicyDocument(policy.document),
      }));
    })
    .sort((left, right) => {
      const typeOrder = left.entityType.localeCompare(right.entityType);
      if (typeOrder !== 0) return typeOrder;
      const entityOrder = left.entityName.localeCompare(right.entityName);
      if (entityOrder !== 0) return entityOrder;
      return left.policyIndex - right.policyIndex;
    });
}

function matchesStatus(row: InlinePolicyInventoryRow, statusFilter: StatusFilter) {
  if (statusFilter === "all") return true;
  if (statusFilter === "with_policies") return row.entityStatus === "Configured";
  if (statusFilter === "no_policies") return row.entityStatus === "No inline policies";
  return row.entityStatus === "Unavailable";
}

function matchesType(row: InlinePolicyInventoryRow, typeFilter: EntityTypeFilter) {
  return typeFilter === "all" || row.entityType === typeFilter;
}

function matchesSearch(row: InlinePolicyInventoryRow, query: string) {
  if (!query) return true;
  const haystack = [
    row.entityName,
    row.entityType,
    ENTITY_LABELS[row.entityType],
    row.entityStatus,
    row.policyName,
    row.summary,
    row.document ? JSON.stringify(row.document) : "",
    row.error ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export default function ManagerInlinePoliciesPage() {
  const { accountIdForApi, requiresS3AccountSelection } = useS3AccountContext();
  const [items, setItems] = useState<InlinePolicyInventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<EntityTypeFilter>("all");
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
      setItems(await listIamInlinePolicyInventory(accountIdForApi));
    } catch (err) {
      setItems([]);
      setError(extractApiError(err, "Unable to load inline policy inventory."));
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
    return rows.filter((row) => matchesType(row, typeFilter) && matchesStatus(row, statusFilter) && matchesSearch(row, query));
  }, [filter, rows, statusFilter, typeFilter]);

  const configuredEntityCount = useMemo(
    () => items.filter((item) => !item.error && Array.isArray(item.policies) && item.policies.length > 0).length,
    [items]
  );
  const unavailableEntityCount = useMemo(() => items.filter((item) => Boolean(item.error)).length, [items]);
  const policyCount = useMemo(
    () => items.reduce((count, item) => count + (Array.isArray(item.policies) ? item.policies.length : 0), 0),
    [items]
  );
  const colSpan = 7;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inline policies"
        description="Read-only IAM inline policy inventory across every user, group, and role in the active manager context."
        breadcrumbs={[{ label: "Manager" }, { label: "IAM" }, { label: "Inline policies" }]}
        actions={[{ label: "Refresh", onClick: loadInventory, variant: "ghost" }]}
      />

      {error && <PageBanner tone="error">{error}</PageBanner>}
      {unavailableEntityCount > 0 && (
        <PageBanner tone="warning">
          {pluralize(unavailableEntityCount, "IAM entity", "IAM entities")} could not return inline policy details. Other entities remain visible.
        </PageBanner>
      )}

      {needsS3AccountSelection ? (
        <PageEmptyState
          title="Select an account before reviewing inline policies"
          description="The inline policy inventory uses the active manager execution context and stays disabled until one is selected."
          primaryAction={{ label: "Open dashboard", to: "/manager" }}
          secondaryAction={{ label: "Open IAM users", to: "/manager/users" }}
          tone="warning"
        />
      ) : (
        <div className="ui-surface-card">
          <ListToolbar
            title="IAM inline policies"
            description="Users, groups, and roles are listed, including entities with no inline policies."
            showHeading={false}
            countLabel={`${pluralize(items.length, "entity", "entities")} - ${pluralize(policyCount, "inline policy", "inline policies")} - ${configuredEntityCount} configured`}
            search={
              <div className="flex items-center gap-2 sm:justify-end">
                <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Search
                </span>
                <input
                  type="text"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Entity, policy, JSON"
                  className={`${toolbarCompactInputClasses} w-full sm:w-64 md:w-72`}
                />
              </div>
            }
            filters={
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Type
                  <select
                    value={typeFilter}
                    onChange={(event) => setTypeFilter(event.target.value as EntityTypeFilter)}
                    className={toolbarCompactSelectClasses}
                  >
                    <option value="all">All</option>
                    <option value="user">Users</option>
                    <option value="group">Groups</option>
                    <option value="role">Roles</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Status
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                    className={toolbarCompactSelectClasses}
                  >
                    <option value="all">All</option>
                    <option value="with_policies">With policies</option>
                    <option value="no_policies">No policies</option>
                    <option value="unavailable">Unavailable</option>
                  </select>
                </label>
              </div>
            }
          />
          <div className={cx(uiTableContainerClass, "rounded-t-none border-x-0 border-b-0")}>
            <table className={cx(uiDataTableClass, "min-w-[980px]")}>
              <thead>
                <tr>
                  <th>Entity</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Policy name</th>
                  <th>Summary</th>
                  <th className="text-right">JSON</th>
                  <th className="text-right">Manage</th>
                </tr>
              </thead>
              <tbody>
                {loading && <TableEmptyState colSpan={colSpan} message="Loading inline policy inventory..." />}
                {!loading && !error && filteredRows.length === 0 && (
                  <TableEmptyState
                    colSpan={colSpan}
                    message={rows.length === 0 ? "No IAM entities." : "No inline policy rows match the filters."}
                  />
                )}
                {!loading &&
                  filteredRows.map((row) => (
                    <tr key={`${row.entityType}-${row.entityName}-${row.policyName}-${row.policyIndex}`}>
                      <td className="font-semibold text-slate-900 dark:text-slate-100">
                        <Link to={buildManagePath(row.entityType, row.entityName)} className="hover:text-primary-700 dark:hover:text-primary-200">
                          {row.entityName}
                        </Link>
                      </td>
                      <td>
                        <UiBadge tone="info">{ENTITY_LABELS[row.entityType]}</UiBadge>
                      </td>
                      <td>
                        <UiBadge tone={entityStatusTone(row.entityStatus)}>{row.entityStatus}</UiBadge>
                      </td>
                      <td>{row.policyName}</td>
                      <td
                        className={row.error ? "font-semibold text-amber-700 dark:text-amber-200" : undefined}
                        title={row.summary}
                      >
                        {row.summary}
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          className={tableActionButtonClasses}
                          disabled={!row.document}
                          onClick={() =>
                            row.document &&
                            setJsonModal({
                              entityLabel: `${ENTITY_LABELS[row.entityType]} ${row.entityName}`,
                              policyName: row.policyName,
                              document: row.document,
                            })
                          }
                        >
                          View JSON
                        </button>
                      </td>
                      <td className="text-right">
                        <Link to={buildManagePath(row.entityType, row.entityName)} className={tableActionButtonClasses}>
                          Manage
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
          title={`Inline policy JSON - ${jsonModal.entityLabel}`}
          onClose={() => setJsonModal(null)}
          maxWidthClass="max-w-3xl"
        >
          <div className="space-y-3">
            <p className="ui-caption text-slate-500 dark:text-slate-400">
              Policy: <span className="font-semibold text-slate-700 dark:text-slate-100">{jsonModal.policyName}</span>
            </p>
            <pre className="max-h-[52vh] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono ui-caption text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
              {JSON.stringify(jsonModal.document, null, 2)}
            </pre>
          </div>
        </Modal>
      )}
    </div>
  );
}
