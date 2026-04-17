/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { CephAdminRgwQuotaConfig } from "../../api/cephAdmin";

type QuotaPatchState = {
  enabled: boolean;
  maxSizeBytes: number | null;
  maxObjects: number | null;
};

type QuotaPatchFields<
  TEnabled extends string,
  TMaxSize extends string,
  TMaxObjects extends string,
> = {
  enabled: TEnabled;
  maxSizeBytes: TMaxSize;
  maxObjects: TMaxObjects;
};

type QuotaPatchResult<
  TEnabled extends string,
  TMaxSize extends string,
  TMaxObjects extends string,
> = Partial<Record<TEnabled, boolean> & Record<TMaxSize | TMaxObjects, number | null>>;

const normalizeQuotaEnabled = (quota?: CephAdminRgwQuotaConfig | null): boolean => {
  if (quota?.enabled != null) {
    return quota.enabled;
  }
  return quota?.max_size_bytes != null || quota?.max_objects != null;
};

const normalizeNullableNumber = (value?: number | null): number | null => {
  return value == null ? null : value;
};

export function buildCephAdminQuotaPatch<
  TEnabled extends string,
  TMaxSize extends string,
  TMaxObjects extends string,
>(
  fields: QuotaPatchFields<TEnabled, TMaxSize, TMaxObjects>,
  initialQuota: CephAdminRgwQuotaConfig | null | undefined,
  current: QuotaPatchState
): QuotaPatchResult<TEnabled, TMaxSize, TMaxObjects> {
  const patch: QuotaPatchResult<TEnabled, TMaxSize, TMaxObjects> = {};
  const initialEnabled = normalizeQuotaEnabled(initialQuota);
  const initialMaxSizeBytes = normalizeNullableNumber(initialQuota?.max_size_bytes);
  const initialMaxObjects = normalizeNullableNumber(initialQuota?.max_objects);

  if (current.enabled !== initialEnabled) {
    patch[fields.enabled] = current.enabled;
  }
  if (current.maxSizeBytes !== initialMaxSizeBytes) {
    patch[fields.maxSizeBytes] = current.maxSizeBytes;
  }
  if (current.maxObjects !== initialMaxObjects) {
    patch[fields.maxObjects] = current.maxObjects;
  }

  return patch;
}
