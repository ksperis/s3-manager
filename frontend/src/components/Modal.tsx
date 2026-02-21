/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode } from "react";
import UiButton from "./ui/UiButton";
import { cx, uiCardClass } from "./ui/styles";

type ModalProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  maxWidthClass?: string;
  maxBodyHeightClass?: string;
  zIndexClass?: string;
};

export default function Modal({
  title,
  onClose,
  children,
  maxWidthClass = "max-w-2xl",
  maxBodyHeightClass = "max-h-[70vh]",
  zIndexClass = "z-50",
}: ModalProps) {
  return (
    <div className={`fixed inset-0 ${zIndexClass} flex items-center justify-center bg-black/50 px-4 py-6 backdrop-blur-sm`}>
      <div className={cx("w-full rounded-2xl shadow-2xl", uiCardClass, maxWidthClass)}>
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <h3 className="ui-subtitle font-semibold text-slate-800 dark:text-slate-50">{title}</h3>
          <UiButton variant="ghost" onClick={onClose} className="py-1" aria-label="Close modal">
            Close
          </UiButton>
        </div>
        <div className={`${maxBodyHeightClass} overflow-y-auto px-6 py-4`}>{children}</div>
      </div>
    </div>
  );
}
