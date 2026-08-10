/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export async function copyTextToClipboard(value: string): Promise<void> {
  if (!value) throw new Error("Nothing to copy.");

  const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : null;
  if (!clipboard?.writeText) {
    throw new Error("Clipboard is unavailable.");
  }

  try {
    await clipboard.writeText(value);
  } catch {
    throw new Error("Clipboard copy failed.");
  }
}
