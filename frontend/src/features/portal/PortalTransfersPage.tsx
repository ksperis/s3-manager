/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState } from "react";
import { formatBytes } from "../../utils/format";
import { PortalV3Badge, PortalV3Card, PortalV3Page, PortalV3PageHeader, PortalV3Progress } from "./PortalV3Components";
import type { PortalWorkspaceTransfer } from "./portalWorkspaceModel";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

const tabs = ["All", "Uploads", "Downloads"];

function statusTone(status: PortalWorkspaceTransfer["status"]) {
  if (status === "Failed") return "rose";
  if (status === "Uploading" || status === "Queued") return "blue";
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
    return <PortalV3Page><div className="portal-v3-card p-6 text-sm font-semibold text-slate-600">Loading transfers...</div></PortalV3Page>;
  }

  if (accountError || error || !hasAccountContext) {
    return <PortalV3Page><div className="portal-v3-card p-6 text-sm font-semibold text-slate-600">{accountError ?? error ?? "Select an account."}</div></PortalV3Page>;
  }

  return (
    <PortalV3Page>
      <PortalV3PageHeader title="Transfers" description="Monitor ongoing and completed transfers." />
      <PortalV3Card>
        <div className="mb-3 flex gap-7 border-b border-slate-100">
          {tabs.map((tab) => (
            <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={activeTab === tab ? "portal-v3-tab portal-v3-tab-active" : "portal-v3-tab"}>
              {tab}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="portal-v3-table min-w-[850px]">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Speed</th>
                <th>Started</th>
                <th>ETA</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((transfer) => (
                <tr key={transfer.id}>
                  <td className="font-bold text-slate-950">{transfer.name}</td>
                  <td>{transfer.direction}</td>
                  <td><PortalV3Badge tone={statusTone(transfer.status)}>{transfer.status}</PortalV3Badge></td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="w-28"><PortalV3Progress value={transfer.progress} /></div>
                      <span>{transfer.progress}%</span>
                    </div>
                  </td>
                  <td>{transfer.speedLabel}</td>
                  <td>{transfer.startedLabel}</td>
                  <td>{transfer.etaLabel}</td>
                </tr>
              ))}
              {transfers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-xs font-semibold text-slate-500">
                    No transfers to display.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="mt-3 text-[11px] text-slate-400">Total visible size: {formatBytes(transfers.reduce((sum, transfer) => sum + (transfer.sizeBytes ?? 0), 0))}</div>
      </PortalV3Card>
    </PortalV3Page>
  );
}
