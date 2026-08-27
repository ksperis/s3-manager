import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  pushBucketPathHistory,
  readBucketPathHistory,
} from "./browserPathSuggestions";
import { useBrowserPathHistory } from "./useBrowserPathHistory";

describe("useBrowserPathHistory", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("loads and records history for the current bucket", () => {
    pushBucketPathHistory("docs", "reports/2025/");
    const { result } = renderHook(() =>
      useBrowserPathHistory({ bucketName: "docs" }),
    );

    expect(result.current.history).toEqual(["reports/2025/"]);

    act(() => result.current.record("reports/2026"));

    expect(result.current.history).toEqual([
      "reports/2026/",
      "reports/2025/",
    ]);
    expect(readBucketPathHistory("docs")).toEqual(result.current.history);
  });

  it("switches histories without leaking entries between buckets", () => {
    pushBucketPathHistory("docs", "reports/");
    pushBucketPathHistory("photos", "events/");
    const { result, rerender } = renderHook(
      ({ bucketName }) => useBrowserPathHistory({ bucketName }),
      { initialProps: { bucketName: "docs" } },
    );

    expect(result.current.history).toEqual(["reports/"]);

    rerender({ bucketName: "photos" });

    expect(result.current.history).toEqual(["events/"]);
    act(() => result.current.record("portraits/"));
    expect(readBucketPathHistory("docs")).toEqual(["reports/"]);
    expect(readBucketPathHistory("photos")).toEqual([
      "portraits/",
      "events/",
    ]);
  });

  it("clears the active history and ignores writes without a bucket", () => {
    pushBucketPathHistory("docs", "reports/");
    const { result, rerender } = renderHook(
      ({ bucketName }) => useBrowserPathHistory({ bucketName }),
      { initialProps: { bucketName: "docs" } },
    );

    rerender({ bucketName: "" });
    expect(result.current.history).toEqual([]);

    act(() => result.current.record("ignored/"));

    expect(result.current.history).toEqual([]);
    expect(readBucketPathHistory("docs")).toEqual(["reports/"]);
  });
});
