/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState } from "react";
import PageHeader from "../../components/PageHeader";
import PageTabs from "../../components/PageTabs";
import UiBadge from "../../components/ui/UiBadge";
import UiCard from "../../components/ui/UiCard";
import UiProgressBar from "../../components/ui/UiProgressBar";
import { cx, uiDividerClass, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { formatBytes } from "../../utils/format";
import {
  portalTransferStatusTone,
  resolvePortalWorkspacePageState,
} from "./portalUi";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

const tabs = ["All", "Uploads", "Downloads"];

export default function PortalTransfersPage() {
  const [activeTab, setActiveTab] = useState("All");
  const { workspace, loading, error, hasAccountContext, accountError, accountLoading } = usePortalWorkspaceData();
  const transfers = useMemo(() => {
    if (activeTab === "Uploads") return workspace.transfers.filter((transfer) => transfer.direction === "Upload");
    if (activeTab === "Downloads") return workspace.transfers.filter((transfer) => transfer.direction === "Download");
    return workspace.transfers;
  }, [activeTab, workspace.transfers]);

  const pageState = resolvePortalWorkspacePageState({
    accountLoading,
    loading,
    accountError,
    error,
    hasAccountContext,
    loadingMessage: "Loading transfers...",
    noAccountMessage: "Select an account to view transfers.",
  });
  if (pageState) return pageState;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Transfers"
        description="Monitor ongoing and completed transfers."
        breadcrumbs={[{ label: "Portal" }, { label: "Transfers" }]}
      />
      <UiCard>
        <div className={cx("mb-3 border-b pb-3", uiDividerClass)}>
          <PageTabs
            tabs={tabs.map((tab) => ({ id: tab, label: tab }))}
            activeTab={activeTab}
            onChange={setActiveTab}
            variant="bar"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="ui-data-table min-w-[850px]">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Speed</th>
                <th>Started</th>
                <th>ETA</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((transfer) => (
                <tr key={transfer.id}>
                  <td className={cx("font-bold", uiTitleTextClass)}>{transfer.name}</td>
                  <td>{transfer.direction}</td>
                  <td><UiBadge tone={portalTransferStatusTone(transfer.status)}>{transfer.status}</UiBadge></td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="w-28"><UiProgressBar value={transfer.progress} /></div>
                      <span>{transfer.progress}%</span>
                    </div>
                  </td>
                  <td>{transfer.speedLabel}</td>
                  <td>{transfer.startedLabel}</td>
                  <td>{transfer.etaLabel}</td>
                  <td className={cx("max-w-[240px] truncate text-xs", uiMutedTextClass)}>
                    {transfer.errorMessage ?? (transfer.status === "Failed" ? "Failure details unavailable." : "-")}
                  </td>
                </tr>
              ))}
              {transfers.length === 0 ? (
                <tr>
                  <td colSpan={8} className={cx("py-6 text-center text-xs font-semibold", uiMutedTextClass)}>
                    No transfers to display.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className={cx("mt-3 text-[11px]", uiMutedTextClass)}>Total visible size: {formatBytes(transfers.reduce((sum, transfer) => sum + (transfer.sizeBytes ?? 0), 0))}</div>
      </UiCard>
    </div>
  );
}
