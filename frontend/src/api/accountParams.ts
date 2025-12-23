/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export type S3AccountSelector = number | string | null | undefined;

export function withS3AccountParam(
  params?: Record<string, unknown> | null,
  accountId?: S3AccountSelector
): Record<string, unknown> | undefined {
  if (accountId == null) {
    return params ?? undefined;
  }
  if (typeof accountId === "number" && accountId <= 0) {
    return params ?? undefined;
  }
  if (typeof accountId === "string" && accountId.trim() === "") {
    return params ?? undefined;
  }
  return { ...(params ?? {}), account_id: accountId };
}
