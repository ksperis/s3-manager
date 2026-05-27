/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState } from "react";
import { PortalV3Card, PortalV3Page, PortalV3PageHeader } from "./PortalV3Components";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

export default function PortalActivityPage() {
  const [actionFilter, setActionFilter] = useState("All actions");
  const [spaceFilter, setSpaceFilter] = useState("All storage spaces");
  const { workspace, loading, error, hasAccountContext, accountError, accountLoading } = usePortalWorkspaceData();
  const actionOptions = useMemo(
    () => ["All actions", ...Array.from(new Set(workspace.activity.map((item) => item.action))).sort()],
    [workspace.activity]
  );
  const rows = useMemo(
    () =>
      workspace.activity.filter((item) => {
        const actionMatch = actionFilter === "All actions" || item.action === actionFilter;
        const spaceMatch = spaceFilter === "All storage spaces" || item.spaceName === spaceFilter;
        return actionMatch && spaceMatch;
      }),
    [actionFilter, spaceFilter, workspace.activity]
  );

  if (accountLoading || loading) {
    return <PortalV3Page><div className="portal-v3-card p-6 text-sm font-semibold text-slate-600">Loading activity...</div></PortalV3Page>;
  }

  if (accountError || error || !hasAccountContext) {
    return <PortalV3Page><div className="portal-v3-card p-6 text-sm font-semibold text-slate-600">{accountError ?? error ?? "Select an account."}</div></PortalV3Page>;
  }

  return (
    <PortalV3Page>
      <PortalV3PageHeader
        title="Activity"
        description="Real-time overview of actions in your account."
        right={<div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">May 10 - Jun 10, 2024</div>}
      />

      <PortalV3Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <select className="ui-control h-8 w-44 py-1.5 text-xs" value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}>
            {actionOptions.map((action) => (
              <option key={action}>{action}</option>
            ))}
          </select>
          <select className="ui-control h-8 w-52 py-1.5 text-xs" value={spaceFilter} onChange={(event) => setSpaceFilter(event.target.value)}>
            <option>All storage spaces</option>
            {workspace.spaces.map((space) => (
              <option key={space.id}>{space.name}</option>
            ))}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="portal-v3-table min-w-[860px]">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Action</th>
                <th>Resource</th>
                <th>Storage Space</th>
                <th>IP Address</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.id}>
                  <td>{item.timeLabel}</td>
                  <td className="font-bold text-slate-950">{item.actor}</td>
                  <td>{item.action}</td>
                  <td>{item.target}</td>
                  <td>{item.spaceName}</td>
                  <td>{item.ipAddress}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-xs font-semibold text-slate-500">
                    No activity to display.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex items-center justify-between text-[11px] font-semibold text-slate-500">
          <span>1-{rows.length} of {workspace.activity.length}</span>
          <span>‹ 1 2 3 4 ... 28 ›</span>
        </div>
      </PortalV3Card>
    </PortalV3Page>
  );
}
