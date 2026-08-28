/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  BulkConfigClipboard,
  BulkOperation,
} from "./bucketBulkOperationsModel";
import { createBucketOpsBulkFormState } from "./bucketOpsBulkInput";
import { useBucketOpsBulkDialog } from "./useBucketOpsBulkDialog";

const clipboard: BulkConfigClipboard = {
  version: 1,
  copiedAt: "2026-08-28T12:00:00.000Z",
  sourceEndpointId: 7,
  sourceEndpointName: "Source",
  features: {
    quota: false,
    versioning: true,
    object_lock: false,
    public_access_block: false,
    lifecycle: false,
    cors: false,
    policy: false,
    access_logging: false,
  },
  buckets: [
    {
      name: "alpha",
      quota: null,
      versioningEnabled: true,
      objectLock: null,
      publicAccessBlock: null,
      lifecycleRules: null,
      corsRules: null,
      policy: null,
      accessLogging: null,
    },
    {
      name: "beta",
      quota: null,
      versioningEnabled: false,
      objectLock: null,
      publicAccessBlock: null,
      lifecycleRules: null,
      corsRules: null,
      policy: null,
      accessLogging: null,
    },
  ],
};

function createOptions(operation: BulkOperation = "") {
  return {
    cancelCopy: vi.fn(),
    clipboard: null as BulkConfigClipboard | null,
    clipboardSameEndpoint: false,
    destinationBucketNames: ["alpha", "beta"],
    formState: createBucketOpsBulkFormState(),
    notificationsEnabled: true,
    operation,
    quotaDisabledReason: null as string | null,
    resetApply: vi.fn(),
    resetCopy: vi.fn(),
    resetForm: vi.fn(),
    resetPreview: vi.fn(),
    selection: new Set(["alpha", "beta"]),
    setOperation: vi.fn(),
    setPasteMapping: vi.fn(),
    usageEnabled: true,
  };
}

describe("useBucketOpsBulkDialog", () => {
  it("opens and closes with the expected workflow resets", () => {
    const options = createOptions();
    const { result } = renderHook(() => useBucketOpsBulkDialog(options));

    act(() => result.current.openDialog());

    expect(result.current.open).toBe(true);
    expect(options.resetForm).toHaveBeenCalled();
    expect(options.resetCopy).toHaveBeenCalled();
    expect(options.resetPreview).toHaveBeenCalled();
    expect(options.resetApply).toHaveBeenCalled();

    Object.values(options).forEach((value) => {
      if (typeof value === "function" && "mockClear" in value) {
        value.mockClear();
      }
    });
    act(() => result.current.closeDialog());

    expect(result.current.open).toBe(false);
    expect(options.resetForm).not.toHaveBeenCalled();
    expect(options.resetCopy).toHaveBeenCalledOnce();
    expect(options.resetPreview).toHaveBeenCalledOnce();
    expect(options.resetApply).toHaveBeenCalledOnce();
  });

  it("invalidates in-flight results when the open workflow input changes", () => {
    const options = createOptions();
    const { result, rerender } = renderHook(
      ({ currentOptions }) => useBucketOpsBulkDialog(currentOptions),
      { initialProps: { currentOptions: options } },
    );
    act(() => result.current.openDialog());
    options.cancelCopy.mockClear();
    options.resetApply.mockClear();
    options.resetPreview.mockClear();

    const changedOptions = {
      ...options,
      formState: {
        ...options.formState,
        bulkOperation: "enable_versioning" as const,
      },
    };
    rerender({ currentOptions: changedOptions });

    expect(options.cancelCopy).toHaveBeenCalledOnce();
    expect(options.resetApply).toHaveBeenCalledOnce();
    expect(options.resetPreview).toHaveBeenCalledOnce();
  });

  it("reconciles the paste mapping while the dialog is open", () => {
    const options = {
      ...createOptions("paste_configs"),
      clipboard,
    };
    const { result } = renderHook(() => useBucketOpsBulkDialog(options));

    act(() => result.current.openDialog());

    const updateMapping = options.setPasteMapping.mock.calls.at(-1)?.[0];
    expect(updateMapping).toBeTypeOf("function");
    expect(updateMapping({})).toEqual({ alpha: "alpha", beta: "beta" });
  });

  it.each([
    {
      operation: "set_quota" as const,
      overrides: { usageEnabled: false },
    },
    {
      operation: "add_notifications" as const,
      overrides: { notificationsEnabled: false },
    },
    {
      operation: "delete_notifications" as const,
      overrides: { notificationsEnabled: false },
    },
  ])("clears unsupported $operation operations", ({ operation, overrides }) => {
    const options = { ...createOptions(operation), ...overrides };

    renderHook(() => useBucketOpsBulkDialog(options));

    expect(options.setOperation).toHaveBeenCalledWith("");
  });
});
