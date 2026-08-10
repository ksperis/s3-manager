/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { copyTextToClipboard } from "./clipboard";

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");

afterEach(() => {
  vi.restoreAllMocks();
  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
  } else {
    Reflect.deleteProperty(navigator, "clipboard");
  }
});

describe("copyTextToClipboard", () => {
  it("uses the Clipboard API when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await copyTextToClipboard("secret");

    expect(writeText).toHaveBeenCalledWith("secret");
  });

  it("reports Clipboard API failures without a legacy fallback", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("blocked"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await expect(copyTextToClipboard("blocked")).rejects.toThrow("Clipboard copy failed.");

    expect(writeText).toHaveBeenCalledWith("blocked");
  });

  it("reports when the Clipboard API is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });

    await expect(copyTextToClipboard("unavailable")).rejects.toThrow("Clipboard is unavailable.");
  });

  it("rejects empty values before accessing the Clipboard API", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await expect(copyTextToClipboard("")).rejects.toThrow("Nothing to copy.");

    expect(writeText).not.toHaveBeenCalled();
  });
});
