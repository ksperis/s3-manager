/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";

export type BucketUiTagVisibility = "private" | "shared";

export type BucketUiTagDefinition = {
  id: number;
  label: string;
  color_key: string;
  scope: "standard";
  visibility: BucketUiTagVisibility;
};

export type BucketUiTagPhysicalTarget = {
  endpoint_id: number;
  tenant: string;
  name: string;
};

export type BucketUiTagCatalog = {
  definitions: BucketUiTagDefinition[];
  assignments: Array<{
    target: BucketUiTagPhysicalTarget;
    tag_ids: number[];
  }>;
};

export type BucketUiTagCreate = {
  label: string;
  color_key?: string;
  visibility?: BucketUiTagVisibility;
};

type CephAdminBucketUiTagTarget = { name: string; tenant?: string };
type StorageOpsBucketUiTagTarget =
  | { context_id: string; name: string }
  | { endpoint_id: number; tenant?: string; name: string };

type BucketUiTagPatch<TTarget> = {
  targets: TTarget[];
  add_tag_ids?: number[];
  create_tags?: BucketUiTagCreate[];
  remove_tag_ids?: number[];
  remove_all?: boolean;
  require_absent?: boolean;
};

export async function fetchCephAdminBucketUiTags(endpointId: number): Promise<BucketUiTagCatalog> {
  const { data } = await client.get<BucketUiTagCatalog>(
    `/ceph-admin/endpoints/${endpointId}/bucket-ui-tags`
  );
  return data;
}

export async function patchCephAdminBucketUiTags(
  endpointId: number,
  payload: BucketUiTagPatch<CephAdminBucketUiTagTarget>
): Promise<BucketUiTagCatalog> {
  const { data } = await client.patch<BucketUiTagCatalog>(
    `/ceph-admin/endpoints/${endpointId}/bucket-ui-tags`,
    payload
  );
  return data;
}

export async function fetchStorageOpsBucketUiTags(): Promise<BucketUiTagCatalog> {
  const { data } = await client.get<BucketUiTagCatalog>("/storage-ops/bucket-ui-tags");
  return data;
}

export async function patchStorageOpsBucketUiTags(
  payload: BucketUiTagPatch<StorageOpsBucketUiTagTarget>
): Promise<BucketUiTagCatalog> {
  const { data } = await client.patch<BucketUiTagCatalog>("/storage-ops/bucket-ui-tags", payload);
  return data;
}
