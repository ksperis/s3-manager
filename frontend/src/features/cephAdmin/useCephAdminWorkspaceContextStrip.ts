/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo } from "react";
import type { ReactNode } from "react";
import type { WorkspaceContextStripAlert, WorkspaceContextStripItem } from "../../components/WorkspaceContextStrip";
import { useCephAdminEndpoint } from "./CephAdminEndpointContext";

type CephAdminWorkspaceContextStripOptions = {
  description: ReactNode;
  extraItems?: WorkspaceContextStripItem[];
  extraAlerts?: WorkspaceContextStripAlert[];
  title?: ReactNode;
};

export default function useCephAdminWorkspaceContextStrip({
  description,
  extraItems = [],
  extraAlerts = [],
  title,
}: CephAdminWorkspaceContextStripOptions) {
  const {
    loading,
    selectedEndpointId,
    selectedEndpoint,
    selectedEndpointAccess,
    selectedEndpointAccessLoading,
    selectedEndpointAccessError,
  } = useCephAdminEndpoint();

  return useMemo(() => {
    const canResolveAccess = selectedEndpointId != null && !selectedEndpointAccessLoading;

    return {
      label: "Endpoint context",
      title: title ?? selectedEndpoint?.name ?? (loading ? "Loading..." : "No endpoint selected"),
      description,
      items: [
        {
          label: "Endpoint URL",
          value: selectedEndpoint?.endpoint_url ?? "Unavailable",
          mono: Boolean(selectedEndpoint?.endpoint_url),
        },
        {
          label: "Admin Ops",
          value: selectedEndpointAccessLoading ? "Checking access..." : canResolveAccess && selectedEndpointAccess?.can_admin ? "Allowed" : "Restricted",
          tone: canResolveAccess && selectedEndpointAccess?.can_admin ? "success" : "warning",
        },
        {
          label: "Accounts",
          value:
            selectedEndpointAccessLoading ? "Checking access..." : canResolveAccess && selectedEndpointAccess?.can_accounts ? "Allowed" : "Restricted",
          tone: canResolveAccess && selectedEndpointAccess?.can_accounts ? "success" : "warning",
        },
        {
          label: "Metrics",
          value:
            selectedEndpointAccessLoading ? "Checking access..." : canResolveAccess && selectedEndpointAccess?.can_metrics ? "Allowed" : "Restricted",
          tone: canResolveAccess && selectedEndpointAccess?.can_metrics ? "success" : "warning",
        },
        ...extraItems,
      ],
      alerts: [
        ...(selectedEndpointId == null && !loading
          ? [{ tone: "warning" as const, message: "Select a Ceph endpoint before loading data or mutating configuration." }]
          : []),
        ...(selectedEndpointAccess?.admin_warning ? [{ tone: "warning" as const, message: selectedEndpointAccess.admin_warning }] : []),
        ...(selectedEndpointAccessError ? [{ tone: "danger" as const, message: selectedEndpointAccessError }] : []),
        ...extraAlerts,
      ],
    };
  }, [
    description,
    extraAlerts,
    extraItems,
    loading,
    selectedEndpoint,
    selectedEndpointAccess,
    selectedEndpointAccessError,
    selectedEndpointAccessLoading,
    selectedEndpointId,
    title,
  ]);
}
