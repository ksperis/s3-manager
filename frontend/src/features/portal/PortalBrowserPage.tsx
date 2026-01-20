/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import PageHeader from "../../components/PageHeader";
import BrowserEmbed from "../browser/BrowserEmbed";
import { usePortalAccountContext } from "./PortalAccountContext";

export default function PortalBrowserPage() {
  const { accountIdForApi, hasAccountContext, selectedAccount } = usePortalAccountContext();

  return (
    <>
      <PageHeader title="Browser" />
      <div className="min-h-0 flex-1">
        <BrowserEmbed
          accountIdForApi={accountIdForApi}
          hasContext={hasAccountContext}
          storageEndpointCapabilities={selectedAccount?.storage_endpoint_capabilities ?? null}
        />
      </div>
    </>
  );
}
