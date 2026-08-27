/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect } from "react";
import type { BrowserItem } from "./browserTypes";

type UseBrowserKeyboardShortcutsOptions = {
  blocked: boolean;
  canCopyAndCut: boolean;
  canPaste: boolean;
  enabled: boolean;
  hasSelectableItems: boolean;
  onCopy: (items: BrowserItem[]) => void;
  onCut: (items: BrowserItem[]) => void;
  onEditPath: () => void;
  onPaste: () => void | Promise<unknown>;
  onSelectAll: () => void;
  selectedItems: BrowserItem[];
};

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  const element = target as HTMLElement;
  if (element.isContentEditable) return true;
  return Boolean(
    element.closest(
      "input, textarea, select, [contenteditable='true'], [contenteditable=''], [role='textbox']",
    ),
  );
}

export function useBrowserKeyboardShortcuts({
  blocked,
  canCopyAndCut,
  canPaste,
  enabled,
  hasSelectableItems,
  onCopy,
  onCut,
  onEditPath,
  onPaste,
  onSelectAll,
  selectedItems,
}: UseBrowserKeyboardShortcutsOptions) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleShortcut = (event: KeyboardEvent) => {
      if (blocked || !enabled) return;
      if (event.defaultPrevented || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      if (!event.metaKey && !event.ctrlKey) return;

      const key = event.key.toLowerCase();
      if (key === "a") {
        if (!hasSelectableItems) return;
        event.preventDefault();
        onSelectAll();
        return;
      }
      if (key === "l") {
        event.preventDefault();
        onEditPath();
        return;
      }
      if (key === "c" || key === "x") {
        if (!canCopyAndCut || selectedItems.length === 0) return;
        event.preventDefault();
        if (key === "c") onCopy(selectedItems);
        else onCut(selectedItems);
        return;
      }
      if (key === "v" && canPaste) {
        event.preventDefault();
        void onPaste();
      }
    };
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, [
    blocked,
    canCopyAndCut,
    canPaste,
    enabled,
    hasSelectableItems,
    onCopy,
    onCut,
    onEditPath,
    onPaste,
    onSelectAll,
    selectedItems,
  ]);
}
