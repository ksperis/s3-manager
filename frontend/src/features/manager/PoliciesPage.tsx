/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useS3AccountContext } from "./S3AccountContext";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import { S3AccountSelector } from "../../api/accountParams";
import { IamPolicy, createIamPolicy, listIamPolicies } from "../../api/managerIamPolicies";
import ListPageSection from "../../components/list/ListPageSection";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import WorkflowPage, { workflowPageHostClass } from "../../components/WorkflowPage";
import { extractApiError } from "../../utils/apiError";
import { stableSignature } from "../../utils/stableSignature";
import ManagerToolbarSearch from "./ManagerToolbarSearch";

const DEFAULT_POLICY_DOCUMENT = JSON.stringify(
  {
    Version: "2012-10-17",
    Statement: [],
  },
  null,
  2
);

const policyTableColumns: Array<DataTableColumn<IamPolicy>> = [
  { id: "name", label: "Name", primary: true, mobileRole: "primary", render: (policy) => policy.name },
  { id: "arn", label: "ARN", render: (policy) => policy.arn },
  { id: "version", label: "Version", render: (policy) => policy.default_version_id ?? "-" },
];

const extractError = (err: unknown): string => extractApiError(err, "Unexpected error");

export default function PoliciesPage() {
  const { selectedS3AccountType, accountIdForApi, requiresS3AccountSelection, accessMode } = useS3AccountContext();
  const needsS3AccountSelection = requiresS3AccountSelection && !accountIdForApi;
  const isS3User = selectedS3AccountType === "s3_user";
  const [policies, setPolicies] = useState<IamPolicy[]>([]);
  const [policyFilter, setPolicyFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancedName, setAdvancedName] = useState("");
  const [documentText, setDocumentText] = useState(DEFAULT_POLICY_DOCUMENT);
  const [showAdvancedModal, setShowAdvancedModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [advancedInitialSignature, setAdvancedInitialSignature] = useState(() =>
    stableSignature({ advancedName: "", documentText: DEFAULT_POLICY_DOCUMENT })
  );

  const load = useCallback(async (accountId: S3AccountSelector) => {
    setLoading(true);
    setError(null);
    try {
      const data = await listIamPolicies(accountId);
      setPolicies(data);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (needsS3AccountSelection) {
      setPolicies([]);
      setLoading(false);
      return;
    }
    load(accountIdForApi);
  }, [accountIdForApi, needsS3AccountSelection, accessMode, load]);

  const handleAdvancedCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (needsS3AccountSelection || !advancedName.trim()) return;
    let parsedDoc: Record<string, unknown>;
    try {
      parsedDoc = JSON.parse(documentText);
    } catch {
      setError("Policy document must be valid JSON.");
      return;
    }
    setCreating(true);
    setError(null);
    setActionMessage(null);
    try {
      await createIamPolicy(accountIdForApi, advancedName.trim(), parsedDoc);
      setAdvancedName("");
      setDocumentText(DEFAULT_POLICY_DOCUMENT);
      setShowAdvancedModal(false);
      setActionMessage("Policy created");
      await load(accountIdForApi);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setCreating(false);
    }
  };

  const openAdvancedModal = () => {
    setError(null);
    setAdvancedInitialSignature(stableSignature({ advancedName, documentText }));
    setShowAdvancedModal(true);
  };

  const closeAdvancedModal = () => {
    setShowAdvancedModal(false);
    setAdvancedName("");
    setDocumentText(DEFAULT_POLICY_DOCUMENT);
    setAdvancedInitialSignature(stableSignature({ advancedName: "", documentText: DEFAULT_POLICY_DOCUMENT }));
  };

  const advancedCurrentSignature = useMemo(
    () => stableSignature({ advancedName, documentText }),
    [advancedName, documentText]
  );
  const advancedCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showAdvancedModal && advancedCurrentSignature !== advancedInitialSignature,
    onClose: closeAdvancedModal,
    disabled: creating,
  });

  const filteredPolicies = policies.filter((policy) => {
    const needle = policyFilter.trim().toLowerCase();
    if (!needle) return true;
    return policy.name.toLowerCase().includes(needle) || policy.arn.toLowerCase().includes(needle);
  });
  const filteredTableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: filteredPolicies.length,
  });

  return (
    <div className={workflowPageHostClass(showAdvancedModal)}>
      <PageHeader
        title="IAM Policies"
        description="List and create Ceph IAM policies for the selected account."
        breadcrumbs={managerPageBreadcrumbs("policies")}
        actions={
          !needsS3AccountSelection && !isS3User
            ? [
                {
                  label: "Create policy",
                  onClick: openAdvancedModal,
                },
              ]
            : []
        }
      />

      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {error && <PageBanner tone="error">{error}</PageBanner>}

      {needsS3AccountSelection ? (
        <PageEmptyState
          title="Select an account before managing IAM policies"
          description="Policies are created inside an execution context. Choose an account to list, create, and attach managed IAM policies."
          primaryAction={{ label: "Open users", to: "/manager/users" }}
          tone="warning"
        />
      ) : isS3User ? (
        <PageEmptyState
          title="IAM policies are unavailable for managed S3 user contexts"
          description="Switch to an RGW account or S3 connection context to manage reusable IAM policies."
          primaryAction={{ label: "Open users", to: "/manager/users" }}
          tone="warning"
        />
      ) : (
        <ListPageSection
            title="Policies"
            description="Managed IAM policies available in the selected execution context."
            countLabel={`${filteredPolicies.length} result(s)`}
            search={
              <ManagerToolbarSearch
                value={policyFilter}
                onChange={setPolicyFilter}
                placeholder="Search by name or ARN"
              />
            }
        >
          <DataTableShell
            columns={policyTableColumns}
            rows={filteredPolicies}
            rowKey={(policy) => policy.arn}
            status={filteredTableStatus}
            loadingMessage="Loading policies..."
            errorMessage="Unable to load policies."
            emptyMessage="No policies."
            responsiveCards
            tableLayout="fixed"
          />
        </ListPageSection>
      )}

      {showAdvancedModal && (
        <WorkflowPage
          title="Create IAM policy"
          description="Name the policy and edit its complete JSON document with page-level space."
          breadcrumbs={managerPageBreadcrumbs("policies", { label: "Create" })}
          backLabel="Back to policies"
          onBack={advancedCloseGuard.requestClose}
          width="standard"
        >
          {error && <PageBanner tone="error">{error}</PageBanner>}
          <form className="space-y-4" onSubmit={handleAdvancedCreate}>
            <div className="flex flex-col gap-2">
              <label className="ui-body font-semibold text-slate-700 dark:text-slate-200">Policy name</label>
              <input
                type="text"
                value={advancedName}
                onChange={(e) => setAdvancedName(e.target.value)}
                placeholder="Policy name"
                className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="ui-body font-semibold text-slate-700 dark:text-slate-200">Policy document (JSON)</label>
              <textarea
                value={documentText}
                onChange={(e) => setDocumentText(e.target.value)}
                className="min-h-[200px] rounded-md border border-slate-200 px-3 py-2 ui-body font-mono focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                spellCheck={false}
              />
              <p className="ui-caption text-slate-500 dark:text-slate-400">
                Provide a valid IAM policy JSON document. You can start from the default template and customize statements.
              </p>
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={advancedCloseGuard.requestClose}
                className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={needsS3AccountSelection || creating}
                className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
              >
                {creating ? "Creating..." : "Create policy"}
              </button>
            </div>
          </form>
          {advancedCloseGuard.confirmationDialog}
        </WorkflowPage>
      )}
    </div>
  );
}
