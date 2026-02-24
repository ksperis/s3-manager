/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import PageHeader from "../../components/PageHeader";
import { useI18n } from "../../i18n";
import BrowserEmbed from "../browser/BrowserEmbed";
import { usePortalAccountContext } from "./PortalAccountContext";

export default function PortalBrowserPage() {
  const { t } = useI18n();
  const { accountIdForApi, hasAccountContext, selectedAccount } = usePortalAccountContext();

  return (
    <>
      <PageHeader
        title={t({ en: "Browser", fr: "Browser", de: "Browser" })}
        actions={[{ label: t({ en: "Back to portal", fr: "Retour au portail", de: "Zuruck zum Portal" }), to: "/portal", variant: "ghost" }]}
      />
      <div className="min-h-0 flex-1">
        <BrowserEmbed
          accountIdForApi={accountIdForApi}
          hasContext={hasAccountContext}
          storageEndpointCapabilities={selectedAccount?.storage_endpoint_capabilities ?? null}
          quotaMaxSizeGb={selectedAccount?.quota_max_size_gb ?? null}
          quotaMaxObjects={selectedAccount?.quota_max_objects ?? null}
        />
      </div>
    </>
  );
}
