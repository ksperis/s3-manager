/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Modal from "../../components/Modal";
import PageHeader from "../../components/PageHeader";
import UiButton from "../../components/ui/UiButton";
import BrowserEmbed from "../browser/BrowserEmbed";
import { useCephAdminEndpoint } from "./CephAdminEndpointContext";

export default function CephAdminBrowserPage() {
  const navigate = useNavigate();
  const { selectedEndpointId, selectedEndpoint } = useCephAdminEndpoint();
  const [acceptedRisk, setAcceptedRisk] = useState(false);
  const [showRiskModal, setShowRiskModal] = useState(true);
  const browserSelector = acceptedRisk && selectedEndpointId ? `ceph-admin-${selectedEndpointId}` : null;

  const handleCloseModal = () => {
    setShowRiskModal(false);
    navigate("/ceph-admin");
  };

  const handleAcceptRisk = () => {
    setAcceptedRisk(true);
    setShowRiskModal(false);
  };

  return (
    <>
      <PageHeader title="Browser" />
      <div className="min-h-0 flex-1">
        <BrowserEmbed
          accountIdForApi={browserSelector}
          hasContext={Boolean(browserSelector)}
          storageEndpointCapabilities={selectedEndpoint?.capabilities ?? null}
          endpointProvider="ceph"
        />
      </div>
      {showRiskModal && (
        <Modal title="Ceph Admin browser warning" onClose={handleCloseModal} maxWidthClass="max-w-2xl">
          <div className="space-y-3 ui-body text-slate-700 dark:text-slate-200">
            <p>
              This browser uses the endpoint-wide <strong>ceph-admin</strong> credentials. Bucket and object operations may be
              executed with an owner identity different from the expected tenant owner.
            </p>
            <p>
              For regular bucket/object operations, prefer creating an <strong>S3 Connection</strong> with the correct owner
              credentials, then use that connection in the Browser.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <UiButton variant="secondary" onClick={handleCloseModal}>
                Cancel
              </UiButton>
              <UiButton onClick={handleAcceptRisk}>I understand the risks</UiButton>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
