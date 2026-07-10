/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";

import WorkflowPage from "../../components/WorkflowPage";

type BucketOpsBulkUpdateModalProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
};

export default function BucketOpsBulkUpdateModal({ open, onClose, children }: BucketOpsBulkUpdateModalProps) {
  if (!open) return null;

  return (
    <WorkflowPage
      title="Bulk update"
      description="Choose an operation, preview every selected bucket and keep the apply progress visible."
      breadcrumbs={[{ label: "Buckets" }, { label: "Bulk update" }]}
      onBack={onClose}
      backLabel="Back to buckets"
      contentClassName="min-w-0"
    >
      {children}
    </WorkflowPage>
  );
}
