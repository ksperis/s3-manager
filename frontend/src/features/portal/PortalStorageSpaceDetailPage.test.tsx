import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ComponentProps } from "react";
import PortalStorageSpaceDetailPage from "./PortalStorageSpaceDetailPage";
import BrowserEmbed from "../browser/BrowserEmbed";

const mocks = vi.hoisted(() => ({
  updateStorageSpaceMock: vi.fn(),
  hookResult: {
    accountIdForApi: "101",
    selectedAccount: {
      id: "101",
      name: "Account 1",
      tags: [],
      quota_max_size_gb: 10,
      quota_max_objects: 1000,
      storage_endpoint_capabilities: { sse: true, sts: true },
    },
    workspace: {
      accountName: "Account 1",
      userEmail: "manager@example.com",
      usedBytes: 512,
      usedObjects: 12,
      quotaBytes: 1024,
      quotaObjects: null,
      spaces: [
        {
          id: "research-data",
          name: "Research Data",
          internalName: "research-data-internal",
          description: "Research Data shared storage",
          role: "Owner",
          status: "Active",
          access: "Shared",
          ownerUserId: 7,
          visibility: "shared",
          region: "eu-west-3",
          createdLabel: "12 mars 2024",
          usedBytes: 512,
          quotaBytes: 1024,
          objectCount: 12,
          createdAt: "2026-03-10T10:00:00Z",
          archivedAt: null,
          shareCount: 3,
          origin: "portal_generic",
          nameEditable: true,
        },
      ],
      activity: [
        {
          id: "activity-1",
          actor: "manager@example.com",
          action: "Uploaded files",
          target: "sample_001.fastq.gz",
          spaceId: "research-data",
          spaceName: "Research Data",
          timeLabel: "4 min ago",
          ipAddress: "192.168.1.10",
        },
      ],
      transfers: [],
      alerts: [],
    },
    loading: false,
    accountLoading: false,
    error: null,
    accountError: null,
    hasAccountContext: true,
  },
}));

vi.mock("./usePortalWorkspaceData", () => ({
  usePortalWorkspaceData: () => mocks.hookResult,
}));

vi.mock("../../api/portal", () => ({
  updatePortalStorageSpace: (...args: unknown[]) => mocks.updateStorageSpaceMock(...args),
}));

vi.mock("../browser/BrowserEmbed", () => ({
  default: vi.fn(() => <div data-testid="portal-browser-embed" />),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/portal/storage-spaces/research-data"]}>
      <Routes>
        <Route path="/portal/storage-spaces" element={<div>Storage Spaces</div>} />
        <Route path="/portal/storage-spaces/:spaceId" element={<PortalStorageSpaceDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("PortalStorageSpaceDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hookResult.workspace.spaces[0].role = "Owner";
    mocks.hookResult.workspace.spaces[0].nameEditable = true;
    mocks.hookResult.workspace.spaces[0].origin = "portal_generic";
    mocks.hookResult.workspace.spaces[0].status = "Active";
    mocks.hookResult.workspace.spaces[0].access = "Shared";
    mocks.hookResult.workspace.spaces[0].visibility = "shared";
    mocks.hookResult.workspace.spaces[0].archivedAt = null;
  });

  it("embeds the main Browser in locked portal-basic mode for the storage space", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Research Data" })).toBeInTheDocument();
    expect(screen.getByTestId("portal-browser-embed")).toBeInTheDocument();
    expect(screen.getByText("Storage used")).toBeInTheDocument();
    expect(screen.queryByText("Utilisation")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("portal-browser-embed").compareDocumentPosition(screen.getByRole("heading", { name: "Storage Space settings" })) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    const embedProps = vi.mocked(BrowserEmbed).mock.calls[0][0] as ComponentProps<typeof BrowserEmbed>;
    expect(embedProps).toMatchObject({
      accountIdForApi: "101",
      hasContext: true,
      workspaceSurface: "portal",
      actionProfile: "portal-basic",
      lockedBucketName: "research-data-internal",
      lockedBucketLabel: "Research Data",
      quotaMaxSizeGb: 10,
      quotaMaxObjects: 1000,
    });
    expect(embedProps.storageEndpointCapabilities).toEqual({ sse: true, sts: true });
    expect(embedProps.onOpenObjectDetailsRoute).toEqual(expect.any(Function));
    expect(embedProps.transferReporter).toMatchObject({
      start: expect.any(Function),
      complete: expect.any(Function),
      fail: expect.any(Function),
    });
    expect(embedProps.hiddenActionIds).toBeUndefined();
  });

  it("hides write Browser actions for read-only Viewer storage spaces", () => {
    mocks.hookResult.workspace.spaces[0].role = "Viewer";

    renderPage();

    const embedProps = vi.mocked(BrowserEmbed).mock.calls[0][0] as ComponentProps<typeof BrowserEmbed>;
    expect(embedProps.hiddenActionIds).toEqual([
      "uploadFiles",
      "uploadFolder",
      "newFolder",
      "delete",
    ]);
  });

  it("locks name editing and only saves description for non-renameable spaces", async () => {
    mocks.hookResult.workspace.spaces[0].nameEditable = false;
    mocks.hookResult.workspace.spaces[0].origin = "imported";

    renderPage();

    expect(screen.getByLabelText("Storage Space name")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Storage Space description"), {
      target: { value: "Updated description" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mocks.updateStorageSpaceMock).toHaveBeenCalledWith("101", "research-data", {
        description: "Updated description",
        visibility: "shared",
      });
    });
  });

  it("hides the embedded Browser when the storage space is archived", () => {
    mocks.hookResult.workspace.spaces[0].status = "Archived";
    mocks.hookResult.workspace.spaces[0].archivedAt = "2026-06-01T10:00:00Z";

    renderPage();

    expect(screen.getByText(/This Storage Space is archived/i)).toBeInTheDocument();
    expect(screen.queryByTestId("portal-browser-embed")).not.toBeInTheDocument();
  });

  it("confirms archive with explicit target and impacts", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    expect(screen.getByRole("heading", { name: "Archive Storage Space" })).toBeInTheDocument();
    expect(screen.getAllByText("Research Data").length).toBeGreaterThan(0);
    expect(screen.getByText("Existing objects are kept and are not deleted.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Archive Storage Space" }));

    await waitFor(() => {
      expect(mocks.updateStorageSpaceMock).toHaveBeenCalledWith("101", "research-data", { archived: true });
    });
  });
});
