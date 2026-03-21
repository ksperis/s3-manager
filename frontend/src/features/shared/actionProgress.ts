/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export type ActionProgressState = {
  label: string;
  completed: number;
  total: number;
  failed: number;
};

export const calculateActionProgressPercent = (
  progress: Pick<ActionProgressState, "completed" | "total"> | null | undefined
) => {
  if (!progress || progress.total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((progress.completed / progress.total) * 100)));
};
