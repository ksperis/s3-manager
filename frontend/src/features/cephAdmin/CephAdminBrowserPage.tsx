/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import WorkspaceContextStrip from "../../components/WorkspaceContextStrip";
import BrowserEmbed from "../browser/BrowserEmbed";
import { useCephAdminEndpoint } from "./CephAdminEndpointContext";
import useCephAdminWorkspaceContextStrip from "./useCephAdminWorkspaceContextStrip";

export default function CephAdminBrowserPage() {
  const navigate = useNavigate();
  const { selectedEndpointId, selectedEndpoint } = useCephAdminEndpoint();
  const [acceptedRisk, setAcceptedRisk] = useState(false);
  const [showRiskModal, setShowRiskModal] = useState(true);
  const browserSelector = acceptedRisk && selectedEndpointId ? `ceph-admin-${selectedEndpointId}` : null;
  const contextStrip = useCephAdminWorkspaceContextStrip({
    description: "This browser uses endpoint-wide Ceph admin credentials. Prefer tenant-owned credentials for regular object work.",
    extraAlerts: [
      {
        tone: "warning",
        message:
          "Use this view only for endpoint-wide investigation or recovery. Owner attribution may differ from the tenant that normally owns the bucket.",
      },
    ],
  });

  const handleCloseModal = () => {
    setShowRiskModal(false);
    navigate("/ceph-admin");
  };

  const handleAcceptRisk = () => {
    setAcceptedRisk(true);
    setShowRiskModal(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4">
      <PageHeader title="Browser" description="Endpoint-wide object browser for Ceph admin workflows." />
      <WorkspaceContextStrip {...contextStrip} />
      <div className="min-h-0 flex-1">
        {!selectedEndpointId ? (
          <PageEmptyState
            title="Select a Ceph endpoint"
            description="Choose an endpoint before opening the Ceph Admin browser."
            primaryAction={{ label: "Return to Ceph Admin", to: "/ceph-admin" }}
            tone="warning"
            className="h-full"
          />
        ) : (
          <BrowserEmbed
            accountIdForApi={browserSelector}
            hasContext={Boolean(browserSelector)}
            storageEndpointCapabilities={selectedEndpoint?.capabilities ?? null}
            endpointProvider="ceph"
          />
        )}
      </div>
      {showRiskModal && selectedEndpointId != null && (
        <ConfirmActionDialog
          title="Ceph Admin browser warning"
          description="This browser uses endpoint-wide ceph-admin credentials. Bucket and object operations may execute with an owner identity different from the expected tenant owner."
          confirmLabel="I understand the risks"
          tone="primary"
          details={[
            { label: "Endpoint", value: selectedEndpoint?.name ?? "Unavailable" },
            { label: "Execution", value: "Endpoint-wide ceph-admin credentials" },
          ]}
          impacts={[
            "Bucket and object actions may not match the tenant owner you expect.",
            "Prefer an S3 Connection with the correct owner credentials for regular object work.",
          ]}
          onCancel={handleCloseModal}
          onConfirm={handleAcceptRisk}
          maxWidthClass="max-w-2xl"
        />
      )}
    </div>
  );
}
