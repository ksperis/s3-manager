/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock("./client", () => ({
  default: { post: mocks.post },
  timeoutForRequestProfile: (profile: "interactive" | "long_running") =>
    profile === "interactive" ? 15_000 : 0,
}));

import { importS3Accounts } from "./accounts";
import { compareManagerBucketPair, runManagerBucketCompareAction } from "./buckets";
import { backupCephAdminBucketConfigs, compareCephAdminBucketPair } from "./cephAdminBuckets";
import { rotateS3Keys } from "./keyRotation";

describe("long-running API operations", () => {
  beforeEach(() => {
    mocks.post.mockReset();
    mocks.post.mockResolvedValue({ data: {} });
  });

  it("does not impose the interactive 15 second timeout", async () => {
    await compareManagerBucketPair(1, {} as Parameters<typeof compareManagerBucketPair>[1]);
    await runManagerBucketCompareAction(1, {} as Parameters<typeof runManagerBucketCompareAction>[1]);
    await backupCephAdminBucketConfigs(7, {} as Parameters<typeof backupCephAdminBucketConfigs>[1]);
    await compareCephAdminBucketPair(7, {} as Parameters<typeof compareCephAdminBucketPair>[1]);
    await importS3Accounts([{ rgw_account_id: "RGW-1", storage_endpoint_id: 7 }]);
    await rotateS3Keys({ endpoint_ids: [7], key_types: ["ceph_admin"] });

    expect(mocks.post).toHaveBeenCalledTimes(6);
    for (const call of mocks.post.mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({ timeout: 0 }));
    }
  });
});
