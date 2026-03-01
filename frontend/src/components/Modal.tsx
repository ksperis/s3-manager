/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode, RefObject, useEffect, useId, useRef } from "react";
import UiButton from "./ui/UiButton";
import { getFocusableElements, trapFocusWithin } from "./ui/focusTrap";
import { cx, uiCardClass } from "./ui/styles";

type ModalProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  maxWidthClass?: string;
  maxBodyHeightClass?: string;
  zIndexClass?: string;
  ariaLabelledby?: string;
  ariaDescribedby?: string;
  closeOnEscape?: boolean;
  closeOnBackdropClick?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusOnClose?: boolean;
  trapFocus?: boolean;
};

export default function Modal({
  title,
  onClose,
  children,
  maxWidthClass = "max-w-2xl",
  maxBodyHeightClass = "max-h-[70vh]",
  zIndexClass = "z-50",
  ariaLabelledby,
  ariaDescribedby,
  closeOnEscape = true,
  closeOnBackdropClick = true,
  initialFocusRef,
  returnFocusOnClose = true,
  trapFocus = true,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const fallbackTitleId = `${titleId}-title`;
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (returnFocusOnClose) {
        previousFocusRef.current?.focus();
      }
    };
  }, [returnFocusOnClose]);

  useEffect(() => {
    const container = dialogRef.current;
    if (!container) return;
    const preferred = initialFocusRef?.current;
    if (preferred && typeof preferred.focus === "function") {
      preferred.focus();
      return;
    }
    const focusable = getFocusableElements(container);
    if (focusable.length > 0) {
      focusable[0].focus();
      return;
    }
    container.focus();
  }, [initialFocusRef]);

  useEffect(() => {
    const container = dialogRef.current;
    if (!container) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && closeOnEscape) {
        event.preventDefault();
        onClose();
        return;
      }
      if (trapFocus) {
        trapFocusWithin(container, event);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeOnEscape, onClose, trapFocus]);

  return (
    <div
      className={`fixed inset-0 ${zIndexClass} flex items-center justify-center bg-black/50 px-4 py-6 backdrop-blur-sm`}
      role="presentation"
      onMouseDown={(event) => {
        if (!closeOnBackdropClick) return;
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledby ?? fallbackTitleId}
        aria-describedby={ariaDescribedby}
        tabIndex={-1}
        className={cx("w-full rounded-2xl shadow-2xl", uiCardClass, maxWidthClass)}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <h3 id={fallbackTitleId} className="ui-subtitle font-semibold text-slate-800 dark:text-slate-50">
            {title}
          </h3>
          <UiButton variant="ghost" onClick={onClose} className="py-1" aria-label="Close modal">
            Close
          </UiButton>
        </div>
        <div className={`${maxBodyHeightClass} overflow-y-auto px-6 py-4`}>{children}</div>
      </div>
    </div>
  );
}
