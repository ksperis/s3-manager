/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState } from "react";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import PageTabs from "../../components/PageTabs";
import UiBadge from "../../components/ui/UiBadge";
import UiCard from "../../components/ui/UiCard";
import UiProgressBar from "../../components/ui/UiProgressBar";
import { formatBytes } from "../../utils/format";
import type { PortalWorkspaceTransfer } from "./portalWorkspaceModel";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

const tabs = ["All", "Uploads", "Downloads"];

function statusTone(status: PortalWorkspaceTransfer["status"]) {
  if (status === "Failed") return "danger";
  if (status === "Uploading" || status === "Queued") return "primary";
  return "neutral";
}

export default function PortalTransfersPage() {
  const [activeTab, setActiveTab] = useState("All");
  const { workspace, loading, error, hasAccountContext, accountError, accountLoading } = usePortalWorkspaceData();
  const transfers = useMemo(() => {
    if (activeTab === "Uploads") return workspace.transfers.filter((transfer) => transfer.direction === "Upload");
    if (activeTab === "Downloads") return workspace.transfers.filter((transfer) => transfer.direction === "Download");
    return workspace.transfers;
  }, [activeTab, workspace.transfers]);

  if (accountLoading || loading) {
    return <div className="space-y-4"><PageBanner tone="info">Loading transfers...</PageBanner></div>;
  }

  if (accountError || error || !hasAccountContext) {
    return <div className="space-y-4"><PageBanner tone={accountError || error ? "error" : "info"}>{accountError ?? error ?? "Select an account."}</PageBanner></div>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Transfers"
        description="Monitor ongoing and completed transfers."
        breadcrumbs={[{ label: "Portal" }, { label: "Transfers" }]}
      />
      <UiCard>
        <div className="mb-3 border-b border-slate-200 pb-3 dark:border-slate-800">
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
                  <td className="font-bold text-slate-950">{transfer.name}</td>
                  <td>{transfer.direction}</td>
                  <td><UiBadge tone={statusTone(transfer.status)}>{transfer.status}</UiBadge></td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="w-28"><UiProgressBar value={transfer.progress} /></div>
                      <span>{transfer.progress}%</span>
                    </div>
                  </td>
                  <td>{transfer.speedLabel}</td>
                  <td>{transfer.startedLabel}</td>
                  <td>{transfer.etaLabel}</td>
                  <td className="max-w-[240px] truncate text-xs text-slate-500">
                    {transfer.errorMessage ?? (transfer.status === "Failed" ? "Failure details unavailable." : "-")}
                  </td>
                </tr>
              ))}
              {transfers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-xs font-semibold text-slate-500">
                    No transfers to display.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="mt-3 text-[11px] text-slate-400">Total visible size: {formatBytes(transfers.reduce((sum, transfer) => sum + (transfer.sizeBytes ?? 0), 0))}</div>
      </UiCard>
    </div>
  );
}
