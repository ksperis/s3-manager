/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export async function copyTextToClipboard(value: string): Promise<void> {
  if (!value) throw new Error("Nothing to copy.");

  const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : null;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(value);
      return;
    } catch {
      // Fall back to the legacy copy path for local HTTP contexts.
    }
  }

  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    throw new Error("Clipboard is unavailable.");
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, value.length);
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) throw new Error("Clipboard copy failed.");
}
