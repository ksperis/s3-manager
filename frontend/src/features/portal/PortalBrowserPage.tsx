/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";

export default function PortalBrowserPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Browser" />
      <PageBanner tone="info">Integrated browser Basic Mode is implemented in Phase 4.</PageBanner>
    </div>
  );
}

