import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import PortalAccessKeysPage from "./PortalAccessKeysPage";
import type { PortalAccessKeysState, PortalProjectAccessKeysState } from "../../api/portal";

const mocks = vi.hoisted(() => ({
  context: {
    accountIdForApi: "101" as string | number | null,
    hasAccountContext: true,
    loading: false,
    error: null as string | null,
  },
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
  projectState: {
    scopes: [
      {
        scope_id: "zg-main",
        label: "zg-main",
        zonegroup: "zg-main",
        s3_endpoint: "https://s3-z1.example.test",
        accounts: [
          { account_id: 101, account_name: "rgw-a", display_name: "Paris" },
          { account_id: 102, account_name: "rgw-b", display_name: "Lyon" },
        ],
        iam_user: { iam_username: "portal-p1-zg-u7" },
        can_manage_access_keys: true,
        max_access_keys: 2,
        access_keys: [
          { access_key_id: "AK-PROJECT", status: "Active", created_at: "2026-06-11T10:00:00Z", is_active: true },
        ],
      },
      {
        scope_id: "account-103",
        label: "Missing",
        zonegroup: null,
        s3_endpoint: null,
        accounts: [{ account_id: 103, account_name: "rgw-missing", display_name: "Missing" }],
        iam_user: {},
        can_manage_access_keys: false,
        max_access_keys: 0,
        access_keys: [],
        unavailable_reason: "Ceph zonegroup is not configured for this storage location.",
      },
    ],
  } as PortalProjectAccessKeysState,
  fetchPortalAccessKeysState: vi.fn(),
  fetchPortalProjectAccessKeysState: vi.fn(),
  createPortalAccessKey: vi.fn(),
  createPortalProjectAccessKey: vi.fn(),
  updatePortalAccessKeyStatus: vi.fn(),
  updatePortalProjectAccessKeyStatus: vi.fn(),
  deletePortalAccessKey: vi.fn(),
  deletePortalProjectAccessKey: vi.fn(),
}));

vi.mock("./PortalAccountContext", () => ({
  usePortalAccountContext: () => mocks.context,
}));

vi.mock("../../api/portal", () => ({
  fetchPortalAccessKeysState: mocks.fetchPortalAccessKeysState,
  fetchPortalProjectAccessKeysState: mocks.fetchPortalProjectAccessKeysState,
  createPortalAccessKey: mocks.createPortalAccessKey,
  createPortalProjectAccessKey: mocks.createPortalProjectAccessKey,
  updatePortalAccessKeyStatus: mocks.updatePortalAccessKeyStatus,
  updatePortalProjectAccessKeyStatus: mocks.updatePortalProjectAccessKeyStatus,
  deletePortalAccessKey: mocks.deletePortalAccessKey,
  deletePortalProjectAccessKey: mocks.deletePortalProjectAccessKey,
  isPortalProjectSelector: (accountId: string | number | null | undefined) =>
    typeof accountId === "string" && accountId.startsWith("proj-"),
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
    mocks.context = {
      accountIdForApi: "101",
      hasAccountContext: true,
      loading: false,
      error: null,
    };
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
    mocks.projectState = {
      scopes: [
        {
          scope_id: "zg-main",
          label: "zg-main",
          zonegroup: "zg-main",
          s3_endpoint: "https://s3-z1.example.test",
          accounts: [
            { account_id: 101, account_name: "rgw-a", display_name: "Paris" },
            { account_id: 102, account_name: "rgw-b", display_name: "Lyon" },
          ],
          iam_user: { iam_username: "portal-p1-zg-u7" },
          can_manage_access_keys: true,
          max_access_keys: 2,
          access_keys: [
            { access_key_id: "AK-PROJECT", status: "Active", created_at: "2026-06-11T10:00:00Z", is_active: true },
          ],
        },
        {
          scope_id: "account-103",
          label: "Missing",
          zonegroup: null,
          s3_endpoint: null,
          accounts: [{ account_id: 103, account_name: "rgw-missing", display_name: "Missing" }],
          iam_user: {},
          can_manage_access_keys: false,
          max_access_keys: 0,
          access_keys: [],
          unavailable_reason: "Ceph zonegroup is not configured for this storage location.",
        },
      ],
    };
    mocks.fetchPortalAccessKeysState.mockImplementation(async () => mocks.state);
    mocks.fetchPortalProjectAccessKeysState.mockImplementation(async () => mocks.projectState);
    mocks.createPortalAccessKey.mockResolvedValue({
      access_key_id: "AK-NEW",
      status: "Active",
      is_active: true,
      secret_access_key: "SK-NEW",
    });
    mocks.createPortalProjectAccessKey.mockResolvedValue({
      access_key_id: "AK-PROJECT-NEW",
      status: "Active",
      is_active: true,
      secret_access_key: "SK-PROJECT-NEW",
    });
    mocks.updatePortalAccessKeyStatus.mockResolvedValue({ access_key_id: "AK-USER", status: "Inactive", is_active: false });
    mocks.updatePortalProjectAccessKeyStatus.mockResolvedValue({ access_key_id: "AK-PROJECT", status: "Inactive", is_active: false });
    mocks.deletePortalAccessKey.mockResolvedValue(undefined);
    mocks.deletePortalProjectAccessKey.mockResolvedValue(undefined);
  });

  it("lists external keys without rendering the portal key", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Access keys" })).toBeInTheDocument();
    expect(await screen.findByText("AK-USER")).toBeInTheDocument();
    expect(screen.getByText("AK-USER").closest("tr")).toHaveClass("max-md:block");
    expect(screen.queryByText("AK-PORTAL")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New key" })).toBeEnabled();
    expect(screen.getByText(/Use endpoint https:\/\/s3\.example\.test with these keys/i)).toBeInTheDocument();
    expect(mocks.fetchPortalAccessKeysState).toHaveBeenCalledWith("101");
  });

  it("creates a key and shows the secret only in the creation banner", async () => {
    mocks.state = { ...mocks.state, access_keys: [] };
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "New key" }));

    expect(mocks.createPortalAccessKey).toHaveBeenCalledWith("101");
    expect(await screen.findByText("The secret is shown only once.")).toBeInTheDocument();
    expect(screen.getByText("AK-NEW")).toBeInTheDocument();
    expect(screen.getByText("SK-NEW")).toBeInTheDocument();
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
    expect(screen.getByText("Access-key management is disabled for this portal workspace.")).toBeInTheDocument();
  });

  it("renders project access keys by zonegroup and creates a scoped key", async () => {
    mocks.context = {
      accountIdForApi: "proj-1",
      hasAccountContext: true,
      loading: false,
      error: null,
    };
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("AK-PROJECT")).toBeInTheDocument();
    expect(screen.getByText("Storage locations: Paris, Lyon")).toBeInTheDocument();
    expect(screen.getByText("Ceph zonegroup is not configured for this storage location.")).toBeInTheDocument();
    expect(screen.queryByText("Access-key management is disabled for this portal workspace.")).not.toBeInTheDocument();
    expect(mocks.fetchPortalProjectAccessKeysState).toHaveBeenCalledWith("proj-1");
    expect(mocks.fetchPortalAccessKeysState).not.toHaveBeenCalled();

    const newKeyButtons = screen.getAllByRole("button", { name: "New key" });
    const enabledNewKeyButton = newKeyButtons.find((button) => !button.hasAttribute("disabled"))!;
    expect(enabledNewKeyButton).toHaveClass("ui-button-primary");
    await user.click(enabledNewKeyButton);

    await waitFor(() => expect(mocks.createPortalProjectAccessKey).toHaveBeenCalledWith("proj-1", "zg-main"));
    expect(await screen.findByText("AK-PROJECT-NEW")).toBeInTheDocument();
    expect(screen.getByText("SK-PROJECT-NEW")).toBeInTheDocument();
    expect(screen.getByText("Scope: zg-main. The secret is shown only once.")).toBeInTheDocument();
  });
});
