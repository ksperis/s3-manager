/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState } from "react";
import PageEmptyState from "../../components/PageEmptyState";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import BrowserEmbed from "../browser/BrowserEmbed";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import { useS3AccountContext } from "./S3AccountContext";

export default function ManagerBrowserPage() {
  const {
    accounts,
    selectedS3AccountId,
    hasS3AccountContext,
    accountIdForApi,
    selectedS3AccountType,
    accessError,
    iamIdentity,
    accessMode,
    managerBrowserEnabled,
    managerBrowserMessage,
  } = useS3AccountContext();
  const [selectedBrowserBucketName, setSelectedBrowserBucketName] = useState("");
  const selectedContext = accounts.find((context) => context.id === selectedS3AccountId) ?? null;
  const breadcrumbs = selectedBrowserBucketName
    ? managerPageBreadcrumbs("browser", { label: selectedBrowserBucketName })
    : managerPageBreadcrumbs("browser");

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4">
      <PageHeader
        title="Browser"
        description="Object navigation using the active Manager context."
        breadcrumbs={breadcrumbs}
        rightContent={
          hasS3AccountContext ? (
            <div className="text-right text-sm">
              <div className="font-medium">Effective S3 identity</div>
              <div className="text-muted-foreground">
                {iamIdentity ?? selectedContext?.display_name ?? "Identity could not be resolved"}
              </div>
            </div>
          ) : undefined
        }
      />
      <div className="min-h-0 flex-1">
        {!hasS3AccountContext ? (
          <PageEmptyState
            title="Select a Manager context"
            description={accessError ?? "Use the Manager selector in the topbar to choose a context."}
            secondaryAction={{ label: "Open Manager dashboard", to: "/manager" }}
            tone="warning"
            className="h-full"
          />
        ) : managerBrowserEnabled !== true ? (
          <PageEmptyState
            title={managerBrowserEnabled === null ? "Checking Browser access" : "Browser unavailable for this context"}
            description={managerBrowserMessage ?? "This active Manager context is not authorized for Browser data access."}
            secondaryAction={{ label: "Open Manager dashboard", to: "/manager" }}
            tone="warning"
            className="h-full"
          />
        ) : (
          <div className="flex h-full min-h-0 flex-col gap-3">
            {accessMode === "admin" || accessMode === "s3_user" ? (
              <PageBanner tone="warning">
                RGW logs will attribute operations to {iamIdentity ?? selectedContext?.display_name ?? "this S3 identity"}, not to the UI user.
              </PageBanner>
            ) : accessMode === "connection" && !iamIdentity ? (
              <PageBanner tone="warning">
                The provider principal could not be resolved. This Browser uses the credentials of {selectedContext?.display_name ?? "the selected connection"}; provider logs will attribute operations to that identity.
              </PageBanner>
            ) : null}
            <div className="min-h-0 flex-1">
              <BrowserEmbed
                accountIdForApi={accountIdForApi}
                executionContextKind={selectedContext?.kind ?? (selectedS3AccountType === "s3_user" ? "legacy_user" : null)}
                hasContext
                workspaceSurface="manager"
                functionalProfile="advanced"
                layoutMode="standard"
                density="compact"
                capabilityFacts={{
                  canWriteObjects: true,
                  canDeleteObjects: true,
                  canRestoreObjects: true,
                  canCreatePublicLinks: false,
                }}
                storageEndpointCapabilities={selectedContext?.storage_endpoint_capabilities ?? null}
                endpointProvider={selectedContext?.endpoint_provider ?? null}
                quotaMaxSizeGb={selectedContext?.quota_max_size_gb ?? null}
                quotaMaxObjects={selectedContext?.quota_max_objects ?? null}
                onSelectedBucketNameChange={setSelectedBrowserBucketName}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
