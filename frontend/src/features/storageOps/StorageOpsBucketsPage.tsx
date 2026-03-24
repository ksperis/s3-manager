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
      }}
    />
  );
}
