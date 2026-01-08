/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import { PortalMember, PortalRoleKey, listPortalMembers, updatePortalMemberRole } from "../../api/portal";
import { usePortalAccountContext } from "./PortalAccountContext";

function Badge({ label, tone }: { label: string; tone: "slate" | "sky" | "emerald" }) {
  const tones: Record<string, string> = {
    slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    sky: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-100",
    emerald: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100",
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 ui-caption font-semibold ${tones[tone]}`}>{label}</span>;
}

const ROLE_OPTIONS: PortalRoleKey[] = ["Viewer", "AccessAdmin", "AccountAdmin"];

export default function PortalUsersPage() {
  const { accountIdForApi, portalContext } = usePortalAccountContext();
  const [members, setMembers] = useState<PortalMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingUserId, setSavingUserId] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const canView = portalContext?.permissions?.includes("portal.members.view") ?? false;
  const canManage = portalContext?.permissions?.includes("portal.members.manage") ?? false;

  const load = useCallback(async () => {
    if (!accountIdForApi || !canView) {
      setMembers([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await listPortalMembers(accountIdForApi);
      setMembers(data);
    } catch (err) {
      console.error(err);
      setError("Unable to load members.");
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [accountIdForApi, canView]);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(() => {
    const next = [...members];
    next.sort((a, b) => a.email.localeCompare(b.email));
    return next;
  }, [members]);

  const handleRoleChange = async (userId: number, role: PortalRoleKey) => {
    if (!accountIdForApi || !canManage) return;
    setSavingUserId(userId);
    setSaveError(null);
    try {
      const updated = await updatePortalMemberRole(accountIdForApi, userId, role);
      setMembers((prev) => prev.map((m) => (m.user_id === userId ? updated : m)));
    } catch (err) {
      console.error(err);
      setSaveError("Unable to update member role.");
    } finally {
      setSavingUserId(null);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Users" description="Portal members for the selected account." />

      {!canView && <PageBanner tone="warning">You do not have permission to view members.</PageBanner>}
      {error && <PageBanner tone="error">{error}</PageBanner>}
      {saveError && <PageBanner tone="error">{saveError}</PageBanner>}
      {loading && <PageBanner tone="info">Loading…</PageBanner>}

      {canView && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <table className="w-full table-fixed">
            <thead className="bg-slate-50 dark:bg-slate-900">
              <tr className="text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <th className="w-1/2 px-4 py-3">User</th>
                <th className="w-1/4 px-4 py-3">Role</th>
                <th className="w-1/4 px-4 py-3">External</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((member) => (
                <tr key={member.user_id} className="border-t border-slate-200/70 dark:border-slate-800">
                  <td className="px-4 py-3 ui-body text-slate-900 dark:text-slate-100">{member.email}</td>
                  <td className="px-4 py-3">
                    {canManage ? (
                      <select
                        value={member.portal_role}
                        onChange={(e) => handleRoleChange(member.user_id, e.target.value as PortalRoleKey)}
                        disabled={savingUserId === member.user_id}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 ui-body text-slate-700 shadow-sm transition focus:border-primary focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      >
                        {ROLE_OPTIONS.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Badge label={member.portal_role} tone="sky" />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {member.external_enabled ? <Badge label="Enabled" tone="emerald" /> : <Badge label="Portal-only" tone="slate" />}
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 ui-body text-slate-500 dark:text-slate-400">
                    No members found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

