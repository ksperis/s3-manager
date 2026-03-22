/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import PageHeader from "../../components/PageHeader";
import WorkspaceNavCards from "../../components/WorkspaceNavCards";
import WorkspaceContextStrip from "../../components/WorkspaceContextStrip";

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
      <WorkspaceContextStrip
        label="Scope"
        title="All authorized contexts"
        description="Storage Ops keeps a cross-context scope. Actions remain limited to the accounts and connections you are already allowed to operate."
        items={[
          { label: "Coverage", value: "Buckets across accounts and connections" },
          { label: "Execution", value: "Per-context permissions preserved" },
          { label: "Audience", value: "Operations workflows" },
        ]}
      />
      <WorkspaceNavCards items={cards} />
    </div>
  );
}
