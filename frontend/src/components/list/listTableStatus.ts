/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export type ListTableStatus = "ready" | "loading" | "error" | "empty";

type ResolveListTableStatusArgs = {
  loading: boolean;
  error?: unknown;
  rowCount: number;
};

export function resolveListTableStatus({
  loading,
  error,
  rowCount,
}: ResolveListTableStatusArgs): ListTableStatus {
  const safeRowCount = Number.isFinite(rowCount) ? Math.max(0, rowCount) : 0;
  if (loading && safeRowCount === 0) return "loading";
  if (error && safeRowCount === 0) return "error";
  if (!loading && !error && safeRowCount === 0) return "empty";
  return "ready";
}
