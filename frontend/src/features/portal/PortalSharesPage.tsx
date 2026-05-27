/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState } from "react";
import { PortalV3Badge, PortalV3Card, PortalV3Page, PortalV3PageHeader } from "./PortalV3Components";
import type { PortalWorkspaceRole, PortalWorkspaceShare } from "./portalWorkspaceMockData";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

const tabs = [
  { id: "with", label: "Shared with me" },
  { id: "by", label: "Shared by me" },
  { id: "links", label: "Public links" },
];

function roleTone(role: PortalWorkspaceRole) {
  if (role === "Owner") return "blue";
  if (role === "Editor") return "green";
  return "neutral";
}

function SharesTable({ shares }: { shares: PortalWorkspaceShare[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="portal-v3-table min-w-[720px]">
        <thead>
          <tr>
            <th>Name</th>
            <th>Shared by</th>
            <th>Access</th>
            <th>Expires</th>
            <th>Activity</th>
          </tr>
        </thead>
        <tbody>
          {shares.map((share) => (
            <tr key={share.id}>
              <td className="font-bold text-slate-950">{share.spaceName}</td>
              <td>{share.person}</td>
              <td><PortalV3Badge tone={roleTone(share.access)}>{share.access}</PortalV3Badge></td>
              <td>{share.expiresLabel ?? "-"}</td>
              <td>{share.activityLabel}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PortalSharesPage() {
  const [activeTab, setActiveTab] = useState("with");
  const { workspace, loading, error, hasAccountContext, accountError, accountLoading } = usePortalWorkspaceData();
  const shares = activeTab === "with" ? workspace.sharesWithMe : activeTab === "by" ? workspace.sharesByMe : workspace.publicLinks;

  if (accountLoading || loading) {
    return <PortalV3Page><div className="portal-v3-card p-6 text-sm font-semibold text-slate-600">Loading shares...</div></PortalV3Page>;
  }

  if (accountError || error || !hasAccountContext) {
    return <PortalV3Page><div className="portal-v3-card p-6 text-sm font-semibold text-slate-600">{accountError ?? error ?? "Select an account."}</div></PortalV3Page>;
  }

  return (
    <PortalV3Page>
      <PortalV3PageHeader title="Shares" description="Manage shared links and permissions." />
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
        <SharesTable shares={shares} />
        <div className="mt-4 flex items-center justify-between text-[11px] font-semibold text-slate-500">
          <span>1-{shares.length} of {shares.length}</span>
          <span>‹ 1 2 3 4 ›</span>
        </div>
      </PortalV3Card>

      <PortalV3Card title="Create a new share">
        <div className="grid gap-3 md:grid-cols-[1fr_160px_170px_auto]">
          <input className="ui-control h-8 text-xs" value="photos/2024" readOnly />
          <select className="ui-control h-8 py-1.5 text-xs" value="Viewer" readOnly>
            <option>Viewer</option>
            <option>Editor</option>
          </select>
          <input className="ui-control h-8 text-xs" value="06/20/2024" readOnly />
          <button type="button" className="h-8 rounded-md bg-blue-600 px-3 text-xs font-bold text-white">
            Create share
          </button>
        </div>
      </PortalV3Card>
    </PortalV3Page>
  );
}
