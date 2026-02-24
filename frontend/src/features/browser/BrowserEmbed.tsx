/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { S3AccountSelector } from "../../api/accountParams";
import BrowserPage from "./BrowserPage";

type BrowserEmbedProps = {
  accountIdForApi: S3AccountSelector;
  hasContext: boolean;
  storageEndpointCapabilities?: Record<string, boolean> | null;
  endpointProvider?: "ceph" | "other" | null;
  quotaMaxSizeGb?: number | null;
  quotaMaxObjects?: number | null;
};

export default function BrowserEmbed({
  accountIdForApi,
  hasContext,
  storageEndpointCapabilities,
  endpointProvider,
  quotaMaxSizeGb,
  quotaMaxObjects,
}: BrowserEmbedProps) {
  return (
    <BrowserPage
      accountIdForApi={accountIdForApi}
      hasContext={hasContext}
      storageEndpointCapabilities={storageEndpointCapabilities}
      contextEndpointProvider={endpointProvider}
      contextQuotaMaxSizeGb={quotaMaxSizeGb}
      contextQuotaMaxObjects={quotaMaxObjects}
      allowFoldersPanel={false}
      allowInspectorPanel={false}
      showPanelToggles={false}
    />
  );
}
