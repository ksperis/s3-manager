/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode } from "react";

type ModalProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  maxWidthClass?: string;
  maxBodyHeightClass?: string;
};

export default function Modal({
  title,
  onClose,
  children,
  maxWidthClass = "max-w-2xl",
  maxBodyHeightClass = "max-h-[70vh]",
}: ModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6 backdrop-blur-sm">
      <div className={`w-full ${maxWidthClass} rounded-2xl border border-slate-200/80 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <h3 className="ui-subtitle font-semibold text-slate-800 dark:text-slate-50">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1 ui-body font-medium text-slate-600 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            aria-label="Close modal"
          >
            Close
          </button>
        </div>
        <div className={`${maxBodyHeightClass} overflow-y-auto px-6 py-4`}>{children}</div>
      </div>
    </div>
  );
}
