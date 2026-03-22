/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";
import axios from "axios";

import {
  createManagerCephAccessKey,
  deleteManagerCephAccessKey,
  listManagerCephAccessKeys,
  ManagerCephAccessKey,
  ManagerCephGeneratedAccessKey,
  updateManagerCephAccessKeyStatus,
} from "../../api/managerCephKeys";
import ListToolbar from "../../components/ListToolbar";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import TableEmptyState from "../../components/TableEmptyState";
import WorkspaceContextStrip from "../../components/WorkspaceContextStrip";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { confirmAction } from "../../utils/confirm";
import { useS3AccountContext } from "./S3AccountContext";
import useManagerWorkspaceContextStrip from "./useManagerWorkspaceContextStrip";

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
      className="inline-flex items-center rounded-full bg-slate-900 px-3 py-1 ui-caption font-semibold text-white shadow-sm transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
    >
      {label}
    </button>
  );
}

function parseError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    return (err.response?.data as { detail?: string })?.detail || err.message || "Unexpected error";
  }
  return err instanceof Error ? err.message : "Unexpected error";
}

function isKeyActive(key: ManagerCephAccessKey): boolean {
  if (typeof key.is_active === "boolean") {
    return key.is_active;
  }
  const normalized = (key.status || "").toLowerCase();
  if (["inactive", "disabled", "suspended"].includes(normalized)) return false;
  if (["active", "enabled"].includes(normalized)) return true;
  return true;
}

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export default function ManagerCephKeysPage() {
  const {
    hasS3AccountContext,
    accountIdForApi,
    selectedS3AccountType,
    managerCephKeysEnabled,
    accessMode,
  } = useS3AccountContext();

  const [keys, setKeys] = useState<ManagerCephAccessKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<ManagerCephGeneratedAccessKey | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [keyFilter, setKeyFilter] = useState("");

  const isS3UserContext = selectedS3AccountType === "s3_user";
  const canManageCephKeys = Boolean(hasS3AccountContext && isS3UserContext && managerCephKeysEnabled);
  const contextStrip = useManagerWorkspaceContextStrip({
    description: "Ceph RGW access keys are available only for managed S3 user contexts with RGW admin key management enabled.",
  });

  const loadKeys = useCallback(async () => {
    if (!canManageCephKeys) {
      setKeys([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await listManagerCephAccessKeys(accountIdForApi);
      setKeys(data);
    } catch (err) {
      setError(parseError(err));
      setKeys([]);
    } finally {
      setLoading(false);
    }
  }, [accountIdForApi, canManageCephKeys]);

  useEffect(() => {
    setCreatedKey(null);
    setActionMessage(null);
    void loadKeys();
  }, [accessMode, loadKeys]);

  const handleCreateKey = async () => {
    if (!canManageCephKeys) return;
    setBusy("create");
    setError(null);
    setActionMessage(null);
    try {
      const key = await createManagerCephAccessKey(accountIdForApi);
      setCreatedKey(key);
      setActionMessage("Access key created");
      await loadKeys();
    } catch (err) {
      setError(parseError(err));
    } finally {
      setBusy(null);
    }
  };

  const handleToggleKey = async (key: ManagerCephAccessKey) => {
    if (!canManageCephKeys || key.is_ui_managed) return;
    const currentlyActive = isKeyActive(key);
    if (currentlyActive && !confirmAction(`Disable key ${key.access_key_id}?`)) return;

    setBusy(`toggle:${key.access_key_id}`);
    setError(null);
    setActionMessage(null);
    try {
      await updateManagerCephAccessKeyStatus(accountIdForApi, key.access_key_id, !currentlyActive);
      setActionMessage(currentlyActive ? "Access key disabled" : "Access key enabled");
      await loadKeys();
    } catch (err) {
      setError(parseError(err));
    } finally {
      setBusy(null);
    }
  };

  const handleDeleteKey = async (key: ManagerCephAccessKey) => {
    if (!canManageCephKeys || key.is_ui_managed) return;
    if (!confirmAction(`Delete key ${key.access_key_id}?`)) return;

    setBusy(`delete:${key.access_key_id}`);
    setError(null);
    setActionMessage(null);
    try {
      await deleteManagerCephAccessKey(accountIdForApi, key.access_key_id);
      setActionMessage("Access key deleted");
      await loadKeys();
    } catch (err) {
      setError(parseError(err));
    } finally {
      setBusy(null);
    }
  };

  const filteredKeys = keys.filter((key) => {
    const needle = keyFilter.trim().toLowerCase();
    if (!needle) return true;
    return key.access_key_id.toLowerCase().includes(needle) || (key.status ?? "").toLowerCase().includes(needle);
  });
  const tableStatus = resolveListTableStatus({ loading, error, rowCount: filteredKeys.length });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Ceph access keys"
        description="Manage Ceph RGW access keys for this S3 User context."
        breadcrumbs={[{ label: "Manager" }, { label: "Ceph" }, { label: "Access keys" }]}
        actions={
          canManageCephKeys
            ? [
                {
                  label: busy === "create" ? "Creating..." : "New key",
                  onClick: handleCreateKey,
                  variant: "primary",
                },
              ]
            : []
        }
      />
      <WorkspaceContextStrip {...contextStrip} />

      {error && <PageBanner tone="error">{error}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}

      {createdKey && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 ui-body text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/60 dark:text-amber-100">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">Access key created</p>
              <p className="ui-caption text-amber-700 dark:text-amber-200">The secret is shown only once.</p>
            </div>
            <span className="rounded-full bg-amber-100 px-3 py-1 ui-caption font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/40 dark:text-amber-100">
              Copy these values now
            </span>
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

      {!hasS3AccountContext ? (
        <PageEmptyState
          title="Select an account before managing Ceph access keys"
          description="Ceph access keys are scoped to the active execution context. Choose a managed S3 user context before opening key inventory."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : !isS3UserContext ? (
        <PageEmptyState
          title="Ceph access keys are available only for managed S3 user contexts"
          description="Switch to a managed S3 user execution context to create, enable, disable, or delete RGW access keys."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : managerCephKeysEnabled === null ? (
        <PageBanner tone="info">Loading context capabilities…</PageBanner>
      ) : !managerCephKeysEnabled ? (
        <PageEmptyState
          title="Ceph key management is unavailable for this context"
          description="The selected context does not expose RGW access-key management. Check the feature toggle, endpoint provider, admin feature, and Ceph admin credentials."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : (
        <div className="ui-surface-card">
          <ListToolbar
            title="Keys"
            description="The portal key is locked and cannot be disabled or deleted from this page."
            countLabel={`${filteredKeys.length} result(s)`}
            search={
              <input
                type="text"
                value={keyFilter}
                onChange={(event) => setKeyFilter(event.target.value)}
                placeholder="Search by access key or status"
                className="w-full rounded-md border border-slate-200 px-3 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 sm:w-72 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            }
          />
          <table className="manager-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr>
                <th className="px-6 py-3 text-left ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Access key
                </th>
                <th className="px-6 py-3 text-left ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Status
                </th>
                <th className="px-6 py-3 text-left ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Created on
                </th>
                <th className="px-6 py-3 text-right ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {tableStatus === "loading" && <TableEmptyState colSpan={4} message="Loading keys..." />}
              {tableStatus === "error" && <TableEmptyState colSpan={4} message="Unable to load keys." tone="error" />}
              {tableStatus === "empty" && <TableEmptyState colSpan={4} message="No keys found." />}
              {filteredKeys.map((key) => {
                const active = isKeyActive(key);
                const locked = Boolean(key.is_ui_managed);
                return (
                  <tr
                    key={key.access_key_id}
                    className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 ${active ? "" : "bg-slate-50/70 dark:bg-slate-800/40"}`}
                  >
                    <td className="manager-table-cell px-6 py-4 font-mono text-slate-800 dark:text-slate-100">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{key.access_key_id}</span>
                        {locked && (
                          <span
                            className="shrink-0 rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
                            title="Portal key (locked)"
                          >
                            S3M
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="manager-table-cell px-6 py-4 ui-body text-slate-700 dark:text-slate-200">
                      {key.status ?? (active ? "Active" : "Inactive")}
                    </td>
                    <td className="manager-table-cell px-6 py-4 ui-body text-slate-600 dark:text-slate-300">{formatDate(key.created_at)}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleToggleKey(key)}
                          className={tableActionButtonClasses}
                          disabled={Boolean(busy) || locked}
                          title={locked ? "Portal key is locked" : undefined}
                        >
                          {busy === `toggle:${key.access_key_id}` ? "Saving..." : active ? "Disable" : "Enable"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteKey(key)}
                          className={tableDeleteActionClasses}
                          disabled={Boolean(busy) || locked}
                          title={locked ? "Portal key is locked" : undefined}
                        >
                          {busy === `delete:${key.access_key_id}` ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
