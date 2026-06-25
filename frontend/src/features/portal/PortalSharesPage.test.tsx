import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PortalSharesPage from "./PortalSharesPage";

const mocks = vi.hoisted(() => ({
  createPublicLinkMock: vi.fn(),
  listSharesMock: vi.fn(),
  listPublicLinksMock: vi.fn(),
  grantShareMock: vi.fn(),
  revokePublicLinkMock: vi.fn(),
  updateShareMock: vi.fn(),
  revokeShareMock: vi.fn(),
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
  },
}));

vi.mock("./usePortalWorkspaceData", () => ({
  usePortalWorkspaceData: () => mocks.hookResult,
}));

vi.mock("../../api/portal", () => ({
  createPortalStorageSpacePublicLink: (...args: unknown[]) => mocks.createPublicLinkMock(...args),
  listPortalStorageSpacePublicLinks: (...args: unknown[]) => mocks.listPublicLinksMock(...args),
  listPortalStorageSpaceShares: (...args: unknown[]) => mocks.listSharesMock(...args),
  grantPortalStorageSpaceShare: (...args: unknown[]) => mocks.grantShareMock(...args),
  revokePortalStorageSpacePublicLink: (...args: unknown[]) => mocks.revokePublicLinkMock(...args),
  updatePortalStorageSpaceShare: (...args: unknown[]) => mocks.updateShareMock(...args),
  revokePortalStorageSpaceShare: (...args: unknown[]) => mocks.revokeShareMock(...args),
}));

describe("PortalSharesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    mocks.revokeShareMock.mockResolvedValue(undefined);
    mocks.revokePublicLinkMock.mockResolvedValue([]);
  });

  it("loads shares from storage space API with simple roles", async () => {
    const user = userEvent.setup();

    render(<PortalSharesPage />);

    expect(screen.getByRole("heading", { name: "Shares" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Create a new share" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Shared by me" }));
    expect(await screen.findByText("viewer@example.com")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Create a new share" })).toBeInTheDocument();
    expect(screen.queryByText("Expires")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Access for viewer@example.com" })).toHaveValue("Viewer");
    await waitFor(() => {
      expect(mocks.listSharesMock).toHaveBeenCalledWith("101", "research-data");
    });
    expect(screen.queryByText(/portal_user/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/bucket permissions/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/mock|mocked|preview/i)).not.toBeInTheDocument();
  });

  it("loads public links from real portal endpoints", async () => {
    const user = userEvent.setup();

    render(<PortalSharesPage />);

    await user.click(screen.getByRole("button", { name: "Public links" }));
    expect(await screen.findByText("report.csv")).toBeInTheDocument();
    expect(screen.getByText("/api/portal/public-links/token/download")).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.listPublicLinksMock).toHaveBeenCalledWith("101", "research-data", { includeRevoked: true });
    });
  });

  it("shows empty states when shares and public links are absent", async () => {
    const user = userEvent.setup();
    mocks.listSharesMock.mockResolvedValue([]);
    mocks.listPublicLinksMock.mockResolvedValue([]);

    render(<PortalSharesPage />);

    await user.click(screen.getByRole("button", { name: "Shared by me" }));
    expect(await screen.findByText("No shares to display.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Public links" }));
    expect(await screen.findByText("No public links to display.")).toBeInTheDocument();
  });

  it("confirms share and public link revocation with target and impacts", async () => {
    const user = userEvent.setup();

    render(<PortalSharesPage />);

    await user.click(screen.getByRole("button", { name: "Shared by me" }));
    expect(await screen.findByText("viewer@example.com")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    const shareDialog = screen.getByRole("dialog", { name: "Revoke access" });
    expect(within(shareDialog).getByText("viewer@example.com")).toBeInTheDocument();
    expect(within(shareDialog).getByText("This person loses access to the Storage Space immediately.")).toBeInTheDocument();
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
