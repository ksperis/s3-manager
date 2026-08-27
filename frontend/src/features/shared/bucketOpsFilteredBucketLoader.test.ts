/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it, vi } from "vitest";

import type { CephAdminBucket } from "../../api/cephAdmin";
import { loadBucketOpsFilteredBuckets } from "./bucketOpsFilteredBucketLoader";

const bucket = (name: string): CephAdminBucket => ({ name });

describe("loadBucketOpsFilteredBuckets", () => {
  it("loads every filtered page with stable listing parameters and progress", async () => {
    const listBuckets = vi
      .fn()
      .mockResolvedValueOnce({
        items: [bucket("alpha"), bucket("beta")],
        has_next: true,
        total: 3,
      })
      .mockResolvedValueOnce({
        items: [bucket("gamma")],
        has_next: false,
        total: 3,
      });
    const onProgress = vi.fn();

    const result = await loadBucketOpsFilteredBuckets({
      listBuckets,
      onProgress,
      params: {
        filter: "prod",
        sort_by: "name",
        sort_dir: "desc",
        ui_tag_ids: [7],
        ui_tag_match: "all",
        with_stats: false,
      },
      scopeId: 12,
    });

    expect(Array.from(result.keys())).toEqual(["alpha", "beta", "gamma"]);
    expect(listBuckets).toHaveBeenNthCalledWith(1, 12, {
      filter: "prod",
      sort_by: "name",
      sort_dir: "desc",
      ui_tag_ids: [7],
      ui_tag_match: "all",
      with_stats: false,
      page: 1,
      page_size: 200,
    });
    expect(listBuckets).toHaveBeenNthCalledWith(2, 12, expect.objectContaining({ page: 2, page_size: 200 }));
    expect(onProgress).toHaveBeenNthCalledWith(1, 2, 3);
    expect(onProgress).toHaveBeenNthCalledWith(2, 3, 3);
  });

  it("deduplicates bucket identifiers across pages", async () => {
    const listBuckets = vi
      .fn()
      .mockResolvedValueOnce({
        items: [bucket("alpha"), bucket("beta")],
        has_next: true,
      })
      .mockResolvedValueOnce({
        items: [{ ...bucket("beta"), owner: "updated" }, bucket("gamma")],
        has_next: false,
      });
    const onProgress = vi.fn();

    const result = await loadBucketOpsFilteredBuckets({
      initialTotal: 4,
      listBuckets,
      onProgress,
      params: {},
      scopeId: 1,
    });

    expect(Array.from(result.keys())).toEqual(["alpha", "beta", "gamma"]);
    expect(result.get("beta")?.owner).toBe("updated");
    expect(onProgress).toHaveBeenLastCalledWith(3, 4);
  });

  it("stops when the reported total is resolved even if the page claims a successor", async () => {
    const listBuckets = vi.fn().mockResolvedValue({
      items: [bucket("alpha"), bucket("beta")],
      has_next: true,
      total: 2,
    });

    const result = await loadBucketOpsFilteredBuckets({
      listBuckets,
      params: { include: ["quota"] },
      scopeId: 4,
    });

    expect(Array.from(result.keys())).toEqual(["alpha", "beta"]);
    expect(listBuckets).toHaveBeenCalledTimes(1);
  });
});
