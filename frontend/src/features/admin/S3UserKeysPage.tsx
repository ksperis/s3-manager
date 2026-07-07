/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  CreatedS3UserAccessKey,
  S3User,
  S3UserAccessKey,
  createS3UserKey,
  deleteS3UserKey,
  getS3User,
  listS3UserKeys,
  rotateS3UserKeys,
  updateS3UserKeyStatus,
} from "../../api/s3Users";
import OneTimeSecretPanel from "../../components/OneTimeSecretPanel";
import PageHeader from "../../components/PageHeader";
import { adminBreadcrumbs } from "./adminBreadcrumbs";
import PageBanner from "../../components/PageBanner";
import TableEmptyState from "../../components/TableEmptyState";
import ListSectionCard from "../../components/list/ListSectionCard";
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

export default function S3UserKeysPage() {
  const { userId } = useParams<{ userId: string }>();
  const numericUserId = userId ? Number(userId) : NaN;
  const [user, setUser] = useState<S3User | null>(null);
  const [keys, setKeys] = useState<S3UserAccessKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<CreatedS3UserAccessKey | null>(null);

  const extractError = (err: unknown): string => extractApiError(err, "Unexpected error");

  const formatDate = (value?: string | null) => {
    if (!value) return "-";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
  };

  const isKeyActive = (key: S3UserAccessKey): boolean => {
    if (key.is_active !== undefined && key.is_active !== null) return Boolean(key.is_active);
    if (key.status) {
      const normalized = key.status.toLowerCase();
      if (["inactive", "disabled", "suspended"].includes(normalized)) return false;
      if (["active", "enabled"].includes(normalized)) return true;
    }
    return true;
  };

  const loadUser = useCallback(async () => {
    if (!Number.isFinite(numericUserId)) return;
    try {
      const data = await getS3User(numericUserId);
      setUser(data);
    } catch (err) {
      setError(extractError(err));
    }
  }, [numericUserId]);

  const loadKeys = useCallback(async () => {
    if (!Number.isFinite(numericUserId)) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listS3UserKeys(numericUserId);
      setKeys(data);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  }, [numericUserId]);

  useEffect(() => {
    if (!Number.isFinite(numericUserId)) {
      setError("Invalid user id.");
      return;
    }
    loadUser();
    loadKeys();
  }, [loadKeys, loadUser, numericUserId]);

  const handleCreateKey = async () => {
    if (!Number.isFinite(numericUserId)) return;
    setBusy("create");
    setError(null);
    setActionMessage(null);
    try {
      const key = await createS3UserKey(numericUserId);
      setCreatedKey(key);
      await loadKeys();
      setActionMessage("Access key created.");
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  };

  const handleDeleteKey = async (accessKeyId: string) => {
    if (!Number.isFinite(numericUserId)) return;
    if (!confirmAction(`Delete key ${accessKeyId}?`)) return;
    setBusy(`delete:${accessKeyId}`);
    setError(null);
    setActionMessage(null);
    try {
      await deleteS3UserKey(numericUserId, accessKeyId);
      await loadKeys();
      setActionMessage("Access key deleted.");
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  };

  const handleToggleKey = async (accessKeyId: string, nextActive: boolean) => {
    if (!Number.isFinite(numericUserId)) return;
    if (!nextActive && !confirmAction(`Disable key ${accessKeyId}?`)) return;
    setBusy(`toggle:${accessKeyId}`);
    setError(null);
    setActionMessage(null);
    try {
      await updateS3UserKeyStatus(numericUserId, accessKeyId, nextActive);
      await loadKeys();
      setActionMessage(nextActive ? "Access key enabled." : "Access key disabled.");
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  };

  const handleRotateUiKey = async () => {
    if (!Number.isFinite(numericUserId)) return;
    setBusy("rotate");
    setError(null);
    setActionMessage(null);
    try {
      await rotateS3UserKeys(numericUserId);
      await Promise.all([loadUser(), loadKeys()]);
      setActionMessage("Interface key rotated.");
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  };

  const pageTitle = useMemo(() => {
    if (user?.name) return user.name;
    if (userId) return `User #${userId}`;
    return "User";
  }, [user?.name, userId]);

  const interfaceKey = keys.find((k) => k.is_ui_managed);
  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: keys.length,
  });

  if (!userId || Number.isNaN(numericUserId)) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="User access keys"
          description="Manage RGW keys for the selected user."
          breadcrumbs={adminBreadcrumbs({ label: "Users", to: "/admin/s3-users" }, { label: "Access keys" })}
        />
        <PageBanner tone="error">Invalid user id provided.</PageBanner>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="User access keys"
        description={
          <>
            Manage keys for <span className="font-semibold text-slate-700 dark:text-slate-100">{pageTitle}</span>.
          </>
        }
        breadcrumbs={adminBreadcrumbs({ label: "Users", to: "/admin/s3-users" }, { label: pageTitle }, { label: "Access keys" })}
        actions={[
          { label: "← Back to users", to: "/admin/s3-users", variant: "ghost" },
          {
            label: busy === "create" ? "Creating..." : "New key",
            onClick: handleCreateKey,
            variant: "primary",
          },
        ]}
      />

      {interfaceKey && (
        <PageBanner tone="info">
          The interface key is reserved for the console. Delete other keys as needed, and rotate the interface key instead of deleting it.
        </PageBanner>
      )}

      {error && <PageBanner tone="error">{error}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}

      {createdKey && createdKey.secret_access_key && (
        <OneTimeSecretPanel
          title={`Key created for ${pageTitle}`}
          description="The secret is shown only once."
          badge="Copy these values now"
          values={[
            { label: "Access key", value: createdKey.access_key_id, copyLabel: "Copy" },
            { label: "Secret key", value: createdKey.secret_access_key, copyLabel: "Copy" },
          ]}
        />
      )}

      <ListSectionCard
        title="Keys"
        subtitle={`${keys.length} key${keys.length === 1 ? "" : "s"}`}
      >
        <ManagerTable
          responsiveCards
          columns={[
            { key: "access-key", label: "Access key", mobileRole: "primary" },
            { key: "status", label: "Status" },
            { key: "created", label: "Created on" },
            { key: "usage", label: "Usage" },
            { key: "actions", label: "Actions", align: "right", mobileRole: "actions" },
          ]}
        >
          {tableStatus === "loading" && <TableEmptyState colSpan={5} message="Loading keys..." />}
          {tableStatus === "error" && <TableEmptyState colSpan={5} message="Unable to load keys." tone="error" />}
          {tableStatus === "empty" && <TableEmptyState colSpan={5} message="No keys for this user." />}
          {keys.map((k) => {
            const active = isKeyActive(k);
            return (
              <tr key={k.access_key_id} className={cx("hover:bg-slate-50 dark:hover:bg-slate-800/50", !active && managerTableMutedRowClass)}>
                <td className={cx(managerTablePrimaryCellClass, "font-mono")}>{k.access_key_id}</td>
                <td className={cx(managerTableCellClass, "text-slate-700 dark:text-slate-200")}>
                  {active ? k.status ?? "Active" : k.status ?? "Disabled"}
                </td>
                <td className={managerTableCellClass}>{formatDate(k.created_at)}</td>
                <td className={managerTableCellClass}>
                  {k.is_ui_managed ? (
                    <span className="rounded-full bg-slate-100 px-2 py-1 ui-caption font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      Interface key
                    </span>
                  ) : (
                    <span className="ui-caption text-slate-500 dark:text-slate-400">Custom</span>
                  )}
                </td>
                <td className={managerTableActionCellClass}>
                  {k.is_ui_managed ? (
                    <button
                      type="button"
                      onClick={handleRotateUiKey}
                      className={tableActionButtonClasses}
                      disabled={busy === "rotate"}
                    >
                      {busy === "rotate" ? "Rotating..." : "Rotate"}
                    </button>
                  ) : (
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleToggleKey(k.access_key_id, !active)}
                        className={tableActionButtonClasses}
                        disabled={Boolean(busy)}
                      >
                        {busy === `toggle:${k.access_key_id}` ? "Saving..." : active ? "Disable" : "Enable"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteKey(k.access_key_id)}
                        className={tableDeleteActionClasses}
                        disabled={Boolean(busy)}
                      >
                        {busy === `delete:${k.access_key_id}` ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </ManagerTable>
      </ListSectionCard>
    </div>
  );
}
