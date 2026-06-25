/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  createPortalStorageSpacePublicLink,
  deletePortalStorageSpaceObject,
  downloadPortalStorageSpaceObject,
  fetchPortalStorageSpaceObjectDetail,
  listPortalStorageSpacePublicLinks,
  revokePortalStorageSpacePublicLink,
  type PortalPublicLink,
  type PortalStorageObjectDetail,
} from "../../api/portal";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import PageTabs from "../../components/PageTabs";
import { tableDeleteActionClasses } from "../../components/tableActionClasses";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import { cx, uiCardMutedClass, uiDividerClass, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { formatBytes } from "../../utils/format";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import { storageSpacePath } from "./portalWorkspaceModel";
import {
  PortalPageState,
  resolvePortalWorkspacePageState,
} from "./portalUi";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";
import { completePortalTransfer, failPortalTransfer, startPortalTransfer } from "./portalTransferTracker";

const tabs = ["Preview", "Details", "Events"];

type PendingObjectAction =
  | { type: "delete-object" }
  | { type: "revoke-public-link"; link: PortalPublicLink };

function decodeRouteValue(value?: string): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function decodeObjectPath(value?: string): string {
  if (!value) return "";
  return value
    .split("/")
    .map((part) => decodeRouteValue(part))
    .join("/");
}

function objectName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.at(-1) ?? path;
}

function parentPrefix(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.length > 0 ? `${parts.join("/")}/` : "";
}

function formatObjectDate(raw?: string | null): string {
  if (!raw) return "-";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function FileIcon() {
  return (
    <span className="inline-flex h-14 w-12 items-center justify-center rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] text-[var(--ui-text-muted)] shadow-[var(--ui-shadow-soft)]">
      <svg viewBox="0 0 24 28" aria-hidden="true" className="h-9 w-8">
        <path d="M5 2.5h9l5 5V25.5H5V2.5Z" fill="var(--ui-surface)" stroke="currentColor" strokeWidth="1.6" />
        <path d="M14 2.5v5h5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 18h8" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </span>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-4 text-xs">
      <dt className={cx("font-semibold", uiMutedTextClass)}>{label}</dt>
      <dd className={cx("min-w-0 truncate font-bold", uiTitleTextClass)}>{value}</dd>
    </div>
  );
}

function QuickAction({
  label,
  tone = "blue",
  onClick,
  disabled = false,
  reason,
}: {
  label: string;
  tone?: "blue" | "rose";
  onClick?: () => void;
  disabled?: boolean;
  reason?: string | null;
}) {
  return (
    <div className="grid gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={
          disabled
            ? cx("cursor-not-allowed text-left text-xs font-bold", uiMutedTextClass)
            : tone === "rose"
              ? "text-left text-xs font-bold text-rose-600 hover:text-rose-700 dark:text-rose-300 dark:hover:text-rose-200"
              : "text-left text-xs font-bold text-primary hover:text-primary-600 dark:text-primary-200 dark:hover:text-primary-100"
        }
      >
        {label}
      </button>
      {disabled && reason ? <span className={cx("text-[11px] font-medium leading-4", uiMutedTextClass)}>{reason}</span> : null}
    </div>
  );
}

export default function PortalObjectDetailPage() {
  const params = useParams();
  const [activeTab, setActiveTab] = useState("Preview");
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [objectDetail, setObjectDetail] = useState<PortalStorageObjectDetail | null>(null);
  const [publicLinks, setPublicLinks] = useState<PortalPublicLink[]>([]);
  const [linkExpiration, setLinkExpiration] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingObjectAction | null>(null);
  const [objectLoading, setObjectLoading] = useState(false);
  const [objectError, setObjectError] = useState<string | null>(null);
  const { workspace, loading, error, hasAccountContext, accountError, accountLoading, accountIdForApi } = usePortalWorkspaceData();
  const decodedSpaceId = decodeRouteValue(params.spaceId);
  const objectPath = decodeObjectPath(params["*"]);
  const space = workspace.spaces.find((item) => item.id === decodedSpaceId) ?? null;

  useEffect(() => {
    let cancelled = false;
    if (!space || !accountIdForApi || !objectPath) {
      setObjectDetail(null);
      setObjectLoading(false);
      setObjectError(null);
      return () => {
        cancelled = true;
      };
    }
    setObjectLoading(true);
    setObjectError(null);
    Promise.all([
      fetchPortalStorageSpaceObjectDetail(accountIdForApi, space.id, objectPath),
      space.role === "Owner" && space.visibility === "shared" && space.status !== "Archived"
        ? listPortalStorageSpacePublicLinks(accountIdForApi, space.id, { objectKey: objectPath, includeRevoked: true })
        : Promise.resolve([] as PortalPublicLink[]),
    ])
      .then(([detail, links]) => {
        if (!cancelled) {
          setObjectDetail(detail);
          setPublicLinks(links);
        }
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setObjectDetail(null);
          setPublicLinks([]);
          setObjectError(extractApiError(err, "Unable to load object metadata."));
        }
      })
      .finally(() => {
        if (!cancelled) setObjectLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, objectPath, space]);

  const object = useMemo(
    () => ({
      name: objectDetail?.name || objectName(objectPath),
      path: objectDetail?.key || objectPath,
      sizeBytes: objectDetail?.size ?? null,
      type: objectDetail?.content_type ?? "Unavailable",
      storageClass: objectDetail?.storage_class ?? "STANDARD",
      encryption: objectDetail?.encryption ?? "-",
      lastModified: formatObjectDate(objectDetail?.last_modified),
      previewType: objectDetail?.preview_type ?? "unavailable",
      previewText: objectDetail?.preview_text ?? null,
      previewUnavailableReason: objectDetail?.preview_unavailable_reason ?? "Preview unavailable.",
    }),
    [objectDetail, objectPath]
  );

  const pageState = resolvePortalWorkspacePageState({
    accountLoading,
    loading,
    accountError,
    error,
    hasAccountContext,
    loadingMessage: "Loading object...",
    noAccountMessage: "Select an account to view this object.",
  });
  if (pageState) return pageState;

  if (!space || !objectPath) {
    return <PortalPageState>Object not available.</PortalPageState>;
  }

  const displayPath = object.path;
  const parentPath = object.path.split("/").slice(0, -1).join("/");
  const canCreatePublicLink = space.role === "Owner" && space.visibility === "shared" && space.status !== "Archived";
  const publicLinkUnavailableReason = !accountIdForApi
    ? "Select a Portal account first."
    : space.status === "Archived"
      ? "Archived Storage Spaces cannot create public links."
      : space.role !== "Owner"
        ? "Only Owners can create public links."
        : space.visibility !== "shared"
          ? "Public links are available only for shared Storage Spaces."
          : null;
  const deleteUnavailableReason = !accountIdForApi
    ? "Select a Portal account first."
    : space.role === "Viewer"
      ? "Viewers cannot delete files."
      : null;
  const objectEvents = workspace.activity.filter((item) => item.target === object.name || item.target === object.path);
  const copyPath = async () => {
    if (!navigator.clipboard) {
      setDownloadMessage("Clipboard is unavailable in this browser.");
      return;
    }
    try {
      await navigator.clipboard.writeText(object.path);
      setDownloadMessage("Path copied.");
    } catch {
      setDownloadMessage("Clipboard is unavailable in this browser.");
    }
  };
  const handleCreatePublicLink = async () => {
    if (!accountIdForApi || !space || linkBusy || !canCreatePublicLink) return;
    setLinkBusy(true);
    setDownloadMessage(null);
    try {
      const link = await createPortalStorageSpacePublicLink(accountIdForApi, space.id, {
        object_key: object.path,
        label: object.name,
        expires_at: linkExpiration ? new Date(linkExpiration).toISOString() : null,
      });
      setPublicLinks((current) => [link, ...current.filter((item) => item.id !== link.id)]);
      setDownloadMessage("Public link created.");
    } catch (err) {
      console.error(err);
      setDownloadMessage(extractApiError(err, "Unable to create public link."));
    } finally {
      setLinkBusy(false);
    }
  };
  const handleRevokePublicLink = (link: PortalPublicLink) => {
    if (!accountIdForApi || !space || linkBusy) return;
    setPendingAction({ type: "revoke-public-link", link });
  };
  const confirmRevokePublicLink = async (link: PortalPublicLink) => {
    if (!accountIdForApi || !space || linkBusy) return;
    setLinkBusy(true);
    setDownloadMessage(null);
    try {
      const links = await revokePortalStorageSpacePublicLink(accountIdForApi, space.id, link.id);
      setPublicLinks(links);
      setDownloadMessage("Public link revoked.");
      setPendingAction(null);
    } catch (err) {
      console.error(err);
      setDownloadMessage(extractApiError(err, "Unable to revoke public link."));
      setPendingAction(null);
    } finally {
      setLinkBusy(false);
    }
  };
  const handleDownload = async () => {
    if (!accountIdForApi || downloading) return;
    const transferId = startPortalTransfer({
      accountId: accountIdForApi,
      spaceId: space.id,
      spaceName: space.name,
      name: object.name || objectName(object.path),
      direction: "Download",
      sizeBytes: object.sizeBytes ?? undefined,
    });
    setDownloading(true);
    setDownloadMessage(null);
    try {
      const result = await downloadPortalStorageSpaceObject(accountIdForApi, space.id, object.path);
      completePortalTransfer(transferId, result.filename);
      const href = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
      setDownloadMessage(`${result.filename} downloaded.`);
    } catch (err) {
      console.error(err);
      const message = extractApiError(err, "Unable to download this object.");
      failPortalTransfer(transferId, message);
      setDownloadMessage(message);
    } finally {
      setDownloading(false);
    }
  };
  const handleDelete = () => {
    if (!accountIdForApi || !space || deleteBusy || deleteUnavailableReason) return;
    setPendingAction({ type: "delete-object" });
  };
  const confirmDelete = async () => {
    if (!accountIdForApi || !space || deleteBusy) return;
    setDeleteBusy(true);
    setDownloadMessage(null);
    try {
      await deletePortalStorageSpaceObject(accountIdForApi, space.id, object.path);
      setDownloadMessage(`${object.name} deleted.`);
      setPendingAction(null);
      window.setTimeout(() => {
        window.location.href = `${storageSpacePath(space)}?prefix=${encodeURIComponent(parentPath ? `${parentPath}/` : "")}`;
      }, 250);
    } catch (err) {
      console.error(err);
      setDownloadMessage(extractApiError(err, "Unable to delete this object."));
      setPendingAction(null);
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={object.name || objectName(object.path)}
        description={object.path}
        breadcrumbs={portalBreadcrumbs(
          { label: "Storage Spaces", to: "/portal/storage-spaces" },
          { label: space.name, to: storageSpacePath(space) },
          { label: object.name || objectName(object.path) },
        )}
        actions={[
          { label: downloading ? "Downloading..." : "Download", onClick: handleDownload, variant: "secondary", disabled: !accountIdForApi || downloading },
          { label: linkBusy ? "Sharing..." : "Share", onClick: handleCreatePublicLink, variant: "secondary", disabled: Boolean(publicLinkUnavailableReason) || linkBusy },
        ]}
      />

      <UiCard>
        <div className="flex min-w-0 gap-4">
          <FileIcon />
          <div className="min-w-0">
            <p className={cx("ui-body font-semibold", uiTitleTextClass)}>{object.name || objectName(object.path)}</p>
            <div className={cx(uiCardMutedClass, "mt-3 flex max-w-2xl items-center gap-2 px-3 py-2 text-xs font-semibold", uiMutedTextClass)}>
              <span className="min-w-0 flex-1 truncate">{displayPath}</span>
              <button type="button" onClick={copyPath} className="shrink-0 text-primary hover:text-primary-600 dark:text-primary-200 dark:hover:text-primary-100">Copy</button>
            </div>
          </div>
        </div>
      </UiCard>

      {downloadMessage ? <PageBanner tone="info">{downloadMessage}</PageBanner> : null}
      {objectError ? <PageBanner tone="warning">{objectError}</PageBanner> : null}

      <div className={cx("border-b pb-3", uiDividerClass)}>
        <PageTabs tabs={tabs.map((tab) => ({ id: tab, label: tab }))} activeTab={activeTab} onChange={setActiveTab} variant="bar" />
      </div>

      {activeTab === "Preview" ? (
        <div className="space-y-4">
          <section className="grid gap-4 xl:grid-cols-[1fr_300px]">
            <UiCard title="Quick preview">
              {object.previewType === "text" && object.previewText ? (
                <pre className="max-h-72 overflow-auto rounded-md border border-[color:var(--ui-border)] bg-slate-950 p-3 text-xs leading-5 text-slate-50">{object.previewText}</pre>
              ) : (
                <div className={cx(uiCardMutedClass, "min-h-28 p-3 text-xs font-semibold leading-5", uiMutedTextClass)}>
                  {object.previewUnavailableReason}
                </div>
              )}
              <div className="mt-3 text-right text-xs font-bold">
                <Link to={`${storageSpacePath(space)}?prefix=${encodeURIComponent(parentPath ? `${parentPath}/` : "")}`}>
                  Open in file list
                </Link>
              </div>
            </UiCard>

            <UiCard title="Quick actions">
              <div className="grid gap-4">
                <QuickAction label="Download" onClick={handleDownload} />
                <QuickAction label="Create public link" onClick={handleCreatePublicLink} disabled={Boolean(publicLinkUnavailableReason) || linkBusy} reason={publicLinkUnavailableReason} />
                <QuickAction label="Copy path" onClick={copyPath} />
                <QuickAction label={deleteBusy ? "Deleting..." : "Delete object"} tone="rose" onClick={handleDelete} disabled={Boolean(deleteUnavailableReason) || deleteBusy} reason={deleteUnavailableReason} />
              </div>
            </UiCard>
          </section>

          {space.role === "Owner" ? (
            <UiCard title="Public links">
              <div className="mb-3 grid gap-2 sm:grid-cols-[220px_auto]">
                <input
                  type="datetime-local"
                  className="ui-control h-9 text-xs"
                  value={linkExpiration}
                  onChange={(event) => setLinkExpiration(event.target.value)}
                  aria-label="Public link expiration"
                />
                <UiButton onClick={handleCreatePublicLink} disabled={!canCreatePublicLink || linkBusy} className="h-9 px-3 py-1.5">
                  {linkBusy ? "Creating..." : "Create link"}
                </UiButton>
              </div>
              {publicLinkUnavailableReason ? (
                <div className={cx("mb-3 text-[11px] font-semibold", uiMutedTextClass)}>
                  Create public link unavailable: {publicLinkUnavailableReason}
                </div>
              ) : null}
              <div className="overflow-x-auto">
                <table className="ui-data-table min-w-[760px]">
                  <thead>
                    <tr>
                      <th>Object</th>
                      <th>Status</th>
                      <th>Expiration</th>
                      <th>Link</th>
                      <th className="text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {publicLinks.map((link) => (
                      <tr key={link.id}>
                        <td className={cx("font-bold", uiTitleTextClass)}>{link.object_name}</td>
                        <td><UiBadge tone={link.status === "Active" ? "success" : "neutral"}>{link.status}</UiBadge></td>
                        <td>{link.expires_at ? formatObjectDate(link.expires_at) : "-"}</td>
                        <td className="max-w-[260px] truncate text-primary dark:text-primary-200">{link.url}</td>
                        <td className="text-right">
                          {link.status === "Active" ? (
                            <button type="button" onClick={() => handleRevokePublicLink(link)} className={tableDeleteActionClasses}>
                              Revoke
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                    {publicLinks.length === 0 ? (
                      <tr>
                        <td colSpan={5} className={cx("py-5 text-center text-xs font-semibold", uiMutedTextClass)}>
                          No public links for this object.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </UiCard>
          ) : null}
        </div>
      ) : null}

      {activeTab === "Details" ? (
        <UiCard title="General information">
          <dl className="grid gap-4">
            <DetailRow label="Size" value={formatBytes(object.sizeBytes)} />
            <DetailRow label="Content type" value={object.type} />
            <DetailRow label="Last modified" value={object.lastModified} />
            <DetailRow label="Path" value={object.path} />
          </dl>
          <details className={cx("mt-4 rounded-md border border-[color:var(--ui-border)] px-3 py-2 text-xs", uiMutedTextClass)}>
            <summary className={cx("cursor-pointer font-bold", uiTitleTextClass)}>Technical details</summary>
            <dl className="mt-3 grid gap-4">
              <DetailRow label="Storage class" value={object.storageClass} />
              <DetailRow label="Encryption" value={object.encryption} />
            </dl>
          </details>
          {objectLoading ? <div className={cx("mt-4 text-[11px] font-semibold", uiMutedTextClass)}>Loading metadata...</div> : null}
        </UiCard>
      ) : null}

      {activeTab === "Events" ? (
        <UiCard title="Recent events">
          <div className="grid gap-2">
            {objectEvents.slice(0, 12).map((item) => (
              <div key={item.id} className={cx(uiCardMutedClass, "px-3 py-2 text-xs")}>
                <div className={cx("font-bold", uiTitleTextClass)}>{item.action}</div>
                <div className={cx("mt-1", uiMutedTextClass)}>{item.actor} · {item.timeLabel}</div>
              </div>
            ))}
            {objectEvents.length === 0 ? (
              <div className={cx(uiCardMutedClass, "px-3 py-6 text-center text-xs font-semibold", uiMutedTextClass)}>
                No object events available.
              </div>
            ) : null}
          </div>
        </UiCard>
      ) : null}

      {pendingAction?.type === "delete-object" ? (
        <ConfirmActionDialog
          title="Delete object"
          description="Confirm that you want to delete this file."
          confirmLabel="Delete object"
          loading={deleteBusy}
          details={[
            { label: "File", value: object.name || objectName(object.path) },
            { label: "Path", value: object.path, mono: true },
          ]}
          impacts={[
            "The file is permanently removed from this Storage Space.",
            "Existing public links for this file will stop working once the object is gone.",
            "This action cannot be undone from the Portal.",
          ]}
          onCancel={() => setPendingAction(null)}
          onConfirm={confirmDelete}
        />
      ) : null}

      {pendingAction?.type === "revoke-public-link" ? (
        <ConfirmActionDialog
          title="Revoke public link"
          description="Confirm that you want to revoke this public link."
          confirmLabel="Revoke link"
          loading={linkBusy}
          details={[
            { label: "Object", value: pendingAction.link.object_name },
            { label: "Link", value: pendingAction.link.url, mono: true },
          ]}
          impacts={[
            "Anyone using this URL loses access immediately.",
            "The object remains in the Storage Space.",
            "You can create a new public link later if sharing is still allowed.",
          ]}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => confirmRevokePublicLink(pendingAction.link)}
        />
      ) : null}
    </div>
  );
}
