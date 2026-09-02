/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export type CephAdminQuotaUnit = "MiB" | "GiB" | "TiB";

const UNIT_FACTORS: Record<CephAdminQuotaUnit, number> = {
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4,
};

export const parseOptionalNonNegativeInteger = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
};

export const parseQuotaBytes = (value: string, unit: CephAdminQuotaUnit): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * UNIT_FACTORS[unit]);
};

export const quotaBytesToForm = (
  bytes?: number | null
): { value: string; unit: CephAdminQuotaUnit } => {
  if (bytes == null || bytes <= 0) {
    return { value: "", unit: "GiB" };
  }
  if (bytes % UNIT_FACTORS.TiB === 0) {
    return { value: String(bytes / UNIT_FACTORS.TiB), unit: "TiB" };
  }
  if (bytes % UNIT_FACTORS.GiB === 0) {
    return { value: String(bytes / UNIT_FACTORS.GiB), unit: "GiB" };
  }
  if (bytes % UNIT_FACTORS.MiB === 0) {
    return { value: String(bytes / UNIT_FACTORS.MiB), unit: "MiB" };
  }
  return { value: String((bytes / UNIT_FACTORS.GiB).toFixed(2)), unit: "GiB" };
};
