/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import PageHeader from "../../components/PageHeader";
import BrowserEmbed from "../browser/BrowserEmbed";
import { useS3AccountContext } from "./S3AccountContext";

export default function ManagerBrowserPage() {
  const { accountIdForApi, hasS3AccountContext, accounts, selectedS3AccountId } = useS3AccountContext();
  const selected = accounts.find((account) => account.id === selectedS3AccountId) ?? null;

  return (
    <>
      <PageHeader title="Browser" />
      <div className="min-h-0 flex-1">
        <BrowserEmbed
          accountIdForApi={accountIdForApi}
          hasContext={hasS3AccountContext}
          storageEndpointCapabilities={selected?.storage_endpoint_capabilities ?? null}
          endpointProvider={selected?.endpoint_provider ?? null}
          quotaMaxSizeGb={selected?.quota_max_size_gb ?? null}
          quotaMaxObjects={selected?.quota_max_objects ?? null}
        />
      </div>
    </>
  );
}
