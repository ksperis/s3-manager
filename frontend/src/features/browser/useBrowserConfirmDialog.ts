/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";

type BrowserConfirmDialogState = {
  title: string;
  message: string;
  confirmLabel: string;
  tone?: "danger" | "primary";
  onConfirm: () => Promise<void> | void;
};

export function useBrowserConfirmDialog() {
  const [dialog, setDialog] = useState<BrowserConfirmDialogState | null>(null);
  const [loading, setLoading] = useState(false);

  const open = useCallback((nextDialog: BrowserConfirmDialogState) => {
    setDialog(nextDialog);
    setLoading(false);
  }, []);

  const close = useCallback(() => {
    if (loading) return;
    setDialog(null);
  }, [loading]);

  const submit = useCallback(async () => {
    if (!dialog) return;
    setLoading(true);
    try {
      await dialog.onConfirm();
      setDialog(null);
    } finally {
      setLoading(false);
    }
  }, [dialog]);

  return {
    close,
    dialog,
    loading,
    open,
    submit,
  };
}
