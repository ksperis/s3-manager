import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StsCredentials } from "../../api/browserContracts";
import { useBrowserStsSession } from "./useBrowserStsSession";

const apiMocks = vi.hoisted(() => ({
  getBrowserStsCredentials: vi.fn(),
  getBrowserStsStatus: vi.fn(),
}));

vi.mock("../../api/browserSts", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/browserSts")>(
      "../../api/browserSts",
    );
  return {
    ...actual,
    getBrowserStsCredentials: (...args: unknown[]) =>
      apiMocks.getBrowserStsCredentials(...args),
    getBrowserStsStatus: (...args: unknown[]) =>
      apiMocks.getBrowserStsStatus(...args),
  };
});

function credentials(accessKeyId: string): StsCredentials {
  return {
    access_key_id: accessKeyId,
    secret_access_key: `secret-${accessKeyId}`,
    session_token: `token-${accessKeyId}`,
    expiration: "2099-01-01T00:00:00Z",
    endpoint: "https://s3.example.test",
    region: "us-east-1",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("useBrowserStsSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getBrowserStsStatus.mockResolvedValue({ available: true });
    apiMocks.getBrowserStsCredentials.mockResolvedValue(credentials("key-1"));
  });

  it("prefetches and reuses unexpired credentials for the active scope", async () => {
    const { result } = renderHook(() =>
      useBrowserStsSession({
        accountIdForApi: "acc-1",
        enabled: true,
        hasContext: true,
      }),
    );

    await waitFor(() => {
      expect(result.current.credentials?.access_key_id).toBe("key-1");
    });

    let cachedCredentials: StsCredentials | null = null;
    await act(async () => {
      cachedCredentials = await result.current.ensureCredentials();
    });

    expect(cachedCredentials?.access_key_id).toBe("key-1");
    expect(apiMocks.getBrowserStsCredentials).toHaveBeenCalledTimes(1);
  });

  it("does not reuse or commit an in-flight request from a previous account", async () => {
    const accountOneRequest = deferred<StsCredentials>();
    const accountTwoRequest = deferred<StsCredentials>();
    apiMocks.getBrowserStsCredentials.mockImplementation((accountId: string) =>
      accountId === "acc-1"
        ? accountOneRequest.promise
        : accountTwoRequest.promise,
    );

    const { result, rerender } = renderHook(
      ({ accountId }) =>
        useBrowserStsSession({
          accountIdForApi: accountId,
          enabled: true,
          hasContext: true,
        }),
      { initialProps: { accountId: "acc-1" } },
    );
    await waitFor(() => {
      expect(apiMocks.getBrowserStsCredentials).toHaveBeenCalledWith(
        "acc-1",
        undefined,
      );
    });

    rerender({ accountId: "acc-2" });
    await waitFor(() => {
      expect(apiMocks.getBrowserStsCredentials).toHaveBeenCalledWith(
        "acc-2",
        undefined,
      );
    });

    await act(async () => {
      accountTwoRequest.resolve(credentials("key-2"));
    });
    await waitFor(() => {
      expect(result.current.credentials?.access_key_id).toBe("key-2");
    });

    await act(async () => {
      accountOneRequest.resolve(credentials("key-1"));
    });
    expect(result.current.credentials?.access_key_id).toBe("key-2");
  });
});
