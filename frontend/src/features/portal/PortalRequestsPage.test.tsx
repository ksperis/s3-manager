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
}));

vi.mock("./PortalAccountContext", () => ({
  usePortalAccountContext: () => ({
    accountIdForApi: "101",
    hasAccountContext: true,
    loading: false,
    error: null,
  }),
}));

vi.mock("../../api/portalRequests", () => ({
  listPortalRequests: mocks.listPortalRequests,
  createPortalRequest: mocks.createPortalRequest,
}));

vi.mock("../../api/portal", () => ({
  fetchPortalUsage: mocks.fetchPortalUsage,
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
    mocks.listPortalRequests.mockResolvedValue([pendingRequest]);
    mocks.createPortalRequest.mockResolvedValue({ ...pendingRequest, id: 8 });
    mocks.fetchPortalUsage.mockResolvedValue({
      used_bytes: 16 * 1024 ** 3,
      used_objects: 42,
      quota_max_size_bytes: 20 * 1024 ** 3,
      quota_max_objects: 123,
      storage_spaces: [],
    });
  });

  it("separates request options from history and submits a collaborator access request from a modal", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Help requests" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request help" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add a collaborator" })).toBeInTheDocument();
    expect(screen.queryByText("Raise to 20 GiB")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "History (1)" }));
    expect(await screen.findByText("Raise to 20 GiB")).toBeInTheDocument();
    expect(screen.getByText("New project")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Request help" }));
    expect(
      screen.queryByRole("heading", { name: "Add someone to this project" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add someone" }));
    const dialog = screen.getByRole("dialog", {
      name: "Add someone to this project",
    });
    await user.type(within(dialog).getByLabelText("Name"), "Jane Viewer");
    await user.type(within(dialog).getByLabelText("Email"), "jane@example.org");
    await user.click(
      within(dialog).getByRole("button", { name: "Send request" }),
    );

    await waitFor(() => {
      expect(mocks.createPortalRequest).toHaveBeenCalledWith("101", {
        request_type: "portal_user_access",
        target_name: "Jane Viewer",
        target_email: "jane@example.org",
      });
    });
    expect(await screen.findByText("Raise to 20 GiB")).toBeInTheDocument();
  });

  it("submits a Portal user removal request", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Help requests" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove someone" }));

    const dialog = screen.getByRole("dialog", {
      name: "Remove someone from this project",
    });
    await user.type(within(dialog).getByLabelText("Email"), "old@example.org");
    await user.type(
      within(dialog).getByLabelText("Name (optional)"),
      "Old User",
    );
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
    await user.type(within(dialog).getByLabelText("Reason"), "Dataset cleanup");
    await user.click(
      within(dialog).getByRole("button", { name: "Send request" }),
    );

    await waitFor(() => {
      expect(mocks.createPortalRequest).toHaveBeenCalledWith("101", {
        request_type: "account_quota_change",
        direction: "decrease",
        target_quota_value: 18,
        target_quota_unit: "GiB",
        reason: "Dataset cleanup",
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
    await user.type(within(dialog).getByLabelText("Reason"), "Too small");

    expect(
      await within(dialog).findByText(
        "The new limit must stay above the space already used.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Send request" }),
    ).toBeDisabled();
  });
});
