/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { useS3AccountContext } from "./S3AccountContext";
import { S3AccountSelector } from "../../api/accountParams";
import { IamPolicy, listIamPolicies } from "../../api/managerIamPolicies";
import {
  attachGroupPolicy,
  deleteGroupInlinePolicy,
  detachGroupPolicy,
  listGroupInlinePolicies,
  listGroupPolicies,
  putGroupInlinePolicy,
} from "../../api/managerIamGroups";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import TableEmptyState from "../../components/TableEmptyState";
import { confirmAction } from "../../utils/confirm";
import InlinePolicyEditor from "./InlinePolicyEditor";

export default function ManagerGroupPoliciesPage() {
  const { groupName } = useParams<{ groupName: string }>();
  const { selectedS3AccountType, accountIdForApi, requiresS3AccountSelection, accessMode } = useS3AccountContext();
  const needsS3AccountSelection = requiresS3AccountSelection && !accountIdForApi;
  const isS3User = selectedS3AccountType === "s3_user";
  if (isS3User) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Group policies"
          description="Attach/detach IAM policies for a specific group."
          breadcrumbs={[{ label: "Manager" }, { label: "IAM" }, { label: "Groups" }, { label: "Policies" }]}
        />
        <PageBanner tone="info">IAM groups are not available for standalone S3 users. Select an S3 Account to continue.</PageBanner>
      </div>
    );
  }
  const [attached, setAttached] = useState<IamPolicy[]>([]);
  const [available, setAvailable] = useState<IamPolicy[]>([]);
  const [selectedArn, setSelectedArn] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const noPoliciesAvailable = available.length === 0;

  const decodedGroup = useMemo(() => {
    if (!groupName) return "";
    try {
      return decodeURIComponent(groupName);
    } catch {
      return groupName;
    }
  }, [groupName]);

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

  const load = async (accountId: S3AccountSelector, targetGroup: string) => {
    setLoading(true);
    setError(null);
    try {
      const [attachedPolicies, allPolicies] = await Promise.all([
        listGroupPolicies(accountId, targetGroup),
        listIamPolicies(accountId),
      ]);
      setAttached(attachedPolicies);
      setAvailable(allPolicies);
      const firstFree = allPolicies.find((p) => !attachedPolicies.some((a) => a.arn === p.arn));
      setSelectedArn(firstFree?.arn ?? "");
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (needsS3AccountSelection) {
      setAttached([]);
      setAvailable([]);
      setLoading(false);
      return;
    }
    if (groupName) {
      load(accountIdForApi, groupName);
    }
  }, [accountIdForApi, needsS3AccountSelection, groupName, accessMode]);

  const handleRefresh = () => {
    if (needsS3AccountSelection) return;
    if (groupName) {
      load(accountIdForApi, groupName);
    }
  };

  const handleAttach = async (e: FormEvent) => {
    e.preventDefault();
    if (needsS3AccountSelection || !groupName || !selectedArn) return;
    const policy = available.find((p) => p.arn === selectedArn);
    if (!policy) return;
    setBusy("attach");
    setError(null);
    setActionMessage(null);
    try {
      await attachGroupPolicy(accountIdForApi, groupName, policy);
      await load(accountIdForApi, groupName);
      setActionMessage("Policy attached");
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  };

  const loadInlinePolicies = async () => {
    if (!groupName || needsS3AccountSelection) return [];
    return listGroupInlinePolicies(accountIdForApi, groupName);
  };

  const saveInlinePolicy = async (name: string, document: Record<string, unknown>) => {
    if (!groupName) return;
    await putGroupInlinePolicy(accountIdForApi, groupName, name, document);
  };

  const removeInlinePolicy = async (name: string) => {
    if (!groupName) return;
    await deleteGroupInlinePolicy(accountIdForApi, groupName, name);
  };

  const handleDetach = async (policyArn: string) => {
    if (needsS3AccountSelection || !groupName) return;
    if (!confirmAction(`Detach policy ${policyArn} from the group?`)) return;
    setBusy(policyArn);
    setError(null);
    setActionMessage(null);
    try {
      await detachGroupPolicy(accountIdForApi, groupName, policyArn);
      await load(accountIdForApi, groupName);
      setActionMessage("Policy detached");
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  };

  if (!groupName) {
    return <div className="ui-body text-slate-600">Group not specified.</div>;
  }

  if (needsS3AccountSelection) {
    return <div className="ui-body text-slate-600">Select an account before managing groups.</div>;
  }

  const options = available.map((p) => ({ value: p.arn, label: p.name }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Group policies"
        description={
          <>
            Attach/detach policies for <span className="font-semibold text-slate-700 dark:text-slate-100">{decodedGroup}</span>.
          </>
        }
        breadcrumbs={[
          { label: "Manager" },
          { label: "IAM", to: "/manager/groups" },
          { label: decodedGroup },
          { label: "Policies" },
        ]}
        actions={[
          { label: "← Back to groups", to: "/manager/groups", variant: "ghost" },
          { label: "Members", to: `/manager/groups/${encodeURIComponent(decodedGroup)}/users`, variant: "ghost" },
          { label: "Refresh", onClick: handleRefresh, variant: "ghost" },
        ]}
      />

      {error && <PageBanner tone="error">{error}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {noPoliciesAvailable && (
        <PageBanner tone="warning">No IAM policies available. Create one before attaching to this group.</PageBanner>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <InlinePolicyEditor
            entityLabel="group"
            entityName={decodedGroup}
            loadPolicies={loadInlinePolicies}
            savePolicy={saveInlinePolicy}
            deletePolicy={removeInlinePolicy}
            disabled={needsS3AccountSelection}
            disabledReason="Select an account before editing group inline policies."
            key={`group-inline-${accountIdForApi ?? "none"}-${groupName ?? ""}`}
          />
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Attached policies</p>
            <p className="ui-caption text-slate-500 dark:text-slate-400">Attach/detach managed policies for this group.</p>
          </div>
          <div className="space-y-3 px-4 py-3">
            <form onSubmit={handleAttach} className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                value={selectedArn}
                onChange={(e) => setSelectedArn(e.target.value)}
                className="flex-1 rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="">Select a policy to attach</option>
                {options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={busy !== null || !selectedArn}
                className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
              >
                {busy === "attach" ? "Attaching..." : "Attach"}
              </button>
            </form>
            <p className="ui-caption text-slate-500 dark:text-slate-400">Policies must be created first in the Policies tab.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="manager-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
              <thead className="bg-slate-50 dark:bg-slate-900/50">
                <tr>
                  <th className="px-6 py-3 text-left ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Policy</th>
                  <th className="px-6 py-3 text-left ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">ARN</th>
                  <th className="px-6 py-3 text-right ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {loading && <TableEmptyState colSpan={3} message="Loading policies..." />}
                {!loading && attached.length === 0 && <TableEmptyState colSpan={3} message="No attached policies." />}
                {!loading &&
                  attached.map((p) => (
                    <tr key={p.arn} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="manager-table-cell px-6 py-4 ui-body font-semibold text-slate-900 dark:text-slate-100">{p.name}</td>
                      <td className="manager-table-cell px-6 py-4 ui-caption text-slate-600 dark:text-slate-300">{p.arn}</td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => handleDetach(p.arn)}
                          className="ui-caption font-semibold text-rose-600 hover:text-rose-700 disabled:opacity-60 dark:text-rose-200 dark:hover:text-rose-100"
                          disabled={busy === p.arn}
                        >
                          {busy === p.arn ? "Detaching..." : "Detach"}
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
