/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import {
  grantPortalStorageSpaceShare,
  listPortalStorageSpaceShares,
  revokePortalStorageSpaceShare,
  updatePortalStorageSpaceShare,
  type PortalStorageSpaceRole,
  type PortalStorageSpaceShare,
} from "../../api/portal";
import { extractApiError } from "../../utils/apiError";
import { PortalV3Badge, PortalV3Card, PortalV3Page, PortalV3PageHeader } from "./PortalV3Components";
import type { PortalWorkspaceRole } from "./portalWorkspaceModel";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

const tabs = [
  { id: "with", label: "Shared with me" },
  { id: "by", label: "Shared by me" },
  { id: "links", label: "Public links" },
] as const;

const roles: PortalStorageSpaceRole[] = ["Viewer", "Editor", "Owner"];

type ShareTab = (typeof tabs)[number]["id"];
type ShareRow = {
  id: string;
  userId?: number | null;
  spaceId: string;
  spaceName: string;
  person: string;
  access: PortalWorkspaceRole;
  expiresLabel?: string;
  activityLabel: string;
};

function roleTone(role: PortalWorkspaceRole) {
  if (role === "Owner") return "blue";
  if (role === "Editor") return "green";
  return "neutral";
}

function fromApiShare(share: PortalStorageSpaceShare): ShareRow {
  return {
    id: share.id,
    userId: share.user_id,
    spaceId: share.storage_space_id,
    spaceName: share.storage_space_name,
    person: share.email,
    access: share.role,
    activityLabel: share.activity_label ?? "Active",
  };
}

function SharesTable({
  shares,
  editable,
  busyShareId,
  onRoleChange,
  onRevoke,
}: {
  shares: ShareRow[];
  editable: boolean;
  busyShareId: string | null;
  onRoleChange: (share: ShareRow, role: PortalStorageSpaceRole) => void;
  onRevoke: (share: ShareRow) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="portal-v3-table min-w-[760px]">
        <thead>
          <tr>
            <th>Name</th>
            <th>{editable ? "Shared with" : "Shared by"}</th>
            <th>Access</th>
            <th>Expires</th>
            <th>Activity</th>
            {editable ? <th className="w-28 text-right">Action</th> : null}
          </tr>
        </thead>
        <tbody>
          {shares.map((share) => (
            <tr key={share.id}>
              <td className="font-bold text-slate-950">{share.spaceName}</td>
              <td>{share.person}</td>
              <td>
                {editable && share.userId ? (
                  <select
                    className="ui-control h-8 py-1.5 text-xs"
                    value={share.access}
                    disabled={busyShareId === share.id}
                    onChange={(event) => onRoleChange(share, event.target.value as PortalStorageSpaceRole)}
                    aria-label={`Access for ${share.person}`}
                  >
                    {roles.map((role) => (
                      <option key={role} value={role}>{role}</option>
                    ))}
                  </select>
                ) : (
                  <PortalV3Badge tone={roleTone(share.access)}>{share.access}</PortalV3Badge>
                )}
              </td>
              <td>{share.expiresLabel ?? "-"}</td>
              <td>{share.activityLabel}</td>
              {editable ? (
                <td className="text-right">
                  {share.userId ? (
                    <button
                      type="button"
                      disabled={busyShareId === share.id}
                      onClick={() => onRevoke(share)}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 shadow-sm hover:border-rose-200 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Revoke
                    </button>
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
          {shares.length === 0 ? (
            <tr>
              <td colSpan={editable ? 6 : 5} className="py-6 text-center text-xs font-semibold text-slate-500">
                No shares to display.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export default function PortalSharesPage() {
  const [activeTab, setActiveTab] = useState<ShareTab>("with");
  const [apiShares, setApiShares] = useState<PortalStorageSpaceShare[] | null>(null);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [sharesError, setSharesError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [selectedSpaceId, setSelectedSpaceId] = useState("");
  const [selectedRole, setSelectedRole] = useState<PortalStorageSpaceRole>("Viewer");
  const [busyShareId, setBusyShareId] = useState<string | null>(null);
  const { workspace, loading, error, hasAccountContext, accountError, accountLoading, accountIdForApi } = usePortalWorkspaceData();

  const spaceIds = useMemo(() => workspace.spaces.map((space) => space.id).join("|"), [workspace.spaces]);

  useEffect(() => {
    if (!selectedSpaceId && workspace.spaces[0]) {
      setSelectedSpaceId(workspace.spaces[0].id);
    }
  }, [selectedSpaceId, workspace.spaces]);

  useEffect(() => {
    let cancelled = false;
    if (!accountIdForApi || workspace.spaces.length === 0) {
      setApiShares(null);
      setSharesLoading(false);
      setSharesError(null);
      return () => {
        cancelled = true;
      };
    }
    setSharesLoading(true);
    setSharesError(null);
    Promise.all(workspace.spaces.map((space) => listPortalStorageSpaceShares(accountIdForApi, space.id)))
      .then((results) => {
        if (!cancelled) setApiShares(results.flat());
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setApiShares(null);
          setSharesError(extractApiError(err, "Unable to load shares."));
        }
      })
      .finally(() => {
        if (!cancelled) setSharesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, spaceIds, workspace.spaces]);

  const rows = useMemo(() => {
    return {
      with: (apiShares ?? []).filter((share) => share.direction === "with_me").map(fromApiShare),
      by: (apiShares ?? []).filter((share) => share.direction === "by_me").map(fromApiShare),
      links: [],
    };
  }, [apiShares]);

  const refreshSpaceShares = async (spaceId: string) => {
    if (!accountIdForApi) return;
    const updated = await listPortalStorageSpaceShares(accountIdForApi, spaceId);
    setApiShares((current) => {
      const rest = (current ?? []).filter((share) => share.storage_space_id !== spaceId);
      return [...rest, ...updated];
    });
  };

  const handleCreateShare = async () => {
    if (!accountIdForApi || !selectedSpaceId || !email.trim()) return;
    setBusyShareId("new");
    setSharesError(null);
    try {
      const share = await grantPortalStorageSpaceShare(accountIdForApi, selectedSpaceId, {
        email: email.trim(),
        role: selectedRole,
      });
      setEmail("");
      setApiShares((current) => {
        const filtered = (current ?? []).filter((item) => item.id !== share.id);
        return [...filtered, share];
      });
      setActiveTab("by");
    } catch (err) {
      console.error(err);
      setSharesError(extractApiError(err, "Unable to create share."));
    } finally {
      setBusyShareId(null);
    }
  };

  const handleRoleChange = async (share: ShareRow, role: PortalStorageSpaceRole) => {
    if (!accountIdForApi || !share.userId) return;
    setBusyShareId(share.id);
    setSharesError(null);
    try {
      const updated = await updatePortalStorageSpaceShare(accountIdForApi, share.spaceId, share.userId, role);
      setApiShares((current) => (current ?? []).map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      console.error(err);
      setSharesError(extractApiError(err, "Unable to update share."));
    } finally {
      setBusyShareId(null);
    }
  };

  const handleRevoke = async (share: ShareRow) => {
    if (!accountIdForApi || !share.userId) return;
    setBusyShareId(share.id);
    setSharesError(null);
    try {
      await revokePortalStorageSpaceShare(accountIdForApi, share.spaceId, share.userId);
      await refreshSpaceShares(share.spaceId);
    } catch (err) {
      console.error(err);
      setSharesError(extractApiError(err, "Unable to revoke share."));
    } finally {
      setBusyShareId(null);
    }
  };

  const shares = rows[activeTab];

  if (accountLoading || loading) {
    return <PortalV3Page><div className="portal-v3-card p-6 text-sm font-semibold text-slate-600">Loading shares...</div></PortalV3Page>;
  }

  if (accountError || error || !hasAccountContext) {
    return <PortalV3Page><div className="portal-v3-card p-6 text-sm font-semibold text-slate-600">{accountError ?? error ?? "Select an account."}</div></PortalV3Page>;
  }

  return (
    <PortalV3Page>
      <PortalV3PageHeader title="Shares" description="Manage shared access with Viewer, Editor, and Owner roles." />
      {sharesError ? (
        <div className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
          {sharesError}
        </div>
      ) : null}
      <PortalV3Card>
        <div className="mb-3 flex gap-7 border-b border-slate-100">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={activeTab === tab.id ? "portal-v3-tab portal-v3-tab-active" : "portal-v3-tab"}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {sharesLoading ? <div className="mb-3 text-xs font-semibold text-slate-500">Loading share permissions...</div> : null}
        {activeTab === "links" ? (
          <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-6 text-center text-xs font-semibold text-slate-500">
            Public link management is unavailable in Portal for this release.
          </div>
        ) : (
          <SharesTable
            shares={shares}
            editable={activeTab === "by"}
            busyShareId={busyShareId}
            onRoleChange={handleRoleChange}
            onRevoke={handleRevoke}
          />
        )}
        <div className="mt-4 flex items-center justify-between text-[11px] font-semibold text-slate-500">
          <span>{shares.length} of {shares.length}</span>
        </div>
      </PortalV3Card>

      {activeTab !== "links" ? (
        <PortalV3Card title="Create a new share">
          <div className="grid gap-3 md:grid-cols-[1fr_180px_160px_auto]">
            <select className="ui-control h-8 py-1.5 text-xs" value={selectedSpaceId} onChange={(event) => setSelectedSpaceId(event.target.value)}>
              {workspace.spaces.map((space) => (
                <option key={space.id} value={space.id}>{space.name}</option>
              ))}
            </select>
            <input
              className="ui-control h-8 text-xs"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="user@example.com"
            />
            <select className="ui-control h-8 py-1.5 text-xs" value={selectedRole} onChange={(event) => setSelectedRole(event.target.value as PortalStorageSpaceRole)}>
              {roles.map((role) => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={!accountIdForApi || !selectedSpaceId || !email.trim() || busyShareId === "new"}
              onClick={handleCreateShare}
              className="h-8 rounded-md bg-blue-600 px-3 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              Create share
            </button>
          </div>
        </PortalV3Card>
      ) : null}
    </PortalV3Page>
  );
}
