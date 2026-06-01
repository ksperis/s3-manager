/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState } from "react";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import { storageSpacePath, type PortalWorkspaceAccess, type PortalWorkspaceSpace } from "./portalWorkspaceModel";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";
import {
  PortalV3Badge,
  PortalV3Card,
  PortalV3Link,
  PortalV3Page,
  PortalV3PageHeader,
  PortalV3Search,
} from "./PortalV3Components";

function statusTone(space: PortalWorkspaceSpace) {
  if (space.status === "Attention") return "amber";
  if (space.status === "Shared") return "blue";
  return "green";
}

function accessTone(access: PortalWorkspaceAccess) {
  if (access === "Public") return "rose";
  if (access === "Public Read") return "amber";
  return "neutral";
}

export default function PortalStorageSpacesPage() {
  const { workspace, loading, error, hasAccountContext, accountError, accountLoading } = usePortalWorkspaceData();
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSpaces = useMemo(() => {
    if (!normalizedQuery) return workspace.spaces;
    return workspace.spaces.filter((space) => space.name.toLowerCase().includes(normalizedQuery));
  }, [normalizedQuery, workspace.spaces]);

  if (accountLoading || loading) {
    return <PortalV3Page><div className="portal-v3-card p-6 text-sm font-semibold text-slate-600">Loading storage spaces...</div></PortalV3Page>;
  }

  if (accountError || error) {
    return <PortalV3Page><div className="portal-v3-card p-6 text-sm font-semibold text-rose-600">{accountError ?? error}</div></PortalV3Page>;
  }

  if (!hasAccountContext) {
    return <PortalV3Page><div className="portal-v3-card p-6 text-sm font-semibold text-slate-600">Select an account to view storage spaces.</div></PortalV3Page>;
  }

  return (
    <PortalV3Page>
      <PortalV3PageHeader
        title="Storage Spaces"
        description="Manage your storage spaces and their configuration."
      />

      <PortalV3Card>
        <div className="mb-4 max-w-xs">
          <PortalV3Search value={query} onChange={setQuery} placeholder="Search storage spaces..." />
        </div>
        <div className="overflow-x-auto">
          <table className="portal-v3-table min-w-[840px]">
            <thead>
              <tr>
                <th>Name</th>
                <th>Objects</th>
                <th>Size</th>
                <th>Created</th>
                <th>Region</th>
                <th>Status</th>
                <th>Access</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredSpaces.map((space) => (
                <tr key={space.id}>
                  <td className="font-bold text-slate-950">{space.name}</td>
                  <td>{formatCompactNumber(space.objectCount)}</td>
                  <td>{formatBytes(space.usedBytes)}</td>
                  <td>{space.createdLabel}</td>
                  <td>{space.region}</td>
                  <td><PortalV3Badge tone={statusTone(space)}>{space.status === "Active" ? "Enabled" : space.status}</PortalV3Badge></td>
                  <td><PortalV3Badge tone={accessTone(space.access)}>{space.access}</PortalV3Badge></td>
                  <td className="text-right"><PortalV3Link to={storageSpacePath(space)}>Open</PortalV3Link></td>
                </tr>
              ))}
              {filteredSpaces.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-xs font-semibold text-slate-500">
                    No Storage Spaces to display.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex items-center justify-between text-[11px] font-semibold text-slate-500">
          <span>{filteredSpaces.length} of {workspace.spaces.length}</span>
        </div>
      </PortalV3Card>
    </PortalV3Page>
  );
}
