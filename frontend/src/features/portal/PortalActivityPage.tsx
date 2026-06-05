/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState } from "react";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import UiCard from "../../components/ui/UiCard";
import { cx, uiCardMutedClass, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
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
    return <div className="space-y-4"><PageBanner tone="info">Loading activity...</PageBanner></div>;
  }

  if (accountError || error || !hasAccountContext) {
    return <div className="space-y-4"><PageBanner tone={accountError || error ? "error" : "info"}>{accountError ?? error ?? "Select an account."}</PageBanner></div>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Activity"
        description="Overview of actions in your account."
        breadcrumbs={[{ label: "Portal" }, { label: "Activity" }]}
        right={<div className={cx(uiCardMutedClass, "px-3 py-2 text-xs font-semibold", uiMutedTextClass)}>Current period</div>}
      />

      <UiCard>
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
          <table className="ui-data-table min-w-[860px]">
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
                  <td className={uiTitleTextClass}>{item.actor}</td>
                  <td>{item.action}</td>
                  <td>{item.target}</td>
                  <td>{item.spaceName}</td>
                  <td>{item.ipAddress}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className={cx("py-6 text-center text-xs font-semibold", uiMutedTextClass)}>
                    No activity to display.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className={cx("mt-4 flex items-center justify-between text-[11px] font-semibold", uiMutedTextClass)}>
          <span>{rows.length} of {workspace.activity.length}</span>
        </div>
      </UiCard>
    </div>
  );
}
