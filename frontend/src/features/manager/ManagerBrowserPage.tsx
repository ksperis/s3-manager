/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState } from "react";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import BrowserEmbed from "../browser/BrowserEmbed";
import { BrowserContextProvider, useBrowserContext } from "../browser/BrowserContext";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";

function ManagerBrowserContent() {
  const {
    contexts,
    contextsLoaded,
    selectedContext,
    selectedContextId,
    setSelectedContextId,
    hasContext,
    selectorForApi,
    accessError,
  } = useBrowserContext();
  const [selectedBrowserBucketName, setSelectedBrowserBucketName] = useState("");
  const breadcrumbs = selectedBrowserBucketName
    ? managerPageBreadcrumbs("browser", { label: selectedBrowserBucketName })
    : managerPageBreadcrumbs("browser");

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4">
      <PageHeader
        title="Browser"
        description="Object navigation with a private Browser connection, independent from the active Manager context."
        breadcrumbs={breadcrumbs}
        rightContent={
          contexts.length > 0 ? (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Private connection</span>
              <select
                className="h-9 rounded-md border bg-background px-3"
                value={selectedContextId ?? ""}
                onChange={(event) => setSelectedContextId(event.target.value || null)}
                aria-label="Private Browser connection"
              >
                <option value="">Select a connection</option>
                {contexts.map((context) => (
                  <option key={context.id} value={context.id}>{context.display_name}</option>
                ))}
              </select>
            </label>
          ) : undefined
        }
      />
      <div className="min-h-0 flex-1">
        {!hasContext ? (
          <PageEmptyState
            title={
              !contextsLoaded
                ? "Loading private Browser connections"
                : contexts.length
                  ? "Select a private Browser connection"
                  : "No private Browser connection"
            }
            description={
              !contextsLoaded
                ? "Checking the Browser contexts available to you."
                : accessError ?? "Accounts, RGW users and shared connections cannot be used in Browser. Create a private connection with a dedicated access key."
            }
            primaryAction={{ label: "Manage private connections", to: "/browser/profile?tab=connections" }}
            secondaryAction={{ label: "Open Manager dashboard", to: "/manager" }}
            tone="warning"
            className="h-full"
          />
        ) : (
          <BrowserEmbed
            accountIdForApi={selectorForApi}
            executionContextKind={selectedContext?.kind ?? null}
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
        )}
      </div>
    </div>
  );
}

export default function ManagerBrowserPage() {
  return (
    <BrowserContextProvider>
      <ManagerBrowserContent />
    </BrowserContextProvider>
  );
}
