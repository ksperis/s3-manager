/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it } from "vitest";

import { buildCephAdminQuotaPatch } from "./quotaPatch";

describe("buildCephAdminQuotaPatch", () => {
  it("omits an untouched empty object quota when only the size changes", () => {
    const patch = buildCephAdminQuotaPatch(
      {
        enabled: "quota_enabled",
        maxSizeBytes: "quota_max_size_bytes",
        maxObjects: "quota_max_objects",
      },
      {
        enabled: true,
        max_size_bytes: null,
        max_objects: null,
      },
      {
        enabled: true,
        maxSizeBytes: 4096,
        maxObjects: null,
      }
    );

    expect(patch).toEqual({
      quota_max_size_bytes: 4096,
    });
  });

  it("supports bucket quota field names", () => {
    const patch = buildCephAdminQuotaPatch(
      {
        enabled: "bucket_quota_enabled",
        maxSizeBytes: "bucket_quota_max_size_bytes",
        maxObjects: "bucket_quota_max_objects",
      },
      {
        enabled: true,
        max_size_bytes: null,
        max_objects: null,
      },
      {
        enabled: true,
        maxSizeBytes: 8192,
        maxObjects: null,
      }
    );

    expect(patch).toEqual({
      bucket_quota_max_size_bytes: 8192,
    });
  });

  it("returns null for an explicitly cleared object quota", () => {
    const patch = buildCephAdminQuotaPatch(
      {
        enabled: "quota_enabled",
        maxSizeBytes: "quota_max_size_bytes",
        maxObjects: "quota_max_objects",
      },
      {
        enabled: true,
        max_size_bytes: 4096,
        max_objects: 25,
      },
      {
        enabled: true,
        maxSizeBytes: 4096,
        maxObjects: null,
      }
    );

    expect(patch).toEqual({
      quota_max_objects: null,
    });
  });
});
