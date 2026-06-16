import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
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
          access: "Private",
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
    state: { can_manage_buckets: true, allow_named_bucket_create: false },
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
    mocks.hookResult.state = { can_manage_buckets: true, allow_named_bucket_create: false };
  });

  it("lists storage spaces and opens the detail route", () => {
    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Storage Spaces" })).toBeInTheDocument();
    expect(screen.getByText("Research Data")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      "/portal/storage-spaces/research-data"
    );
    expect(screen.getByRole("button", { name: "Create storage space" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import bucket" })).toBeInTheDocument();
    expect(screen.queryByText(/mock|mocked|preview/i)).not.toBeInTheDocument();
  });

  it("shows the named bucket creation mode only when allowed by portal state", () => {
    mocks.hookResult.state = { can_manage_buckets: true, allow_named_bucket_create: true };

    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Create storage space" }));

    const namingMode = screen.getByLabelText("Storage Space naming mode");
    expect(within(namingMode).getByRole("option", { name: "Generic storage" })).toBeInTheDocument();
    expect(within(namingMode).getByRole("option", { name: "Named bucket" })).toBeInTheDocument();
  });

  it("hides the named bucket creation mode when portal state disables it", () => {
    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Create storage space" }));

    const namingMode = screen.getByLabelText("Storage Space naming mode");
    expect(within(namingMode).getByRole("option", { name: "Generic storage" })).toBeInTheDocument();
    expect(within(namingMode).queryByRole("option", { name: "Named bucket" })).not.toBeInTheDocument();
  });
});
