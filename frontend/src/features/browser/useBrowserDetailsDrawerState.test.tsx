import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BrowserItem } from "./browserTypes";
import { useBrowserDetailsDrawerState } from "./useBrowserDetailsDrawerState";

const item: BrowserItem = {
  id: "report.txt",
  key: "report.txt",
  name: "report.txt",
  type: "file",
  size: "1 KB",
  modified: "2026-08-27",
  owner: "owner",
};

describe("useBrowserDetailsDrawerState", () => {
  it("coordinates object and bucket drawer targets", () => {
    const { result } = renderHook(() =>
      useBrowserDetailsDrawerState({
        scopeKey: "account-a:bucket-a:root",
        versioningEnabled: true,
        onRequestDiscardChanges: vi.fn(),
      }),
    );

    act(() => result.current.openObject(item, "properties"));
    expect(result.current.objectTarget).toEqual({
      item,
      initialTab: "properties",
    });

    act(() => result.current.closeObject());
    expect(result.current.objectTarget).toBeNull();

    act(() => result.current.openBucket("bucket-a"));
    expect(result.current.bucketName).toBe("bucket-a");

    act(() => result.current.closeBucket());
    expect(result.current.bucketName).toBeNull();
  });

  it("clears every drawer when the Browser scope changes", () => {
    const { result, rerender } = renderHook(
      ({ scopeKey }) =>
        useBrowserDetailsDrawerState({
          scopeKey,
          versioningEnabled: true,
          onRequestDiscardChanges: vi.fn(),
        }),
      { initialProps: { scopeKey: "account-a:bucket-a:root" } },
    );

    act(() => {
      result.current.openObject(item, "preview");
      result.current.openBucket("bucket-a");
    });
    rerender({ scopeKey: "account-a:bucket-b:root" });

    expect(result.current.objectTarget).toBeNull();
    expect(result.current.bucketName).toBeNull();
  });

  it("closes a versions target when versioning becomes unavailable", () => {
    const { result, rerender } = renderHook(
      ({ versioningEnabled }) =>
        useBrowserDetailsDrawerState({
          scopeKey: "account-a:bucket-a:root",
          versioningEnabled,
          onRequestDiscardChanges: vi.fn(),
        }),
      { initialProps: { versioningEnabled: true } },
    );

    act(() => result.current.openObject(item, "versions"));
    rerender({ versioningEnabled: false });

    expect(result.current.objectTarget).toBeNull();
  });

  it("defers transitions until dirty drawer changes are confirmed", () => {
    let confirmDiscard: (() => void) | undefined;
    const onRequestDiscardChanges = vi.fn((onConfirm: () => void) => {
      confirmDiscard = onConfirm;
    });
    const transition = vi.fn();
    const { result } = renderHook(() =>
      useBrowserDetailsDrawerState({
        scopeKey: "account-a:bucket-a:root",
        versioningEnabled: true,
        onRequestDiscardChanges,
      }),
    );

    act(() => {
      result.current.openObject(item, "properties");
      result.current.setObjectDirty(true);
    });
    act(() => {
      expect(result.current.requestTransition(transition)).toBe(false);
    });

    expect(onRequestDiscardChanges).toHaveBeenCalledOnce();
    expect(transition).not.toHaveBeenCalled();
    expect(result.current.objectTarget).not.toBeNull();

    act(() => confirmDiscard?.());
    expect(transition).toHaveBeenCalledOnce();
    expect(result.current.objectTarget).toBeNull();
    expect(result.current.hasUnsavedChanges).toBe(false);
  });
});
