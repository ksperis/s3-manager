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
    activeTab: "bucket",
    workspaceNoun: "bucket",
    workspaceNounCapitalized: "Bucket",
    usePortalWorkspaceLabels: false,
    technicalDetailsEnabled: false,
    actionButtonClasses: "action-button",
    bucket: {
      available: true,
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
    onSelectDetails: vi.fn(),
    onOpenBucket: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe("BrowserInspectorPanel", () => {
  it("offers only Object and Bucket views and routes close", () => {
    const props = buildProps();
    render(<BrowserInspectorPanel {...props} />);

    expect(screen.getByRole("group", { name: "Details view" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Object" }));
    fireEvent.click(screen.getByRole("button", { name: "Bucket" }));
    fireEvent.click(screen.getByRole("button", { name: "Close details panel" }));
    fireEvent.keyDown(screen.getByLabelText("Details panel"), { key: "Escape" });

    expect(props.onSelectDetails).toHaveBeenCalledOnce();
    expect(props.onOpenBucket).toHaveBeenCalledOnce();
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it("keeps the standard bucket overview useful without technical details", () => {
    render(<BrowserInspectorPanel {...buildProps()} />);

    expect(screen.getByText("Bucket overview")).toBeInTheDocument();
    expect(screen.getByText("Object count")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.queryByText("Ceph quotas")).not.toBeInTheDocument();
    expect(screen.queryByText("Features")).not.toBeInTheDocument();
  });

  it("adds quotas and features only for technical Browser access", () => {
    render(
      <BrowserInspectorPanel
        {...buildProps({ technicalDetailsEnabled: true })}
      />,
    );

    expect(screen.getByText("Ceph quotas")).toBeInTheDocument();
    expect(screen.getByText("Account quota size")).toBeInTheDocument();
    expect(screen.getByText("8.0 KB")).toBeInTheDocument();
    expect(screen.getByText("Versioning")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
  });

  it("shows basic object details to everyone and gates versions", () => {
    const props = buildProps({ activeTab: "details" });
    const { rerender } = render(<BrowserInspectorPanel {...props} />);

    expect(screen.getByText(fileItem.name)).toBeInTheDocument();
    expect(screen.getByText("Path")).toBeInTheDocument();
    expect(screen.queryByText("v: version-1")).not.toBeInTheDocument();

    rerender(
      <BrowserInspectorPanel {...props} technicalDetailsEnabled={true} />,
    );
    expect(screen.getByText("v: version-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open full details" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    expect(props.details.onOpenFullDetails).toHaveBeenCalledOnce();
    expect(props.details.versions.onRestoreVersion).toHaveBeenCalledWith(version);
  });
});
