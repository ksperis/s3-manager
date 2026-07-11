/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";

import WorkflowPage from "../../components/WorkflowPage";

type BucketOpsBulkUpdatePageProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
};

export default function BucketOpsBulkUpdatePage({ open, onClose, children }: BucketOpsBulkUpdatePageProps) {
  if (!open) return null;

  return (
    <WorkflowPage
      title="Configure selected buckets"
      description="Choose an S3 API operation, preview every selected bucket and keep the apply progress visible."
      breadcrumbs={[{ label: "Buckets" }, { label: "Configure selected buckets" }]}
      onBack={onClose}
      backLabel="Back to bucket selection"
      contentClassName="min-w-0"
    >
      {children}
    </WorkflowPage>
  );
}
