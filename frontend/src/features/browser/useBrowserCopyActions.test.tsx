import { act, renderHook } from "@testing-library/react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserItem } from "./browserTypes";
import { useBrowserCopyActions } from "./useBrowserCopyActions";

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);

const item = (overrides: Partial<BrowserItem> = {}): BrowserItem => ({
  id: "file:docs/report.txt",
  key: "docs/report.txt",
  name: "report.txt",
  type: "file",
  size: "12 B",
  modified: "2026-03-01 10:00",
  owner: "owner",
  ...overrides,
});

function createOptions() {
  return {
    bucketName: "bucket-a",
    enabled: true,
    onFallback: vi.fn(),
    onStatus: vi.fn(),
    onWarning: vi.fn(),
    presignObject: vi.fn().mockResolvedValue({
      url: "https://objects.example.test/report.txt",
      method: "GET",
      expires_in: 900,
      headers: {},
    }),
    sseActive: false,
  };
}

function setClipboard(value: { writeText: ReturnType<typeof vi.fn> } | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value,
  });
}

describe("useBrowserCopyActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    if (originalClipboardDescriptor) {
      Object.defineProperty(
        navigator,
        "clipboard",
        originalClipboardDescriptor,
      );
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("presigns and copies an object URL", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    const options = createOptions();
    const { result } = renderHook(() => useBrowserCopyActions(options));

    await act(async () => result.current.copyUrl(item()));

    expect(options.presignObject).toHaveBeenCalledWith("bucket-a", {
      key: "docs/report.txt",
      operation: "get_object",
      expires_in: 900,
    });
    expect(writeText).toHaveBeenCalledWith(
      "https://objects.example.test/report.txt",
    );
    expect(options.onStatus).toHaveBeenCalledWith(
      "URL copied to clipboard.",
    );
  });

  it("requests the manual copy dialog without Clipboard", async () => {
    setClipboard(undefined);
    const options = createOptions();
    const { result } = renderHook(() => useBrowserCopyActions(options));

    await act(async () => result.current.copyPath("bucket-a/docs/"));

    expect(options.onFallback).toHaveBeenCalledWith({
      title: "Copy path",
      label: "Object path",
      value: "bucket-a/docs/",
      successMessage: "Path copied to clipboard.",
    });
    expect(options.onStatus).not.toHaveBeenCalled();
  });

  it("rejects deleted objects and SSE-C URLs before presigning", async () => {
    const options = createOptions();
    const { result, rerender } = renderHook(
      ({ sseActive }) =>
        useBrowserCopyActions({ ...options, sseActive }),
      { initialProps: { sseActive: false } },
    );

    await act(async () => result.current.copyUrl(item({ isDeleted: true })));
    expect(options.onWarning).toHaveBeenCalledWith(
      "Deleted objects do not have a direct download URL.",
    );

    rerender({ sseActive: true });
    await act(async () => result.current.copyUrl(item()));
    expect(options.onWarning).toHaveBeenCalledWith(
      "Copy URL is disabled in SSE-C mode: required encryption headers are missing.",
    );
    expect(options.presignObject).not.toHaveBeenCalled();
  });
});
