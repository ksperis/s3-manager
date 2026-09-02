import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useCompareVisibleKeysClipboard } from "./bucketCompareShared";

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
  window.navigator,
  "clipboard"
);

const installClipboardWriter = (writeText: (value: string) => Promise<void>) => {
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
};

afterEach(() => {
  if (originalClipboardDescriptor) {
    Object.defineProperty(
      window.navigator,
      "clipboard",
      originalClipboardDescriptor
    );
  } else {
    Reflect.deleteProperty(window.navigator, "clipboard");
  }
  vi.restoreAllMocks();
});

describe("useCompareVisibleKeysClipboard", () => {
  it("copies visible keys and exposes success feedback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    installClipboardWriter(writeText);
    const { result } = renderHook(() => useCompareVisibleKeysClipboard());

    await act(async () => {
      await result.current.copyVisibleKeys("source-only", ["first", "second"]);
    });

    expect(writeText).toHaveBeenCalledWith("first\nsecond");
    expect(result.current.copyFeedback).toEqual({
      id: "source-only",
      tone: "success",
      message: "Copied 2 keys to clipboard.",
    });
  });

  it("exposes danger feedback when clipboard access fails", async () => {
    installClipboardWriter(vi.fn().mockRejectedValue(new Error("Denied")));
    const { result } = renderHook(() => useCompareVisibleKeysClipboard());

    await act(async () => {
      await result.current.copyVisibleKeys("different", ["object"]);
    });

    expect(result.current.copyFeedback).toEqual({
      id: "different",
      tone: "danger",
      message: "Unable to copy keys to clipboard.",
    });
  });

  it("ignores empty key lists", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    installClipboardWriter(writeText);
    const { result } = renderHook(() => useCompareVisibleKeysClipboard());

    await act(async () => {
      await result.current.copyVisibleKeys("empty", []);
    });

    expect(writeText).not.toHaveBeenCalled();
    expect(result.current.copyFeedback).toBeNull();
  });
});
