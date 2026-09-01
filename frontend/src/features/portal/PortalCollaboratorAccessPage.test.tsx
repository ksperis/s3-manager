import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";

import PortalCollaboratorAccessPage from "./PortalCollaboratorAccessPage";

const mocks = vi.hoisted(() => ({
  fetchReview: vi.fn(),
  revokeShare: vi.fn(),
  createRequest: vi.fn(),
  accountContext: {
    accountIdForApi: "101",
    hasAccountContext: true,
    loading: false,
    error: null,
  },
}));

vi.mock("../../api/portal", () => ({
  fetchPortalCollaboratorAccessReview: (...args: unknown[]) => mocks.fetchReview(...args),
  revokePortalStorageSpaceShare: (...args: unknown[]) => mocks.revokeShare(...args),
}));

vi.mock("../../api/portalRequests", () => ({
  createPortalRequest: (...args: unknown[]) => mocks.createRequest(...args),
}));

vi.mock("./PortalAccountContext", () => ({
  usePortalAccountContext: () => mocks.accountContext,
}));

const review = {
  collaborator: {
    user_id: 13,
    email: "editor@example.com",
    display_name: "Editor User",
    portal_role: "portal_user",
    access_source: "direct" as const,
    member_since: "2026-06-01T10:00:00Z",
    can_review_access: true,
    avatar: {
      preference: "initials",
      source: "initials",
      url: null,
      initials: "EU",
    },
  },
  can_request_project_removal: true,
  space_accesses: [
    {
      storage_space_id: "direct-space",
      storage_space_name: "Direct Space",
      role: "Editor" as const,
      source: "direct" as const,
      can_revoke: true,
    },
    {
      storage_space_id: "team-space",
      storage_space_name: "Team Space",
      role: "Viewer" as const,
      source: "team" as const,
      can_revoke: false,
    },
    {
      storage_space_id: "owned-space",
      storage_space_name: "Owned Space",
      role: "Owner" as const,
      source: "owner" as const,
      can_revoke: false,
    },
    {
      storage_space_id: "managed-space",
      storage_space_name: "Managed Space",
      role: "Manager" as const,
      source: "project_manager" as const,
      can_revoke: false,
    },
  ],
};

function renderPage(userId = "13") {
  return render(
    <MemoryRouter initialEntries={[`/portal/shares/${userId}`]}>
      <Routes>
        <Route path="/portal/shares/:userId" element={<PortalCollaboratorAccessPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PortalCollaboratorAccessPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchReview.mockResolvedValue(structuredClone(review));
    mocks.revokeShare.mockResolvedValue([]);
    mocks.createRequest.mockResolvedValue({ id: 73, status: "pending" });
  });

  it("shows identity, effective roles, sources, and only eligible revoke actions", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Editor User" })).toBeInTheDocument();
    expect(mocks.fetchReview).toHaveBeenCalledWith("101", 13);
    expect(screen.getByText("Workspace member")).toBeInTheDocument();
    expect(screen.getByText("Direct access", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("Project team")).toBeInTheDocument();
    expect(screen.getByText("Ownership")).toBeInTheDocument();
    expect(screen.getByText("Manager role")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Remove access" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Back to members" })).toHaveAttribute("href", "/portal/shares");
  });

  it("confirms and removes a direct restricted access", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Remove access" }));
    const dialog = screen.getByRole("dialog", { name: "Remove direct access" });
    expect(within(dialog).getByText("Direct Space")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Remove access" }));

    await waitFor(() => expect(mocks.revokeShare).toHaveBeenCalledWith("101", "direct-space", 13));
    expect(await screen.findByText("Access to Direct Space was removed.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Direct Space" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Team Space" })).toBeInTheDocument();
  });

  it("moves the project removal request into the access review", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Request project removal" }));
    const dialog = screen.getByRole("dialog", { name: "Request project removal" });
    await user.click(within(dialog).getByRole("button", { name: "Send request" }));

    await waitFor(() =>
      expect(mocks.createRequest).toHaveBeenCalledWith("101", {
        request_type: "portal_user_removal",
        target_name: "Editor User",
        target_email: "editor@example.com",
        reason: null,
      }),
    );
    expect(await screen.findByText("Project removal request sent. Track it in Help requests.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request project removal" })).not.toBeInTheDocument();
  });

  it("renders the empty state", async () => {
    mocks.fetchReview.mockResolvedValue({ ...structuredClone(review), space_accesses: [] });
    renderPage();

    expect(
      await screen.findByText("This collaborator has no access to an active Storage Space."),
    ).toBeInTheDocument();
  });

  it("renders a dedicated denied state", async () => {
    mocks.fetchReview.mockRejectedValue(new ApiError("Access denied", {
      response: { status: 403, data: { detail: "Reviewing this collaborator is not allowed." }, headers: {} },
    }));
    renderPage();

    expect(
      await screen.findAllByText("You are not allowed to review this collaborator's access."),
    ).not.toHaveLength(0);
  });

  it("rejects invalid collaborator identifiers without calling the API", async () => {
    renderPage("invalid");

    expect(await screen.findAllByText("This collaborator could not be found.")).not.toHaveLength(0);
    expect(mocks.fetchReview).not.toHaveBeenCalled();
  });
});
