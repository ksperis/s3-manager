/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";

export type S3Connection = {
  id: number;
  name: string;
  endpoint_url: string;
  region?: string | null;
  provider_hint?: string | null;
  force_path_style?: boolean | null;
  verify_tls?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export async function listConnections(): Promise<S3Connection[]> {
  const { data } = await client.get<S3Connection[]>("/connections");
  return data;
}
