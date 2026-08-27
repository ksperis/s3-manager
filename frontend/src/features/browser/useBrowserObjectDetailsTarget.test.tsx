import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BrowserItem } from "./browserTypes";
import { useBrowserObjectDetailsTarget } from "./useBrowserObjectDetailsTarget";

const item: BrowserItem = {
  id: "report.txt",
  key: "report.txt",
  name: "report.txt",
  type: "file",
  size: "1 KB",
  modified: "2026-08-27",
  owner: "owner",
};

describe("useBrowserObjectDetailsTarget", () => {
  it("opens and closes an object details target", () => {
    const { result } = renderHook(() =>
      useBrowserObjectDetailsTarget({
        scopeKey: "account-a:bucket-a:root",
        versioningEnabled: true,
      }),
    );

    act(() => result.current.open(item, "properties"));
    expect(result.current.target).toEqual({
      item,
      initialTab: "properties",
    });

    act(() => result.current.close());
    expect(result.current.target).toBeNull();
  });

  it("clears the target when the Browser scope changes", () => {
    const { result, rerender } = renderHook(
      ({ scopeKey }) =>
        useBrowserObjectDetailsTarget({
          scopeKey,
          versioningEnabled: true,
        }),
      { initialProps: { scopeKey: "account-a:bucket-a:root" } },
    );

    act(() => result.current.open(item, "preview"));
    rerender({ scopeKey: "account-a:bucket-b:root" });

    expect(result.current.target).toBeNull();
  });

  it("closes a versions target when versioning becomes unavailable", () => {
    const { result, rerender } = renderHook(
      ({ versioningEnabled }) =>
        useBrowserObjectDetailsTarget({
          scopeKey: "account-a:bucket-a:root",
          versioningEnabled,
        }),
      { initialProps: { versioningEnabled: true } },
    );

    act(() => result.current.open(item, "versions"));
    rerender({ versioningEnabled: false });

    expect(result.current.target).toBeNull();
  });

  it("keeps a non-version target when versioning is unavailable", () => {
    const { result, rerender } = renderHook(
      ({ versioningEnabled }) =>
        useBrowserObjectDetailsTarget({
          scopeKey: "account-a:bucket-a:root",
          versioningEnabled,
        }),
      { initialProps: { versioningEnabled: true } },
    );

    act(() => result.current.open(item, "preview"));
    rerender({ versioningEnabled: false });

    expect(result.current.target?.initialTab).toBe("preview");
  });
});
