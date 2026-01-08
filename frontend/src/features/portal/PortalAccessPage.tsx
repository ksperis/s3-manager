/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";

export default function PortalAccessPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="External access" />
      <PageBanner tone="info">External access (opt-in) is implemented in Phase 5.</PageBanner>
    </div>
  );
}

