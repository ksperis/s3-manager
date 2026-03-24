/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import BrowserEmbed from "../browser/BrowserEmbed";
import { useS3AccountContext } from "./S3AccountContext";

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

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4">
      <PageHeader title="Browser" description="Object navigation for the active manager execution context." />
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
        ) : browserBlockedForContext ? (
          <PageEmptyState
            title="Browser access is disabled for this context"
            description="Enable browser access in the S3 connection settings before opening the manager browser for this context."
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
