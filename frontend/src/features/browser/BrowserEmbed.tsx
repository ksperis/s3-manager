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
};

export default function BrowserEmbed({ accountIdForApi, hasContext, storageEndpointCapabilities }: BrowserEmbedProps) {
  return (
    <BrowserPage
      accountIdForApi={accountIdForApi}
      hasContext={hasContext}
      storageEndpointCapabilities={storageEndpointCapabilities}
      allowFoldersPanel={false}
      allowInspectorPanel={false}
      showPanelToggles={false}
    />
  );
}
