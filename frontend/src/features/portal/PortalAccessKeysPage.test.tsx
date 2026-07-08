import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import PortalAccessKeysPage from "./PortalAccessKeysPage";
import type { PortalAccessKeysState } from "../../api/portal";

const mocks = vi.hoisted(() => ({
  state: {
    iam_user: { iam_username: "portal-101-7" },
    s3_endpoint: "https://s3.example.test",
    can_manage_access_keys: true,
    max_access_keys: 2,
    access_keys: [
      { access_key_id: "AK-PORTAL", status: "Active", is_active: true, is_portal: true },
      { access_key_id: "AK-USER", status: "Active", created_at: "2026-06-10T10:00:00Z", is_active: true },
    ],
  } as PortalAccessKeysState,
  fetchPortalAccessKeysState: vi.fn(),
  listPortalStorageSpaces: vi.fn(),
  createPortalAccessKey: vi.fn(),
  updatePortalAccessKeyStatus: vi.fn(),
  deletePortalAccessKey: vi.fn(),
}));

vi.mock("./PortalAccountContext", () => ({
  usePortalAccountContext: () => ({
    accountIdForApi: "101",
    hasAccountContext: true,
    loading: false,
    error: null,
  }),
}));

vi.mock("../../api/portal", () => ({
  fetchPortalAccessKeysState: mocks.fetchPortalAccessKeysState,
  listPortalStorageSpaces: mocks.listPortalStorageSpaces,
  createPortalAccessKey: mocks.createPortalAccessKey,
  updatePortalAccessKeyStatus: mocks.updatePortalAccessKeyStatus,
  deletePortalAccessKey: mocks.deletePortalAccessKey,
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <PortalAccessKeysPage />
    </MemoryRouter>
  );
}

describe("PortalAccessKeysPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state = {
      iam_user: { iam_username: "portal-101-7" },
      s3_endpoint: "https://s3.example.test",
      can_manage_access_keys: true,
      max_access_keys: 2,
      access_keys: [
        { access_key_id: "AK-PORTAL", status: "Active", is_active: true, is_portal: true },
        { access_key_id: "AK-USER", status: "Active", created_at: "2026-06-10T10:00:00Z", is_active: true },
      ],
    };
    mocks.fetchPortalAccessKeysState.mockImplementation(async () => mocks.state);
    mocks.listPortalStorageSpaces.mockResolvedValue([
      { id: "research-data", name: "Research Data", role: "Owner", content_role: "Owner" },
      { id: "shared-readonly", name: "Shared Readonly", role: "Viewer", content_role: "Viewer" },
    ]);
    mocks.createPortalAccessKey.mockResolvedValue({
      access_key_id: "AK-NEW",
      status: "Active",
      is_active: true,
      secret_access_key: "SK-NEW",
    });
    mocks.updatePortalAccessKeyStatus.mockResolvedValue({ access_key_id: "AK-USER", status: "Inactive", is_active: false });
    mocks.deletePortalAccessKey.mockResolvedValue(undefined);
  });

  it("lists external keys without rendering the portal key", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Access keys" })).toBeInTheDocument();
    expect(await screen.findByText("AK-USER")).toBeInTheDocument();
    expect(screen.queryByText("AK-PORTAL")).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveClass("responsive-data-table");
    expect(screen.getByText("AK-USER").closest("td")).toHaveAttribute("data-mobile-primary", "true");
    expect(screen.getByRole("button", { name: "Disable" }).closest("td")).toHaveAttribute("data-mobile-actions", "true");
    expect(screen.getByRole("button", { name: "New key" })).toBeEnabled();
    expect(screen.getByText(/Use endpoint https:\/\/s3\.example\.test with these keys/i)).toBeInTheDocument();
    expect(mocks.fetchPortalAccessKeysState).toHaveBeenCalledWith("101");
  });

  it("creates a key and shows the secret only in the creation banner", async () => {
    mocks.state = { ...mocks.state, access_keys: [] };
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "New key" }));
    const dialog = screen.getByRole("dialog", { name: "Create access key" });
    await user.click(within(dialog).getByRole("button", { name: "Create key" }));

    expect(mocks.createPortalAccessKey).toHaveBeenCalledWith("101", { target_type: "self" });
    expect(await screen.findByText("The secret is shown only once.")).toBeInTheDocument();
    expect(screen.getByText("AK-NEW")).toBeInTheDocument();
    expect(screen.getByText("SK-NEW")).toBeInTheDocument();
  });

  it("creates an external credential for an owner Storage Space", async () => {
    mocks.state = { ...mocks.state, access_keys: [] };
    mocks.createPortalAccessKey.mockResolvedValue({
      access_key_id: "AK-EXT",
      status: "Active",
      is_active: true,
      secret_access_key: "SK-EXT",
      target_type: "external",
      external_email: "partner@example.org",
      storage_space_id: "research-data",
      storage_space_name: "Research Data",
      permission: "read_write",
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "New key" }));
    const dialog = screen.getByRole("dialog", { name: "Create access key" });
    await user.click(within(dialog).getByLabelText("For an external user"));
    await waitFor(() => expect(mocks.listPortalStorageSpaces).toHaveBeenCalledWith("101", { sort: "name" }));
    await user.type(within(dialog).getByPlaceholderText("name@example.org"), "partner@example.org");
    await user.selectOptions(within(dialog).getByLabelText("Storage Space"), "research-data");
    await user.click(within(dialog).getByLabelText("Read/write"));
    await user.click(within(dialog).getByRole("button", { name: "Create key" }));

    await waitFor(() =>
      expect(mocks.createPortalAccessKey).toHaveBeenCalledWith("101", {
        target_type: "external",
        storage_space_id: "research-data",
        external_email: "partner@example.org",
        permission: "read_write",
      })
    );
    expect(await screen.findByText("The secret is shown only once and is limited to the selected Storage Space.")).toBeInTheDocument();
    expect(screen.getByText("AK-EXT")).toBeInTheDocument();
    expect(screen.getByText("SK-EXT")).toBeInTheDocument();
  });

  it("updates and deletes external keys after structured confirmation", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("AK-USER");
    await user.click(screen.getByRole("button", { name: "Disable" }));
    const disableDialog = screen.getByRole("dialog", { name: "Disable access key" });
    expect(within(disableDialog).getByText("AK-USER")).toBeInTheDocument();
    expect(within(disableDialog).getByText("External tools using this key stop authenticating until it is re-enabled.")).toBeInTheDocument();
    await user.click(within(disableDialog).getByRole("button", { name: "Disable key" }));
    await waitFor(() => expect(mocks.updatePortalAccessKeyStatus).toHaveBeenCalledWith("101", "AK-USER", false));

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const deleteDialog = screen.getByRole("dialog", { name: "Delete access key" });
    expect(within(deleteDialog).getByText("AK-USER")).toBeInTheDocument();
    expect(within(deleteDialog).getByText("External tools using this key stop working immediately.")).toBeInTheDocument();
    await user.click(within(deleteDialog).getByRole("button", { name: "Delete key" }));
    await waitFor(() => expect(mocks.deletePortalAccessKey).toHaveBeenCalledWith("101", "AK-USER"));
  });

  it("disables mutations when access-key management is disabled", async () => {
    mocks.state = { ...mocks.state, can_manage_access_keys: false };
    renderPage();

    expect(await screen.findByText("AK-USER")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New key" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Disable" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(screen.getByText("Access-key management is disabled for this portal account.")).toBeInTheDocument();
  });
});
