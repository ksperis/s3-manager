/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";

export default function PortalAdminPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Admin" />
      <PageBanner tone="info">Account admin settings ship incrementally.</PageBanner>
    </div>
  );
}

