import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import PortalAccessKeysPage from "./PortalAccessKeysPage";
import type { PortalAccessKeysState } from "../../api/portal";

let downloadedBlobs: Blob[] = [];

function readDownloadedBlobText(blob: Blob | undefined): Promise<string> {
  if (!blob) throw new Error("Missing downloaded blob");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read downloaded blob"));
    reader.readAsText(blob);
  });
}

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

function renderPage(initialEntry = "/portal/access-keys") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <PortalAccessKeysPage />
    </MemoryRouter>
  );
}

async function openSetupDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Download setup" }));
  return screen.getByRole("dialog", { name: "Download setup details" });
}

describe("PortalAccessKeysPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    downloadedBlobs = [];
    window.localStorage.clear();
    Object.defineProperty(window.URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((blob: Blob) => {
        downloadedBlobs.push(blob);
        return "blob:portal-download";
      }),
    });
    Object.defineProperty(window.URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
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
      { id: "research-data", name: "Research Data", role: "Owner", content_role: "Owner", internal_bucket_name: "research-data-internal" },
      { id: "shared-readonly", name: "Shared Readonly", role: "Viewer", content_role: "Viewer", internal_bucket_name: "shared-readonly-internal" },
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
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole("heading", { name: "External tools" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect tool" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tool access (1)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Connect an external tool" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Before connecting a tool" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText(/Use external-tool access only when someone cannot work through Portal sharing/i)).toBeInTheDocument();
    expect(screen.getByText("1. Select access")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download setup" })).toBeInTheDocument();
    expect(screen.queryByText("Manual setup details")).not.toBeInTheDocument();
    const setupDialog = await openSetupDialog(user);
    expect(within(setupDialog).getByText("Manual setup details")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tool access (1)" }));
    expect(await screen.findByText("AK-USER")).toBeInTheDocument();
    expect(screen.queryByText("AK-PORTAL")).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveClass("responsive-data-table");
    expect(screen.getByText("AK-USER").closest("td")).toHaveAttribute("data-mobile-primary", "true");
    expect(screen.getByRole("button", { name: "Disable" }).closest("td")).toHaveAttribute("data-mobile-actions", "true");
    expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "New tool access" })).toBeEnabled();
    expect(mocks.fetchPortalAccessKeysState).toHaveBeenCalledWith("101");
  });

  it("shows the starter guide only before the first tool access and lets users dismiss it", async () => {
    mocks.state = { ...mocks.state, access_keys: [] };
    mocks.listPortalStorageSpaces.mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole("heading", { name: "Before connecting a tool" })).toBeInTheDocument();
    expect(screen.getByText("Use Portal sharing when a collaborator can sign in. Use tool access for apps, scripts, or partners that need a direct storage client.")).toBeInTheDocument();
    expect(screen.getByText("1. Pick the space")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dismiss guide" }));

    expect(screen.queryByRole("heading", { name: "Before connecting a tool" })).not.toBeInTheDocument();
    expect(window.localStorage.getItem("portal.access-keys.start-guide.dismissed.101")).toBe("1");
  });

  it("does not repeat the starter guide once a space exists", async () => {
    mocks.state = { ...mocks.state, access_keys: [] };
    renderPage();

    expect(await screen.findByRole("heading", { name: "Connect an external tool" })).toBeInTheDocument();
    await waitFor(() => expect(mocks.listPortalStorageSpaces).toHaveBeenCalledWith("101", { sort: "name" }));

    expect(screen.queryByRole("heading", { name: "Before connecting a tool" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download setup" })).toBeInTheDocument();
  });

  it("downloads generic and Cyberduck connection details without a secret", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { name: "Connect an external tool" });
    await waitFor(() => expect(mocks.listPortalStorageSpaces).toHaveBeenCalledWith("101", { sort: "name" }));
    const setupDialog = await openSetupDialog(user);
    await user.click(within(setupDialog).getByRole("button", { name: "Connection details" }));
    const details = await readDownloadedBlobText(downloadedBlobs.at(-1));
    expect(details).toContain("Storage name for external tools: research-data-internal");
    expect(details).toContain("Secret: Not included in this file");

    await user.click(within(setupDialog).getByRole("button", { name: "Cyberduck bookmark" }));
    const bookmark = await readDownloadedBlobText(downloadedBlobs.at(-1));
    expect(bookmark).toContain("<string>s3.example.test</string>");
    expect(bookmark).toContain("<string>AK-USER</string>");
    expect(bookmark).toContain("<string>/research-data-internal</string>");
    expect(bookmark).not.toContain("SK-NEW");
  });

  it("keeps generic connection details available when Cyberduck cannot use the endpoint", async () => {
    mocks.state = { ...mocks.state, s3_endpoint: "mailto:user@example.test" };
    renderPage();

    await screen.findByRole("heading", { name: "Connect an external tool" });
    const setupDialog = await openSetupDialog(userEvent.setup());
    expect(within(setupDialog).getByRole("button", { name: "Cyberduck bookmark" })).toBeDisabled();
    expect(within(setupDialog).getByRole("button", { name: "Connection details" })).toBeEnabled();
    expect(within(setupDialog).getByText(/Cyberduck bookmark download is unavailable/i)).toBeInTheDocument();
  });

  it("creates a key and shows the secret only in the creation banner", async () => {
    mocks.state = { ...mocks.state, access_keys: [] };
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "New tool access" }));
    const dialog = screen.getByRole("dialog", { name: "Create tool access" });
    await user.click(within(dialog).getByRole("button", { name: "Create access" }));

    expect(mocks.createPortalAccessKey).toHaveBeenCalledWith("101", { target_type: "self" });
    expect(await screen.findByText("The secret is shown only once.")).toBeInTheDocument();
    expect(screen.getAllByText("AK-NEW").length).toBeGreaterThan(0);
    expect(screen.getByText("SK-NEW")).toBeInTheDocument();
  });

  it("creates an external credential for an owned space", async () => {
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
      bucket_name: "research-data-internal",
      permission: "read_write",
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "New tool access" }));
    const dialog = screen.getByRole("dialog", { name: "Create tool access" });
    await user.click(within(dialog).getByLabelText("For an external user"));
    await waitFor(() => expect(mocks.listPortalStorageSpaces).toHaveBeenCalledWith("101", { sort: "name" }));
    await user.type(within(dialog).getByPlaceholderText("name@example.org"), "partner@example.org");
    await user.selectOptions(within(dialog).getByLabelText("Space"), "research-data");
    await user.click(within(dialog).getByLabelText("Read/write"));
    await user.click(within(dialog).getByRole("button", { name: "Create access" }));

    await waitFor(() =>
      expect(mocks.createPortalAccessKey).toHaveBeenCalledWith("101", {
        target_type: "external",
        storage_space_id: "research-data",
        external_email: "partner@example.org",
        permission: "read_write",
      })
    );
    expect(await screen.findByText("The secret is shown only once and is limited to the selected space.")).toBeInTheDocument();
    expect(screen.getAllByText("AK-EXT").length).toBeGreaterThan(0);
    expect(screen.getByText("SK-EXT")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Download with secret" }).length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole("button", { name: "Download with secret" })[0]);
    expect(await readDownloadedBlobText(downloadedBlobs.at(-1))).toContain("Secret: SK-EXT");
  });

  it("opens external key creation from a preselected space link", async () => {
    mocks.state = { ...mocks.state, access_keys: [] };
    const user = userEvent.setup();
    renderPage("/portal/access-keys?space_id=research-data-internal&create=external");

    const dialog = await screen.findByRole("dialog", { name: "Create tool access" });
    await waitFor(() => expect(mocks.listPortalStorageSpaces).toHaveBeenCalledWith("101", { sort: "name" }));
    expect(within(dialog).getByLabelText("For an external user")).toBeChecked();
    expect(within(dialog).getByLabelText("Space")).toHaveValue("research-data");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Create tool access" })).not.toBeInTheDocument();
  });

  it("never offers a secret-inclusive download for existing keys", async () => {
    mocks.state = {
      ...mocks.state,
      max_access_keys: 4,
      access_keys: [
        {
          access_key_id: "AK-EXT-OLD",
          status: "Active",
          created_at: "2026-06-10T10:00:00Z",
          is_active: true,
          target_type: "external",
          external_email: "partner@example.org",
          storage_space_id: "research-data",
          storage_space_name: "Research Data",
          bucket_name: "research-data-internal",
          permission: "read_only",
        },
      ],
    };
    renderPage();

    const setupDialog = await openSetupDialog(userEvent.setup());
    expect(await within(setupDialog).findByText("Not shown again")).toBeInTheDocument();
    expect(within(setupDialog).queryByRole("button", { name: "Details with secret" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tool access (1)" }));
    expect(await screen.findByText("AK-EXT-OLD")).toBeInTheDocument();
  });

  it("updates and deletes external keys after structured confirmation", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Tool access (1)" }));
    await screen.findByText("AK-USER");
    await user.click(screen.getByRole("button", { name: "Disable" }));
    const disableDialog = screen.getByRole("dialog", { name: "Disable tool access" });
    expect(within(disableDialog).getByText("AK-USER")).toBeInTheDocument();
    expect(within(disableDialog).getByText("External tools using this access stop authenticating until it is re-enabled.")).toBeInTheDocument();
    await user.click(within(disableDialog).getByRole("button", { name: "Disable access" }));
    await waitFor(() => expect(mocks.updatePortalAccessKeyStatus).toHaveBeenCalledWith("101", "AK-USER", false));

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const deleteDialog = screen.getByRole("dialog", { name: "Delete tool access" });
    expect(within(deleteDialog).getByText("AK-USER")).toBeInTheDocument();
    expect(within(deleteDialog).getByText("External tools using this access stop working immediately.")).toBeInTheDocument();
    await user.click(within(deleteDialog).getByRole("button", { name: "Delete access" }));
    await waitFor(() => expect(mocks.deletePortalAccessKey).toHaveBeenCalledWith("101", "AK-USER"));
  });

  it("disables mutations when access-key management is disabled", async () => {
    mocks.state = { ...mocks.state, can_manage_access_keys: false };
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Tool access (1)" }));
    expect(await screen.findByText("AK-USER")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New tool access" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Disable" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(screen.getByText("External-tool access is disabled for this project.")).toBeInTheDocument();
  });
});
