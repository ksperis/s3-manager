import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { LanguageProvider } from "../../components/language";
import { tableActionButtonClasses } from "../../components/tableActionClasses";
import PortalStorageSpacesPage from "./PortalStorageSpacesPage";
import { setSessionUserCache } from "../../utils/workspaces";

const mocks = vi.hoisted(() => ({
  createStorageSpaceMock: vi.fn(),
  importStorageSpaceMock: vi.fn(),
  listShareCandidatesMock: vi.fn(),
  refreshWorkspaceDataMock: vi.fn(),
  usePortalWorkspaceDataMock: vi.fn(),
  hookResult: {
    accountIdForApi: "101",
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
          internalName: "research-data",
          description: "Research Data shared storage",
          role: "Manager",
          status: "Active",
          access: "Shared",
          ownerUserId: 7,
          visibility: "shared",
          shareScope: "restricted",
          accountMemberRole: null,
          region: "eu-west-3",
          createdLabel: "May 10, 2023",
          usedBytes: 512,
          quotaBytes: 1024,
          objectCount: 12,
          createdAt: "2026-03-10T10:00:00Z",
          shareCount: 3,
          collaborators: [
            {
              user_id: 7,
              email: "owner@example.com",
              display_name: "Owner Example",
              role: "Owner",
              avatar: {
                preference: "initials",
                source: "initials",
                url: null,
                initials: "OE",
                updated_at: null,
              },
            },
          ],
          collaboratorCount: 1,
          origin: "portal_generic",
          nameEditable: true,
          icon: { source: "preset", preset: "archive" },
        },
      ],
      activity: [],
      alerts: [],
    },
    state: {
      portal_role: "portal_manager",
      can_manage_buckets: true,
      can_create_private_storage_spaces: true,
      can_create_team_storage_spaces: true,
      allow_named_bucket_create: false,
    },
    loading: false,
    accountLoading: false,
    error: null,
    accountError: null,
    hasAccountContext: true,
    refreshWorkspaceData: vi.fn(),
  },
}));

vi.mock("../../api/portal", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/portal")>(
      "../../api/portal",
    );
  return {
    ...actual,
    createPortalStorageSpace: (...args: unknown[]) =>
      mocks.createStorageSpaceMock(...args),
    importPortalStorageSpace: (...args: unknown[]) =>
      mocks.importStorageSpaceMock(...args),
  };
});

vi.mock("../../api/portalSharing", () => ({
  listPortalShareCandidates: (...args: unknown[]) =>
    mocks.listShareCandidatesMock(...args),
}));

vi.mock("./usePortalWorkspaceData", () => ({
  usePortalWorkspaceData: (...args: unknown[]) => {
    mocks.usePortalWorkspaceDataMock(...args);
    return mocks.hookResult;
  },
}));

describe("PortalStorageSpacesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSessionUserCache(null);
    window.localStorage.clear();
    mocks.usePortalWorkspaceDataMock.mockClear();
    mocks.hookResult.accountIdForApi = "101";
    mocks.createStorageSpaceMock.mockResolvedValue({ id: "created-space" });
    mocks.importStorageSpaceMock.mockResolvedValue({ id: "imported-space" });
    mocks.listShareCandidatesMock.mockResolvedValue([
      {
        user_id: 12,
        email: "viewer@example.com",
        display_name: null,
        portal_role: "portal_user",
        access_source: "direct",
        already_shared: false,
      },
    ]);
    mocks.hookResult.refreshWorkspaceData = mocks.refreshWorkspaceDataMock;
    mocks.hookResult.workspace.spaces = [
      {
        id: "research-data",
        name: "Research Data",
        internalName: "research-data",
        description: "Research Data shared storage",
        role: "Manager",
        status: "Active",
        access: "Shared",
        ownerUserId: 7,
        visibility: "shared",
        shareScope: "restricted",
        accountMemberRole: null,
        region: "eu-west-3",
        createdLabel: "May 10, 2023",
        usedBytes: 512,
        quotaBytes: 1024,
        objectCount: 12,
        createdAt: "2026-03-10T10:00:00Z",
        shareCount: 3,
        collaborators: [
          {
            user_id: 7,
            email: "owner@example.com",
            display_name: "Owner Example",
            role: "Owner",
            avatar: {
              preference: "initials",
              source: "initials",
              url: null,
              initials: "OE",
              updated_at: null,
            },
          },
        ],
        collaboratorCount: 1,
        origin: "portal_generic",
        nameEditable: true,
        icon: { source: "preset", preset: "archive" },
      },
    ];
    mocks.hookResult.state = {
      portal_role: "portal_manager",
      can_manage_buckets: true,
      can_create_private_storage_spaces: true,
      can_create_team_storage_spaces: true,
      allow_named_bucket_create: false,
    };
  });

  it("lists spaces and opens the detail route", () => {
    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>,
    );

    const pageHeading = screen.getByRole("heading", { name: "Spaces" });
    expect(pageHeading).toBeInTheDocument();
    expect(pageHeading.closest("header")?.parentElement).toHaveClass("space-y-4");
    expect(
      screen.getByRole("tab", { name: "Active spaces (1)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Archived (0)" }),
    ).toBeInTheDocument();
    expect(mocks.usePortalWorkspaceDataMock).toHaveBeenCalledWith({
      includeArchived: true,
      includeUsage: true,
    });
    expect(document.querySelector('[data-storage-space-icon-preset="archive"]')).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Create a space" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "Create, fill, and share a space",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Upload files" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Invite people" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Share a file" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Start a new space" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open files" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Invite people" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Choose file" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Search")).toHaveClass("ui-control");
    expect(screen.getByLabelText("My role")).toHaveClass("ui-control");
    expect(screen.getByLabelText("Status")).toHaveClass("ui-control");
    expect(screen.getByLabelText("Sort by")).toHaveClass("ui-control");
    expect(screen.getByText("Research Data")).toBeInTheDocument();
    const researchRow = screen.getByText("Research Data").closest("tr");
    expect(researchRow).not.toBeNull();
    expect(within(researchRow!).getByText("12")).toBeInTheDocument();
    expect(within(researchRow!).getByText("512 B")).toBeInTheDocument();
    const storageSpaceIcon = researchRow!.querySelector(
      '[data-storage-space-icon-preset="archive"]',
    );
    expect(storageSpaceIcon).not.toBeNull();
    expect(storageSpaceIcon).toHaveClass("h-7", "w-7");
    expect(screen.getByText("Research Data").closest("table")).toHaveClass(
      "responsive-data-table",
    );
    expect(
      within(researchRow!).queryByText("Selected people"),
    ).not.toBeInTheDocument();
    expect(within(researchRow!).getByTitle("Owner Example")).toHaveTextContent(
      "OE",
    );
    expect(within(researchRow!).queryByText("Active")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "Status" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Research Data" })).not.toBeInTheDocument();
    const openLink = screen.getByRole("link", { name: "Open" });
    expect(openLink).toHaveAttribute(
      "href",
      "/portal/storage-spaces/research-data",
    );
    expect(openLink).toHaveAttribute("class", tableActionButtonClasses);
    expect(
      openLink.closest("td"),
    ).toHaveAttribute("data-mobile-actions", "true");
    expect(
      screen.getByRole("button", { name: "Create space" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add existing space" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/mock|mocked|preview/i)).not.toBeInTheDocument();
  });

  it("opens a space when a neutral row cell is clicked", () => {
    render(
      <MemoryRouter initialEntries={["/portal/storage-spaces"]}>
        <Routes>
          <Route path="/portal/storage-spaces" element={<PortalStorageSpacesPage />} />
          <Route
            path="/portal/storage-spaces/:spaceId"
            element={<div>Storage space detail route</div>}
          />
        </Routes>
      </MemoryRouter>,
    );

    const researchRow = screen.getByText("Research Data").closest("tr");
    expect(researchRow).not.toBeNull();

    fireEvent.click(within(researchRow!).getByText("12"));

    expect(screen.getByText("Storage space detail route")).toBeInTheDocument();
  });

  it("shows only the team badge for account-wide spaces", () => {
    mocks.hookResult.workspace.spaces = [
      {
        ...mocks.hookResult.workspace.spaces[0],
        shareScope: "account",
        accountMemberRole: "Editor",
        collaborators: [],
        collaboratorCount: 0,
      },
    ];

    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Team")).toBeInTheDocument();
    expect(screen.queryByText("All team members")).not.toBeInTheDocument();
    expect(screen.queryByText("No collaborators")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Owner Example")).not.toBeInTheDocument();
  });

  it("shows only the private badge for private spaces", () => {
    mocks.hookResult.workspace.spaces = [
      {
        ...mocks.hookResult.workspace.spaces[0],
        visibility: "private",
        shareScope: "restricted",
      },
    ];

    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Private")).toBeInTheDocument();
    expect(screen.queryByText("Selected people")).not.toBeInTheDocument();
    expect(screen.queryByText("No collaborators")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Owner Example")).not.toBeInTheDocument();
  });

  it("shows the start guide only before the first space and lets users dismiss it", async () => {
    const user = userEvent.setup();
    mocks.hookResult.workspace.spaces = [];

    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: "Create, fill, and share a space" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start a new space" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dismiss guide" }));

    expect(
      screen.queryByRole("heading", {
        name: "Create, fill, and share a space",
      }),
    ).not.toBeInTheDocument();
    expect(
      window.localStorage.getItem(
        "portal.storage-spaces.start-guide.dismissed.101",
      ),
    ).toBe("1");
  });

  it("opens the create form from the dashboard create query when creation is available", () => {
    render(
      <MemoryRouter initialEntries={["/portal/storage-spaces?create=1"]}>
        <PortalStorageSpacesPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: "Create a space" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Space name")).toHaveClass("ui-control");
    expect(screen.getByRole("dialog", { name: "Create a space" })).toBeInTheDocument();
  });

  it("closes an untouched create modal and protects edited values", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>,
    );

    const createTrigger = screen.getByRole("button", { name: "Create space" });
    await user.click(createTrigger);
    expect(screen.getByRole("dialog", { name: "Create a space" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Create a space" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Discard changes?" })).not.toBeInTheDocument();
    await waitFor(() => expect(createTrigger).toHaveFocus());

    await user.click(createTrigger);
    await user.type(screen.getByLabelText("Space name"), "Research");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.queryByRole("dialog", { name: "Create a space" })).not.toBeInTheDocument();
    await waitFor(() => expect(createTrigger).toHaveFocus());
  });

  it("renders import as a guarded modal", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>,
    );

    const importTrigger = screen.getByRole("button", { name: "Add existing space" });
    await user.click(importTrigger);
    expect(screen.getByRole("dialog", { name: "Add existing space" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Existing technical ID"), "existing-space");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(importTrigger).toHaveFocus());
  });

  it("ignores the dashboard create query when creation is unavailable", () => {
    mocks.hookResult.state = {
      portal_role: "portal_user",
      can_manage_buckets: false,
      can_create_private_storage_spaces: false,
      can_create_team_storage_spaces: false,
      allow_named_bucket_create: false,
    };

    render(
      <MemoryRouter initialEntries={["/portal/storage-spaces?create=1"]}>
        <PortalStorageSpacesPage />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("heading", { name: "Create a space" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Space name")).not.toBeInTheDocument();
  });

  it("renders the storage spaces page and its close guard in French when requested", async () => {
    const user = userEvent.setup();
    setSessionUserCache({
      id: 1,
      email: "laurent@example.com",
      display_name: "Laurent",
      role: "ui_user",
      authType: "password",
      ui_language: "fr",
    });

    render(
      <LanguageProvider>
        <MemoryRouter>
          <PortalStorageSpacesPage />
        </MemoryRouter>
      </LanguageProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Espaces" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Créer un espace" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ouvrir" })).toHaveAttribute(
      "href",
      "/portal/storage-spaces/research-data",
    );
    await user.click(screen.getByRole("button", { name: "Créer un espace" }));
    await user.type(screen.getByLabelText("Nom de l'espace"), "Projet");
    await user.click(screen.getByRole("button", { name: "Annuler" }));
    expect(
      screen.getByRole("dialog", { name: "Abandonner les modifications ?" }),
    ).toBeInTheDocument();
  });

  it("keeps archived spaces in a separate tab", async () => {
    const user = userEvent.setup();
    mocks.hookResult.workspace.spaces = [
      {
        ...mocks.hookResult.workspace.spaces[0],
        id: "active-data",
        name: "Active Data",
        status: "Active",
      },
      {
        ...mocks.hookResult.workspace.spaces[0],
        id: "archived-data",
        name: "Archived Data",
        visibility: "private",
        status: "Archived",
      },
    ];

    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Active Data")).toBeInTheDocument();
    expect(screen.queryByText("Archived Data")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Archived (1)" }));

    expect(screen.queryByText("Active Data")).not.toBeInTheDocument();
    const archivedRow = screen.getByText("Archived Data").closest("tr");
    expect(archivedRow).not.toBeNull();
    expect(within(archivedRow!).getByText("Private")).toBeInTheDocument();
    expect(within(archivedRow!).getByText("Archived")).toBeInTheDocument();
    expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
  });

  it("does not repeat the start guide once only archived spaces exist", () => {
    mocks.hookResult.workspace.spaces = [
      {
        ...mocks.hookResult.workspace.spaces[0],
        id: "archived-data",
        name: "Archived Data",
        visibility: "private",
        status: "Archived",
      },
    ];

    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("heading", {
        name: "Create, fill, and share a space",
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("No spaces yet. Create one to start storing files.")).toBeInTheDocument();
  });

  it("shows the named bucket creation mode only when allowed by portal state", () => {
    mocks.hookResult.state = {
      portal_role: "portal_manager",
      can_manage_buckets: true,
      can_create_private_storage_spaces: true,
      can_create_team_storage_spaces: true,
      allow_named_bucket_create: true,
    };

    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create space" }));

    const namingMode = screen.getByLabelText("Space setup");
    expect(namingMode).toHaveClass("ui-control");
    expect(
      within(namingMode).getByRole("option", { name: "Let Portal choose the ID" }),
    ).toBeInTheDocument();
    expect(
      within(namingMode).getByRole("option", { name: "Use a custom tool ID" }),
    ).toBeInTheDocument();
  });

  it("hides the storage naming selector when portal state disables named storage", () => {
    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create space" }));

    expect(screen.queryByLabelText("Space setup")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Let Portal choose the ID" }),
    ).not.toBeInTheDocument();
  });

  it("allows portal users to create spaces without showing bucket import", () => {
    mocks.hookResult.state = {
      portal_role: "portal_user",
      can_manage_buckets: false,
      can_create_private_storage_spaces: true,
      can_create_team_storage_spaces: false,
      allow_named_bucket_create: false,
    };

    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("button", { name: "Create space" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add existing space" }),
    ).not.toBeInTheDocument();
  });

  it("forces private visibility when a portal user creates a space", async () => {
    mocks.hookResult.state = {
      portal_role: "portal_user",
      can_manage_buckets: false,
      can_create_private_storage_spaces: true,
      can_create_team_storage_spaces: false,
      allow_named_bucket_create: false,
    };

    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create space" }));

    expect(
      screen.queryByLabelText("Who can access this space?"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Space name")).toHaveClass("ui-control");
    expect(screen.getByLabelText("Description")).toHaveClass("ui-control");
    fireEvent.change(screen.getByLabelText("Space name"), {
      target: { value: "Private Research" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(mocks.createStorageSpaceMock).toHaveBeenCalledWith("101", {
        name: "Private Research",
        naming_mode: "generic_uuid",
        description: null,
        visibility: "private",
        share_scope: "restricted",
        account_member_role: null,
        initial_shares: [],
      });
    });
  });

  it("keeps private, account-wide, and restricted access choices for portal managers", () => {
    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create space" }));

    const access = screen.getByLabelText("Who can access this space?");
    expect(
      within(access).getByRole("option", { name: "Private" }),
    ).toBeInTheDocument();
    expect(
      within(access).getByRole("option", { name: "Team" }),
    ).toBeInTheDocument();
    expect(
      within(access).getByRole("option", { name: "Selected people" }),
    ).toBeInTheDocument();
  });

  it("creates account-wide spaces with Editor access by default", async () => {
    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create space" }));
    fireEvent.change(screen.getByLabelText("Who can access this space?"), {
      target: { value: "account" },
    });
    fireEvent.change(screen.getByLabelText("Space name"), {
      target: { value: "Team Research" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(mocks.createStorageSpaceMock).toHaveBeenCalledWith("101", {
        name: "Team Research",
        naming_mode: "generic_uuid",
        description: null,
        visibility: "shared",
        share_scope: "account",
        account_member_role: "Editor",
        initial_shares: [],
      });
    });
  });

  it("creates restricted spaces atomically with selected initial collaborators", async () => {
    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create space" }));
    fireEvent.change(screen.getByLabelText("Who can access this space?"), {
      target: { value: "restricted" },
    });
    fireEvent.change(screen.getByLabelText("Space name"), {
      target: { value: "Restricted Research" },
    });

    expect(
      (await screen.findAllByText("viewer@example.com")).length,
    ).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(
      screen.getByRole("combobox", { name: "Access for viewer@example.com" }),
      {
        target: { value: "Editor" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(mocks.createStorageSpaceMock).toHaveBeenCalledWith("101", {
        name: "Restricted Research",
        naming_mode: "generic_uuid",
        description: null,
        visibility: "shared",
        share_scope: "restricted",
        account_member_role: null,
        initial_shares: [{ user_id: 12, role: "Editor" }],
      });
    });
  });

  it("imports existing storage with account-wide access when selected", async () => {
    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add existing space" }));
    expect(screen.getByLabelText("Existing technical ID")).toHaveClass(
      "ui-control",
    );
    fireEvent.change(screen.getByLabelText("Existing technical ID"), {
      target: { value: "existing-research" },
    });
    fireEvent.change(screen.getByLabelText("Who can access this space?"), {
      target: { value: "account" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(mocks.importStorageSpaceMock).toHaveBeenCalledWith("101", {
        bucket_name: "existing-research",
        description: null,
        visibility: "shared",
        share_scope: "account",
        account_member_role: "Editor",
        initial_shares: [],
      });
    });
  });

  it("imports restricted storage with selected initial shares", async () => {
    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add existing space" }));
    fireEvent.change(screen.getByLabelText("Existing technical ID"), {
      target: { value: "existing-restricted" },
    });
    fireEvent.change(screen.getByLabelText("Who can access this space?"), {
      target: { value: "restricted" },
    });

    expect(
      (await screen.findAllByText("viewer@example.com")).length,
    ).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(mocks.importStorageSpaceMock).toHaveBeenCalledWith("101", {
        bucket_name: "existing-restricted",
        description: null,
        visibility: "shared",
        share_scope: "restricted",
        account_member_role: null,
        initial_shares: [{ user_id: 12, role: "Viewer" }],
      });
    });
  });

  it("does not fall back to bucket management when space creation is absent", () => {
    mocks.hookResult.state = {
      portal_role: "portal_manager",
      can_manage_buckets: true,
      allow_named_bucket_create: false,
    };

    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("button", { name: "Create space" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add existing space" }),
    ).toBeInTheDocument();
  });

  it("does not expose Storage Space icon configuration from the list", () => {
    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("button", { name: "Icon" })).not.toBeInTheDocument();
  });

  it("hides space creation when the portal user setting is disabled", () => {
    mocks.hookResult.state = {
      portal_role: "portal_user",
      can_manage_buckets: true,
      can_create_private_storage_spaces: false,
      can_create_team_storage_spaces: false,
      allow_named_bucket_create: false,
    };

    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("button", { name: "Create space" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add existing space" }),
    ).not.toBeInTheDocument();
  });

  it("explains the empty state when a portal user has no spaces and cannot create one", () => {
    mocks.hookResult.workspace.spaces = [];
    mocks.hookResult.state = {
      portal_role: "portal_user",
      can_manage_buckets: false,
      can_create_private_storage_spaces: false,
      can_create_team_storage_spaces: false,
      allow_named_bucket_create: false,
    };

    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(/Ask an administrator to add you to a space/i),
    ).toBeInTheDocument();
  });

  it("nudges creation from the empty state when creation is available", () => {
    mocks.hookResult.workspace.spaces = [];

    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByText("No spaces yet. Create one to start storing files."),
    ).toBeInTheDocument();
  });
});
