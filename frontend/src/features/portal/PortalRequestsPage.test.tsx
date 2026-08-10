import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import PortalRequestsPage from "./PortalRequestsPage";
import type { PortalAdminRequest } from "../../api/portalRequests";

const mocks = vi.hoisted(() => ({
  listPortalRequests: vi.fn(),
  createPortalRequest: vi.fn(),
  fetchPortalUsage: vi.fn(),
  fetchPortalState: vi.fn(),
  fetchPortalCollaborators: vi.fn(),
  usePortalAccountContext: vi.fn(),
}));

vi.mock("./PortalAccountContext", () => ({
  usePortalAccountContext: mocks.usePortalAccountContext,
}));

vi.mock("../../api/portalRequests", () => ({
  listPortalRequests: mocks.listPortalRequests,
  createPortalRequest: mocks.createPortalRequest,
}));

vi.mock("../../api/portal", () => ({
  fetchPortalUsage: mocks.fetchPortalUsage,
  fetchPortalState: mocks.fetchPortalState,
  fetchPortalCollaborators: mocks.fetchPortalCollaborators,
}));

const pendingRequest: PortalAdminRequest = {
  id: 7,
  account_id: 101,
  account_name: "Research Account",
  request_type: "account_quota_change",
  status: "pending",
  payload: {
    direction: "increase",
    target_quota_value: 20,
    target_quota_unit: "GiB",
    reason: "New project",
  },
  requester_user_id: 1,
  requester_email: "requester@example.org",
  created_at: "2026-07-08T10:00:00Z",
  updated_at: "2026-07-08T10:00:00Z",
  messages: [],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/portal/requests"]}>
      <PortalRequestsPage />
    </MemoryRouter>,
  );
}

describe("PortalRequestsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usePortalAccountContext.mockReturnValue({
      accountIdForApi: "101",
      hasAccountContext: true,
      selectedAccount: {
        id: "101",
        name: "Research Account",
        tags: [],
        account_role: "portal_manager",
      },
      loading: false,
      error: null,
    });
    mocks.listPortalRequests.mockResolvedValue([pendingRequest]);
    mocks.createPortalRequest.mockResolvedValue({ ...pendingRequest, id: 8 });
    mocks.fetchPortalState.mockResolvedValue({
      account_role: "portal_manager",
      can_manage_portal_users: true,
    });
    mocks.fetchPortalUsage.mockResolvedValue({
      used_bytes: 16 * 1024 ** 3,
      used_objects: 42,
      quota_max_size_bytes: 20 * 1024 ** 3,
      quota_max_objects: 123,
      storage_spaces: [],
    });
    mocks.fetchPortalCollaborators.mockResolvedValue({
      summary: {
        collaborator_count: 1,
        external_access_key_count: 0,
        trend: null,
      },
      collaborators: [
        {
          user_id: 22,
          email: "old@example.org",
          display_name: "Old User",
          account_role: "portal_user",
          access_source: "direct",
          member_since: "2026-07-01T10:00:00Z",
        },
      ],
    });
  });

  it("separates manager request options from history and submits a collaborator access request from the shared modal", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Help requests" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Request help" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add or remove a collaborator" })).toBeInTheDocument();
    expect(screen.queryByText("Raise to 20 GiB")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "History (1)" }));
    expect(await screen.findByText("Raise to 20 GiB")).toBeInTheDocument();
    expect(screen.getByText("New project")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Request help" }));
    expect(
      screen.queryByRole("heading", { name: "Update project membership" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Manage membership" }));
    const dialog = screen.getByRole("dialog", {
      name: "Update project membership",
    });
    await user.type(within(dialog).getByLabelText("Email"), "jane@example.org");
    await user.type(within(dialog).getByLabelText("Name"), "Jane Viewer");
    await user.click(
      within(dialog).getByRole("button", { name: "Send request" }),
    );

    await waitFor(() => {
      expect(mocks.createPortalRequest).toHaveBeenCalledWith("101", {
        request_type: "portal_user_access",
        target_name: "Jane Viewer",
        target_email: "jane@example.org",
        reason: null,
      });
    });
    expect(await screen.findByText("Raise to 20 GiB")).toBeInTheDocument();
  });

  it("submits a Portal user removal request with the selected collaborator name prefilled", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Help requests" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Manage membership" }));

    const dialog = screen.getByRole("dialog", {
      name: "Update project membership",
    });
    await user.selectOptions(within(dialog).getByLabelText("Action"), "remove");
    await user.selectOptions(within(dialog).getByLabelText("Email"), "old@example.org");
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Old User");
    await user.type(
      within(dialog).getByLabelText("Reason (optional)"),
      "Left the project",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Send removal request" }),
    );

    await waitFor(() => {
      expect(mocks.createPortalRequest).toHaveBeenCalledWith("101", {
        request_type: "portal_user_removal",
        target_name: "Old User",
        target_email: "old@example.org",
        reason: "Left the project",
      });
    });
  });

  it("submits a storage limit change request", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Help requests" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Change limit" }),
    );

    const dialog = screen.getByRole("dialog", {
      name: "Change project storage limit",
    });
    expect(await within(dialog).findByText("Used now")).toBeInTheDocument();
    expect(within(dialog).getByText("Current limit")).toBeInTheDocument();
    await user.selectOptions(
      within(dialog).getByLabelText("Change"),
      "decrease",
    );
    await user.type(within(dialog).getByLabelText("New limit"), "18");
    await user.click(
      within(dialog).getByRole("button", { name: "Send request" }),
    );

    await waitFor(() => {
      expect(mocks.createPortalRequest).toHaveBeenCalledWith("101", {
        request_type: "account_quota_change",
        direction: "decrease",
        target_quota_value: 18,
        target_quota_unit: "GiB",
        reason: null,
      });
    });
  });

  it("blocks storage-limit requests below current usage", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Help requests" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Change limit" }),
    );

    const dialog = screen.getByRole("dialog", {
      name: "Change project storage limit",
    });
    await user.selectOptions(
      within(dialog).getByLabelText("Change"),
      "decrease",
    );
    await user.type(within(dialog).getByLabelText("New limit"), "10");

    expect(
      await within(dialog).findByText(
        "The new limit must stay above the space already used.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Send request" }),
    ).toBeDisabled();
  });

  it("keeps managed request actions unavailable for non-manager Portal users", async () => {
    mocks.fetchPortalState.mockResolvedValue({
      account_role: "portal_user",
      can_manage_portal_users: false,
    });
    mocks.usePortalAccountContext.mockReturnValue({
      accountIdForApi: "101",
      hasAccountContext: true,
      selectedAccount: {
        id: "101",
        name: "Research Account",
        tags: [],
        account_role: "portal_user",
      },
      loading: false,
      error: null,
    });

    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Help requests" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request help" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Add or remove a collaborator" })).not.toBeInTheDocument();
    expect(screen.getByText("Only storage managers can submit collaborator or storage-limit requests for this project.")).toBeInTheDocument();
    expect(mocks.fetchPortalCollaborators).not.toHaveBeenCalled();
  });

  it("uses the authoritative Portal capability when the account summary omits the manager role", async () => {
    mocks.usePortalAccountContext.mockReturnValue({
      accountIdForApi: "101",
      hasAccountContext: true,
      selectedAccount: {
        id: "101",
        name: "Research Account",
        tags: [],
      },
      loading: false,
      error: null,
    });

    renderPage();

    expect(
      await screen.findByRole("tab", { name: "Request help" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Manage membership" }),
    ).toBeEnabled();
  });
});
