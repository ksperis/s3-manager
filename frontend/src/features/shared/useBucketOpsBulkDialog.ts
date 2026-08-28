/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
  BulkConfigClipboard,
  BulkOperation,
} from "./bucketBulkOperationsModel";
import type { BucketOpsBulkFormState } from "./bucketOpsBulkInput";
import { reconcileBulkPasteMapping } from "./bucketBulkPasteModel";

type UseBucketOpsBulkDialogOptions = {
  cancelCopy: () => void;
  clipboard: BulkConfigClipboard | null;
  clipboardSameEndpoint: boolean;
  destinationBucketNames: string[];
  formState: BucketOpsBulkFormState;
  notificationsEnabled: boolean;
  operation: BulkOperation;
  quotaDisabledReason: string | null;
  resetApply: () => void;
  resetCopy: () => void;
  resetForm: () => void;
  resetPreview: () => void;
  selection: ReadonlySet<string>;
  setOperation: Dispatch<SetStateAction<BulkOperation>>;
  setPasteMapping: Dispatch<SetStateAction<Record<string, string>>>;
  usageEnabled: boolean;
};

export function useBucketOpsBulkDialog({
  cancelCopy,
  clipboard,
  clipboardSameEndpoint,
  destinationBucketNames,
  formState,
  notificationsEnabled,
  operation,
  quotaDisabledReason,
  resetApply,
  resetCopy,
  resetForm,
  resetPreview,
  selection,
  setOperation,
  setPasteMapping,
  usageEnabled,
}: UseBucketOpsBulkDialogOptions) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || operation !== "paste_configs" || !clipboard) return;
    const sourceBucketNames = clipboard.buckets.map((bucket) => bucket.name);
    setPasteMapping((previousMapping) =>
      reconcileBulkPasteMapping({
        destinationBucketNames,
        previousMapping,
        sameEndpoint: clipboardSameEndpoint,
        sourceBucketNames,
      }),
    );
  }, [
    clipboard,
    clipboardSameEndpoint,
    destinationBucketNames,
    open,
    operation,
    setPasteMapping,
  ]);

  useEffect(() => {
    if (!open) return;
    resetPreview();
    cancelCopy();
    resetApply();
  }, [
    cancelCopy,
    clipboard,
    formState,
    open,
    resetApply,
    resetPreview,
    selection,
  ]);

  useEffect(() => {
    if ((quotaDisabledReason || !usageEnabled) && operation === "set_quota") {
      setOperation("");
    }
    if (
      !notificationsEnabled &&
      (operation === "add_notifications" ||
        operation === "delete_notifications")
    ) {
      setOperation("");
    }
  }, [
    notificationsEnabled,
    operation,
    quotaDisabledReason,
    setOperation,
    usageEnabled,
  ]);

  const openDialog = useCallback(() => {
    setOpen(true);
    resetForm();
    resetCopy();
    resetPreview();
    resetApply();
  }, [resetApply, resetCopy, resetForm, resetPreview]);

  const closeDialog = useCallback(() => {
    setOpen(false);
    resetPreview();
    resetCopy();
    resetApply();
  }, [resetApply, resetCopy, resetPreview]);

  return { closeDialog, open, openDialog };
}
