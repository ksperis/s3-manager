/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { updatePortalStorageSpace, type PortalStorageSpaceVisibility } from "../../api/portal";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import UiProgressBar from "../../components/ui/UiProgressBar";
import { cx, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import BrowserEmbed from "../browser/BrowserEmbed";
import type { BrowserActionId } from "../browser/browserActions";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import { storageSpaceObjectPath } from "./portalWorkspaceModel";
import { completePortalTransfer, failPortalTransfer, startPortalTransfer } from "./portalTransferTracker";
import {
  PortalPageState,
  portalStorageSpaceStatusTone,
  resolvePortalWorkspacePageState,
} from "./portalUi";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

function decodeRouteValue(value?: string): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const VIEWER_HIDDEN_BROWSER_ACTION_IDS: readonly BrowserActionId[] = [
  "uploadFiles",
  "uploadFolder",
  "newFolder",
  "delete",
];

function ObjectMetricCard({
  label,
  value,
  detail,
  progress,
}: {
  label: string;
  value: string;
  detail: string;
  progress?: number;
}) {
  return (
    <UiCard bodyClassName="px-4 py-3">
      <div className={cx("text-[11px] font-semibold", uiMutedTextClass)}>{label}</div>
      <div className={cx("mt-2 text-[20px] font-bold leading-6", uiTitleTextClass)}>{value}</div>
      <div className={cx("mt-1 text-[11px] font-medium", uiMutedTextClass)}>{detail}</div>
      {progress != null ? (
        <div className="mt-3">
          <UiProgressBar value={progress} />
        </div>
      ) : null}
    </UiCard>
  );
}

export default function PortalStorageSpaceDetailPage() {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const { generalSettings } = useGeneralSettings();
  const [message, setMessage] = useState<string | null>(null);
  const [metadataName, setMetadataName] = useState("");
  const [metadataDescription, setMetadataDescription] = useState("");
  const [metadataVisibility, setMetadataVisibility] = useState<PortalStorageSpaceVisibility>("private");
  const [metadataBusy, setMetadataBusy] = useState(false);
  const {
    workspace,
    loading,
    error,
    hasAccountContext,
    accountError,
    accountLoading,
    accountIdForApi,
    selectedAccount,
  } = usePortalWorkspaceData();
  const decodedSpaceId = decodeRouteValue(spaceId);
  const space = workspace.spaces.find((item) => item.id === decodedSpaceId) ?? null;

  useEffect(() => {
    if (!space) return;
    setMetadataName(space.name);
    setMetadataDescription(space.description);
    setMetadataVisibility(space.visibility);
  }, [space]);

  const handleSaveMetadata = async () => {
    if (!space || !accountIdForApi) return;
    setMetadataBusy(true);
    setMessage(null);
    try {
      await updatePortalStorageSpace(accountIdForApi, space.id, {
        ...(space.nameEditable ? { name: metadataName.trim() || space.name } : {}),
        description: metadataDescription.trim() || null,
        visibility: metadataVisibility,
      });
      setMessage("Storage Space updated.");
    } catch (err) {
      console.error(err);
      setMessage(extractApiError(err, "Unable to update this Storage Space."));
    } finally {
      setMetadataBusy(false);
    }
  };

  const handleArchive = async () => {
    if (!space || !accountIdForApi) return;
    if (!window.confirm(`Archive ${space.name}? Objects will not be deleted.`)) return;
    setMetadataBusy(true);
    setMessage(null);
    try {
      await updatePortalStorageSpace(accountIdForApi, space.id, { archived: true });
      navigate("/portal/storage-spaces");
    } catch (err) {
      console.error(err);
      setMessage(extractApiError(err, "Unable to archive this Storage Space."));
      setMetadataBusy(false);
    }
  };

  const handleRestore = async () => {
    if (!space || !accountIdForApi) return;
    setMetadataBusy(true);
    setMessage(null);
    try {
      await updatePortalStorageSpace(accountIdForApi, space.id, { archived: false });
      setMessage("Storage Space restored.");
    } catch (err) {
      console.error(err);
      setMessage(extractApiError(err, "Unable to restore this Storage Space."));
    } finally {
      setMetadataBusy(false);
    }
  };

  const pageState = resolvePortalWorkspacePageState({
    accountLoading,
    loading,
    accountError,
    error,
    hasAccountContext,
    loadingMessage: "Loading storage space...",
    noAccountMessage: "Select an account to view this Storage Space.",
  });
  if (pageState) return pageState;

  if (!space || !accountIdForApi) {
    return <PortalPageState>Storage Space not available.</PortalPageState>;
  }

  const browserAvailable =
    Boolean(generalSettings.browser_enabled) && Boolean(generalSettings.browser_portal_enabled);
  const isArchived = space.status === "Archived";
  const canRename = space.role === "Owner" && space.nameEditable;
  const canModifyObjects = space.role === "Owner" || space.role === "Editor";
  const lockedBucketName = space.internalName ?? space.id;
  const quotaPercent =
    space.quotaBytes && space.usedBytes
      ? Math.min(100, (space.usedBytes / space.quotaBytes) * 100)
      : null;
  const averageFileSize =
    space.usedBytes != null && space.objectCount != null && space.objectCount > 0
      ? space.usedBytes / space.objectCount
      : null;
  const lastActivity = workspace.activity.find((item) => item.spaceId === space.id)?.actor ?? "-";

  return (
    <div className="space-y-4">
      <PageHeader
        title={space.name}
        description={`${space.description} Created ${space.createdLabel}. Region: ${space.region ?? "-"}.`}
        breadcrumbs={portalBreadcrumbs({ label: "Storage Spaces", to: "/portal/storage-spaces" }, { label: space.name })}
        inlineContent={<UiBadge tone={portalStorageSpaceStatusTone(space)}>{space.status}</UiBadge>}
        actions={!isArchived && space.visibility === "shared" ? [{ label: "Share", to: "/portal/shares", variant: "secondary" }] : []}
      />

      {message ? <PageBanner tone="info">{message}</PageBanner> : null}

      {space.role === "Owner" ? (
        <UiCard title="Storage Space details">
          <div className="grid gap-3 lg:grid-cols-[220px_1fr_160px_auto_auto]">
            <input
              className="ui-control h-9 text-xs disabled:opacity-70"
              value={metadataName}
              onChange={(event) => setMetadataName(event.target.value)}
              aria-label="Storage Space name"
              disabled={!canRename || metadataBusy}
              title={canRename ? "Storage Space name" : "Name locked for this Storage Space"}
            />
            <input className="ui-control h-9 text-xs" value={metadataDescription} onChange={(event) => setMetadataDescription(event.target.value)} aria-label="Storage Space description" />
            <select
              className="ui-control h-9 py-1.5 text-xs"
              value={metadataVisibility}
              onChange={(event) => setMetadataVisibility(event.target.value as PortalStorageSpaceVisibility)}
              aria-label="Storage Space visibility"
              disabled={metadataBusy || isArchived}
            >
              <option value="private">Private</option>
              <option value="shared">Shared</option>
            </select>
            <UiButton disabled={metadataBusy} onClick={handleSaveMetadata} className="h-9 px-3 py-1.5">
              Save
            </UiButton>
            {isArchived ? (
              <UiButton variant="secondary" disabled={metadataBusy} onClick={handleRestore} className="h-9 px-3 py-1.5">
                Restore
              </UiButton>
            ) : (
              <UiButton variant="warning" disabled={metadataBusy} onClick={handleArchive} className="h-9 px-3 py-1.5">
                Archive
              </UiButton>
            )}
          </div>
        </UiCard>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ObjectMetricCard
          label="Utilisation"
          value={formatBytes(space.usedBytes)}
          detail={quotaPercent == null ? "Quota unavailable" : `of ${formatBytes(space.quotaBytes)} (${Math.round(quotaPercent)}%)`}
          progress={quotaPercent ?? undefined}
        />
        <ObjectMetricCard label="Objects" value={formatCompactNumber(space.objectCount)} detail={space.objectCount == null ? "Unavailable" : "Tracked"} />
        <ObjectMetricCard label="Average size" value={formatBytes(averageFileSize)} detail="per object" />
        <ObjectMetricCard label="Last activity" value={lastActivity === "-" ? "-" : "Recent"} detail={lastActivity === "-" ? "No activity available" : `By ${lastActivity}`} />
      </section>

      {isArchived ? (
        <PageBanner tone="warning">
          This Storage Space is archived. Files and public links are suspended until it is restored.
        </PageBanner>
      ) : browserAvailable ? (
        <div className="min-h-[520px] h-[min(72vh,760px)]">
          <BrowserEmbed
            accountIdForApi={accountIdForApi}
            hasContext={hasAccountContext}
            workspaceSurface="portal"
            actionProfile="portal-basic"
            hiddenActionIds={canModifyObjects ? undefined : VIEWER_HIDDEN_BROWSER_ACTION_IDS}
            lockedBucketName={lockedBucketName}
            lockedBucketLabel={space.name}
            storageEndpointCapabilities={selectedAccount?.storage_endpoint_capabilities ?? null}
            quotaMaxSizeGb={selectedAccount?.quota_max_size_gb ?? null}
            quotaMaxObjects={selectedAccount?.quota_max_objects ?? null}
            onOpenObjectDetailsRoute={(target) => {
              if (target.bucketName !== lockedBucketName) return;
              navigate(storageSpaceObjectPath(space, target.key));
            }}
            transferReporter={{
              start: (transfer) => {
                if (transfer.bucketName !== lockedBucketName) return null;
                return startPortalTransfer({
                  accountId: String(accountIdForApi),
                  spaceId: space.id,
                  spaceName: space.name,
                  name: transfer.name,
                  direction: transfer.direction,
                  sizeBytes: transfer.sizeBytes,
                });
              },
              complete: completePortalTransfer,
              fail: failPortalTransfer,
            }}
          />
        </div>
      ) : (
        <PageBanner tone="warning">
          Portal Browser is disabled. Enable Browser and Browser for Portal in settings to browse files in this Storage Space.
        </PageBanner>
      )}
    </div>
  );
}
