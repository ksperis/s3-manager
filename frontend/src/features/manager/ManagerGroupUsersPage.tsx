/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { S3AccountSelector } from "../../api/accountParams";
import { IAMUser, listIamUsers } from "../../api/managerIamUsers";
import { addIamGroupUser, listIamGroupUsers, removeIamGroupUser } from "../../api/managerIamGroups";
import { useS3AccountContext } from "./S3AccountContext";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import TableEmptyState from "../../components/TableEmptyState";
import { confirmAction } from "../../utils/confirm";

export default function ManagerGroupUsersPage() {
  const { groupName } = useParams<{ groupName: string }>();
  const { selectedS3AccountType, accountIdForApi, requiresS3AccountSelection } = useS3AccountContext();
  const needsS3AccountSelection = requiresS3AccountSelection && !accountIdForApi;
  const isS3User = selectedS3AccountType === "s3_user";
  if (isS3User) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Group members"
          description="Manage IAM group membership."
          breadcrumbs={[{ label: "Manager" }, { label: "IAM" }, { label: "Groups" }, { label: "Users" }]}
        />
        <PageBanner tone="info">IAM features are disabled for standalone S3 users. Select an S3 Account to continue.</PageBanner>
      </div>
    );
  }
  const [users, setUsers] = useState<IAMUser[]>([]);
  const [allUsers, setAllUsers] = useState<IAMUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newUser, setNewUser] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const decodedGroup = useMemo(() => {
    if (!groupName) return "";
    try {
      return decodeURIComponent(groupName);
    } catch {
      return groupName;
    }
  }, [groupName]);

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

  const load = async (accountId: S3AccountSelector, targetGroup: string) => {
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
  };

  useEffect(() => {
    if (needsS3AccountSelection) {
      setUsers([]);
      setAllUsers([]);
      setLoading(false);
      return;
    }
    if (groupName) {
      load(accountIdForApi, groupName);
    }
  }, [accountIdForApi, needsS3AccountSelection, groupName]);

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

  const handleRemove = async (userName: string) => {
    if (needsS3AccountSelection || !groupName) return;
    if (!confirmAction(`Remove ${userName} from the group?`)) return;
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

  if (!groupName) {
    return <div className="text-sm text-slate-600">Group not specified.</div>;
  }

  if (needsS3AccountSelection) {
    return <div className="text-sm text-slate-600">Select an account before managing groups.</div>;
  }

  const handleRefresh = () => {
    if (needsS3AccountSelection) return;
    if (groupName) {
      load(accountIdForApi, groupName);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Group members"
        description={
          <>
            Manage users for <span className="font-semibold text-slate-700 dark:text-slate-100">{decodedGroup}</span>.
          </>
        }
        breadcrumbs={[
          { label: "Manager" },
          { label: "IAM", to: "/manager/groups" },
          { label: decodedGroup },
          { label: "Users" },
        ]}
        actions={[
          { label: "← Back to groups", to: "/manager/groups", variant: "ghost" },
          { label: "Attached policies", to: `/manager/groups/${encodeURIComponent(decodedGroup)}/policies`, variant: "ghost" },
          { label: "Refresh", onClick: handleRefresh, variant: "ghost" },
        ]}
      />

      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {error && <PageBanner tone="error">{error}</PageBanner>}
      {noAvailableUsers && (
        <PageBanner tone="warning">No IAM users available to add. Create one before managing this group.</PageBanner>
      )}

      <form
        onSubmit={handleAdd}
        className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <select
            value={newUser}
            onChange={(e) => setNewUser(e.target.value)}
            className="flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-sky-500 disabled:opacity-60"
          >
            {busy === "add" ? "Adding..." : "Add"}
          </button>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Users come from IAM. Add them here to attach them to the group.
        </p>
      </form>

      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <table className="manager-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
          <thead className="bg-slate-50 dark:bg-slate-900/50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">User</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">ARN</th>
              <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {loading && <TableEmptyState colSpan={3} message="Loading members..." />}
            {!loading && users.length === 0 && (
              <TableEmptyState colSpan={3} message="No members in this group." />
            )}
            {!loading &&
              users.map((u) => (
                <tr key={u.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="manager-table-cell px-6 py-4 text-sm font-medium text-slate-800 dark:text-slate-100">{u.name}</td>
                  <td className="manager-table-cell px-6 py-4 text-sm text-slate-600 dark:text-slate-300">{u.arn ?? "-"}</td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => handleRemove(u.name)}
                      className="text-sm font-medium text-rose-600 hover:text-rose-700 disabled:opacity-60 dark:text-rose-200 dark:hover:text-rose-100"
                      disabled={busy === u.name}
                    >
                      {busy === u.name ? "Removing..." : "Remove"}
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
