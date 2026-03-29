/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import axios from "axios";
import { S3AccountSelector } from "../../api/accountParams";
import {
  AccessKey,
  createIamAccessKey,
  deleteIamAccessKey,
  listIamAccessKeys,
  updateIamAccessKeyStatus,
} from "../../api/managerIamUsers";
import { useS3AccountContext } from "./S3AccountContext";
import AddS3ConnectionFromKeyModal from "../../components/AddS3ConnectionFromKeyModal";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import TableEmptyState from "../../components/TableEmptyState";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { confirmAction } from "../../utils/confirm";
import { buildManagerConnectionDefaults } from "../shared/s3ConnectionFromKey";

function CopyButton({ value, label }: { value: string; label: string }) {
  const handleCopy = () => {
    if (!value) return;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(value).catch(() => {});
    }
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-3 py-1 ui-caption font-semibold text-white shadow-sm transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
    >
      <span aria-hidden>📋</span>
      {label}
    </button>
  );
}

export default function ManagerUserKeysPage() {
  const { userName } = useParams<{ userName: string }>();
  const { selectedS3AccountType, accountIdForApi, requiresS3AccountSelection, accessMode, accounts } = useS3AccountContext();
  const needsS3AccountSelection = requiresS3AccountSelection && !accountIdForApi;
  const isS3User = selectedS3AccountType === "s3_user";
  if (isS3User) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="User access keys"
          description="Rotate IAM access keys for a specific user."
          breadcrumbs={[{ label: "Manager" }, { label: "IAM" }, { label: "Users" }, { label: "Access keys" }]}
        />
        <PageBanner tone="info">IAM users are not available for standalone S3 users. Select an S3 Account to continue.</PageBanner>
      </div>
    );
  }
  const [keys, setKeys] = useState<AccessKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<AccessKey | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [showAddConnectionModal, setShowAddConnectionModal] = useState(false);

  const formatDate = (value?: string) => {
    if (!value) return "-";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
  };

  const isKeyActive = (key: AccessKey): boolean => {
    if (key.status) {
      const normalized = key.status.toLowerCase();
      if (["inactive", "disabled", "suspended"].includes(normalized)) return false;
      if (["active", "enabled"].includes(normalized)) return true;
    }
    return true;
  };

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

  const load = async (accountId: S3AccountSelector, targetUser: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await listIamAccessKeys(accountId, targetUser);
      setKeys(data);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (needsS3AccountSelection) {
      setKeys([]);
      setLoading(false);
      return;
    }
    if (userName) {
      load(accountIdForApi, userName);
    }
  }, [accountIdForApi, needsS3AccountSelection, userName, accessMode]);

  const handleCreateKey = async () => {
    if (needsS3AccountSelection || !userName) return;
    setBusy("create");
    setError(null);
    setActionMessage(null);
    try {
      const key = await createIamAccessKey(accountIdForApi, userName);
      setCreatedKey(key);
      await load(accountIdForApi, userName);
      setActionMessage("Access key created");
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  };

  const handleDeleteKey = async (keyId: string) => {
    if (needsS3AccountSelection || !userName) return;
    if (!confirmAction(`Delete key ${keyId}?`)) return;
    setBusy(`delete:${keyId}`);
    setError(null);
    setActionMessage(null);
    try {
      await deleteIamAccessKey(accountIdForApi, userName, keyId);
      await load(accountIdForApi, userName);
      setActionMessage("Access key deleted");
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  };

  const handleToggleKey = async (keyId: string, nextActive: boolean) => {
    if (needsS3AccountSelection || !userName) return;
    if (!nextActive && !confirmAction(`Disable key ${keyId}?`)) return;
    setBusy(`toggle:${keyId}`);
    setError(null);
    setActionMessage(null);
    try {
      await updateIamAccessKeyStatus(accountIdForApi, userName, keyId, nextActive);
      await load(accountIdForApi, userName);
      setActionMessage(nextActive ? "Access key enabled" : "Access key disabled");
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  };

  const pageTitle = useMemo(() => {
    if (!userName) return "";
    try {
      return decodeURIComponent(userName);
    } catch {
      return userName;
    }
  }, [userName]);

  const selectedContext = useMemo(() => accounts.find((ctx) => ctx.id === accountIdForApi), [accountIdForApi, accounts]);
  const addConnectionDefaults = useMemo(() => {
    if (!createdKey) return null;
    return buildManagerConnectionDefaults(selectedContext, pageTitle, createdKey.access_key_id);
  }, [createdKey, pageTitle, selectedContext]);
  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: keys.length,
  });

  if (!userName) {
    return <div className="ui-body text-slate-600">User not specified.</div>;
  }

  if (needsS3AccountSelection) {
    return <div className="ui-body text-slate-600">Select an account before managing keys.</div>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="IAM access keys"
        description={
          <>
            Manage access keys for <span className="font-semibold text-slate-700 dark:text-slate-100">{pageTitle}</span>.
          </>
        }
        breadcrumbs={[
          { label: "Manager" },
          { label: "IAM", to: "/manager/users" },
          { label: pageTitle },
          { label: "Access keys" },
        ]}
        actions={[
          { label: "← Back to users", to: "/manager/users", variant: "ghost" },
          { label: "Attached policies", to: `/manager/users/${encodeURIComponent(pageTitle)}/policies`, variant: "ghost" },
          {
            label: busy === "create" ? "Creating..." : "New key",
            onClick: handleCreateKey,
            variant: "primary",
          },
        ]}
      />

      {error && <PageBanner tone="error">{error}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}

      {createdKey && createdKey.secret_access_key && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 ui-body text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/60 dark:text-amber-100">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">Key created for {pageTitle}</p>
              <p className="ui-caption text-amber-700 dark:text-amber-200">The secret is shown only once.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAddConnectionModal(true)}
                disabled={!createdKey.secret_access_key}
                className="rounded-md border border-amber-300 bg-white/70 px-3 py-1.5 ui-caption font-semibold text-amber-700 hover:bg-amber-100/70 disabled:opacity-60 dark:border-amber-700 dark:bg-amber-950/20 dark:text-amber-100 dark:hover:bg-amber-950/40"
              >
                Add as S3 Connection
              </button>
              <span className="rounded-full bg-amber-100 px-3 py-1 ui-caption font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/40 dark:text-amber-100">
                Copy these values now
              </span>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <div className="ui-caption uppercase tracking-wide text-amber-600">Access key</div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="rounded border border-amber-200 bg-white/80 px-3 py-2 font-mono ui-caption text-slate-800 dark:border-amber-800 dark:bg-amber-50/10 dark:text-amber-100">
                  {createdKey.access_key_id}
                </div>
                <CopyButton value={createdKey.access_key_id} label="Copy" />
              </div>
            </div>
            <div>
              <div className="ui-caption uppercase tracking-wide text-amber-600">Secret key</div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="rounded border border-amber-200 bg-white/80 px-3 py-2 font-mono ui-caption text-slate-800 dark:border-amber-800 dark:bg-amber-50/10 dark:text-amber-100">
                  {createdKey.secret_access_key}
                </div>
                <CopyButton value={createdKey.secret_access_key} label="Copy" />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="ui-surface-card">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">Keys</p>
          <p className="ui-caption text-slate-500 dark:text-slate-400">IAM access keys for this user.</p>
        </div>
        <table className="manager-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
          <thead className="bg-slate-50 dark:bg-slate-900/50">
            <tr>
              <th className="px-6 py-3 text-left ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Access key</th>
              <th className="px-6 py-3 text-left ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Status</th>
              <th className="px-6 py-3 text-left ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Created on</th>
              <th className="px-6 py-3 text-right ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {tableStatus === "loading" && <TableEmptyState colSpan={4} message="Loading keys..." />}
            {tableStatus === "error" && <TableEmptyState colSpan={4} message="Unable to load keys." tone="error" />}
            {tableStatus === "empty" && <TableEmptyState colSpan={4} message="No keys for this user." />}
            {keys.map((k) => (
                <tr
                  key={k.access_key_id}
                  className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 ${isKeyActive(k) ? "" : "bg-slate-50/70 dark:bg-slate-800/40"}`}
                >
                  <td className="manager-table-cell px-6 py-4 font-mono text-slate-800 dark:text-slate-100">{k.access_key_id}</td>
                  <td className="manager-table-cell px-6 py-4 ui-body text-slate-700 dark:text-slate-200">
                    {k.status ?? (isKeyActive(k) ? "Active" : "Inactive")}
                  </td>
                  <td className="manager-table-cell px-6 py-4 ui-body text-slate-600 dark:text-slate-300">{formatDate(k.created_at)}</td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        onClick={() => handleToggleKey(k.access_key_id, !isKeyActive(k))}
                        className={tableActionButtonClasses}
                        disabled={Boolean(busy)}
                      >
                        {busy === `toggle:${k.access_key_id}` ? "Saving..." : isKeyActive(k) ? "Disable" : "Enable"}
                      </button>
                      <button
                        onClick={() => handleDeleteKey(k.access_key_id)}
                        className={tableDeleteActionClasses}
                        disabled={Boolean(busy)}
                      >
                        {busy === `delete:${k.access_key_id}` ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {showAddConnectionModal && createdKey && createdKey.secret_access_key && addConnectionDefaults && (
        <AddS3ConnectionFromKeyModal
          isOpen={showAddConnectionModal}
          lockEndpoint
          accessKeyId={createdKey.access_key_id}
          secretAccessKey={createdKey.secret_access_key}
          defaultName={addConnectionDefaults.name}
          defaultEndpointId={addConnectionDefaults.endpointId}
          defaultEndpointUrl={addConnectionDefaults.endpointUrl}
          defaultAccessManager={false}
          defaultAccessBrowser
          defaultOwnerType={addConnectionDefaults.owner.ownerType}
          defaultOwnerIdentifier={addConnectionDefaults.owner.ownerIdentifier}
          onClose={() => setShowAddConnectionModal(false)}
          onCreated={() => {
            setActionMessage("S3 connection created.");
            setError(null);
          }}
        />
      )}
    </div>
  );
}
