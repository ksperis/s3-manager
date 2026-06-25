/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createPortalAccessKey,
  deletePortalAccessKey,
  fetchPortalAccessKeysState,
  updatePortalAccessKeyStatus,
  type PortalAccessKey,
  type PortalAccessKeysState,
} from "../../api/portal";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import ListToolbar from "../../components/ListToolbar";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import TableEmptyState from "../../components/TableEmptyState";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { extractApiError } from "../../utils/apiError";
import { usePortalAccountContext } from "./PortalAccountContext";
import { portalBreadcrumbs } from "./portalBreadcrumbs";

type PendingAccessKeyAction =
  | { type: "disable"; key: PortalAccessKey }
  | { type: "delete"; key: PortalAccessKey };

function isKeyActive(key: PortalAccessKey): boolean {
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

function CopyButton({ value, label }: { value: string; label: string }) {
  const handleCopy = () => {
    if (!value || typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
    navigator.clipboard.writeText(value).catch(() => {});
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

export default function PortalAccessKeysPage() {
  const { accountIdForApi, hasAccountContext, loading: accountLoading, error: accountError } = usePortalAccountContext();
  const [state, setState] = useState<PortalAccessKeysState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<PortalAccessKey | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAccessKeyAction | null>(null);

  const loadKeys = useCallback(async () => {
    if (!hasAccountContext || !accountIdForApi) {
      setState(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPortalAccessKeysState(accountIdForApi);
      setState(data);
    } catch (err) {
      console.error(err);
      setState(null);
      setError(extractApiError(err, "Unable to load access keys."));
    } finally {
      setLoading(false);
    }
  }, [accountIdForApi, hasAccountContext]);

  useEffect(() => {
    setCreatedKey(null);
    setActionMessage(null);
    void loadKeys();
  }, [loadKeys]);

  const visibleKeys = useMemo(() => (state?.access_keys ?? []).filter((key) => !key.is_portal), [state?.access_keys]);
  const canManageAccessKeys = Boolean(state?.can_manage_access_keys);
  const maxAccessKeys = state?.max_access_keys ?? 0;
  const maxReached = maxAccessKeys > 0 && visibleKeys.length >= maxAccessKeys;
  const tableStatus = resolveListTableStatus({ loading, error, rowCount: visibleKeys.length });

  const handleCreateKey = async () => {
    if (!accountIdForApi || !canManageAccessKeys || maxReached) return;
    setBusy("create");
    setError(null);
    setActionMessage(null);
    try {
      const key = await createPortalAccessKey(accountIdForApi);
      setCreatedKey(key);
      setActionMessage("Access key created");
      await loadKeys();
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, "Unable to create access key."));
    } finally {
      setBusy(null);
    }
  };

  const updateKeyStatus = async (key: PortalAccessKey, active: boolean) => {
    if (!accountIdForApi || !canManageAccessKeys || key.is_portal) return;
    setBusy(`toggle:${key.access_key_id}`);
    setError(null);
    setActionMessage(null);
    try {
      await updatePortalAccessKeyStatus(accountIdForApi, key.access_key_id, active);
      setActionMessage(active ? "Access key enabled" : "Access key disabled");
      setPendingAction(null);
      await loadKeys();
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, "Unable to update access key."));
      setPendingAction(null);
    } finally {
      setBusy(null);
    }
  };

  const handleToggleKey = (key: PortalAccessKey) => {
    if (!accountIdForApi || !canManageAccessKeys || key.is_portal) return;
    const active = isKeyActive(key);
    if (active) {
      setPendingAction({ type: "disable", key });
      return;
    }
    void updateKeyStatus(key, true);
  };

  const handleDeleteKey = (key: PortalAccessKey) => {
    if (!accountIdForApi || !canManageAccessKeys || key.is_portal) return;
    setPendingAction({ type: "delete", key });
  };

  const confirmDeleteKey = async (key: PortalAccessKey) => {
    if (!accountIdForApi || !canManageAccessKeys || key.is_portal) return;
    setBusy(`delete:${key.access_key_id}`);
    setError(null);
    setActionMessage(null);
    try {
      await deletePortalAccessKey(accountIdForApi, key.access_key_id);
      setActionMessage("Access key deleted");
      setPendingAction(null);
      await loadKeys();
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, "Unable to delete access key."));
      setPendingAction(null);
    } finally {
      setBusy(null);
    }
  };

  const createDisabled = !state || !canManageAccessKeys || maxReached || Boolean(busy);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Access keys"
        description="Create S3 access keys for external tools. Use the endpoint shown here; each secret is shown only once."
        breadcrumbs={portalBreadcrumbs({ label: "Access keys" })}
        actions={[
          {
            label: busy === "create" ? "Creating..." : "New key",
            onClick: handleCreateKey,
            variant: "primary",
            disabled: createDisabled,
          },
        ]}
      />

      {accountError && <PageBanner tone="error">{accountError}</PageBanner>}
      {error && <PageBanner tone="error">{error}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {state && !canManageAccessKeys && (
        <PageBanner tone="warning">Access-key management is disabled for this portal account.</PageBanner>
      )}
      {state && canManageAccessKeys && (
        <PageBanner tone="info">
          Use endpoint {state.s3_endpoint || "the configured storage service"} with these keys. Disabling pauses a key for external tools; deleting removes it permanently.
        </PageBanner>
      )}
      {state && canManageAccessKeys && maxReached && (
        <PageBanner tone="info">The maximum number of portal user access keys has been reached.</PageBanner>
      )}

      {createdKey?.secret_access_key && (
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
                <div className="max-w-full break-all rounded border border-amber-200 bg-white/80 px-3 py-2 font-mono ui-caption text-slate-800 dark:border-amber-800 dark:bg-amber-50/10 dark:text-amber-100">
                  {createdKey.access_key_id}
                </div>
                <CopyButton value={createdKey.access_key_id} label="Copy" />
              </div>
            </div>
            <div>
              <div className="ui-caption uppercase tracking-wide text-amber-600">Secret key</div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="max-w-full break-all rounded border border-amber-200 bg-white/80 px-3 py-2 font-mono ui-caption text-slate-800 dark:border-amber-800 dark:bg-amber-50/10 dark:text-amber-100">
                  {createdKey.secret_access_key}
                </div>
                <CopyButton value={createdKey.secret_access_key} label="Copy" />
              </div>
            </div>
          </div>
        </div>
      )}

      {accountLoading ? (
        <PageBanner tone="info">Loading portal account...</PageBanner>
      ) : !hasAccountContext ? (
        <PageEmptyState
          title="Select a portal account before managing access keys"
          description="Access keys are scoped to the selected portal account."
          tone="warning"
        />
      ) : (
        <div className="ui-surface-card">
          <ListToolbar
            title="Keys"
            description={
              state?.s3_endpoint
                ? `Use these keys with endpoint ${state.s3_endpoint}. Store secrets when they are created; they cannot be shown again. The portal key is hidden from this list.`
                : "Store secrets when they are created; they cannot be shown again. The portal key is hidden from this list."
            }
            showHeading={false}
            countLabel={`${visibleKeys.length}/${maxAccessKeys || "-"} key(s)`}
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
              {tableStatus === "empty" && <TableEmptyState colSpan={4} message="No external access keys." />}
              {visibleKeys.map((key) => {
                const active = isKeyActive(key);
                const disabled = Boolean(busy) || !canManageAccessKeys;
                return (
                  <tr
                    key={key.access_key_id}
                    className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 ${active ? "" : "bg-slate-50/70 dark:bg-slate-800/40"}`}
                  >
                    <td className="manager-table-cell max-w-[18rem] break-all px-6 py-4 font-mono text-slate-800 dark:text-slate-100">
                      {key.access_key_id}
                    </td>
                    <td className="manager-table-cell px-6 py-4 ui-body text-slate-700 dark:text-slate-200">
                      {key.status ?? (active ? "Active" : "Inactive")}
                    </td>
                    <td className="manager-table-cell px-6 py-4 ui-body text-slate-600 dark:text-slate-300">
                      {formatDate(key.created_at)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleToggleKey(key)}
                          className={tableActionButtonClasses}
                          disabled={disabled}
                        >
                          {busy === `toggle:${key.access_key_id}` ? "Saving..." : active ? "Disable" : "Enable"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteKey(key)}
                          className={tableDeleteActionClasses}
                          disabled={disabled}
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

      {pendingAction?.type === "disable" ? (
        <ConfirmActionDialog
          title="Disable access key"
          description="Confirm that you want to disable this access key."
          confirmLabel="Disable key"
          loading={busy === `toggle:${pendingAction.key.access_key_id}`}
          details={[
            { label: "Access key", value: pendingAction.key.access_key_id, mono: true },
            { label: "Endpoint", value: state?.s3_endpoint ?? "Configured storage service" },
          ]}
          impacts={[
            "External tools using this key stop authenticating until it is re-enabled.",
            "The secret value cannot be displayed again from the Portal.",
            "The active Portal runtime key is not affected.",
          ]}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => updateKeyStatus(pendingAction.key, false)}
        />
      ) : null}

      {pendingAction?.type === "delete" ? (
        <ConfirmActionDialog
          title="Delete access key"
          description="Confirm that you want to permanently delete this access key."
          confirmLabel="Delete key"
          loading={busy === `delete:${pendingAction.key.access_key_id}`}
          details={[
            { label: "Access key", value: pendingAction.key.access_key_id, mono: true },
            { label: "Endpoint", value: state?.s3_endpoint ?? "Configured storage service" },
          ]}
          impacts={[
            "External tools using this key stop working immediately.",
            "The secret value cannot be recovered or shown again.",
            "This deletion cannot be undone from the Portal.",
          ]}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => confirmDeleteKey(pendingAction.key)}
        />
      ) : null}
    </div>
  );
}
