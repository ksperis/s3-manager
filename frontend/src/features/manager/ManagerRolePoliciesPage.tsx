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
  attachRolePolicy,
  deleteRoleInlinePolicy,
  detachRolePolicy,
  listRoleInlinePolicies,
  listRolePolicies,
  putRoleInlinePolicy,
} from "../../api/managerIamRoles";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import TableEmptyState from "../../components/TableEmptyState";
import { confirmAction } from "../../utils/confirm";
import InlinePolicyEditor from "./InlinePolicyEditor";

export default function ManagerRolePoliciesPage() {
  const { roleName } = useParams<{ roleName: string }>();
  const { selectedS3AccountType, accountIdForApi, requiresS3AccountSelection, accessMode } = useS3AccountContext();
  const needsS3AccountSelection = requiresS3AccountSelection && !accountIdForApi;
  const isS3User = selectedS3AccountType === "s3_user";
  if (isS3User) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Role policies"
          description="Attach/detach IAM policies for a specific role."
          breadcrumbs={[{ label: "Manager" }, { label: "IAM" }, { label: "Roles" }, { label: "Policies" }]}
        />
        <PageBanner tone="info">IAM roles are not available for standalone S3 users. Select an S3 Account to continue.</PageBanner>
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

  const decodedRole = useMemo(() => {
    if (!roleName) return "";
    try {
      return decodeURIComponent(roleName);
    } catch {
      return roleName;
    }
  }, [roleName]);
  const noPoliciesAvailable = available.length === 0;

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

  const load = async (accountId: S3AccountSelector, targetRole: string) => {
    setLoading(true);
    setError(null);
    try {
      const [attachedPolicies, allPolicies] = await Promise.all([
        listRolePolicies(accountId, targetRole),
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
    if (roleName) {
      load(accountIdForApi, roleName);
    }
  }, [accountIdForApi, needsS3AccountSelection, roleName, accessMode]);

  const handleRefresh = () => {
    if (needsS3AccountSelection) return;
    if (roleName) {
      load(accountIdForApi, roleName);
    }
  };

  const handleAttach = async (e: FormEvent) => {
    e.preventDefault();
    if (needsS3AccountSelection || !roleName || !selectedArn) return;
    const policy = available.find((p) => p.arn === selectedArn);
    if (!policy) return;
    setBusy("attach");
    setError(null);
    setActionMessage(null);
    try {
      await attachRolePolicy(accountIdForApi, roleName, policy);
      await load(accountIdForApi, roleName);
      setActionMessage("Policy attached");
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  };

  const loadInlinePolicies = async () => {
    if (!roleName || needsS3AccountSelection) return [];
    return listRoleInlinePolicies(accountIdForApi, roleName);
  };

  const saveInlinePolicy = async (name: string, document: Record<string, unknown>) => {
    if (!roleName) return;
    await putRoleInlinePolicy(accountIdForApi, roleName, name, document);
  };

  const removeInlinePolicy = async (name: string) => {
    if (!roleName) return;
    await deleteRoleInlinePolicy(accountIdForApi, roleName, name);
  };

  const handleDetach = async (policyArn: string) => {
    if (needsS3AccountSelection || !roleName) return;
    if (!confirmAction(`Detach policy ${policyArn} from the role?`)) return;
    setBusy(policyArn);
    setError(null);
    setActionMessage(null);
    try {
      await detachRolePolicy(accountIdForApi, roleName, policyArn);
      await load(accountIdForApi, roleName);
      setActionMessage("Policy detached");
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  };

  if (!roleName) {
    return <div className="ui-body text-slate-600">Role not specified.</div>;
  }

  if (needsS3AccountSelection) {
    return <div className="ui-body text-slate-600">Select an account before managing roles.</div>;
  }

  const options = available.map((p) => ({ value: p.arn, label: p.name }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Role policies"
        description={
          <>
            Attach/detach policies for role <span className="font-semibold text-slate-700 dark:text-slate-100">{decodedRole}</span>.
          </>
        }
        breadcrumbs={[
          { label: "Manager" },
          { label: "IAM", to: "/manager/roles" },
          { label: decodedRole },
          { label: "Policies" },
        ]}
        actions={[
          { label: "← Back to roles", to: "/manager/roles", variant: "ghost" },
          { label: "Refresh", onClick: handleRefresh, variant: "ghost" },
        ]}
      />

      {error && <PageBanner tone="error">{error}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {noPoliciesAvailable && (
        <PageBanner tone="warning">No IAM policies available. Create one before attaching to this role.</PageBanner>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <InlinePolicyEditor
            entityLabel="role"
            entityName={decodedRole}
            loadPolicies={loadInlinePolicies}
            savePolicy={saveInlinePolicy}
            deletePolicy={removeInlinePolicy}
            disabled={needsS3AccountSelection}
            disabledReason="Select an account before editing role inline policies."
            key={`role-inline-${accountIdForApi ?? "none"}-${roleName ?? ""}`}
          />
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Attached policies</p>
            <p className="ui-caption text-slate-500 dark:text-slate-400">Attach/detach managed policies for this role.</p>
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
