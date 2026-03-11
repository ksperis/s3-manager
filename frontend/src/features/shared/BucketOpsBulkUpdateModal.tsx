/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";

import Modal from "../../components/Modal";

type BucketOpsBulkUpdateModalProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
};

export default function BucketOpsBulkUpdateModal({ open, onClose, children }: BucketOpsBulkUpdateModalProps) {
  if (!open) return null;

  return (
    <Modal title="Bulk update" onClose={onClose} maxWidthClass="max-w-6xl">
      {children}
    </Modal>
  );
}
