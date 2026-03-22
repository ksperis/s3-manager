/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useRef, useState } from "react";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import Modal from "../../components/Modal";
import { bulkActionClasses, formInputClasses, toolbarPrimaryClasses } from "./browserConstants";

type BrowserConfirmModalProps = {
  title: string;
  message: string;
  confirmLabel?: string;
  loading?: boolean;
  tone?: "danger" | "primary";
  onCancel: () => void;
  onConfirm: () => void;
};

type BrowserCopyValueModalProps = {
  title: string;
  label?: string;
  value: string;
  onClose: () => void;
  onCopySuccess?: () => void;
};

export function BrowserConfirmModal({
  title,
  message,
  confirmLabel = "Confirm",
  loading = false,
  tone = "danger",
  onCancel,
  onConfirm,
}: BrowserConfirmModalProps) {
  return (
    <ConfirmActionDialog
      title={title}
      description={message}
      confirmLabel={confirmLabel}
      tone={tone}
      loading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
      maxWidthClass="max-w-lg"
    />
  );
}

export function BrowserCopyValueModal({
  title,
  label = "Value",
  value,
  onClose,
  onCopySuccess,
}: BrowserCopyValueModalProps) {
  const valueRef = useRef<HTMLTextAreaElement | null>(null);
  const [copyHint, setCopyHint] = useState<string | null>(null);

  useEffect(() => {
    valueRef.current?.focus();
    valueRef.current?.select();
  }, []);

  const handleCopy = async () => {
    if (!value) return;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        setCopyHint("Copied to clipboard.");
        onCopySuccess?.();
        return;
      } catch {
        // Fall back to manual copy instructions.
      }
    }
    valueRef.current?.focus();
    valueRef.current?.select();
    setCopyHint("Select and copy manually.");
  };

  return (
    <Modal title={title} onClose={onClose} maxWidthClass="max-w-2xl" initialFocusRef={valueRef}>
      <div className="space-y-3">
        <div className="space-y-1">
          <p className="ui-caption font-semibold text-slate-600 dark:text-slate-300">{label}</p>
          <textarea
            ref={valueRef}
            className={`${formInputClasses} h-32 font-mono`}
            readOnly
            value={value}
            spellCheck={false}
          />
        </div>
        {copyHint && <p className="ui-caption text-slate-500 dark:text-slate-400">{copyHint}</p>}
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={bulkActionClasses} onClick={onClose}>
            Close
          </button>
          <button type="button" className={toolbarPrimaryClasses} onClick={() => void handleCopy()}>
            Copy
          </button>
        </div>
      </div>
    </Modal>
  );
}
