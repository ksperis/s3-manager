import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BrowserObjectVersion } from "../../api/browserContracts";
import BrowserInspectorPanel from "./BrowserInspectorPanel";
import type { BrowserItem } from "./browserTypes";

const fileItem: BrowserItem = {
  id: "object-1",
  key: "reports/object-1.txt",
  name: "object-1.txt",
  type: "file",
  size: "1 KB",
  sizeBytes: 1024,
  modified: "25 Aug 2026",
  owner: "owner-1",
  storageClass: "STANDARD",
  etag: "etag-1",
};

const version: BrowserObjectVersion = {
  key: fileItem.key,
  version_id: "version-1",
  is_latest: true,
  is_delete_marker: false,
  last_modified: "2026-08-25T10:00:00Z",
  size: 1024,
  etag: "etag-version-1",
};

type InspectorProps = ComponentProps<typeof BrowserInspectorPanel>;

function buildProps(overrides: Partial<InspectorProps> = {}): InspectorProps {
  return {
    activeTab: "context",
    workspaceNoun: "bucket",
    workspaceNounCapitalized: "Bucket",
    usePortalWorkspaceLabels: false,
    actionButtonClasses: "action-button",
    context: {
      currentPath: "documents/reports",
      pathStats: {
        totalBytes: 1024,
        files: 1,
        deletedFiles: 1,
        folders: 2,
        deletedFolders: 1,
        storageCounts: { STANDARD: 1 },
      },
      versioningEnabled: true,
      showDeletedObjects: true,
      counts: { objects: 4, versions: 6, deleteMarkers: 2 },
      countsLoading: false,
      countsError: null,
      canCount: true,
      onCount: vi.fn(),
    },
    bucket: {
      name: "documents",
      hasContext: true,
      loading: false,
      error: null,
      data: {
        creation_date: "2026-08-25T10:00:00Z",
        used_bytes: 2048,
        object_count: 10,
        quota_max_size_bytes: 4096,
        quota_max_objects: 20,
        features: {},
      },
      features: [
        {
          key: "versioning",
          label: "Versioning",
          state: "Enabled",
          tone: "active",
        },
      ],
      isCephContext: true,
      cephQuotaScopeLabel: "Account quota",
      cephContextQuotaSizeBytes: 8192,
      cephContextQuotaObjects: 100,
    },
    selection: {
      hasActions: true,
      selectedCount: 1,
      isSingle: true,
      primary: fileItem,
      fileCount: 1,
      folderCount: 0,
      hasDeleted: false,
      selectedBytes: 1024,
      onOpenFullDetails: vi.fn(),
    },
    details: {
      item: fileItem,
      path: `documents/${fileItem.key}`,
      versioningEnabled: true,
      versions: {
        versions: [version],
        loading: false,
        error: null,
        canLoadMore: true,
        onLoadMore: vi.fn(),
        onRestoreVersion: vi.fn(),
        onDeleteVersion: vi.fn(),
      },
      onOpenFullDetails: vi.fn(),
    },
    onSelectTab: vi.fn(),
    onOpenBucketTab: vi.fn(),
    ...overrides,
  };
}

describe("BrowserInspectorPanel", () => {
  it("renders context summaries and routes tab and count actions", () => {
    const props = buildProps();
    render(<BrowserInspectorPanel {...props} />);

    expect(screen.getByText("documents/reports")).toBeInTheDocument();
    expect(screen.getByText("STANDARD (1)")).toBeInTheDocument();
    expect(screen.getByText("1.0 KB")).toBeInTheDocument();
    expect(screen.getByText("Deleted shown")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Recount" }));
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    fireEvent.click(screen.getByRole("tab", { name: "Bucket" }));
    fireEvent.click(screen.getByRole("tab", { name: "Selection" }));

    expect(props.context.onCount).toHaveBeenCalledOnce();
    expect(props.onSelectTab).toHaveBeenNthCalledWith(1, "details");
    expect(props.onOpenBucketTab).toHaveBeenCalledOnce();
    expect(props.onSelectTab).toHaveBeenNthCalledWith(2, "selection");
  });

  it("renders bucket stats, Ceph quotas, and feature states", () => {
    render(<BrowserInspectorPanel {...buildProps({ activeTab: "bucket" })} />);

    expect(screen.getByText("Bucket overview")).toBeInTheDocument();
    expect(screen.getByText("Object count")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("Account quota size")).toBeInTheDocument();
    expect(screen.getByText("8.0 KB")).toBeInTheDocument();
    expect(screen.getByText("Bucket quota objects")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("Versioning")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
  });

  it("renders the selection summary and opens full details", () => {
    const props = buildProps({ activeTab: "selection" });
    render(<BrowserInspectorPanel {...props} />);

    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.getByText(fileItem.name)).toBeInTheDocument();
    expect(screen.getByText("Total size: 1.0 KB")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open full details" }));
    expect(props.selection.onOpenFullDetails).toHaveBeenCalledOnce();
  });

  it("renders object versions and routes detail actions", () => {
    const deletedItem = { ...fileItem, isDeleted: true };
    const props = buildProps({
      activeTab: "details",
      details: {
        ...buildProps().details,
        item: deletedItem,
      },
    });
    render(<BrowserInspectorPanel {...props} />);

    expect(screen.getAllByText(/Deleted object/)).toHaveLength(2);
    expect(screen.getByText("v: version-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open full details" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete version" }));
    fireEvent.click(screen.getByRole("button", { name: "Load more versions" }));

    expect(props.details.onOpenFullDetails).toHaveBeenCalledOnce();
    expect(props.details.versions.onRestoreVersion).toHaveBeenCalledWith(version);
    expect(props.details.versions.onDeleteVersion).toHaveBeenCalledWith(version);
    expect(props.details.versions.onLoadMore).toHaveBeenCalledOnce();
  });
});
