/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useEffect, useState } from "react";
import axios from "axios";
import { useS3AccountContext } from "./S3AccountContext";
import { S3AccountSelector } from "../../api/accountParams";
import { IamPolicy, createIamPolicy, listIamPolicies } from "../../api/managerIamPolicies";
import ListToolbar from "../../components/ListToolbar";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import TableEmptyState from "../../components/TableEmptyState";
import WorkspaceContextStrip from "../../components/WorkspaceContextStrip";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import Modal from "../../components/Modal";
import useManagerWorkspaceContextStrip from "./useManagerWorkspaceContextStrip";

const DEFAULT_POLICY_DOCUMENT = JSON.stringify(
  {
    Version: "2012-10-17",
    Statement: [],
  },
  null,
  2
);

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
  const contextStrip = useManagerWorkspaceContextStrip({
    description: "Managed IAM policies are scoped to the active execution context and reused across users, groups, and roles.",
  });

  const extractError = (err: unknown): string => {
    if (axios.isAxiosError(err)) {
      return (
        (err.response?.data as { detail?: string })?.detail ||
        err.message ||
        "Unexpected error"
      );
    }
    return err instanceof Error ? err.message : "Unexpected error";
  };

  const load = async (accountId: S3AccountSelector) => {
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
  };

  useEffect(() => {
    if (needsS3AccountSelection) {
      setPolicies([]);
      setLoading(false);
      return;
    }
    load(accountIdForApi);
  }, [accountIdForApi, needsS3AccountSelection, accessMode]);

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
    setShowAdvancedModal(true);
  };

  const closeAdvancedModal = () => {
    setShowAdvancedModal(false);
  };

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
    <div className="space-y-4">
      <PageHeader
        title="IAM Policies"
        description="List and create Ceph IAM policies for the selected account."
        breadcrumbs={[{ label: "Manager" }, { label: "IAM" }, { label: "Policies" }]}
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
      <WorkspaceContextStrip {...contextStrip} />

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
        <div className="ui-surface-card">
          <ListToolbar
            title="Policies"
            description="Managed IAM policies available in the selected execution context."
            countLabel={`${filteredPolicies.length} result(s)`}
            search={
              <input
                type="text"
                value={policyFilter}
                onChange={(e) => setPolicyFilter(e.target.value)}
                placeholder="Search by name or ARN"
                className="w-full rounded-md border border-slate-200 px-3 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 sm:w-72 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            }
          />
          <table className="manager-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr>
                <th className="px-6 py-3 text-left ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Name</th>
                <th className="px-6 py-3 text-left ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">ARN</th>
                <th className="px-6 py-3 text-left ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Version</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {filteredTableStatus === "loading" && <TableEmptyState colSpan={3} message="Loading policies..." />}
              {filteredTableStatus === "error" && <TableEmptyState colSpan={3} message="Unable to load policies." tone="error" />}
              {filteredTableStatus === "empty" && <TableEmptyState colSpan={3} message="No policies." />}
              {filteredPolicies.map((p) => (
                  <tr key={p.arn} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="manager-table-cell px-6 py-4 ui-body font-semibold text-slate-900 dark:text-slate-100">
                      <span>{p.name}</span>
                    </td>
                    <td className="manager-table-cell px-6 py-4 ui-caption text-slate-600 dark:text-slate-300">{p.arn}</td>
                    <td className="px-6 py-4 ui-body text-slate-600 dark:text-slate-300">{p.default_version_id ?? "-"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdvancedModal && (
        <Modal title="Create policy" onClose={closeAdvancedModal}>
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
                onClick={closeAdvancedModal}
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
        </Modal>
      )}
    </div>
  );
}
