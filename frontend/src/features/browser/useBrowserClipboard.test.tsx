import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { S3AccountSelector } from "../../api/accountParams";
import type { BrowserItem } from "./browserTypes";
import { useBrowserClipboard } from "./useBrowserClipboard";

const apiMocks = vi.hoisted(() => ({
  copyObject: vi.fn(),
  fetchObjectMetadata: vi.fn(),
  getBrowserBucketCorsStatus: vi.fn(),
}));
const transferMocks = vi.hoisted(() => ({
  transferClipboardObjectBetweenContexts: vi.fn(),
}));

type CapturedTransferParameters = {
  source: { selector: S3AccountSelector; bucket: string };
  destination: { selector: S3AccountSelector; bucket: string };
  resolveMode: (
    selector: S3AccountSelector,
    bucket: string,
  ) => Promise<"direct" | "proxy">;
};

vi.mock("../../api/browserObjects", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/browserObjects")>(
      "../../api/browserObjects",
    );
  return {
    ...actual,
    copyObject: (...args: unknown[]) => apiMocks.copyObject(...args),
    fetchObjectMetadata: (...args: unknown[]) =>
      apiMocks.fetchObjectMetadata(...args),
  };
});

vi.mock("../../api/browserBuckets", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/browserBuckets")>(
      "../../api/browserBuckets",
    );
  return {
    ...actual,
    getBrowserBucketCorsStatus: (...args: unknown[]) =>
      apiMocks.getBrowserBucketCorsStatus(...args),
  };
});

vi.mock("./browserClipboardTransfer", async () => {
  const actual =
    await vi.importActual<typeof import("./browserClipboardTransfer")>(
      "./browserClipboardTransfer",
    );
  return {
    ...actual,
    ...transferMocks,
  };
});

function item(key: string, options: { deleted?: boolean } = {}): BrowserItem {
  return {
    id: `file:${key}`,
    key,
    name: key.split("/").at(-1) ?? key,
    type: "file",
    isDeleted: options.deleted,
    size: "12 B",
    modified: "",
    owner: "",
    sizeBytes: 12,
    modifiedAt: null,
  };
}

function createOptions() {
  return {
    accountId: "acc-1",
    bucketName: "source-bucket",
    cancelCopyDetails: vi.fn(),
    clearOperationController: vi.fn(),
    completeOperation: vi.fn(),
    createOperationController: vi.fn(() => new AbortController()),
    enabled: true,
    functionalProfile: "standard" as const,
    getSseCustomerKeyForScope: vi.fn(() => null),
    listAllObjectsForPrefix: vi.fn().mockResolvedValue([]),
    normalizedPrefix: "",
    onRefreshNow: vi.fn().mockResolvedValue(undefined),
    onStatus: vi.fn(),
    onWarning: vi.fn(),
    parallelism: 2,
    proxyAllowed: true,
    requestOptions: undefined,
    setCopyDetails: vi.fn(),
    showOperations: vi.fn(),
    startOperation: vi.fn(() => "op-1"),
    uiOrigin: "https://bucketreef.example",
    updateOperation: vi.fn(),
  };
}

describe("useBrowserClipboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.copyObject.mockResolvedValue(undefined);
    apiMocks.fetchObjectMetadata.mockResolvedValue({
      size: 12,
      content_type: "text/plain",
    });
    apiMocks.getBrowserBucketCorsStatus.mockResolvedValue({ enabled: true, rules: [] });
    transferMocks.transferClipboardObjectBetweenContexts.mockResolvedValue(
      undefined,
    );
  });

  it("keeps only live objects when copying", () => {
    const options = createOptions();
    const { result } = renderHook(() => useBrowserClipboard(options));

    act(() => {
      result.current.copy([
        item("docs/live.txt"),
        item("docs/deleted.txt", { deleted: true }),
      ]);
    });

    expect(result.current.clipboard?.items).toEqual([
      expect.objectContaining({ key: "docs/live.txt" }),
    ]);
    expect(result.current.clipboard?.mode).toBe("copy");
    expect(options.onWarning).toHaveBeenCalledWith(
      "Deleted objects were skipped.",
    );
    expect(options.onStatus).toHaveBeenCalledWith("Items copied.");
  });

  it("uses server-side copy within the same execution context", async () => {
    const options = createOptions();
    const { result, rerender } = renderHook(
      (overrides: Partial<typeof options>) =>
        useBrowserClipboard({ ...options, ...overrides }),
      { initialProps: {} },
    );
    act(() => result.current.copy([item("docs/report.txt")]));
    rerender({
      bucketName: "destination-bucket",
      normalizedPrefix: "archive/",
    });

    await act(async () => {
      await result.current.paste();
    });

    expect(apiMocks.copyObject).toHaveBeenCalledWith(
      "acc-1",
      "destination-bucket",
      {
        source_bucket: "source-bucket",
        source_key: "docs/report.txt",
        destination_key: "archive/report.txt",
        move: false,
      },
      expect.any(AbortSignal),
      undefined,
    );
    expect(transferMocks.transferClipboardObjectBetweenContexts).not.toHaveBeenCalled();
    expect(options.completeOperation).toHaveBeenCalledWith(
      "op-1",
      "done",
      undefined,
    );
    expect(options.onRefreshNow).toHaveBeenCalledWith("archive/");
  });

  it("blocks cross-context paste outside the advanced profile", async () => {
    const options = createOptions();
    const { result, rerender } = renderHook(
      (overrides: Partial<typeof options>) =>
        useBrowserClipboard({ ...options, ...overrides }),
      { initialProps: {} },
    );
    act(() => result.current.copy([item("docs/report.txt")]));
    rerender({ accountId: "acc-2", bucketName: "destination-bucket" });

    expect(result.current.canPaste).toBe(false);
    await act(async () => {
      await result.current.paste();
    });

    expect(options.onWarning).toHaveBeenCalledWith(
      "Cross-context copy and move require the Advanced Browser profile.",
    );
    expect(apiMocks.copyObject).not.toHaveBeenCalled();
    expect(transferMocks.transferClipboardObjectBetweenContexts).not.toHaveBeenCalled();
  });

  it("routes advanced cross-context copies through the transfer service", async () => {
    const options = createOptions();
    const { result, rerender } = renderHook(
      (overrides: Partial<typeof options>) =>
        useBrowserClipboard({ ...options, ...overrides }),
      { initialProps: {} },
    );
    act(() => result.current.copy([item("docs/report.txt")]));
    rerender({
      accountId: "acc-2",
      bucketName: "destination-bucket",
      functionalProfile: "advanced",
      normalizedPrefix: "archive/",
    });

    expect(result.current.canPaste).toBe(true);
    await act(async () => {
      await result.current.paste();
    });

    expect(apiMocks.fetchObjectMetadata).toHaveBeenCalledWith(
      "acc-1",
      "source-bucket",
      "docs/report.txt",
      null,
      null,
      expect.any(AbortSignal),
      undefined,
    );
    expect(
      transferMocks.transferClipboardObjectBetweenContexts,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({
          selector: "acc-1",
          bucket: "source-bucket",
          key: "docs/report.txt",
        }),
        destination: expect.objectContaining({
          selector: "acc-2",
          bucket: "destination-bucket",
          key: "archive/report.txt",
        }),
        sizeBytes: 12,
        contentType: "text/plain",
        move: false,
        signal: expect.any(AbortSignal),
      }),
    );
    expect(apiMocks.copyObject).not.toHaveBeenCalled();
    expect(options.onRefreshNow).toHaveBeenCalledWith("archive/");
  });

  it("keeps cross-context transfers direct when CORS status is unknown", async () => {
    const resolvedModes: string[] = [];
    apiMocks.getBrowserBucketCorsStatus.mockResolvedValue({
      enabled: false,
      rules: [],
      error: "AccessDenied",
    });
    transferMocks.transferClipboardObjectBetweenContexts.mockImplementation(
      async (parameters: CapturedTransferParameters) => {
        resolvedModes.push(
          await parameters.resolveMode(
            parameters.source.selector,
            parameters.source.bucket,
          ),
          await parameters.resolveMode(
            parameters.destination.selector,
            parameters.destination.bucket,
          ),
        );
      },
    );
    const options = createOptions();
    const { result, rerender } = renderHook(
      (overrides: Partial<typeof options>) =>
        useBrowserClipboard({ ...options, ...overrides }),
      { initialProps: {} },
    );
    act(() => result.current.copy([item("docs/report.txt")]));
    rerender({
      accountId: "acc-2",
      bucketName: "destination-bucket",
      functionalProfile: "advanced",
    });

    await act(async () => {
      await result.current.paste();
    });

    expect(resolvedModes).toEqual(["direct", "direct"]);
    expect(apiMocks.getBrowserBucketCorsStatus).toHaveBeenCalledTimes(2);
  });
});
