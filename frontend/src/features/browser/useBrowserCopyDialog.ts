/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";

export type BrowserCopyDialogState = {
  title: string;
  label: string;
  value: string;
  successMessage?: string;
};

type UseBrowserCopyDialogOptions = {
  onStatus: (message: string) => void;
};

export function useBrowserCopyDialog({
  onStatus,
}: UseBrowserCopyDialogOptions) {
  const [dialog, setDialog] = useState<BrowserCopyDialogState | null>(null);

  const open = useCallback((nextDialog: BrowserCopyDialogState) => {
    setDialog(nextDialog);
  }, []);
  const close = useCallback(() => setDialog(null), []);
  const openSseCustomerKey = useCallback(
    (keyBase64: string) =>
      open({
        title: "Copy SSE-C key",
        label: "SSE-C key",
        value: keyBase64,
        successMessage: "SSE-C key copied to clipboard.",
      }),
    [open],
  );
  const notifyCopySuccess = useCallback(() => {
    if (dialog?.successMessage) onStatus(dialog.successMessage);
  }, [dialog, onStatus]);

  return {
    close,
    dialog,
    notifyCopySuccess,
    open,
    openSseCustomerKey,
  };
}
