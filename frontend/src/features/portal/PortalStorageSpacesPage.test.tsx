import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { LanguageProvider } from "../../components/language";
import PortalStorageSpacesPage from "./PortalStorageSpacesPage";

const mocks = vi.hoisted(() => ({
  hookResult: {
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

vi.mock("./usePortalWorkspaceData", () => ({
  usePortalWorkspaceData: () => mocks.hookResult,
}));

describe("PortalStorageSpacesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(screen.getByText("Research Data")).toBeInTheDocument();
    const researchRow = screen.getByText("Research Data").closest("tr");
    expect(researchRow).not.toBeNull();
    expect(within(researchRow!).getByText("Shared")).toBeInTheDocument();
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
});
