/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode, useCallback, useMemo, useState } from "react";
import ConfirmActionDialog from "./ConfirmActionDialog";

type UseUnsavedChangesGuardOptions = {
  hasUnsavedChanges: boolean;
  onClose: () => void;
  disabled?: boolean;
  title?: string;
  description?: ReactNode;
  cancelLabel?: string;
  confirmLabel?: string;
  zIndexClass?: string;
};

export function useUnsavedChangesGuard({
  hasUnsavedChanges,
  onClose,
  disabled = false,
  title = "Discard changes?",
  description = "You have unapplied changes. Closing this dialog will discard them.",
  cancelLabel = "Keep editing",
  confirmLabel = "Discard changes",
  zIndexClass = "z-[70]",
}: UseUnsavedChangesGuardOptions) {
  const [confirmingClose, setConfirmingClose] = useState(false);

  const requestClose = useCallback(() => {
    if (disabled) return;
    if (hasUnsavedChanges) {
      setConfirmingClose(true);
      return;
    }
    onClose();
  }, [disabled, hasUnsavedChanges, onClose]);

  const keepEditing = useCallback(() => {
    setConfirmingClose(false);
  }, []);

  const discardChanges = useCallback(() => {
    setConfirmingClose(false);
    onClose();
  }, [onClose]);

  const confirmationDialog = useMemo(
    () =>
      confirmingClose ? (
        <ConfirmActionDialog
          title={title}
          description={description}
          confirmLabel={confirmLabel}
          cancelLabel={cancelLabel}
          tone="danger"
          zIndexClass={zIndexClass}
          onCancel={keepEditing}
          onConfirm={discardChanges}
        />
      ) : null,
    [cancelLabel, confirmLabel, confirmingClose, description, discardChanges, keepEditing, title, zIndexClass]
  );

  return {
    requestClose,
    confirmationDialog,
    isConfirmingClose: confirmingClose,
    closeWithoutConfirmation: onClose,
  };
}

