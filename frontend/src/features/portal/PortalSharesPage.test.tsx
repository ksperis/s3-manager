import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PortalSharesPage from "./PortalSharesPage";

const mocks = vi.hoisted(() => ({
  listSharesMock: vi.fn(),
  grantShareMock: vi.fn(),
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
          access: "Private",
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
  listPortalStorageSpaceShares: (...args: unknown[]) => mocks.listSharesMock(...args),
  grantPortalStorageSpaceShare: (...args: unknown[]) => mocks.grantShareMock(...args),
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
  });

  it("loads shares from storage space API with simple roles", async () => {
    const user = userEvent.setup();

    render(<PortalSharesPage />);

    expect(screen.getByRole("heading", { name: "Shares" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Shared by me" }));
    expect(await screen.findByText("viewer@example.com")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Access for viewer@example.com" })).toHaveValue("Viewer");
    await waitFor(() => {
      expect(mocks.listSharesMock).toHaveBeenCalledWith("101", "research-data");
    });
    expect(screen.queryByText(/portal_user/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/bucket permissions/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/mock|mocked|preview/i)).not.toBeInTheDocument();
  });
});
