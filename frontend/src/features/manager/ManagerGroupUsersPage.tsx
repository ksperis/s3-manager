/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { S3AccountSelector } from "../../api/accountParams";
import { IAMUser, listIamUsers } from "../../api/managerIamUsers";
import { addIamGroupUser, listIamGroupUsers, removeIamGroupUser } from "../../api/managerIamGroups";
import { useS3AccountContext } from "./S3AccountContext";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import PageShell from "../../components/PageShell";
import PageBanner from "../../components/PageBanner";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { extractApiError } from "../../utils/apiError";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";

function extractError(err: unknown): string {
  return extractApiError(err, "Unexpected error");
}

export default function ManagerGroupUsersPage() {
  const { groupName } = useParams<{ groupName: string }>();
  const { selectedS3AccountType, accountIdForApi, requiresS3AccountSelection, accessMode } = useS3AccountContext();
  const needsS3AccountSelection = requiresS3AccountSelection && !accountIdForApi;
  const isS3User = selectedS3AccountType === "s3_user";

  const [users, setUsers] = useState<IAMUser[]>([]);
  const [allUsers, setAllUsers] = useState<IAMUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newUser, setNewUser] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const memberConfirmation = useConfirmActionDialog();

  const decodedGroup = useMemo(() => {
    if (!groupName) return "";
    try {
      return decodeURIComponent(groupName);
    } catch {
      return groupName;
    }
  }, [groupName]);

  const load = useCallback(async (accountId: S3AccountSelector, targetGroup: string) => {
    setLoading(true);
    setError(null);
    try {
      const [members, existingUsers] = await Promise.all([
        listIamGroupUsers(accountId, targetGroup),
        listIamUsers(accountId),
      ]);
      setUsers(members);
      setAllUsers(existingUsers);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isS3User || needsS3AccountSelection) {
      setUsers([]);
      setAllUsers([]);
      setLoading(false);
      return;
    }
    if (groupName) {
      load(accountIdForApi, groupName);
    }
  }, [accountIdForApi, isS3User, needsS3AccountSelection, groupName, accessMode, load]);

  const availableUsers = useMemo(
    () => allUsers.filter((u) => !users.some((member) => member.name === u.name)),
    [allUsers, users]
  );
  const noAvailableUsers = availableUsers.length === 0;

  useEffect(() => {
    if (newUser && !availableUsers.some((u) => u.name === newUser)) {
      setNewUser("");
    }
  }, [availableUsers, newUser]);

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (needsS3AccountSelection || !groupName || !newUser.trim()) return;
    setBusy("add");
    setError(null);
    setActionMessage(null);
    try {
      await addIamGroupUser(accountIdForApi, groupName, newUser.trim());
      setNewUser("");
      await load(accountIdForApi, groupName);
      setActionMessage("User added to group");
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  };

  const removeUser = async (userName: string) => {
    if (needsS3AccountSelection || !groupName) return;
    setBusy(userName);
    setError(null);
    setActionMessage(null);
    try {
      await removeIamGroupUser(accountIdForApi, groupName, userName);
      await load(accountIdForApi, groupName);
      setActionMessage("User removed from group");
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = (userName: string) => {
    memberConfirmation.requestConfirmation({
      title: "Remove user from group?",
      description: "Detach this IAM user from the selected group.",
      confirmLabel: "Remove user",
      details: [
        { label: "Group", value: decodedGroup },
        { label: "User", value: userName },
      ],
      impacts: ["Permissions inherited only through this group will no longer apply to the user."],
      onConfirm: () => removeUser(userName),
    });
  };

  if (isS3User) {
    return (
      <PageShell
          title="Group members"
          description="Manage IAM group membership."
          breadcrumbs={managerPageBreadcrumbs("groups", { label: "Users" })}
      >
        <PageBanner tone="info">IAM features are disabled for standalone S3 users. Select an S3 Account to continue.</PageBanner>
      </PageShell>
    );
  }

  if (!groupName) {
    return <div className="ui-body text-slate-600">Group not specified.</div>;
  }

  if (needsS3AccountSelection) {
    return <div className="ui-body text-slate-600">Select an account before managing groups.</div>;
  }

  const handleRefresh = () => {
    if (needsS3AccountSelection) return;
    if (groupName) {
      load(accountIdForApi, groupName);
    }
  };

  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: users.length,
  });
  const userColumns: Array<DataTableColumn<IAMUser>> = [
    {
      id: "user",
      label: "User",
      primary: true,
      render: (user) => user.name,
    },
    {
      id: "arn",
      label: "ARN",
      cellClassName: "break-all font-mono text-[11px]",
      render: (user) => user.arn ?? "-",
    },
    {
      id: "actions",
      label: "Actions",
      align: "right",
      mobileRole: "actions",
      render: (user) => (
        <button
          type="button"
          onClick={() => handleRemove(user.name)}
          className="ui-caption font-semibold text-rose-600 hover:text-rose-700 disabled:opacity-60 dark:text-rose-200 dark:hover:text-rose-100"
          disabled={busy === user.name}
        >
          {busy === user.name ? "Removing..." : "Remove"}
        </button>
      ),
    },
  ];

  return (
    <PageShell
      title="Group members"
      description={
        <>
          Manage users for <span className="font-semibold text-slate-700 dark:text-slate-100">{decodedGroup}</span>.
        </>
      }
      breadcrumbs={managerPageBreadcrumbs(
        "groups",
        { label: decodedGroup },
        { label: "Users" },
      )}
      actions={[
        { label: "← Back to groups", to: "/manager/groups", variant: "ghost" },
        { label: "Attached policies", to: `/manager/groups/${encodeURIComponent(decodedGroup)}/policies`, variant: "ghost" },
        { label: "Refresh", onClick: handleRefresh, variant: "ghost" },
      ]}
    >

      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {error && <PageBanner tone="error">{error}</PageBanner>}
      {noAvailableUsers && (
        <PageBanner tone="warning">No IAM users available to add. Create one before managing this group.</PageBanner>
      )}

      <form
        onSubmit={handleAdd}
        className="space-y-3 ui-surface-card p-4"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <select
            value={newUser}
            onChange={(e) => setNewUser(e.target.value)}
            className="flex-1 rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            <option value="">Select an existing user</option>
            {availableUsers.map((u) => (
              <option key={u.name} value={u.name}>
                {u.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busy !== null || !newUser}
            className="rounded-md bg-primary px-4 py-2 ui-body font-medium text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
          >
            {busy === "add" ? "Adding..." : "Add"}
          </button>
        </div>
        <p className="ui-caption text-slate-500 dark:text-slate-400">
          Users come from IAM. Add them here to attach them to the group.
        </p>
      </form>

      <div className="ui-surface-card">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">Users</p>
          <p className="ui-caption text-slate-500 dark:text-slate-400">Members of this group.</p>
        </div>
        <DataTableShell
          columns={userColumns}
          rows={users}
          rowKey={(user) => user.name}
          status={tableStatus}
          loadingMessage="Loading members..."
          errorMessage="Unable to load users."
          emptyMessage="No members in this group."
          tableClassName="compact-table"
          responsiveCards
        />
      </div>
      {memberConfirmation.confirmationDialog}
    </PageShell>
  );
}
