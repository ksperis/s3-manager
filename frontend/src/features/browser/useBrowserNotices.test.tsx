import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useBrowserNotices } from "./useBrowserNotices";

describe("useBrowserNotices", () => {
  it("stores status and warning messages independently", () => {
    const { result } = renderHook(() =>
      useBrowserNotices({ scopeKey: "account-a:bucket-a:root" }),
    );

    act(() => {
      result.current.setStatusMessage("Upload complete.");
      result.current.setWarningMessage("Some objects were skipped.");
    });

    expect(result.current.statusMessage).toBe("Upload complete.");
    expect(result.current.warningMessage).toBe("Some objects were skipped.");
  });

  it("keeps messages while the Browser scope is unchanged", () => {
    const { result, rerender } = renderHook(
      ({ scopeKey }) => useBrowserNotices({ scopeKey }),
      { initialProps: { scopeKey: "account-a:bucket-a:root" } },
    );

    act(() => result.current.setStatusMessage("Queued."));
    rerender({ scopeKey: "account-a:bucket-a:root" });

    expect(result.current.statusMessage).toBe("Queued.");
  });

  it("clears both messages when the Browser scope changes", () => {
    const { result, rerender } = renderHook(
      ({ scopeKey }) => useBrowserNotices({ scopeKey }),
      { initialProps: { scopeKey: "account-a:bucket-a:root" } },
    );

    act(() => {
      result.current.setStatusMessage("Queued.");
      result.current.setWarningMessage("Retry available.");
    });
    rerender({ scopeKey: "account-a:bucket-b:root" });

    expect(result.current.statusMessage).toBeNull();
    expect(result.current.warningMessage).toBeNull();
  });
});
