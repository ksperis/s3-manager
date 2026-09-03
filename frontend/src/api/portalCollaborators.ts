/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { PortalAccountRole } from "./accountAccess";
import type { S3AccountSelector } from "./accountParams";
import { withS3AccountParam } from "./accountParams";
import client from "./client";
import type { PortalStorageSpaceRole } from "./portal";
import type { UserAvatarDescriptor } from "./users";

export type PortalCollaborator = {
  user_id: number;
  email: string;
  display_name?: string | null;
  portal_role: PortalAccountRole;
  access_source: "direct" | "group" | "direct_and_group";
  member_since?: string | null;
  avatar?: UserAvatarDescriptor | null;
  can_review_access?: boolean;
};

export type PortalCollaboratorStorageSpaceAccessSource =
  | "direct"
  | "team"
  | "owner"
  | "project_manager";

export type PortalCollaboratorStorageSpaceAccess = {
  storage_space_id: string;
  storage_space_name: string;
  role: PortalStorageSpaceRole;
  source: PortalCollaboratorStorageSpaceAccessSource;
  can_revoke: boolean;
};

export type PortalCollaboratorAccessReview = {
  collaborator: PortalCollaborator;
  can_request_project_removal: boolean;
  space_accesses: PortalCollaboratorStorageSpaceAccess[];
};

type PortalCollaboratorTrend = {
  window: "month" | "week" | "day";
  label: string;
  period_start: string;
  collaborator_count: number;
};

export type PortalCollaboratorSummary = {
  collaborator_count: number;
  external_access_key_count: number;
  trend?: PortalCollaboratorTrend | null;
};

export type PortalCollaboratorsResponse = {
  summary: PortalCollaboratorSummary;
  collaborators: PortalCollaborator[];
};

export async function fetchPortalCollaborators(
  accountId: S3AccountSelector,
): Promise<PortalCollaboratorsResponse> {
  const { data } = await client.get<PortalCollaboratorsResponse>(
    "/portal/collaborators",
    { params: withS3AccountParam(undefined, accountId) },
  );
  return data;
}

export async function fetchPortalCollaboratorAccessReview(
  accountId: S3AccountSelector,
  userId: number,
): Promise<PortalCollaboratorAccessReview> {
  const { data } = await client.get<PortalCollaboratorAccessReview>(
    `/portal/collaborators/${encodeURIComponent(userId)}/access`,
    { params: withS3AccountParam(undefined, accountId) },
  );
  return data;
}
