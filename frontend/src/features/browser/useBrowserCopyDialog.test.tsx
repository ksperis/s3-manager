import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useBrowserCopyDialog } from "./useBrowserCopyDialog";

describe("useBrowserCopyDialog", () => {
  it("opens and closes a manual copy fallback", () => {
    const { result } = renderHook(() =>
      useBrowserCopyDialog({ onStatus: vi.fn() }),
    );

    act(() =>
      result.current.open({
        title: "Copy path",
        label: "Object path",
        value: "bucket-a/docs/",
      }),
    );
    expect(result.current.dialog).toMatchObject({
      title: "Copy path",
      value: "bucket-a/docs/",
    });

    act(() => result.current.close());
    expect(result.current.dialog).toBeNull();
  });

  it("builds the SSE-C manual-copy contract", () => {
    const { result } = renderHook(() =>
      useBrowserCopyDialog({ onStatus: vi.fn() }),
    );

    act(() => result.current.openSseCustomerKey("base64-key"));

    expect(result.current.dialog).toEqual({
      title: "Copy SSE-C key",
      label: "SSE-C key",
      value: "base64-key",
      successMessage: "SSE-C key copied to clipboard.",
    });
  });

  it("reports the active fallback success message", () => {
    const onStatus = vi.fn();
    const { result } = renderHook(() =>
      useBrowserCopyDialog({ onStatus }),
    );

    act(() =>
      result.current.open({
        title: "Copy URL",
        label: "Object URL",
        value: "https://objects.example.test/report.txt",
        successMessage: "URL copied to clipboard.",
      }),
    );
    act(() => result.current.notifyCopySuccess());

    expect(onStatus).toHaveBeenCalledWith("URL copied to clipboard.");
  });
});
