import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { ComponentProps } from "react";
import PortalStorageSpaceDetailPage from "./PortalStorageSpaceDetailPage";
import BrowserEmbed from "../browser/BrowserEmbed";

const mocks = vi.hoisted(() => ({
  createPublicLinkMock: vi.fn(),
  createPortalRequestMock: vi.fn(),
  deleteStorageSpaceMock: vi.fn(),
  fetchAccessSummaryMock: vi.fn(),
  fetchUsageStatsMock: vi.fn(),
  fetchTrafficMock: vi.fn(),
  fetchStorageSpaceSettingsMock: vi.fn(),
  grantShareMock: vi.fn(),
  listPublicLinksMock: vi.fn(),
  listShareCandidatesMock: vi.fn(),
  revokePublicLinkMock: vi.fn(),
  revokeShareMock: vi.fn(),
  streamHistoryCleanupMock: vi.fn(),
  streamDeletedPrefixRestoreMock: vi.fn(),
  restoreObjectMock: vi.fn(),
  updateStorageSpaceMock: vi.fn(),
  updateStorageSpaceSettingsMock: vi.fn(),
  updateStorageSpaceIconMock: vi.fn(),
  uploadStorageSpaceIconMock: vi.fn(),
  updateShareMock: vi.fn(),
  usePortalWorkspaceDataMock: vi.fn(),
  generalSettings: {
    browser_enabled: true,
    browser_portal_enabled: true,
    bucket_usage_stats_enabled: true,
  },
  hookResult: {
    accountIdForApi: "101",
    state: {
      portal_role: "portal_manager",
      storage_space_version_cleanup_enabled: true,
    },
    selectedAccount: {
      id: "101",
      name: "Account 1",
      rgw_account_id: "portal-project",
      tags: [],
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
          role: "Manager",
          contentRole: "Owner",
          canBrowse: true,
          canDelete: true,
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
          icon: { source: "preset", preset: "archive" },
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

const accessSummaryFixture = {
  mode: "restricted" as const,
  default_account_member_role: null,
  owner: {
    user_id: 7,
    email: "manager@example.com",
    display_name: "Manager User",
    role: "Owner" as const,
    portal_role: "portal_manager" as const,
    access_source: "owner" as const,
  },
  effective_member_count: 4,
  explicit_shares: [
    {
      id: "research-data:12",
      storage_space_id: "research-data",
      storage_space_name: "Research Data",
      user_id: 12,
      email: "viewer@example.com",
      role: "Viewer" as const,
      direction: "by_me" as const,
      activity_label: "Active",
    },
  ],
  public_link_count: 2,
  can_manage_access: true,
  can_create_public_links: true,
};

const publicLinksFixture = [
  {
    id: 42,
    storage_space_id: "research-data",
    storage_space_name: "Research Data",
    object_key: "reports/active.csv",
    object_name: "active.csv",
    url: "https://portal.example.test/api/portal/public-links/active/download",
    status: "Active",
    created_at: "2026-06-01T10:00:00Z",
    expires_at: "2026-09-01T10:00:00Z",
  },
  {
    id: 43,
    storage_space_id: "research-data",
    storage_space_name: "Research Data",
    object_key: "reports/revoked.csv",
    object_name: "revoked.csv",
    url: "https://portal.example.test/api/portal/public-links/revoked/download",
    status: "Revoked",
    created_at: "2026-05-01T10:00:00Z",
    expires_at: null,
    revoked_at: "2026-06-15T10:00:00Z",
  },
];

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
  deletePortalStorageSpace: (...args: unknown[]) => mocks.deleteStorageSpaceMock(...args),
  fetchPortalStorageSpaceAccessSummary: (...args: unknown[]) => mocks.fetchAccessSummaryMock(...args),
  fetchPortalStorageSpaceSettings: (...args: unknown[]) => mocks.fetchStorageSpaceSettingsMock(...args),
  grantPortalStorageSpaceShare: (...args: unknown[]) => mocks.grantShareMock(...args),
  listPortalStorageSpacePublicLinks: (...args: unknown[]) => mocks.listPublicLinksMock(...args),
  listPortalStorageSpaceShareCandidates: (...args: unknown[]) => mocks.listShareCandidatesMock(...args),
  portalStorageSpaceVersionCleanupConfirmationPhrase: (spaceName: string) => `CLEAN HISTORY ${spaceName.toUpperCase()}`,
  revokePortalStorageSpaceShare: (...args: unknown[]) => mocks.revokeShareMock(...args),
  revokePortalStorageSpacePublicLink: (...args: unknown[]) => mocks.revokePublicLinkMock(...args),
  restorePortalStorageSpaceObject: (...args: unknown[]) => mocks.restoreObjectMock(...args),
  streamPortalDeletedPrefixRestore: (...args: unknown[]) =>
    mocks.streamDeletedPrefixRestoreMock(...args),
  streamPortalStorageSpaceVersionCleanup: (...args: unknown[]) => mocks.streamHistoryCleanupMock(...args),
  updatePortalStorageSpace: (...args: unknown[]) => mocks.updateStorageSpaceMock(...args),
  updatePortalStorageSpaceSettings: (...args: unknown[]) => mocks.updateStorageSpaceSettingsMock(...args),
  updatePortalStorageSpaceIcon: (...args: unknown[]) => mocks.updateStorageSpaceIconMock(...args),
  uploadPortalStorageSpaceIcon: (...args: unknown[]) => mocks.uploadStorageSpaceIconMock(...args),
  updatePortalStorageSpaceShare: (...args: unknown[]) => mocks.updateShareMock(...args),
}));

vi.mock("../../api/portalUsage", () => ({
  fetchPortalStorageSpaceUsageStats: (...args: unknown[]) => mocks.fetchUsageStatsMock(...args),
  fetchPortalTraffic: (...args: unknown[]) => mocks.fetchTrafficMock(...args),
}));

vi.mock("../../api/portalRequests", () => ({
  createPortalRequest: (...args: unknown[]) =>
    mocks.createPortalRequestMock(...args),
}));

vi.mock("../browser/BrowserEmbed", () => ({
  default: vi.fn(
    (props: {
      deletedObjectsOptions?: {
        onVisibilityChange?: (visible: boolean) => void;
        onRestoreObject?: (target: {
          bucketName: string;
          key: string;
          name: string;
          deletedAt?: string | null;
        }) => void;
        onRestorePrefix?: (target: {
          bucketName: string;
          key: string;
          name: string;
        }) => void;
      };
    }) => (
      <div data-testid="portal-browser-embed">
        <button
          type="button"
          onClick={() =>
            props.deletedObjectsOptions?.onVisibilityChange?.(true)
          }
        >
          Mock show deleted
        </button>
        <button
          type="button"
          onClick={() =>
            props.deletedObjectsOptions?.onRestoreObject?.({
              bucketName: "research-data-internal",
              key: "reports/deleted.csv",
              name: "deleted.csv",
              deletedAt: "2026-07-29T12:00:00Z",
            })
          }
        >
          Mock restore deleted
        </button>
        <button
          type="button"
          onClick={() =>
            props.deletedObjectsOptions?.onRestorePrefix?.({
              bucketName: "research-data-internal",
              key: "reports/",
              name: "reports",
            })
          }
        >
          Mock restore folder
        </button>
      </div>
    ),
  ),
}));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-probe">{`${location.pathname}${location.search}`}</output>;
}

async function renderPage(initialEntries: ComponentProps<typeof MemoryRouter>["initialEntries"] = ["/portal/storage-spaces/research-data"]) {
  const rendered = render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/portal/storage-spaces" element={<div>Spaces</div>} />
        <Route path="/portal/storage-spaces/:spaceId" element={<PortalStorageSpaceDetailPage />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>
  );
  await act(async () => {
    await Promise.resolve();
  });
  if (mocks.fetchAccessSummaryMock.mock.calls.length > 0) {
    await waitFor(() => {
      if (screen.queryByTestId("portal-browser-embed")) {
        const browserProps = vi.mocked(BrowserEmbed).mock.calls.at(-1)?.[0] as
          | ComponentProps<typeof BrowserEmbed>
          | undefined;
        expect(browserProps?.capabilityFacts?.canCreatePublicLinks).toBe(true);
      } else {
        expect(screen.getByText("Manager User")).toBeInTheDocument();
      }
    });
  }
  return rendered;
}

async function openSettingsTab() {
  fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
  await screen.findByRole("checkbox", { name: "Versioning" });
}

describe("PortalStorageSpaceDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteStorageSpaceMock.mockReset();
    window.localStorage.clear();
    mocks.usePortalWorkspaceDataMock.mockClear();
    mocks.fetchAccessSummaryMock.mockResolvedValue(accessSummaryFixture);
    mocks.fetchStorageSpaceSettingsMock.mockResolvedValue({
      versioning_enabled: true,
      versioning_status: "Enabled",
      lifecycle_enabled: true,
      version_history_retention_days: 90,
      can_update: true,
    });
    mocks.fetchUsageStatsMock.mockResolvedValue({
      snapshot: {
        scan_mode: "versions",
        version_listing_available: true,
        object_version_count: 12,
        current_version_count: 10,
        noncurrent_version_count: 2,
        delete_marker_count: 1,
        total_bytes: 512,
        current_bytes: 400,
        noncurrent_bytes: 112,
        data_type_distribution: [
          { key: "documents", label: "Documents", count: 12, bytes: 512, ratio_count: 1, ratio_bytes: 1 },
        ],
        storage_class_distribution: [],
        size_distribution: [],
        age_distribution: [],
        current_vs_noncurrent: [],
        calculated_at: "2026-07-30T10:00:00Z",
      },
    });
    mocks.fetchTrafficMock.mockResolvedValue({
      window: "week",
      start: "2026-07-24T00:00:00Z",
      end: "2026-07-30T00:00:00Z",
      resolution: "daily",
      data_points: 1,
      series: [
        { timestamp: "2026-07-30T00:00:00Z", bytes_in: 128, bytes_out: 64, ops: 2, success_ops: 2 },
      ],
      totals: { bytes_in: 128, bytes_out: 64, ops: 2, success_ops: 2, success_rate: 1 },
      bucket_rankings: [{ bucket: "research-data-internal", bytes_in: 128, bytes_out: 64, bytes_total: 192, ops: 2, success_ratio: 1 }],
      user_rankings: [{ user: "portal-project", bytes_in: 128, bytes_out: 64, bytes_total: 192, ops: 2, success_ratio: 1 }],
      request_breakdown: [],
      category_breakdown: [],
    });
    mocks.updateStorageSpaceSettingsMock.mockResolvedValue({
      versioning_enabled: false,
      versioning_status: "Suspended",
      lifecycle_enabled: true,
      version_history_retention_days: 45,
      can_update: true,
    });
    mocks.updateStorageSpaceIconMock.mockResolvedValue({ source: "preset", preset: "database" });
    mocks.uploadStorageSpaceIconMock.mockResolvedValue({ source: "uploaded", url: "/portal/icon?v=1" });
    mocks.restoreObjectMock.mockResolvedValue({
      key: "reports/deleted.csv",
      restored_from_version_id: "v1",
      message: "Restored",
    });
    mocks.listShareCandidatesMock.mockResolvedValue([
      {
        user_id: 12,
        email: "viewer@example.com",
        display_name: null,
        portal_role: "portal_user",
        access_source: "direct",
        already_shared: true,
      },
      {
        user_id: 13,
        email: "editor@example.com",
        display_name: "Editor User",
        portal_role: "portal_user",
        access_source: "group",
        already_shared: false,
      },
    ]);
    mocks.grantShareMock.mockResolvedValue({ id: "research-data:13" });
    mocks.listPublicLinksMock.mockResolvedValue(publicLinksFixture);
    mocks.revokePublicLinkMock.mockResolvedValue([
      { ...publicLinksFixture[0], status: "Revoked", revoked_at: "2026-08-27T10:00:00Z" },
      publicLinksFixture[1],
    ]);
    mocks.revokeShareMock.mockResolvedValue([]);
    mocks.updateShareMock.mockResolvedValue({ id: "research-data:12", role: "Editor" });
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
    mocks.createPortalRequestMock.mockResolvedValue({ id: 42, status: "pending" });
    mocks.generalSettings.browser_enabled = true;
    mocks.generalSettings.browser_portal_enabled = true;
    mocks.generalSettings.bucket_usage_stats_enabled = true;
    mocks.hookResult.workspace.spaces[0].name = "Research Data";
    mocks.hookResult.workspace.spaces[0].role = "Manager";
    mocks.hookResult.workspace.spaces[0].canBrowse = true;
    mocks.hookResult.workspace.spaces[0].canDelete = true;
    mocks.hookResult.workspace.spaces[0].visibility = "shared";
    mocks.hookResult.workspace.spaces[0].canTakeOwnership = false;
    mocks.hookResult.workspace.spaces[0].nameEditable = true;
    mocks.hookResult.workspace.spaces[0].icon = { source: "preset", preset: "archive" };
    mocks.hookResult.workspace.spaces[0].contentRole = "Owner";
    mocks.hookResult.workspace.spaces[0].origin = "portal_generic";
    mocks.hookResult.workspace.spaces[0].status = "Active";
    mocks.hookResult.workspace.spaces[0].access = "Shared";
    mocks.hookResult.workspace.spaces[0].visibility = "shared";
    mocks.hookResult.workspace.spaces[0].shareScope = "restricted";
    mocks.hookResult.workspace.spaces[0].accountMemberRole = null;
    mocks.hookResult.workspace.spaces[0].archivedAt = null;
    mocks.hookResult.workspace.spaces[0].objectCount = 12;
    mocks.hookResult.workspace.spaces[0].usedBytes = 512;
    mocks.hookResult.workspace.spaces[0].quotaBytes = 10 * 1024 ** 3;
    mocks.hookResult.workspace.spaces[0].quotaObjects = 1000;
    mocks.hookResult.workspace.spaces[0].shareCount = 3;
    mocks.hookResult.state.portal_role = "portal_manager";
    mocks.hookResult.state.storage_space_version_cleanup_enabled = true;
    mocks.hookResult.refreshWorkspaceData.mockClear();
  });

  it("embeds the main Browser with an explicit locked Portal profile", async () => {
    await renderPage();

    expect(screen.getByRole("heading", { name: "Research Data" })).toBeInTheDocument();
    expect(mocks.usePortalWorkspaceDataMock).toHaveBeenCalledWith({
      includeArchived: true,
      includeUsage: false,
    });
    expect(screen.getByTestId("portal-browser-embed")).toBeInTheDocument();
    expect(screen.queryByText("Storage used")).not.toBeInTheDocument();
    expect(screen.queryByText("Utilisation")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Files" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Trash" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Collaborators" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "External links" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Statistics" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Files" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Collaborators" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Collaborators" }));
    expect(screen.getByRole("tabpanel", { name: "Collaborators" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Collaborators" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("portal-browser-embed")).not.toBeInTheDocument();

    await openSettingsTab();
    expect(screen.getByRole("heading", { name: "Space settings" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Version history settings" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Connect external tools" })).toBeInTheDocument();

    const embedProps = vi.mocked(BrowserEmbed).mock.calls[0][0] as ComponentProps<typeof BrowserEmbed>;
    expect(embedProps).toMatchObject({
      accountIdForApi: "101",
      hasContext: true,
      workspaceSurface: "portal",
      functionalProfile: "portal",
      layoutMode: "standard",
      density: "comfortable",
      capabilityFacts: {
        canWriteObjects: true,
        canDeleteObjects: true,
        canRestoreObjects: true,
        canCreatePublicLinks: false,
      },
      lockedBucketName: "research-data-internal",
      lockedBucketLabel: "Research Data",
      quotaMaxSizeGb: 10,
      quotaMaxObjects: 1000,
    });
    expect(embedProps.storageEndpointCapabilities).toEqual({ sse: true, sts: true });
    expect(embedProps.onOpenObjectDetailsRoute).toEqual(expect.any(Function));
    expect(embedProps.transferReporter).toBeUndefined();
  });

  it("loads scoped external links lazily and supports copying and confirmed revocation", async () => {
    let resolveLinks: ((links: typeof publicLinksFixture) => void) | undefined;
    mocks.listPublicLinksMock.mockReturnValue(
      new Promise((resolve) => {
        resolveLinks = resolve;
      }),
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    await renderPage();

    expect(mocks.listPublicLinksMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "External links" }));

    expect(screen.getByTestId("location-probe")).toHaveTextContent(
      "?tab=external-links",
    );
    expect(screen.getByText("Loading links...")).toBeInTheDocument();
    expect(mocks.listPublicLinksMock).toHaveBeenCalledWith(
      "101",
      "research-data",
      { includeRevoked: true },
    );

    await act(async () => {
      resolveLinks?.(publicLinksFixture);
    });

    const activeRow = (await screen.findByText("active.csv")).closest("tr");
    const revokedRow = screen.getByText("revoked.csv").closest("tr");
    if (!activeRow || !revokedRow) throw new Error("External link row not found");
    expect(within(activeRow).getByText("Active")).toBeInTheDocument();
    expect(within(revokedRow).getByText("Revoked")).toBeInTheDocument();
    expect(
      within(revokedRow).queryByRole("button", { name: "Revoke" }),
    ).not.toBeInTheDocument();

    fireEvent.click(within(revokedRow).getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(publicLinksFixture[1].url);
    expect(await screen.findByText("Link copied.")).toBeInTheDocument();

    fireEvent.click(within(activeRow).getByRole("button", { name: "Revoke" }));
    const dialog = screen.getByRole("dialog", { name: "Revoke public link" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke link" }));

    await waitFor(() => {
      expect(mocks.revokePublicLinkMock).toHaveBeenCalledWith(
        "101",
        "research-data",
        42,
      );
    });
    expect(await screen.findByText("Public link revoked.")).toBeInTheDocument();
    expect(screen.getAllByText("Revoked")).toHaveLength(2);
  });

  it("opens the external links tab directly from the URL", async () => {
    await renderPage([
      "/portal/storage-spaces/research-data?tab=external-links",
    ]);

    expect(
      await screen.findByRole("tabpanel", { name: "External links" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("active.csv")).toBeInTheDocument();
    expect(mocks.listPublicLinksMock).toHaveBeenCalledWith(
      "101",
      "research-data",
      { includeRevoked: true },
    );
  });

  it("lists suspended links for the owner of a private active space", async () => {
    mocks.hookResult.workspace.spaces[0].role = "Owner";
    mocks.hookResult.workspace.spaces[0].visibility = "private";

    await renderPage([
      "/portal/storage-spaces/research-data?tab=external-links",
    ]);

    expect(await screen.findByText("active.csv")).toBeInTheDocument();
    expect(mocks.listPublicLinksMock).toHaveBeenCalledWith(
      "101",
      "research-data",
      { includeRevoked: true },
    );
  });

  it("shows an empty external links state", async () => {
    mocks.listPublicLinksMock.mockResolvedValue([]);

    await renderPage([
      "/portal/storage-spaces/research-data?tab=external-links",
    ]);

    expect(
      await screen.findByText("No external links for this space."),
    ).toBeInTheDocument();
  });

  it("shows an external links loading error", async () => {
    mocks.listPublicLinksMock.mockRejectedValue(new Error("Network Error"));

    await renderPage([
      "/portal/storage-spaces/research-data?tab=external-links",
    ]);

    expect(
      await screen.findByText("Unable to load external links."),
    ).toBeInTheDocument();
  });

  it.each([
    ["Viewer", "Active", "Only owners and managers"],
    ["Editor", "Active", "Only owners and managers"],
    ["Manager", "Archived", "Restore this archived space"],
  ])(
    "does not load external links for a %s space with %s status",
    async (role, status, expectedMessage) => {
      mocks.hookResult.workspace.spaces[0].role = role;
      mocks.hookResult.workspace.spaces[0].status = status;

      await renderPage([
        "/portal/storage-spaces/research-data?tab=external-links",
      ]);

      expect(await screen.findByText(new RegExp(expectedMessage))).toBeInTheDocument();
      expect(mocks.listPublicLinksMock).not.toHaveBeenCalled();
    },
  );

  it("loads Storage Space statistics lazily and keeps the tab in the URL", async () => {
    await renderPage();

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Files",
      "Collaborators",
      "External links",
      "Statistics",
      "Settings",
    ]);
    expect(mocks.fetchUsageStatsMock).not.toHaveBeenCalled();
    expect(mocks.fetchTrafficMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: "Statistics" }));

    expect(await screen.findByRole("tabpanel", { name: "Statistics" })).toBeInTheDocument();
    expect(mocks.usePortalWorkspaceDataMock).toHaveBeenLastCalledWith({
      includeArchived: true,
      includeUsage: true,
    });
    expect(screen.getByTestId("location-probe")).toHaveTextContent("?tab=statistics");
    await waitFor(() => {
      expect(mocks.fetchUsageStatsMock).toHaveBeenCalledWith("101", "research-data");
      expect(mocks.fetchTrafficMock).toHaveBeenCalledWith("101", "week", "research-data-internal");
    });
    expect(screen.getByText("Storage used")).toBeInTheDocument();
    expect(screen.getByText("File composition")).toBeInTheDocument();
    expect(screen.getByText("Uploaded")).toBeInTheDocument();
    expect(screen.getByText("Activity source")).toBeInTheDocument();
    expect(screen.queryByText("Most active Storage Spaces")).not.toBeInTheDocument();
  });

  it("reloads only scoped traffic when the statistics period changes", async () => {
    await renderPage(["/portal/storage-spaces/research-data?tab=statistics"]);
    await waitFor(() => expect(mocks.fetchTrafficMock).toHaveBeenCalledWith("101", "week", "research-data-internal"));

    fireEvent.click(screen.getByRole("button", { name: "30d" }));

    await waitFor(() => expect(mocks.fetchTrafficMock).toHaveBeenLastCalledWith("101", "month", "research-data-internal"));
    expect(mocks.fetchUsageStatsMock).toHaveBeenCalledTimes(1);
  });

  it("keeps zero values and marks unknown summary values as unavailable", async () => {
    mocks.hookResult.workspace.spaces[0].usedBytes = 0;
    mocks.hookResult.workspace.spaces[0].objectCount = 0;
    mocks.hookResult.workspace.spaces[0].quotaBytes = 1024;

    await renderPage(["/portal/storage-spaces/research-data?tab=statistics"]);

    const summary = screen.getByRole("heading", { name: "Space summary" }).closest("section") as HTMLElement;
    expect(within(summary).getByText("0 B")).toBeInTheDocument();
    expect(within(summary).getByText("1.0 KB")).toBeInTheDocument();
    expect(within(summary).getByText("0")).toBeInTheDocument();
    expect(within(summary).getByText("–")).toBeInTheDocument();

    mocks.hookResult.workspace.spaces[0].usedBytes = null;
    mocks.hookResult.workspace.spaces[0].objectCount = null;
    mocks.hookResult.workspace.spaces[0].quotaBytes = null;
  });

  it("keeps detailed statistics unavailable for archived spaces without issuing requests", async () => {
    mocks.hookResult.workspace.spaces[0].status = "Archived";
    mocks.hookResult.workspace.spaces[0].archivedAt = "2026-06-01T10:00:00Z";

    await renderPage(["/portal/storage-spaces/research-data?tab=statistics"]);

    expect(screen.getByText(/Detailed statistics are unavailable while this Storage Space is archived/i)).toBeInTheDocument();
    expect(screen.getByText("Storage used")).toBeInTheDocument();
    expect(mocks.fetchUsageStatsMock).not.toHaveBeenCalled();
    expect(mocks.fetchTrafficMock).not.toHaveBeenCalled();
  });

  it("shows independent composition and traffic errors", async () => {
    mocks.fetchUsageStatsMock.mockRejectedValueOnce(new Error("composition unavailable"));
    mocks.fetchTrafficMock.mockRejectedValueOnce(new Error("traffic unavailable"));

    await renderPage(["/portal/storage-spaces/research-data?tab=statistics"]);

    expect(await screen.findByText("composition unavailable")).toBeInTheDocument();
    expect(await screen.findByText("traffic unavailable")).toBeInTheDocument();
  });

  it("shows an empty composition state without hiding scoped traffic", async () => {
    mocks.fetchUsageStatsMock.mockResolvedValueOnce({ snapshot: null });

    await renderPage(["/portal/storage-spaces/research-data?tab=statistics"]);

    expect(await screen.findByText(/No file-composition snapshot is available yet/i)).toBeInTheDocument();
    expect(await screen.findByText("Activity source")).toBeInTheDocument();
  });

  it("keeps traffic available when file-composition collection is disabled", async () => {
    mocks.generalSettings.bucket_usage_stats_enabled = false;

    await renderPage(["/portal/storage-spaces/research-data?tab=statistics"]);

    await waitFor(() => expect(mocks.fetchTrafficMock).toHaveBeenCalled());
    expect(mocks.fetchUsageStatsMock).not.toHaveBeenCalled();
    expect(screen.queryByText("File composition")).not.toBeInTheDocument();
    expect(screen.getByText("Transfer activity")).toBeInTheDocument();
  });

  it("lets a Portal Manager configure Versioning, Lifecycle and version history retention", async () => {
    await renderPage(["/portal/storage-spaces/research-data?tab=settings"]);

    const versioning = await screen.findByRole("checkbox", { name: "Versioning" });
    const lifecycle = screen.getByRole("checkbox", { name: "Lifecycle" });
    fireEvent.click(versioning);
    expect(lifecycle).toBeChecked();
    fireEvent.change(screen.getByLabelText("Version history retention"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => {
      expect(mocks.updateStorageSpaceSettingsMock).toHaveBeenCalledWith("101", "research-data", {
        versioning_enabled: false,
        lifecycle_enabled: true,
        version_history_retention_days: 45,
      });
    });
    expect(await screen.findByText("Version history settings saved.")).toBeInTheDocument();
  });

  it("lets a Portal Manager change the Storage Space pictogram from settings", async () => {
    await renderPage(["/portal/storage-spaces/research-data?tab=settings"]);

    fireEvent.click(screen.getByRole("button", { name: "Change icon" }));
    expect(screen.getByRole("dialog", { name: "Storage Space icon" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Database" }));
    fireEvent.click(screen.getByRole("button", { name: "Save icon" }));

    await waitFor(() => {
      expect(mocks.updateStorageSpaceIconMock).toHaveBeenCalledWith("101", "research-data", {
        source: "preset",
        preset: "database",
      });
    });
    expect(mocks.hookResult.refreshWorkspaceData).toHaveBeenCalledTimes(1);
  });

  it("lets a Portal Manager upload a custom Storage Space image from settings", async () => {
    await renderPage(["/portal/storage-spaces/research-data?tab=settings"]);
    const image = new File(["png"], "space.png", { type: "image/png" });

    fireEvent.click(screen.getByRole("button", { name: "Change icon" }));
    fireEvent.change(screen.getByLabelText("Custom image file"), {
      target: { files: [image] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save icon" }));

    await waitFor(() => {
      expect(mocks.uploadStorageSpaceIconMock).toHaveBeenCalledWith(
        "101",
        "research-data",
        image,
      );
    });
    expect(mocks.hookResult.refreshWorkspaceData).toHaveBeenCalledTimes(1);
  });

  it("reserves Storage Space icon configuration for Portal Managers", async () => {
    mocks.hookResult.state.portal_role = "portal_user";

    await renderPage(["/portal/storage-spaces/research-data?tab=settings"]);

    expect(screen.queryByRole("button", { name: "Change icon" })).not.toBeInTheDocument();
  });

  it("shows Storage Space settings read-only to an Owner", async () => {
    mocks.hookResult.workspace.spaces[0].role = "Owner";
    mocks.fetchStorageSpaceSettingsMock.mockResolvedValueOnce({
      versioning_enabled: true,
      versioning_status: "Enabled",
      lifecycle_enabled: true,
      version_history_retention_days: 90,
      can_update: false,
    });

    await renderPage(["/portal/storage-spaces/research-data?tab=settings"]);

    expect(await screen.findByRole("checkbox", { name: "Versioning" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Lifecycle" })).toBeDisabled();
    expect(screen.getByLabelText("Version history retention")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save settings" })).not.toBeInTheDocument();
    expect(screen.getByText(/Only a project Portal Manager can change them/)).toBeInTheDocument();
  });

  it("keeps archived Storage Space settings read-only", async () => {
    mocks.hookResult.workspace.spaces[0].status = "Archived";
    mocks.hookResult.workspace.spaces[0].archivedAt = "2026-06-01T10:00:00Z";
    mocks.fetchStorageSpaceSettingsMock.mockResolvedValueOnce({
      versioning_enabled: true,
      versioning_status: "Enabled",
      lifecycle_enabled: true,
      version_history_retention_days: 90,
      can_update: false,
    });

    await renderPage(["/portal/storage-spaces/research-data?tab=settings"]);

    expect(await screen.findByText("Archived spaces keep their settings but cannot be changed.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Versioning" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save settings" })).not.toBeInTheDocument();
  });

  it("opens the deleted-files view and restores a deleted file", async () => {
    await renderPage(["/portal/storage-spaces/research-data?show_deleted=1"]);

    await waitFor(() => {
      const embedProps = vi.mocked(BrowserEmbed).mock.calls.at(-1)?.[0] as ComponentProps<typeof BrowserEmbed>;
      expect(embedProps.deletedObjectsOptions?.visible).toBe(true);
    });
    expect(screen.queryByRole("tab", { name: /Trash/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mock restore deleted" }));
    const dialog = screen.getByRole("dialog", { name: "Restore this file?" });
    expect(
      within(dialog).getByText("The file will reappear in Files at the same location."),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore file" }));

    await waitFor(() => {
      expect(mocks.restoreObjectMock).toHaveBeenCalledWith(
        "101",
        "research-data",
        "reports/deleted.csv",
      );
    });
    expect(
      await screen.findByText("deleted.csv restored to its original location."),
    ).toBeInTheDocument();
    expect(mocks.hookResult.refreshWorkspaceData).toHaveBeenCalled();
  });

  it("restores all deleted files under a selected folder with progress", async () => {
    mocks.streamDeletedPrefixRestoreMock.mockImplementation(
      async (
        _accountId: string,
        _spaceId: string,
        _prefix: string,
        options: {
          onProgress?: (value: Record<string, unknown>) => void;
        },
      ) => {
        options.onProgress?.({
          stage: "restore",
          storage_space_id: "research-data",
          storage_space_name: "Research Data",
          prefix: "reports/",
          scanned_versions: 12,
          scanned_delete_markers: 3,
          restore_candidates: 2,
          restored_objects: 1,
          failed_objects: 0,
          total_candidates_final: true,
          message: "Restoring deleted files...",
        });
        return {
          status: "completed",
          storage_space_id: "research-data",
          storage_space_name: "Research Data",
          prefix: "reports/",
          scanned_versions: 12,
          scanned_delete_markers: 3,
          restore_candidates: 2,
          restored_objects: 2,
          failed_objects: 0,
          failures: [],
          failures_truncated: false,
          started_at: "2026-07-30T10:00:00Z",
          finished_at: "2026-07-30T10:00:01Z",
        };
      },
    );
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Mock restore folder" }));
    expect(
      screen.getByRole("heading", { name: "Restore deleted files" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restore files" }));

    await waitFor(() => {
      expect(mocks.streamDeletedPrefixRestoreMock).toHaveBeenCalledWith(
        "101",
        "research-data",
        "reports/",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
    expect((await screen.findAllByText("2")).length).toBeGreaterThan(0);
    expect(screen.getByText("returned to their folders")).toBeInTheDocument();
  });

  it("guides users to add files and invite people after creating a space", async () => {
    mocks.hookResult.workspace.spaces[0].objectCount = 0;
    mocks.hookResult.workspace.spaces[0].shareCount = 0;
    mocks.fetchAccessSummaryMock.mockResolvedValueOnce({
      ...accessSummaryFixture,
      effective_member_count: 1,
      explicit_shares: [],
    });

    await renderPage([
      {
        pathname: "/portal/storage-spaces/research-data",
        state: { portalSpaceCreated: true },
      },
    ]);

    expect(screen.getByText("Space created.")).toBeInTheDocument();
    expect(screen.getByText("Use the start guide below to add files and bring collaborators in at the right time.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Start this space" })).toBeInTheDocument();
    expect(screen.getByText("No files yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add files" })).toHaveAttribute(
      "href",
      "/portal/storage-spaces/research-data#space-files"
    );
    expect(screen.getAllByRole("button", { name: "Invite people" }).length).toBeGreaterThan(0);
  });

  it("lets users dismiss the start guide for an empty active space", async () => {
    mocks.hookResult.workspace.spaces[0].objectCount = 0;
    mocks.hookResult.workspace.spaces[0].shareCount = 0;
    mocks.fetchAccessSummaryMock.mockResolvedValueOnce({
      ...accessSummaryFixture,
      effective_member_count: 1,
      explicit_shares: [],
    });

    await renderPage();

    expect(screen.queryByText("Space created.")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Start this space" })).toBeInTheDocument();
    expect(screen.getByText("Keep the first steps focused: add the files people need, then invite collaborators when the space is ready.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add files" })).toHaveAttribute(
      "href",
      "/portal/storage-spaces/research-data#space-files"
    );
    expect(screen.getAllByRole("button", { name: "Invite people" }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss guide" }));
    expect(screen.queryByRole("heading", { name: "Start this space" })).not.toBeInTheDocument();
    expect(window.localStorage.getItem("portal.storage-space-detail.start-guide.dismissed.101.research-data")).toBe("true");
  });

  it("does not repeat the start guide after files or collaborators exist", async () => {
    mocks.hookResult.workspace.spaces[0].objectCount = 0;
    mocks.hookResult.workspace.spaces[0].shareCount = 1;

    await renderPage();

    expect(screen.queryByRole("heading", { name: "Start this space" })).not.toBeInTheDocument();
  });

  it("does not show the start guide when collaborators are known only from access details", async () => {
    mocks.hookResult.workspace.spaces[0].objectCount = 0;
    mocks.hookResult.workspace.spaces[0].shareCount = null;

    await renderPage();

    await waitFor(() => {
      expect(mocks.fetchAccessSummaryMock).toHaveBeenCalledWith("101", "research-data");
    });
    expect(screen.queryByRole("heading", { name: "Start this space" })).not.toBeInTheDocument();
  });

  it("passes resolved read-only capabilities for Viewer spaces", async () => {
    mocks.hookResult.workspace.spaces[0].role = "Viewer";
    mocks.hookResult.workspace.spaces[0].contentRole = "Viewer";

    await renderPage();

    const embedProps = vi.mocked(BrowserEmbed).mock.calls[0][0] as ComponentProps<typeof BrowserEmbed>;
    expect(embedProps.capabilityFacts).toEqual({
      canWriteObjects: false,
      canDeleteObjects: false,
      canRestoreObjects: false,
      canCreatePublicLinks: false,
    });
    expect(embedProps.onCreatePublicLinkForObject).toBeUndefined();
  });

  it("creates a public link from a Browser-selected file", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    await renderPage();

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

  it("shows a disabled state when the Portal Browser kill switch is off", async () => {
    mocks.generalSettings.browser_portal_enabled = false;

    await renderPage();

    expect(screen.getByText(/Files are unavailable/i)).toBeInTheDocument();
    expect(screen.queryByTestId("portal-browser-embed")).not.toBeInTheDocument();
  });

  it("locks name editing and only saves description for non-renameable spaces", async () => {
    mocks.hookResult.workspace.spaces[0].nameEditable = false;
    mocks.hookResult.workspace.spaces[0].origin = "imported";

    await renderPage();

    await openSettingsTab();
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
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

  it("shows the collaborator panel with public link context", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("tab", { name: "Collaborators" }));
    expect(await screen.findByRole("tabpanel", { name: "Collaborators" })).toBeInTheDocument();
    expect(screen.getAllByText("Selected people").length).toBeGreaterThan(0);
    expect(screen.getByText("Manager User")).toBeInTheDocument();
    expect(screen.getAllByText("viewer@example.com").length).toBeGreaterThan(0);
    expect(screen.getByRole("combobox", { name: "Access for viewer@example.com" })).toHaveClass("ui-control");
    expect(screen.queryByLabelText("People")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "2 public links" }));
    expect(await screen.findByRole("tabpanel", { name: "External links" })).toBeInTheDocument();
    expect(screen.getByTestId("location-probe")).toHaveTextContent("?tab=external-links");
    fireEvent.click(screen.getByRole("tab", { name: "Collaborators" }));
    expect(
      await screen.findByText("Roles below apply only to this space."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Manage collaborators" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add people" }));
    await screen.findAllByRole("heading", { name: "Add people" });
    const dialog = document.querySelector(".workflow-page");
    if (!dialog) throw new Error("Add people workflow page not found");
    expect(within(dialog).getByLabelText("People")).toHaveClass("ui-control");
    expect(within(dialog).getByText("Editor User")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByLabelText(/Editor User/i));
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Access for editor@example.com" }), {
      target: { value: "Editor" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add people" }));

    await waitFor(() => {
      expect(mocks.grantShareMock).toHaveBeenCalledWith("101", "research-data", {
        user_id: 13,
        role: "Editor",
      });
    });
    expect(await screen.findByText("1 person added to Research Data.")).toBeInTheDocument();
  });

  it("opens the contextual collaborator workflow from a direct link and header action", async () => {
    await renderPage(["/portal/storage-spaces/research-data?tab=collaborators"]);

    expect(
      await screen.findByRole("tab", { name: "Collaborators" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("tabpanel", { name: "Collaborators" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Invite people" }));
    const workflow = document.querySelector(".workflow-page");
    if (!workflow) throw new Error("Add people workflow page not found");
    expect(within(workflow).getByRole("heading", { name: "Add people" })).toBeInTheDocument();
    expect(await within(workflow).findByText("Already invited · Viewer")).toBeInTheDocument();
  });

  it("confirms role changes before applying them to the current space", async () => {
    await renderPage(["/portal/storage-spaces/research-data?tab=collaborators"]);

    const roleSelect = await screen.findByRole("combobox", {
      name: "Access for viewer@example.com",
    });
    fireEvent.change(roleSelect, { target: { value: "Editor" } });

    expect(mocks.updateShareMock).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Change access role" });
    expect(within(dialog).getByText("viewer@example.com")).toBeInTheDocument();
    expect(within(dialog).getByText("Current role")).toBeInTheDocument();
    expect(within(dialog).getByText("New role")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Update role" }));

    await waitFor(() => {
      expect(mocks.updateShareMock).toHaveBeenCalledWith(
        "101",
        "research-data",
        12,
        "Editor",
      );
    });
    expect(
      await screen.findByText(
        "viewer@example.com now has Editor access to Research Data.",
      ),
    ).toBeInTheDocument();
  });

  it("requests a missing project member without leaving the space workflow", async () => {
    await renderPage(["/portal/storage-spaces/research-data?tab=collaborators"]);

    fireEvent.click(await screen.findByRole("button", { name: "Add people" }));
    const workflow = document.querySelector(".workflow-page");
    if (!workflow) throw new Error("Add people workflow page not found");
    fireEvent.change(
      await within(workflow).findByPlaceholderText(
        "Search people by name or email...",
      ),
      { target: { value: "missing@example.org" } },
    );
    fireEvent.click(
      within(workflow).getByRole("button", {
        name: "Request collaborator access",
      }),
    );
    const requestDialog = screen.getByRole("dialog", {
      name: "Request collaborator access",
    });
    fireEvent.change(within(requestDialog).getByLabelText("Name"), {
      target: { value: "Missing Person" },
    });
    fireEvent.click(
      within(requestDialog).getByRole("button", { name: "Send request" }),
    );

    await waitFor(() => {
      expect(mocks.createPortalRequestMock).toHaveBeenCalledWith("101", {
        request_type: "portal_user_access",
        target_name: "Missing Person",
        target_email: "missing@example.org",
      });
    });
    expect(
      await within(workflow).findByText(
        "Request sent. Track it in Help requests, then return to Research Data to finish the invitation.",
      ),
    ).toBeInTheDocument();
    expect(within(workflow).getByRole("link", { name: "Open Help requests" })).toHaveAttribute(
      "href",
      "/portal/requests",
    );
  });

  it("shows external-tool mapping without replacing the space name", async () => {
    await renderPage();

    await openSettingsTab();
    expect(await screen.findByRole("heading", { name: "Connect external tools" })).toBeInTheDocument();
    expect(screen.getByText("research-data-internal")).toBeInTheDocument();
    expect(screen.getByText("Manual storage name")).toBeInTheDocument();
    expect(screen.getByText(/Use this only when an external app asks for a storage or bucket name/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connection details" })).toHaveAttribute(
      "href",
      "/portal/access-keys?space_id=research-data-internal&create=external"
    );
    expect(screen.getAllByText("Research Data").length).toBeGreaterThan(1);
  });

  it("runs history cleanup after a button-only confirmation and shows progress", async () => {
    await renderPage();

    await openSettingsTab();
    const versionHistorySection = screen
      .getByRole("heading", { name: "Version history settings" })
      .closest("section");
    if (!versionHistorySection) throw new Error("Version history settings section not found");
    expect(screen.queryByRole("heading", { name: "History cleanup" })).not.toBeInTheDocument();
    fireEvent.click(within(versionHistorySection).getByRole("button", { name: "Clean up history" }));

    const confirmation = screen.getByRole("dialog", { name: "Clean up history" });
    expect(within(confirmation).getByText(/permanently remove older file history/i)).toBeInTheDocument();
    expect(within(confirmation).queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(within(confirmation).getByRole("button", { name: "Start cleanup" }));

    await waitFor(() => {
      expect(mocks.streamHistoryCleanupMock).toHaveBeenCalledWith(
        "101",
        "research-data",
        { confirmation: "CLEAN HISTORY RESEARCH DATA" },
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

    await renderPage();

    await openSettingsTab();
    expect(await screen.findByText("History cleanup is disabled for this project.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clean up history" })).toBeDisabled();
  });

  it("confirms access mode changes from the Access panel", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("tab", { name: "Collaborators" }));
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

    await renderPage();

    await openSettingsTab();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => {
      expect(mocks.updateStorageSpaceMock).toHaveBeenCalledWith("101", "research-data", { archived: false });
    });
    expect(mocks.hookResult.refreshWorkspaceData).toHaveBeenCalledTimes(1);
  });

  it("explains how to empty a non-empty space without calling deletion", async () => {
    await renderPage();

    await openSettingsTab();
    fireEvent.click(screen.getByRole("button", { name: "Delete space" }));

    expect(screen.getByRole("dialog", { name: "Delete space" })).toBeInTheDocument();
    expect(screen.getByText(/Delete every current file, then clean up its history/i)).toBeInTheDocument();
    expect(screen.getByText(/Portal never empties the bucket automatically/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Delete space" }).at(-1)).toBeDisabled();
    expect(mocks.deleteStorageSpaceMock).not.toHaveBeenCalled();
  });

  it("deletes an empty space after a simple confirmation", async () => {
    mocks.hookResult.workspace.spaces[0].objectCount = 0;
    mocks.hookResult.workspace.spaces[0].usedBytes = 0;
    mocks.deleteStorageSpaceMock.mockResolvedValue(undefined);

    await renderPage();
    await openSettingsTab();
    fireEvent.click(screen.getByRole("button", { name: "Delete space" }));
    const dialog = screen.getByRole("dialog", { name: "Delete space" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete space" }));

    await waitFor(() => {
      expect(mocks.deleteStorageSpaceMock).toHaveBeenCalledWith("101", "research-data");
      expect(mocks.hookResult.refreshWorkspaceData).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Spaces")).toBeInTheDocument();
    });
  });

  it("keeps the confirmation open and reports deletion errors", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.hookResult.workspace.spaces[0].objectCount = 0;
    mocks.hookResult.workspace.spaces[0].usedBytes = 0;
    mocks.deleteStorageSpaceMock.mockRejectedValue(new Error("Deletion service unavailable"));

    await renderPage();
    await openSettingsTab();
    fireEvent.click(screen.getByRole("button", { name: "Delete space" }));
    const dialog = screen.getByRole("dialog", { name: "Delete space" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete space" }));

    expect(await within(dialog).findByText("Deletion service unavailable")).toBeInTheDocument();
    expect(mocks.hookResult.refreshWorkspaceData).not.toHaveBeenCalled();
    expect(dialog).toBeInTheDocument();
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(Error));
    consoleErrorSpy.mockRestore();
  });

  it("hides permanent deletion from administrative Owners without content ownership", async () => {
    mocks.hookResult.workspace.spaces[0].contentRole = null;
    mocks.hookResult.workspace.spaces[0].canBrowse = false;
    mocks.hookResult.workspace.spaces[0].canDelete = false;

    await renderPage();
    await openSettingsTab();

    expect(screen.queryByRole("button", { name: "Delete space" })).not.toBeInTheDocument();
  });

  it("asks to restore an archived non-empty space before cleanup", async () => {
    mocks.hookResult.workspace.spaces[0].status = "Archived";
    mocks.hookResult.workspace.spaces[0].archivedAt = "2026-06-01T10:00:00Z";

    await renderPage();
    await openSettingsTab();
    fireEvent.click(screen.getByRole("button", { name: "Delete space" }));

    expect(screen.getByText(/Restore the space before removing files and cleaning its history/i)).toBeInTheDocument();
  });

  it("hides the embedded Browser when the space is archived", async () => {
    mocks.hookResult.workspace.spaces[0].status = "Archived";
    mocks.hookResult.workspace.spaces[0].archivedAt = "2026-06-01T10:00:00Z";

    await renderPage();

    expect(screen.getByText(/This space is archived/i)).toBeInTheDocument();
    expect(screen.queryByTestId("portal-browser-embed")).not.toBeInTheDocument();
  });

  it("keeps metadata management but hides files when content browsing is denied", async () => {
    mocks.hookResult.workspace.spaces[0].visibility = "private";
    mocks.hookResult.workspace.spaces[0].access = "Private";
    mocks.hookResult.workspace.spaces[0].contentRole = null;
    mocks.hookResult.workspace.spaces[0].canBrowse = false;

    await renderPage();

    expect(screen.getByText(/Files are not available for this private space/i)).toBeInTheDocument();
    expect(screen.queryByTestId("portal-browser-embed")).not.toBeInTheDocument();
    await openSettingsTab();
    expect(screen.getByRole("heading", { name: "Space settings" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("confirms archive with explicit target and impacts", async () => {
    await renderPage();

    await openSettingsTab();
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
