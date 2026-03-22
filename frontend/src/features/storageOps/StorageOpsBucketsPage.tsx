/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import BucketOpsWorkbench from "../shared/BucketOpsWorkbench";

export default function StorageOpsBucketsPage() {
  return (
    <BucketOpsWorkbench
      mode="storage-ops"
      shell={{
        pageDescription: "Cross-context bucket listing and bulk configuration operations.",
        contextStrip: {
          label: "Scope",
          title: "All contexts",
          description:
            "Storage Ops keeps a cross-context scope. Actions remain bound to the original account or connection permissions.",
          items: [
            { label: "Coverage", value: "Cross-account and cross-connection buckets" },
            { label: "Execution", value: "Original per-context permissions" },
            { label: "Metrics", value: "Available", tone: "success" },
          ],
        },
      }}
    />
  );
}
