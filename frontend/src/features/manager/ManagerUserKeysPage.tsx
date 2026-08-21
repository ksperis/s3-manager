/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { S3AccountSelector } from "../../api/accountParams";
import {
  AccessKey,
  createIamAccessKey,
  deleteIamAccessKey,
  listIamAccessKeys,
  updateIamAccessKeyStatus,
} from "../../api/managerIamUsers";
import { useS3AccountContext } from "./S3AccountContext";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import ListPageSection from "../../components/list/ListPageSection";
import OneTimeSecretPanel from "../../components/OneTimeSecretPanel";
import PageBanner from "../../components/PageBanner";
import PageShell from "../../components/PageShell";
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
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";

function extractError(err: unknown): string {
  return extractApiError(err, "Unexpected error");
}

export default function ManagerUserKeysPage() {
  const { userName } = useParams<{ userName: string }>();
  const { selectedS3AccountType, accountIdForApi, requiresS3AccountSelection, accessMode } = useS3AccountContext();
  const needsS3AccountSelection = requiresS3AccountSelection && !accountIdForApi;
  const isS3User = selectedS3AccountType === "s3_user";
  const [keys, setKeys] = useState<AccessKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<AccessKey | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const keyConfirmation = useConfirmActionDialog();

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

  const load = useCallback(async (accountId: S3AccountSelector, targetUser: string) => {
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
  }, []);

  useEffect(() => {
    if (needsS3AccountSelection || isS3User) {
      setKeys([]);
      setLoading(false);
      return;
    }
    if (userName) {
      load(accountIdForApi, userName);
    }
  }, [accountIdForApi, needsS3AccountSelection, isS3User, userName, accessMode, load]);

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

  const deleteKey = async (keyId: string) => {
    if (needsS3AccountSelection || !userName) return;
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

  const toggleKey = async (keyId: string, nextActive: boolean) => {
    if (needsS3AccountSelection || !userName) return;
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

  const handleDeleteKey = (keyId: string) => {
    keyConfirmation.requestConfirmation({
      title: "Delete IAM access key?",
      description: "Permanently remove this access key from the IAM user.",
      confirmLabel: "Delete key",
      details: [
        { label: "User", value: pageTitle },
        { label: "Access key", value: keyId, mono: true },
      ],
      impacts: ["Applications using this key will immediately lose access."],
      onConfirm: () => deleteKey(keyId),
    });
  };

  const handleToggleKey = (keyId: string, nextActive: boolean) => {
    if (nextActive) {
      void toggleKey(keyId, true);
      return;
    }
    keyConfirmation.requestConfirmation({
      title: "Disable IAM access key?",
      description: "Temporarily prevent this access key from authenticating.",
      confirmLabel: "Disable key",
      details: [
        { label: "User", value: pageTitle },
        { label: "Access key", value: keyId, mono: true },
      ],
      impacts: ["Applications using this key will lose access until the key is enabled again."],
      onConfirm: () => toggleKey(keyId, false),
    });
  };

  const pageTitle = useMemo(() => {
    if (!userName) return "";
    try {
      return decodeURIComponent(userName);
    } catch {
      return userName;
    }
  }, [userName]);

  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: keys.length,
  });

  if (isS3User) {
    return (
      <PageShell
          title="User access keys"
          description="Rotate IAM access keys for a specific user."
          breadcrumbs={managerPageBreadcrumbs("users", { label: "Access keys" })}
      >
        <PageBanner tone="info">IAM users are not available for standalone S3 users. Select an S3 Account to continue.</PageBanner>
      </PageShell>
    );
  }

  if (!userName) {
    return <div className="ui-body text-slate-600">User not specified.</div>;
  }

  if (needsS3AccountSelection) {
    return <div className="ui-body text-slate-600">Select an account before managing keys.</div>;
  }

  return (
    <PageShell
      title="IAM access keys"
      description={
        <>
          Manage access keys for <span className="font-semibold text-slate-700 dark:text-slate-100">{pageTitle}</span>.
        </>
      }
      breadcrumbs={managerPageBreadcrumbs(
        "users",
        { label: pageTitle },
        { label: "Access keys" },
      )}
      actions={[
        { label: "← Back to users", to: "/manager/users", variant: "ghost" },
        { label: "Attached policies", to: `/manager/users/${encodeURIComponent(pageTitle)}/policies`, variant: "ghost" },
        {
          label: busy === "create" ? "Creating..." : "New key",
          onClick: handleCreateKey,
          variant: "primary",
        },
      ]}
    >

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

      <ListPageSection
          title="Keys"
          description="IAM access keys for this user."
          countLabel={`${keys.length} key${keys.length === 1 ? "" : "s"}`}
      >
        <ManagerTable
          responsiveCards
          columns={[
            { key: "access-key", label: "Access key", mobileRole: "primary" },
            { key: "status", label: "Status" },
            { key: "created", label: "Created on" },
            { key: "actions", label: "Actions", align: "right", mobileRole: "actions" },
          ]}
          listState={{
            status: tableStatus,
            loadingMessage: "Loading keys...",
            errorMessage: "Unable to load keys.",
            emptyMessage: "No keys for this user.",
          }}
        >
          {keys.map((k) => {
            const active = isKeyActive(k);
            const managed = Boolean(k.is_private_access_managed);
            return (
              <tr key={k.access_key_id} className={cx("hover:bg-slate-50 dark:hover:bg-slate-800/50", !active && managerTableMutedRowClass)}>
                <td className={cx(managerTablePrimaryCellClass, "font-mono")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{k.access_key_id}</span>
                    {managed && <span className="rounded border px-1.5 py-0.5 text-[10px] font-semibold">Private access</span>}
                  </div>
                </td>
                <td className={cx(managerTableCellClass, "text-slate-700 dark:text-slate-200")}>
                  {k.status ?? (active ? "Active" : "Inactive")}
                </td>
                <td className={managerTableCellClass}>{formatDate(k.created_at)}</td>
                <td className={managerTableActionCellClass}>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggleKey(k.access_key_id, !active)}
                      className={tableActionButtonClasses}
                      disabled={Boolean(busy) || managed}
                      title={managed ? "Update the linked private connection instead" : undefined}
                    >
                      {busy === `toggle:${k.access_key_id}` ? "Saving..." : active ? "Disable" : "Enable"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteKey(k.access_key_id)}
                      className={tableDeleteActionClasses}
                      disabled={Boolean(busy) || managed}
                      title={managed ? "Delete the linked private connection instead" : undefined}
                    >
                      {busy === `delete:${k.access_key_id}` ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </ManagerTable>
      </ListPageSection>

      {keyConfirmation.confirmationDialog}

    </PageShell>
  );
}
