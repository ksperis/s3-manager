/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export const EXECUTION_CONTEXTS_REFRESH_EVENT = "execution-contexts:refresh";

export function notifyExecutionContextsRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EXECUTION_CONTEXTS_REFRESH_EVENT));
}
