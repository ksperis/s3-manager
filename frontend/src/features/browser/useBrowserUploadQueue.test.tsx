import { act, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationItem, UploadCandidate, UploadQueueItem } from "./browserTypes";
import { useBrowserUploadQueue } from "./useBrowserUploadQueue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const candidate = (name: string, relativePath?: string): UploadCandidate => ({
  file: new File([name], name, { type: "text/plain" }),
  relativePath,
});

function createOptions() {
  return {
    accountId: "acc-1",
    bucketName: "bucket-a",
    cancelOperationController: vi.fn(),
    enabled: true,
    normalizedPrefix: "docs/",
    onRefreshListing: vi.fn(),
    onShowOperations: vi.fn(),
    onStatus: vi.fn(),
    onWarning: vi.fn(),
    operations: [] as OperationItem[],
    parallelism: 1,
    prefix: "docs/",
    setUploadQueue: vi.fn(),
    startUpload: vi.fn<(item: UploadQueueItem) => Promise<boolean>>(),
    workspaceNoun: "bucket",
  };
}

function StrictModeWrapper({ children }: { children: ReactNode }) {
  return <StrictMode>{children}</StrictMode>;
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("useBrowserUploadQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("honors upload parallelism and refreshes once the queue is idle", async () => {
    vi.useFakeTimers();
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    const options = createOptions();
    options.startUpload
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useBrowserUploadQueue(options), {
      wrapper: StrictModeWrapper,
    });

    act(() => {
      result.current.addFiles([candidate("a.txt"), candidate("b.txt")]);
    });

    expect(options.onShowOperations).toHaveBeenCalledOnce();
    expect(options.startUpload).toHaveBeenCalledTimes(1);
    expect(options.onStatus).toHaveBeenCalledWith("1 upload queued.");

    await act(async () => {
      first.resolve(true);
      await first.promise;
      await flushMicrotasks();
    });
    expect(options.startUpload).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.resolve(true);
      await second.promise;
      await flushMicrotasks();
    });
    expect(options.onRefreshListing).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(300));
    expect(options.onRefreshListing).toHaveBeenCalledOnce();
    expect(options.onRefreshListing).toHaveBeenCalledWith("docs/");
  });

  it("removes a queued group and cancels its active operations", async () => {
    const activeUpload = deferred<boolean>();
    const options = createOptions();
    options.startUpload.mockReturnValue(activeUpload.promise);
    const { result, rerender } = renderHook(
      ({ operations }) => useBrowserUploadQueue({ ...options, operations }),
      { initialProps: { operations: [] as OperationItem[] } },
    );

    act(() => {
      result.current.addFiles([candidate("a.txt"), candidate("b.txt")]);
    });
    const startedItem = options.startUpload.mock.calls[0]?.[0];
    expect(startedItem).toBeDefined();
    const groupId = startedItem?.groupId ?? "";
    rerender({
      operations: [
        {
          id: "op-1",
          label: "Uploading",
          path: "bucket-a/docs/a.txt",
          progress: 20,
          kind: "upload",
          groupId,
        },
      ],
    });

    act(() => result.current.cancelUploadGroup(groupId));

    expect(options.cancelOperationController).toHaveBeenCalledWith("op-1");
    const lastQueue = options.setUploadQueue.mock.calls.at(-1)?.[0] as
      | UploadQueueItem[]
      | undefined;
    expect(lastQueue).toEqual([]);

    await act(async () => {
      activeUpload.resolve(false);
      await activeUpload.promise;
      await flushMicrotasks();
    });
  });

  it("does not enqueue files without an active Browser context", () => {
    const options = {
      ...createOptions(),
      bucketName: "",
      enabled: false,
    };
    const { result } = renderHook(() => useBrowserUploadQueue(options));

    act(() => result.current.addFiles([candidate("blocked.txt")]));

    expect(options.startUpload).not.toHaveBeenCalled();
    expect(options.setUploadQueue).not.toHaveBeenCalled();
  });
});
