/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import WorkspaceContextStrip from "../../components/WorkspaceContextStrip";
import BrowserEmbed from "../browser/BrowserEmbed";
import { useS3AccountContext } from "./S3AccountContext";
import useManagerWorkspaceContextStrip from "./useManagerWorkspaceContextStrip";

export default function ManagerBrowserPage() {
  const {
    accountIdForApi,
    hasS3AccountContext,
    accounts,
    selectedS3AccountId,
    managerBrowserEnabled,
  } = useS3AccountContext();
  const selected = accounts.find((account) => account.id === selectedS3AccountId) ?? null;
  const browserBlockedForContext = managerBrowserEnabled === false;
  const contextStrip = useManagerWorkspaceContextStrip({
    description: "Browser actions reuse the selected manager context. Object access still depends on storage-side permissions.",
    extraAlerts: browserBlockedForContext
      ? [
          {
            tone: "warning",
            message: "Browser access is disabled for this S3 connection. Enable browser access in the S3 connection settings.",
          },
        ]
      : [],
  });

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4">
      <PageHeader title="Browser" description="Object navigation for the active manager execution context." />
      <WorkspaceContextStrip {...contextStrip} />
      <div className="min-h-0 flex-1">
        {!hasS3AccountContext ? (
          <PageEmptyState
            title="Select a manager context first"
            description="Choose an account, connection, or S3 user before loading the Browser in the manager workspace."
            primaryAction={{ label: "Open dashboard", to: "/manager" }}
            secondaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
            tone="warning"
            className="h-full"
          />
        ) : null}
        {!browserBlockedForContext && hasS3AccountContext && (
          <BrowserEmbed
            accountIdForApi={accountIdForApi}
            hasContext={hasS3AccountContext}
            storageEndpointCapabilities={selected?.storage_endpoint_capabilities ?? null}
            endpointProvider={selected?.endpoint_provider ?? null}
            quotaMaxSizeGb={selected?.quota_max_size_gb ?? null}
            quotaMaxObjects={selected?.quota_max_objects ?? null}
          />
        )}
      </div>
    </div>
  );
}
