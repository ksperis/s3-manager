/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { PortalAccountRole } from "./accountAccess";
import type { S3AccountSelector } from "./accountParams";
import { withS3AccountParam } from "./accountParams";
import client from "./client";
import type {
  PortalStorageSpaceAccountMemberRole,
  PortalStorageSpaceGrantRole,
  PortalStorageSpaceRole,
} from "./portal";
import type { UserAvatarDescriptor } from "./users";

export type PortalStorageSpaceShareDirection = "with_me" | "by_me";

export type PortalStorageSpaceShare = {
  id: string;
  storage_space_id: string;
  storage_space_name: string;
  user_id?: number | null;
  email: string;
  role: PortalStorageSpaceGrantRole;
  direction: PortalStorageSpaceShareDirection;
  activity_label?: string | null;
};

export type PortalStorageSpaceAccessPerson = {
  user_id?: number | null;
  email: string;
  display_name?: string | null;
  role: PortalStorageSpaceRole;
  portal_role?: PortalAccountRole | null;
  access_source?: "owner" | "direct" | "group" | "direct_and_group" | null;
  avatar?: UserAvatarDescriptor | null;
};

export type PortalStorageSpaceAccessSummary = {
  mode: "private" | "all" | "restricted";
  default_account_member_role?: PortalStorageSpaceAccountMemberRole | null;
  owner?: PortalStorageSpaceAccessPerson | null;
  effective_member_count: number;
  explicit_shares: PortalStorageSpaceShare[];
  public_link_count: number;
  can_manage_access: boolean;
  can_create_public_links: boolean;
};

export type PortalStorageSpaceShareCandidate = {
  user_id: number;
  email: string;
  display_name?: string | null;
  portal_role: PortalAccountRole;
  access_source: "direct" | "group" | "direct_and_group";
  already_shared?: boolean;
  avatar?: UserAvatarDescriptor | null;
};

export type PortalPublicLink = {
  id: number;
  storage_space_id: string;
  storage_space_name: string;
  object_key: string;
  object_name: string;
  url: string;
  label?: string | null;
  created_by_email?: string | null;
  created_at: string;
  expires_at?: string | null;
  revoked_at?: string | null;
  status: string;
};

export async function fetchPortalStorageSpaceAccessSummary(
  accountId: S3AccountSelector,
  spaceId: string,
): Promise<PortalStorageSpaceAccessSummary> {
  const { data } = await client.get<PortalStorageSpaceAccessSummary>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/access-summary`,
    { params: withS3AccountParam(undefined, accountId) },
  );
  return data;
}

export async function listPortalShareCandidates(
  accountId: S3AccountSelector,
): Promise<PortalStorageSpaceShareCandidate[]> {
  const { data } = await client.get<PortalStorageSpaceShareCandidate[]>(
    "/portal/share-candidates",
    { params: withS3AccountParam(undefined, accountId) },
  );
  return data;
}

export async function listPortalStorageSpaceShareCandidates(
  accountId: S3AccountSelector,
  spaceId: string,
): Promise<PortalStorageSpaceShareCandidate[]> {
  const { data } = await client.get<PortalStorageSpaceShareCandidate[]>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/share-candidates`,
    { params: withS3AccountParam(undefined, accountId) },
  );
  return data;
}

export async function grantPortalStorageSpaceShare(
  accountId: S3AccountSelector,
  spaceId: string,
  payload: {
    email?: string;
    user_id?: number;
    role: PortalStorageSpaceGrantRole;
  },
): Promise<PortalStorageSpaceShare> {
  const { data } = await client.post<PortalStorageSpaceShare>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/shares`,
    payload,
    { params: withS3AccountParam(undefined, accountId) },
  );
  return data;
}

export async function updatePortalStorageSpaceShare(
  accountId: S3AccountSelector,
  spaceId: string,
  userId: number,
  role: PortalStorageSpaceGrantRole,
): Promise<PortalStorageSpaceShare> {
  const { data } = await client.put<PortalStorageSpaceShare>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/shares/${userId}`,
    { role },
    { params: withS3AccountParam(undefined, accountId) },
  );
  return data;
}

export async function revokePortalStorageSpaceShare(
  accountId: S3AccountSelector,
  spaceId: string,
  userId: number,
): Promise<PortalStorageSpaceShare[]> {
  const { data } = await client.delete<PortalStorageSpaceShare[]>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/shares/${userId}`,
    { params: withS3AccountParam(undefined, accountId) },
  );
  return data;
}

export async function listPortalStorageSpacePublicLinks(
  accountId: S3AccountSelector,
  spaceId: string,
  options?: { objectKey?: string; includeRevoked?: boolean },
): Promise<PortalPublicLink[]> {
  const baseParams: Record<string, string | boolean> = {};
  if (options?.objectKey) {
    baseParams.object_key = options.objectKey;
  }
  if (options?.includeRevoked) {
    baseParams.include_revoked = true;
  }
  const { data } = await client.get<PortalPublicLink[]>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/public-links`,
    { params: withS3AccountParam(baseParams, accountId) },
  );
  return data;
}

export async function createPortalStorageSpacePublicLink(
  accountId: S3AccountSelector,
  spaceId: string,
  payload: {
    object_key: string;
    label?: string | null;
    expires_at?: string | null;
  },
): Promise<PortalPublicLink> {
  const { data } = await client.post<PortalPublicLink>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/public-links`,
    payload,
    { params: withS3AccountParam(undefined, accountId) },
  );
  return data;
}

export async function revokePortalStorageSpacePublicLink(
  accountId: S3AccountSelector,
  spaceId: string,
  linkId: number,
): Promise<PortalPublicLink[]> {
  const { data } = await client.delete<PortalPublicLink[]>(
    `/portal/storage-spaces/${encodeURIComponent(spaceId)}/public-links/${linkId}`,
    { params: withS3AccountParam(undefined, accountId) },
  );
  return data;
}
