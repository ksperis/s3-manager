/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export async function runBrowserScopedSave<T>(
  isCurrentScope: () => boolean,
  setSaving: (value: boolean) => void,
  operation: () => Promise<T>,
): Promise<T | null> {
  if (!isCurrentScope()) return null;
  setSaving(true);
  try {
    const result = await operation();
    return isCurrentScope() ? result : null;
  } catch (saveError) {
    if (!isCurrentScope()) return null;
    throw saveError;
  } finally {
    if (isCurrentScope()) setSaving(false);
  }
}
