/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import type { S3AccountSelector } from "../../api/accountParams";
import { IamPolicy, listIamPolicies } from "../../api/managerIamPolicies";
import PageShell from "../../components/PageShell";
import PageBanner from "../../components/PageBanner";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { extractApiError } from "../../utils/apiError";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";
import InlinePolicyEditor from "./InlinePolicyEditor";
import { useS3AccountContext } from "./S3AccountContext";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";

type ManagerPolicyEntityType = "user" | "group" | "role";

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
  return extractApiError(err, "Unexpected error");
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
  const parentPageId = {
    user: "users",
    group: "groups",
    role: "roles",
  } as const;
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
  const policyConfirmation = useConfirmActionDialog();

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

  const detachPolicy = async (policyArn: string) => {
    if (needsS3AccountSelection || !rawEntityName) return;
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

  const handleDetach = (policyArn: string) => {
    policyConfirmation.requestConfirmation({
      title: "Detach managed policy?",
      description: `Remove this managed policy from the selected ${config.singularLabel}.`,
      confirmLabel: "Detach policy",
      details: [
        { label: config.singularLabel, value: decodedEntity },
        { label: "Policy ARN", value: policyArn, mono: true },
      ],
      impacts: [`Permissions granted only by this policy will no longer apply to the ${config.singularLabel}.`],
      onConfirm: () => detachPolicy(policyArn),
    });
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
      <PageShell
          title={config.title}
          description={`Attach/detach IAM policies for a specific ${config.singularLabel}.`}
          breadcrumbs={managerPageBreadcrumbs(parentPageId[entityType], { label: "Policies" })}
      >
        <PageBanner tone="info">
          IAM {config.pluralLabel} are not available for standalone S3 users. Select an S3 Account to continue.
        </PageBanner>
      </PageShell>
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
  const attachedPolicyColumns: Array<DataTableColumn<IamPolicy>> = [
    {
      id: "policy",
      label: "Policy",
      primary: true,
      render: (policy) => policy.name,
    },
    {
      id: "arn",
      label: "ARN",
      cellClassName: "break-all font-mono text-[11px]",
      render: (policy) => policy.arn,
    },
    {
      id: "actions",
      label: "Actions",
      align: "right",
      mobileRole: "actions",
      render: (policy) => (
        <button
          type="button"
          onClick={() => handleDetach(policy.arn)}
          className="ui-caption font-semibold text-rose-600 hover:text-rose-700 disabled:opacity-60 dark:text-rose-200 dark:hover:text-rose-100"
          disabled={busy === policy.arn}
        >
          {busy === policy.arn ? "Detaching..." : "Detach"}
        </button>
      ),
    },
  ];

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
    <PageShell
      title={config.title}
      description={detailLine}
      breadcrumbs={managerPageBreadcrumbs(
        parentPageId[entityType],
        { label: decodedEntity },
        { label: "Policies" },
      )}
      actions={[
        { label: `← Back to ${config.pluralLabel}`, to: config.managerRoute, variant: "ghost" },
        ...(extraActions?.(decodedEntity) ?? []),
        { label: "Refresh", onClick: handleRefresh, variant: "ghost" },
      ]}
    >

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
          <DataTableShell
            columns={attachedPolicyColumns}
            rows={attached}
            rowKey={(policy) => policy.arn}
            status={tableStatus}
            loadingMessage="Loading policies..."
            errorMessage="Unable to load policies."
            emptyMessage="No attached policies."
            tableClassName="compact-table"
            responsiveCards
          />
        </div>
      </div>
      {policyConfirmation.confirmationDialog}
    </PageShell>
  );
}
