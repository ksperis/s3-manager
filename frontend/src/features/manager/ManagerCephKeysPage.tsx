/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";

import {
  createManagerCephAccessKey,
  deleteManagerCephAccessKey,
  listManagerCephAccessKeys,
  ManagerCephAccessKey,
  ManagerCephGeneratedAccessKey,
  updateManagerCephAccessKeyStatus,
} from "../../api/managerCephKeys";
import ListToolbar from "../../components/ListToolbar";
import OneTimeSecretPanel from "../../components/OneTimeSecretPanel";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import TableEmptyState from "../../components/TableEmptyState";
import ManagerTable, {
  managerTableActionCellClass,
  managerTableCellClass,
  managerTableMutedRowClass,
  managerTablePrimaryCellClass,
} from "../../components/list/ManagerTable";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { cx } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { confirmAction } from "../../utils/confirm";
import { useS3AccountContext } from "./S3AccountContext";

function parseError(err: unknown): string {
  return extractApiError(err, "Unexpected error");
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

      {error && <PageBanner tone="error">{error}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}

      {createdKey && (
        <OneTimeSecretPanel
          title="Access key created"
          description="The secret is shown only once."
          badge="Copy these values now"
          values={[
            { label: "Access key", value: createdKey.access_key_id, copyLabel: "Copy" },
            { label: "Secret key", value: createdKey.secret_access_key, copyLabel: "Copy" },
          ]}
        />
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
          description="The selected context does not expose RGW access-key management. Check the user tool access, feature toggle, endpoint provider, admin feature, and Ceph admin credentials."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : (
        <div className="ui-surface-card">
          <ListToolbar
            title="Keys"
            description="The portal key is locked and cannot be disabled or deleted from this page."
            showHeading={false}
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
          <ManagerTable
            responsiveCards
            columns={[
              { key: "access-key", label: "Access key", mobileRole: "primary" },
              { key: "status", label: "Status" },
              { key: "created", label: "Created on" },
              { key: "actions", label: "Actions", align: "right", mobileRole: "actions" },
            ]}
          >
            {tableStatus === "loading" && <TableEmptyState colSpan={4} message="Loading keys..." />}
            {tableStatus === "error" && <TableEmptyState colSpan={4} message="Unable to load keys." tone="error" />}
            {tableStatus === "empty" && <TableEmptyState colSpan={4} message="No keys." />}
            {filteredKeys.map((key) => {
              const active = isKeyActive(key);
              const locked = Boolean(key.is_ui_managed);
              return (
                <tr key={key.access_key_id} className={cx("hover:bg-slate-50 dark:hover:bg-slate-800/50", !active && managerTableMutedRowClass)}>
                  <td className={cx(managerTablePrimaryCellClass, "font-mono")}>
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
                  <td className={cx(managerTableCellClass, "text-slate-700 dark:text-slate-200")}>
                    {key.status ?? (active ? "Active" : "Inactive")}
                  </td>
                  <td className={managerTableCellClass}>{formatDate(key.created_at)}</td>
                  <td className={managerTableActionCellClass}>
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
          </ManagerTable>
        </div>
      )}
    </div>
  );
}
