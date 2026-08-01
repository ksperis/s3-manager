/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

let nextUiDraftId = 0;

export function createUiDraftId(prefix: string): string {
  nextUiDraftId += 1;
  return `${prefix}-${nextUiDraftId}`;
}
