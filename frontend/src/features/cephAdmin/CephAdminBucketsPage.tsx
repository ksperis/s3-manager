/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import BucketOpsWorkbench from "../shared/BucketOpsWorkbench";
import useCephAdminWorkspaceContextStrip from "./useCephAdminWorkspaceContextStrip";

export default function CephAdminBucketsPage() {
  const contextStrip = useCephAdminWorkspaceContextStrip({
    description: "Ceph Admin bucket operations stay endpoint-scoped and reuse the selected endpoint capabilities.",
  });

  return (
    <BucketOpsWorkbench
      mode="ceph-admin"
      shell={{
        pageDescription: "Cluster-level bucket listing (Admin Ops + S3).",
        contextStrip,
        emptyState: {
          title: "Select a Ceph endpoint before listing buckets",
          description: "The bucket workbench stays endpoint-scoped. Choose an endpoint to load inventory, filters, and bulk operations.",
          primaryAction: { label: "Return to Ceph Admin", to: "/ceph-admin" },
          tone: "warning",
        },
      }}
    />
  );
}
