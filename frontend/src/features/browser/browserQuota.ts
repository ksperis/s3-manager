/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

const BYTES_PER_GIB = 1024 ** 3;

export function resolveBrowserContextQuotas(
  quotaSizeGb: number | null,
  quotaObjects: number | null,
  usageSummary?: {
    quota_max_size_bytes?: number | null;
    quota_max_objects?: number | null;
  } | null
): { quotaSizeBytes: number | null; quotaObjects: number | null } {
  return {
    quotaSizeBytes:
      quotaSizeGb != null && quotaSizeGb > 0
        ? quotaSizeGb * BYTES_PER_GIB
        : usageSummary?.quota_max_size_bytes ?? null,
    quotaObjects:
      quotaObjects != null && quotaObjects > 0
        ? quotaObjects
        : usageSummary?.quota_max_objects ?? null,
  };
}
