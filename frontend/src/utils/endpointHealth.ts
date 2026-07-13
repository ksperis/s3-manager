/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { HealthCheckStatus } from "../api/healthchecks";

export const ENDPOINT_HEALTH_STALE_AFTER_MS = 10 * 60 * 1000;

export function isEndpointHealthCheckStale(value?: string | null, now = Date.now()): boolean {
  if (!value) return true;
  const timestamp = new Date(value).getTime();
  return !Number.isFinite(timestamp) || now - timestamp > ENDPOINT_HEALTH_STALE_AFTER_MS;
}

export function effectiveEndpointHealthStatus(
  status: HealthCheckStatus,
  checkedAt?: string | null,
  now = Date.now()
): HealthCheckStatus {
  return isEndpointHealthCheckStale(checkedAt, now) ? "unknown" : status;
}
