/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";

export type AdminPendingRequestCounts = {
  identity_link_requests: number;
  portal_requests: number;
};

export async function fetchAdminPendingRequestCounts(
  signal?: AbortSignal,
): Promise<AdminPendingRequestCounts> {
  const { data } = await client.get<AdminPendingRequestCounts>(
    "/admin/navigation/pending-requests",
    { signal },
  );
  return data;
}
