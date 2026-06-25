/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Fragment, useMemo, useState } from "react";
import PageHeader from "../../components/PageHeader";
import UiCard from "../../components/ui/UiCard";
import { cx, uiCardMutedClass, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import { resolvePortalWorkspacePageState } from "./portalUi";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

export default function PortalActivityPage() {
  const [actionFilter, setActionFilter] = useState("All actions");
  const [spaceFilter, setSpaceFilter] = useState("All storage spaces");
  const [expandedActivityId, setExpandedActivityId] = useState<string | null>(null);
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

  const pageState = resolvePortalWorkspacePageState({
    accountLoading,
    loading,
    accountError,
    error,
    hasAccountContext,
    loadingMessage: "Loading activity...",
    noAccountMessage: "Select an account to view activity.",
  });
  if (pageState) return pageState;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Activity"
        description="Overview of actions in your account."
        breadcrumbs={portalBreadcrumbs({ label: "Activity" })}
        rightContent={<div className={cx(uiCardMutedClass, "px-3 py-2 text-xs font-semibold", uiMutedTextClass)}>Current period</div>}
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
          <table className="ui-data-table min-w-[760px]">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Action</th>
                <th>Resource</th>
                <th>Storage Space</th>
                <th className="text-right">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const expanded = expandedActivityId === item.id;
                return (
                  <Fragment key={item.id}>
                    <tr>
                      <td>{item.timeLabel}</td>
                      <td className={uiTitleTextClass}>{item.actor}</td>
                      <td>{item.action}</td>
                      <td>{item.target}</td>
                      <td>{item.spaceName}</td>
                      <td className="text-right">
                        <button
                          type="button"
                          onClick={() => setExpandedActivityId(expanded ? null : item.id)}
                          className="text-xs font-bold text-primary hover:text-primary-600 dark:text-primary-200 dark:hover:text-primary-100"
                        >
                          {expanded ? "Hide details" : "Show details"}
                        </button>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr>
                        <td colSpan={6}>
                          <dl className={cx(uiCardMutedClass, "grid gap-2 px-3 py-2 text-xs sm:grid-cols-[140px_1fr]")}>
                            <dt className={cx("font-semibold", uiMutedTextClass)}>IP address</dt>
                            <dd className={uiTitleTextClass}>{item.ipAddress || "-"}</dd>
                          </dl>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
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
