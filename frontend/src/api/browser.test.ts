import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("./client", () => ({
  default: clientMock,
}));

import { listBrowserObjects } from "./browser";

describe("browser api", () => {
  beforeEach(() => {
    clientMock.get.mockReset();
    clientMock.get.mockResolvedValue({
      data: {
        prefix: "",
        objects: [],
        prefixes: [],
        is_truncated: false,
        next_continuation_token: null,
      },
    });
  });

  it("passes force_refresh when listing objects with an explicit refresh", async () => {
    await listBrowserObjects("conn-7", "bucket-a", {
      prefix: "uploads/",
      maxKeys: 25,
      forceRefresh: true,
    });

    expect(clientMock.get).toHaveBeenCalledWith(
      "/browser/buckets/bucket-a/objects",
      expect.objectContaining({
        params: expect.objectContaining({
          account_id: "conn-7",
          prefix: "uploads/",
          max_keys: 25,
          force_refresh: true,
        }),
      }),
    );
  });
});
