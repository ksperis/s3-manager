import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BrowserSettings,
  BrowserUsageSummary,
} from "../../api/browser";
import { useBrowserRuntimeData } from "./useBrowserRuntimeData";

const apiMocks = vi.hoisted(() => ({
  fetchBrowserSettings: vi.fn(),
  fetchBrowserUsageSummary: vi.fn(),
}));

vi.mock("../../api/browser", async () => ({
  ...(await vi.importActual<typeof import("../../api/browser")>(
    "../../api/browser",
  )),
  ...apiMocks,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function settings(parallelism: number): BrowserSettings {
  return {
    allow_proxy_transfers: true,
    direct_upload_parallelism: parallelism,
    proxy_upload_parallelism: parallelism,
    direct_download_parallelism: parallelism,
    proxy_download_parallelism: parallelism,
    other_operations_parallelism: parallelism,
    streaming_zip_threshold_mb: 200,
  };
}

function usage(usedBytes: number): BrowserUsageSummary {
  return {
    available: true,
    source: "account",
    used_bytes: usedBytes,
    object_count: 3,
  };
}

function createOptions() {
  return {
    accountId: "account-a",
    enabled: true,
    requestOptions: { workspaceSurface: "browser" as const },
    showUsage: true,
  };
}

describe("useBrowserRuntimeData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads settings and usage for the active workspace context", async () => {
    apiMocks.fetchBrowserSettings.mockResolvedValue(settings(4));
    apiMocks.fetchBrowserUsageSummary.mockResolvedValue(usage(128));
    const options = createOptions();
    const { result } = renderHook(() => useBrowserRuntimeData(options));

    expect(result.current.settings).toBeNull();
    expect(result.current.usageLoading).toBe(true);
    await waitFor(() => {
      expect(result.current.settings?.direct_upload_parallelism).toBe(4);
      expect(result.current.usageSummary?.used_bytes).toBe(128);
      expect(result.current.usageLoading).toBe(false);
    });
    expect(apiMocks.fetchBrowserSettings).toHaveBeenCalledWith("account-a", {
      workspaceSurface: "browser",
    });
    expect(apiMocks.fetchBrowserUsageSummary).toHaveBeenCalledWith(
      "account-a",
      { workspaceSurface: "browser" },
    );
  });

  it("never exposes runtime data from the previous account", async () => {
    const accountASettings = deferred<BrowserSettings>();
    const accountAUsage = deferred<BrowserUsageSummary>();
    apiMocks.fetchBrowserSettings.mockImplementation((accountId: string) =>
      accountId === "account-a"
        ? accountASettings.promise
        : Promise.resolve(settings(8)),
    );
    apiMocks.fetchBrowserUsageSummary.mockImplementation((accountId: string) =>
      accountId === "account-a"
        ? accountAUsage.promise
        : Promise.resolve(usage(256)),
    );
    const options = createOptions();
    const { result, rerender } = renderHook(
      ({ accountId }) =>
        useBrowserRuntimeData({
          ...options,
          accountId,
        }),
      { initialProps: { accountId: "account-a" } },
    );

    await waitFor(() => {
      expect(apiMocks.fetchBrowserSettings).toHaveBeenCalledWith(
        "account-a",
        expect.any(Object),
      );
    });
    rerender({ accountId: "account-b" });
    expect(result.current.settings).toBeNull();
    expect(result.current.usageSummary).toBeNull();
    expect(result.current.usageLoading).toBe(true);
    await waitFor(() => {
      expect(result.current.settings?.direct_upload_parallelism).toBe(8);
      expect(result.current.usageSummary?.used_bytes).toBe(256);
    });

    await act(async () => {
      accountASettings.resolve(settings(4));
      accountAUsage.resolve(usage(128));
      await Promise.all([accountASettings.promise, accountAUsage.promise]);
    });

    expect(result.current.settings?.direct_upload_parallelism).toBe(8);
    expect(result.current.usageSummary?.used_bytes).toBe(256);
  });

  it("loads usage only while the workspace sidebar needs it", async () => {
    apiMocks.fetchBrowserSettings.mockResolvedValue(settings(4));
    apiMocks.fetchBrowserUsageSummary.mockResolvedValue(usage(128));
    const options = createOptions();
    const { result, rerender } = renderHook(
      ({ showUsage }) =>
        useBrowserRuntimeData({
          ...options,
          showUsage,
        }),
      { initialProps: { showUsage: false } },
    );

    expect(result.current.usageLoading).toBe(false);
    expect(apiMocks.fetchBrowserUsageSummary).not.toHaveBeenCalled();
    rerender({ showUsage: true });
    await waitFor(() => {
      expect(result.current.usageSummary?.used_bytes).toBe(128);
    });
    rerender({ showUsage: false });
    expect(result.current.usageSummary).toBeNull();
    expect(result.current.usageLoading).toBe(false);
    rerender({ showUsage: true });
    expect(result.current.usageSummary).toBeNull();
    expect(result.current.usageLoading).toBe(true);
    await waitFor(() => {
      expect(apiMocks.fetchBrowserUsageSummary).toHaveBeenCalledTimes(2);
    });
  });
});
