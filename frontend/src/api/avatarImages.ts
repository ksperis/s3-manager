/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";

export async function fetchAuthenticatedAvatarImage(url: string): Promise<Blob> {
  const { data } = await client.get<Blob>(url, { responseType: "blob" });
  return data;
}
