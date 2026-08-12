import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { LanguageProvider } from "../../components/language";
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
    <LanguageProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <PortalAccessKeysPage />
      </MemoryRouter>
    </LanguageProvider>
  );
}

async function openSetupDialog(user: ReturnType<typeof userEvent.setup>) {
  if (!screen.queryByRole("button", { name: "Configure a tool" })) {
    await user.click(screen.getByRole("tab", { name: "Connect tool" }));
  }
  await user.click(await screen.findByRole("button", { name: "Configure a tool" }));
  return screen.getByRole("dialog", { name: "Connect a tool" });
}

function getCreateWorkflowPage(): HTMLElement {
  const page = screen.getByRole("heading", { name: "Create S3 tool access" }).closest(".workflow-page");
  if (!page) throw new Error("Create S3 tool access workflow page not found");
  return page as HTMLElement;
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
      { id: "research-data", name: "Research Data", role: "Owner", internal_bucket_name: "research-data-internal" },
      { id: "shared-readonly", name: "Shared Readonly", role: "Viewer", internal_bucket_name: "shared-readonly-internal" },
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

    expect(await screen.findByRole("heading", { name: "External S3 tools" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Connect tool" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Tool access (1)" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Tool access (1)",
      "Connect tool",
    ]);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(await screen.findByText("AK-USER")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Connect tool" }));
    expect(screen.getByRole("heading", { name: "Connect a tool" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText(/Portal sharing/i)).not.toBeInTheDocument();
    expect(screen.queryByText("1. Select access")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Configure a tool" })).toBeInTheDocument();
    const setupDialog = await openSetupDialog(user);
    expect(within(setupDialog).getByRole("heading", { name: "Connection" })).toBeInTheDocument();
    expect(within(setupDialog).getByRole("combobox", { name: "Access used" })).toHaveDisplayValue(
      "Myself · created June 10 · …USER"
    );
    const advanced = within(setupDialog).getByText("Advanced tools and manual setup").closest("details");
    expect(advanced).not.toHaveAttribute("open");
    expect(await axe(setupDialog)).toHaveNoViolations();
    await user.click(within(setupDialog).getByRole("button", { name: "Close modal" }));

    await user.click(screen.getByRole("tab", { name: "Tool access (1)" }));
    expect(await screen.findByText("AK-USER")).toBeInTheDocument();
    expect(screen.queryByText("AK-PORTAL")).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveClass("responsive-data-table");
    expect(screen.getByText("AK-USER").closest("td")).toHaveAttribute("data-mobile-primary", "true");
    expect(screen.getByRole("button", { name: "Disable" }).closest("td")).toHaveAttribute("data-mobile-actions", "true");
    const connectButton = screen.getByRole("button", { name: "Connect Myself · created June 10 · …USER" });
    expect(connectButton).toBeEnabled();
    await user.click(connectButton);
    expect(screen.getByRole("dialog", { name: "Connect a tool" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Connect a tool" })).not.toBeInTheDocument();
    expect(connectButton).toHaveFocus();
    expect(screen.getByRole("button", { name: "New tool access" })).toBeEnabled();
    expect(mocks.fetchPortalAccessKeysState).toHaveBeenCalledWith("101");
  });

  it.each([
    { language: "fr", name: "Fermer la fenêtre", text: "Fermer" },
    { language: "de", name: "Dialog schließen", text: "Schließen" },
  ])("localizes the modal close action in $language", async ({ language, name, text }) => {
    window.localStorage.setItem("user", JSON.stringify({ ui_language: language }));
    renderPage();

    const connectTabName = language === "fr" ? "Connecter un outil" : "Werkzeug verbinden";
    const configureName = language === "fr" ? "Configurer un outil" : "Werkzeug konfigurieren";
    await userEvent.click(await screen.findByRole("tab", { name: connectTabName }));
    await userEvent.click(screen.getByRole("button", { name: configureName }));

    const closeButton = screen.getByRole("button", { name });
    expect(closeButton).toHaveTextContent(text);
  });

  it("uses the canonical activity flag instead of the status label", async () => {
    mocks.state = {
      ...mocks.state,
      access_keys: [
        { access_key_id: "AK-PORTAL", status: "Active", is_active: true, is_portal: true },
        { access_key_id: "AK-USER", status: "Active", is_active: false },
      ],
    };

    renderPage();

    expect(await screen.findByText("Inactive")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enable" })).toBeInTheDocument();
  });

  it("shows an actionable empty state when no active tool access exists", async () => {
    mocks.state = { ...mocks.state, access_keys: [] };
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "Connect tool" }));
    const setupDialog = await openSetupDialog(user);
    expect(within(setupDialog).getByRole("heading", { name: "Create an active tool access first" })).toBeInTheDocument();
    await user.click(within(setupDialog).getByRole("button", { name: "Create tool access" }));

    const workflow = getCreateWorkflowPage();
    expect(within(workflow).getByText(/prefer sharing the Space there/i)).toBeInTheDocument();
  });

  it("shows an actionable empty state when a personal access has no Space", async () => {
    mocks.listPortalStorageSpaces.mockResolvedValue([]);
    renderPage();

    const setupDialog = await openSetupDialog(userEvent.setup());
    expect(await within(setupDialog).findByRole("heading", { name: "Create a Space to continue" })).toBeInTheDocument();
    const createSpaceLink = within(setupDialog).getByRole("link", { name: "Create a Space" });

    expect(createSpaceLink).toHaveAttribute("href", "/portal/storage-spaces?create=1");
  });

  it("shows Space loading and error states without presenting unusable application actions", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let rejectSpaces: ((reason: Error) => void) | undefined;
    mocks.listPortalStorageSpaces.mockImplementation(
      () => new Promise((_, reject) => { rejectSpaces = reject; })
    );
    const user = userEvent.setup();
    renderPage();

    const setupDialog = await openSetupDialog(user);
    expect(within(setupDialog).getByRole("option", { name: "Loading..." })).toBeInTheDocument();
    expect(within(setupDialog).queryByRole("heading", { name: "Choose your application" })).not.toBeInTheDocument();

    await act(async () => rejectSpaces?.(new Error("Space service unavailable")));

    expect(await within(setupDialog).findByText("Space service unavailable")).toBeInTheDocument();
    expect(within(setupDialog).queryByRole("heading", { name: "Choose your application" })).not.toBeInTheDocument();
  });

  it("offers official links and downloads every supported configuration without a secret", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { name: "External S3 tools" });
    await waitFor(() => expect(mocks.listPortalStorageSpaces).toHaveBeenCalledWith("101", { sort: "name" }));
    const setupDialog = await openSetupDialog(user);
    const cyberduckLink = within(setupDialog).getByRole("link", { name: /Install Cyberduck from the official site/ });
    const mountainDuckLink = within(setupDialog).getByRole("link", { name: /Install Mountain Duck from the official site/ });
    const winScpLink = within(setupDialog).getByRole("link", { name: /Install WinSCP from the official site/ });
    for (const link of [cyberduckLink, mountainDuckLink, winScpLink]) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noreferrer");
    }

    await user.click(within(setupDialog).getByRole("button", { name: /Download Cyberduck or Mountain Duck configuration.*Research Data/i }));
    const bookmark = await readDownloadedBlobText(downloadedBlobs.at(-1));
    expect(bookmark).toContain("<string>s3.example.test</string>");
    expect(bookmark).toContain("<string>AK-USER</string>");
    expect(bookmark).toContain("<string>/research-data-internal</string>");
    expect(bookmark).not.toContain("SK-NEW");

    await user.click(within(setupDialog).getByRole("button", { name: /Download WinSCP profile.*Research Data/i }));
    const winScpProfile = await readDownloadedBlobText(downloadedBlobs.at(-1));
    expect(winScpProfile).toContain("FSProtocol=7");
    expect(winScpProfile).toContain("RemoteDirectory=/research-data-internal");
    expect(winScpProfile).not.toMatch(/password/i);

    await user.click(within(setupDialog).getByText("Advanced tools and manual setup"));
    const rcloneLink = within(setupDialog).getByRole("link", { name: /Install rclone from the official site/ });
    expect(rcloneLink).toHaveAttribute("href", "https://rclone.org/downloads/");
    expect(within(setupDialog).getByText("RCLONE_CONFIG_RESEARCH_DATA_RESEARCH_DATA_INTERNAL_SECRET_ACCESS_KEY")).toBeInTheDocument();
    expect(within(setupDialog).getByText("rclone lsd research_data_research_data_internal:research-data-internal")).toBeInTheDocument();
    expect(within(setupDialog).getByRole("button", { name: "Copy Access ID: AK-USER" })).toBeInTheDocument();
    await user.click(within(setupDialog).getByRole("button", { name: /Download rclone configuration.*Research Data/i }));
    const rcloneConfig = await readDownloadedBlobText(downloadedBlobs.at(-1));
    expect(rcloneConfig).toContain("type = s3");
    expect(rcloneConfig).toContain("provider = Ceph");
    expect(rcloneConfig).not.toContain("SK-NEW");

    await user.click(within(setupDialog).getByRole("button", { name: /Download connection details.*Research Data/i }));
    const details = await readDownloadedBlobText(downloadedBlobs.at(-1));
    expect(details).toContain("Storage name for external tools: research-data-internal");
    expect(details).toContain("Access ID: AK-USER");
    expect(details).toContain("Secret: Not included in this file");
  });

  it("configures Cyberduck for path-style addressing when required by the endpoint", async () => {
    mocks.state = { ...mocks.state, force_path_style: true };
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { name: "External S3 tools" });
    const setupDialog = await openSetupDialog(user);
    await user.click(within(setupDialog).getByRole("button", { name: /Download Cyberduck or Mountain Duck configuration/i }));
    const bookmark = await readDownloadedBlobText(downloadedBlobs.at(-1));

    expect(bookmark).toContain("<key>Custom</key>");
    expect(bookmark).toContain("<key>s3.bucket.virtualhost.disable</key>");
    expect(bookmark).toContain("<string>true</string>");
  });

  it("keeps manual connection details available when generated profiles cannot use the endpoint", async () => {
    mocks.state = { ...mocks.state, s3_endpoint: "mailto:user@example.test" };
    renderPage();

    await screen.findByRole("heading", { name: "External S3 tools" });
    const setupDialog = await openSetupDialog(userEvent.setup());
    expect(within(setupDialog).getByRole("button", { name: /Download Cyberduck or Mountain Duck configuration/i })).toBeDisabled();
    expect(within(setupDialog).getByRole("button", { name: /Download WinSCP profile/i })).toBeDisabled();
    expect(within(setupDialog).getByText(/Configuration downloads are unavailable/i)).toBeInTheDocument();
    await userEvent.click(within(setupDialog).getByText("Advanced tools and manual setup"));
    expect(within(setupDialog).getByRole("button", { name: /Download rclone configuration/i })).toBeDisabled();
    expect(within(setupDialog).getByRole("button", { name: /Download connection details/i })).toBeEnabled();
  });

  it("creates a key and shows the secret only in the creation banner", async () => {
    mocks.state = { ...mocks.state, access_keys: [] };
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "New tool access" }));
    const dialog = getCreateWorkflowPage();
    await user.click(within(dialog).getByRole("button", { name: "Create access" }));

    expect(mocks.createPortalAccessKey).toHaveBeenCalledWith("101", { target_type: "self" });
    expect(await screen.findByText("The secret is shown only once.")).toBeInTheDocument();
    expect(screen.getAllByText("AK-NEW").length).toBeGreaterThan(0);
    expect(screen.getByText("SK-NEW")).toBeInTheDocument();
  });

  it("limits only the personal IAM user when the create workflow opens", async () => {
    mocks.state = {
      ...mocks.state,
      max_access_keys: 1,
      access_keys: [
        {
          access_key_id: "AK-PERSONAL",
          status: "Active",
          is_active: true,
          target_type: "self",
        },
        {
          access_key_id: "AK-EXTERNAL",
          status: "Active",
          is_active: true,
          target_type: "external",
          external_email: "existing@example.org",
          storage_space_name: "Research Data",
          bucket_name: "research-data-internal",
          permission: "read_only",
        },
      ],
    };
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole("button", { name: "New tool access" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "New tool access" }));
    const workflow = getCreateWorkflowPage();

    expect(within(workflow).getByLabelText("For myself")).toBeDisabled();
    expect(within(workflow).getByLabelText("For an external user")).toBeChecked();
    expect(within(workflow).getByText(/personal IAM user already has the maximum of 1 S3 access keys/i)).toBeInTheDocument();
    expect(within(workflow).getByRole("button", { name: "Create access" })).toBeDisabled();

    await user.type(within(workflow).getByPlaceholderText("name@example.org"), "new-partner@example.org");
    expect(within(workflow).getByRole("button", { name: "Create access" })).toBeEnabled();
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
      storage_space_name: "Research Data",
      bucket_name: "research-data-internal",
      permission: "read_write",
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "New tool access" }));
    const dialog = getCreateWorkflowPage();
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

    await screen.findByRole("heading", { name: "Create S3 tool access" });
    const dialog = getCreateWorkflowPage();
    await waitFor(() => expect(mocks.listPortalStorageSpaces).toHaveBeenCalledWith("101", { sort: "name" }));
    expect(within(dialog).getByLabelText("For an external user")).toBeChecked();
    expect(within(dialog).getByLabelText("Space")).toHaveValue("research-data");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: "Create S3 tool access" })).not.toBeInTheDocument();
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
          storage_space_name: "Research Data",
          bucket_name: "research-data-internal",
          permission: "read_only",
        },
      ],
    };
    renderPage();

    const setupDialog = await openSetupDialog(userEvent.setup());
    expect(within(setupDialog).getByRole("combobox", { name: "Access used" })).toHaveDisplayValue(
      "partner@example.org · Research Data · Read only"
    );
    expect(within(setupDialog).getByText("Research Data — fixed when this access was created")).toBeInTheDocument();
    expect(within(setupDialog).getAllByRole("combobox")).toHaveLength(1);
    expect(within(setupDialog).queryByRole("button", { name: /secret/i })).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("tab", { name: "Tool access (1)" }));
    expect(await screen.findByText("AK-EXT-OLD")).toBeInTheDocument();
  });

  it("updates and deletes external keys after structured confirmation", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "Tool access (1)" }));
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

    await user.click(await screen.findByRole("tab", { name: "Tool access (1)" }));
    expect(await screen.findByText("AK-USER")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New tool access" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Disable" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(screen.getByText("External-tool access is disabled for this project.")).toBeInTheDocument();
  });
});
