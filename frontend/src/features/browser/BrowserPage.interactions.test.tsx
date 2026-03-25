import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BrowserEmbed from "./BrowserEmbed";
import BrowserPage from "./BrowserPage";

const searchBrowserBucketsMock = vi.fn();
const fetchBrowserSettingsMock = vi.fn();
const listBrowserObjectsMock = vi.fn();
const getBucketVersioningMock = vi.fn();
const getBucketCorsStatusMock = vi.fn();
const ensureBucketCorsMock = vi.fn();
const fetchObjectMetadataMock = vi.fn();
const getObjectTagsMock = vi.fn();

const getBucketStatsMock = vi.fn();
const getBucketPropertiesMock = vi.fn();
const getBucketPolicyMock = vi.fn();
const getBucketLoggingMock = vi.fn();
const getBucketWebsiteMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    unstable_usePrompt: () => {},
  };
});

vi.mock("./BrowserContext", () => ({
  useBrowserContext: () => ({
    contexts: [],
    selectedContextId: null,
    setSelectedContextId: () => {},
    requiresContextSelection: false,
    hasContext: true,
    selectorForApi: "acc-1",
    selectedKind: null,
    sessionAccountName: null,
    accessError: null,
  }),
}));

vi.mock("../../api/browser", async () => {
  const actual = await vi.importActual<typeof import("../../api/browser")>("../../api/browser");
  return {
    ...actual,
    searchBrowserBuckets: (...args: unknown[]) => searchBrowserBucketsMock(...args),
    fetchBrowserSettings: (...args: unknown[]) => fetchBrowserSettingsMock(...args),
    listBrowserObjects: (...args: unknown[]) => listBrowserObjectsMock(...args),
    getBucketVersioning: (...args: unknown[]) => getBucketVersioningMock(...args),
    getBucketCorsStatus: (...args: unknown[]) => getBucketCorsStatusMock(...args),
    ensureBucketCors: (...args: unknown[]) => ensureBucketCorsMock(...args),
    fetchObjectMetadata: (...args: unknown[]) => fetchObjectMetadataMock(...args),
    getObjectTags: (...args: unknown[]) => getObjectTagsMock(...args),
  };
});

vi.mock("../../api/buckets", async () => {
  const actual = await vi.importActual<typeof import("../../api/buckets")>("../../api/buckets");
  return {
    ...actual,
    getBucketStats: (...args: unknown[]) => getBucketStatsMock(...args),
    getBucketProperties: (...args: unknown[]) => getBucketPropertiesMock(...args),
    getBucketPolicy: (...args: unknown[]) => getBucketPolicyMock(...args),
    getBucketLogging: (...args: unknown[]) => getBucketLoggingMock(...args),
    getBucketWebsite: (...args: unknown[]) => getBucketWebsiteMock(...args),
  };
});

function renderPage({
  defaultShowInspector = false,
  initialEntry = "/browser",
  allowInspectorPanel = true,
}: { defaultShowInspector?: boolean; initialEntry?: string; allowInspectorPanel?: boolean } = {}) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <BrowserPage defaultShowInspector={defaultShowInspector} allowInspectorPanel={allowInspectorPanel} />
    </MemoryRouter>
  );
}

function renderEmbeddedPage() {
  return render(
    <MemoryRouter initialEntries={["/manager/browser"]}>
      <BrowserEmbed accountIdForApi="acc-1" hasContext />
    </MemoryRouter>
  );
}

async function findRowByLabel(label: string): Promise<HTMLTableRowElement> {
  const row = (await screen.findByText(label)).closest("tr");
  if (!row) {
    throw new Error(`Unable to find row for label: ${label}`);
  }
  return row as HTMLTableRowElement;
}

function openHeaderConfigMenu() {
  const actionsHeader = screen.getByRole("columnheader", { name: "Actions" });
  fireEvent.contextMenu(actionsHeader);
  return screen.getByRole("menu");
}

function getContextToolbar() {
  return screen.getByRole("toolbar", { name: "Browser context bar" });
}

function getActionsToolbar() {
  return screen.getByRole("toolbar", { name: "Browser actions bar" });
}

async function openContextMoreMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(getContextToolbar()).getByRole("button", { name: "More" }));
  return await screen.findByRole("menu", { name: "More" });
}

async function enableActionBar(user: ReturnType<typeof userEvent.setup>) {
  const menu = await openContextMoreMenu(user);
  await user.click(within(menu).getByRole("menuitemcheckbox", { name: /Action bar/i }));
  await waitFor(() => {
    expect(screen.getByRole("toolbar", { name: "Browser actions bar" })).toBeInTheDocument();
  });
}

describe("BrowserPage interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    fetchBrowserSettingsMock.mockResolvedValue({
      allow_proxy_transfers: false,
      direct_upload_parallelism: 3,
      proxy_upload_parallelism: 2,
      direct_download_parallelism: 3,
      proxy_download_parallelism: 2,
      other_operations_parallelism: 2,
      streaming_zip_threshold_mb: 200,
    });

    searchBrowserBucketsMock.mockResolvedValue({
      items: [{ name: "bucket-1" }],
      total: 1,
      page: 1,
      page_size: 50,
      has_next: false,
    });

    listBrowserObjectsMock.mockImplementation((_accountId: string, _bucketName: string, payload?: { prefix?: string }) => {
      const prefix = payload?.prefix ?? "";
      if (prefix === "docs/") {
        return Promise.resolve({
          prefix: "docs/",
          objects: [
            {
              key: "docs/readme.txt",
              size: 42,
              last_modified: "2026-03-10T10:45:00Z",
              storage_class: "STANDARD",
              etag: "\"etag-docs\"",
            },
          ],
          prefixes: [],
          is_truncated: false,
          next_continuation_token: null,
        });
      }
      return Promise.resolve({
        prefix: "",
        objects: [
          {
            key: "a.txt",
            size: 10,
            last_modified: "2026-03-10T10:15:00Z",
            storage_class: "STANDARD",
            etag: "\"etag-a\"",
          },
          {
            key: "b.txt",
            size: 20,
            last_modified: "2026-03-10T10:16:00Z",
            storage_class: "STANDARD",
            etag: "\"etag-b\"",
          },
          {
            key: "c.txt",
            size: 30,
            last_modified: "2026-03-10T10:17:00Z",
            storage_class: "STANDARD",
            etag: "\"etag-c\"",
          },
        ],
        prefixes: ["docs/"],
        is_truncated: false,
        next_continuation_token: null,
      });
    });

    getBucketVersioningMock.mockResolvedValue({ enabled: false, status: "Disabled" });
    getBucketCorsStatusMock.mockResolvedValue({ enabled: true, rules: [] });
    ensureBucketCorsMock.mockResolvedValue({ enabled: true, rules: [] });
    fetchObjectMetadataMock.mockResolvedValue({
      key: "a.txt",
      size: 10,
      metadata: {},
      content_type: "text/plain",
    });
    getObjectTagsMock.mockResolvedValue({ key: "a.txt", tags: [], version_id: null });

    getBucketStatsMock.mockResolvedValue({
      name: "bucket-1",
      creation_date: "2026-03-10T10:00:00Z",
      used_bytes: 0,
      object_count: 0,
      quota_max_size_bytes: 0,
      quota_max_objects: 0,
    });
    getBucketPropertiesMock.mockResolvedValue({
      versioning_status: "Disabled",
      object_lock_enabled: false,
      public_access_block: null,
      lifecycle_rules: [],
      cors_rules: [],
    });
    getBucketPolicyMock.mockResolvedValue({ policy: null });
    getBucketLoggingMock.mockResolvedValue({ enabled: false, target_bucket: null });
    getBucketWebsiteMock.mockResolvedValue({});
  });

  it("keeps single-click selection stable and applies the same behavior on row label click", async () => {
    const user = userEvent.setup();
    renderPage();

    const rowA = await findRowByLabel("a.txt");
    await user.click(rowA);
    expect(screen.getByRole("checkbox", { name: "Select a.txt" })).toBeChecked();

    await user.click(rowA);
    expect(screen.getByRole("checkbox", { name: "Select a.txt" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "b.txt" }));
    expect(screen.getByRole("checkbox", { name: "Select b.txt" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select a.txt" })).not.toBeChecked();

    expect(screen.queryByRole("tablist", { name: "Inspector tabs" })).not.toBeInTheDocument();
  });

  it("shows header config menu only on /browser", async () => {
    const browserView = renderPage({ initialEntry: "/browser" });
    await findRowByLabel("a.txt");
    const mainMenu = openHeaderConfigMenu();
    expect(within(mainMenu).getByText("Reset columns")).toBeInTheDocument();
    browserView.unmount();

    renderPage({ initialEntry: "/manager/browser" });
    await findRowByLabel("a.txt");
    openHeaderConfigMenu();
    expect(screen.queryByText("Reset columns")).not.toBeInTheDocument();
    expect(screen.queryByText("Compact view")).not.toBeInTheDocument();
  });

  it("uses compact mode by default on /manager/browser", async () => {
    renderPage({ initialEntry: "/manager/browser" });
    const rowA = await findRowByLabel("a.txt");
    expect(rowA).toHaveClass("h-9");
  });

  it("uses minimal visible columns by default", async () => {
    renderPage();
    await findRowByLabel("a.txt");

    expect(screen.getByRole("columnheader", { name: "Size" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Modified" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Type" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Storage class" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "ETag" })).not.toBeInTheDocument();
  });

  it("toggles non-lazy columns and updates table headers/cells", async () => {
    const user = userEvent.setup();
    renderPage();
    await findRowByLabel("a.txt");

    const menu = openHeaderConfigMenu();
    await user.click(within(menu).getByRole("button", { name: "Type" }));
    await user.click(within(menu).getByRole("button", { name: "ETag" }));

    expect(screen.getByRole("columnheader", { name: "Type" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "ETag" })).toBeInTheDocument();
    expect(screen.getByText("etag-a")).toBeInTheDocument();
  });

  it("resets sort to name when hiding the active sorted column", async () => {
    const user = userEvent.setup();
    renderPage();
    await findRowByLabel("a.txt");

    await user.click(screen.getByRole("button", { name: "Size" }));
    await user.click(screen.getByRole("button", { name: "Size" }));

    const rowCDesc = await findRowByLabel("c.txt");
    const rowADesc = await findRowByLabel("a.txt");
    expect(Boolean(rowCDesc.compareDocumentPosition(rowADesc) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);

    const menu = openHeaderConfigMenu();
    await user.click(within(menu).getByRole("button", { name: /Size/ }));

    expect(screen.queryByRole("columnheader", { name: "Size" })).not.toBeInTheDocument();
    const rowAReset = await findRowByLabel("a.txt");
    const rowCReset = await findRowByLabel("c.txt");
    expect(Boolean(rowAReset.compareDocumentPosition(rowCReset) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("loads lazy metadata columns without blocking the listing", async () => {
    const user = userEvent.setup();
    const metadataResolvers: Array<() => void> = [];
    fetchObjectMetadataMock.mockImplementation((_accountId: string, _bucketName: string, key: string) => {
      return new Promise((resolve) => {
        metadataResolvers.push(() =>
          resolve({
            key,
            size: 10,
            metadata: { alpha: "1", beta: "2" },
            content_type: key === "b.txt" ? "text/csv" : "text/plain",
          })
        );
      });
    });

    renderPage();
    await findRowByLabel("a.txt");

    const menu = openHeaderConfigMenu();
    await user.click(within(menu).getByRole("button", { name: "Content-Type" }));

    expect(screen.getByRole("columnheader", { name: "Content-Type" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByText("Loading...").length).toBeGreaterThan(0);
    });
    expect(screen.getByRole("button", { name: "a.txt" })).toBeInTheDocument();

    metadataResolvers.forEach((resolve) => resolve());
    await waitFor(() => {
      const plainCount = screen.queryAllByText("text/plain").length;
      const csvCount = screen.queryAllByText("text/csv").length;
      expect(plainCount + csvCount).toBeGreaterThan(0);
    });
    expect(fetchObjectMetadataMock.mock.calls.length).toBeGreaterThan(0);
    const metadataKeys = fetchObjectMetadataMock.mock.calls.map((call) => call[2] as string);
    expect(metadataKeys.every((key) => ["a.txt", "b.txt", "c.txt"].includes(key))).toBe(true);
    expect(getObjectTagsMock).not.toHaveBeenCalled();
  });

  it("does not fetch lazy columns for folders or deleted rows", async () => {
    const user = userEvent.setup();
    getObjectTagsMock.mockResolvedValue({
      key: "a.txt",
      tags: [
        { key: "a", value: "1" },
        { key: "b", value: "2" },
        { key: "c", value: "3" },
      ],
      version_id: null,
    });

    renderPage();
    const docsRow = await findRowByLabel("docs");

    const menu = openHeaderConfigMenu();
    await user.click(within(menu).getByRole("button", { name: "Tags" }));

    await waitFor(() => {
      expect(getObjectTagsMock.mock.calls.length).toBeGreaterThan(0);
    });
    const tagKeys = getObjectTagsMock.mock.calls.map((call) => call[2] as string);
    expect(tagKeys.every((key) => ["a.txt", "b.txt", "c.txt"].includes(key))).toBe(true);
    expect(fetchObjectMetadataMock).not.toHaveBeenCalled();
    expect(within(docsRow).getByText("—")).toBeInTheDocument();
  });

  it("switches compact/list view from header config menu", async () => {
    const user = userEvent.setup();
    renderPage();

    let actionsHeader = screen.getByRole("columnheader", { name: "Actions" });
    let rowA = await findRowByLabel("a.txt");
    expect(rowA).toHaveClass("h-9");
    expect(actionsHeader).toHaveClass("!py-1");
    const compactNameCell = within(rowA).getByRole("button", { name: "a.txt" }).closest("td");
    expect(compactNameCell).not.toBeNull();
    expect(compactNameCell).toHaveClass("!py-0.5");
    expect(compactNameCell).toHaveClass("!align-middle");
    const compactPreviewButton = within(rowA).getByRole("button", { name: "Preview" });
    expect(compactPreviewButton).toHaveClass("!h-6", "!w-6");
    expect(within(rowA).queryByText("Object")).not.toBeInTheDocument();

    let menu = openHeaderConfigMenu();
    await user.click(within(menu).getByRole("button", { name: "List view" }));
    actionsHeader = screen.getByRole("columnheader", { name: "Actions" });
    rowA = await findRowByLabel("a.txt");
    expect(rowA).toHaveClass("h-16");
    expect(actionsHeader).toHaveClass("py-3");
    const listNameCell = within(rowA).getByRole("button", { name: "a.txt" }).closest("td");
    expect(listNameCell).not.toBeNull();
    expect(listNameCell).toHaveClass("py-2.5");
    expect(listNameCell).toHaveClass("!align-middle");
    const listPreviewButton = within(rowA).getByRole("button", { name: "Preview" });
    expect(listPreviewButton).toHaveClass("h-7", "w-7");
    expect(listPreviewButton).not.toHaveClass("!h-6", "!w-6");
    expect(within(rowA).getByText("Object")).toBeInTheDocument();

    menu = openHeaderConfigMenu();
    await user.click(within(menu).getByRole("button", { name: "Compact view" }));
    actionsHeader = screen.getByRole("columnheader", { name: "Actions" });
    rowA = await findRowByLabel("a.txt");
    expect(rowA).toHaveClass("h-9");
    expect(actionsHeader).toHaveClass("!py-1");
    const compactPreviewButtonAgain = within(rowA).getByRole("button", { name: "Preview" });
    expect(compactPreviewButtonAgain).toHaveClass("!h-6", "!w-6");
    expect(within(rowA).queryByText("Object")).not.toBeInTheDocument();
  });

  it("uses the compact browser toolbar by default and exposes upload and layout controls", async () => {
    const user = userEvent.setup();
    renderPage();
    await findRowByLabel("a.txt");

    const contextToolbar = getContextToolbar();
    const uploadButton = within(contextToolbar).getByRole("button", { name: "Upload" });
    const newFolderButton = within(contextToolbar).getByRole("button", { name: "New folder" });
    const refreshButton = within(contextToolbar).getByRole("button", { name: "Refresh" });
    const moreButton = within(contextToolbar).getByRole("button", { name: "More" });
    const operationsButton = within(contextToolbar).getByRole("button", { name: "Operations" });

    expect(screen.getAllByRole("toolbar")).toHaveLength(1);
    expect(within(contextToolbar).getByRole("button", { name: "Select bucket" })).toBeInTheDocument();
    expect(screen.queryByRole("toolbar", { name: "Browser actions bar" })).not.toBeInTheDocument();
    expect(within(contextToolbar).queryByRole("button", { name: "Download" })).not.toBeInTheDocument();
    expect(uploadButton).toHaveClass("h-7", "w-7", "rounded-md");
    expect(uploadButton).not.toHaveClass("h-9", "w-9", "rounded-xl");
    expect(newFolderButton).toHaveClass("h-7", "w-7", "rounded-md");
    expect(refreshButton).toHaveClass("h-7", "w-7", "rounded-md");
    expect(moreButton).toHaveClass("h-7", "w-7", "rounded-md");
    expect(Boolean(operationsButton.compareDocumentPosition(uploadButton) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(uploadButton.compareDocumentPosition(newFolderButton) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(newFolderButton.compareDocumentPosition(refreshButton) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(refreshButton.compareDocumentPosition(moreButton) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);

    await user.click(uploadButton);
    const uploadMenu = await screen.findByRole("menu", { name: "Upload" });
    expect(within(uploadMenu).getByRole("menuitem", { name: "Upload files" })).toBeInTheDocument();
    expect(within(uploadMenu).getByRole("menuitem", { name: "Upload folder" })).toBeInTheDocument();

    const menu = await openContextMoreMenu(user);
    expect(within(menu).getByText("Compact view")).toBeInTheDocument();
    expect(within(menu).getByText("Transfers")).toBeInTheDocument();
    expect(within(menu).getByRole("menuitemcheckbox", { name: /Folders panel/i })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitemcheckbox", { name: /Inspector panel/i })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitemcheckbox", { name: /Action bar/i })).toHaveAttribute("aria-checked", "false");

    await user.click(within(menu).getByRole("menuitemcheckbox", { name: /Action bar/i }));
    await waitFor(() => {
      expect(screen.getByRole("toolbar", { name: "Browser actions bar" })).toBeInTheDocument();
    });
  });

  it("shows selection actions inline and secondary actions in More when the action bar is enabled", async () => {
    const user = userEvent.setup();
    renderPage();
    await enableActionBar(user);

    await user.click(await findRowByLabel("a.txt"));

    const actionsToolbar = getActionsToolbar();

    expect(within(actionsToolbar).getByText("1 selected")).toBeInTheDocument();
    expect(within(actionsToolbar).getByRole("button", { name: "Upload files" })).toBeInTheDocument();
    expect(within(actionsToolbar).getByRole("button", { name: "New folder" })).toBeInTheDocument();
    expect(within(actionsToolbar).getByRole("button", { name: "Download" })).toBeInTheDocument();
    expect(within(actionsToolbar).getByRole("button", { name: "Open" })).toBeDisabled();
    expect(within(actionsToolbar).getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(within(actionsToolbar).getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(within(actionsToolbar).queryByRole("button", { name: "Cut" })).not.toBeInTheDocument();
    expect(within(actionsToolbar).queryByRole("button", { name: "Copy URL" })).not.toBeInTheDocument();

    await user.click(within(actionsToolbar).getByRole("button", { name: "More" }));
    const menu = await screen.findByRole("menu", { name: "More" });

    expect(within(menu).getByRole("menuitem", { name: "Copy URL" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Cut" })).toBeInTheDocument();
  });

  it("keeps a single folder selection downloadable with a stable toolbar label", async () => {
    const user = userEvent.setup();
    renderPage();
    await enableActionBar(user);

    await user.click(await findRowByLabel("docs"));

    const actionsToolbar = getActionsToolbar();

    expect(within(actionsToolbar).getByText("1 selected")).toBeInTheDocument();
    expect(within(actionsToolbar).getByRole("button", { name: "Download" })).toBeEnabled();
    expect(within(actionsToolbar).queryByRole("button", { name: "Download folder" })).not.toBeInTheDocument();
    expect(within(actionsToolbar).getByRole("button", { name: "Open" })).toBeEnabled();
  });

  it("preserves refresh behavior from the compact toolbar", async () => {
    const user = userEvent.setup();
    renderPage();
    await findRowByLabel("a.txt");

    const initialCalls = listBrowserObjectsMock.mock.calls.length;
    await user.click(within(getContextToolbar()).getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(listBrowserObjectsMock.mock.calls.length).toBe(initialCalls + 1);
    });
  });

  it("keeps selection actions out of the compact toolbar and available from the selection context menu", async () => {
    const user = userEvent.setup();
    renderPage();

    const rowA = await findRowByLabel("a.txt");
    const rowB = await findRowByLabel("b.txt");

    await user.click(rowA);
    fireEvent.click(rowB, { ctrlKey: true });

    const contextToolbar = getContextToolbar();
    expect(within(contextToolbar).queryByRole("button", { name: "Download" })).not.toBeInTheDocument();
    expect(within(contextToolbar).queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
    expect(within(contextToolbar).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();

    fireEvent.contextMenu(rowB);
    const menu = await screen.findByRole("menu");

    expect(within(menu).getByRole("button", { name: "Download" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("hides main-browser-only status and panel controls from More in embedded mode", async () => {
    const user = userEvent.setup();
    renderEmbeddedPage();
    await findRowByLabel("a.txt");

    expect(screen.getAllByRole("toolbar")).toHaveLength(2);
    expect(within(getContextToolbar()).getByRole("button", { name: "Operations" })).toBeInTheDocument();
    expect(within(getActionsToolbar()).getByText("No selection")).toBeInTheDocument();

    await user.click(within(getActionsToolbar()).getByRole("button", { name: "More" }));
    const menu = await screen.findByRole("menu", { name: "More" });

    expect(within(menu).queryByText("Compact view")).not.toBeInTheDocument();
    expect(within(menu).queryByRole("menuitemcheckbox", { name: /Folders panel/i })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("menuitemcheckbox", { name: /Inspector panel/i })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("menuitemcheckbox", { name: /Action bar/i })).not.toBeInTheDocument();
  });

  it("supports Cmd/Ctrl click toggle selection", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await findRowByLabel("a.txt"));
    fireEvent.click(await findRowByLabel("b.txt"), { ctrlKey: true });

    expect(screen.getByRole("checkbox", { name: "Select a.txt" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select b.txt" })).toBeChecked();

    fireEvent.click(await findRowByLabel("b.txt"), { ctrlKey: true });

    expect(screen.getByRole("checkbox", { name: "Select a.txt" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select b.txt" })).not.toBeChecked();
  });

  it("supports Shift click range selection", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await findRowByLabel("a.txt"));
    fireEvent.click(await findRowByLabel("c.txt"), { shiftKey: true });

    expect(screen.getByRole("checkbox", { name: "Select a.txt" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select b.txt" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select c.txt" })).toBeChecked();
  });

  it("keeps double-click default action for folders", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.dblClick(await findRowByLabel("docs"));

    await waitFor(() => {
      expect(listBrowserObjectsMock).toHaveBeenCalledWith(
        "acc-1",
        "bucket-1",
        expect.objectContaining({ prefix: "docs/" })
      );
    });
  });

  it("opens the single-row actions menu from More actions and only opens Details on explicit choice", async () => {
    const user = userEvent.setup();
    renderPage({ defaultShowInspector: false });

    await user.click(await findRowByLabel("a.txt"));
    expect(screen.queryByRole("tablist", { name: "Inspector tabs" })).not.toBeInTheDocument();

    await user.click(within(await findRowByLabel("a.txt")).getByRole("button", { name: "More actions" }));
    const menu = await screen.findByRole("menu");

    expect(within(menu).getByRole("button", { name: "Details" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Preview" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Download" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Copy URL" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Cut" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Advanced" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Inspector tabs" })).not.toBeInTheDocument();

    await user.click(within(menu).getByRole("button", { name: "Details" }));

    expect(await screen.findByRole("tablist", { name: "Inspector tabs" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("tabpanel", { name: "Details" })).getByText("a.txt")).toBeInTheDocument();
  });

  it("does not show a focused fallback in Selection tab when no object is selected", async () => {
    const user = userEvent.setup();
    renderPage({ defaultShowInspector: true });

    await user.click(within(await findRowByLabel("a.txt")).getByRole("button", { name: "More actions" }));
    await user.click(within(await screen.findByRole("menu")).getByRole("button", { name: "Details" }));
    const objectsList = screen.getByLabelText("Objects list");
    (objectsList as HTMLDivElement).focus();
    fireEvent.keyDown(objectsList, { key: "Escape" });

    await user.click(screen.getByRole("tab", { name: "Selection" }));

    expect(screen.queryByText(/^Focused:/)).not.toBeInTheDocument();
    expect(screen.getByText("Select one or more objects to see selection actions.")).toBeInTheDocument();
  });

  it("shows folder row actions from More actions with the same single-item menu content", async () => {
    const user = userEvent.setup();
    renderPage({ defaultShowInspector: false });

    await user.click(within(await findRowByLabel("docs")).getByRole("button", { name: "More actions" }));
    const menu = await screen.findByRole("menu");

    expect(within(menu).getByRole("button", { name: "Details" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Open" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Download folder" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Cut" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("keeps More actions available when the inspector panel is disabled and omits Details", async () => {
    const user = userEvent.setup();
    renderPage({ defaultShowInspector: false, allowInspectorPanel: false });

    const row = await findRowByLabel("a.txt");
    const moreButton = within(row).getByRole("button", { name: "More actions" });
    expect(moreButton).toBeInTheDocument();

    await user.click(moreButton);
    const menu = await screen.findByRole("menu");

    expect(within(menu).queryByRole("button", { name: "Details" })).not.toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Preview" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Download" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Inspector tabs" })).not.toBeInTheDocument();
  });

  it("keeps inspector tabs on one line and removes the counter from the Selection tab", async () => {
    const user = userEvent.setup();
    renderPage({ defaultShowInspector: true });

    await user.click(await findRowByLabel("a.txt"));

    const tablist = screen.getByRole("tablist", { name: "Inspector tabs" });
    const tabs = within(tablist).getAllByRole("tab");
    const selectionTab = within(tablist).getByRole("tab", { name: "Selection" });

    expect(tablist).toHaveClass("flex-nowrap");
    expect(tabs).toHaveLength(4);
    expect(selectionTab).toHaveTextContent(/^Selection$/);

    await user.click(selectionTab);

    expect(within(screen.getByRole("tabpanel", { name: "Selection" })).getByText("1 selected")).toBeInTheDocument();
  });

  it("updates Details on simple row click when Details tab is active", async () => {
    const user = userEvent.setup();
    renderPage({ defaultShowInspector: true });

    await user.click(await findRowByLabel("a.txt"));
    await user.click(screen.getByRole("tab", { name: "Details" }));
    await waitFor(() => {
      expect(within(screen.getByRole("tabpanel", { name: "Details" })).getByText("a.txt")).toBeInTheDocument();
    });

    await user.click(await findRowByLabel("b.txt"));

    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => {
      expect(within(screen.getByRole("tabpanel", { name: "Details" })).getByText("b.txt")).toBeInTheDocument();
    });
  });

  it("clears Details content when Details is active and multi-selection is applied", async () => {
    const user = userEvent.setup();
    renderPage({ defaultShowInspector: true });

    await user.click(await findRowByLabel("a.txt"));
    await user.click(screen.getByRole("tab", { name: "Details" }));
    fireEvent.click(await findRowByLabel("b.txt"), { ctrlKey: true });

    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => {
      expect(screen.getByText("Select a single object to view details.")).toBeInTheDocument();
    });
  });

  it("clears Details content when Escape clears selection while Details is active", async () => {
    const user = userEvent.setup();
    renderPage({ defaultShowInspector: true });

    await user.click(await findRowByLabel("a.txt"));
    await user.click(screen.getByRole("tab", { name: "Details" }));

    const objectsList = screen.getByLabelText("Objects list");
    (objectsList as HTMLDivElement).focus();
    fireEvent.keyDown(objectsList, { key: "Escape" });

    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("checkbox", { name: "Select a.txt" })).not.toBeChecked();
    await waitFor(() => {
      expect(screen.getByText("Select a single object to view details.")).toBeInTheDocument();
    });
  });

  it("supports full keyboard navigation: arrows, range, home/end, space, enter and escape", async () => {
    renderPage();
    await findRowByLabel("docs");

    const objectsList = screen.getByLabelText("Objects list");
    (objectsList as HTMLDivElement).focus();

    fireEvent.keyDown(objectsList, { key: "ArrowDown" });
    expect(screen.getByRole("checkbox", { name: "Select docs" })).toBeChecked();

    fireEvent.keyDown(objectsList, { key: "ArrowDown", shiftKey: true });
    expect(screen.getByRole("checkbox", { name: "Select docs" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select a.txt" })).toBeChecked();

    fireEvent.keyDown(objectsList, { key: "End" });
    expect(screen.getByRole("checkbox", { name: "Select c.txt" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select docs" })).not.toBeChecked();

    fireEvent.keyDown(objectsList, { key: " " });
    expect(screen.getByRole("checkbox", { name: "Select c.txt" })).not.toBeChecked();

    fireEvent.keyDown(objectsList, { key: "Home" });
    expect(screen.getByRole("checkbox", { name: "Select docs" })).toBeChecked();

    fireEvent.keyDown(objectsList, { key: "Escape" });
    expect(screen.getByRole("checkbox", { name: "Select docs" })).not.toBeChecked();

    fireEvent.keyDown(objectsList, { key: "Enter" });
    await waitFor(() => {
      expect(listBrowserObjectsMock).toHaveBeenCalledWith(
        "acc-1",
        "bucket-1",
        expect.objectContaining({ prefix: "docs/" })
      );
    });
  });

  it("renders CORS warning with inline info action and moves CORS button into popover", async () => {
    const user = userEvent.setup();
    getBucketCorsStatusMock.mockResolvedValue({ enabled: false, rules: [] });
    renderPage();

    const warningText = "Direct download/upload is not allowed on this bucket.";
    expect(await screen.findByText(warningText)).toBeInTheDocument();

    const warningLine = screen.getByText(warningText).closest("p");
    expect(warningLine).not.toBeNull();
    const infoButton = within(warningLine as HTMLElement).getByRole("button", { name: "CORS actions" });
    expect(infoButton).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `Add ${window.location.origin} to CORS` })).not.toBeInTheDocument();

    await user.click(infoButton);

    expect(
      await screen.findByText(`Allow direct access from ${window.location.origin} by adding CORS rules to this bucket.`)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Add ${window.location.origin} to CORS` })).toBeInTheDocument();
  });

  it("applies CORS from popover and closes popover on Escape/outside click", async () => {
    const user = userEvent.setup();
    getBucketCorsStatusMock.mockResolvedValue({ enabled: false, rules: [] });
    ensureBucketCorsMock.mockResolvedValue({ enabled: true, rules: [] });
    renderPage();

    const warningLine = (await screen.findByText("Direct download/upload is not allowed on this bucket.")).closest("p");
    if (!warningLine) {
      throw new Error("CORS warning line not found");
    }
    await user.click(within(warningLine).getByRole("button", { name: "CORS actions" }));
    expect(screen.getByRole("button", { name: `Add ${window.location.origin} to CORS` })).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: `Add ${window.location.origin} to CORS` })).not.toBeInTheDocument();
    });

    await user.click(within(warningLine).getByRole("button", { name: "CORS actions" }));
    expect(screen.getByRole("button", { name: `Add ${window.location.origin} to CORS` })).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: `Add ${window.location.origin} to CORS` })).not.toBeInTheDocument();
    });

    await user.click(within(warningLine).getByRole("button", { name: "CORS actions" }));
    await user.click(screen.getByRole("button", { name: `Add ${window.location.origin} to CORS` }));

    await waitFor(() => {
      expect(ensureBucketCorsMock).toHaveBeenCalledWith("acc-1", "bucket-1", window.location.origin);
    });
    expect(await screen.findByText("CORS rules updated for this bucket.")).toBeInTheDocument();
  });
});
