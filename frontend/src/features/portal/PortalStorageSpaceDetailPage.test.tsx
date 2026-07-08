import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ComponentProps } from "react";
import PortalStorageSpaceDetailPage from "./PortalStorageSpaceDetailPage";
import BrowserEmbed from "../browser/BrowserEmbed";

const mocks = vi.hoisted(() => ({
  createPublicLinkMock: vi.fn(),
  streamHistoryCleanupMock: vi.fn(),
  fetchAccessSummaryMock: vi.fn(),
  grantShareMock: vi.fn(),
  listShareCandidatesMock: vi.fn(),
  revokeShareMock: vi.fn(),
  updateStorageSpaceMock: vi.fn(),
  updateShareMock: vi.fn(),
  usePortalWorkspaceDataMock: vi.fn(),
  generalSettings: {
    browser_enabled: true,
    browser_portal_enabled: true,
  },
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
    state: {
      account_id: 101,
      iam_user: {},
      access_keys: [],
      storage_space_version_cleanup_enabled: true,
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
          contentRole: "Owner",
          canBrowse: true,
          status: "Active",
          access: "Shared",
          ownerUserId: 7,
          visibility: "shared",
          shareScope: "restricted",
          accountMemberRole: null,
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
    refreshWorkspaceData: vi.fn(),
  },
}));

vi.mock("./usePortalWorkspaceData", () => ({
  usePortalWorkspaceData: (...args: unknown[]) => {
    mocks.usePortalWorkspaceDataMock(...args);
    return mocks.hookResult;
  },
}));

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    generalSettings: mocks.generalSettings,
  }),
}));

vi.mock("../../api/portal", () => ({
  createPortalStorageSpacePublicLink: (...args: unknown[]) => mocks.createPublicLinkMock(...args),
  fetchPortalStorageSpaceAccessSummary: (...args: unknown[]) => mocks.fetchAccessSummaryMock(...args),
  grantPortalStorageSpaceShare: (...args: unknown[]) => mocks.grantShareMock(...args),
  listPortalStorageSpaceShareCandidates: (...args: unknown[]) => mocks.listShareCandidatesMock(...args),
  portalStorageSpaceVersionCleanupConfirmationPhrase: (spaceName: string) => `CLEAN HISTORY ${spaceName}`,
  revokePortalStorageSpaceShare: (...args: unknown[]) => mocks.revokeShareMock(...args),
  updatePortalStorageSpace: (...args: unknown[]) => mocks.updateStorageSpaceMock(...args),
  streamPortalStorageSpaceVersionCleanup: (...args: unknown[]) => mocks.streamHistoryCleanupMock(...args),
  updatePortalStorageSpaceShare: (...args: unknown[]) => mocks.updateShareMock(...args),
}));

vi.mock("../browser/BrowserEmbed", () => ({
  default: vi.fn(() => <div data-testid="portal-browser-embed" />),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/portal/storage-spaces/research-data"]}>
      <Routes>
        <Route path="/portal/storage-spaces" element={<div>Spaces</div>} />
        <Route path="/portal/storage-spaces/:spaceId" element={<PortalStorageSpaceDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("PortalStorageSpaceDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usePortalWorkspaceDataMock.mockClear();
    mocks.fetchAccessSummaryMock.mockResolvedValue({
      mode: "restricted",
      default_account_member_role: null,
      owner: {
        user_id: 7,
        email: "manager@example.com",
        display_name: "Manager User",
        role: "Owner",
        account_role: "portal_manager",
        access_source: "owner",
      },
      effective_member_count: 4,
      explicit_shares: [
        {
          id: "research-data:12",
          storage_space_id: "research-data",
          storage_space_name: "Research Data",
          user_id: 12,
          email: "viewer@example.com",
          role: "Viewer",
          direction: "by_me",
          activity_label: "Active",
        },
      ],
      public_link_count: 2,
      can_manage_access: true,
      can_create_public_links: true,
    });
    mocks.listShareCandidatesMock.mockResolvedValue([
      {
        user_id: 12,
        email: "viewer@example.com",
        display_name: null,
        account_role: "portal_user",
        access_source: "direct",
        already_shared: true,
      },
      {
        user_id: 13,
        email: "editor@example.com",
        display_name: "Editor User",
        account_role: "portal_user",
        access_source: "group",
        already_shared: false,
      },
    ]);
    mocks.grantShareMock.mockResolvedValue({ id: "research-data:13" });
    mocks.revokeShareMock.mockResolvedValue([]);
    mocks.updateShareMock.mockResolvedValue({ id: "research-data:12", role: "Editor" });
    mocks.createPublicLinkMock.mockResolvedValue({
      id: 42,
      storage_space_id: "research-data",
      storage_space_name: "Research Data",
      object_key: "raw-data/report.csv",
      object_name: "report.csv",
      url: "/api/portal/public-links/token/download",
      status: "Active",
      created_at: "2026-06-01T10:00:00Z",
      expires_at: null,
    });
    mocks.streamHistoryCleanupMock.mockImplementation((_accountId, _spaceId, _payload, options) => {
      options?.onProgress?.({
        stage: "delete",
        storage_space_id: "research-data",
        storage_space_name: "Research Data",
        scanned_versions: 3,
        scanned_delete_markers: 1,
        delete_candidates: 3,
        deleted_versions: 1,
        deleted_delete_markers: 0,
        bytes_freed: 1024,
        total_candidates_final: true,
        message: "Deleting historical versions...",
      });
      return Promise.resolve({
        status: "completed",
        storage_space_id: "research-data",
        storage_space_name: "Research Data",
        scanned_versions: 3,
        scanned_delete_markers: 1,
        deleted_versions: 2,
        deleted_delete_markers: 1,
        bytes_freed: 1536,
        started_at: "2026-07-08T10:00:00Z",
        finished_at: "2026-07-08T10:00:01Z",
      });
    });
    mocks.generalSettings.browser_enabled = true;
    mocks.generalSettings.browser_portal_enabled = true;
    mocks.hookResult.workspace.spaces[0].role = "Owner";
    mocks.hookResult.workspace.spaces[0].contentRole = "Owner";
    mocks.hookResult.workspace.spaces[0].canBrowse = true;
    mocks.hookResult.workspace.spaces[0].nameEditable = true;
    mocks.hookResult.workspace.spaces[0].origin = "portal_generic";
    mocks.hookResult.workspace.spaces[0].status = "Active";
    mocks.hookResult.workspace.spaces[0].access = "Shared";
    mocks.hookResult.workspace.spaces[0].visibility = "shared";
    mocks.hookResult.workspace.spaces[0].shareScope = "restricted";
    mocks.hookResult.workspace.spaces[0].accountMemberRole = null;
    mocks.hookResult.workspace.spaces[0].archivedAt = null;
    mocks.hookResult.refreshWorkspaceData.mockClear();
    mocks.hookResult.state.storage_space_version_cleanup_enabled = true;
  });

  it("embeds the main Browser in locked portal-basic mode for the space", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Research Data" })).toBeInTheDocument();
    expect(mocks.usePortalWorkspaceDataMock).toHaveBeenCalledWith({ includeArchived: true });
    expect(screen.getByTestId("portal-browser-embed")).toBeInTheDocument();
    expect(screen.getByText("Storage used")).toBeInTheDocument();
    expect(screen.queryByText("Utilisation")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Files" }).compareDocumentPosition(screen.getByRole("heading", { name: "Collaborators" })) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Collaborators" }).compareDocumentPosition(screen.getByRole("heading", { name: "Space settings" })) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Space settings" }).compareDocumentPosition(screen.getByRole("heading", { name: "Connect external tools" })) &
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

  it("hides write Browser actions for read-only Viewer spaces", () => {
    mocks.hookResult.workspace.spaces[0].role = "Viewer";
    mocks.hookResult.workspace.spaces[0].contentRole = "Viewer";

    renderPage();

    const embedProps = vi.mocked(BrowserEmbed).mock.calls[0][0] as ComponentProps<typeof BrowserEmbed>;
    expect(embedProps.hiddenActionIds).toEqual([
      "uploadFiles",
      "uploadFolder",
      "newFolder",
      "delete",
    ]);
    expect(embedProps.onCreatePublicLinkForObject).toBeUndefined();
  });

  it("creates a public link from a Browser-selected file", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    renderPage();

    await waitFor(() => {
      const latestProps = vi.mocked(BrowserEmbed).mock.calls.at(-1)?.[0] as ComponentProps<typeof BrowserEmbed> | undefined;
      expect(latestProps?.onCreatePublicLinkForObject).toEqual(expect.any(Function));
    });

    const latestProps = vi.mocked(BrowserEmbed).mock.calls.at(-1)?.[0] as ComponentProps<typeof BrowserEmbed>;
    act(() => {
      latestProps.onCreatePublicLinkForObject?.({
        bucketName: "research-data-internal",
        key: "raw-data/report.csv",
        name: "report.csv",
      });
    });

    expect(screen.getByRole("dialog", { name: "Create public link" })).toBeInTheDocument();
    expect(screen.getByText("raw-data/report.csv")).toBeInTheDocument();
    expect(screen.getByLabelText("Public link expiration")).toHaveClass("ui-control");
    fireEvent.change(screen.getByLabelText("Public link expiration"), {
      target: { value: "2026-06-10T10:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create link" }));

    await waitFor(() => {
      expect(mocks.createPublicLinkMock).toHaveBeenCalledWith("101", "research-data", {
        object_key: "raw-data/report.csv",
        label: "report.csv",
        expires_at: expect.any(String),
      });
    });
    expect(await screen.findByText("/api/portal/public-links/token/download")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith("/api/portal/public-links/token/download");
    expect(await screen.findByText("Link copied.")).toBeInTheDocument();
  });

  it("shows a disabled state when the Portal Browser kill switch is off", () => {
    mocks.generalSettings.browser_portal_enabled = false;

    renderPage();

    expect(screen.getByText(/Files are unavailable/i)).toBeInTheDocument();
    expect(screen.queryByTestId("portal-browser-embed")).not.toBeInTheDocument();
  });

  it("locks name editing and only saves description for non-renameable spaces", async () => {
    mocks.hookResult.workspace.spaces[0].nameEditable = false;
    mocks.hookResult.workspace.spaces[0].origin = "imported";

    renderPage();

    expect(screen.getByLabelText("Space name")).toHaveClass("ui-control");
    expect(screen.getByLabelText("Space name")).toBeDisabled();
    expect(screen.getByLabelText("Space description")).toHaveClass("ui-control");
    fireEvent.change(screen.getByLabelText("Space description"), {
      target: { value: "Updated description" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mocks.updateStorageSpaceMock).toHaveBeenCalledWith("101", "research-data", {
        description: "Updated description",
      });
    });
    expect(mocks.hookResult.refreshWorkspaceData).toHaveBeenCalledTimes(1);
  });

  it("runs history cleanup with confirmation, progress, and gained-space summary", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Clean up history" }));

    expect(screen.getByRole("dialog", { name: "Clean up history" })).toBeInTheDocument();
    expect(screen.getByText(/deletes historical object versions/i)).toBeInTheDocument();
    const startButton = screen.getByRole("button", { name: "Start cleanup" });
    expect(startButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Type CLEAN HISTORY Research Data"), {
      target: { value: "CLEAN HISTORY Research Data" },
    });
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(mocks.streamHistoryCleanupMock).toHaveBeenCalledWith(
        "101",
        "research-data",
        { confirmation: "CLEAN HISTORY Research Data" },
        expect.objectContaining({ signal: expect.any(AbortSignal), onProgress: expect.any(Function) })
      );
    });
    expect(await screen.findByRole("progressbar", { name: "Storage Space history cleanup progress" })).toBeInTheDocument();
    expect(await screen.findByText("1.5 KB")).toBeInTheDocument();
    expect(screen.getByText("Versions deleted")).toBeInTheDocument();
    expect(screen.getByText("Markers removed")).toBeInTheDocument();
    expect(mocks.hookResult.refreshWorkspaceData).toHaveBeenCalledTimes(1);
  });

  it("shows history cleanup disabled when the account override turns it off", async () => {
    mocks.hookResult.state.storage_space_version_cleanup_enabled = false;

    renderPage();

    expect(await screen.findByText("History cleanup is disabled for this project.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clean up history" })).toBeDisabled();
  });

  it("shows the collaborator panel with public link context", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Collaborators" })).toBeInTheDocument();
    expect(screen.getAllByText("Selected people").length).toBeGreaterThan(0);
    expect(screen.getByText("Manager User")).toBeInTheDocument();
    expect(screen.getAllByText("viewer@example.com").length).toBeGreaterThan(0);
    expect(screen.getByRole("combobox", { name: "Access for viewer@example.com" })).toHaveClass("ui-control");
    expect(screen.getByText("2 public links")).toHaveAttribute(
      "href",
      "/portal/shares?space_id=research-data&tab=links"
    );
    expect(screen.getByRole("link", { name: "Manage collaborators" })).toHaveAttribute(
      "href",
      "/portal/shares?space_id=research-data&tab=by"
    );
  });

  it("shows external-tool mapping without replacing the space name", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Connect external tools" })).toBeInTheDocument();
    expect(screen.getByText("research-data-internal")).toBeInTheDocument();
    expect(screen.getByText(/Use this only when an external S3 tool asks for a bucket/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connection details" })).toHaveAttribute(
      "href",
      "/portal/access-keys?space_id=research-data-internal&create=external"
    );
    expect(screen.getAllByText("Research Data").length).toBeGreaterThan(1);
  });

  it("confirms access mode changes from the Access panel", async () => {
    renderPage();

    const accessSelect = await screen.findByLabelText("Who can access this space?");
    fireEvent.change(accessSelect, { target: { value: "account" } });
    fireEvent.click(screen.getByRole("button", { name: "Save access" }));

    expect(screen.getByRole("heading", { name: "Change collaborators" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Update access" }));

    await waitFor(() => {
      expect(mocks.updateStorageSpaceMock).toHaveBeenCalledWith("101", "research-data", {
        visibility: "shared",
        share_scope: "account",
        account_member_role: "Editor",
      });
    });
    expect(mocks.hookResult.refreshWorkspaceData).toHaveBeenCalledTimes(1);
  });

  it("refreshes workspace data after restoring an archived space", async () => {
    mocks.hookResult.workspace.spaces[0].status = "Archived";
    mocks.hookResult.workspace.spaces[0].archivedAt = "2026-06-01T10:00:00Z";

    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => {
      expect(mocks.updateStorageSpaceMock).toHaveBeenCalledWith("101", "research-data", { archived: false });
    });
    expect(mocks.hookResult.refreshWorkspaceData).toHaveBeenCalledTimes(1);
  });

  it("hides the embedded Browser when the space is archived", () => {
    mocks.hookResult.workspace.spaces[0].status = "Archived";
    mocks.hookResult.workspace.spaces[0].archivedAt = "2026-06-01T10:00:00Z";

    renderPage();

    expect(screen.getByText(/This space is archived/i)).toBeInTheDocument();
    expect(screen.queryByTestId("portal-browser-embed")).not.toBeInTheDocument();
  });

  it("keeps metadata management but hides files when content browsing is denied", () => {
    mocks.hookResult.workspace.spaces[0].visibility = "private";
    mocks.hookResult.workspace.spaces[0].access = "Private";
    mocks.hookResult.workspace.spaces[0].contentRole = null;
    mocks.hookResult.workspace.spaces[0].canBrowse = false;

    renderPage();

    expect(screen.getByText(/Files are not available for this private space/i)).toBeInTheDocument();
    expect(screen.queryByTestId("portal-browser-embed")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Space settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("confirms archive with explicit target and impacts", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    expect(screen.getByRole("heading", { name: "Archive space" })).toBeInTheDocument();
    expect(screen.getAllByText("Research Data").length).toBeGreaterThan(0);
    expect(screen.getByText("Existing files are kept and are not deleted.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Archive space" }));

    await waitFor(() => {
      expect(mocks.updateStorageSpaceMock).toHaveBeenCalledWith("101", "research-data", { archived: true });
    });
  });
});
