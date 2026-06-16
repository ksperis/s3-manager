/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { updatePortalStorageSpace } from "../../api/portal";
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
import { type PortalWorkspaceSpace } from "./portalWorkspaceModel";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

function decodeRouteValue(value?: string): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

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

function statusTone(space: PortalWorkspaceSpace) {
  if (space.status === "Attention") return "warning";
  if (space.status === "Shared") return "primary";
  return "success";
}

export default function PortalStorageSpaceDetailPage() {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const { generalSettings } = useGeneralSettings();
  const [message, setMessage] = useState<string | null>(null);
  const [metadataName, setMetadataName] = useState("");
  const [metadataDescription, setMetadataDescription] = useState("");
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
  }, [space]);

  const handleSaveMetadata = async () => {
    if (!space || !accountIdForApi) return;
    setMetadataBusy(true);
    setMessage(null);
    try {
      await updatePortalStorageSpace(accountIdForApi, space.id, {
        ...(space.nameEditable ? { name: metadataName.trim() || space.name } : {}),
        description: metadataDescription.trim() || null,
      });
      setMessage("Storage Space mis à jour.");
    } catch (err) {
      console.error(err);
      setMessage(extractApiError(err, "Mise à jour impossible pour cet espace."));
    } finally {
      setMetadataBusy(false);
    }
  };

  const handleArchive = async () => {
    if (!space || !accountIdForApi) return;
    if (!window.confirm(`Archiver ${space.name} ? Les objets ne seront pas supprimés.`)) return;
    setMetadataBusy(true);
    setMessage(null);
    try {
      await updatePortalStorageSpace(accountIdForApi, space.id, { archived: true });
      navigate("/portal/storage-spaces");
    } catch (err) {
      console.error(err);
      setMessage(extractApiError(err, "Archivage impossible pour cet espace."));
      setMetadataBusy(false);
    }
  };

  if (accountLoading || loading) {
    return (
      <div className="space-y-4">
        <PageBanner tone="info">Loading storage space...</PageBanner>
      </div>
    );
  }

  if (accountError || error) {
    return (
      <div className="space-y-4">
        <PageBanner tone="error">{accountError ?? error}</PageBanner>
      </div>
    );
  }

  if (!hasAccountContext || !space || !accountIdForApi) {
    return (
      <div className="space-y-4">
        <PageBanner tone="info">Storage space not available.</PageBanner>
      </div>
    );
  }

  const browserAvailable =
    Boolean(generalSettings.browser_enabled) && Boolean(generalSettings.browser_portal_enabled);
  const canRename = space.role === "Owner" && space.nameEditable;
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
        breadcrumbs={[{ label: "Portal" }, { label: "Storage Spaces", to: "/portal/storage-spaces" }, { label: space.name }]}
        inlineContent={<UiBadge tone={statusTone(space)}>{space.status}</UiBadge>}
        actions={[{ label: "Partager", to: "/portal/shares", variant: "secondary" }]}
      />

      {message ? <PageBanner tone="info">{message}</PageBanner> : null}

      {space.role === "Owner" ? (
        <UiCard title="Storage Space details">
          <div className="grid gap-3 lg:grid-cols-[220px_1fr_auto_auto]">
            <input
              className="ui-control h-9 text-xs disabled:opacity-70"
              value={metadataName}
              onChange={(event) => setMetadataName(event.target.value)}
              aria-label="Storage Space name"
              disabled={!canRename || metadataBusy}
              title={canRename ? "Storage Space name" : "Name locked for this Storage Space"}
            />
            <input className="ui-control h-9 text-xs" value={metadataDescription} onChange={(event) => setMetadataDescription(event.target.value)} aria-label="Storage Space description" />
            <UiButton disabled={metadataBusy} onClick={handleSaveMetadata} className="h-9 px-3 py-1.5">
              Save
            </UiButton>
            <UiButton variant="warning" disabled={metadataBusy} onClick={handleArchive} className="h-9 px-3 py-1.5">
              Archive
            </UiButton>
          </div>
        </UiCard>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ObjectMetricCard
          label="Utilisation"
          value={formatBytes(space.usedBytes)}
          detail={quotaPercent == null ? "Quota indisponible" : `sur ${formatBytes(space.quotaBytes)} (${Math.round(quotaPercent)}%)`}
          progress={quotaPercent ?? undefined}
        />
        <ObjectMetricCard label="Objets" value={formatCompactNumber(space.objectCount)} detail={space.objectCount == null ? "Indisponible" : "Suivi"} />
        <ObjectMetricCard label="Taille moyenne" value={formatBytes(averageFileSize)} detail="par objet" />
        <ObjectMetricCard label="Dernière activité" value={lastActivity === "-" ? "-" : "Récente"} detail={lastActivity === "-" ? "Aucune activité disponible" : `Par ${lastActivity}`} />
      </section>

      {browserAvailable ? (
        <div className="min-h-[520px] h-[min(72vh,760px)]">
          <BrowserEmbed
            accountIdForApi={accountIdForApi}
            hasContext={hasAccountContext}
            workspaceSurface="portal"
            actionProfile="portal-basic"
            lockedBucketName={lockedBucketName}
            lockedBucketLabel={space.name}
            storageEndpointCapabilities={selectedAccount?.storage_endpoint_capabilities ?? null}
            quotaMaxSizeGb={selectedAccount?.quota_max_size_gb ?? null}
            quotaMaxObjects={selectedAccount?.quota_max_objects ?? null}
          />
        </div>
      ) : (
        <PageBanner tone="warning">
          Le Browser Portal est désactivé. Activez Browser puis Browser for Portal dans les réglages pour parcourir les fichiers de ce Storage Space.
        </PageBanner>
      )}
    </div>
  );
}
