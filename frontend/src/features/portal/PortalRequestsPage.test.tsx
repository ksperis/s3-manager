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
    </MemoryRouter>
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

  it("lists requests first and submits a collaborator access request", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole("heading", { name: "Requests" })).toBeInTheDocument();
    expect(screen.getByText("Raise to 20 GiB")).toBeInTheDocument();
    expect(screen.getByText("New project")).toBeInTheDocument();

    const section = screen.getByRole("heading", { name: "Add someone to this project" }).closest("section");
    expect(section).not.toBeNull();
    await user.type(within(section as HTMLElement).getByLabelText("Name"), "Jane Viewer");
    await user.type(within(section as HTMLElement).getByLabelText("Email"), "jane@example.org");
    await user.click(within(section as HTMLElement).getByRole("button", { name: "Send request" }));

    await waitFor(() => {
      expect(mocks.createPortalRequest).toHaveBeenCalledWith("101", {
        request_type: "portal_user_access",
        target_name: "Jane Viewer",
        target_email: "jane@example.org",
      });
    });
  });

  it("submits a Portal user removal request", async () => {
    const user = userEvent.setup();
    renderPage();

    const section = await screen.findByRole("heading", { name: "Remove someone from this project" });
    const removalSection = section.closest("section") as HTMLElement;
    await user.type(within(removalSection).getByLabelText("Email"), "old@example.org");
    await user.type(within(removalSection).getByLabelText("Name (optional)"), "Old User");
    await user.type(within(removalSection).getByLabelText("Reason (optional)"), "Left the project");
    await user.click(within(removalSection).getByRole("button", { name: "Send removal request" }));

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

    const section = await screen.findByRole("heading", { name: "Change project storage limit" });
    const quotaSection = section.closest("section") as HTMLElement;
    expect(await within(quotaSection).findByText("Used now")).toBeInTheDocument();
    expect(within(quotaSection).getByText("Current quota")).toBeInTheDocument();
    await user.selectOptions(within(quotaSection).getByLabelText("Change"), "decrease");
    await user.type(within(quotaSection).getByLabelText("New limit"), "18");
    await user.type(within(quotaSection).getByLabelText("Reason"), "Dataset cleanup");
    await user.click(within(quotaSection).getByRole("button", { name: "Send request" }));

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

  it("blocks quota requests below current usage", async () => {
    const user = userEvent.setup();
    renderPage();

    const section = await screen.findByRole("heading", { name: "Change project storage limit" });
    const quotaSection = section.closest("section") as HTMLElement;
    await user.selectOptions(within(quotaSection).getByLabelText("Change"), "decrease");
    await user.type(within(quotaSection).getByLabelText("New limit"), "10");
    await user.type(within(quotaSection).getByLabelText("Reason"), "Too small");

    expect(await within(quotaSection).findByText("The new limit must stay above the space already used.")).toBeInTheDocument();
    expect(within(quotaSection).getByRole("button", { name: "Send request" })).toBeDisabled();
  });
});
