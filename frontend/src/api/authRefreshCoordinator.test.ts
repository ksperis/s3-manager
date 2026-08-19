import { beforeEach, describe, expect, it, vi } from "vitest";
import { coordinateAuthRefresh } from "./authRefreshCoordinator";

const COMPLETED_KEY = "bucketreef.auth-refresh.completed.v2";

function setLocks(value: unknown): void {
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value,
  });
}

describe("coordinateAuthRefresh", () => {
  beforeEach(() => {
    localStorage.clear();
    setLocks(undefined);
  });

  it("serializes tabs so only one cookie refresh is sent", async () => {
    let tail = Promise.resolve();
    const locks = {
      request: async <T,>(_name: string, _options: { mode: "exclusive" }, callback: () => Promise<T>) => {
        const previous = tail;
        let release = () => {};
        tail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          return await callback();
        } finally {
          release();
        }
      },
    };
    setLocks(locks);
    const refresh = vi.fn(async () => undefined);

    await Promise.all([
      coordinateAuthRefresh(refresh),
      coordinateAuthRefresh(refresh),
    ]);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("skips refresh when another tab completes while this tab waits for the lock", async () => {
    const refresh = vi.fn(async () => undefined);
    setLocks({
      request: async <T,>(_name: string, _options: { mode: "exclusive" }, callback: () => Promise<T>) => {
        localStorage.setItem(COMPLETED_KEY, String(Date.now() + 1));
        return callback();
      },
    });

    await expect(coordinateAuthRefresh(refresh)).resolves.toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes when no other tab completed", async () => {
    const refresh = vi.fn(async () => undefined);
    setLocks({
      request: async <T,>(_name: string, _options: { mode: "exclusive" }, callback: () => Promise<T>) => callback(),
    });

    await expect(coordinateAuthRefresh(refresh)).resolves.toBeUndefined();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("uses the storage lease when Web Locks are unavailable", async () => {
    setLocks(undefined);
    const refresh = vi.fn(async () => undefined);

    await Promise.all([
      coordinateAuthRefresh(refresh),
      coordinateAuthRefresh(refresh),
    ]);

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
