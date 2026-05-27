/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { PortalV3Badge, PortalV3Card, PortalV3Page, PortalV3PageHeader, PortalV3Search } from "./PortalV3Components";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";
import { useState, type ReactNode } from "react";

function Shell({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: string;
  children: ReactNode;
}) {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <PortalV3Page>
      <PortalV3PageHeader
        title={title}
        description={description}
        actions={action ? [{ label: action, onClick: () => setMessage(`${action.replace("+ ", "")} is mocked in this UX preview.`) }] : []}
      />
      {message ? <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">{message}</div> : null}
      {children}
    </PortalV3Page>
  );
}

export function PortalUsersPage() {
  const { workspace } = usePortalWorkspaceData();
  const [query, setQuery] = useState("");
  const rows = workspace.adminUsers.filter((user) => user.username.toLowerCase().includes(query.toLowerCase()));
  return (
    <Shell title="Users" description="Manage users and their access." action="+ Create user">
      <PortalV3Card>
        <div className="mb-4 max-w-xs"><PortalV3Search value={query} onChange={setQuery} placeholder="Search users..." /></div>
        <div className="overflow-x-auto">
          <table className="portal-v3-table min-w-[720px]">
            <thead><tr><th>Username</th><th>Groups</th><th>Status</th><th>MFA</th><th>Last active</th></tr></thead>
            <tbody>
              {rows.map((user) => (
                <tr key={user.username}>
                  <td className="font-bold text-slate-950">{user.username}</td>
                  <td>{user.groups}</td>
                  <td><PortalV3Badge tone={user.status === "Active" ? "green" : "neutral"}>{user.status}</PortalV3Badge></td>
                  <td><PortalV3Badge tone={user.mfa === "Enabled" ? "green" : "neutral"}>{user.mfa}</PortalV3Badge></td>
                  <td>{user.lastActive}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PortalV3Card>
    </Shell>
  );
}

export function PortalGroupsPage() {
  const { workspace } = usePortalWorkspaceData();
  const [query, setQuery] = useState("");
  const rows = workspace.groups.filter((group) => group.name.toLowerCase().includes(query.toLowerCase()));
  return (
    <Shell title="Groups" description="Organize users and manage group policies." action="+ Create group">
      <PortalV3Card>
        <div className="mb-4 max-w-xs"><PortalV3Search value={query} onChange={setQuery} placeholder="Search groups..." /></div>
        <div className="overflow-x-auto">
          <table className="portal-v3-table min-w-[700px]">
            <thead><tr><th>Group name</th><th>Users</th><th>Policies</th><th>Description</th></tr></thead>
            <tbody>
              {rows.map((group) => (
                <tr key={group.name}>
                  <td className="font-bold text-slate-950">{group.name}</td>
                  <td>{group.users}</td>
                  <td>{group.policies}</td>
                  <td>{group.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PortalV3Card>
    </Shell>
  );
}

export function PortalPoliciesPage() {
  const { workspace } = usePortalWorkspaceData();
  const [query, setQuery] = useState("");
  const rows = workspace.policies.filter((policy) => policy.name.toLowerCase().includes(query.toLowerCase()));
  return (
    <Shell title="Policies" description="Review simple access profiles." action="+ Create policy">
      <PortalV3Card>
        <div className="mb-4 max-w-xs"><PortalV3Search value={query} onChange={setQuery} placeholder="Search policies..." /></div>
        <div className="overflow-x-auto">
          <table className="portal-v3-table min-w-[760px]">
            <thead><tr><th>Policy name</th><th>Type</th><th>Used by</th><th>Last modified</th></tr></thead>
            <tbody>
              {rows.map((policy) => (
                <tr key={policy.name}>
                  <td className="font-bold text-slate-950">{policy.name}</td>
                  <td>{policy.type}</td>
                  <td>{policy.usedBy}</td>
                  <td>{policy.lastModified}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PortalV3Card>
    </Shell>
  );
}

export function PortalAccessKeysPage() {
  const { workspace } = usePortalWorkspaceData();
  return (
    <Shell title="Access Keys" description="Review masked keys for this workspace.">
      <PortalV3Card>
        <div className="overflow-x-auto">
          <table className="portal-v3-table min-w-[720px]">
            <thead><tr><th>Name</th><th>Owner</th><th>Status</th><th>Created</th><th>Last used</th></tr></thead>
            <tbody>
              {workspace.accessKeys.map((key) => (
                <tr key={key.name}>
                  <td className="font-bold text-slate-950">{key.name}</td>
                  <td>{key.owner}</td>
                  <td><PortalV3Badge tone={key.status === "Active" ? "green" : "neutral"}>{key.status}</PortalV3Badge></td>
                  <td>{key.created}</td>
                  <td>{key.lastUsed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PortalV3Card>
    </Shell>
  );
}
