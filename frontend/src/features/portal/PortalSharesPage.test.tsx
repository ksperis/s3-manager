import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PortalSharesPage from "./PortalSharesPage";

const mocks = vi.hoisted(() => ({
  listSharesMock: vi.fn(),
  listShareCandidatesMock: vi.fn(),
  listPublicLinksMock: vi.fn(),
  grantShareMock: vi.fn(),
  revokePublicLinkMock: vi.fn(),
  updateStorageSpaceMock: vi.fn(),
  updateShareMock: vi.fn(),
  revokeShareMock: vi.fn(),
  refreshWorkspaceDataMock: vi.fn(),
  hookResult: {
    workspace: {
      spaces: [
        {
          id: "research-data",
          name: "Research Data",
          role: "Owner",
          status: "Active",
          access: "Shared",
          ownerUserId: 7,
          visibility: "shared",
          region: "eu-west-3",
          createdLabel: "May 10, 2023",
          shareCount: 1,
        },
      ],
    },
    loading: false,
    accountLoading: false,
    error: null,
    accountError: null,
    hasAccountContext: true,
    accountIdForApi: "101",
    refreshWorkspaceData: vi.fn(),
  },
}));

vi.mock("./usePortalWorkspaceData", () => ({
  usePortalWorkspaceData: () => mocks.hookResult,
}));

vi.mock("../../api/portal", () => ({
  listPortalStorageSpacePublicLinks: (...args: unknown[]) => mocks.listPublicLinksMock(...args),
  listPortalStorageSpaceShares: (...args: unknown[]) => mocks.listSharesMock(...args),
  listPortalStorageSpaceShareCandidates: (...args: unknown[]) => mocks.listShareCandidatesMock(...args),
  grantPortalStorageSpaceShare: (...args: unknown[]) => mocks.grantShareMock(...args),
  revokePortalStorageSpacePublicLink: (...args: unknown[]) => mocks.revokePublicLinkMock(...args),
  updatePortalStorageSpace: (...args: unknown[]) => mocks.updateStorageSpaceMock(...args),
  updatePortalStorageSpaceShare: (...args: unknown[]) => mocks.updateShareMock(...args),
  revokePortalStorageSpaceShare: (...args: unknown[]) => mocks.revokeShareMock(...args),
}));

describe("PortalSharesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, "", "/portal/shares");
    mocks.hookResult.workspace.spaces = [
      {
        id: "research-data",
        name: "Research Data",
        role: "Owner",
        status: "Active",
        access: "Shared",
        ownerUserId: 7,
        visibility: "shared",
        region: "eu-west-3",
        createdLabel: "May 10, 2023",
        shareCount: 1,
      },
    ];
    mocks.listSharesMock.mockResolvedValue([
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
    ]);
    mocks.listPublicLinksMock.mockResolvedValue([
      {
        id: 42,
        storage_space_id: "research-data",
        storage_space_name: "Research Data",
        object_key: "raw-data/report.csv",
        object_name: "report.csv",
        url: "/api/portal/public-links/token/download",
        status: "Active",
        created_at: "2026-06-01T10:00:00Z",
        expires_at: "2026-06-10T10:00:00Z",
      },
    ]);
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
    mocks.revokeShareMock.mockResolvedValue(undefined);
    mocks.revokePublicLinkMock.mockResolvedValue([]);
    mocks.updateStorageSpaceMock.mockResolvedValue({});
    mocks.hookResult.refreshWorkspaceData.mockClear();
  });

  it("loads collaborators from the space API with simple roles", async () => {
    const user = userEvent.setup();

    render(<PortalSharesPage />);

    expect(screen.getByText("Loading collaborators...")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Collaborators" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Invite people to a space" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "People I invited" }));
    expect((await screen.findAllByText("viewer@example.com")).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Invite people to a space" })).toBeInTheDocument();
    expect(screen.getByLabelText("Space to share")).toHaveClass("ui-control");
    expect(screen.getByLabelText("People")).toHaveClass("ui-control");
    expect(screen.getByRole("combobox", { name: "Access for editor@example.com" })).toHaveClass("ui-control");
    expect(screen.queryByText("Expires")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Access for viewer@example.com" })).toHaveValue("Viewer");
    await waitFor(() => {
      expect(mocks.listSharesMock).toHaveBeenCalledWith("101", "research-data");
    });
    expect(screen.getByText("Workspace member · Direct access")).toBeInTheDocument();
    expect(screen.getByText("Already invited")).toBeInTheDocument();
    expect(screen.queryByText(/bucket permissions/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/mock|mocked|preview/i)).not.toBeInTheDocument();
  });

  it("preselects the tab and space from the URL context", async () => {
    window.history.pushState({}, "", "/portal/shares?space_id=research-data&tab=by");

    render(<PortalSharesPage />);

    expect(await screen.findByRole("heading", { name: "Invite people to a space" })).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.listShareCandidatesMock).toHaveBeenCalledWith("101", "research-data");
    });
  });

  it("invites collaborators from the people picker", async () => {
    const user = userEvent.setup();
    mocks.grantShareMock.mockResolvedValue({
      id: "research-data:13",
      storage_space_id: "research-data",
      storage_space_name: "Research Data",
      user_id: 13,
      email: "editor@example.com",
      role: "Owner",
      direction: "by_me",
      activity_label: "Active",
    });

    render(<PortalSharesPage />);

    await user.click(await screen.findByRole("button", { name: "People I invited" }));
    expect(await screen.findByText("Editor User")).toBeInTheDocument();
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[1]);
    await user.selectOptions(screen.getByRole("combobox", { name: "Access for editor@example.com" }), "Owner");
    await user.click(screen.getByRole("button", { name: "Invite people" }));

    await waitFor(() => {
      expect(mocks.grantShareMock).toHaveBeenCalledWith("101", "research-data", {
        user_id: 13,
        role: "Owner",
      });
    });
  });

  it("shows the admin request empty state for name or email searches without candidates", async () => {
    const user = userEvent.setup();

    render(<PortalSharesPage />);

    await user.click(await screen.findByRole("button", { name: "People I invited" }));
    await user.type(await screen.findByPlaceholderText("Search people by name or email..."), "missing person");

    expect(await screen.findByText(/Ask an admin to add external collaborators/i)).toBeInTheDocument();
  });

  it("loads collaborator inventory for all active spaces", async () => {
    mocks.hookResult.workspace.spaces = [
      {
        id: "research-data",
        name: "Research Data",
        role: "Owner",
        status: "Active",
        access: "Shared",
        ownerUserId: 7,
        visibility: "shared",
        region: "eu-west-3",
        createdLabel: "May 10, 2023",
        shareCount: 1,
      },
      {
        id: "private-data",
        name: "Private Data",
        role: "Owner",
        status: "Private",
        access: "Private",
        ownerUserId: 7,
        visibility: "private",
        region: "eu-west-3",
        createdLabel: "May 11, 2023",
        shareCount: 1,
      },
      {
        id: "archived-data",
        name: "Archived Data",
        role: "Owner",
        status: "Archived",
        access: "Shared",
        ownerUserId: 7,
        visibility: "shared",
        region: "eu-west-3",
        createdLabel: "May 12, 2023",
        shareCount: 1,
      },
    ];

    render(<PortalSharesPage />);

    await waitFor(() => {
      expect(mocks.listSharesMock).toHaveBeenCalledTimes(2);
    });
    expect(mocks.listSharesMock).toHaveBeenCalledWith("101", "research-data");
    expect(mocks.listSharesMock).toHaveBeenCalledWith("101", "private-data");
    expect(mocks.listSharesMock).not.toHaveBeenCalledWith("101", "archived-data");
  });

  it("makes a private owner space invite-ready before granting collaborators", async () => {
    const user = userEvent.setup();
    mocks.hookResult.workspace.spaces = [
      {
        id: "private-data",
        name: "Private Data",
        role: "Owner",
        status: "Active",
        access: "Private",
        ownerUserId: 7,
        visibility: "private",
        region: "eu-west-3",
        createdLabel: "May 11, 2023",
        shareCount: 0,
      },
    ];
    mocks.grantShareMock.mockResolvedValue({
      id: "private-data:13",
      storage_space_id: "private-data",
      storage_space_name: "Private Data",
      user_id: 13,
      email: "editor@example.com",
      role: "Editor",
      direction: "by_me",
      activity_label: "Active",
    });

    render(<PortalSharesPage />);

    await user.click(await screen.findByRole("button", { name: "People I invited" }));
    expect(await screen.findByText("Editor User")).toBeInTheDocument();
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[1]);
    await user.selectOptions(screen.getByRole("combobox", { name: "Access for editor@example.com" }), "Editor");
    await user.click(screen.getByRole("button", { name: "Invite people" }));

    await waitFor(() => {
      expect(mocks.updateStorageSpaceMock).toHaveBeenCalledWith("101", "private-data", {
        visibility: "shared",
        share_scope: "restricted",
        account_member_role: null,
      });
    });
    expect(mocks.grantShareMock).toHaveBeenCalledWith("101", "private-data", {
      user_id: 13,
      role: "Editor",
    });
    expect(mocks.hookResult.refreshWorkspaceData).toHaveBeenCalledTimes(1);
  });

  it("loads public links from real portal endpoints", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(<PortalSharesPage />);

    await user.click(await screen.findByRole("button", { name: "Public links" }));
    expect(await screen.findByText("report.csv")).toBeInTheDocument();
    expect(screen.getByText("/api/portal/public-links/token/download")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Create a public link" })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("path/to/object.ext")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.listPublicLinksMock).toHaveBeenCalledWith("101", "research-data", { includeRevoked: true });
    });
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("/api/portal/public-links/token/download");
    expect(await screen.findByText("Link copied.")).toBeInTheDocument();
  });

  it("shows empty states when shares and public links are absent", async () => {
    const user = userEvent.setup();
    mocks.listSharesMock.mockResolvedValue([]);
    mocks.listPublicLinksMock.mockResolvedValue([]);

    render(<PortalSharesPage />);

    await user.click(await screen.findByRole("button", { name: "People I invited" }));
    expect(await screen.findByText("No collaborators invited yet.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Public links" }));
    expect(await screen.findByText("No public links yet.")).toBeInTheDocument();
  });

  it("confirms share and public link revocation with target and impacts", async () => {
    const user = userEvent.setup();

    render(<PortalSharesPage />);

    await user.click(await screen.findByRole("button", { name: "People I invited" }));
    expect((await screen.findAllByText("viewer@example.com")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("viewer@example.com")[0].closest("table")).toHaveClass("responsive-data-table");
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    const shareDialog = screen.getByRole("dialog", { name: "Revoke access" });
    expect(within(shareDialog).getByText("viewer@example.com")).toBeInTheDocument();
    expect(within(shareDialog).getByText("This person loses access to the space immediately.")).toBeInTheDocument();
    await user.click(within(shareDialog).getByRole("button", { name: "Revoke access" }));

    await waitFor(() => {
      expect(mocks.revokeShareMock).toHaveBeenCalledWith("101", "research-data", 12);
    });

    await user.click(screen.getByRole("button", { name: "Public links" }));
    expect(await screen.findByText("report.csv")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    const linkDialog = screen.getByRole("dialog", { name: "Revoke public link" });
    expect(within(linkDialog).getByText("report.csv")).toBeInTheDocument();
    expect(within(linkDialog).getByText("Anyone using this URL loses access immediately.")).toBeInTheDocument();
    await user.click(within(linkDialog).getByRole("button", { name: "Revoke link" }));

    await waitFor(() => {
      expect(mocks.revokePublicLinkMock).toHaveBeenCalledWith("101", "research-data", 42);
    });
  });
});
