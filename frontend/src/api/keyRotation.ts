/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";

export type KeyRotationType =
  | "endpoint_admin"
  | "endpoint_supervision"
  | "account"
  | "s3_user"
  | "ceph_admin";

export type KeyRotationRequestPayload = {
  endpoint_ids: number[];
  key_types: KeyRotationType[];
  deactivate_only?: boolean;
};

export type KeyRotationResultItem = {
  endpoint_id: number;
  endpoint_name: string;
  key_type: KeyRotationType;
  target_type: string;
  target_id?: string | null;
  target_label?: string | null;
  status: "rotated" | "failed" | "skipped";
  message?: string | null;
  old_access_key?: string | null;
  new_access_key?: string | null;
};

export type KeyRotationSummary = {
  total: number;
  rotated: number;
  failed: number;
  skipped: number;
  deleted_old_keys: number;
  disabled_old_keys: number;
};

export type KeyRotationResponse = {
  mode: "delete_old_keys" | "deactivate_old_keys";
  summary: KeyRotationSummary;
  results: KeyRotationResultItem[];
};

export async function rotateS3Keys(payload: KeyRotationRequestPayload): Promise<KeyRotationResponse> {
  const { data } = await client.post<KeyRotationResponse>("/admin/key-rotation", payload);
  return data;
}
