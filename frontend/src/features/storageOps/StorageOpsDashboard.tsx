/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import PageHeader from "../../components/PageHeader";
import WorkspaceNavCards from "../../components/WorkspaceNavCards";

const cards = [
  {
    title: "Buckets",
    description: "Cross-account and cross-connection bucket listing, filtering and bulk operations.",
    to: "/storage-ops/buckets",
    eyebrow: "Next step",
  },
];

export default function StorageOpsDashboard() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Storage Ops"
        description="Operations workspace for advanced S3 bucket administration across your authorized contexts."
        breadcrumbs={[{ label: "Storage Ops" }]}
      />
      <WorkspaceNavCards items={cards} />
    </div>
  );
}
