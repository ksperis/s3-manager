/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import { fetchHealthWorkspaceOverview, WorkspaceEndpointHealthOverviewResponse } from "../../api/healthchecks";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import WorkspaceNavCards from "../../components/WorkspaceNavCards";
import WorkspaceContextStrip from "../../components/WorkspaceContextStrip";
import WorkspaceEndpointHealthCards from "../../components/WorkspaceEndpointHealthCards";
import { extractApiError } from "../../utils/apiError";
import { useCephAdminEndpoint } from "./CephAdminEndpointContext";
import useCephAdminWorkspaceContextStrip from "./useCephAdminWorkspaceContextStrip";

type CardLink = {
  title: string;
  description: string;
  to: string;
};

const cards: CardLink[] = [
  { title: "Metrics", description: "Cluster-wide view of RGW storage and traffic.", to: "/ceph-admin/metrics" },
  { title: "RGW Accounts", description: "Create/import RGW tenants and manage their quotas.", to: "/ceph-admin/accounts" },
  { title: "RGW Users", description: "Manage cluster-wide RGW users.", to: "/ceph-admin/users" },
  { title: "Buckets", description: "List and configure cluster-wide buckets (Admin Ops + S3).", to: "/ceph-admin/buckets" },
];

export default function CephAdminDashboard() {
  const { generalSettings } = useGeneralSettings();
  const { selectedEndpoint } = useCephAdminEndpoint();
  const [workspaceHealth, setWorkspaceHealth] = useState<WorkspaceEndpointHealthOverviewResponse | null>(null);
  const [workspaceHealthLoading, setWorkspaceHealthLoading] = useState(false);
  const [workspaceHealthError, setWorkspaceHealthError] = useState<string | null>(null);
  const contextStrip = useCephAdminWorkspaceContextStrip({
    description: "Ceph Admin stays endpoint-scoped. Endpoint-wide credentials and capabilities apply to the workflows below.",
  });

  useEffect(() => {
    if (!generalSettings.endpoint_status_enabled || !selectedEndpoint?.id) {
      setWorkspaceHealth(null);
      setWorkspaceHealthError(null);
      setWorkspaceHealthLoading(false);
      return;
    }
    let cancelled = false;
    setWorkspaceHealthLoading(true);
    setWorkspaceHealthError(null);
    fetchHealthWorkspaceOverview(selectedEndpoint.id)
      .then((data) => {
        if (cancelled) return;
        setWorkspaceHealth(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setWorkspaceHealth(null);
        setWorkspaceHealthError(extractApiError(err, "Unable to load endpoint health for this endpoint."));
      })
      .finally(() => {
        if (!cancelled) {
          setWorkspaceHealthLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [generalSettings.endpoint_status_enabled, selectedEndpoint?.id]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Ceph Admin"
        description={`Cluster-level RGW administration. Active endpoint: ${selectedEndpoint?.name ?? "—"}.`}
        breadcrumbs={[{ label: "Ceph Admin" }]}
      />
      <WorkspaceContextStrip {...contextStrip} />
      {!selectedEndpoint?.id ? (
        <PageEmptyState
          title="Select a Ceph endpoint before using Ceph Admin"
          description="Cluster-level workflows stay visible, but bucket, account, user, and metrics actions remain unavailable until an endpoint is selected."
          primaryAction={{ label: "Open buckets", to: "/ceph-admin/buckets" }}
          tone="warning"
        />
      ) : null}
      {generalSettings.endpoint_status_enabled && selectedEndpoint?.id && (
        <WorkspaceEndpointHealthCards
          data={workspaceHealth}
          loading={workspaceHealthLoading}
          error={workspaceHealthError}
          title="Endpoint Health"
          showStatusCounters={false}
          action={
            selectedEndpoint?.id
              ? { to: `/admin/endpoint-status/${selectedEndpoint.id}`, label: "View details" }
              : undefined
          }
          className="grid gap-4"
        />
      )}
      {selectedEndpoint?.id ? <WorkspaceNavCards items={cards} /> : null}
    </div>
  );
}
