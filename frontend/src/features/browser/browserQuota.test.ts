/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it } from "vitest";
import { resolveBrowserContextQuotas } from "./browserQuota";

describe("resolveBrowserContextQuotas", () => {
  it("falls back to the deferred Browser usage summary", () => {
    expect(
      resolveBrowserContextQuotas(null, null, {
        quota_max_size_bytes: 12_345,
        quota_max_objects: 678,
      })
    ).toEqual({ quotaSizeBytes: 12_345, quotaObjects: 678 });
  });

  it("keeps explicit context limits when they are available", () => {
    expect(
      resolveBrowserContextQuotas(2, 50, {
        quota_max_size_bytes: 12_345,
        quota_max_objects: 678,
      })
    ).toEqual({ quotaSizeBytes: 2 * 1024 ** 3, quotaObjects: 50 });
  });
});
