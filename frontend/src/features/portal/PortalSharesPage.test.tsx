import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
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
  createPortalRequestMock: vi.fn(),
  refreshWorkspaceDataMock: vi.fn(),
  hookResult: {
    workspace: {
      spaces: [
        {
          id: "research-data",
          name: "Research Data",
          role: "Manager",
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
    collaborators: {
      summary: {
        collaborator_count: 2,
        external_access_key_count: 1,
        trend: {
          window: "month",
          label: "last 30 days",
          period_start: "2026-05-10",
          collaborator_count: 1,
        },
      },
      collaborators: [
        {
          user_id: 7,
          email: "manager@example.com",
          display_name: "Manager User",
          account_role: "portal_manager",
          access_source: "direct",
          member_since: "2026-05-01T10:00:00Z",
          avatar: {
            preference: "initials",
            source: "initials",
            url: null,
            initials: "MU",
          },
        },
        {
          user_id: 13,
          email: "editor@example.com",
          display_name: "Editor User",
          account_role: "portal_user",
          access_source: "group",
          member_since: "2026-06-01T10:00:00Z",
          avatar: {
            preference: "auto",
            source: "provider",
            url: "https://idp.example.test/editor.png",
            initials: "EU",
          },
        },
      ],
    },
    collaboratorsLoading: false,
    collaboratorsError: null,
    refreshWorkspaceData: vi.fn(),
  },
}));

vi.mock("./usePortalWorkspaceData", () => ({
  usePortalWorkspaceData: () => mocks.hookResult,
}));

function getInviteWorkflowPage(): HTMLElement {
  const page = document.querySelector(".workflow-page");
  if (!page) throw new Error("Invite people workflow page not found");
  return page as HTMLElement;
}

vi.mock("../../api/portal", () => ({
  listPortalStorageSpacePublicLinks: (...args: unknown[]) =>
    mocks.listPublicLinksMock(...args),
  listPortalStorageSpaceShares: (...args: unknown[]) =>
    mocks.listSharesMock(...args),
  listPortalStorageSpaceShareCandidates: (...args: unknown[]) =>
    mocks.listShareCandidatesMock(...args),
  grantPortalStorageSpaceShare: (...args: unknown[]) =>
    mocks.grantShareMock(...args),
  revokePortalStorageSpacePublicLink: (...args: unknown[]) =>
    mocks.revokePublicLinkMock(...args),
  updatePortalStorageSpace: (...args: unknown[]) =>
    mocks.updateStorageSpaceMock(...args),
  updatePortalStorageSpaceShare: (...args: unknown[]) =>
    mocks.updateShareMock(...args),
  revokePortalStorageSpaceShare: (...args: unknown[]) =>
    mocks.revokeShareMock(...args),
}));

vi.mock("../../api/portalRequests", () => ({
  createPortalRequest: (...args: unknown[]) =>
    mocks.createPortalRequestMock(...args),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <PortalSharesPage />
    </MemoryRouter>,
  );
}

describe("PortalSharesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.history.pushState({}, "", "/portal/shares");
    mocks.hookResult.workspace.spaces = [
      {
        id: "research-data",
        name: "Research Data",
        role: "Manager",
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
    mocks.createPortalRequestMock.mockResolvedValue({
      id: 42,
      account_id: 101,
      request_type: "portal_user_access",
      status: "pending",
      payload: {
        target_name: "Missing Person",
        target_email: "missing@example.org",
      },
      requester_email: "storage.user@example.com",
      created_at: "2026-07-08T10:00:00Z",
      updated_at: "2026-07-08T10:00:00Z",
    });
    mocks.hookResult.collaborators = {
      summary: {
        collaborator_count: 2,
        external_access_key_count: 1,
        trend: {
          window: "month",
          label: "last 30 days",
          period_start: "2026-05-10",
          collaborator_count: 1,
        },
      },
      collaborators: [
        {
          user_id: 7,
          email: "manager@example.com",
          display_name: "Manager User",
          account_role: "portal_manager",
          access_source: "direct",
          member_since: "2026-05-01T10:00:00Z",
          avatar: {
            preference: "initials",
            source: "initials",
            url: null,
            initials: "MU",
          },
        },
        {
          user_id: 13,
          email: "editor@example.com",
          display_name: "Editor User",
          account_role: "portal_user",
          access_source: "group",
          member_since: "2026-06-01T10:00:00Z",
          avatar: {
            preference: "auto",
            source: "provider",
            url: "https://idp.example.test/editor.png",
            initials: "EU",
          },
        },
      ],
    };
    mocks.hookResult.collaboratorsLoading = false;
    mocks.hookResult.collaboratorsError = null;
    mocks.hookResult.refreshWorkspaceData.mockClear();
  });

  it("loads collaborators from the space API with simple roles", async () => {
    const user = userEvent.setup();

    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Collaborators" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invite" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Invite people" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Review access" }),
    ).not.toBeInTheDocument();
    const membersTab = await screen.findByRole("button", {
      name: "Workspace members",
    });
    expect(
      within(membersTab.parentElement!).getAllByRole("button").map((button) =>
        button.textContent?.trim(),
      ),
    ).toEqual(["Workspace members", "Review access", "Invite"]);
    const workspaceMembers = screen
      .getByRole("heading", { name: "Workspace members" })
      .closest("section");
    expect(workspaceMembers).not.toBeNull();
    expect(
      within(workspaceMembers!).getByText("Manager User"),
    ).toBeInTheDocument();
    expect(within(workspaceMembers!).getByTitle("Manager User")).toHaveTextContent(
      "MU",
    );
    expect(within(workspaceMembers!).getByTitle("Editor User")).toContainElement(
      within(workspaceMembers!).getByRole("presentation"),
    );
    expect(
      within(workspaceMembers!).getByText("Workspace manager"),
    ).toBeInTheDocument();
    expect(
      within(workspaceMembers!).getByText("Direct access"),
    ).toBeInTheDocument();
    expect(
      within(workspaceMembers!).getByText("Group access"),
    ).toBeInTheDocument();
    expect(
      within(workspaceMembers!).getByText("2 of 2 members"),
    ).toBeInTheDocument();
    expect(within(workspaceMembers!).getByRole("table")).toHaveClass(
      "responsive-data-table",
    );
    expect(
      screen.queryByRole("heading", { name: "Start collaborating" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Pick a space" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Invite collaborators" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Check access" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Share one file" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Choose people" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "1 active link" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Review access" }));
    expect(
      screen.getByRole("heading", { name: "Review access" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "People with access" }),
    );
    expect(
      (await screen.findAllByText("viewer@example.com")).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole("heading", { name: "Invite people" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Space to share")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("People")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Access for editor@example.com" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Expires")).not.toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Access for viewer@example.com" }),
    ).toHaveValue("Viewer");
    await user.click(screen.getByRole("button", { name: "Invite" }));
    await user.click(screen.getByRole("button", { name: "Invite people" }));
    const inviteDialog = getInviteWorkflowPage();
    expect(within(inviteDialog).getByLabelText("Space to share")).toHaveClass(
      "ui-control",
    );
    expect(within(inviteDialog).getByLabelText("People")).toHaveClass(
      "ui-control",
    );
    expect(
      within(inviteDialog).getByRole("combobox", {
        name: "Access for editor@example.com",
      }),
    ).toHaveClass("ui-control");
    await waitFor(() => {
      expect(mocks.listSharesMock).toHaveBeenCalledWith("101", "research-data");
    });
    expect(
      screen.getByText("Workspace member · Direct access"),
    ).toBeInTheDocument();
    expect(screen.getByText("Already invited")).toBeInTheDocument();
    expect(screen.queryByText(/bucket permissions/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/mock|mocked|preview/i)).not.toBeInTheDocument();
  });

  it("shows the collaboration guide only before the first space", async () => {
    mocks.hookResult.workspace.spaces = [];
    mocks.listSharesMock.mockResolvedValue([]);
    mocks.listPublicLinksMock.mockResolvedValue([]);

    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Start collaborating" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Pick a space" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create a space" })).toHaveAttribute(
      "href",
      "/portal/storage-spaces?create=1",
    );
    expect(
      screen.queryByRole("button", { name: "Choose people" }),
    ).not.toBeInTheDocument();
  });

  it("does not repeat the collaboration guide once a space exists", async () => {
    mocks.hookResult.workspace.spaces[0].shareCount = 0;
    mocks.listSharesMock.mockResolvedValue([]);
    mocks.listPublicLinksMock.mockResolvedValue([]);

    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Workspace members" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Start collaborating" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Pick a space" }),
    ).not.toBeInTheDocument();
  });

  it("lets users dismiss the collaboration guide", async () => {
    const user = userEvent.setup();
    mocks.hookResult.workspace.spaces = [];
    mocks.listSharesMock.mockResolvedValue([]);
    mocks.listPublicLinksMock.mockResolvedValue([]);

    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Start collaborating" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dismiss guide" }));

    expect(
      screen.queryByRole("heading", { name: "Start collaborating" }),
    ).not.toBeInTheDocument();
    expect(
      window.localStorage.getItem(
        "portal.collaborators.start-guide.dismissed.101",
      ),
    ).toBe("1");
  });

  it("filters workspace members client-side", async () => {
    const user = userEvent.setup();

    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "Workspace members" }),
    );
    const workspaceMembers = (
      await screen.findByRole("heading", { name: "Workspace members" })
    ).closest("section");
    expect(workspaceMembers).not.toBeNull();
    await user.type(
      within(workspaceMembers!).getByLabelText("Search members"),
      "manager",
    );

    expect(
      within(workspaceMembers!).getByText("Manager User"),
    ).toBeInTheDocument();
    expect(
      within(workspaceMembers!).queryByText("Editor User"),
    ).not.toBeInTheDocument();
    expect(
      within(workspaceMembers!).getByText("1 of 2 members"),
    ).toBeInTheDocument();
  });

  it("preselects the tab and space from the URL context", async () => {
    window.history.pushState(
      {},
      "",
      "/portal/shares?space_id=research-data&tab=by",
    );

    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Review access" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "People with access" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Invite" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Invite people" }),
    );
    expect(screen.getByLabelText("Space to share")).toHaveValue(
      "research-data",
    );
    await waitFor(() => {
      expect(mocks.listShareCandidatesMock).toHaveBeenCalledWith(
        "101",
        "research-data",
      );
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
      role: "Editor",
      direction: "by_me",
      activity_label: "Active",
    });

    renderPage();

    await user.click(await screen.findByRole("button", { name: "Invite" }));
    await user.click(
      await screen.findByRole("button", { name: "Invite people" }),
    );
    const inviteDialog = getInviteWorkflowPage();
    await waitFor(() => {
      expect(
        within(inviteDialog).getAllByText("Editor User").length,
      ).toBeGreaterThan(0);
    });
    const checkboxes = within(inviteDialog).getAllByRole("checkbox");
    await user.click(checkboxes[1]);
    await user.selectOptions(
      within(inviteDialog).getByRole("combobox", {
        name: "Access for editor@example.com",
      }),
      "Editor",
    );
    await user.click(
      within(inviteDialog).getByRole("button", { name: "Invite people" }),
    );

    await waitFor(() => {
      expect(mocks.grantShareMock).toHaveBeenCalledWith(
        "101",
        "research-data",
        {
          user_id: 13,
          role: "Editor",
        },
      );
    });
  });

  it("lets users request an external collaborator when no person matches", async () => {
    const user = userEvent.setup();

    renderPage();

    await user.click(await screen.findByRole("button", { name: "Invite" }));
    await user.click(
      await screen.findByRole("button", { name: "Invite people" }),
    );
    const inviteDialog = getInviteWorkflowPage();
    await user.type(
      await within(inviteDialog).findByPlaceholderText(
        "Search people by name or email...",
      ),
      "missing@example.org",
    );

    expect(
      await screen.findByText("No person matches this search."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    await user.click(
      within(inviteDialog).getByRole("button", {
        name: "Request collaborator access",
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Request collaborator access",
    });
    await user.type(within(dialog).getByLabelText("Name"), "Missing Person");
    expect(within(dialog).getByLabelText("Email")).toHaveValue(
      "missing@example.org",
    );
    await user.click(within(dialog).getByRole("button", { name: "Send request" }));

    await waitFor(() => {
      expect(mocks.createPortalRequestMock).toHaveBeenCalledWith("101", {
        request_type: "portal_user_access",
        target_name: "Missing Person",
        target_email: "missing@example.org",
      });
    });
    expect(
      await screen.findByText(
        "Request sent. Track it in Help requests; an admin will add the collaborator before you can invite them.",
      ),
    ).toBeInTheDocument();
  });

  it("loads collaborator inventory for all active spaces", async () => {
    mocks.hookResult.workspace.spaces = [
      {
        id: "research-data",
        name: "Research Data",
        role: "Manager",
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
        role: "Manager",
        status: "Archived",
        access: "Shared",
        ownerUserId: 7,
        visibility: "shared",
        region: "eu-west-3",
        createdLabel: "May 12, 2023",
        shareCount: 1,
      },
    ];

    renderPage();

    await waitFor(() => {
      expect(mocks.listSharesMock).toHaveBeenCalledTimes(2);
    });
    expect(mocks.listSharesMock).toHaveBeenCalledWith("101", "research-data");
    expect(mocks.listSharesMock).toHaveBeenCalledWith("101", "private-data");
    expect(mocks.listSharesMock).not.toHaveBeenCalledWith(
      "101",
      "archived-data",
    );
  });

  it("keeps private owner spaces outside the team sharing workflow", async () => {
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
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Invite" }));
    expect(await screen.findByText("Only project managers can invite people to active team spaces.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invite people" })).not.toBeInTheDocument();
    expect(mocks.updateStorageSpaceMock).not.toHaveBeenCalled();
    expect(mocks.grantShareMock).not.toHaveBeenCalled();
  });

  it("loads public links from real portal endpoints", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "Review access" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Public links" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Create a public link from a file",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Space for public link")).toHaveValue(
      "research-data",
    );
    expect(screen.getByRole("link", { name: "Open files" })).toHaveAttribute(
      "href",
      "/portal/storage-spaces/research-data#space-files",
    );
    expect(
      screen.getByText(
        "Public links are created from file context so you never have to type a storage path.",
      ),
    ).toBeInTheDocument();
    expect(await screen.findByText("report.csv")).toBeInTheDocument();
    expect(
      screen.getByText("/api/portal/public-links/token/download"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Create a public link" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("path/to/object.ext"),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.listPublicLinksMock).toHaveBeenCalledWith(
        "101",
        "research-data",
        { includeRevoked: true },
      );
    });
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(
      "/api/portal/public-links/token/download",
    );
    expect(await screen.findByText("Link copied.")).toBeInTheDocument();
  });

  it("shows empty states when shares and public links are absent", async () => {
    const user = userEvent.setup();
    mocks.listSharesMock.mockResolvedValue([]);
    mocks.listPublicLinksMock.mockResolvedValue([]);

    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "Review access" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "People with access" }),
    );
    expect(
      await screen.findByText("No collaborators invited yet."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Public links" }));
    expect(await screen.findByText("No public links yet.")).toBeInTheDocument();
  });

  it("explains public-link creation when no owned shared space is available", async () => {
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

    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "Review access" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Public links" }),
    );
    expect(
      await screen.findByText(
        /Only project managers can create public links from active team spaces/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Space for public link"),
    ).not.toBeInTheDocument();
  });

  it("confirms share and public link revocation with target and impacts", async () => {
    const user = userEvent.setup();

    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "Review access" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "People with access" }),
    );
    expect(
      (await screen.findAllByText("viewer@example.com")).length,
    ).toBeGreaterThan(0);
    const reviewedCollaborator = screen
      .getAllByText("viewer@example.com")
      .find((node) => node.closest("table"));
    if (!reviewedCollaborator)
      throw new Error("Expected collaborator in review table");
    expect(reviewedCollaborator.closest("table")).toHaveClass(
      "responsive-data-table",
    );
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    const shareDialog = screen.getByRole("dialog", { name: "Revoke access" });
    expect(
      within(shareDialog).getByText("viewer@example.com"),
    ).toBeInTheDocument();
    expect(
      within(shareDialog).getByText(
        "This person loses access to the space immediately.",
      ),
    ).toBeInTheDocument();
    await user.click(
      within(shareDialog).getByRole("button", { name: "Revoke access" }),
    );

    await waitFor(() => {
      expect(mocks.revokeShareMock).toHaveBeenCalledWith(
        "101",
        "research-data",
        12,
      );
    });

    await user.click(screen.getByRole("button", { name: "Public links" }));
    expect(await screen.findByText("report.csv")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    const linkDialog = screen.getByRole("dialog", {
      name: "Revoke public link",
    });
    expect(within(linkDialog).getByText("report.csv")).toBeInTheDocument();
    expect(
      within(linkDialog).getByText(
        "Anyone using this URL loses access immediately.",
      ),
    ).toBeInTheDocument();
    await user.click(
      within(linkDialog).getByRole("button", { name: "Revoke link" }),
    );

    await waitFor(() => {
      expect(mocks.revokePublicLinkMock).toHaveBeenCalledWith(
        "101",
        "research-data",
        42,
      );
    });
  });
});
