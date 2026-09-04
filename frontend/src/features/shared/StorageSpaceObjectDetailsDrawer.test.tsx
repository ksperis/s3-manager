import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import StorageSpaceObjectDetailsDrawer from "./StorageSpaceObjectDetailsDrawer";
import type { PortalWorkspaceSpace } from "../portal/portalWorkspaceModel";

const mocks = vi.hoisted(() => ({
  createLink: vi.fn(),
  deleteObject: vi.fn(),
  downloadObject: vi.fn(),
  fetchDetail: vi.fn(),
  fetchVersions: vi.fn(),
  listLinks: vi.fn(),
  restoreObject: vi.fn(),
  revokeLink: vi.fn(),
}));

vi.mock("../../api/portal", () => ({
  deletePortalStorageSpaceObject: (...args: unknown[]) => mocks.deleteObject(...args),
  downloadPortalStorageSpaceObject: (...args: unknown[]) => mocks.downloadObject(...args),
  fetchPortalStorageSpaceObjectDetail: (...args: unknown[]) => mocks.fetchDetail(...args),
  fetchPortalStorageSpaceObjectVersions: (...args: unknown[]) => mocks.fetchVersions(...args),
  restorePortalStorageSpaceObject: (...args: unknown[]) => mocks.restoreObject(...args),
}));

vi.mock("../../api/portalSharing", () => ({
  createPortalStorageSpacePublicLink: (...args: unknown[]) => mocks.createLink(...args),
  listPortalStorageSpacePublicLinks: (...args: unknown[]) => mocks.listLinks(...args),
  revokePortalStorageSpacePublicLink: (...args: unknown[]) => mocks.revokeLink(...args),
}));

const space: PortalWorkspaceSpace = {
  id: "space-1",
  name: "Research data",
  internalName: "bucket-1",
  origin: "portal_named",
  nameEditable: true,
  description: "",
  ownerLabel: "Manager",
  ownerUserId: 1,
  collaborators: [],
  collaboratorCount: 0,
  visibility: "shared",
  shareScope: "restricted",
  accountMemberRole: null,
  projectKey: null,
  datasetLabel: null,
  role: "Manager",
  canBrowse: true,
  canDelete: true,
  canTakeOwnership: false,
  status: "Active",
  access: "Shared",
  region: "eu-west-3",
  createdLabel: "2026-01-01",
  shareCount: 0,
  icon: { source: "preset", preset: "archive" },
};

const baseProps = {
  accountId: "101",
  activeView: "preview" as const,
  canCreatePublicLinks: true,
  canModify: true,
  isDeleted: false,
  objectKey: "reports/2026/report.csv",
  space,
  onClose: vi.fn(),
  onMessage: vi.fn(),
  onRefreshObjects: vi.fn(),
  onViewChange: vi.fn(),
};

describe("StorageSpaceObjectDetailsDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    mocks.fetchDetail.mockResolvedValue({
      key: "reports/2026/report.csv",
      name: "report.csv",
      size: 24,
      last_modified: "2026-08-01T10:00:00Z",
      content_type: "text/csv",
      storage_class: "STANDARD",
      encryption: "AES256",
      preview_type: "text",
      preview_text: "id,value\n1,reef",
    });
    mocks.fetchVersions.mockResolvedValue({
      key: "reports/2026/report.csv",
      versioning_status: "Disabled",
      can_restore: false,
      versions: [],
      is_truncated: false,
    });
    mocks.listLinks.mockResolvedValue([]);
    mocks.createLink.mockResolvedValue({
      id: 7,
      storage_space_id: "space-1",
      storage_space_name: "Research data",
      object_key: "reports/2026/report.csv",
      object_name: "report.csv",
      url: "/api/portal/public-links/token/download",
      status: "Active",
      created_at: "2026-08-01T10:00:00Z",
    });
  });

  it("loads Preview first and defers History and Sharing", async () => {
    render(<StorageSpaceObjectDetailsDrawer {...baseProps} />);

    const drawer = await screen.findByRole("complementary", { name: "report.csv" });
    expect(
      await within(drawer).findByText("id,value", { exact: false }),
    ).toBeInTheDocument();
    expect(mocks.fetchVersions).not.toHaveBeenCalled();
    expect(mocks.listLinks).not.toHaveBeenCalled();
  });

  it("loads History only when requested and explains disabled versioning", async () => {
    const view = render(<StorageSpaceObjectDetailsDrawer {...baseProps} activeView="preview" />);
    await screen.findByRole("complementary", { name: "report.csv" });

    view.rerender(<StorageSpaceObjectDetailsDrawer {...baseProps} activeView="history" />);

    await waitFor(() => expect(mocks.fetchVersions).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Version history is disabled/)).toBeInTheDocument();
    expect(mocks.listLinks).not.toHaveBeenCalled();
  });

  it("loads Sharing on demand while keeping link actions capability-gated", async () => {
    const view = render(<StorageSpaceObjectDetailsDrawer {...baseProps} activeView="preview" />);
    await screen.findByRole("complementary", { name: "report.csv" });
    view.rerender(<StorageSpaceObjectDetailsDrawer {...baseProps} activeView="sharing" />);

    await waitFor(() => expect(mocks.listLinks).toHaveBeenCalledWith(
      "101",
      "space-1",
      { objectKey: "reports/2026/report.csv", includeRevoked: true },
    ));
    expect(screen.getByRole("button", { name: "Create link" })).toBeEnabled();

    view.rerender(
      <StorageSpaceObjectDetailsDrawer
        {...baseProps}
        activeView="sharing"
        canCreatePublicLinks={false}
        space={{ ...space, role: "Viewer" }}
      />,
    );
    expect(screen.getByRole("button", { name: "Create link" })).toBeDisabled();
    expect(screen.getByText(/Only project managers/)).toBeInTheDocument();
  });

  it("owns the public-link creation flow shared by Portal and the full Browser", async () => {
    render(
      <StorageSpaceObjectDetailsDrawer
        {...baseProps}
        activeView="sharing"
        createPublicLinkRequestToken={1}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Create public link" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create link" }));

    await waitFor(() =>
      expect(mocks.createLink).toHaveBeenCalledWith("101", "space-1", {
        object_key: "reports/2026/report.csv",
        label: "report.csv",
        expires_at: null,
      }),
    );
    expect(await within(dialog).findByText("/api/portal/public-links/token/download")).toBeInTheDocument();
  });

  it("keeps the full path accessible and copies it without horizontal scrolling", async () => {
    render(<StorageSpaceObjectDetailsDrawer {...baseProps} />);
    const drawer = await screen.findByRole("complementary", { name: "report.csv" });
    expect(within(drawer).getByTitle("reports/2026/report.csv")).toBeInTheDocument();
    expect(within(drawer).getByRole("tabpanel", { name: "Preview" })).toHaveClass("overflow-x-hidden");
    fireEvent.click(within(drawer).getByRole("button", { name: "Copy path" }));
  });

  it("ignores stale detail responses after switching objects", async () => {
    const staleDetail = {
      key: "reports/2026/report.csv",
      name: "report.csv",
      size: 24,
      last_modified: "2026-08-01T10:00:00Z",
      content_type: "text/csv",
      storage_class: "STANDARD",
      encryption: "AES256",
      preview_type: "text",
      preview_text: "stale preview",
    };
    let resolveStaleDetail: (value: typeof staleDetail) => void = () => undefined;
    mocks.fetchDetail
      .mockReturnValueOnce(
        new Promise<typeof staleDetail>((resolve) => {
          resolveStaleDetail = resolve;
        }),
      )
      .mockResolvedValueOnce({
        ...staleDetail,
        key: "reports/2026/current.csv",
        name: "current.csv",
        preview_text: "current preview",
      });

    const view = render(<StorageSpaceObjectDetailsDrawer {...baseProps} />);
    view.rerender(
      <StorageSpaceObjectDetailsDrawer
        {...baseProps}
        objectKey="reports/2026/current.csv"
      />,
    );

    expect(
      await screen.findByRole("complementary", { name: "current.csv" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("current preview")).toBeInTheDocument();

    await act(async () => resolveStaleDetail(staleDetail));
    expect(screen.queryByText("stale preview")).not.toBeInTheDocument();
  });
});
