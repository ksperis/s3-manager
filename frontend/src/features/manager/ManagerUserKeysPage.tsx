/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import axios from "axios";
import { S3AccountSelector } from "../../api/accountParams";
import { AccessKey, createIamAccessKey, deleteIamAccessKey, listIamAccessKeys } from "../../api/managerIamUsers";
import { useS3AccountContext } from "./S3AccountContext";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import TableEmptyState from "../../components/TableEmptyState";
import { tableDeleteActionClasses } from "../../components/tableActionClasses";
import { confirmAction } from "../../utils/confirm";

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
      className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-3 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
    >
      <span aria-hidden>📋</span>
      {label}
    </button>
  );
}

export default function ManagerUserKeysPage() {
  const { userName } = useParams<{ userName: string }>();
  const { selectedS3AccountType, accountIdForApi, requiresS3AccountSelection } = useS3AccountContext();
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

  const formatDate = (value?: string) => {
    if (!value) return "-";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
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
  }, [accountIdForApi, needsS3AccountSelection, userName]);

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
    setBusy(keyId);
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

  const pageTitle = useMemo(() => {
    if (!userName) return "";
    try {
      return decodeURIComponent(userName);
    } catch {
      return userName;
    }
  }, [userName]);

  if (!userName) {
    return <div className="text-sm text-slate-600">User not specified.</div>;
  }

  if (needsS3AccountSelection) {
    return <div className="text-sm text-slate-600">Select an account before managing keys.</div>;
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
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/60 dark:text-amber-100">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">Key created for {pageTitle}</p>
              <p className="text-xs text-amber-700 dark:text-amber-200">The secret is shown only once.</p>
            </div>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/40 dark:text-amber-100">
              Copy these values now
            </span>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-amber-600">Access key</div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="rounded border border-amber-200 bg-white/80 px-3 py-2 font-mono text-xs text-slate-800 dark:border-amber-800 dark:bg-amber-50/10 dark:text-amber-100">
                  {createdKey.access_key_id}
                </div>
                <CopyButton value={createdKey.access_key_id} label="Copy" />
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-amber-600">Secret key</div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="rounded border border-amber-200 bg-white/80 px-3 py-2 font-mono text-xs text-slate-800 dark:border-amber-800 dark:bg-amber-50/10 dark:text-amber-100">
                  {createdKey.secret_access_key}
                </div>
                <CopyButton value={createdKey.secret_access_key} label="Copy" />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <table className="manager-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
          <thead className="bg-slate-50 dark:bg-slate-900/50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Access key</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Created on</th>
              <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {loading && <TableEmptyState colSpan={4} message="Loading keys..." />}
            {!loading && keys.length === 0 && <TableEmptyState colSpan={4} message="No keys for this user." />}
            {!loading &&
              keys.map((k) => (
                <tr key={k.access_key_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="manager-table-cell px-6 py-4 font-mono text-slate-800 dark:text-slate-100">{k.access_key_id}</td>
                  <td className="manager-table-cell px-6 py-4 text-sm text-slate-700 dark:text-slate-200">{k.status ?? "-"}</td>
                  <td className="manager-table-cell px-6 py-4 text-sm text-slate-600 dark:text-slate-300">{formatDate(k.created_at)}</td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => handleDeleteKey(k.access_key_id)}
                      className={tableDeleteActionClasses}
                      disabled={busy === k.access_key_id}
                    >
                      {busy === k.access_key_id ? "Deleting..." : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
