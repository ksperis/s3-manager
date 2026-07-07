import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { LanguageProvider } from "../../components/language";
import PortalStorageSpacesPage from "./PortalStorageSpacesPage";

const mocks = vi.hoisted(() => ({
  createStorageSpaceMock: vi.fn(),
  importStorageSpaceMock: vi.fn(),
  listShareCandidatesMock: vi.fn(),
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
          role: "Owner",
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
          origin: "portal_generic",
          nameEditable: true,
        },
      ],
      activity: [],
      transfers: [],
      alerts: [],
    },
    state: { account_role: "portal_manager", can_manage_buckets: true, can_create_storage_spaces: true, allow_named_bucket_create: false },
    loading: false,
    accountLoading: false,
    error: null,
    accountError: null,
    hasAccountContext: true,
  },
}));

vi.mock("../../api/portal", async () => {
  const actual = await vi.importActual<typeof import("../../api/portal")>("../../api/portal");
  return {
    ...actual,
    createPortalStorageSpace: (...args: unknown[]) => mocks.createStorageSpaceMock(...args),
    importPortalStorageSpace: (...args: unknown[]) => mocks.importStorageSpaceMock(...args),
    listPortalShareCandidates: (...args: unknown[]) => mocks.listShareCandidatesMock(...args),
  };
});

vi.mock("./usePortalWorkspaceData", () => ({
  usePortalWorkspaceData: (...args: unknown[]) => {
    mocks.usePortalWorkspaceDataMock(...args);
    return mocks.hookResult;
  },
}));

describe("PortalStorageSpacesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usePortalWorkspaceDataMock.mockClear();
    mocks.hookResult.accountIdForApi = "101";
    mocks.createStorageSpaceMock.mockResolvedValue({ id: "created-space" });
    mocks.importStorageSpaceMock.mockResolvedValue({ id: "imported-space" });
    mocks.listShareCandidatesMock.mockResolvedValue([
      {
        user_id: 12,
        email: "viewer@example.com",
        display_name: null,
        account_role: "portal_user",
        access_source: "direct",
        already_shared: false,
      },
    ]);
    mocks.hookResult.workspace.spaces = [
      {
        id: "research-data",
        name: "Research Data",
        internalName: "research-data",
        description: "Research Data shared storage",
        role: "Owner",
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
        origin: "portal_generic",
        nameEditable: true,
      },
    ];
    mocks.hookResult.state = {
      account_role: "portal_manager",
      can_manage_buckets: true,
      can_create_storage_spaces: true,
      allow_named_bucket_create: false,
    };
  });

  it("lists storage spaces and opens the detail route", () => {
    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Storage Spaces" })).toBeInTheDocument();
    expect(mocks.usePortalWorkspaceDataMock).toHaveBeenCalledWith({ includeArchived: true });
    expect(screen.getByLabelText("Search")).toHaveClass("ui-control");
    expect(screen.getByLabelText("Role")).toHaveClass("ui-control");
    expect(screen.getByLabelText("Status")).toHaveClass("ui-control");
    expect(screen.getByLabelText("Sort by")).toHaveClass("ui-control");
    expect(screen.getByText("Research Data")).toBeInTheDocument();
    const researchRow = screen.getByText("Research Data").closest("tr");
    expect(researchRow).not.toBeNull();
    expect(screen.getByText("Research Data").closest("table")).toHaveClass("responsive-data-table");
    expect(within(researchRow!).getByText("Restricted")).toBeInTheDocument();
    expect(within(researchRow!).queryByText("Active")).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Status" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Research Data" })).toHaveAttribute(
      "href",
      "/portal/storage-spaces/research-data"
    );
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      "/portal/storage-spaces/research-data"
    );
    expect(screen.getByRole("link", { name: "Open" }).closest("td")).toHaveAttribute("data-mobile-actions", "true");
    expect(screen.getByRole("button", { name: "Create storage space" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add existing storage" })).toBeInTheDocument();
    expect(screen.queryByText(/mock|mocked|preview/i)).not.toBeInTheDocument();
  });

  it("renders the storage spaces page in French when requested", () => {
    window.localStorage.setItem(
      "user",
      JSON.stringify({
        id: 1,
        email: "laurent@example.com",
        display_name: "Laurent",
        role: "ui_user",
        authType: "password",
        ui_language: "fr",
      })
    );

    render(
      <LanguageProvider>
        <MemoryRouter>
          <PortalStorageSpacesPage />
        </MemoryRouter>
      </LanguageProvider>
    );

    expect(screen.getByRole("heading", { name: "Espaces de stockage" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Créer un espace de stockage" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ouvrir" })).toHaveAttribute(
      "href",
      "/portal/storage-spaces/research-data"
    );
  });

  it("shows distinct states inside the visibility column", () => {
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
      </MemoryRouter>
    );

    const archivedRow = screen.getByText("Archived Data").closest("tr");
    expect(archivedRow).not.toBeNull();
    expect(within(archivedRow!).getByText("Private")).toBeInTheDocument();
    expect(within(archivedRow!).getByText("Archived")).toBeInTheDocument();
  });

  it("shows the named bucket creation mode only when allowed by portal state", () => {
    mocks.hookResult.state = {
      account_role: "portal_manager",
      can_manage_buckets: true,
      can_create_storage_spaces: true,
      allow_named_bucket_create: true,
    };

    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Create storage space" }));

    const namingMode = screen.getByLabelText("Storage Space naming mode");
    expect(namingMode).toHaveClass("ui-control");
    expect(within(namingMode).getByRole("option", { name: "Automatic storage" })).toBeInTheDocument();
    expect(within(namingMode).getByRole("option", { name: "Named storage" })).toBeInTheDocument();
  });

  it("hides the storage naming selector when portal state disables named storage", () => {
    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Create storage space" }));

    expect(screen.queryByLabelText("Storage Space naming mode")).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Generic storage" })).not.toBeInTheDocument();
  });

  it("allows portal users to create Storage Spaces without showing bucket import", () => {
    mocks.hookResult.state = {
      account_role: "portal_user",
      can_manage_buckets: false,
      can_create_storage_spaces: true,
      allow_named_bucket_create: false,
    };

    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>
    );

    expect(screen.getByRole("button", { name: "Create storage space" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add existing storage" })).not.toBeInTheDocument();
  });

  it("forces private visibility when a portal user creates a Storage Space", async () => {
    mocks.hookResult.state = {
      account_role: "portal_user",
      can_manage_buckets: false,
      can_create_storage_spaces: true,
      allow_named_bucket_create: false,
    };

    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Create storage space" }));

    expect(screen.queryByLabelText("Storage Space visibility")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Storage Space name")).toHaveClass("ui-control");
    expect(screen.getByLabelText("Description")).toHaveClass("ui-control");
    fireEvent.change(screen.getByLabelText("Storage Space name"), {
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
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Create storage space" }));

    const access = screen.getByLabelText("Storage Space access");
    expect(within(access).getByRole("option", { name: "Private" })).toBeInTheDocument();
    expect(within(access).getByRole("option", { name: "All" })).toBeInTheDocument();
    expect(within(access).getByRole("option", { name: "Restricted" })).toBeInTheDocument();
  });

  it("creates account-wide Storage Spaces with Editor access by default", async () => {
    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Create storage space" }));
    fireEvent.change(screen.getByLabelText("Storage Space access"), {
      target: { value: "account" },
    });
    fireEvent.change(screen.getByLabelText("Storage Space name"), {
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

  it("creates restricted Storage Spaces atomically with selected initial shares", async () => {
    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Create storage space" }));
    fireEvent.change(screen.getByLabelText("Storage Space access"), {
      target: { value: "restricted" },
    });
    fireEvent.change(screen.getByLabelText("Storage Space name"), {
      target: { value: "Restricted Research" },
    });

    expect((await screen.findAllByText("viewer@example.com")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByRole("combobox", { name: "Access for viewer@example.com" }), {
      target: { value: "Editor" },
    });
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
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Add existing storage" }));
    expect(screen.getByLabelText("Existing storage name")).toHaveClass("ui-control");
    fireEvent.change(screen.getByLabelText("Existing storage name"), {
      target: { value: "existing-research" },
    });
    fireEvent.change(screen.getByLabelText("Imported Storage Space access"), {
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
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Add existing storage" }));
    fireEvent.change(screen.getByLabelText("Existing storage name"), {
      target: { value: "existing-restricted" },
    });
    fireEvent.change(screen.getByLabelText("Imported Storage Space access"), {
      target: { value: "restricted" },
    });

    expect((await screen.findAllByText("viewer@example.com")).length).toBeGreaterThan(0);
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

  it("does not fall back to bucket management when Storage Space creation is absent", () => {
    mocks.hookResult.state = {
      account_role: "portal_manager",
      can_manage_buckets: true,
      allow_named_bucket_create: false,
    };

    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>
    );

    expect(screen.queryByRole("button", { name: "Create storage space" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add existing storage" })).toBeInTheDocument();
  });

  it("hides Storage Space creation when the portal user setting is disabled", () => {
    mocks.hookResult.state = {
      account_role: "portal_user",
      can_manage_buckets: true,
      can_create_storage_spaces: false,
      allow_named_bucket_create: false,
    };

    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>
    );

    expect(screen.queryByRole("button", { name: "Create storage space" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add existing storage" })).not.toBeInTheDocument();
  });

  it("explains the empty state when a portal user has no spaces and cannot create one", () => {
    mocks.hookResult.workspace.spaces = [];
    mocks.hookResult.state = {
      account_role: "portal_user",
      can_manage_buckets: false,
      can_create_storage_spaces: false,
      allow_named_bucket_create: false,
    };

    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>
    );

    expect(screen.getByText(/Ask an administrator to add you to a Storage Space/i)).toBeInTheDocument();
  });

  it("nudges creation from the empty state when creation is available", () => {
    mocks.hookResult.workspace.spaces = [];

    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>
    );

    expect(screen.getByText("No Storage Spaces yet. Create one to start storing files.")).toBeInTheDocument();
  });
});
