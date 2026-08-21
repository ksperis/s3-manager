/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type ReactNode, useCallback, useMemo, useState } from "react";

import ConfirmActionDialog from "./ConfirmActionDialog";

type ConfirmActionDialogDetail = {
  label: string;
  value: ReactNode;
  mono?: boolean;
};

export type ConfirmActionRequest = {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  details?: ConfirmActionDialogDetail[];
  impacts?: ReactNode[];
  warning?: ReactNode;
  maxWidthClass?: string;
  zIndexClass?: string;
  onConfirm: () => void | Promise<void>;
};

export function useConfirmActionDialog() {
  const [request, setRequest] = useState<ConfirmActionRequest | null>(null);
  const [confirming, setConfirming] = useState(false);

  const requestConfirmation = useCallback((nextRequest: ConfirmActionRequest) => {
    setRequest(nextRequest);
  }, []);

  const cancelConfirmation = useCallback(() => {
    if (confirming) return;
    setRequest(null);
  }, [confirming]);

  const confirmAction = useCallback(async () => {
    if (!request || confirming) return;
    setConfirming(true);
    try {
      await request.onConfirm();
    } finally {
      setConfirming(false);
      setRequest(null);
    }
  }, [confirming, request]);

  const confirmationDialog = useMemo(
    () =>
      request ? (
        <ConfirmActionDialog
          title={request.title}
          description={request.description}
          confirmLabel={request.confirmLabel}
          cancelLabel={request.cancelLabel}
          tone={request.tone}
          loading={confirming}
          details={request.details}
          impacts={request.impacts}
          warning={request.warning}
          maxWidthClass={request.maxWidthClass}
          zIndexClass={request.zIndexClass ?? "z-[70]"}
          onCancel={cancelConfirmation}
          onConfirm={() => void confirmAction()}
        />
      ) : null,
    [cancelConfirmation, confirmAction, confirming, request]
  );

  return {
    requestConfirmation,
    cancelConfirmation,
    confirmationDialog,
    isConfirming: confirming,
  };
}
