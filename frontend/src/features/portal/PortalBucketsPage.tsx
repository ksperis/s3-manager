/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";

export default function PortalBucketsPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Buckets" />
      <PageBanner tone="info">Bucket provisioning is implemented in Phase 6.</PageBanner>
    </div>
  );
}

