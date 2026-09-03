/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export const ADMIN_PENDING_REQUESTS_REFRESH_EVENT = "admin-pending-requests:refresh";

export function notifyAdminPendingRequestsRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ADMIN_PENDING_REQUESTS_REFRESH_EVENT));
}
