/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import type { S3AccountSelector } from "../../api/accountParams";
import { IamPolicy, listIamPolicies } from "../../api/managerIamPolicies";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import TableEmptyState from "../../components/TableEmptyState";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { confirmAction } from "../../utils/confirm";
import InlinePolicyEditor from "./InlinePolicyEditor";
import { useS3AccountContext } from "./S3AccountContext";

export type ManagerPolicyEntityType = "user" | "group" | "role";

type PageAction = {
  label: string;
  to?: string;
  onClick?: () => void;
  variant?: "ghost" | "secondary" | "primary" | "danger";
};

type ManagerEntityPoliciesPageProps = {
  entityType: ManagerPolicyEntityType;
  routeParam: "userName" | "groupName" | "roleName";
  listPoliciesForEntity: (accountId: S3AccountSelector, entityName: string) => Promise<IamPolicy[]>;
  attachPolicyToEntity: (accountId: S3AccountSelector, entityName: string, policy: IamPolicy) => Promise<IamPolicy>;
  detachPolicyFromEntity: (accountId: S3AccountSelector, entityName: string, policyArn: string) => Promise<void>;
  listInlinePoliciesForEntity: (accountId: S3AccountSelector, entityName: string) => Promise<{ name: string; document: Record<string, unknown> }[]>;
  putInlinePolicyForEntity: (
    accountId: S3AccountSelector,
    entityName: string,
    policyName: string,
    document: Record<string, unknown>
  ) => Promise<{ name: string; document: Record<string, unknown> }>;
  deleteInlinePolicyForEntity: (accountId: S3AccountSelector, entityName: string, policyName: string) => Promise<void>;
  extraActions?: (entityName: string) => PageAction[];
};

type EntityPageConfig = {
  title: string;
  singularLabel: string;
  pluralLabel: string;
  managerRoute: string;
};

const ENTITY_CONFIG: Record<ManagerPolicyEntityType, EntityPageConfig> = {
  user: {
    title: "User policies",
    singularLabel: "user",
    pluralLabel: "users",
    managerRoute: "/manager/users",
  },
  group: {
    title: "Group policies",
    singularLabel: "group",
    pluralLabel: "groups",
    managerRoute: "/manager/groups",
  },
  role: {
    title: "Role policies",
    singularLabel: "role",
    pluralLabel: "roles",
    managerRoute: "/manager/roles",
  },
};

function extractError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    return (err.response?.data as { detail?: string })?.detail || err.message || "Unexpected error";
  }
  return err instanceof Error ? err.message : "Unexpected error";
}

export default function ManagerEntityPoliciesPage({
  entityType,
  routeParam,
  listPoliciesForEntity,
  attachPolicyToEntity,
  detachPolicyFromEntity,
  listInlinePoliciesForEntity,
  putInlinePolicyForEntity,
  deleteInlinePolicyForEntity,
  extraActions,
}: ManagerEntityPoliciesPageProps) {
  const config = ENTITY_CONFIG[entityType];
  const params = useParams();
  const rawEntityName = params[routeParam];
  const { selectedS3AccountType, accountIdForApi, requiresS3AccountSelection, accessMode } = useS3AccountContext();
  const needsS3AccountSelection = requiresS3AccountSelection && !accountIdForApi;
  const isS3User = selectedS3AccountType === "s3_user";

  const [attached, setAttached] = useState<IamPolicy[]>([]);
  const [available, setAvailable] = useState<IamPolicy[]>([]);
  const [selectedArn, setSelectedArn] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const decodedEntity = useMemo(() => {
    if (!rawEntityName) return "";
    try {
      return decodeURIComponent(rawEntityName);
    } catch {
      return rawEntityName;
    }
  }, [rawEntityName]);

  const noPoliciesAvailable = available.length === 0;

  const load = useCallback(async (accountId: S3AccountSelector, entityName: string) => {
    setLoading(true);
    setError(null);
    try {
      const [attachedPolicies, allPolicies] = await Promise.all([
        listPoliciesForEntity(accountId, entityName),
        listIamPolicies(accountId),
      ]);
      setAttached(attachedPolicies);
      setAvailable(allPolicies);
      const firstFree = allPolicies.find((policy) => !attachedPolicies.some((candidate) => candidate.arn === policy.arn));
      setSelectedArn(firstFree?.arn ?? "");
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  }, [listPoliciesForEntity]);

  useEffect(() => {
    if (isS3User) {
      setAttached([]);
      setAvailable([]);
      setLoading(false);
      return;
    }
    if (needsS3AccountSelection) {
      setAttached([]);
      setAvailable([]);
      setLoading(false);
      return;
    }
    if (rawEntityName) {
      load(accountIdForApi, rawEntityName);
    }
  }, [accessMode, accountIdForApi, isS3User, load, needsS3AccountSelection, rawEntityName]);

  const handleRefresh = () => {
    if (needsS3AccountSelection || !rawEntityName) return;
    load(accountIdForApi, rawEntityName);
  };

  const handleAttach = async (event: FormEvent) => {
    event.preventDefault();
    if (needsS3AccountSelection || !rawEntityName || !selectedArn) return;
    const policy = available.find((candidate) => candidate.arn === selectedArn);
    if (!policy) return;
    setBusy("attach");
    setError(null);
    setActionMessage(null);
    try {
      await attachPolicyToEntity(accountIdForApi, rawEntityName, policy);
      await load(accountIdForApi, rawEntityName);
      setActionMessage("Policy attached");
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  };

  const handleDetach = async (policyArn: string) => {
    if (needsS3AccountSelection || !rawEntityName) return;
    if (!confirmAction(`Detach policy ${policyArn} from the ${config.singularLabel}?`)) return;
    setBusy(policyArn);
    setError(null);
    setActionMessage(null);
    try {
      await detachPolicyFromEntity(accountIdForApi, rawEntityName, policyArn);
      await load(accountIdForApi, rawEntityName);
      setActionMessage("Policy detached");
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  };

  const loadInlinePolicies = async () => {
    if (!rawEntityName || needsS3AccountSelection) return [];
    return listInlinePoliciesForEntity(accountIdForApi, rawEntityName);
  };

  const saveInlinePolicy = async (name: string, document: Record<string, unknown>) => {
    if (!rawEntityName) return;
    await putInlinePolicyForEntity(accountIdForApi, rawEntityName, name, document);
  };

  const removeInlinePolicy = async (name: string) => {
    if (!rawEntityName) return;
    await deleteInlinePolicyForEntity(accountIdForApi, rawEntityName, name);
  };

  if (isS3User) {
    return (
      <div className="space-y-4">
        <PageHeader
          title={config.title}
          description={`Attach/detach IAM policies for a specific ${config.singularLabel}.`}
          breadcrumbs={[
            { label: "Manager" },
            { label: "IAM" },
            { label: `${config.pluralLabel[0].toUpperCase()}${config.pluralLabel.slice(1)}` },
            { label: "Attached Policies" },
          ]}
        />
        <PageBanner tone="info">
          IAM {config.pluralLabel} are not available for standalone S3 users. Select an S3 Account to continue.
        </PageBanner>
      </div>
    );
  }

  if (!rawEntityName) {
    return <div className="ui-body text-slate-600">{`${config.singularLabel[0].toUpperCase()}${config.singularLabel.slice(1)} not specified.`}</div>;
  }

  if (needsS3AccountSelection) {
    return <div className="ui-body text-slate-600">{`Select an account before managing ${config.pluralLabel}.`}</div>;
  }

  const options = available.map((policy) => ({ value: policy.arn, label: policy.name }));
  const tableStatus = resolveListTableStatus({ loading, error, rowCount: attached.length });

  const detailLine =
    entityType === "role"
      ? (
        <>
          Attach/detach policies for role <span className="font-semibold text-slate-700 dark:text-slate-100">{decodedEntity}</span>.
        </>
      )
      : (
        <>
          Attach/detach policies for <span className="font-semibold text-slate-700 dark:text-slate-100">{decodedEntity}</span>.
        </>
      );

  return (
    <div className="space-y-4">
      <PageHeader
        title={config.title}
        description={detailLine}
        breadcrumbs={[
          { label: "Manager" },
          { label: "IAM", to: config.managerRoute },
          { label: decodedEntity },
          { label: "Attached Policies" },
        ]}
        actions={[
          { label: `← Back to ${config.pluralLabel}`, to: config.managerRoute, variant: "ghost" },
          ...(extraActions?.(decodedEntity) ?? []),
          { label: "Refresh", onClick: handleRefresh, variant: "ghost" },
        ]}
      />

      {error && <PageBanner tone="error">{error}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {noPoliciesAvailable && (
        <PageBanner tone="warning">No IAM policies available. Create one before attaching to this {config.singularLabel}.</PageBanner>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <InlinePolicyEditor
          entityLabel={config.singularLabel}
          entityName={decodedEntity}
          loadPolicies={loadInlinePolicies}
          savePolicy={saveInlinePolicy}
          deletePolicy={removeInlinePolicy}
          disabled={needsS3AccountSelection}
          disabledReason={`Select an account before editing ${config.singularLabel} inline policies.`}
          key={`${config.singularLabel}-inline-${accountIdForApi ?? "none"}-${rawEntityName ?? ""}`}
        />

        <div className="ui-surface-card">
          <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Attached Policies</p>
            <p className="ui-caption text-slate-500 dark:text-slate-400">Attach/detach managed policies for this {config.singularLabel}.</p>
          </div>
          <div className="space-y-3 px-4 py-3">
            <form onSubmit={handleAttach} className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                value={selectedArn}
                onChange={(event) => setSelectedArn(event.target.value)}
                className="flex-1 rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="">Select a policy to attach</option>
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
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
                {tableStatus === "loading" && <TableEmptyState colSpan={3} message="Loading policies..." />}
                {tableStatus === "error" && <TableEmptyState colSpan={3} message="Unable to load policies." tone="error" />}
                {tableStatus === "empty" && <TableEmptyState colSpan={3} message="No attached policies." />}
                {attached.map((policy) => (
                  <tr key={policy.arn} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="manager-table-cell px-6 py-4 ui-body font-semibold text-slate-900 dark:text-slate-100">{policy.name}</td>
                    <td className="manager-table-cell px-6 py-4 ui-caption text-slate-600 dark:text-slate-300">{policy.arn}</td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleDetach(policy.arn)}
                        className="ui-caption font-semibold text-rose-600 hover:text-rose-700 disabled:opacity-60 dark:text-rose-200 dark:hover:text-rose-100"
                        disabled={busy === policy.arn}
                      >
                        {busy === policy.arn ? "Detaching..." : "Detach"}
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
