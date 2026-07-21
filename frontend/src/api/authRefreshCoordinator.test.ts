import { beforeEach, describe, expect, it, vi } from "vitest";
import { coordinateAuthRefresh } from "./authRefreshCoordinator";

describe("coordinateAuthRefresh", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("serializes tabs and reuses the access token renewed by the first one", async () => {
    let token = "expired";
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
    const refresh = vi.fn(async () => {
      token = "renewed";
      return token;
    });

    const [first, second] = await Promise.all([
      coordinateAuthRefresh("expired", refresh, { locks, readToken: () => token }),
      coordinateAuthRefresh("expired", refresh, { locks, readToken: () => token }),
    ]);

    expect(first).toBe("renewed");
    expect(second).toBe("renewed");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("skips refresh when another tab already wrote a newer token", async () => {
    const refresh = vi.fn(async () => "unexpected");

    await expect(coordinateAuthRefresh("expired", refresh, {
      locks: null,
      readToken: () => "renewed",
      wait: async () => {},
    })).resolves.toBe("renewed");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not infer renewal when the failed request token is unknown", async () => {
    const refresh = vi.fn(async () => "renewed");
    const locks = {
      request: async <T,>(_name: string, _options: { mode: "exclusive" }, callback: () => Promise<T>) => callback(),
    };

    await expect(coordinateAuthRefresh(null, refresh, {
      locks,
      readToken: () => "current-but-unverified",
    })).resolves.toBe("renewed");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("uses the storage lease when Web Locks are unavailable", async () => {
    let token = "expired";
    const refresh = vi.fn(async () => {
      token = "renewed";
      return token;
    });

    const [first, second] = await Promise.all([
      coordinateAuthRefresh("expired", refresh, { locks: null, readToken: () => token, ownerId: "tab-a" }),
      coordinateAuthRefresh("expired", refresh, { locks: null, readToken: () => token, ownerId: "tab-b" }),
    ]);

    expect(first).toBe("renewed");
    expect(second).toBe("renewed");
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
