/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";

import type { S3AccountSelector } from "../../api/accountParams";
import type { BrowserBucket } from "../../api/browserContracts";
import { listPortalStorageSpaces } from "../../api/portal";
import { fetchPortalStorageSpaceAccessSummary } from "../../api/portalSharing";
import { useI18n } from "../../i18n";
import StorageSpaceObjectDetailsDrawer from "../shared/StorageSpaceObjectDetailsDrawer";
import type { StorageSpaceObjectDetailsView } from "../shared/objectDetailsContract";
import { buildPortalWorkspaceModel } from "../portal/portalWorkspaceModel";
import type { PortalWorkspaceSpace } from "../portal/portalWorkspaceModel";
import type { BrowserItem } from "./browserTypes";

type BrowserStorageSpaceObjectDetailsDrawerProps = {
  accountId: S3AccountSelector;
  bucket?: BrowserBucket | null;
  bucketName: string;
  canModifyObjects: boolean;
  createPublicLinkOnOpen?: boolean;
  initialView: StorageSpaceObjectDetailsView;
  item: BrowserItem;
  onClose: () => void;
  onMessage: (message: string | null) => void;
  onRefreshObjects: (targetKey: string) => Promise<void>;
};

function fallbackSpace(
  bucketName: string,
  bucket: BrowserBucket | null | undefined,
  canModifyObjects: boolean,
): PortalWorkspaceSpace {
  const role = ["Viewer", "Editor", "Owner", "Manager"].includes(
    bucket?.role ?? "",
  )
    ? (bucket?.role as PortalWorkspaceSpace["role"])
    : "Viewer";
  const archived = bucket?.status?.toLowerCase() === "archived";
  return {
    id: bucketName,
    name: bucket?.display_name?.trim() || bucketName,
    internalName: bucket?.internal_bucket_name ?? bucketName,
    origin: "imported",
    nameEditable: false,
    description: bucket?.description ?? "",
    ownerLabel: null,
    ownerUserId: null,
    collaborators: [],
    collaboratorCount: 0,
    visibility: "private",
    shareScope: "restricted",
    accountMemberRole: null,
    projectKey: null,
    datasetLabel: null,
    role,
    canBrowse: !archived,
    canDelete: canModifyObjects,
    canTakeOwnership: false,
    status: archived ? "Archived" : "Active",
    access: "Private",
    region: null,
    createdLabel: bucket?.creation_date ?? "-",
    usedBytes: bucket?.used_bytes ?? null,
    quotaBytes: bucket?.quota_max_size_bytes ?? null,
    quotaObjects: bucket?.quota_max_objects ?? null,
    objectCount: bucket?.object_count ?? null,
    createdAt: bucket?.creation_date ?? null,
    archivedAt: null,
    shareCount: null,
    icon: bucket?.icon ?? { source: "preset", preset: "bucket" },
  };
}

export default function BrowserStorageSpaceObjectDetailsDrawer({
  accountId,
  bucket,
  bucketName,
  canModifyObjects,
  createPublicLinkOnOpen = false,
  initialView,
  item,
  onClose,
  onMessage,
  onRefreshObjects,
}: BrowserStorageSpaceObjectDetailsDrawerProps) {
  const { locale, t } = useI18n();
  const fallback = useMemo(
    () => fallbackSpace(bucketName, bucket, canModifyObjects),
    [bucket, bucketName, canModifyObjects],
  );
  const [space, setSpace] = useState(fallback);
  const [activeView, setActiveView] =
    useState<StorageSpaceObjectDetailsView>(initialView);
  const [canCreatePublicLinks, setCanCreatePublicLinks] = useState(false);
  const [createLinkRequestToken, setCreateLinkRequestToken] = useState(
    createPublicLinkOnOpen ? 1 : 0,
  );

  useEffect(() => {
    setSpace(fallback);
    setActiveView(initialView);
    setCreateLinkRequestToken(createPublicLinkOnOpen ? 1 : 0);
  }, [createPublicLinkOnOpen, fallback, initialView]);

  useEffect(() => {
    let cancelled = false;
    if (accountId == null) return;
    listPortalStorageSpaces(accountId, { includeArchived: true })
      .then((summaries) => {
        if (cancelled) return;
        const summary = summaries.find(
          (candidate) =>
            candidate.id === bucketName ||
            candidate.internal_bucket_name === bucketName,
        );
        if (!summary) return;
        const resolved = buildPortalWorkspaceModel({
          account: null,
          storageSpaces: [summary],
          usage: null,
          userEmail: null,
          locale,
          t,
        }).spaces[0];
        if (resolved) setSpace(resolved);
      })
      .catch((error) => {
        console.error(error);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, bucketName, locale, t]);

  useEffect(() => {
    let cancelled = false;
    setCanCreatePublicLinks(false);
    if (
      accountId == null ||
      space.role !== "Manager" ||
      space.visibility !== "shared" ||
      space.status === "Archived"
    ) {
      return;
    }
    fetchPortalStorageSpaceAccessSummary(accountId, space.id)
      .then((summary) => {
        if (!cancelled) {
          setCanCreatePublicLinks(Boolean(summary.can_create_public_links));
        }
      })
      .catch((error) => {
        console.error(error);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, space.id, space.role, space.status, space.visibility]);

  const canModify =
    canModifyObjects &&
    space.status !== "Archived" &&
    (space.role === "Editor" ||
      space.role === "Owner" ||
      space.role === "Manager");

  return (
    <StorageSpaceObjectDetailsDrawer
      accountId={accountId}
      activeView={activeView}
      canCreatePublicLinks={canCreatePublicLinks}
      canModify={canModify}
      createPublicLinkRequestToken={createLinkRequestToken}
      isDeleted={Boolean(item.isDeleted)}
      objectKey={item.key}
      space={space}
      onClose={onClose}
      onCreatePublicLinkRequestHandled={() => setCreateLinkRequestToken(0)}
      onMessage={onMessage}
      onRefreshObjects={() => void onRefreshObjects(item.key)}
      onViewChange={setActiveView}
    />
  );
}
