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
import AddS3ConnectionFromKeyModal from "../../components/AddS3ConnectionFromKeyModal";
import ListToolbar from "../../components/ListToolbar";
import OneTimeSecretPanel from "../../components/OneTimeSecretPanel";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import ManagerTable, {
  managerTableActionCellClass,
  managerTableCellClass,
  managerTableMutedRowClass,
  managerTablePrimaryCellClass,
} from "../../components/list/ManagerTable";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import UiButton from "../../components/ui/UiButton";
import { cx } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { confirmAction } from "../../utils/confirm";
import { buildManagerConnectionDefaults } from "../shared/s3ConnectionFromKey";

function extractError(err: unknown): string {
  return extractApiError(err, "Unexpected error");
}

export default function ManagerUserKeysPage() {
  const { userName } = useParams<{ userName: string }>();
  const { selectedS3AccountType, accountIdForApi, requiresS3AccountSelection, accessMode, accounts } = useS3AccountContext();
  const needsS3AccountSelection = requiresS3AccountSelection && !accountIdForApi;
  const isS3User = selectedS3AccountType === "s3_user";
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
        <OneTimeSecretPanel
          title={`Key created for ${pageTitle}`}
          description="The secret is shown only once."
          badge="Copy these values now"
          actions={
            <UiButton
              type="button"
              variant="secondary"
              size="xs"
              onClick={() => setShowAddConnectionModal(true)}
              disabled={!createdKey.secret_access_key}
            >
              Add as S3 Connection
            </UiButton>
          }
          values={[
            { label: "Access key", value: createdKey.access_key_id, copyLabel: "Copy" },
            { label: "Secret key", value: createdKey.secret_access_key, copyLabel: "Copy" },
          ]}
        />
      )}

      <div className="ui-surface-card">
        <ListToolbar
          title="Keys"
          description="IAM access keys for this user."
          showHeading={false}
          countLabel={`${keys.length} key${keys.length === 1 ? "" : "s"}`}
        />
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
            return (
              <tr key={k.access_key_id} className={cx("hover:bg-slate-50 dark:hover:bg-slate-800/50", !active && managerTableMutedRowClass)}>
                <td className={cx(managerTablePrimaryCellClass, "font-mono")}>{k.access_key_id}</td>
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
                </td>
              </tr>
            );
          })}
        </ManagerTable>
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
