/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import {
  createPortalStorageSpacePublicLink,
  grantPortalStorageSpaceShare,
  listPortalStorageSpacePublicLinks,
  listPortalStorageSpaceShares,
  revokePortalStorageSpacePublicLink,
  type PortalPublicLink,
  revokePortalStorageSpaceShare,
  updatePortalStorageSpaceShare,
  type PortalStorageSpaceRole,
  type PortalStorageSpaceShare,
} from "../../api/portal";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import PageTabs from "../../components/PageTabs";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import { extractApiError } from "../../utils/apiError";
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
  if (role === "Owner") return "primary";
  if (role === "Editor") return "success";
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
      <table className="ui-data-table min-w-[760px]">
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
                  <UiBadge tone={roleTone(share.access)}>{share.access}</UiBadge>
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
                      className={tableDeleteActionClasses}
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
  const [publicLinks, setPublicLinks] = useState<PortalPublicLink[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [sharesError, setSharesError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [selectedSpaceId, setSelectedSpaceId] = useState("");
  const [selectedRole, setSelectedRole] = useState<PortalStorageSpaceRole>("Viewer");
  const [publicObjectKey, setPublicObjectKey] = useState("");
  const [publicLinkExpiration, setPublicLinkExpiration] = useState("");
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

  useEffect(() => {
    let cancelled = false;
    if (!accountIdForApi || workspace.spaces.length === 0) {
      setPublicLinks([]);
      return () => {
        cancelled = true;
      };
    }
    Promise.all(
      workspace.spaces
        .filter((space) => space.role === "Owner")
        .map((space) => listPortalStorageSpacePublicLinks(accountIdForApi, space.id, { includeRevoked: true }))
    )
      .then((results) => {
        if (!cancelled) setPublicLinks(results.flat());
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setPublicLinks([]);
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
    if (!window.confirm(`Revoke access for ${share.person} on ${share.spaceName}?`)) return;
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

  const handleCreatePublicLink = async () => {
    if (!accountIdForApi || !selectedSpaceId || !publicObjectKey.trim()) return;
    setBusyShareId("public-link");
    setSharesError(null);
    try {
      const link = await createPortalStorageSpacePublicLink(accountIdForApi, selectedSpaceId, {
        object_key: publicObjectKey.trim(),
        label: publicObjectKey.trim().split("/").filter(Boolean).at(-1) ?? publicObjectKey.trim(),
        expires_at: publicLinkExpiration ? new Date(publicLinkExpiration).toISOString() : null,
      });
      setPublicLinks((current) => [link, ...current.filter((item) => item.id !== link.id)]);
      setPublicObjectKey("");
      setActiveTab("links");
    } catch (err) {
      console.error(err);
      setSharesError(extractApiError(err, "Unable to create public link."));
    } finally {
      setBusyShareId(null);
    }
  };

  const handleRevokePublicLink = async (link: PortalPublicLink) => {
    if (!accountIdForApi) return;
    if (!window.confirm(`Revoke public link for ${link.object_name}?`)) return;
    setBusyShareId(`public-link-${link.id}`);
    setSharesError(null);
    try {
      const updated = await revokePortalStorageSpacePublicLink(accountIdForApi, link.storage_space_id, link.id);
      setPublicLinks((current) => [
        ...current.filter((item) => item.storage_space_id !== link.storage_space_id),
        ...updated,
      ]);
    } catch (err) {
      console.error(err);
      setSharesError(extractApiError(err, "Unable to revoke public link."));
    } finally {
      setBusyShareId(null);
    }
  };

  const shares = rows[activeTab];

  if (accountLoading || loading) {
    return <div className="space-y-4"><PageBanner tone="info">Loading shares...</PageBanner></div>;
  }

  if (accountError || error || !hasAccountContext) {
    return <div className="space-y-4"><PageBanner tone={accountError || error ? "error" : "info"}>{accountError ?? error ?? "Select an account."}</PageBanner></div>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Shares"
        description="Manage shared access with Viewer, Editor, and Owner roles."
        breadcrumbs={[{ label: "Portal" }, { label: "Shares" }]}
      />
      {sharesError ? <PageBanner tone="warning">{sharesError}</PageBanner> : null}
      <UiCard>
        <div className="mb-3 border-b border-slate-200 pb-3 dark:border-slate-800">
          <PageTabs tabs={[...tabs]} activeTab={activeTab} onChange={(tab) => setActiveTab(tab as ShareTab)} variant="bar" />
        </div>
        {sharesLoading ? <div className="mb-3 text-xs font-semibold text-slate-500">Loading share permissions...</div> : null}
        {activeTab === "links" ? (
          <div className="overflow-x-auto">
            <table className="ui-data-table min-w-[860px]">
              <thead>
                <tr>
                  <th>Storage Space</th>
                  <th>Object</th>
                  <th>Status</th>
                  <th>Expires</th>
                  <th>URL</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {publicLinks.map((link) => (
                  <tr key={link.id}>
                    <td className="font-bold text-slate-950">{link.storage_space_name}</td>
                    <td>{link.object_name}</td>
                    <td><UiBadge tone={link.status === "Active" ? "success" : "neutral"}>{link.status}</UiBadge></td>
                    <td>{link.expires_at ? new Date(link.expires_at).toLocaleDateString() : "-"}</td>
                    <td className="max-w-[260px] truncate text-blue-700">{link.url}</td>
                    <td className="text-right">
                      {link.status === "Active" ? (
                        <button
                          type="button"
                          disabled={busyShareId === `public-link-${link.id}`}
                          onClick={() => handleRevokePublicLink(link)}
                          className={tableDeleteActionClasses}
                        >
                          Revoke
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {publicLinks.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-xs font-semibold text-slate-500">
                      No public links to display.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
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
      </UiCard>

      {activeTab !== "links" ? (
        <UiCard title="Create a new share">
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
              className={tableActionButtonClasses}
            >
              Create share
            </button>
          </div>
        </UiCard>
      ) : (
        <UiCard title="Create a public link">
          <div className="grid gap-3 md:grid-cols-[180px_1fr_220px_auto]">
            <select className="ui-control h-8 py-1.5 text-xs" value={selectedSpaceId} onChange={(event) => setSelectedSpaceId(event.target.value)}>
              {workspace.spaces.filter((space) => space.role === "Owner").map((space) => (
                <option key={space.id} value={space.id}>{space.name}</option>
              ))}
            </select>
            <input className="ui-control h-8 text-xs" value={publicObjectKey} onChange={(event) => setPublicObjectKey(event.target.value)} placeholder="path/to/object.ext" />
            <input type="datetime-local" className="ui-control h-8 text-xs" value={publicLinkExpiration} onChange={(event) => setPublicLinkExpiration(event.target.value)} aria-label="Public link expiration" />
            <UiButton
              disabled={!accountIdForApi || !selectedSpaceId || !publicObjectKey.trim() || busyShareId === "public-link"}
              onClick={handleCreatePublicLink}
              className="h-8 px-3 py-1.5"
            >
              Create link
            </UiButton>
          </div>
        </UiCard>
      )}
    </div>
  );
}
