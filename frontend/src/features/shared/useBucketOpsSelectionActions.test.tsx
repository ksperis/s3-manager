/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BucketUiTagDefinition } from "../../api/bucketUiTags";
import type { BucketOpsSelectionExportArtifact } from "./bucketOpsSelectionExport";
import type { BucketUiTagTarget } from "./bucketUiTags";
import { useBucketOpsSelectionActions } from "./useBucketOpsSelectionActions";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

const target: BucketUiTagTarget = {
  key: "ceph-admin:7:tenant-a/alpha",
  endpointId: 7,
  identity: "tenant-a/alpha",
  name: "alpha",
  tenant: "tenant-a",
  contextId: null,
};

const tag: BucketUiTagDefinition = {
  id: 3,
  label: "Critical",
  color_key: "red",
  scope: "standard",
  visibility: "private",
};

const artifact: BucketOpsSelectionExportArtifact = {
  filename: "selection.csv",
  content: '"Name"\n"alpha"',
  mimeType: "text/csv;charset=utf-8",
};

function createOptions() {
  return {
    bucketNames: ["alpha"],
    download: vi.fn(),
    extractError: (error: unknown) =>
      error instanceof Error ? error.message : String(error),
    isStorageOps: false,
    listBuckets: vi.fn(async () => ({
      items: [{ name: "alpha", tenant: "tenant-a" }],
      has_next: false,
    })),
    persistUiTagChanges: vi.fn(async () => undefined),
    prepareExport: vi.fn(async () => artifact),
    refreshBuckets: vi.fn(),
    resolveTarget: vi.fn(() => target),
    scopeId: 7,
    scopeKey: "ceph-admin:7",
    setError: vi.fn(),
  };
}

describe("useBucketOpsSelectionActions", () => {
  it("resolves canonical targets before opening an RGW index check", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useBucketOpsSelectionActions(options));

    await act(async () => result.current.openSelectedBucketIndexChecks());

    expect(options.listBuckets).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ with_stats: false }),
    );
    expect(result.current.indexCheckTargets).toEqual([
      { name: "alpha", tenant: "tenant-a" },
    ]);
    expect(result.current.selectionActionProgress).toBeNull();
    expect(options.setError).not.toHaveBeenCalled();

    act(() => result.current.closeSelectedBucketIndexChecks());
    expect(result.current.indexCheckTargets).toBeNull();
  });

  it("applies UI tags through resolved physical targets and refreshes", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useBucketOpsSelectionActions(options));

    await act(async () => result.current.applyUiTagToSelection(tag, "add"));

    expect(options.persistUiTagChanges).toHaveBeenCalledWith(
      [target],
      [tag],
      [],
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );
    expect(options.refreshBuckets).toHaveBeenCalledOnce();
    expect(result.current.selectionTagActionLoading).toBeNull();
    expect(result.current.selectionActionProgress).toBeNull();
  });

  it("ignores a target resolution that completes after the scope changes", async () => {
    const options = createOptions();
    const deferred = createDeferred<{
      items: Array<{ name: string; tenant: string }>;
      has_next: boolean;
    }>();
    options.listBuckets.mockReturnValueOnce(deferred.promise);
    const { result, rerender } = renderHook(
      ({ scopeId, scopeKey }) =>
        useBucketOpsSelectionActions({ ...options, scopeId, scopeKey }),
      { initialProps: { scopeId: 7, scopeKey: "ceph-admin:7" } },
    );

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.applyUiTagToSelection(tag, "add");
    });
    rerender({ scopeId: 8, scopeKey: "ceph-admin:8" });
    await act(async () => {
      deferred.resolve({
        items: [{ name: "alpha", tenant: "tenant-a" }],
        has_next: false,
      });
      await pending;
    });

    expect(options.persistUiTagChanges).not.toHaveBeenCalled();
    expect(options.refreshBuckets).not.toHaveBeenCalled();
    expect(options.setError).not.toHaveBeenCalled();
    expect(result.current.selectionTagActionLoading).toBeNull();
  });

  it("owns export progress and downloads the prepared artifact", async () => {
    const options = createOptions();
    options.prepareExport.mockImplementationOnce(async (_format, onProgress) => {
      onProgress(1, 1);
      return artifact;
    });
    const { result } = renderHook(() => useBucketOpsSelectionActions(options));

    await act(async () => result.current.exportSelectedBuckets("csv"));

    expect(options.prepareExport).toHaveBeenCalledWith("csv", expect.any(Function));
    expect(options.download).toHaveBeenCalledWith(
      artifact.filename,
      artifact.content,
      artifact.mimeType,
    );
    expect(result.current.selectionExportLoading).toBeNull();
    expect(result.current.selectionActionProgress).toBeNull();
  });

  it("serializes selection actions behind one controller lock", async () => {
    const options = createOptions();
    const deferred = createDeferred<{
      items: Array<{ name: string; tenant: string }>;
      has_next: boolean;
    }>();
    options.listBuckets.mockReturnValueOnce(deferred.promise);
    const { result } = renderHook(() => useBucketOpsSelectionActions(options));

    let tagUpdate!: Promise<void>;
    act(() => {
      tagUpdate = result.current.applyUiTagToSelection(tag, "add");
    });
    await act(async () => result.current.exportSelectedBuckets("csv"));
    expect(options.prepareExport).not.toHaveBeenCalled();

    await act(async () => {
      deferred.resolve({
        items: [{ name: "alpha", tenant: "tenant-a" }],
        has_next: false,
      });
      await tagUpdate;
    });
    await act(async () => result.current.exportSelectedBuckets("csv"));

    expect(options.prepareExport).toHaveBeenCalledOnce();
    expect(options.download).toHaveBeenCalledOnce();
  });

  it("does not download an export prepared for a previous scope", async () => {
    const options = createOptions();
    const deferred = createDeferred<BucketOpsSelectionExportArtifact>();
    options.prepareExport.mockReturnValueOnce(deferred.promise);
    const { result, rerender } = renderHook(
      ({ scopeKey }) =>
        useBucketOpsSelectionActions({ ...options, scopeKey }),
      { initialProps: { scopeKey: "ceph-admin:7" } },
    );

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.exportSelectedBuckets("csv");
    });
    rerender({ scopeKey: "ceph-admin:8" });
    await act(async () => {
      deferred.resolve(artifact);
      await pending;
    });

    expect(options.download).not.toHaveBeenCalled();
    expect(options.setError).not.toHaveBeenCalled();
    expect(result.current.selectionExportLoading).toBeNull();
  });

  it("surfaces current-scope export failures", async () => {
    const options = createOptions();
    options.prepareExport.mockRejectedValueOnce(new Error("export failed"));
    const { result } = renderHook(() => useBucketOpsSelectionActions(options));

    await act(async () => result.current.exportSelectedBuckets("json"));

    expect(options.setError).toHaveBeenCalledWith("export failed");
    expect(options.download).not.toHaveBeenCalled();
  });
});
