import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import AdminPortalRequestsPage from "./AdminPortalRequestsPage";
import type { PortalAdminRequest } from "../../api/portalRequests";

const mocks = vi.hoisted(() => ({
  listMinimalS3Accounts: vi.fn(),
  listMinimalUsers: vi.fn(),
  listAdminPortalRequests: vi.fn(),
  approveAdminPortalRequest: vi.fn(),
  rejectAdminPortalRequest: vi.fn(),
  addAdminPortalRequestMessage: vi.fn(),
}));

vi.mock("../../api/accounts", () => ({
  listMinimalS3Accounts: mocks.listMinimalS3Accounts,
}));

vi.mock("../../api/users", () => ({
  listMinimalUsers: mocks.listMinimalUsers,
}));

vi.mock("../../api/portalRequests", () => ({
  listAdminPortalRequests: mocks.listAdminPortalRequests,
  approveAdminPortalRequest: mocks.approveAdminPortalRequest,
  rejectAdminPortalRequest: mocks.rejectAdminPortalRequest,
  addAdminPortalRequestMessage: mocks.addAdminPortalRequestMessage,
}));

const pendingRequest: PortalAdminRequest = {
  id: 7,
  account_id: 101,
  account_name: "Research Account",
  request_type: "portal_user_access",
  status: "pending",
  payload: {
    target_name: "Jane Viewer",
    target_email: "jane@example.org",
  },
  requester_user_id: 1,
  requester_email: "requester@example.org",
  created_at: "2026-07-08T10:00:00Z",
  updated_at: "2026-07-08T10:00:00Z",
  messages: [],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/portal-requests"]}>
      <AdminPortalRequestsPage />
    </MemoryRouter>
  );
}

describe("AdminPortalRequestsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listMinimalS3Accounts.mockResolvedValue([
      { id: 101, name: "Research Account", rgw_account_id: "RGW-RESEARCH", tags: [] },
    ]);
    mocks.listMinimalUsers.mockResolvedValue([
      {
        id: 1,
        email: "requester@example.org",
        display_name: "Request Owner",
        role: "ui_user",
        avatar: { preference: "initials", source: "initials", initials: "RO" },
      },
    ]);
    mocks.listAdminPortalRequests.mockResolvedValue([pendingRequest]);
    mocks.approveAdminPortalRequest.mockResolvedValue({
      ...pendingRequest,
      status: "approved",
      messages: [
        {
          id: 1,
          author_email: "admin@example.org",
          author_role: "ui_admin",
          message: "Approved",
          created_at: "2026-07-08T10:10:00Z",
        },
      ],
    });
    mocks.rejectAdminPortalRequest.mockResolvedValue({ ...pendingRequest, status: "rejected" });
    mocks.addAdminPortalRequestMessage.mockResolvedValue({
      ...pendingRequest,
      messages: [
        {
          id: 2,
          author_email: "admin@example.org",
          author_role: "ui_admin",
          message: "Need more context",
          created_at: "2026-07-08T10:05:00Z",
        },
      ],
    });
  });

  it("loads pending requests and approves with a message", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole("heading", { name: "Portal requests" })).toBeInTheDocument();
    expect(await screen.findByText("Jane Viewer <jane@example.org>")).toBeInTheDocument();
    const requesterBadge = await screen.findByRole("link", { name: "Edit UI user Request Owner" });
    expect(requesterBadge).toHaveAttribute(
      "href",
      "/admin/users?edit=1&search=requester%40example.org",
    );
    expect(screen.getByLabelText("requester@example.org, role User")).toHaveAccessibleDescription(
      "Requester (1)\nRequest Owner · requester@example.org — Roles: User",
    );
    expect(mocks.listAdminPortalRequests).toHaveBeenCalledWith({
      status: "pending",
      request_type: "all",
      account_id: "all",
      search: "",
      limit: 200,
    });

    await user.click(screen.getByRole("button", { name: "Details" }));
    await user.type(screen.getByLabelText("Message"), "Approved");
    await user.click(screen.getAllByRole("button", { name: "Approve" }).at(-1) as HTMLElement);

    await waitFor(() => {
      expect(mocks.approveAdminPortalRequest).toHaveBeenCalledWith(7, { message: "Approved" });
    });
    expect(await screen.findByText("Request updated.")).toBeInTheDocument();
  });

  it("sends an admin message from the detail panel", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Jane Viewer <jane@example.org>");
    await user.click(screen.getByRole("button", { name: "Details" }));
    await user.type(screen.getByLabelText("Message"), "Need more context");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(mocks.addAdminPortalRequestMessage).toHaveBeenCalledWith(7, { message: "Need more context" });
    });
  });
});
