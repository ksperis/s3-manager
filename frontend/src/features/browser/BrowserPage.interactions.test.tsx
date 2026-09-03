import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import BrowserEmbed from "./BrowserEmbed";
import BrowserPage from "./BrowserPage";
import { setSessionUserCache } from "../../utils/workspaces";
import { ApiError } from "../../api/client";
import type { ExecutionContext } from "../../api/executionContexts";
import {
  BROWSER_ROOT_CONTEXT_SELECTIONS_STORAGE_KEY,
  BROWSER_ROOT_UI_STATE_V2_STORAGE_KEY,
} from "./browserRootUiState";
import {
  BROWSER_EMBEDDED_COLUMNS_STORAGE_KEY,
  BROWSER_EMBEDDED_COLUMN_WIDTHS_STORAGE_KEY,
} from "./browserEmbeddedColumnsState";
import { OBJECT_PREVIEW_MAX_BYTES } from "../shared/ObjectPreview";

const searchBrowserBucketsMock = vi.fn();
const fetchBrowserUsageSummaryMock = vi.fn();
const fetchBrowserSettingsMock = vi.fn();
const listBrowserObjectsMock = vi.fn();
const fetchBrowserObjectColumnsMock = vi.fn();
const getBucketVersioningMock = vi.fn();
const getBucketCorsStatusMock = vi.fn();
const ensureBucketCorsMock = vi.fn();
const createBrowserBucketMock = vi.fn();
const listObjectVersionsMock = vi.fn();
const fetchObjectMetadataMock = vi.fn();
const getObjectTagsMock = vi.fn();
const copyObjectMock = vi.fn();
const deleteObjectsMock = vi.fn();
const updateObjectMetadataMock = vi.fn();
const updateObjectTagsMock = vi.fn();
const updateObjectAclMock = vi.fn();
const getObjectLegalHoldMock = vi.fn();
const getObjectRetentionMock = vi.fn();
const updateObjectLegalHoldMock = vi.fn();
const updateObjectRetentionMock = vi.fn();
const restoreObjectMock = vi.fn();
const cleanupObjectVersionsMock = vi.fn();
const createFolderMock = vi.fn();
const presignObjectMock = vi.fn();
const proxyDownloadMock = vi.fn();
const proxyUploadMock = vi.fn();
const initiateMultipartUploadMock = vi.fn();
const presignPartMock = vi.fn();
const completeMultipartUploadMock = vi.fn();
const abortMultipartUploadMock = vi.fn();
const createObjectUrlMock = vi.fn();
const revokeObjectUrlMock = vi.fn();

const getBucketStatsMock = vi.fn();
const getBucketPropertiesMock = vi.fn();
const getBucketPolicyMock = vi.fn();
const getBucketLoggingMock = vi.fn();
const getBucketWebsiteMock = vi.fn();
const fetchMock = vi.fn();

type TestBrowserSidebarRenderer = (args: {
  compact: boolean;
  variant: "desktop" | "mobile";
  closeMobile: () => void;
}) => ReactNode;

const browserLayoutSlotMock = vi.hoisted(() => ({
  setSidebarRendererForTest: null as
    | ((renderer: TestBrowserSidebarRenderer | null) => void)
    | null,
  closeMobile: vi.fn(),
}));
const browserContextMock = vi.hoisted(() => ({
  value: {
    contexts: [],
    selectedContextId: null,
    selectedContext: null,
    setSelectedContextId: vi.fn(),
    requiresContextSelection: false,
    hasContext: true,
    selectorForApi: "acc-1",
    selectedKind: null,
    sessionAccountName: null,
    accessError: null,
  } as {
    contexts: ExecutionContext[];
    selectedContextId: string | null;
    selectedContext: ExecutionContext | null;
    setSelectedContextId: (id: string | null) => void;
    requiresContextSelection: boolean;
    hasContext: boolean;
    selectorForApi: string | null;
    selectedKind: ExecutionContext["kind"] | null;
    sessionAccountName: string | null;
    accessError: string | null;
  },
}));

vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );
  return {
    ...actual,
    unstable_usePrompt: () => {},
  };
});

vi.mock("./BrowserLayout", () => ({
  useBrowserSidebarSlot: () => ({
    setSidebarBody: (renderer: TestBrowserSidebarRenderer | null) => {
      browserLayoutSlotMock.setSidebarRendererForTest?.(renderer);
    },
  }),
}));

vi.mock("./BrowserContext", () => ({
  useBrowserContext: () => browserContextMock.value,
}));

vi.mock("../../api/browser", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/browser")>(
      "../../api/browser",
    );
  return {
    ...actual,
    searchBrowserBuckets: (...args: unknown[]) =>
      searchBrowserBucketsMock(...args),
    fetchBrowserUsageSummary: (...args: unknown[]) =>
      fetchBrowserUsageSummaryMock(...args),
    fetchBrowserSettings: (...args: unknown[]) =>
      fetchBrowserSettingsMock(...args),
    listBrowserObjects: (...args: unknown[]) => listBrowserObjectsMock(...args),
    fetchBrowserObjectColumns: (...args: unknown[]) =>
      fetchBrowserObjectColumnsMock(...args),
    getBucketVersioning: (...args: unknown[]) =>
      getBucketVersioningMock(...args),
    getBucketCorsStatus: (...args: unknown[]) =>
      getBucketCorsStatusMock(...args),
    ensureBucketCors: (...args: unknown[]) => ensureBucketCorsMock(...args),
    createBrowserBucket: (...args: unknown[]) =>
      createBrowserBucketMock(...args),
    listObjectVersions: (...args: unknown[]) => listObjectVersionsMock(...args),
    fetchObjectMetadata: (...args: unknown[]) =>
      fetchObjectMetadataMock(...args),
    getObjectTags: (...args: unknown[]) => getObjectTagsMock(...args),
    copyObject: (...args: unknown[]) => copyObjectMock(...args),
    deleteObjects: (...args: unknown[]) => deleteObjectsMock(...args),
    updateObjectMetadata: (...args: unknown[]) =>
      updateObjectMetadataMock(...args),
    updateObjectTags: (...args: unknown[]) => updateObjectTagsMock(...args),
    updateObjectAcl: (...args: unknown[]) => updateObjectAclMock(...args),
    getObjectLegalHold: (...args: unknown[]) =>
      getObjectLegalHoldMock(...args),
    getObjectRetention: (...args: unknown[]) =>
      getObjectRetentionMock(...args),
    updateObjectLegalHold: (...args: unknown[]) =>
      updateObjectLegalHoldMock(...args),
    updateObjectRetention: (...args: unknown[]) =>
      updateObjectRetentionMock(...args),
    restoreObject: (...args: unknown[]) => restoreObjectMock(...args),
    cleanupObjectVersions: (...args: unknown[]) =>
      cleanupObjectVersionsMock(...args),
    createFolder: (...args: unknown[]) => createFolderMock(...args),
    presignObject: (...args: unknown[]) => presignObjectMock(...args),
    proxyDownload: (...args: unknown[]) => proxyDownloadMock(...args),
    proxyUpload: (...args: unknown[]) => proxyUploadMock(...args),
  };
});

vi.mock("../../api/browserMultipart", () => ({
  initiateMultipartUpload: (...args: unknown[]) =>
    initiateMultipartUploadMock(...args),
  presignPart: (...args: unknown[]) => presignPartMock(...args),
  completeMultipartUpload: (...args: unknown[]) =>
    completeMultipartUploadMock(...args),
  abortMultipartUpload: (...args: unknown[]) =>
    abortMultipartUploadMock(...args),
}));

vi.mock("../../api/buckets", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/buckets")>(
      "../../api/buckets",
    );
  return {
    ...actual,
    getBucketStats: (...args: unknown[]) => getBucketStatsMock(...args),
    getBucketProperties: (...args: unknown[]) =>
      getBucketPropertiesMock(...args),
    getBucketPolicy: (...args: unknown[]) => getBucketPolicyMock(...args),
    getBucketLogging: (...args: unknown[]) => getBucketLoggingMock(...args),
    getBucketWebsite: (...args: unknown[]) => getBucketWebsiteMock(...args),
  };
});

function BrowserSidebarTestHost({ children }: { children: ReactNode }) {
  const [renderer, setRenderer] =
    useState<TestBrowserSidebarRenderer | null>(null);
  browserLayoutSlotMock.setSidebarRendererForTest = (nextRenderer) => {
    setRenderer(() => nextRenderer);
  };
  useEffect(
    () => () => {
      browserLayoutSlotMock.setSidebarRendererForTest = null;
    },
    [],
  );
  return (
    <>
      {renderer
        ? renderer({
            compact: false,
            variant: "desktop",
            closeMobile: browserLayoutSlotMock.closeMobile,
          })
        : null}
      {children}
    </>
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current location">{`${location.pathname}${location.search}`}</output>;
}

function makeExecutionContext(overrides: Partial<ExecutionContext>): ExecutionContext {
  return {
    kind: "portal_account",
    id: "101",
    display_name: "Research account",
    tags: [],
    endpoint_tags: [],
    endpoint_name: "Default endpoint",
    endpoint_is_default: true,
    endpoint_url: "https://s3.example.test",
    storage_endpoint_capabilities: {},
    capabilities: {
      can_manage_iam: false,
      sts_capable: false,
      admin_api_capable: false,
    },
    ...overrides,
  };
}

function setBrowserContext(overrides: Partial<typeof browserContextMock.value> = {}) {
  browserContextMock.value = {
    contexts: [],
    selectedContextId: null,
    selectedContext: null,
    setSelectedContextId: vi.fn(),
    requiresContextSelection: false,
    hasContext: true,
    selectorForApi: "acc-1",
    selectedKind: null,
    sessionAccountName: null,
    accessError: null,
    ...overrides,
  };
}

type RenderPageOptions = {
  defaultShowInspector?: boolean;
  defaultShowFolders?: boolean;
  initialEntry?: string;
  allowInspectorPanel?: boolean;
  allowFoldersPanel?: boolean;
  accountIdForApi?: string;
  executionContextKind?: ComponentProps<typeof BrowserPage>["executionContextKind"];
  workspaceSurface?: ComponentProps<typeof BrowserPage>["workspaceSurface"];
  functionalProfile?: ComponentProps<typeof BrowserPage>["functionalProfile"];
  lockedBucketName?: string;
  lockedBucketLabel?: string;
  storageEndpointCapabilities?: ComponentProps<typeof BrowserPage>["storageEndpointCapabilities"];
  onOpenObjectDetailsRoute?: ComponentProps<typeof BrowserPage>["onOpenObjectDetailsRoute"];
  onCreatePublicLinkForObject?: ComponentProps<typeof BrowserPage>["onCreatePublicLinkForObject"];
  deletedObjectsOptions?: ComponentProps<typeof BrowserPage>["deletedObjectsOptions"];
};

function renderPageElement({
  defaultShowInspector = false,
  defaultShowFolders = false,
  initialEntry = "/browser",
  allowInspectorPanel = true,
  allowFoldersPanel = true,
  accountIdForApi,
  executionContextKind,
  workspaceSurface,
  functionalProfile,
  lockedBucketName,
  lockedBucketLabel,
  storageEndpointCapabilities,
  onOpenObjectDetailsRoute,
  onCreatePublicLinkForObject,
  deletedObjectsOptions,
}: RenderPageOptions = {}) {
  return (
    <BrowserSidebarTestHost>
      <MemoryRouter initialEntries={[initialEntry]}>
        <BrowserPage
          accountIdForApi={accountIdForApi}
          executionContextKind={executionContextKind}
          defaultShowInspector={defaultShowInspector}
          defaultShowFolders={defaultShowFolders}
          allowInspectorPanel={allowInspectorPanel}
          allowFoldersPanel={allowFoldersPanel}
          workspaceSurface={workspaceSurface}
          functionalProfile={functionalProfile}
          layoutMode={
            defaultShowInspector || defaultShowFolders ? "workbench" : undefined
          }
          density={
            initialEntry === "/browser"
              ? undefined
              : functionalProfile === "portal"
                ? "comfortable"
                : "compact"
          }
          capabilityFacts={
            functionalProfile === "portal"
              ? {
                  canWriteObjects: true,
                  canDeleteObjects: true,
                  canRestoreObjects: true,
                  canCreatePublicLinks: Boolean(onCreatePublicLinkForObject),
                }
              : undefined
          }
          lockedBucketName={lockedBucketName}
          lockedBucketLabel={lockedBucketLabel}
          storageEndpointCapabilities={storageEndpointCapabilities}
          onOpenObjectDetailsRoute={onOpenObjectDetailsRoute}
          onCreatePublicLinkForObject={onCreatePublicLinkForObject}
          deletedObjectsOptions={deletedObjectsOptions}
        />
        <LocationProbe />
      </MemoryRouter>
    </BrowserSidebarTestHost>
  );
}

function renderPage(options: RenderPageOptions = {}) {
  return render(renderPageElement(options));
}

function renderEmbeddedPage({
  initialEntry = "/manager/browser",
  accountIdForApi = "acc-1",
  executionContextKind = "account",
}: {
  initialEntry?: string;
  accountIdForApi?: string;
  executionContextKind?: ComponentProps<typeof BrowserPage>["executionContextKind"];
} = {}) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <BrowserEmbed
        accountIdForApi={accountIdForApi}
        executionContextKind={executionContextKind}
        hasContext
        workspaceSurface="manager"
        functionalProfile="advanced"
        layoutMode="standard"
        density="compact"
        capabilityFacts={{
          canWriteObjects: true,
          canDeleteObjects: true,
          canRestoreObjects: true,
          canCreatePublicLinks: false,
        }}
      />
    </MemoryRouter>,
  );
}

async function findRowByLabel(label: string): Promise<HTMLElement> {
  const matches = await screen.findAllByText(label);
  const row = matches
    .map((match) => match.closest<HTMLElement>("[data-browser-item]"))
    .find((candidate): candidate is HTMLElement => Boolean(candidate));
  if (!row) {
    throw new Error(`Unable to find row for label: ${label}`);
  }
  return row;
}

function openHeaderConfigMenu() {
  const actionsHeader = screen.getByRole("columnheader", { name: "Actions" });
  fireEvent.contextMenu(actionsHeader);
  return screen.getByRole("menu");
}

function getObjectTableCols() {
  const table = screen.getByRole("table");
  return Array.from(table.querySelectorAll("col"));
}

function getContextToolbar() {
  return screen.getByRole("toolbar", { name: "Browser context bar" });
}

function getActionsToolbar() {
  return screen.getByRole("toolbar", { name: "Browser actions bar" });
}

function getContextPanel() {
  return screen.getByRole("tabpanel", { name: "Context" });
}

function getCurrentBucketPanel() {
  const section = screen.getByRole("region", { name: "Current bucket" });
  return within(section);
}

function getOtherBucketsPanel() {
  const section = screen.getByTestId("browser-workspace-sidebar");
  return within(section);
}

async function waitForOpenedMoreMenu(
  previousMenus: Set<HTMLElement>,
  timeout = 5_000,
) {
  let openedMenu: HTMLElement | undefined;
  await waitFor(() => {
    const menus = screen.queryAllByRole("menu", { name: "More" });
    openedMenu = menus.find((menu) => !previousMenus.has(menu)) ?? menus.at(-1);
    expect(openedMenu).toBeTruthy();
  }, { timeout });
  if (!openedMenu) {
    throw new Error("Unable to find opened More menu");
  }
  return openedMenu;
}

function seedBrowserRootUiState(value: unknown) {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const layout = record.layout && typeof record.layout === "object"
    ? record.layout as Record<string, unknown>
    : {};
  const activeLayout =
    layout.showFolders === true ||
    layout.showInspector === true ||
    layout.showActionBar === true
      ? "workbench"
      : "standard";
  window.localStorage.setItem(
    BROWSER_ROOT_UI_STATE_V2_STORAGE_KEY,
    JSON.stringify({
      activeLayout,
      density: record.density === "comfortable" ? "comfortable" : "compact",
      layouts: {
        standard: {
          objectColumns: record.objectColumns,
          objectColumnWidths: record.objectColumnWidths,
        },
        workbench: {
          ...layout,
          objectColumns: record.objectColumns,
          objectColumnWidths: record.objectColumnWidths,
        },
      },
    }),
  );
  if (record.contextSelections) {
    window.sessionStorage.setItem(
      BROWSER_ROOT_CONTEXT_SELECTIONS_STORAGE_KEY,
      JSON.stringify(record.contextSelections),
    );
  }
}

function setBrowserLayoutRect(width: number, height = 720) {
  const layout = screen.getByTestId("browser-layout");
  Object.defineProperty(layout, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
  fireEvent(window, new Event("resize"));
  return layout;
}

async function openContextMoreMenu(user: ReturnType<typeof userEvent.setup>) {
  const previousMenus = new Set(screen.queryAllByRole("menu", { name: "More" }));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const toolbar =
      screen.queryByRole("toolbar", { name: "Browser context bar" }) &&
      within(getContextToolbar()).queryByRole("button", { name: "More" })
        ? getContextToolbar()
        : getActionsToolbar();
    await user.click(within(toolbar).getByRole("button", { name: "More" }));
    try {
      return await waitForOpenedMoreMenu(previousMenus);
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  throw new Error("Unable to open More menu");
}

function expectPassiveStatusBadge(badge: HTMLElement) {
  const className = badge.getAttribute("class") ?? "";
  expect(className).toContain("rounded-full");
  expect(className).not.toContain("rounded-md");
  expect(className).not.toContain("shadow-sm");
  expect(className).not.toContain("hover:border-primary");
}

async function openActionsMoreMenu(user: ReturnType<typeof userEvent.setup>) {
  const previousMenus = new Set(screen.queryAllByRole("menu", { name: "More" }));
  await user.click(
    within(getActionsToolbar()).getByRole("button", { name: "More" }),
  );
  return waitForOpenedMoreMenu(previousMenus);
}

async function openColumnsSubmenuFromMore(
  user: ReturnType<typeof userEvent.setup>,
) {
  const moreMenu = await openContextMoreMenu(user);
  await user.click(
    within(moreMenu).getByRole("menuitem", { name: /^Columns/i }),
  );
  return await screen.findByRole("menu", { name: "Columns" });
}

async function enableActionBar(user: ReturnType<typeof userEvent.setup>) {
  const row = await findRowByLabel("a.txt");
  if (screen.queryByRole("toolbar", { name: "Browser actions bar" })) {
    return;
  }
  await user.click(row);
  await waitFor(() => {
    expect(screen.getByRole("toolbar", { name: "Browser actions bar" })).toBeInTheDocument();
  });
}

async function copyOrCutItem(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  action: "Copy" | "Cut" = "Copy",
) {
  const row = await findRowByLabel(label);
  fireEvent.contextMenu(row);
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("button", { name: action }));
}

async function pasteFromCurrentPath(user: ReturnType<typeof userEvent.setup>) {
  const actionsToolbar = screen.queryByRole("toolbar", {
    name: "Browser actions bar",
  });
  if (actionsToolbar) {
    const inlinePasteButton = within(actionsToolbar).queryByRole("button", {
      name: /^Paste/,
    });
    if (inlinePasteButton) {
      await user.click(inlinePasteButton);
      return;
    }
  }
  const menu = await openContextMoreMenu(user);
  await user.click(within(menu).getByRole("menuitem", { name: /^Paste/ }));
}

async function openOperationsPanel(user: ReturnType<typeof userEvent.setup>) {
  const panel = await screen.findByRole("complementary", {
    name: "Operations",
  });
  const expandButton = within(panel).queryByRole("button", {
    name: "Expand operations",
  });
  if (expandButton) {
    await user.click(expandButton);
  }
  return panel;
}

function createAbortablePromise(signal?: AbortSignal) {
  return new Promise<never>((_resolve, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function copyOrCutSelection(
  user: ReturnType<typeof userEvent.setup>,
  labels: string[],
  action: "Copy" | "Cut" = "Copy",
) {
  await enableActionBar(user);
  for (const label of labels) {
    const checkbox = screen.getByRole("checkbox", { name: `Select ${label}` });
    if (!(checkbox as HTMLInputElement).checked) {
      await user.click(checkbox);
    }
  }
  const actionsToolbar = getActionsToolbar();
  if (action === "Copy") {
    await user.click(within(actionsToolbar).getByRole("button", { name: "Copy" }));
    return;
  }
  const menu = await openActionsMoreMenu(user);
  await user.click(within(menu).getByRole("menuitem", { name: "Cut" }));
}

describe("BrowserPage interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSessionUserCache(null);
    window.localStorage.clear();
    window.sessionStorage.clear();
    setBrowserContext();
    browserLayoutSlotMock.setSidebarRendererForTest = null;
    createObjectUrlMock.mockReturnValue("blob:preview-url");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: createObjectUrlMock,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: revokeObjectUrlMock,
    });
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(
      async (_input?: RequestInfo | URL, init?: RequestInit) => {
        const method = (init?.method || "GET").toUpperCase();
        if (method === "PUT" || method === "POST" || method === "DELETE") {
          return new Response(null, { status: 200 });
        }
        return new Response("direct-bytes", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      },
    );

    fetchBrowserSettingsMock.mockResolvedValue({
      allow_proxy_transfers: false,
      direct_upload_parallelism: 3,
      proxy_upload_parallelism: 2,
      direct_download_parallelism: 3,
      proxy_download_parallelism: 2,
      other_operations_parallelism: 2,
      streaming_zip_threshold_mb: 200,
    });
    fetchBrowserUsageSummaryMock.mockResolvedValue({ available: false });

    searchBrowserBucketsMock.mockResolvedValue({
      items: [{ name: "bucket-1" }],
      total: 1,
      page: 1,
      page_size: 50,
      has_next: false,
    });

    listBrowserObjectsMock.mockImplementation(
      (
        _accountId: string,
        _bucketName: string,
        payload?: { prefix?: string },
      ) => {
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
                etag: '"etag-docs"',
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
              etag: '"etag-a"',
            },
            {
              key: "b.txt",
              size: 20,
              last_modified: "2026-03-10T10:16:00Z",
              storage_class: "STANDARD",
              etag: '"etag-b"',
            },
            {
              key: "c.txt",
              size: 30,
              last_modified: "2026-03-10T10:17:00Z",
              storage_class: "STANDARD",
              etag: '"etag-c"',
            },
          ],
          prefixes: ["docs/"],
          is_truncated: false,
          next_continuation_token: null,
        });
      },
    );
    fetchBrowserObjectColumnsMock.mockImplementation(
      async (
        _accountId: string,
        _bucketName: string,
        payload?: { keys?: string[]; columns?: string[] },
      ) => ({
        items: (payload?.keys ?? []).map((key) => ({
          key,
          content_type: key === "b.txt" ? "text/csv" : "text/plain",
          tags_count: 0,
          metadata_count: 0,
          cache_control: null,
          expires: null,
          restore_status: null,
          metadata_status:
            payload?.columns?.some((column) => column !== "tags_count")
              ? "ready"
              : "error",
          tags_status: payload?.columns?.includes("tags_count")
            ? "ready"
            : "error",
        })),
      }),
    );

    getBucketVersioningMock.mockResolvedValue({
      enabled: false,
      status: "Disabled",
    });
    getBucketCorsStatusMock.mockResolvedValue({ enabled: true, rules: [] });
    ensureBucketCorsMock.mockResolvedValue({ enabled: true, rules: [] });
    createBrowserBucketMock.mockResolvedValue(undefined);
    listObjectVersionsMock.mockResolvedValue({
      versions: [],
      delete_markers: [],
      is_truncated: false,
      next_key_marker: null,
      next_version_id_marker: null,
    });
    fetchObjectMetadataMock.mockResolvedValue({
      key: "a.txt",
      size: 10,
      metadata: {},
      content_type: "text/plain",
    });
    getObjectTagsMock.mockResolvedValue({
      key: "a.txt",
      tags: [],
      version_id: null,
    });
    copyObjectMock.mockResolvedValue(undefined);
    deleteObjectsMock.mockResolvedValue(1);
    updateObjectMetadataMock.mockResolvedValue(undefined);
    updateObjectTagsMock.mockResolvedValue(undefined);
    updateObjectAclMock.mockResolvedValue(undefined);
    getObjectLegalHoldMock.mockResolvedValue({ key: "a.txt", status: "OFF" });
    getObjectRetentionMock.mockResolvedValue({
      key: "a.txt",
      mode: null,
      retain_until: null,
    });
    updateObjectLegalHoldMock.mockResolvedValue(undefined);
    updateObjectRetentionMock.mockResolvedValue(undefined);
    restoreObjectMock.mockResolvedValue(undefined);
    cleanupObjectVersionsMock.mockResolvedValue({
      deleted_versions: 1,
      deleted_delete_markers: 0,
    });
    createFolderMock.mockResolvedValue(undefined);
    presignObjectMock.mockImplementation(
      async (_accountId: string, _bucketName: string, payload?: { key?: string }) => ({
        url: `https://example.test/${payload?.key ?? "object"}`,
        method: "PUT",
        expires_in: 1800,
        headers: {},
      }),
    );
    proxyDownloadMock.mockResolvedValue(
      new Blob(["proxy-bytes"], { type: "text/plain" }),
    );
    proxyUploadMock.mockResolvedValue(undefined);
    initiateMultipartUploadMock.mockResolvedValue({
      key: "large.bin",
      upload_id: "upload-1",
    });
    presignPartMock.mockResolvedValue({
      url: "https://example.test/upload-part",
      method: "PUT",
      expires_in: 1800,
      headers: {},
    });
    completeMultipartUploadMock.mockResolvedValue(undefined);
    abortMultipartUploadMock.mockResolvedValue(undefined);

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
    getBucketLoggingMock.mockResolvedValue({
      enabled: false,
      target_bucket: null,
    });
    getBucketWebsiteMock.mockResolvedValue({});
  });

  it("exposes a page heading without changing the browser chrome", async () => {
    renderPage();

    const heading = await screen.findByRole("heading", {
      level: 1,
      name: "Browser",
    });
    expect(heading).toHaveClass("sr-only");
  });

  it("keeps the embedded Browser below the parent page heading", async () => {
    renderEmbeddedPage();

    const heading = await screen.findByRole("heading", {
      level: 2,
      name: "Browser",
    });
    expect(heading).toHaveClass("sr-only");
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  it("uses the explicit connection kind for transfer guidance", async () => {
    const user = userEvent.setup();
    renderPage({
      accountIdForApi: "selector-without-prefix",
      executionContextKind: "connection",
    });

    await findRowByLabel("a.txt");
    const moreMenu = await openContextMoreMenu(user);

    expect(
      within(moreMenu).getByText(
        "Download/Upload mode: Presigned URLs are active. STS is not available for S3 connections. Presigned URLs are used instead.",
      ),
    ).toBeInTheDocument();
  });

  it("selects from the row while the accessible primary button activates without changing selection", async () => {
    const user = userEvent.setup();
    const onOpenObjectDetailsRoute = vi.fn();
    renderPage({ onOpenObjectDetailsRoute });

    const rowA = await findRowByLabel("a.txt");
    await user.click(rowA);
    expect(
      screen.getByRole("checkbox", { name: "Select a.txt" }),
    ).toBeChecked();

    await user.click(rowA);
    expect(
      screen.getByRole("checkbox", { name: "Select a.txt" }),
    ).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Open file b.txt" }));
    expect(onOpenObjectDetailsRoute).toHaveBeenCalledTimes(1);
    expect(onOpenObjectDetailsRoute).toHaveBeenCalledWith(
      expect.objectContaining({ key: "b.txt", initialTab: "preview" }),
    );
    expect(
      screen.getByRole("checkbox", { name: "Select a.txt" }),
    ).toBeChecked();

    expect(
      screen.queryByRole("tablist", { name: "Inspector tabs" }),
    ).not.toBeInTheDocument();
  });

  it("activates the primary name button only once during a double-click", async () => {
    const user = userEvent.setup();
    const onOpenObjectDetailsRoute = vi.fn();
    renderPage({ onOpenObjectDetailsRoute });

    await user.dblClick(
      await screen.findByRole("button", { name: "Open file a.txt" }),
    );

    expect(onOpenObjectDetailsRoute).toHaveBeenCalledTimes(1);
    expect(onOpenObjectDetailsRoute).toHaveBeenCalledWith(
      expect.objectContaining({ key: "a.txt", initialTab: "preview" }),
    );
  });

  it("shows header config menu only on /browser", async () => {
    const browserView = renderPage({ initialEntry: "/browser" });
    await findRowByLabel("a.txt");
    const mainMenu = openHeaderConfigMenu();
    expect(
      within(mainMenu).getByRole("menuitemradio", {
        name: "Compact density",
      }),
    ).toHaveAttribute("aria-checked", "true");
    expect(within(mainMenu).getByText("Reset columns")).toBeInTheDocument();
    browserView.unmount();

    renderPage({ initialEntry: "/manager/browser" });
    await findRowByLabel("a.txt");
    openHeaderConfigMenu();
    expect(screen.queryByText("Reset columns")).not.toBeInTheDocument();
    expect(screen.queryByText("Compact density")).not.toBeInTheDocument();
  });

  it("uses manager-equivalent chrome on /browser when advanced Browser access is disabled", async () => {
    const user = userEvent.setup();
    setSessionUserCache({
      id: 42,
      role: "ui_user",
      effective_access: { browser_advanced_features_enabled: false },
    });
    seedBrowserRootUiState({
      layout: { showFolders: true, showInspector: true, showActionBar: true },
    });

    renderPage({ initialEntry: "/browser" });
    await findRowByLabel("a.txt");

    const mainMenu = openHeaderConfigMenu();
    expect(within(mainMenu).queryByText("Reset columns")).not.toBeInTheDocument();
    expect(
      within(mainMenu).getByRole("menuitemradio", {
        name: "Compact density",
      }),
    ).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(document.body, { key: "Escape" });
    const moreMenu = await openContextMoreMenu(user);
    await user.click(
      within(moreMenu).getByRole("menuitemradio", {
        name: "Comfortable density",
      }),
    );
    expect(await findRowByLabel("a.txt")).toHaveClass("h-16");
    expect(screen.queryByRole("button", { name: "Create bucket" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tablist", { name: "Inspector tabs" }),
    ).not.toBeInTheDocument();
  });

  it("uses compact mode by default on /manager/browser", async () => {
    renderPage({ initialEntry: "/manager/browser" });
    const rowA = await findRowByLabel("a.txt");
    expect(rowA).toHaveClass("h-9");
    expect(
      within(rowA).getByRole("button", { name: "Open file a.txt" }),
    ).not.toHaveClass("min-h-11");
    for (const actionName of [
      "Download a.txt",
      "Delete a.txt",
      "More actions for a.txt",
    ]) {
      const action = within(rowA).getByRole("button", { name: actionName });
      expect(action).toHaveClass("!h-6", "!w-6");
      expect(action).not.toHaveClass("min-h-11", "min-w-11");
    }
    expect(
      screen.getByRole("table").querySelector("colgroup col:last-child"),
    ).toHaveStyle({ width: "108px" });
  });

  it("runs the Portal functional profile as a locked minimal browser", async () => {
    const user = userEvent.setup();
    const openObjectDetailsRoute = vi.fn();
    renderPage({
      initialEntry: "/portal/storage-spaces/research-data",
      accountIdForApi: "acc-portal",
      workspaceSurface: "portal",
      functionalProfile: "portal",
      lockedBucketName: "portal-bucket",
      lockedBucketLabel: "Research Data",
      onOpenObjectDetailsRoute: openObjectDetailsRoute,
    });

    const rowA = await findRowByLabel("a.txt");
    expect(rowA).toHaveClass("h-16");
    expect(
      within(rowA).getByRole("button", { name: "Open file a.txt" }),
    ).toHaveClass("min-h-11");
    for (const actionName of [
      "Download a.txt",
      "Delete a.txt",
      "More actions for a.txt",
    ]) {
      expect(
        within(rowA).getByRole("button", { name: actionName }),
      ).not.toHaveClass("!h-6", "!w-6");
    }
    expect(
      screen.getByRole("button", { name: "Selected storage space" }),
    ).toHaveTextContent("Research Data");
    expect(
      screen.getByRole("textbox", { name: "Search files" }),
    ).toHaveAttribute("placeholder", "Search files");
    expect(screen.queryByRole("tablist", { name: "Inspector tabs" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Bucket" })).not.toBeInTheDocument();
    expect(searchBrowserBucketsMock).not.toHaveBeenCalled();
    expect(fetchBrowserSettingsMock).toHaveBeenCalledWith("acc-portal", { workspaceSurface: "portal" });
    expect(listBrowserObjectsMock).toHaveBeenCalledWith(
      "acc-portal",
      "portal-bucket",
      expect.objectContaining({ workspaceSurface: "portal" }),
    );
    expect(getBucketVersioningMock).toHaveBeenCalledWith(
      "acc-portal",
      "portal-bucket",
      { workspaceSurface: "portal" },
    );

    expect(screen.queryByRole("button", { name: "Search options" })).not.toBeInTheDocument();
    expect(within(rowA).queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();
    expect(within(rowA).getByRole("button", { name: "Open file a.txt" })).toBeInTheDocument();
    expect(
      within(rowA).queryByRole("button", {
        name: "Create public link a.txt",
      }),
    ).not.toBeInTheDocument();
    expect(within(rowA).getByRole("button", { name: "More actions for a.txt" })).toBeInTheDocument();

    fireEvent.contextMenu(rowA, { clientX: 40, clientY: 40 });
    const nativeContextMenu = await screen.findByRole("menu");
    expect(
      within(nativeContextMenu).getByRole("button", { name: "Details" }),
    ).toBeInTheDocument();
    expect(
      within(nativeContextMenu).getByRole("button", { name: "Download" }),
    ).toBeInTheDocument();
    expect(
      within(nativeContextMenu).queryByRole("button", { name: "Create public link" }),
    ).not.toBeInTheDocument();
    expect(
      within(nativeContextMenu).getByRole("button", { name: "Delete" }),
    ).toBeInTheDocument();
    expect(
      within(nativeContextMenu).getByRole("button", { name: "Preview" }),
    ).toBeInTheDocument();
    expect(
      within(nativeContextMenu).queryByRole("button", { name: "Properties" }),
    ).not.toBeInTheDocument();
    expect(
      within(nativeContextMenu).queryByRole("button", { name: "Copy" }),
    ).not.toBeInTheDocument();
    expect(
      within(nativeContextMenu).queryByRole("button", { name: "Cut" }),
    ).not.toBeInTheDocument();
    expect(
      within(nativeContextMenu).queryByRole("button", { name: "Bulk attributes" }),
    ).not.toBeInTheDocument();
    await user.click(within(nativeContextMenu).getByRole("button", { name: "Details" }));
    expect(openObjectDetailsRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        bucketName: "portal-bucket",
        key: "a.txt",
        name: "a.txt",
        initialTab: "properties",
      }),
    );
    fireEvent.contextMenu(rowA, { clientX: 40, clientY: 40 });
    await screen.findByRole("menu");
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    const moreMenu = await openContextMoreMenu(user);
    expect(within(moreMenu).queryByRole("menuitem", { name: /^Columns/i })).not.toBeInTheDocument();
    expect(within(moreMenu).queryByRole("menuitem", { name: /Versions/i })).not.toBeInTheDocument();
    expect(within(moreMenu).queryByRole("menuitem", { name: /Restore/i })).not.toBeInTheDocument();
  });

  it("moves the Portal deleted-files toggle into More", async () => {
    const user = userEvent.setup();
    const onVisibilityChange = vi.fn();
    getBucketVersioningMock.mockResolvedValue({
      enabled: true,
      status: "Enabled",
    });

    renderPage({
      initialEntry: "/portal/storage-spaces/research-data",
      accountIdForApi: "acc-portal",
      workspaceSurface: "portal",
      functionalProfile: "portal",
      lockedBucketName: "portal-bucket",
      lockedBucketLabel: "Research Data",
      deletedObjectsOptions: {
        visible: false,
        showToggle: true,
        canRestore: true,
        onVisibilityChange,
      },
    });

    await findRowByLabel("a.txt");
    expect(
      screen.queryByRole("button", { name: "Show deleted files" }),
    ).not.toBeInTheDocument();

    const moreMenu = await openContextMoreMenu(user);
    await user.click(
      within(moreMenu).getByRole("menuitem", {
        name: "Show deleted files",
      }),
    );

    await waitFor(() => {
      expect(onVisibilityChange).toHaveBeenCalledWith(true);
    });
  });

  it("keeps historical folders reachable after dense version pages in the Portal mixed view", async () => {
    const restoreDeletedObject = vi.fn();
    const restoreDeletedPrefix = vi.fn();
    getBucketVersioningMock.mockResolvedValue({
      enabled: true,
      status: "Enabled",
    });
    listObjectVersionsMock
      .mockResolvedValueOnce({
        versions: Array.from({ length: 1000 }, (_, index) => ({
          key: `dense/file-${index}.txt`,
          version_id: `v-${index}`,
          is_latest: false,
          last_modified: "2026-07-28T10:00:00Z",
          size: 1,
          etag: null,
          storage_class: "STANDARD",
          owner: null,
        })),
        delete_markers: [],
        common_prefixes: ["docs/"],
        is_truncated: true,
        next_key_marker: "dense/file-999.txt",
        next_version_id_marker: "v-999",
      })
      .mockResolvedValueOnce({
        versions: [],
        delete_markers: [
          {
            key: "removed.txt",
            version_id: "delete-1",
            is_latest: true,
            last_modified: "2026-07-29T12:00:00Z",
            owner: null,
          },
        ],
        common_prefixes: ["archive/", "docs/"],
        is_truncated: false,
        next_key_marker: null,
        next_version_id_marker: null,
      });

    renderPage({
      initialEntry: "/portal/storage-spaces/research-data",
      accountIdForApi: "acc-portal",
      workspaceSurface: "portal",
      functionalProfile: "portal",
      lockedBucketName: "portal-bucket",
      lockedBucketLabel: "Research Data",
      deletedObjectsOptions: {
        visible: true,
        showToggle: true,
        canRestore: true,
        onVisibilityChange: vi.fn(),
        onRestoreObject: restoreDeletedObject,
        onRestorePrefix: restoreDeletedPrefix,
      },
    });

    const historicalFolderRow = await findRowByLabel("archive");
    const deletedFileRow = await findRowByLabel("removed.txt");
    expect(within(historicalFolderRow).getByText("(history)")).toBeInTheDocument();
    expect(screen.getAllByText("docs")).toHaveLength(1);
    expect(
      within(deletedFileRow).getByRole("checkbox", {
        name: "Select removed.txt",
      }),
    ).toBeDisabled();
    expect(
      within(deletedFileRow).queryByRole("button", {
        name: "Download removed.txt",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(deletedFileRow).queryByRole("button", {
        name: "Delete removed.txt",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(deletedFileRow).getByRole("button", {
        name: "Restore removed.txt",
      }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(deletedFileRow).getByRole("button", {
        name: "Restore removed.txt",
      }),
    );
    expect(restoreDeletedObject).toHaveBeenCalledTimes(1);
    expect(restoreDeletedObject).toHaveBeenCalledWith(
      expect.objectContaining({
        bucketName: "portal-bucket",
        key: "removed.txt",
        deleteMarkerVersionId: "delete-1",
      }),
    );

    fireEvent.click(
      within(deletedFileRow).getByRole("button", {
        name: "More actions for removed.txt",
      }),
    );
    const deletedActions = await screen.findByRole("menu");
    expect(
      within(deletedActions).getByRole("button", { name: "Restore" }),
    ).toBeInTheDocument();

    expect(listObjectVersionsMock).toHaveBeenCalledTimes(2);
    expect(listObjectVersionsMock).toHaveBeenNthCalledWith(
      1,
      "acc-portal",
      "portal-bucket",
      expect.objectContaining({
        delimiter: "/",
        maxKeys: 1000,
        requestOptions: { workspaceSurface: "portal" },
      }),
    );
    expect(listObjectVersionsMock).toHaveBeenNthCalledWith(
      2,
      "acc-portal",
      "portal-bucket",
      expect.objectContaining({
        keyMarker: "dense/file-999.txt",
        versionIdMarker: "v-999",
      }),
    );
  });

  it("keeps an explicit continuation when 5,000 scanned versions yield no deleted row", async () => {
    getBucketVersioningMock.mockResolvedValue({
      enabled: true,
      status: "Enabled",
    });
    listBrowserObjectsMock.mockResolvedValue({
      prefix: "",
      objects: [],
      prefixes: [],
      is_truncated: false,
      next_continuation_token: null,
    });
    listObjectVersionsMock.mockResolvedValue({
      versions: Array.from({ length: 1000 }, (_, index) => ({
        key: `active/file-${index}.txt`,
        version_id: `v-${index}`,
        is_latest: false,
        last_modified: "2026-07-28T10:00:00Z",
        size: 1,
        etag: null,
        storage_class: "STANDARD",
        owner: null,
      })),
      delete_markers: [],
      common_prefixes: [],
      is_truncated: true,
      next_key_marker: "active/file-999.txt",
      next_version_id_marker: "v-999",
    });

    renderPage({
      initialEntry: "/portal/storage-spaces/research-data",
      accountIdForApi: "acc-portal",
      workspaceSurface: "portal",
      functionalProfile: "portal",
      lockedBucketName: "portal-bucket",
      lockedBucketLabel: "Research Data",
      deletedObjectsOptions: {
        visible: true,
        showToggle: true,
        canRestore: true,
        onVisibilityChange: vi.fn(),
      },
    });

    expect(
      await screen.findByText(
        "No deleted files found yet. Continue loading to search more history.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Continue loading deleted files",
      }),
    ).toBeInTheDocument();
    expect(listObjectVersionsMock).toHaveBeenCalledTimes(5);
  });

  it("keeps the Portal profile on the imposed Standard layout", async () => {
    renderPage({
      initialEntry: "/portal/storage-spaces/research-data",
      accountIdForApi: "acc-portal",
      workspaceSurface: "portal",
      functionalProfile: "portal",
      lockedBucketName: "portal-bucket",
      lockedBucketLabel: "Research Data",
    });

    await findRowByLabel("a.txt");
    expect(screen.queryByRole("tablist", { name: "Inspector tabs" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Storage Space" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Multipart uploads" })).not.toBeInTheDocument();
  });

  it("uses Portal storage-space labels in the root Browser sidebar", async () => {
    const user = userEvent.setup();
    searchBrowserBucketsMock.mockResolvedValue({
      items: [
        {
          name: "internal-research",
          display_name: "Research Data",
          workspace_label: "Storage Space",
          description: "Shared research datasets with a deliberately detailed description",
        },
      ],
      total: 1,
      page: 1,
      page_size: 50,
      has_next: false,
    });
    setBrowserContext({
      selectorForApi: "acc-portal",
      selectedContextId: "portal-101",
      selectedContext: makeExecutionContext({
        id: "portal-101",
        display_name: "Research Portal",
      }),
      selectedKind: "portal_account",
    });

    renderPage({ initialEntry: "/browser" });

    const rowA = await findRowByLabel("a.txt");
    expect(rowA).toHaveClass("h-9");
    expect(
      within(rowA).getByRole("button", { name: "Open file a.txt" }),
    ).not.toHaveClass("min-h-11");
    const headerConfigMenu = openHeaderConfigMenu();
    expect(
      within(headerConfigMenu).getByRole("menuitemradio", {
        name: "Compact density",
      }),
    ).toHaveAttribute("aria-checked", "true");
    expect(within(headerConfigMenu).queryByText("Reset columns")).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });
    const moreMenu = await openContextMoreMenu(user);
    expect(
      within(moreMenu).getByRole("menuitemradio", {
        name: "Compact density",
      }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      within(moreMenu).queryByRole("menuitemcheckbox", {
        name: "Workbench layout",
      }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(fetchBrowserSettingsMock).toHaveBeenCalledWith("acc-portal", { workspaceSurface: "portal" });
    expect(searchBrowserBucketsMock).toHaveBeenCalledWith(
      "acc-portal",
      expect.objectContaining({ workspaceSurface: "portal" }),
    );
    const selector = screen.getByRole("button", { name: "Select storage space" });
    expect(selector).toHaveTextContent("Research Data");
    const sidebar = screen.getByTestId("browser-workspace-sidebar");
    expect(sidebar).toHaveAttribute("aria-label", "Storage Spaces");
    expect(within(sidebar).getByText("Research Data")).toBeInTheDocument();
    const description = within(sidebar).getByText("Shared research datasets with a deliberately detailed description");
    expect(description).toHaveAttribute("title", "Shared research datasets with a deliberately detailed description");
    expect(within(sidebar).queryByText("Storage Space")).not.toBeInTheDocument();

    await user.click(selector);
    expect(screen.getByPlaceholderText("Filter storage spaces")).toBeInTheDocument();
    expect(screen.getAllByText("Storage Spaces", { exact: true })).toHaveLength(2);
    expect(screen.getByText("1 of 1 storage space")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Filter buckets")).not.toBeInTheDocument();
    expect(screen.queryByText("Buckets", { exact: true })).not.toBeInTheDocument();
  });

  it.each(["standard", "advanced"] as const)(
    "exposes direct Download and Delete actions in the %s profile without selecting the row",
    async (functionalProfile) => {
      const user = userEvent.setup();
      const windowOpenSpy = vi
        .spyOn(window, "open")
        .mockImplementation(() => null);
      renderPage({ functionalProfile });

      const rowA = await findRowByLabel("a.txt");
      const selectA = within(rowA).getByRole("checkbox", {
        name: "Select a.txt",
      });
      expect(rowA).toHaveClass("h-9");
      expect(
        within(rowA).getByRole("button", { name: "Download a.txt" }),
      ).toHaveClass("!h-6", "!w-6");
      expect(selectA).not.toBeChecked();
      expect(
        within(rowA).queryByRole("button", {
          name: "Create public link a.txt",
        }),
      ).not.toBeInTheDocument();

      await user.click(
        within(rowA).getByRole("button", { name: "Download a.txt" }),
      );
      await waitFor(() => expect(presignObjectMock).toHaveBeenCalledTimes(1));
      expect(selectA).not.toBeChecked();

      await user.click(
        within(rowA).getByRole("button", { name: "Delete a.txt" }),
      );
      expect(
        await screen.findByRole("dialog", { name: "Delete objects" }),
      ).toBeInTheDocument();
      expect(selectA).not.toBeChecked();
      expect(deleteObjectsMock).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Cancel" }));
      await user.click(
        within(rowA).getByRole("button", { name: "More actions for a.txt" }),
      );
      const rowActions = await screen.findByRole("menu");
      expect(
        within(rowActions).getByRole("button", { name: "Download" }),
      ).toBeInTheDocument();
      expect(
        within(rowActions).getByRole("button", { name: "Delete" }),
      ).toBeInTheDocument();
      windowOpenSpy.mockRestore();
    },
  );

  it("runs the direct Portal public-link action and keeps it in More", async () => {
    const user = userEvent.setup();
    const createPublicLinkForObject = vi.fn();
    renderPage({
      initialEntry: "/portal/storage-spaces/research-data",
      accountIdForApi: "acc-portal",
      workspaceSurface: "portal",
      functionalProfile: "portal",
      lockedBucketName: "portal-bucket",
      lockedBucketLabel: "Research Data",
      onCreatePublicLinkForObject: createPublicLinkForObject,
    });

    const rowA = await findRowByLabel("a.txt");
    await user.click(
      within(rowA).getByRole("button", {
        name: "Create public link a.txt",
      }),
    );
    expect(createPublicLinkForObject).toHaveBeenCalledTimes(1);
    expect(createPublicLinkForObject).toHaveBeenCalledWith({
      bucketName: "portal-bucket",
      key: "a.txt",
      name: "a.txt",
    });

    await user.click(
      within(rowA).getByRole("button", { name: "More actions for a.txt" }),
    );
    const rowActions = await screen.findByRole("menu");
    expect(
      within(rowActions).getByRole("button", { name: "Create public link" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });

    fireEvent.contextMenu(rowA, { clientX: 40, clientY: 40 });
    const nativeContextMenu = await screen.findByRole("menu");
    expect(
      within(nativeContextMenu).getByRole("button", { name: "Create public link" }),
    ).toBeInTheDocument();
  });

  it("uses minimal visible columns by default", async () => {
    renderPage();
    await findRowByLabel("a.txt");

    expect(
      screen.getByRole("columnheader", { name: "Size" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Modified" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "Type" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "Storage class" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "ETag" }),
    ).not.toBeInTheDocument();
  });

  it("opens More > Columns on all browser surfaces", async () => {
    const user = userEvent.setup();
    const entries = ["/browser", "/manager/browser", "/ceph-admin/browser"];

    for (const entry of entries) {
      const view =
        entry === "/browser"
          ? renderPage({ initialEntry: entry })
          : renderEmbeddedPage({ initialEntry: entry });
      await findRowByLabel("a.txt");

      const columnsMenu = await openColumnsSubmenuFromMore(user);
      expect(
        within(columnsMenu).getByRole("menuitemcheckbox", { name: /ETag/ }),
      ).toBeInTheDocument();
      expect(within(columnsMenu).queryByText("Sort")).not.toBeInTheDocument();
      expect(
        within(columnsMenu).getByRole("menuitem", { name: "Reset columns" }),
      ).toBeInTheDocument();

      view.unmount();
    }
  });

  it("persists columns separately for root and embedded browsers", async () => {
    const user = userEvent.setup();

    const rootView = renderPage({ initialEntry: "/browser" });
    await findRowByLabel("a.txt");
    let columnsMenu = await openColumnsSubmenuFromMore(user);
    await user.click(
      within(columnsMenu).getByRole("menuitemcheckbox", { name: /ETag/ }),
    );
    expect(
      screen.getByRole("columnheader", { name: "ETag" }),
    ).toBeInTheDocument();
    rootView.unmount();

    const embeddedView = renderEmbeddedPage({ initialEntry: "/manager/browser" });
    await findRowByLabel("a.txt");
    expect(
      screen.queryByRole("columnheader", { name: "ETag" }),
    ).not.toBeInTheDocument();
    columnsMenu = await openColumnsSubmenuFromMore(user);
    await user.click(
      within(columnsMenu).getByRole("menuitemcheckbox", {
        name: /Storage class/,
      }),
    );
    expect(
      screen.getByRole("columnheader", { name: "Storage class" }),
    ).toBeInTheDocument();
    embeddedView.unmount();

    const cephAdminView = renderEmbeddedPage({
      initialEntry: "/ceph-admin/browser",
    });
    await findRowByLabel("a.txt");
    expect(
      screen.getByRole("columnheader", { name: "Storage class" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "ETag" }),
    ).not.toBeInTheDocument();
    cephAdminView.unmount();

    renderPage({ initialEntry: "/browser" });
    await findRowByLabel("a.txt");
    expect(
      screen.getByRole("columnheader", { name: "ETag" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "Storage class" }),
    ).not.toBeInTheDocument();
    expect(
      JSON.parse(
        window.localStorage.getItem(BROWSER_ROOT_UI_STATE_V2_STORAGE_KEY) ?? "{}",
      ).layouts.standard.objectColumns,
    ).toContain("etag");
    expect(
      JSON.parse(
        window.localStorage.getItem(BROWSER_EMBEDDED_COLUMNS_STORAGE_KEY) ??
          "[]",
      ),
    ).toContain("storageClass");
  });

  it("resizes object columns and persists widths separately for root and embedded browsers", async () => {
    const rootView = renderPage({ initialEntry: "/browser" });
    await findRowByLabel("a.txt");

    expect(getObjectTableCols()[1]?.style.width).toBe("");
    expect(screen.getByRole("table")).toHaveStyle({ minWidth: "720px" });

    const nameSeparator = screen.getByRole("separator", {
      name: "Resize Name column",
    });
    fireEvent.pointerDown(nameSeparator, { clientX: 320 });
    fireEvent.pointerMove(document, { clientX: 420 });
    fireEvent.pointerUp(document);

    await waitFor(() => {
      expect(screen.getByRole("table")).toHaveStyle({ minWidth: "804px" });
    });
    await waitFor(() => {
      expect(
        JSON.parse(
          window.localStorage.getItem(BROWSER_ROOT_UI_STATE_V2_STORAGE_KEY) ?? "{}",
        ).layouts.standard.objectColumnWidths.name,
      ).toBe(420);
    });
    rootView.unmount();

    const embeddedView = renderEmbeddedPage({ initialEntry: "/manager/browser" });
    await findRowByLabel("a.txt");
    expect(getObjectTableCols()[1]?.style.width).toBe("");

    const modifiedSeparator = screen.getByRole("separator", {
      name: "Resize Modified column",
    });
    fireEvent.pointerDown(modifiedSeparator, { clientX: 160 });
    fireEvent.pointerMove(document, { clientX: 210 });
    fireEvent.pointerUp(document);

    await waitFor(() => {
      expect(getObjectTableCols()[3]?.style.width).toBe("210px");
    });
    await waitFor(() => {
      expect(
        JSON.parse(
          window.localStorage.getItem(
            BROWSER_EMBEDDED_COLUMN_WIDTHS_STORAGE_KEY,
          ) ?? "{}",
        ).modified,
      ).toBe(210);
    });
    embeddedView.unmount();

    renderPage({ initialEntry: "/browser" });
    await findRowByLabel("a.txt");
    expect(screen.getByRole("table")).toHaveStyle({ minWidth: "804px" });
    expect(
      JSON.parse(
        window.localStorage.getItem(
          BROWSER_EMBEDDED_COLUMN_WIDTHS_STORAGE_KEY,
        ) ?? "{}",
      ).modified,
    ).toBe(210);
  });

  it("restores custom column width when the column is hidden then shown again", async () => {
    const user = userEvent.setup();
    renderPage();
    await findRowByLabel("a.txt");

    const separator = screen.getByRole("separator", {
      name: "Resize Modified column",
    });
    fireEvent.pointerDown(separator, { clientX: 160 });
    fireEvent.pointerMove(document, { clientX: 220 });
    fireEvent.pointerUp(document);

    await waitFor(() => {
      expect(getObjectTableCols()[3]?.style.width).toBe("220px");
    });

    let menu = openHeaderConfigMenu();
    await user.click(within(menu).getByRole("button", { name: /Modified/ }));
    expect(
      screen.queryByRole("columnheader", { name: "Modified" }),
    ).not.toBeInTheDocument();

    menu = openHeaderConfigMenu();
    await user.click(within(menu).getByRole("button", { name: /Modified/ }));

    await waitFor(() => {
      expect(screen.getByRole("columnheader", { name: "Modified" })).toBeInTheDocument();
      expect(getObjectTableCols()[3]?.style.width).toBe("220px");
    });
  });

  it("resets custom widths together with visible columns", async () => {
    const user = userEvent.setup();
    renderPage();
    await findRowByLabel("a.txt");

    let menu = openHeaderConfigMenu();
    await user.click(within(menu).getByRole("button", { name: "ETag" }));
    expect(screen.getByRole("columnheader", { name: "ETag" })).toBeInTheDocument();

    fireEvent.pointerDown(
      screen.getByRole("separator", { name: "Resize Name column" }),
      { clientX: 320 },
    );
    fireEvent.pointerMove(document, { clientX: 400 });
    fireEvent.pointerUp(document);

    fireEvent.pointerDown(
      screen.getByRole("separator", { name: "Resize ETag column" }),
      { clientX: 192 },
    );
    fireEvent.pointerMove(document, { clientX: 252 });
    fireEvent.pointerUp(document);

    await waitFor(() => {
      expect(
        JSON.parse(
          window.localStorage.getItem(BROWSER_ROOT_UI_STATE_V2_STORAGE_KEY) ?? "{}",
        ).layouts.standard.objectColumnWidths,
      ).toMatchObject({
        name: 400,
        etag: 252,
      });
    });

    menu = openHeaderConfigMenu();
    await user.click(within(menu).getByRole("button", { name: "Reset columns" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("columnheader", { name: "ETag" }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("table")).toHaveStyle({ minWidth: "720px" });
      expect(
        JSON.parse(
          window.localStorage.getItem(BROWSER_ROOT_UI_STATE_V2_STORAGE_KEY) ?? "{}",
        ).layouts.standard.objectColumnWidths ?? {},
      ).toEqual({});
    });
  });

  it("resets a resized column to its default width on double-click", async () => {
    renderPage();
    await findRowByLabel("a.txt");

    const separator = screen.getByRole("separator", {
      name: "Resize Name column",
    });
    fireEvent.pointerDown(separator, { clientX: 320 });
    fireEvent.pointerMove(document, { clientX: 430 });
    fireEvent.pointerUp(document);

    await waitFor(() => {
      expect(screen.getByRole("table")).toHaveStyle({ minWidth: "814px" });
    });

    fireEvent.doubleClick(separator);

    await waitFor(() => {
      expect(screen.getByRole("table")).toHaveStyle({ minWidth: "720px" });
      expect(
        JSON.parse(
          window.localStorage.getItem(BROWSER_ROOT_UI_STATE_V2_STORAGE_KEY) ?? "{}",
        ).layouts.standard.objectColumnWidths ?? {},
      ).toEqual({});
    });
  });

  it("does not render resize handles for fixed selection and actions columns", async () => {
    renderPage();
    await findRowByLabel("a.txt");

    expect(
      screen.queryByRole("separator", { name: "Resize Select all column" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("separator", { name: "Resize Actions column" }),
    ).not.toBeInTheDocument();
  });

  it("toggles non-lazy columns and updates table headers/cells", async () => {
    const user = userEvent.setup();
    renderPage();
    await findRowByLabel("a.txt");

    const menu = openHeaderConfigMenu();
    await user.click(within(menu).getByRole("button", { name: "Type" }));
    await user.click(within(menu).getByRole("button", { name: "ETag" }));

    expect(
      screen.getByRole("columnheader", { name: "Type" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "ETag" }),
    ).toBeInTheDocument();
    expect(screen.getByText("etag-a")).toBeInTheDocument();
  });

  it("resets sort to name when hiding the active sorted column", async () => {
    const user = userEvent.setup();
    renderPage();
    await findRowByLabel("a.txt");

    await user.click(screen.getByRole("button", { name: "Size" }));
    await user.click(screen.getByRole("button", { name: "Size" }));
    await waitFor(() => {
      expect(listBrowserObjectsMock).toHaveBeenLastCalledWith(
        "acc-1",
        "bucket-1",
        expect.objectContaining({
          prefix: "",
          sortBy: "size",
          sortDir: "desc",
        }),
      );
    });

    const menu = openHeaderConfigMenu();
    await user.click(within(menu).getByRole("button", { name: /Size/ }));

    expect(
      screen.queryByRole("columnheader", { name: "Size" }),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      const lastOptions = listBrowserObjectsMock.mock.calls.at(-1)?.[2] as
        | Record<string, unknown>
        | undefined;
      expect(lastOptions?.prefix).toBe("");
      expect(lastOptions?.sortBy).toBe("name");
      expect(lastOptions?.sortDir).toBe("asc");
    });
  });

  it("loads lazy metadata columns without blocking the listing", async () => {
    const user = userEvent.setup();
    let resolveColumns: (() => void) | null = null;
    fetchBrowserObjectColumnsMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveColumns = () =>
            resolve({
              items: [
                {
                  key: "a.txt",
                  content_type: "text/plain",
                  tags_count: null,
                  metadata_count: 2,
                  cache_control: null,
                  expires: null,
                  restore_status: null,
                  metadata_status: "ready",
                  tags_status: "error",
                },
                {
                  key: "b.txt",
                  content_type: "text/csv",
                  tags_count: null,
                  metadata_count: 2,
                  cache_control: null,
                  expires: null,
                  restore_status: null,
                  metadata_status: "ready",
                  tags_status: "error",
                },
                {
                  key: "c.txt",
                  content_type: "text/plain",
                  tags_count: null,
                  metadata_count: 2,
                  cache_control: null,
                  expires: null,
                  restore_status: null,
                  metadata_status: "ready",
                  tags_status: "error",
                },
              ],
            });
        }),
    );

    renderPage();
    await findRowByLabel("a.txt");

    const menu = openHeaderConfigMenu();
    await user.click(
      within(menu).getByRole("button", { name: "Content-Type" }),
    );

    expect(
      screen.getByRole("columnheader", { name: "Content-Type" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByText("Loading...").length).toBeGreaterThan(0);
    });
    expect(screen.getByRole("button", { name: "Open file a.txt" })).toBeInTheDocument();

    resolveColumns?.();
    await waitFor(() => {
      const plainCount = screen.queryAllByText("text/plain").length;
      const csvCount = screen.queryAllByText("text/csv").length;
      expect(plainCount + csvCount).toBeGreaterThan(0);
    });
    const initialCallCount = fetchBrowserObjectColumnsMock.mock.calls.length;
    expect(initialCallCount).toBeGreaterThan(0);
    const metadataKeys = fetchBrowserObjectColumnsMock.mock.calls.flatMap(
      (call) =>
        (((call[2] as { keys?: string[] } | undefined)?.keys ?? []) as string[]),
    );
    expect(
      metadataKeys.every((key) => ["a.txt", "b.txt", "c.txt"].includes(key)),
    ).toBe(true);
    expect(fetchObjectMetadataMock).not.toHaveBeenCalled();
    expect(getObjectTagsMock).not.toHaveBeenCalled();

    const reopenedMenu = openHeaderConfigMenu();
    await user.click(
      within(reopenedMenu).getByRole("button", { name: /Content-Type/ }),
    );
    await user.click(
      within(reopenedMenu).getByRole("button", { name: /Content-Type/ }),
    );
    expect(
      screen.getByRole("columnheader", { name: "Content-Type" }),
    ).toBeInTheDocument();
    expect(fetchBrowserObjectColumnsMock).toHaveBeenCalledTimes(initialCallCount);
  });

  it("does not fetch lazy columns for folders or deleted rows", async () => {
    const user = userEvent.setup();
    fetchBrowserObjectColumnsMock.mockResolvedValue({
      items: [
        {
          key: "a.txt",
          content_type: null,
          tags_count: 3,
          metadata_count: null,
          cache_control: null,
          expires: null,
          restore_status: null,
          metadata_status: "error",
          tags_status: "ready",
        },
        {
          key: "b.txt",
          content_type: null,
          tags_count: 3,
          metadata_count: null,
          cache_control: null,
          expires: null,
          restore_status: null,
          metadata_status: "error",
          tags_status: "ready",
        },
        {
          key: "c.txt",
          content_type: null,
          tags_count: 3,
          metadata_count: null,
          cache_control: null,
          expires: null,
          restore_status: null,
          metadata_status: "error",
          tags_status: "ready",
        },
      ],
    });

    renderPage();
    const docsRow = await findRowByLabel("docs");

    const menu = openHeaderConfigMenu();
    await user.click(within(menu).getByRole("button", { name: "Tags" }));

    await waitFor(() => {
      expect(fetchBrowserObjectColumnsMock.mock.calls.length).toBeGreaterThan(0);
    });
    const firstPayload = fetchBrowserObjectColumnsMock.mock.calls[0]?.[2] as {
      keys: string[];
      columns: string[];
    };
    expect(
      firstPayload.keys.every((key) => ["a.txt", "b.txt", "c.txt"].includes(key)),
    ).toBe(true);
    expect(firstPayload.columns).toEqual(["tags_count"]);
    expect(getObjectTagsMock).not.toHaveBeenCalled();
    expect(fetchObjectMetadataMock).not.toHaveBeenCalled();
    expect(within(docsRow).getByText("—")).toBeInTheDocument();
  });

  it("sorts only base listing columns through the backend and keeps lazy columns non-sortable", async () => {
    const user = userEvent.setup();
    renderPage();
    await findRowByLabel("a.txt");

    await user.click(screen.getByRole("button", { name: "Size" }));
    await waitFor(() => {
      expect(listBrowserObjectsMock).toHaveBeenLastCalledWith(
        "acc-1",
        "bucket-1",
        expect.objectContaining({
          prefix: "",
          sortBy: "size",
          sortDir: "asc",
        }),
      );
    });

    const columnsMenu = await openColumnsSubmenuFromMore(user);
    await user.click(
      within(columnsMenu).getByRole("menuitemcheckbox", {
        name: /Storage class/,
      }),
    );
    await user.click(
      within(columnsMenu).getByRole("menuitemcheckbox", { name: "Tags" }),
    );

    await user.click(screen.getByRole("button", { name: "Storage class" }));
    await waitFor(() => {
      expect(listBrowserObjectsMock).toHaveBeenLastCalledWith(
        "acc-1",
        "bucket-1",
        expect.objectContaining({
          prefix: "",
          sortBy: "storage_class",
          sortDir: "asc",
        }),
      );
    });

    const tagsHeader = screen.getByRole("columnheader", { name: "Tags" });
    expect(within(tagsHeader).queryByRole("button")).not.toBeInTheDocument();
  });

  it("switches comfortable/compact density from header config menu", async () => {
    const user = userEvent.setup();
    renderPage();

    let rowA = await findRowByLabel("a.txt");
    expect(rowA).toHaveClass("h-9");
    expect(
      within(rowA).getByRole("button", { name: "Open file a.txt" }),
    ).not.toHaveClass("min-h-11");
    expect(within(rowA).queryByText("Object")).not.toBeInTheDocument();

    let menu = openHeaderConfigMenu();
    await user.click(
      within(menu).getByRole("menuitemradio", {
        name: "Comfortable density",
      }),
    );
    rowA = await findRowByLabel("a.txt");
    expect(rowA).toHaveClass("h-16");
    expect(within(rowA).getByText("Object")).toBeInTheDocument();

    menu = openHeaderConfigMenu();
    await user.click(
      within(menu).getByRole("menuitemradio", { name: "Compact density" }),
    );
    rowA = await findRowByLabel("a.txt");
    expect(rowA).toHaveClass("h-9");
  });

  it("uses the compact browser toolbar by default and exposes upload and layout controls", async () => {
    const user = userEvent.setup();
    renderPage();
    await findRowByLabel("a.txt");

    const contextToolbar = getContextToolbar();
    const uploadButton = within(contextToolbar).getByRole("button", {
      name: "Upload",
    });
    const newFolderButton = within(contextToolbar).getByRole("button", {
      name: "New folder",
    });
    const refreshButton = within(contextToolbar).getByRole("button", {
      name: "Refresh",
    });
    const moreButton = within(contextToolbar).getByRole("button", {
      name: "More",
    });

    expect(screen.getAllByRole("toolbar")).toHaveLength(1);
    expect(
      within(contextToolbar).getByRole("button", { name: "Select bucket" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("toolbar", { name: "Browser actions bar" }),
    ).not.toBeInTheDocument();
    expect(contextToolbar).not.toHaveClass("rounded-lg", "p-2");
    expect(screen.getByTestId("browser-layout").parentElement).toHaveClass(
      "pb-3",
    );
    expect(screen.getByTestId("browser-layout").parentElement).not.toHaveClass(
      "px-3",
    );
    expect(screen.getByTestId("browser-layout").parentElement).not.toHaveClass(
      "p-3",
    );
    expect(
      within(contextToolbar).queryByRole("button", { name: "Download" }),
    ).not.toBeInTheDocument();
    expect(
      within(contextToolbar).queryByRole("button", { name: "Operations" }),
    ).not.toBeInTheDocument();
    expect(uploadButton).toHaveClass("h-7", "w-7", "rounded-md");
    expect(uploadButton).not.toHaveClass("h-9", "w-9", "rounded-xl");
    expect(newFolderButton).toHaveClass("h-7", "w-7", "rounded-md");
    expect(refreshButton).toHaveClass("h-7", "w-7", "rounded-md");
    expect(moreButton).toHaveClass("h-7", "w-7", "rounded-md");
    expect(
      Boolean(
        uploadButton.compareDocumentPosition(newFolderButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(
      Boolean(
        newFolderButton.compareDocumentPosition(refreshButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(
      Boolean(
        refreshButton.compareDocumentPosition(moreButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);

    await user.click(uploadButton);
    const uploadMenu = await screen.findByRole("menu", { name: "Upload" });
    expect(
      within(uploadMenu).getByRole("menuitem", { name: "Upload files" }),
    ).toBeInTheDocument();
    expect(
      within(uploadMenu).getByRole("menuitem", { name: "Upload folder" }),
    ).toBeInTheDocument();

    const menu = await openContextMoreMenu(user);
    expect(
      within(menu).queryByRole("menuitem", { name: "Operations overview" }),
    ).not.toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitemradio", { name: "Compact density" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(within(menu).getByText("Transfers")).toBeInTheDocument();
    expect(within(menu).getByText("Current path")).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: "Paste" }),
    ).toBeDisabled();
    expect(
      within(menu).getByRole("menuitem", { name: "Copy path" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: "Configure bucket" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitemcheckbox", { name: /Workbench layout/i }),
    ).toHaveAttribute("aria-checked", "false");

  });

  it("uses shared controls in the create folder modal", async () => {
    const user = userEvent.setup();
    renderPage();
    await findRowByLabel("a.txt");

    await user.click(
      within(getContextToolbar()).getByRole("button", { name: "New folder" }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Create folder" });
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toHaveClass("ui-button-base");
    expect(
      within(dialog).getByRole("button", { name: "Create" }),
    ).toHaveClass("ui-button-base");
  });

  it("creates a folder from the create folder modal", async () => {
    const user = userEvent.setup();
    renderPage();
    await findRowByLabel("a.txt");

    await user.click(
      within(getContextToolbar()).getByRole("button", { name: "New folder" }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Create folder" });
    await user.type(within(dialog).getByLabelText("Folder name"), "reports");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createFolderMock).toHaveBeenCalledWith(
        "acc-1",
        "bucket-1",
        "reports/",
        undefined,
      );
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Create folder" }),
      ).not.toBeInTheDocument();
    });

    const operationsPanel = await screen.findByRole("complementary", {
      name: "Operations",
    });
    await user.click(
      within(operationsPanel).getByRole("button", {
        name: "Expand operations",
      }),
    );
    expect(within(operationsPanel).getByText("Created")).toBeInTheDocument();
    expect(
      within(operationsPanel).getByText("bucket-1/reports/"),
    ).toBeInTheDocument();
    await user.click(
      within(operationsPanel).getByRole("button", {
        name: "Clear completed/failed",
      }),
    );
    await waitFor(() => {
      expect(
        screen.queryByRole("complementary", { name: "Operations" }),
      ).not.toBeInTheDocument();
    });
  });

  it("uses shared controls in the create bucket modal", async () => {
    const user = userEvent.setup();
    renderPage();
    await findRowByLabel("a.txt");

    await user.click(
      within(getContextToolbar()).getByRole("button", { name: "Select bucket" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Create bucket" }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Create bucket" });
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toHaveClass("ui-button-base");
    expect(
      within(dialog).getByRole("button", { name: "Create bucket" }),
    ).toHaveClass("ui-button-base");
  });

  it("creates a bucket and applies browser CORS from the create modal", async () => {
    const user = userEvent.setup();
    renderPage();
    await findRowByLabel("a.txt");

    await user.click(
      within(getContextToolbar()).getByRole("button", { name: "Select bucket" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Create bucket" }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Create bucket" });
    await user.type(within(dialog).getByLabelText("Bucket name"), "created-bucket");
    await user.click(
      within(dialog).getByRole("button", { name: "Create bucket" }),
    );

    await waitFor(() => {
      expect(createBrowserBucketMock).toHaveBeenCalledWith(
        "acc-1",
        "created-bucket",
        { versioning: false },
      );
      expect(ensureBucketCorsMock).toHaveBeenCalledWith(
        "acc-1",
        "created-bucket",
        window.location.origin,
        undefined,
      );
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Create bucket" }),
      ).not.toBeInTheDocument();
    });
  });

  it("renders a passive Presign badge in the More status section", async () => {
    const user = userEvent.setup();
    renderPage();
    await findRowByLabel("a.txt");

    const menu = await openContextMoreMenu(user);
    expect(within(menu).getByText("Transfers")).toBeInTheDocument();
    const badge = await within(menu).findByText("Presign");
    expectPassiveStatusBadge(badge);
    expect(badge).toHaveClass("px-1.5", "py-0.5", "text-[10px]", "leading-4");
    expect(badge).not.toHaveClass("px-2.5", "py-1");
  });

  it("renders a passive Unavailable badge when direct and proxy transfers are both unavailable", async () => {
    const user = userEvent.setup();
    getBucketCorsStatusMock.mockResolvedValue({ enabled: false, rules: [] });
    renderPage();
    await findRowByLabel("a.txt");

    const menu = await openContextMoreMenu(user);
    expect(within(menu).getByText("Transfers")).toBeInTheDocument();
    const badge = await within(menu).findByText("Unavailable");
    expectPassiveStatusBadge(badge);
  });

  it("renders a passive Proxy badge when proxy transfers are active", async () => {
    const user = userEvent.setup();
    fetchBrowserSettingsMock.mockResolvedValue({
      allow_proxy_transfers: true,
      direct_upload_parallelism: 3,
      proxy_upload_parallelism: 2,
      direct_download_parallelism: 3,
      proxy_download_parallelism: 2,
      other_operations_parallelism: 2,
      streaming_zip_threshold_mb: 200,
    });
    getBucketCorsStatusMock.mockResolvedValue({ enabled: false, rules: [] });
    renderPage();
    await findRowByLabel("a.txt");

    const menu = await openContextMoreMenu(user);
    expect(within(menu).getByText("Transfers")).toBeInTheDocument();
    const badge = await within(menu).findByText("Proxy");
    expectPassiveStatusBadge(badge);
  });

  it("keeps Portal uploads direct when the CORS status is unknown", async () => {
    fetchBrowserSettingsMock.mockResolvedValue({
      allow_proxy_transfers: true,
      direct_upload_parallelism: 3,
      proxy_upload_parallelism: 2,
      direct_download_parallelism: 3,
      proxy_download_parallelism: 2,
      other_operations_parallelism: 2,
      streaming_zip_threshold_mb: 200,
    });
    getBucketCorsStatusMock.mockResolvedValue({
      enabled: false,
      rules: [],
      error: "AccessDenied",
    });
    const portalContext = makeExecutionContext({
      id: "portal-101",
      kind: "portal_account",
    });
    setBrowserContext({
      contexts: [portalContext],
      selectedContextId: portalContext.id,
      selectedContext: portalContext,
      requiresContextSelection: true,
      selectorForApi: "acc-portal",
      selectedKind: "portal_account",
    });

    renderPage();
    await findRowByLabel("a.txt");
    await waitFor(() => expect(getBucketCorsStatusMock).toHaveBeenCalled());

    expect(
      screen.queryByText("Direct download/upload is not allowed on this bucket."),
    ).not.toBeInTheDocument();
    const menu = await openContextMoreMenu(userEvent.setup());
    expect(within(menu).getByText("Presign")).toBeInTheDocument();
    expect(within(menu).queryByText("Proxy")).not.toBeInTheDocument();

    const file = new File(["portal payload"], "portal-direct.txt", {
      type: "text/plain",
    });
    const fileInput = document.querySelector(
      'input[type="file"]:not([directory])',
    ) as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(presignObjectMock).toHaveBeenCalledWith(
        "acc-portal",
        "bucket-1",
        {
          key: "portal-direct.txt",
          operation: "put_object",
          content_type: "text/plain",
          expires_in: 1800,
        },
        null,
        { workspaceSurface: "portal" },
      );
      expect(fetchMock).toHaveBeenCalledWith(
        "https://example.test/portal-direct.txt",
        expect.objectContaining({
          method: "PUT",
          credentials: "omit",
        }),
      );
    });
    expect(proxyUploadMock).not.toHaveBeenCalled();
  });

  it("opens bucket configuration from More on /browser", async () => {
    const user = userEvent.setup();
    renderPage();
    await findRowByLabel("a.txt");

    const menu = await openContextMoreMenu(user);
    await user.click(
      within(menu).getByRole("menuitem", { name: "Configure bucket" }),
    );

    expect(
      await screen.findByRole("dialog", {
        name: "Configure bucket · bucket-1",
      }),
    ).toBeInTheDocument();
  });

  it("shows Configure bucket disabled in More when no bucket is selected", async () => {
    const user = userEvent.setup();
    searchBrowserBucketsMock.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 50,
      has_next: false,
    });

    renderPage();
    await screen.findByRole("button", { name: "Select bucket" });

    const menu = await openContextMoreMenu(user);
    expect(
      within(menu).getByRole("menuitem", { name: "Configure bucket" }),
    ).toBeDisabled();
  });

  it("keeps Configure bucket available in embedded Advanced browsers", async () => {
    const user = userEvent.setup();
    const entries = ["/manager/browser", "/ceph-admin/browser"];

    for (const entry of entries) {
      const view = renderEmbeddedPage({ initialEntry: entry });
      await findRowByLabel("a.txt");

      const menu = await openContextMoreMenu(user);
      expect(
        within(menu).getByRole("menuitem", { name: "Configure bucket" }),
      ).toBeEnabled();

      view.unmount();
    }
  });

  it("keeps advanced search controls available after the explorer chrome refresh", async () => {
    const user = userEvent.setup();
    renderPage();
    await findRowByLabel("a.txt");

    await user.click(screen.getByRole("button", { name: "Search options" }));

    expect(
      await screen.findByRole("combobox", { name: "Search scope" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Object type filter" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Storage class filter" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", {
        name: "Search recursively in subfolders",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Use exact match" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Case-sensitive search" }),
    ).toBeInTheDocument();

    await user.type(
      screen.getByRole("textbox", { name: "Search objects" }),
      "a",
    );
    const recursiveSearch = screen.getByRole("checkbox", {
      name: "Search recursively in subfolders",
    });
    await user.click(recursiveSearch);
    expect(recursiveSearch).toBeChecked();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Search scope" }),
      "bucket",
    );
    expect(recursiveSearch).not.toBeChecked();
    expect(recursiveSearch).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(
        screen.queryByRole("combobox", { name: "Search scope" }),
      ).not.toBeInTheDocument();
    });

    const optionsButton = screen.getByRole("button", {
      name: "Search options",
    });
    await user.click(optionsButton);
    await screen.findByRole("combobox", { name: "Search scope" });
    fireEvent.mouseDown(document.body);
    await waitFor(() => {
      expect(
        screen.queryByRole("combobox", { name: "Search scope" }),
      ).not.toBeInTheDocument();
    });

    await user.click(optionsButton);
    await screen.findByRole("combobox", { name: "Search scope" });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(
        screen.queryByRole("combobox", { name: "Search scope" }),
      ).not.toBeInTheDocument();
    });
  });

  it("keeps the default root browser actions in the compact context bar", async () => {
    renderPage({ initialEntry: "/browser" });
    await findRowByLabel("a.txt");

    const contextToolbar = getContextToolbar();
    expect(
      within(contextToolbar).getByRole("button", { name: "Select bucket" }),
    ).toBeInTheDocument();
    expect(
      within(contextToolbar).queryByRole("button", { name: "Operations" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("complementary", { name: "Operations" }),
    ).not.toBeInTheDocument();
    expect(
      within(contextToolbar).getByRole("button", { name: "Upload" }),
    ).toBeInTheDocument();
    expect(
      within(contextToolbar).getByRole("button", { name: "More" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("toolbar", { name: "Browser actions bar" }),
    ).not.toBeInTheDocument();
  });

  it("aligns the embedded browser chrome with its page header", async () => {
    renderEmbeddedPage({ initialEntry: "/manager/browser" });
    await findRowByLabel("a.txt");

    const contextToolbar = getContextToolbar();
    const browserLayoutParent = screen.getByTestId("browser-layout")
      .parentElement;

    expect(contextToolbar).not.toHaveClass("rounded-lg", "p-2");
    expect(browserLayoutParent).toHaveClass("pb-3");
    expect(browserLayoutParent).not.toHaveClass("px-3");
    expect(browserLayoutParent).not.toHaveClass("p-3");
  });

  it("restores Workbench panels while keeping the selection bar automatic", async () => {
    const user = userEvent.setup();
    const firstRender = renderPage();

    const firstRow = await findRowByLabel("a.txt");

    const menu = await openContextMoreMenu(user);
    await user.click(
      within(menu).getByRole("menuitemcheckbox", { name: /Workbench layout/i }),
    );

    expect(
      await screen.findByRole("tablist", { name: "Inspector tabs" }),
    ).toBeInTheDocument();
    await user.click(firstRow);

    await waitFor(() => {
      expect(
        screen.getByRole("region", { name: "Current bucket" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("toolbar", { name: "Browser actions bar" }),
      ).toBeInTheDocument();
    });

    firstRender.unmount();

    renderPage();
    const remountedRow = await findRowByLabel("a.txt");

    expect(screen.getByRole("region", { name: "Current bucket" })).toBeInTheDocument();
    expect(
      screen.getByRole("tablist", { name: "Inspector tabs" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("toolbar", { name: "Browser actions bar" })).not.toBeInTheDocument();
    await user.click(remountedRow);
    expect(screen.getByRole("toolbar", { name: "Browser actions bar" })).toBeInTheDocument();
  });

  it("keeps a stored inspector preference when the workspace temporarily disallows it", async () => {
    const user = userEvent.setup();
    const firstRender = renderPage({ defaultShowInspector: true });

    await findRowByLabel("a.txt");

    expect(
      await screen.findByRole("tablist", { name: "Inspector tabs" }),
    ).toBeInTheDocument();

    firstRender.unmount();

    const blockedRender = renderPage({ allowInspectorPanel: false, defaultShowInspector: true });
    await findRowByLabel("a.txt");

    expect(
      screen.queryByRole("tablist", { name: "Inspector tabs" }),
    ).not.toBeInTheDocument();

    const blockedMenu = await openContextMoreMenu(user);
    expect(
      within(blockedMenu).queryByRole("menuitemcheckbox", {
        name: /Inspector panel/i,
      }),
    ).not.toBeInTheDocument();

    blockedRender.unmount();

    renderPage();
    await findRowByLabel("a.txt");

    expect(
      screen.getByRole("tablist", { name: "Inspector tabs" }),
    ).toBeInTheDocument();
  });

  it("keeps /browser preferences isolated from embedded browser surfaces", async () => {
    seedBrowserRootUiState({
      layout: { showFolders: true, showInspector: true, showActionBar: true },
      contextSelections: {},
    });

    const rootRender = renderPage();
    await findRowByLabel("a.txt");

    expect(screen.getByRole("region", { name: "Current bucket" })).toBeInTheDocument();
    expect(
      screen.getByRole("tablist", { name: "Inspector tabs" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("toolbar", { name: "Browser actions bar" })).not.toBeInTheDocument();
    const rootPreferenceSnapshot = window.localStorage.getItem(BROWSER_ROOT_UI_STATE_V2_STORAGE_KEY);

    rootRender.unmount();

    const managerRender = renderEmbeddedPage();
    await findRowByLabel("a.txt");

    expect(
      screen.queryByRole("region", { name: "Current bucket" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tablist", { name: "Inspector tabs" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("toolbar", { name: "Browser actions bar" }),
    ).not.toBeInTheDocument();

    managerRender.unmount();
    expect(window.localStorage.getItem(BROWSER_ROOT_UI_STATE_V2_STORAGE_KEY)).toBe(rootPreferenceSnapshot);

    const cephAdminRender = renderEmbeddedPage({
      initialEntry: "/ceph-admin/browser",
      accountIdForApi: "ceph-admin-1",
      executionContextKind: "ceph_admin",
    });
    await findRowByLabel("a.txt");

    expect(
      screen.queryByRole("region", { name: "Current bucket" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tablist", { name: "Inspector tabs" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("toolbar", { name: "Browser actions bar" }),
    ).not.toBeInTheDocument();

    cephAdminRender.unmount();
    expect(window.localStorage.getItem(BROWSER_ROOT_UI_STATE_V2_STORAGE_KEY)).toBe(rootPreferenceSnapshot);

    const portalRender = renderPage({
      initialEntry: "/portal/storage-spaces/research-data",
      accountIdForApi: "acc-portal",
      workspaceSurface: "portal",
      functionalProfile: "portal",
      lockedBucketName: "portal-bucket",
      lockedBucketLabel: "Research Data",
    });
    await findRowByLabel("a.txt");
    portalRender.unmount();
    expect(window.localStorage.getItem(BROWSER_ROOT_UI_STATE_V2_STORAGE_KEY)).toBe(rootPreferenceSnapshot);

    renderPage();
    await findRowByLabel("a.txt");

    expect(screen.getByRole("region", { name: "Current bucket" })).toBeInTheDocument();
    expect(
      screen.getByRole("tablist", { name: "Inspector tabs" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("toolbar", { name: "Browser actions bar" })).not.toBeInTheDocument();
  });

  it("uses the default panel widths when nothing is stored", async () => {
    renderPage({ defaultShowFolders: true, defaultShowInspector: true });
    await findRowByLabel("a.txt");

    const layout = setBrowserLayoutRect(1400);

    await waitFor(() => {
      expect(layout.style.gridTemplateColumns).toBe(
        "280px minmax(0, 1fr) 320px",
      );
    });
    expect(
      screen.getByRole("separator", { name: "Resize folders panel" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("separator", { name: "Resize inspector panel" }),
    ).toBeInTheDocument();
  });

  it("resizes the folders panel and persists the width", async () => {
    renderPage({ defaultShowFolders: true, defaultShowInspector: true });
    await findRowByLabel("a.txt");

    const layout = setBrowserLayoutRect(1400);
    const separator = screen.getByRole("separator", {
      name: "Resize folders panel",
    });

    fireEvent.pointerDown(separator, { clientX: 286 });
    fireEvent.pointerMove(document, { clientX: 360 });
    fireEvent.pointerUp(document);

    await waitFor(() => {
      expect(layout.style.gridTemplateColumns).toBe(
        "354px minmax(0, 1fr) 320px",
      );
    });
    await waitFor(() => {
      expect(
        JSON.parse(
          window.localStorage.getItem(BROWSER_ROOT_UI_STATE_V2_STORAGE_KEY) ?? "{}",
        ).layouts.workbench.foldersPanelWidthPx,
      ).toBe(354);
    });
  });

  it("resizes the inspector panel and persists the width", async () => {
    renderPage({ defaultShowFolders: true, defaultShowInspector: true });
    await findRowByLabel("a.txt");

    const layout = setBrowserLayoutRect(1400);
    const separator = screen.getByRole("separator", {
      name: "Resize inspector panel",
    });

    fireEvent.pointerDown(separator, { clientX: 1074 });
    fireEvent.pointerMove(document, { clientX: 980 });
    fireEvent.pointerUp(document);

    await waitFor(() => {
      expect(layout.style.gridTemplateColumns).toBe(
        "280px minmax(0, 1fr) 414px",
      );
    });
    await waitFor(() => {
      expect(
        JSON.parse(
          window.localStorage.getItem(BROWSER_ROOT_UI_STATE_V2_STORAGE_KEY) ?? "{}",
        ).layouts.workbench.inspectorPanelWidthPx,
      ).toBe(414);
    });
  });

  it("restores persisted panel widths on remount", async () => {
    seedBrowserRootUiState({
      layout: {
        showFolders: true,
        showInspector: true,
        showActionBar: false,
        foldersPanelWidthPx: 360,
        inspectorPanelWidthPx: 410,
      },
      contextSelections: {},
    });

    renderPage();
    await findRowByLabel("a.txt");

    const layout = setBrowserLayoutRect(1400);

    await waitFor(() => {
      expect(layout.style.gridTemplateColumns).toBe(
        "360px minmax(0, 1fr) 410px",
      );
    });
  });

  it("resets panel widths to defaults on resizer double-click", async () => {
    seedBrowserRootUiState({
      layout: {
        showFolders: true,
        showInspector: true,
        showActionBar: false,
        foldersPanelWidthPx: 360,
        inspectorPanelWidthPx: 410,
      },
      contextSelections: {},
    });
    const user = userEvent.setup();
    renderPage();
    await findRowByLabel("a.txt");

    const layout = setBrowserLayoutRect(1400);

    await user.dblClick(
      screen.getByRole("separator", { name: "Resize folders panel" }),
    );
    await user.dblClick(
      screen.getByRole("separator", { name: "Resize inspector panel" }),
    );

    await waitFor(() => {
      expect(layout.style.gridTemplateColumns).toBe(
        "280px minmax(0, 1fr) 320px",
      );
    });
  });

  it("only renders resizers for visible and allowed panels", async () => {
    const inspectorOnlyRender = renderPage({
      defaultShowInspector: true,
      defaultShowFolders: false,
    });
    await findRowByLabel("a.txt");
    expect(
      screen.queryByRole("separator", { name: "Resize folders panel" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("separator", { name: "Resize inspector panel" }),
    ).toBeInTheDocument();

    inspectorOnlyRender.unmount();

    const embeddedRender = renderEmbeddedPage();
    await findRowByLabel("a.txt");
    expect(
      screen.queryByRole("separator", { name: "Resize folders panel" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("separator", { name: "Resize inspector panel" }),
    ).not.toBeInTheDocument();

    embeddedRender.unmount();

    const matchMediaSpy = vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: query === "(max-width: 1023px)",
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as MediaQueryList,
    );
    renderPage({ defaultShowFolders: true, defaultShowInspector: true });
    await findRowByLabel("a.txt");

    expect(
      screen.queryByRole("separator", { name: "Resize folders panel" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("separator", { name: "Resize inspector panel" }),
    ).not.toBeInTheDocument();
    matchMediaSpy.mockRestore();
  });

  it("renders the dedicated mobile list and accessible bottom action sheet", async () => {
    const user = userEvent.setup();
    const matchMediaSpy = vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches:
            query === "(max-width: 767px)" ||
            query === "(max-width: 1023px)",
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as MediaQueryList,
    );

    try {
      renderPage();
      const row = await findRowByLabel("a.txt");

      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(screen.getByRole("list", { name: "Objects" })).toBeInTheDocument();
      expect(screen.getByLabelText("Objects list")).toHaveClass(
        "overflow-x-hidden",
      );
      expect(
        within(row).queryByRole("button", { name: "Download a.txt" }),
      ).not.toBeInTheDocument();
      expect(
        within(row).queryByRole("button", { name: "Delete a.txt" }),
      ).not.toBeInTheDocument();
      expect(
        within(row).getByRole("button", { name: "More actions for a.txt" }),
      ).toHaveClass("min-h-11", "min-w-11");

      await user.click(row);
      const toolbar = screen.getByRole("toolbar", {
        name: "Selected object actions",
      });
      const moreButton = within(toolbar).getByRole("button", { name: "More" });
      expect(within(toolbar).getByRole("button", { name: "Open" })).toBeEnabled();
      expect(within(toolbar).getByRole("button", { name: "Download" })).toBeEnabled();

      await user.click(moreButton);
      const sheet = await screen.findByRole("dialog", { name: "1 selected" });
      expect(within(sheet).getByRole("button", { name: "Close actions" })).toHaveFocus();
      expect(within(sheet).getByRole("button", { name: "Delete" })).toBeInTheDocument();

      fireEvent.keyDown(document, { key: "Escape" });
      await waitFor(() => {
        expect(screen.queryByRole("dialog", { name: "1 selected" })).not.toBeInTheDocument();
        expect(moreButton).toHaveFocus();
      });
    } finally {
      matchMediaSpy.mockRestore();
    }
  });

  it("restores the last bucket and path for the same execution context", async () => {
    const user = userEvent.setup();
    searchBrowserBucketsMock.mockImplementation(
      (accountId: string, options?: { search?: string; exact?: boolean }) => {
        const allBuckets =
          accountId === "acc-2"
            ? [{ name: "bucket-a" }]
            : [{ name: "bucket-1" }, { name: "bucket-2" }];
        const search = options?.search?.trim() ?? "";
        const filtered = search
          ? allBuckets.filter((bucket) =>
              options?.exact
                ? bucket.name === search
                : bucket.name.includes(search),
            )
          : allBuckets;
        return Promise.resolve({
          items: filtered,
          total: filtered.length,
          page: 1,
          page_size: 50,
          has_next: false,
        });
      },
    );

    const firstRender = renderPage({
      accountIdForApi: "acc-1",
      defaultShowInspector: true,
    });
    await user.click(
      within(getContextToolbar()).getByRole("button", {
        name: "Select bucket",
      }),
    );
    await user.click(await screen.findByRole("button", { name: "bucket-2" }));
    await waitFor(() => {
      expect(listBrowserObjectsMock).toHaveBeenCalledWith(
        "acc-1",
        "bucket-2",
        expect.objectContaining({ prefix: "" }),
      );
    });
    await findRowByLabel("docs");

    await user.dblClick(await findRowByLabel("docs"));
    await waitFor(() => {
      expect(listBrowserObjectsMock).toHaveBeenCalledWith(
        "acc-1",
        "bucket-2",
        expect.objectContaining({ prefix: "docs/" }),
      );
    });
    expect(
      within(getContextPanel()).getByText("bucket-2/docs"),
    ).toBeInTheDocument();

    firstRender.unmount();

    const secondRender = renderPage({
      accountIdForApi: "acc-2",
      defaultShowInspector: true,
    });
    await findRowByLabel("a.txt");

    expect(within(getContextPanel()).getByText("bucket-a")).toBeInTheDocument();
    expect(
      within(getContextPanel()).queryByText("bucket-2/docs"),
    ).not.toBeInTheDocument();

    secondRender.unmount();

    renderPage({ accountIdForApi: "acc-1", defaultShowInspector: true });
    await screen.findByText("readme.txt");

    await waitFor(() => {
      expect(listBrowserObjectsMock).toHaveBeenCalledWith(
        "acc-1",
        "bucket-2",
        expect.objectContaining({ prefix: "docs/" }),
      );
    });
    expect(
      within(getContextPanel()).getByText("bucket-2/docs"),
    ).toBeInTheDocument();
  });

  it("commits an edited path and returns to its parent from the context bar", async () => {
    const user = userEvent.setup();
    renderPage();
    await findRowByLabel("docs");

    const toolbar = getContextToolbar();
    await user.click(within(toolbar).getByText("(root)"));
    const pathInput = within(toolbar).getByRole("combobox", { name: "Path" });
    await user.type(pathInput, "docs/{Enter}");

    await waitFor(() => {
      expect(listBrowserObjectsMock).toHaveBeenCalledWith(
        "acc-1",
        "bucket-1",
        expect.objectContaining({ prefix: "docs/" }),
      );
    });
    await user.click(
      within(getContextToolbar()).getByRole("button", {
        name: "Parent folder",
      }),
    );

    await waitFor(() => {
      expect(listBrowserObjectsMock).toHaveBeenCalledWith(
        "acc-1",
        "bucket-1",
        expect.objectContaining({ prefix: "" }),
      );
    });
  });

  it("falls back cleanly when a stored bucket is no longer available", async () => {
    searchBrowserBucketsMock.mockImplementation(
      (_accountId: string, options?: { search?: string; exact?: boolean }) => {
        const allBuckets = [{ name: "bucket-1" }];
        const search = options?.search?.trim() ?? "";
        const filtered = search
          ? allBuckets.filter((bucket) =>
              options?.exact
                ? bucket.name === search
                : bucket.name.includes(search),
            )
          : allBuckets;
        return Promise.resolve({
          items: filtered,
          total: filtered.length,
          page: 1,
          page_size: 50,
          has_next: false,
        });
      },
    );
    seedBrowserRootUiState({
      layout: { showFolders: false, showInspector: true, showActionBar: false },
      contextSelections: {
        "acc-1": { bucketName: "missing-bucket", prefix: "docs/" },
      },
    });

    renderPage({ accountIdForApi: "acc-1", defaultShowInspector: true });

    await waitFor(() => {
      expect(listBrowserObjectsMock).toHaveBeenCalledWith(
        "acc-1",
        "bucket-1",
        expect.objectContaining({ prefix: "" }),
      );
    });
    expect(within(getContextPanel()).getByText("bucket-1")).toBeInTheDocument();
    expect(
      within(getContextPanel()).queryByText("bucket-1/docs"),
    ).not.toBeInTheDocument();
  });

  it("lets an explicit ?bucket override reset the restored path to the bucket root", async () => {
    searchBrowserBucketsMock.mockImplementation(
      (_accountId: string, options?: { search?: string; exact?: boolean }) => {
        const allBuckets = [{ name: "bucket-1" }, { name: "bucket-2" }];
        const search = options?.search?.trim() ?? "";
        const filtered = search
          ? allBuckets.filter((bucket) =>
              options?.exact
                ? bucket.name === search
                : bucket.name.includes(search),
            )
          : allBuckets;
        return Promise.resolve({
          items: filtered,
          total: filtered.length,
          page: 1,
          page_size: 50,
          has_next: false,
        });
      },
    );
    seedBrowserRootUiState({
      layout: { showFolders: false, showInspector: true, showActionBar: false },
      contextSelections: {
        "acc-1": { bucketName: "bucket-2", prefix: "docs/" },
      },
    });

    renderPage({
      accountIdForApi: "acc-1",
      defaultShowInspector: true,
      initialEntry: "/browser?bucket=bucket-1",
    });
    await findRowByLabel("a.txt");

    await waitFor(() => {
      expect(listBrowserObjectsMock).toHaveBeenCalledWith(
        "acc-1",
        "bucket-1",
        expect.objectContaining({ prefix: "" }),
      );
    });
    expect(within(getContextPanel()).getByText("bucket-1")).toBeInTheDocument();
    expect(
      within(getContextPanel()).queryByText("bucket-1/docs"),
    ).not.toBeInTheDocument();
  });

  it("shows a single current bucket prompt when no bucket is selected", async () => {
    searchBrowserBucketsMock.mockResolvedValue({
      items: [{ name: "bucket-1" }, { name: "bucket-2" }],
      total: 2,
      page: 1,
      page_size: 50,
      has_next: false,
    });

    renderPage({ defaultShowFolders: true });

    await waitFor(() => {
      expect(
        getCurrentBucketPanel().getByText("Select a bucket to browse folders."),
      ).toBeInTheDocument();
    });
    expect(
      getCurrentBucketPanel().queryByText("Select a bucket to view folders."),
    ).not.toBeInTheDocument();
  });

  it("pins the current bucket above the list and only exposes folders for the active bucket", async () => {
    const user = userEvent.setup();
    searchBrowserBucketsMock.mockResolvedValue({
      items: [{ name: "bucket-1" }, { name: "bucket-2" }],
      total: 2,
      page: 1,
      page_size: 50,
      has_next: false,
    });
    listBrowserObjectsMock.mockImplementation(
      (_accountId: string, bucket: string, payload?: { prefix?: string }) => {
        const prefix = payload?.prefix ?? "";
        if (bucket === "bucket-2") {
          return Promise.resolve({
            prefix,
            objects: [],
            prefixes: prefix ? [] : ["images/"],
            is_truncated: false,
            next_continuation_token: null,
          });
        }
        return Promise.resolve({
          prefix,
          objects: [],
          prefixes: prefix ? [] : ["docs/"],
          is_truncated: false,
          next_continuation_token: null,
        });
      },
    );

    renderPage({
      defaultShowFolders: true,
      initialEntry: "/browser?bucket=bucket-1",
    });
    await waitFor(() => {
      expect(
        getCurrentBucketPanel().getByRole("button", { name: "docs" }),
      ).toBeInTheDocument();
    });
    expect(getCurrentBucketPanel().queryByText("bucket-1")).not.toBeInTheDocument();

    expect(
      getCurrentBucketPanel().getByRole("button", { name: "docs" }),
    ).toBeInTheDocument();
    expect(
      getOtherBucketsPanel().getByRole("button", { name: /bucket-2/i }),
    ).toBeInTheDocument();
    expect(
      getOtherBucketsPanel().queryByRole("button", { name: "docs" }),
    ).not.toBeInTheDocument();

    await user.click(
      getOtherBucketsPanel().getByRole("button", { name: /bucket-2/i }),
    );
    await waitFor(() => {
      expect(listBrowserObjectsMock).toHaveBeenCalledWith(
        "acc-1",
        "bucket-2",
        expect.objectContaining({ prefix: "" }),
      );
    });

    expect(
      getCurrentBucketPanel().getByRole("button", { name: "images" }),
    ).toBeInTheDocument();
    expect(getCurrentBucketPanel().queryByText("bucket-2")).not.toBeInTheDocument();
    expect(
      getCurrentBucketPanel().queryByRole("button", { name: "docs" }),
    ).not.toBeInTheDocument();
    expect(
      within(getContextToolbar()).getByRole("button", {
        name: "Select bucket",
      }),
    ).toHaveTextContent("bucket-2");
  });

  it("filters the workspace sidebar without hiding the current folders panel", async () => {
    const user = userEvent.setup();
    searchBrowserBucketsMock.mockImplementation(
      (_accountId: string, options?: { search?: string; exact?: boolean }) => {
        const allBuckets = [{ name: "bucket-1" }, { name: "bucket-2" }];
        const search = options?.search?.trim() ?? "";
        const filtered = search
          ? allBuckets.filter((bucket) =>
              options?.exact
                ? bucket.name === search
                : bucket.name.includes(search),
            )
          : allBuckets;
        return Promise.resolve({
          items: filtered,
          total: filtered.length,
          page: 1,
          page_size: 50,
          has_next: false,
        });
      },
    );

    renderPage({
      accountIdForApi: "acc-1",
      defaultShowFolders: true,
      initialEntry: "/browser?bucket=bucket-2",
    });

    await waitFor(() => {
      expect(
        getCurrentBucketPanel().getByRole("button", { name: "docs" }),
      ).toBeInTheDocument();
    });

    const sidebar = screen.getByTestId("browser-workspace-sidebar");
    const sidebarRefreshButton = within(sidebar).getByRole("button", {
      name: "Refresh buckets",
    });
    expect(sidebarRefreshButton.textContent).toBe("");
    expect(sidebarRefreshButton).toHaveAttribute("title", "Refresh");
    const foldersRefreshButton = screen.getByRole("button", {
      name: "Refresh folders",
    });
    expect(foldersRefreshButton.textContent).toBe("");
    expect(foldersRefreshButton).toHaveAttribute("title", "Refresh folders");

    await user.type(screen.getByPlaceholderText("Search buckets"), "zzz");
    expect(await screen.findByText("No matching item.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Current bucket" })).toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText("Search buckets"));
    await waitFor(() => {
      expect(
        getOtherBucketsPanel().getByRole("button", { name: /bucket-1/i }),
      ).toBeInTheDocument();
    });
  });

  it("shows a friendly message when bucket listing is denied", async () => {
    const friendlyMessage =
      "The current account is not allowed to list buckets. You can still open a bucket you have access to directly, or ask an administrator to update your permissions.";
    searchBrowserBucketsMock.mockRejectedValue(
      new Error(
        "Unable to list buckets: An error occurred (AccessDenied) when calling the ListBuckets operation: None",
      ),
    );

    renderPage({ accountIdForApi: "acc-1" });

    const sidebar = await screen.findByTestId("browser-workspace-sidebar");
    expect(await screen.findByText(friendlyMessage)).toBeInTheDocument();
    expect(screen.getAllByText(friendlyMessage)).toHaveLength(1);
    expect(within(sidebar).queryByText(friendlyMessage)).not.toBeInTheDocument();
    expect(within(sidebar).getByText("Bucket list unavailable.")).toBeInTheDocument();
    expect(within(sidebar).queryByText(/AccessDenied|ListBuckets|An error occurred/i)).not.toBeInTheDocument();
  });

  it("renders account usage as a compact workspace sidebar gauge", async () => {
    fetchBrowserUsageSummaryMock.mockResolvedValue({
      available: true,
      label: "Account",
      used_bytes: 512 * 1024 * 1024,
      object_count: 1234,
      quota_max_size_bytes: 2 * 1024 * 1024 * 1024,
      quota_max_objects: null,
    });

    renderPage();

    const sidebar = await screen.findByTestId("browser-workspace-sidebar");
    const meter = await within(sidebar).findByRole("meter", {
      name: "Storage usage",
    });
    expect(meter).toHaveAttribute("aria-valuenow", "25");
    expect(within(sidebar).getByText("Usage:")).toBeInTheDocument();
    expect(within(sidebar).getByText("512 MB")).toBeInTheDocument();
    expect(within(sidebar).getByText("2.0 GB")).toBeInTheDocument();
    expect(within(sidebar).queryByText(/objects/i)).not.toBeInTheDocument();
  });

  it("opens a Portal Browser account in the Portal workspace from the sidebar", async () => {
    const user = userEvent.setup();
    const portalContext = makeExecutionContext({
      id: "101",
      kind: "portal_account",
      manager_role: null,
    });
    setBrowserContext({
      contexts: [portalContext],
      selectedContextId: "101",
      selectedContext: portalContext,
      requiresContextSelection: true,
      selectorForApi: "101",
      selectedKind: "portal_account",
    });

    renderPage();

    const sidebar = await screen.findByTestId("browser-workspace-sidebar");
    expect(within(sidebar).queryByRole("button", { name: "Usage & Metrics" })).not.toBeInTheDocument();
    await user.click(await within(sidebar).findByRole("button", { name: "Open in Portal" }));

    expect(window.localStorage.getItem("selectedPortalAccountId")).toBe("101");
    expect(window.localStorage.getItem("selectedWorkspace")).toBe("portal");
    expect(screen.getByLabelText("Current location")).toHaveTextContent("/portal?project=101");
  });

  it("opens a manager-available Portal Browser account in Manager from the sidebar", async () => {
    const user = userEvent.setup();
    const portalContext = makeExecutionContext({
      id: "101",
      kind: "portal_account",
      manager_role: "account_administrator",
    });
    setBrowserContext({
      contexts: [portalContext],
      selectedContextId: "101",
      selectedContext: portalContext,
      requiresContextSelection: true,
      selectorForApi: "101",
      selectedKind: "portal_account",
    });

    renderPage();

    const sidebar = await screen.findByTestId("browser-workspace-sidebar");
    await user.click(await within(sidebar).findByRole("button", { name: "Open in Manager" }));

    expect(window.localStorage.getItem("selectedManagerExecutionContextId")).toBe("101");
    expect(window.localStorage.getItem("selectedWorkspace")).toBe("manager");
    expect(screen.getByLabelText("Current location")).toHaveTextContent("/manager?ctx=101");
  });

  it("opens an S3 user Browser context in Manager from the sidebar", async () => {
    const user = userEvent.setup();
    const s3UserContext = makeExecutionContext({
      id: "s3u-21215",
      kind: "s3_user",
      display_name: "Test_USER21215",
    });
    setBrowserContext({
      contexts: [s3UserContext],
      selectedContextId: "s3u-21215",
      selectedContext: s3UserContext,
      requiresContextSelection: true,
      selectorForApi: "s3u-21215",
      selectedKind: "s3_user",
    });

    renderPage({ accountIdForApi: "s3u-21215" });

    const sidebar = await screen.findByTestId("browser-workspace-sidebar");
    await user.click(await within(sidebar).findByRole("button", { name: "Open in Manager" }));

    expect(window.localStorage.getItem("selectedManagerExecutionContextId")).toBe("s3u-21215");
    expect(window.localStorage.getItem("selectedWorkspace")).toBe("manager");
    expect(screen.getByLabelText("Current location")).toHaveTextContent("/manager?ctx=s3u-21215");
  });

  it("marks inaccessible buckets from the visible panel list and keeps them selectable", async () => {
    const user = userEvent.setup();
    searchBrowserBucketsMock.mockResolvedValue({
      items: [{ name: "bucket-1" }, { name: "locked-bucket" }],
      total: 2,
      page: 1,
      page_size: 50,
      has_next: false,
    });
    listBrowserObjectsMock.mockImplementation(
      (_accountId: string, bucket: string, _options?: { maxKeys?: number }) => {
        if (bucket === "locked-bucket") {
          return Promise.reject(new ApiError("Request failed with status 403", {
            response: {
              status: 403,
              data: { detail: "Forbidden by policy" },
              headers: {},
            },
          }));
        }
        return Promise.resolve({
          prefix: "",
          objects: [],
          prefixes: ["docs/"],
          is_truncated: false,
          next_continuation_token: null,
        });
      },
    );

    renderPage({
      defaultShowFolders: true,
      initialEntry: "/browser?bucket=bucket-1",
    });

    const inaccessibleBucketButton = await screen.findByRole("button", {
      name: /locked-bucket/i,
    });
    await waitFor(() => {
      expect(
        getOtherBucketsPanel().getByText("No list access"),
      ).toBeInTheDocument();
    });
    expect(inaccessibleBucketButton).toHaveAttribute(
      "title",
      "Listing not allowed with current credentials.",
    );

    await user.click(inaccessibleBucketButton);
    expect(
      await screen.findByText(
        "Listing is not available for this bucket.",
      ),
    ).toBeInTheDocument();
    expect(
      getCurrentBucketPanel().getByText(
        "Folder tree unavailable with current credentials.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Forbidden by policy")).not.toBeInTheDocument();

    await user.click(screen.getByText("Show technical details"));
    expect(await screen.findByText("Forbidden by policy")).toBeInTheDocument();
    expect(screen.getAllByText("Forbidden by policy")).toHaveLength(1);
  });

  it("keeps generic bucket probe failures out of the no-access state", async () => {
    const user = userEvent.setup();
    searchBrowserBucketsMock.mockResolvedValue({
      items: [{ name: "bucket-1" }, { name: "flaky-bucket" }],
      total: 2,
      page: 1,
      page_size: 50,
      has_next: false,
    });
    listBrowserObjectsMock.mockImplementation(
      (_accountId: string, bucket: string, _options?: { maxKeys?: number }) => {
        if (bucket === "flaky-bucket") {
          return Promise.reject(new ApiError("Failed to fetch", {
            response: { status: 502, data: {}, headers: {} },
          }));
        }
        return Promise.resolve({
          prefix: "",
          objects: [],
          prefixes: ["docs/"],
          is_truncated: false,
          next_continuation_token: null,
        });
      },
    );

    renderPage({
      defaultShowFolders: true,
      initialEntry: "/browser?bucket=bucket-1",
    });

    await waitFor(() => {
      expect(listBrowserObjectsMock).toHaveBeenCalledWith(
        "acc-1",
        "flaky-bucket",
        expect.objectContaining({ maxKeys: 1 }),
      );
    });
    expect(getOtherBucketsPanel().queryByText("No list access")).not.toBeInTheDocument();

    const flakyBucketButton = await screen.findByRole("button", {
      name: /flaky-bucket/i,
    });
    expect(flakyBucketButton).toHaveAttribute("title", "flaky-bucket");

    await user.click(flakyBucketButton);
    expect(
      await screen.findByText("Unable to load objects for this bucket."),
    ).toBeInTheDocument();
    expect(
      getCurrentBucketPanel().queryByText(
        "Folder tree unavailable with current credentials.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Network Error")).not.toBeInTheDocument();

    await user.click(screen.getByText("Show technical details"));
    expect(
      await screen.findByText("Unable to list objects for this prefix."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Network Error")).not.toBeInTheDocument();
  });

  it("loads more buckets from the panel without dropping the pinned current bucket", async () => {
    const user = userEvent.setup();
    searchBrowserBucketsMock.mockImplementation(
      (_accountId: string, options?: { page?: number }) => {
        const page = options?.page ?? 1;
        if (page === 1) {
          return Promise.resolve({
            items: [{ name: "bucket-1" }, { name: "bucket-2" }],
            total: 4,
            page: 1,
            page_size: 2,
            has_next: true,
          });
        }
        return Promise.resolve({
          items: [{ name: "bucket-3" }, { name: "bucket-4" }],
          total: 4,
          page: 2,
          page_size: 2,
          has_next: false,
        });
      },
    );

    renderPage({
      defaultShowFolders: true,
      initialEntry: "/browser?bucket=bucket-1",
    });
    await waitFor(() => {
      expect(
        getCurrentBucketPanel().getByRole("button", { name: "docs" }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => {
      expect(
        getOtherBucketsPanel().getByRole("button", { name: /bucket-4/i }),
      ).toBeInTheDocument();
    });
    expect(getCurrentBucketPanel().queryByText("bucket-1")).not.toBeInTheDocument();
  });

  it("scrolls the buckets panel back to the top when the active bucket changes", async () => {
    const user = userEvent.setup();
    const scrollToMock = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollToMock,
    });
    searchBrowserBucketsMock.mockResolvedValue({
      items: [{ name: "bucket-1" }, { name: "bucket-2" }],
      total: 2,
      page: 1,
      page_size: 50,
      has_next: false,
    });

    renderPage({
      defaultShowFolders: true,
      initialEntry: "/browser?bucket=bucket-1",
    });
    await waitFor(() => {
      expect(
        getCurrentBucketPanel().getByRole("button", { name: "docs" }),
      ).toBeInTheDocument();
    });

    scrollToMock.mockClear();
    await user.click(
      getOtherBucketsPanel().getByRole("button", { name: /bucket-2/i }),
    );

    await waitFor(() => {
      expect(scrollToMock).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
    });
  });

  it("shows selection actions inline and secondary actions in More when the action bar is enabled", async () => {
    const user = userEvent.setup();
    renderPage();
    await enableActionBar(user);

    await user.click(await findRowByLabel("a.txt"));

    const actionsToolbar = getActionsToolbar();
    const orderedButtons = [
      "Open",
      "Copy",
      "Download",
      "Delete",
      "More",
    ].map((name) => within(actionsToolbar).getByRole("button", { name }));

    expect(within(actionsToolbar).getByText("1 selected")).toBeInTheDocument();
    for (let index = 0; index < orderedButtons.length - 1; index += 1) {
      expect(
        Boolean(
          orderedButtons[index].compareDocumentPosition(
            orderedButtons[index + 1],
          ) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      ).toBe(true);
    }
    expect(
      within(actionsToolbar).getByRole("button", { name: "Open" }),
    ).toBeEnabled();
    expect(
      within(actionsToolbar).getByRole("button", { name: "Copy" }),
    ).toBeInTheDocument();
    expect(
      within(actionsToolbar).getByRole("button", { name: "Delete" }),
    ).toBeInTheDocument();
    expect(
      within(actionsToolbar).queryByRole("button", { name: "Cut" }),
    ).not.toBeInTheDocument();
    expect(
      within(actionsToolbar).queryByRole("button", { name: "Copy URL" }),
    ).not.toBeInTheDocument();

    const menu = await openActionsMoreMenu(user);

    expect(
      within(menu).getByRole("menuitem", { name: "Upload files" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: "Upload folder" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: "New folder" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: "Paste" }),
    ).toBeDisabled();

    expect(
      within(menu).getByRole("menuitem", { name: "Copy URL" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: "Cut" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: "Bulk attributes" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: "Advanced" }),
    ).toBeInTheDocument();
  });

  it("keeps a single folder selection downloadable with a stable toolbar label", async () => {
    const user = userEvent.setup();
    renderPage();
    await enableActionBar(user);

    await user.click(await findRowByLabel("docs"));

    const actionsToolbar = getActionsToolbar();

    expect(within(actionsToolbar).getByText("1 selected")).toBeInTheDocument();
    expect(
      within(actionsToolbar).getByRole("button", { name: "Download" }),
    ).toBeEnabled();
    expect(
      within(actionsToolbar).queryByRole("button", { name: "Download folder" }),
    ).not.toBeInTheDocument();
    expect(
      within(actionsToolbar).getByRole("button", { name: "Open" }),
    ).toBeEnabled();
    expect(
      within(actionsToolbar).queryByRole("button", { name: "Preview" }),
    ).not.toBeInTheDocument();
  });

  it("uses shared controls and English labels in the SSE-C key modal", async () => {
    const user = userEvent.setup();
    renderPage({
      accountIdForApi: "acc-1",
      initialEntry: "/browser?bucket=bucket-1",
      storageEndpointCapabilities: { sse: true },
    });
    await findRowByLabel("a.txt");

    const moreMenu = await openContextMoreMenu(user);
    await user.click(within(moreMenu).getByRole("menuitem", { name: /SSE-C/i }));

    const dialog = await screen.findByRole("dialog", { name: "SSE-C key" });
    const showButton = within(dialog).getByRole("button", { name: "Show" });
    const cancelButton = within(dialog).getByRole("button", { name: "Cancel" });
    const generateButton = within(dialog).getByRole("button", { name: "Generate" });
    const clearButton = within(dialog).getByRole("button", { name: "Clear" });
    const enableButton = within(dialog).getByRole("button", { name: "Enable" });

    for (const button of [
      showButton,
      cancelButton,
      generateButton,
      clearButton,
      enableButton,
    ]) {
      expect(button).toHaveClass("ui-button-base");
    }

    expect(within(dialog).queryByRole("button", { name: "Afficher" })).not.toBeInTheDocument();
    await user.click(showButton);
    expect(within(dialog).getByRole("button", { name: "Hide" })).toHaveClass("ui-button-base");
  });

  it("activates an SSE-C key for the current browser scope", async () => {
    const user = userEvent.setup();
    renderPage({
      accountIdForApi: "acc-1",
      initialEntry: "/browser?bucket=bucket-1",
      storageEndpointCapabilities: { sse: true },
    });
    await findRowByLabel("a.txt");

    const moreMenu = await openContextMoreMenu(user);
    await user.click(within(moreMenu).getByRole("menuitem", { name: /SSE-C/i }));

    const dialog = await screen.findByRole("dialog", { name: "SSE-C key" });
    const keyBase64 = btoa("a".repeat(32));
    await user.type(
      within(dialog).getByLabelText("Customer key (base64, 32 bytes)"),
      keyBase64,
    );
    await user.click(within(dialog).getByRole("button", { name: "Enable" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "SSE-C key" }),
      ).not.toBeInTheDocument();
    });
    const enabledMenu = await openContextMoreMenu(user);
    expect(
      within(enabledMenu).getByText("Enabled for this bucket"),
    ).toBeInTheDocument();
  });

  it("hides the selection bar on Escape and keeps Paste as a context action", async () => {
    const user = userEvent.setup();
    renderPage();
    await enableActionBar(user);

    const objectsList = screen.getByLabelText("Objects list");
    await copyOrCutItem(user, "a.txt", "Copy");
    (objectsList as HTMLDivElement).focus();
    fireEvent.keyDown(objectsList, { key: "Escape" });

    expect(screen.queryByRole("toolbar", { name: "Browser actions bar" })).not.toBeInTheDocument();
    const menu = await openContextMoreMenu(user);
    expect(within(menu).getByRole("menuitem", { name: "Paste" })).toBeEnabled();
  });

  it("opens the primary Preview from the action bar into the unified modal", async () => {
    const user = userEvent.setup();
    renderPage();
    await enableActionBar(user);

    await user.click(await findRowByLabel("a.txt"));
    await user.click(
      within(getActionsToolbar()).getByRole("button", { name: "Open" }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Object details · a.txt",
    });
    expect(
      within(dialog).getByRole("tab", { name: "Preview" }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("preserves refresh behavior from the compact toolbar", async () => {
    const user = userEvent.setup();
    renderPage();
    await findRowByLabel("a.txt");

    const initialCalls = listBrowserObjectsMock.mock.calls.length;
    await user.click(
      within(getContextToolbar()).getByRole("button", { name: "Refresh" }),
    );

    await waitFor(() => {
      expect(listBrowserObjectsMock.mock.calls.length).toBe(initialCalls + 1);
    });
  });

  it("closes the toolbar More menu when the selection changes", async () => {
    const user = userEvent.setup();
    renderPage();

    const row = await findRowByLabel("a.txt");
    const moreMenu = await openContextMoreMenu(user);
    expect(moreMenu).toBeInTheDocument();

    await user.click(row);

    await waitFor(() => {
      expect(moreMenu).not.toBeInTheDocument();
    });
  });

  it("uses the automatic selection bar More menu for secondary actions", async () => {
    const user = userEvent.setup();
    renderPage();

    const rowA = await findRowByLabel("a.txt");
    const rowB = await findRowByLabel("b.txt");

    await user.click(rowA);
    fireEvent.click(rowB, { ctrlKey: true });

    const contextToolbar = getContextToolbar();
    expect(
      within(contextToolbar).queryByRole("button", { name: "Download" }),
    ).not.toBeInTheDocument();
    expect(
      within(contextToolbar).queryByRole("button", { name: "Copy" }),
    ).not.toBeInTheDocument();
    expect(
      within(contextToolbar).queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();

    const moreMenu = await openActionsMoreMenu(user);

    expect(
      within(getActionsToolbar()).getByRole("button", { name: "Download" }),
    ).toBeInTheDocument();
    expect(
      within(getActionsToolbar()).getByRole("button", { name: "Copy" }),
    ).toBeInTheDocument();
    expect(
      within(moreMenu).getByRole("menuitem", { name: "Cut" }),
    ).toBeInTheDocument();
    expect(
      within(moreMenu).getByRole("menuitem", { name: "Bulk attributes" }),
    ).toBeInTheDocument();
    expect(
      within(getActionsToolbar()).getByRole("button", { name: "Delete" }),
    ).toBeInTheDocument();
    await user.click(document.body);

    fireEvent.contextMenu(rowB);
    const menu = await screen.findByRole("menu");

    expect(
      within(menu).getByRole("button", { name: "Download" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("button", { name: "Copy" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("button", { name: "Delete" }),
    ).toBeInTheDocument();
  });

  it("hides main-browser-only status and panel controls from More in embedded mode", async () => {
    const user = userEvent.setup();
    renderEmbeddedPage();
    await findRowByLabel("a.txt");

    expect(screen.getAllByRole("toolbar")).toHaveLength(1);
    expect(
      within(getContextToolbar()).queryByRole("button", { name: "Operations" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("complementary", { name: "Operations" }),
    ).not.toBeInTheDocument();
    expect(
      within(getContextToolbar()).getByRole("button", { name: "Upload" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("toolbar", { name: "Browser actions bar" }),
    ).not.toBeInTheDocument();

    await user.click(
      within(getContextToolbar()).getByRole("button", { name: "More" }),
    );
    const menu = await screen.findByRole("menu", { name: "More" });

    expect(within(menu).queryByText("Compact density")).not.toBeInTheDocument();
    expect(within(menu).getByText("Current path")).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: "Copy path" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: "Paste" }),
    ).toBeDisabled();
    expect(
      within(menu).queryByRole("menuitemcheckbox", { name: /Folders panel/i }),
    ).not.toBeInTheDocument();
    expect(
      within(menu).queryByRole("menuitemcheckbox", {
        name: /Inspector panel/i,
      }),
    ).not.toBeInTheDocument();
    expect(
      within(menu).queryByRole("menuitemcheckbox", { name: /Action bar/i }),
    ).not.toBeInTheDocument();
  });

  it("supports Cmd/Ctrl click toggle selection", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await findRowByLabel("a.txt"));
    fireEvent.click(await findRowByLabel("b.txt"), { ctrlKey: true });

    expect(
      screen.getByRole("checkbox", { name: "Select a.txt" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Select b.txt" }),
    ).toBeChecked();

    fireEvent.click(await findRowByLabel("b.txt"), { ctrlKey: true });

    expect(
      screen.getByRole("checkbox", { name: "Select a.txt" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Select b.txt" }),
    ).not.toBeChecked();
  });

  it("supports Shift click range selection", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await findRowByLabel("a.txt"));
    fireEvent.click(await findRowByLabel("c.txt"), { shiftKey: true });

    expect(
      screen.getByRole("checkbox", { name: "Select a.txt" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Select b.txt" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Select c.txt" }),
    ).toBeChecked();
  });

  it("navigates into a folder on double-click without leaving the previous listing visible", async () => {
    const user = userEvent.setup();
    let resolveDocsListing:
      | ((value: {
          prefix: string;
          objects: Array<{
            key: string;
            size: number;
            last_modified: string;
            storage_class: string;
            etag: string;
          }>;
          prefixes: string[];
          is_truncated: boolean;
          next_continuation_token: null;
        }) => void)
      | null = null;

    listBrowserObjectsMock.mockImplementation(
      (
        _accountId: string,
        _bucketName: string,
        payload?: { prefix?: string },
      ) => {
        const nextPrefix = payload?.prefix ?? "";
        if (nextPrefix === "docs/") {
          return new Promise((resolve) => {
            resolveDocsListing = resolve;
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
              etag: '"etag-a"',
            },
            {
              key: "b.txt",
              size: 20,
              last_modified: "2026-03-10T10:16:00Z",
              storage_class: "STANDARD",
              etag: '"etag-b"',
            },
            {
              key: "c.txt",
              size: 30,
              last_modified: "2026-03-10T10:17:00Z",
              storage_class: "STANDARD",
              etag: '"etag-c"',
            },
          ],
          prefixes: ["docs/"],
          is_truncated: false,
          next_continuation_token: null,
        });
      },
    );

    renderPage();

    await user.dblClick(await findRowByLabel("docs"));

    await waitFor(() => {
      expect(listBrowserObjectsMock).toHaveBeenCalledWith(
        "acc-1",
        "bucket-1",
        expect.objectContaining({ prefix: "docs/" }),
      );
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "a.txt" }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText("Loading objects...")).toBeInTheDocument();

    await act(async () => {
      resolveDocsListing?.({
        prefix: "docs/",
        objects: [
          {
            key: "docs/readme.txt",
            size: 42,
            last_modified: "2026-03-10T10:45:00Z",
            storage_class: "STANDARD",
            etag: '"etag-docs"',
          },
        ],
        prefixes: [],
        is_truncated: false,
        next_continuation_token: null,
      });
    });
  });

  it("opens the unified preview modal on file double-click", async () => {
    const user = userEvent.setup();
    renderPage({ defaultShowInspector: true });

    await user.dblClick(await findRowByLabel("a.txt"));

    const dialog = await screen.findByRole("dialog", {
      name: "Object details · a.txt",
    });
    expect(
      within(dialog).getByRole("tab", { name: "Preview" }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("opens the single-row actions menu from More actions and routes Details to the inspector", async () => {
    const user = userEvent.setup();
    getBucketVersioningMock.mockResolvedValue({
      enabled: true,
      status: "Enabled",
    });
    renderPage({ defaultShowInspector: true });

    await user.click(await findRowByLabel("a.txt"));
    expect(screen.getByRole("tablist", { name: "Inspector tabs" })).toBeInTheDocument();

    await user.click(
      within(await findRowByLabel("a.txt")).getByRole("button", {
        name: "More actions for a.txt",
      }),
    );
    const menu = await screen.findByRole("menu");
    const menuButtons = within(menu)
      .getAllByRole("button")
      .map((button) => button.textContent?.trim());

    expect(
      within(menu).getByRole("button", { name: "Details" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("button", { name: "Preview" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("button", { name: "Properties" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("button", { name: "Download" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("button", { name: "Copy URL" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("button", { name: "Copy" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("button", { name: "Cut" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("button", { name: "Delete" }),
    ).toBeInTheDocument();
    expect(menuButtons.indexOf("Details")).toBeLessThan(
      menuButtons.indexOf("Preview"),
    );
    expect(menuButtons.indexOf("Preview")).toBeLessThan(
      menuButtons.indexOf("Versions"),
    );
    expect(menuButtons.indexOf("Versions")).toBeLessThan(
      menuButtons.indexOf("Properties"),
    );
    expect(menuButtons).not.toContain("Advanced");
    await user.click(within(menu).getByRole("button", { name: "Details" }));

    expect(
      await screen.findByRole("tablist", { name: "Inspector tabs" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.queryByRole("dialog", { name: "Object details · a.txt" }),
    ).not.toBeInTheDocument();
  });

  it("does not show a focused fallback in Selection tab when no object is selected", async () => {
    const user = userEvent.setup();
    renderPage({ defaultShowInspector: true });

    await user.click(await findRowByLabel("a.txt"));
    const objectsList = screen.getByLabelText("Objects list");
    (objectsList as HTMLDivElement).focus();
    fireEvent.keyDown(objectsList, { key: "Escape" });

    await user.click(screen.getByRole("tab", { name: "Selection" }));

    expect(screen.queryByText(/^Focused:/)).not.toBeInTheDocument();
    expect(
      screen.getByText("Select one or more objects to see selection actions."),
    ).toBeInTheDocument();
  });

  it("opens Preview and Properties from the file actions menu into the unified modal", async () => {
    const user = userEvent.setup();
    getBucketVersioningMock.mockResolvedValue({
      enabled: true,
      status: "Enabled",
    });
    renderPage({ defaultShowInspector: false });

    const row = await findRowByLabel("a.txt");

    await user.click(within(row).getByRole("button", { name: "More actions for a.txt" }));
    let menu = await screen.findByRole("menu");
    await user.click(within(menu).getByRole("button", { name: "Preview" }));

    let dialog = await screen.findByRole("dialog", {
      name: "Object details · a.txt",
    });
    expect(within(dialog).getByRole("tab", { name: "Preview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.click(within(dialog).getByRole("button", { name: "Close modal" }));

    await user.click(within(row).getByRole("button", { name: "More actions for a.txt" }));
    menu = await screen.findByRole("menu");
    await user.click(within(menu).getByRole("button", { name: "Properties" }));

    dialog = await screen.findByRole("dialog", {
      name: "Object details · a.txt",
    });
    expect(
      within(dialog).getByRole("tab", { name: "Properties" }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("shows folder row actions from More actions with the same single-item menu content", async () => {
    const user = userEvent.setup();
    renderPage({ defaultShowInspector: true });

    await user.click(
      within(await findRowByLabel("docs")).getByRole("button", {
        name: "More actions for docs",
      }),
    );
    const menu = await screen.findByRole("menu");

    expect(
      within(menu).getByRole("button", { name: "Details" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("button", { name: "Open" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("button", { name: "Download folder" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("button", { name: "Copy" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("button", { name: "Cut" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("button", { name: "Delete" }),
    ).toBeInTheDocument();
  });

  it("keeps More actions available when the inspector panel is disabled and omits Details for files", async () => {
    const user = userEvent.setup();
    renderPage({ defaultShowInspector: false, allowInspectorPanel: false });

    const row = await findRowByLabel("a.txt");
    const moreButton = within(row).getByRole("button", {
      name: "More actions for a.txt",
    });
    expect(moreButton).toBeInTheDocument();

    await user.click(moreButton);
    const menu = await screen.findByRole("menu");

    expect(within(menu).queryByRole("button", { name: "Details" })).not.toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Preview" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Properties" })).toBeInTheDocument();
    expect(
      within(menu).getByRole("button", { name: "Download" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("tablist", { name: "Inspector tabs" }),
    ).not.toBeInTheDocument();

    expect(
      screen.queryByRole("dialog", { name: "Object details · a.txt" }),
    ).not.toBeInTheDocument();
  });

  it("keeps inspector tabs on one line and removes the counter from the Selection tab", async () => {
    const user = userEvent.setup();
    renderPage({ defaultShowInspector: true });

    await user.click(await findRowByLabel("a.txt"));

    const tablist = screen.getByRole("tablist", { name: "Inspector tabs" });
    const tabs = within(tablist).getAllByRole("tab");
    const selectionTab = within(tablist).getByRole("tab", {
      name: "Selection",
    });

    expect(tablist).toHaveClass("flex-nowrap");
    expect(tabs).toHaveLength(4);
    expect(selectionTab).toHaveTextContent(/^Selection$/);

    await user.click(selectionTab);

    expect(
      within(screen.getByRole("tabpanel", { name: "Selection" })).getByText(
        "1 selected",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the inspector context informative without an action toolbar", async () => {
    const user = userEvent.setup();
    getBucketVersioningMock.mockResolvedValue({
      enabled: true,
      status: "Enabled",
    });
    renderPage({ defaultShowInspector: true });

    await findRowByLabel("a.txt");
    await user.click(screen.getByRole("tab", { name: "Context" }));

    const panel = screen.getByRole("tabpanel", { name: "Context" });
    expect(within(panel).getByText("Current location")).toBeInTheDocument();
    expect(within(panel).queryByText("Actions")).not.toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Upload files" })).not.toBeInTheDocument();
  });

  it("keeps only the full-details link in the selection inspector", async () => {
    const user = userEvent.setup();
    renderPage({ defaultShowInspector: true });

    await user.click(await findRowByLabel("a.txt"));
    await user.click(screen.getByRole("tab", { name: "Selection" }));

    const panel = screen.getByRole("tabpanel", { name: "Selection" });
    expect(within(panel).getByRole("button", { name: "Open full details" })).toBeInTheDocument();
    expect(
      within(panel).queryByRole("button", { name: "Copy path" }),
    ).not.toBeInTheDocument();
    expect(within(panel).queryByText("Bulk actions")).not.toBeInTheDocument();
  });

  it("updates Details on simple row click when Details tab is active", async () => {
    const user = userEvent.setup();
    renderPage({ defaultShowInspector: true });

    await user.click(await findRowByLabel("a.txt"));
    await user.click(screen.getByRole("tab", { name: "Details" }));
    await waitFor(() => {
      expect(
        within(screen.getByRole("tabpanel", { name: "Details" })).getByText(
          "a.txt",
        ),
      ).toBeInTheDocument();
    });

    await user.click(await findRowByLabel("b.txt"));

    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await waitFor(() => {
      expect(
        within(screen.getByRole("tabpanel", { name: "Details" })).getByText(
          "b.txt",
        ),
      ).toBeInTheDocument();
    });
  });

  it("keeps the Details inspector informative and routes its only link to full details", async () => {
    const user = userEvent.setup();
    getBucketVersioningMock.mockResolvedValue({
      enabled: true,
      status: "Enabled",
    });
    renderPage({ defaultShowInspector: true });

    const rowA = await findRowByLabel("a.txt");
    await user.click(
      within(rowA).getByRole("button", {
        name: "More actions for a.txt",
      }),
    );
    const previewMenu = await screen.findByRole("menu");
    await user.click(within(previewMenu).getByRole("button", { name: "Preview" }));

    let dialog = await screen.findByRole("dialog", {
      name: "Object details · a.txt",
    });
    expect(
      within(dialog).getByRole("tab", { name: "Preview" }),
    ).toHaveAttribute("aria-selected", "true");
    await waitFor(() => {
      expect(presignObjectMock).toHaveBeenCalledWith(
        "acc-1",
        "bucket-1",
        expect.objectContaining({
          key: "a.txt",
          operation: "get_object",
          response_content_disposition: expect.stringContaining("inline;"),
        }),
        null,
        undefined,
      );
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "https://example.test/a.txt",
        expect.objectContaining({
          headers: {},
        }),
      );
    });
    await waitFor(() => {
      expect(
        within(dialog).queryByText("Loading preview..."),
      ).not.toBeInTheDocument();
    });
    expect(within(dialog).queryByTitle("Object preview")).not.toBeInTheDocument();
    expect(listObjectVersionsMock).not.toHaveBeenCalled();
    expect(getObjectLegalHoldMock).not.toHaveBeenCalled();
    expect(getObjectRetentionMock).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Close modal" }));

    await user.click(rowA);
    await user.click(screen.getByRole("tab", { name: "Details" }));
    const panel = screen.getByRole("tabpanel", { name: "Details" });

    await waitFor(() => {
      expect(listObjectVersionsMock).toHaveBeenCalledTimes(1);
    });
    expect(within(panel).getByText("No versions found.")).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Versions" })).not.toBeInTheDocument();

    await user.click(
      within(panel).getByRole("button", { name: "Open full details" }),
    );
    dialog = await screen.findByRole("dialog", {
      name: "Object details · a.txt",
    });
    expect(
      within(dialog).getByRole("tab", { name: "Properties" }),
    ).toHaveAttribute("aria-selected", "true");
    await waitFor(() => {
      expect(getObjectTagsMock).toHaveBeenCalledTimes(1);
    });
    expect(getObjectLegalHoldMock).not.toHaveBeenCalled();
    expect(getObjectRetentionMock).not.toHaveBeenCalled();

    await user.click(
      within(dialog).getByRole("tab", { name: "Access & Protection" }),
    );
    await waitFor(() => {
      expect(getObjectLegalHoldMock).toHaveBeenCalledTimes(1);
      expect(getObjectRetentionMock).toHaveBeenCalledTimes(1);
    });
  });

  it("submits an archive restore from the object details modal", async () => {
    const user = userEvent.setup();
    fetchObjectMetadataMock.mockResolvedValue({
      key: "a.txt",
      size: 10,
      metadata: {},
      content_type: "text/plain",
      storage_class: "GLACIER",
      version_id: "version-2",
    });
    renderPage();

    const row = await findRowByLabel("a.txt");
    await user.click(
      within(row).getByRole("button", { name: "More actions for a.txt" }),
    );
    await user.click(
      within(await screen.findByRole("menu")).getByRole("button", {
        name: "Properties",
      }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Object details · a.txt",
    });
    await user.click(await within(dialog).findByRole("tab", { name: "Archive" }));
    await user.clear(within(dialog).getByRole("spinbutton", { name: "Days" }));
    await user.type(
      within(dialog).getByRole("spinbutton", { name: "Days" }),
      "14",
    );
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Tier" }),
      "Bulk",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Request restore" }),
    );

    await waitFor(() => {
      expect(restoreObjectMock).toHaveBeenCalledWith(
        "acc-1",
        "bucket-1",
        {
          key: "a.txt",
          days: 14,
          tier: "Bulk",
          version_id: "version-2",
        },
        undefined,
      );
    });
    expect(
      await within(dialog).findByText("Restore request sent."),
    ).toBeInTheDocument();
    expect(fetchObjectMetadataMock).toHaveBeenCalledTimes(2);
  });

  it("updates a canned ACL from the object details modal", async () => {
    const user = userEvent.setup();
    renderPage();

    const row = await findRowByLabel("a.txt");
    await user.click(
      within(row).getByRole("button", { name: "More actions for a.txt" }),
    );
    await user.click(
      within(await screen.findByRole("menu")).getByRole("button", {
        name: "Properties",
      }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Object details · a.txt",
    });
    await user.click(
      within(dialog).getByRole("tab", { name: "Access & Protection" }),
    );
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Canned ACL" }),
      "public-read",
    );
    await user.click(within(dialog).getByRole("button", { name: "Save ACL" }));

    await waitFor(() => {
      expect(updateObjectAclMock).toHaveBeenCalledWith(
        "acc-1",
        "bucket-1",
        {
          key: "a.txt",
          acl: "public-read",
          version_id: null,
        },
        undefined,
        undefined,
      );
    });
    expect(await within(dialog).findByText("ACL updated.")).toBeInTheDocument();
  });

  it.each([
    ["dedicated", () => renderPage()],
    ["embedded", () => renderEmbeddedPage()],
  ] as const)(
    "opens an unavailable Preview without requesting object data in the %s Browser",
    async (_surface, renderBrowser) => {
      const user = userEvent.setup();
      listBrowserObjectsMock.mockResolvedValueOnce({
        prefix: "",
        objects: [
          {
            key: "large-video.mp4",
            size: OBJECT_PREVIEW_MAX_BYTES + 1,
            last_modified: "2026-03-10T10:15:00Z",
            storage_class: "STANDARD",
            etag: '"etag-large"',
          },
        ],
        prefixes: [],
        is_truncated: false,
        next_continuation_token: null,
      });
      renderBrowser();

      const row = await findRowByLabel("large-video.mp4");
      await user.click(
        within(row).getByRole("button", {
          name: "Open file large-video.mp4",
        }),
      );

      const dialog = await screen.findByRole("dialog", {
        name: "Object details · large-video.mp4",
      });
      expect(
        within(dialog).getByRole("tab", { name: "Preview" }),
      ).toHaveAttribute("aria-selected", "true");
      expect(
        within(dialog).getByText(
          "Preview is limited to files of 50 MiB or less. Download the file to open it.",
        ),
      ).toBeInTheDocument();
      expect(presignObjectMock).not.toHaveBeenCalled();
      expect(proxyDownloadMock).not.toHaveBeenCalled();
    },
  );

  it("clears Details content when Details is active and multi-selection is applied", async () => {
    const user = userEvent.setup();
    renderPage({ defaultShowInspector: true });

    await user.click(await findRowByLabel("a.txt"));
    await user.click(screen.getByRole("tab", { name: "Details" }));
    fireEvent.click(await findRowByLabel("b.txt"), { ctrlKey: true });

    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await waitFor(() => {
      expect(
        screen.getByText("Select a single object to view details."),
      ).toBeInTheDocument();
    });
  });

  it("shows disabled legal hold and retention controls when object lock is not enabled on the bucket", async () => {
    const user = userEvent.setup();
    const objectLockError = new Error(
      "Unable to fetch retention for 'a.txt': An error occurred (InvalidRequest) when calling the GetObjectRetention operation: bucket object lock not configured",
    );
    getObjectLegalHoldMock.mockRejectedValue(objectLockError);
    getObjectRetentionMock.mockRejectedValue(objectLockError);

    renderPage({ defaultShowInspector: true });

    await user.click(await findRowByLabel("a.txt"));
    await user.click(screen.getByRole("tab", { name: "Details" }));
    const panel = screen.getByRole("tabpanel", { name: "Details" });

    await user.click(
      within(panel).getByRole("button", { name: "Open full details" }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Object details · a.txt",
    });

    await user.click(
      within(dialog).getByRole("tab", { name: "Access & Protection" }),
    );

    await waitFor(() => {
      expect(getObjectLegalHoldMock).toHaveBeenCalledTimes(1);
      expect(getObjectRetentionMock).toHaveBeenCalledTimes(1);
    });

    expect(
      within(dialog).getAllByText(
        "Object Lock is not enabled on this bucket. Legal hold and retention settings are unavailable.",
      ),
    ).toHaveLength(2);
    expect(
      within(dialog).queryByText(/Unable to fetch retention/i),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByText(/Unable to load protection settings/i),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Update legal hold" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "Update retention" }),
    ).toBeDisabled();
    expect(within(dialog).getByLabelText("Bypass governance retention")).toBeDisabled();
  });

  it("clears Details content when Escape clears selection while Details is active", async () => {
    const user = userEvent.setup();
    renderPage({ defaultShowInspector: true });

    await user.click(await findRowByLabel("a.txt"));
    await user.click(screen.getByRole("tab", { name: "Details" }));

    const objectsList = screen.getByLabelText("Objects list");
    (objectsList as HTMLDivElement).focus();
    fireEvent.keyDown(objectsList, { key: "Escape" });

    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("checkbox", { name: "Select a.txt" }),
    ).not.toBeChecked();
    await waitFor(() => {
      expect(
        screen.getByText("Select a single object to view details."),
      ).toBeInTheDocument();
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
    expect(
      screen.getByRole("checkbox", { name: "Select a.txt" }),
    ).toBeChecked();

    fireEvent.keyDown(objectsList, { key: "End" });
    expect(
      screen.getByRole("checkbox", { name: "Select c.txt" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Select docs" }),
    ).not.toBeChecked();

    fireEvent.keyDown(objectsList, { key: " " });
    expect(
      screen.getByRole("checkbox", { name: "Select c.txt" }),
    ).not.toBeChecked();

    fireEvent.keyDown(objectsList, { key: "Home" });
    expect(screen.getByRole("checkbox", { name: "Select docs" })).toBeChecked();

    fireEvent.keyDown(objectsList, { key: "Escape" });
    expect(
      screen.getByRole("checkbox", { name: "Select docs" }),
    ).not.toBeChecked();

    fireEvent.keyDown(objectsList, { key: "Enter" });
    await waitFor(() => {
      expect(listBrowserObjectsMock).toHaveBeenCalledWith(
        "acc-1",
        "bucket-1",
        expect.objectContaining({ prefix: "docs/" }),
      );
    });
  });

  it("keeps paste enabled after switching execution context when clipboard exists", async () => {
    const user = userEvent.setup();
    const view = renderPage({ accountIdForApi: "acc-1" });

    await copyOrCutItem(user, "a.txt", "Copy");

    view.rerender(renderPageElement({ accountIdForApi: "acc-2" }));

    await findRowByLabel("a.txt");
    const menu = await openContextMoreMenu(user);
    expect(within(menu).getByRole("menuitem", { name: "Paste" })).toBeEnabled();
  });

  it("keeps same-context paste on the existing server-side copy path", async () => {
    const user = userEvent.setup();
    renderPage({ accountIdForApi: "acc-1" });

    await copyOrCutItem(user, "a.txt", "Copy");
    await user.dblClick(await findRowByLabel("docs"));
    await findRowByLabel("readme.txt");
    await pasteFromCurrentPath(user);

    await waitFor(() => {
      expect(copyObjectMock).toHaveBeenCalledWith(
        "acc-1",
        "bucket-1",
        {
          source_bucket: "bucket-1",
          source_key: "a.txt",
          destination_key: "docs/a.txt",
          move: false,
        },
        expect.any(AbortSignal),
        undefined,
      );
    });
    expect(presignObjectMock).not.toHaveBeenCalled();
  });

  it("copies across execution contexts through frontend-directed transfers", async () => {
    const user = userEvent.setup();
    const view = renderPage({ accountIdForApi: "acc-1" });

    fetchObjectMetadataMock.mockImplementation(
      async (selector: string, _bucket: string, key: string) => ({
        key,
        size: 10,
        metadata: {},
        content_type: selector === "acc-1" ? "text/plain" : "text/plain",
      }),
    );

    await copyOrCutItem(user, "a.txt", "Copy");

    view.rerender(renderPageElement({ accountIdForApi: "acc-2" }));

    await findRowByLabel("a.txt");
    await pasteFromCurrentPath(user);

    await waitFor(() => {
      expect(copyObjectMock).not.toHaveBeenCalled();
      expect(fetchObjectMetadataMock).toHaveBeenCalledWith(
        "acc-1",
        "bucket-1",
        "a.txt",
        null,
        null,
        expect.any(AbortSignal),
        undefined,
      );
      expect(presignObjectMock).toHaveBeenCalledWith(
        "acc-1",
        "bucket-1",
        expect.objectContaining({
          key: "a.txt",
          operation: "get_object",
        }),
        null,
        undefined,
      );
      expect(presignObjectMock).toHaveBeenCalledWith(
        "acc-2",
        "bucket-1",
        expect.objectContaining({
          key: "a.txt",
          operation: "put_object",
        }),
        null,
        undefined,
      );
    });
  });

  it("refreshes the current object listing after cross-context paste", async () => {
    const user = userEvent.setup();
    const view = renderPage({ accountIdForApi: "acc-1" });
    let destinationDocsUpdated = false;

    listBrowserObjectsMock.mockImplementation(
      (
        accountId: string,
        _bucketName: string,
        payload?: { prefix?: string },
      ) => {
        const prefix = payload?.prefix ?? "";
        if (prefix === "docs/") {
          const objects =
            accountId === "acc-2" && destinationDocsUpdated
              ? [
                  {
                    key: "docs/a.txt",
                    size: 10,
                    last_modified: "2026-03-10T10:18:00Z",
                    storage_class: "STANDARD",
                    etag: '"etag-docs-a"',
                  },
                  {
                    key: "docs/readme.txt",
                    size: 42,
                    last_modified: "2026-03-10T10:45:00Z",
                    storage_class: "STANDARD",
                    etag: '"etag-docs"',
                  },
                ]
              : [
                  {
                    key: "docs/readme.txt",
                    size: 42,
                    last_modified: "2026-03-10T10:45:00Z",
                    storage_class: "STANDARD",
                    etag: '"etag-docs"',
                  },
                ];
          return Promise.resolve({
            prefix: "docs/",
            objects,
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
              etag: '"etag-a"',
            },
            {
              key: "b.txt",
              size: 20,
              last_modified: "2026-03-10T10:16:00Z",
              storage_class: "STANDARD",
              etag: '"etag-b"',
            },
            {
              key: "c.txt",
              size: 30,
              last_modified: "2026-03-10T10:17:00Z",
              storage_class: "STANDARD",
              etag: '"etag-c"',
            },
          ],
          prefixes: ["docs/"],
          is_truncated: false,
          next_continuation_token: null,
        });
      },
    );

    presignObjectMock.mockImplementation(
      async (
        accountId: string,
        _bucketName: string,
        payload?: { key?: string; operation?: string },
      ) => {
        if (
          accountId === "acc-2" &&
          payload?.operation === "put_object" &&
          payload.key === "docs/a.txt"
        ) {
          destinationDocsUpdated = true;
        }
        return {
          url: `https://example.test/${payload?.key ?? "object"}`,
          method: payload?.operation === "get_object" ? "GET" : "PUT",
          expires_in: 1800,
          headers: {},
        };
      },
    );

    await copyOrCutItem(user, "a.txt", "Copy");

    view.rerender(renderPageElement({ accountIdForApi: "acc-2" }));

    await user.dblClick(await findRowByLabel("docs"));
    await findRowByLabel("readme.txt");
    await pasteFromCurrentPath(user);

    await waitFor(() => {
      expect(listBrowserObjectsMock).toHaveBeenCalledWith(
        "acc-2",
        "bucket-1",
        expect.objectContaining({ prefix: "docs/" }),
      );
      expect(screen.getByRole("button", { name: "Open file a.txt" })).toBeInTheDocument();
    });
  });

  it("shows Stop all for multi-item same-context paste and cancels queued copy tasks", async () => {
    const user = userEvent.setup();
    fetchBrowserSettingsMock.mockResolvedValue({
      allow_proxy_transfers: false,
      direct_upload_parallelism: 3,
      proxy_upload_parallelism: 2,
      direct_download_parallelism: 3,
      proxy_download_parallelism: 2,
      other_operations_parallelism: 1,
      streaming_zip_threshold_mb: 200,
    });
    copyObjectMock.mockImplementation(
      async (
        _accountId: string,
        _bucketName: string,
        payload: { destination_key: string },
        signal?: AbortSignal,
      ) =>
        new Promise<void>((resolve, reject) => {
          if (payload.destination_key !== "docs/a.txt") {
            resolve();
            return;
          }
          const abort = () => reject(new DOMException("Aborted", "AbortError"));
          if (signal?.aborted) {
            abort();
            return;
          }
          signal?.addEventListener("abort", abort, { once: true });
        }),
    );

    renderPage({ accountIdForApi: "acc-1", defaultShowInspector: true });

    await copyOrCutSelection(user, ["a.txt", "b.txt"], "Copy");
    await user.dblClick(await findRowByLabel("docs"));
    await findRowByLabel("readme.txt");
    await pasteFromCurrentPath(user);

    const dialog = await screen.findByRole("complementary", {
      name: "Operations",
    });
    expect(dialog).toHaveClass("fixed", "inset-x-3", "bottom-4");
    expect(
      within(dialog).getByRole("button", { name: "Expand operations" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Dismiss operations panel" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Stop all" }),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Active")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Queue")).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Show files" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Download details (JSON)" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Operations overview" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Clear completed/failed" }),
    ).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Expand operations" }));
    expect(
      within(dialog).getByRole("button", { name: "Operations overview" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Clear completed/failed" }),
    ).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Operations overview" }));
    let detailsDialog = await screen.findByRole("dialog", {
      name: "Operations overview",
    });
    expect(within(detailsDialog).getByText("Active")).toBeInTheDocument();
    expect(
      within(detailsDialog).getByRole("button", { name: "Show files" }),
    ).toBeInTheDocument();
    await user.click(within(detailsDialog).getByRole("button", { name: "Close modal" }));

    const stopAllButton = await within(dialog).findByRole("button", {
      name: "Stop all",
    });
    expect(stopAllButton).toBeInTheDocument();

    await user.click(stopAllButton);

    await waitFor(() => {
      expect(copyObjectMock).toHaveBeenCalledTimes(1);
      expect(
        screen.getByText("Copy cancelled after 0 of 2 item(s)."),
      ).toBeInTheDocument();
      expect(listBrowserObjectsMock).toHaveBeenCalledWith(
        "acc-1",
        "bucket-1",
        expect.objectContaining({ prefix: "docs/" }),
      );
    });

    expect(copyObjectMock.mock.calls[0]?.[3]).toBeInstanceOf(AbortSignal);
    expect((copyObjectMock.mock.calls[0]?.[3] as AbortSignal).aborted).toBe(
      true,
    );

    expect(
      await within(dialog).findByRole("button", { name: "Dismiss operations panel" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Show files" }),
    ).not.toBeInTheDocument();
    const overviewButton = within(dialog).getByRole("button", {
      name: "Operations overview",
    });
    const clearFinishedButton = within(dialog).getByRole("button", {
      name: "Clear completed/failed",
    });
    expect(overviewButton.parentElement).toBe(clearFinishedButton.parentElement);
    expect(
      Boolean(
        overviewButton.compareDocumentPosition(clearFinishedButton) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    await user.click(overviewButton);
    detailsDialog = await screen.findByRole("dialog", {
      name: "Operations overview",
    });
    await user.click(
      within(detailsDialog).getByRole("button", { name: "Show files" }),
    );
    await waitFor(() => {
      expect(
        within(detailsDialog).getAllByText(/Cancelled/).length,
      ).toBeGreaterThanOrEqual(2);
    });
    expect(
      within(detailsDialog).getByRole("button", {
        name: "Download details (JSON)",
      }),
    ).toBeInTheDocument();
    await user.click(
      within(detailsDialog).getByRole("button", { name: "Close modal" }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Dismiss operations panel" }),
    );
    await waitFor(() => {
      expect(
        screen.queryByRole("complementary", { name: "Operations" }),
      ).not.toBeInTheDocument();
    });

    const menu = await openContextMoreMenu(user);
    await user.click(
      within(menu).getByRole("menuitem", { name: "Operations overview" }),
    );
    detailsDialog = await screen.findByRole("dialog", {
      name: "Operations overview",
    });
    expect(
      within(detailsDialog).getByRole("button", {
        name: "Download details (JSON)",
      }),
    ).toBeInTheDocument();
  });

  it("keeps the operations panel expanded while queued uploads start", async () => {
    const user = userEvent.setup();
    fetchBrowserSettingsMock.mockResolvedValue({
      allow_proxy_transfers: true,
      direct_upload_parallelism: 3,
      proxy_upload_parallelism: 1,
      direct_download_parallelism: 3,
      proxy_download_parallelism: 2,
      other_operations_parallelism: 2,
      streaming_zip_threshold_mb: 200,
    });
    getBucketCorsStatusMock.mockResolvedValue({ enabled: false, rules: [] });
    const firstUpload = createDeferred<void>();
    const secondUpload = createDeferred<void>();
    let uploadCallCount = 0;
    proxyUploadMock.mockImplementation(() => {
      uploadCallCount += 1;
      if (uploadCallCount === 1) return firstUpload.promise;
      if (uploadCallCount === 2) return secondUpload.promise;
      return Promise.resolve();
    });

    renderPage({ accountIdForApi: "acc-1" });
    await findRowByLabel("a.txt");
    const menu = await openContextMoreMenu(user);
    expect(await within(menu).findByText("Proxy")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    const fileInput = document.querySelector(
      'input[type="file"]:not([directory])',
    ) as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput as HTMLInputElement, {
      target: {
        files: [
          new File(["first"], "first.txt", { type: "text/plain" }),
          new File(["second"], "second.txt", { type: "text/plain" }),
        ],
      },
    });

    await waitFor(() => expect(proxyUploadMock).toHaveBeenCalledTimes(1));
    const panel = await openOperationsPanel(user);
    expect(
      within(panel).getByRole("button", { name: "Collapse operations" }),
    ).toBeInTheDocument();

    await act(async () => {
      firstUpload.resolve();
    });
    await waitFor(() => expect(proxyUploadMock).toHaveBeenCalledTimes(2));

    expect(
      within(panel).getByRole("button", { name: "Collapse operations" }),
    ).toBeInTheDocument();
    expect(
      within(panel).queryByRole("button", { name: "Expand operations" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      secondUpload.resolve();
    });
  });

  it("uploads a small direct file with a presigned PUT", async () => {
    const file = new File(["small direct payload"], "small-direct.txt", {
      type: "text/plain",
    });
    renderPage({ accountIdForApi: "acc-1" });
    await findRowByLabel("a.txt");

    const fileInput = document.querySelector(
      'input[type="file"]:not([directory])',
    ) as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(presignObjectMock).toHaveBeenCalledWith(
        "acc-1",
        "bucket-1",
        {
          key: "small-direct.txt",
          operation: "put_object",
          content_type: "text/plain",
          expires_in: 1800,
        },
        null,
        undefined,
      );
      expect(fetchMock).toHaveBeenCalledWith(
        "https://example.test/small-direct.txt",
        expect.objectContaining({
          method: "PUT",
          headers: { "Content-Type": "text/plain" },
          credentials: "omit",
        }),
      );
    });
    expect(proxyUploadMock).not.toHaveBeenCalled();
  });

  it("cancels cross-context move batches without deleting pending sources and keeps paste available", async () => {
    const user = userEvent.setup();
    fetchBrowserSettingsMock.mockResolvedValue({
      allow_proxy_transfers: false,
      direct_upload_parallelism: 3,
      proxy_upload_parallelism: 2,
      direct_download_parallelism: 3,
      proxy_download_parallelism: 2,
      other_operations_parallelism: 1,
      streaming_zip_threshold_mb: 200,
    });
    presignObjectMock.mockImplementation(
      async (
        _accountId: string,
        _bucketName: string,
        payload?: { key?: string; operation?: string },
      ) => ({
        url: `https://example.test/${payload?.key ?? "object"}`,
        method: payload?.operation === "get_object" ? "GET" : "PUT",
        expires_in: 1800,
        headers: {},
      }),
    );
    fetchMock.mockImplementation(
      async (input?: RequestInfo | URL, init?: RequestInit) => {
        const method = (init?.method || "GET").toUpperCase();
        const url = String(input ?? "");
        if (method === "GET" && url.includes("/a.txt")) {
          return new Promise<Response>((resolve, reject) => {
            const abort = () =>
              reject(new DOMException("Aborted", "AbortError"));
            if (init?.signal?.aborted) {
              abort();
              return;
            }
            init?.signal?.addEventListener("abort", abort, { once: true });
          });
        }
        if (method === "PUT" || method === "POST" || method === "DELETE") {
          return new Response(null, { status: 200 });
        }
        return new Response("direct-bytes", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      },
    );

    const view = renderPage({
      accountIdForApi: "acc-1",
      defaultShowInspector: true,
    });

    await copyOrCutSelection(user, ["a.txt", "b.txt"], "Cut");

    view.rerender(
      renderPageElement({ accountIdForApi: "acc-2", defaultShowInspector: true }),
    );

    await user.dblClick(await findRowByLabel("docs"));
    await findRowByLabel("readme.txt");
    await pasteFromCurrentPath(user);

    const dialog = await openOperationsPanel(user);
    await user.click(
      await within(dialog).findByRole("button", { name: "Stop all" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText("Move cancelled after 0 of 2 item(s)."),
      ).toBeInTheDocument();
      expect(deleteObjectsMock).not.toHaveBeenCalled();
      expect(listBrowserObjectsMock).toHaveBeenCalledWith(
        "acc-2",
        "bucket-1",
        expect.objectContaining({ prefix: "docs/" }),
      );
    });

    await user.click(within(dialog).getByRole("button", { name: "Operations overview" }));
    const detailsDialog = await screen.findByRole("dialog", {
      name: "Operations overview",
    });
    await waitFor(() => {
      expect(within(detailsDialog).getAllByText(/Cancelled/).length).toBeGreaterThanOrEqual(1);
    });
    await user.click(within(detailsDialog).getByRole("button", { name: "Close modal" }));

    await user.click(within(dialog).getByRole("button", { name: "Collapse operations" }));
    expect(
      within(dialog).getByRole("button", { name: "Expand operations" }),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Expand operations" }),
    );
    expect(
      within(dialog).getByRole("button", { name: "Collapse operations" }),
    ).toBeInTheDocument();
    const menu = await openContextMoreMenu(user);
    expect(within(menu).getByRole("menuitem", { name: /^Paste/ })).toBeEnabled();
  });

  it("verifies the destination before deleting the source on cross-context move", async () => {
    const user = userEvent.setup();
    const view = renderPage({ accountIdForApi: "acc-1" });
    const callOrder: string[] = [];

    fetchObjectMetadataMock.mockImplementation(
      async (selector: string, _bucket: string, key: string) => {
        callOrder.push(selector === "acc-1" ? "source-meta" : "dest-meta");
        return {
          key,
          size: 10,
          metadata: {},
          content_type: "text/plain",
        };
      },
    );
    presignObjectMock.mockImplementation(
      async (
        selector: string,
        _bucket: string,
        payload?: { operation?: string },
      ) => {
        callOrder.push(`${selector}:${payload?.operation}`);
        return {
          url: `https://example.test/${selector}/${payload?.operation ?? "put_object"}`,
          method: payload?.operation === "get_object" ? "GET" : "PUT",
          expires_in: 1800,
          headers: {},
        };
      },
    );
    deleteObjectsMock.mockImplementation(async (selector: string) => {
      callOrder.push(`delete:${selector}`);
      return 1;
    });

    await copyOrCutItem(user, "a.txt", "Cut");

    view.rerender(renderPageElement({ accountIdForApi: "acc-2" }));

    await findRowByLabel("a.txt");
    await pasteFromCurrentPath(user);

    await waitFor(() => {
      expect(deleteObjectsMock).toHaveBeenCalledWith(
        "acc-1",
        "bucket-1",
        [{ key: "a.txt" }],
        undefined,
        undefined,
      );
    });
    expect(callOrder.indexOf("dest-meta")).toBeGreaterThan(
      callOrder.indexOf("acc-2:put_object"),
    );
    expect(callOrder.indexOf("delete:acc-1")).toBeGreaterThan(
      callOrder.indexOf("dest-meta"),
    );
  });

  it("keeps the source when cross-context move verification fails", async () => {
    const user = userEvent.setup();
    const view = renderPage({ accountIdForApi: "acc-1" });

    fetchObjectMetadataMock.mockImplementation(
      async (selector: string, _bucket: string, key: string) => ({
        key,
        size: selector === "acc-1" ? 10 : 11,
        metadata: {},
        content_type: "text/plain",
      }),
    );

    await copyOrCutItem(user, "a.txt", "Cut");

    view.rerender(renderPageElement({ accountIdForApi: "acc-2" }));

    await findRowByLabel("a.txt");
    await pasteFromCurrentPath(user);

    await waitFor(() => {
      expect(fetchObjectMetadataMock).toHaveBeenCalledTimes(2);
    });
    expect(deleteObjectsMock).not.toHaveBeenCalled();

    const menu = await openContextMoreMenu(user);
    expect(
      within(menu).getByRole("menuitem", { name: /^Paste/ }),
    ).toBeEnabled();
  });

  it("lists folder contents from the source context and recreates the destination folder", async () => {
    const user = userEvent.setup();
    const view = renderPage({ accountIdForApi: "acc-1" });

    fetchObjectMetadataMock.mockImplementation(
      async (_selector: string, _bucket: string, key: string) => ({
        key,
        size: 42,
        metadata: {},
        content_type: "text/plain",
      }),
    );

    await copyOrCutItem(user, "docs", "Copy");

    view.rerender(renderPageElement({ accountIdForApi: "acc-2" }));

    await findRowByLabel("a.txt");
    await pasteFromCurrentPath(user);

    await waitFor(() => {
      expect(createFolderMock).toHaveBeenCalledWith(
        "acc-2",
        "bucket-1",
        "docs/",
      );
      expect(listBrowserObjectsMock).toHaveBeenCalledWith(
        "acc-1",
        "bucket-1",
        expect.objectContaining({
          prefix: "docs/",
          recursive: true,
          type: "file",
        }),
      );
      expect(presignObjectMock).toHaveBeenCalledWith(
        "acc-1",
        "bucket-1",
        expect.objectContaining({
          key: "docs/readme.txt",
          operation: "get_object",
        }),
        null,
        undefined,
      );
    });
  });

  it("falls back to proxy transfers for cross-context paste when direct access is unavailable", async () => {
    const user = userEvent.setup();
    fetchBrowserSettingsMock.mockResolvedValue({
      allow_proxy_transfers: true,
      direct_upload_parallelism: 3,
      proxy_upload_parallelism: 2,
      direct_download_parallelism: 3,
      proxy_download_parallelism: 2,
      other_operations_parallelism: 2,
      streaming_zip_threshold_mb: 200,
    });
    getBucketCorsStatusMock.mockResolvedValue({ enabled: false, rules: [] });
    const view = renderPage({ accountIdForApi: "acc-1" });

    await copyOrCutItem(user, "a.txt", "Copy");

    view.rerender(renderPageElement({ accountIdForApi: "acc-2" }));

    await findRowByLabel("a.txt");
    await pasteFromCurrentPath(user);

    await waitFor(() => {
      expect(proxyDownloadMock).toHaveBeenCalledWith(
        "acc-1",
        "bucket-1",
        "a.txt",
        expect.any(AbortSignal),
        null,
        undefined,
      );
      expect(proxyUploadMock).toHaveBeenCalledWith(
        "acc-2",
        "bucket-1",
        "a.txt",
        expect.any(Blob),
        undefined,
        expect.any(AbortSignal),
        null,
        "a.txt",
        undefined,
      );
    });
    expect(copyObjectMock).not.toHaveBeenCalled();
  });

  it("shows Stop all for multi-object delete and marks remaining items as cancelled", async () => {
    const user = userEvent.setup();
    seedBrowserRootUiState({
      layout: { showFolders: false, showInspector: false, showActionBar: true },
      contextSelections: {},
    });
    fetchBrowserSettingsMock.mockResolvedValue({
      allow_proxy_transfers: false,
      direct_upload_parallelism: 3,
      proxy_upload_parallelism: 2,
      direct_download_parallelism: 3,
      proxy_download_parallelism: 2,
      other_operations_parallelism: 1,
      streaming_zip_threshold_mb: 200,
    });
    deleteObjectsMock.mockImplementation(
      async (
        _selector: string,
        _bucket: string,
        _objects: Array<{ key: string }>,
        signal?: AbortSignal,
      ) => createAbortablePromise(signal),
    );

    renderPage();
    await findRowByLabel("a.txt");
    await user.click(screen.getByRole("checkbox", { name: "Select a.txt" }));
    await user.click(screen.getByRole("checkbox", { name: "Select b.txt" }));

    await user.click(
      within(getActionsToolbar()).getByRole("button", { name: "Delete" }),
    );
    const confirm = await screen.findByRole("dialog", {
      name: "Delete objects",
    });
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    const dialog = await openOperationsPanel(user);
    await user.click(
      await within(dialog).findByRole("button", { name: "Stop all" }),
    );

    await waitFor(() => {
      expect(deleteObjectsMock).toHaveBeenCalledTimes(1);
      expect(
        screen.getByText("Delete cancelled after 0 of 2 item(s)."),
      ).toBeInTheDocument();
    });
    expect(deleteObjectsMock.mock.calls[0]?.[3]).toBeInstanceOf(AbortSignal);
    expect((deleteObjectsMock.mock.calls[0]?.[3] as AbortSignal).aborted).toBe(
      true,
    );

    await user.click(within(dialog).getByRole("button", { name: "Operations overview" }));
    const detailsDialog = await screen.findByRole("dialog", {
      name: "Operations overview",
    });
    await waitFor(() => {
      expect(within(detailsDialog).getAllByText(/Cancelled/).length).toBeGreaterThanOrEqual(1);
    });
    await user.click(within(detailsDialog).getByRole("button", { name: "Close modal" }));
  });

  it("supports Stop for bulk attributes and leaves queued items cancelled", async () => {
    const user = userEvent.setup();
    fetchBrowserSettingsMock.mockResolvedValue({
      allow_proxy_transfers: false,
      direct_upload_parallelism: 3,
      proxy_upload_parallelism: 2,
      direct_download_parallelism: 3,
      proxy_download_parallelism: 2,
      other_operations_parallelism: 1,
      streaming_zip_threshold_mb: 200,
    });
    updateObjectMetadataMock.mockImplementation(
      async (
        _selector: string,
        _bucket: string,
        _payload: unknown,
        signal?: AbortSignal,
      ) => createAbortablePromise(signal),
    );

    renderPage();
    await enableActionBar(user);
    await user.click(screen.getByRole("checkbox", { name: "Select a.txt" }));
    await user.click(screen.getByRole("checkbox", { name: "Select b.txt" }));
    const menu = await openActionsMoreMenu(user);
    const bulkAttributesAction = within(menu).getByRole("menuitem", {
      name: "Bulk attributes",
    });
    await waitFor(() => {
      expect(bulkAttributesAction).toBeEnabled();
    });
    await user.click(bulkAttributesAction);

    const modal = await screen.findByRole("dialog", { name: "Bulk attributes" });
    await user.click(
      within(modal).getByRole("checkbox", { name: "Metadata headers" }),
    );
    await user.type(within(modal).getByPlaceholderText("Content-Type"), "text/plain");
    await user.click(within(modal).getByRole("button", { name: "Apply changes" }));

    const dialog = await openOperationsPanel(user);
    await user.click(await within(dialog).findByRole("button", { name: "Stop" }));

    await waitFor(() => {
      expect(updateObjectMetadataMock).toHaveBeenCalledTimes(1);
    });
    expect(updateObjectMetadataMock.mock.calls[0]?.[3]).toBeInstanceOf(
      AbortSignal,
    );
    expect(
      (updateObjectMetadataMock.mock.calls[0]?.[3] as AbortSignal).aborted,
    ).toBe(true);

    await user.click(within(dialog).getByRole("button", { name: "Operations overview" }));
    const detailsDialog = await screen.findByRole("dialog", {
      name: "Operations overview",
    });
    await waitFor(() => {
      expect(within(detailsDialog).getAllByText(/Cancelled/).length).toBeGreaterThanOrEqual(1);
    });
  });

  it("supports Stop for restore-to-date batches", async () => {
    const user = userEvent.setup();
    seedBrowserRootUiState({
      layout: { showFolders: false, showInspector: false, showActionBar: true },
      contextSelections: {},
    });
    getBucketVersioningMock.mockResolvedValue({
      enabled: true,
      status: "Enabled",
    });
    fetchBrowserSettingsMock.mockResolvedValue({
      allow_proxy_transfers: false,
      direct_upload_parallelism: 3,
      proxy_upload_parallelism: 2,
      direct_download_parallelism: 3,
      proxy_download_parallelism: 2,
      other_operations_parallelism: 1,
      streaming_zip_threshold_mb: 200,
    });
    listObjectVersionsMock.mockImplementation(
      async (
        _selector: string,
        _bucket: string,
        options?: { key?: string | null },
      ) => ({
        versions: [
          {
            key: options?.key ?? "a.txt",
            version_id: "v2",
            is_latest: true,
            is_delete_marker: false,
            last_modified: "2026-03-10T10:00:00Z",
            size: 10,
          },
          {
            key: options?.key ?? "a.txt",
            version_id: "v1",
            is_latest: false,
            is_delete_marker: false,
            last_modified: "2026-03-01T10:00:00Z",
            size: 10,
          },
        ],
        delete_markers: [],
        is_truncated: false,
        next_key_marker: null,
        next_version_id_marker: null,
      }),
    );
    copyObjectMock.mockImplementation(
      async (
        _selector: string,
        _bucket: string,
        _payload: unknown,
        signal?: AbortSignal,
      ) => createAbortablePromise(signal),
    );

    renderPage();
    await findRowByLabel("a.txt");
    await user.click(screen.getByRole("checkbox", { name: "Select a.txt" }));
    await user.click(screen.getByRole("checkbox", { name: "Select b.txt" }));
    const menu = await openActionsMoreMenu(user);
    const restoreToDateAction = within(menu).getByRole("menuitem", {
      name: "Restore to date",
    });
    await waitFor(() => {
      expect(restoreToDateAction).toBeEnabled();
    });
    fireEvent.click(restoreToDateAction);

    const modal = await screen.findByRole(
      "dialog",
      { name: "Restore to date" },
      { timeout: 5_000 },
    );
    const dateInput = modal.querySelector(
      'input[type="datetime-local"]',
    ) as HTMLInputElement | null;
    expect(dateInput).not.toBeNull();
    fireEvent.change(dateInput as HTMLInputElement, {
      target: { value: "2026-03-05T12:00" },
    });
    await user.click(within(modal).getByRole("button", { name: "Run restore" }));

    const dialog = await openOperationsPanel(user);
    await user.click(await within(dialog).findByRole("button", { name: "Stop" }));

    await waitFor(() => {
      expect(copyObjectMock).toHaveBeenCalledTimes(1);
    });
    expect(copyObjectMock.mock.calls[0]?.[3]).toBeInstanceOf(AbortSignal);
    expect((copyObjectMock.mock.calls[0]?.[3] as AbortSignal).aborted).toBe(
      true,
    );
  }, 15_000);

  it("supports Stop for cleaning old versions", async () => {
    const user = userEvent.setup();
    getBucketVersioningMock.mockResolvedValue({
      enabled: true,
      status: "Enabled",
    });
    cleanupObjectVersionsMock.mockImplementation(
      async (
        _selector: string,
        _bucket: string,
        _payload: unknown,
        signal?: AbortSignal,
      ) => createAbortablePromise(signal),
    );

    renderPage({ defaultShowInspector: true });
    await waitFor(() => {
      expect(getBucketVersioningMock).toHaveBeenCalledTimes(1);
    });
    const menu = await openContextMoreMenu(user);
    const cleanOldVersionsAction = within(menu).getByRole("menuitem", {
      name: "Clean old versions",
    });
    await waitFor(() => {
      expect(cleanOldVersionsAction).toBeEnabled();
    });
    fireEvent.click(cleanOldVersionsAction);

    const modal = await screen.findByRole("dialog", { name: "Clean old versions" });
    await user.type(within(modal).getByPlaceholderText("e.g. 3"), "1");
    await user.click(within(modal).getByRole("button", { name: "Run cleanup" }));

    const dialog = await openOperationsPanel(user);
    await user.click(await within(dialog).findByRole("button", { name: "Stop" }));

    await waitFor(() => {
      expect(cleanupObjectVersionsMock).toHaveBeenCalledTimes(1);
      expect(screen.getAllByText("Cleanup cancelled.").length).toBeGreaterThan(
        0,
      );
    });
    expect(cleanupObjectVersionsMock.mock.calls[0]?.[3]).toBeInstanceOf(
      AbortSignal,
    );
    expect(
      (cleanupObjectVersionsMock.mock.calls[0]?.[3] as AbortSignal).aborted,
    ).toBe(true);
  });

  it("supports Stop for restore version and delete version operations", async () => {
    const user = userEvent.setup();
    getBucketVersioningMock.mockResolvedValue({
      enabled: true,
      status: "Enabled",
    });
    listObjectVersionsMock.mockResolvedValue({
      versions: [
        {
          key: "a.txt",
          version_id: "v1",
          is_latest: false,
          is_delete_marker: false,
          last_modified: "2026-03-01T10:00:00Z",
          size: 10,
        },
      ],
      delete_markers: [],
      is_truncated: false,
      next_key_marker: null,
      next_version_id_marker: null,
    });
    copyObjectMock.mockImplementation(
      async (
        _selector: string,
        _bucket: string,
        _payload: unknown,
        signal?: AbortSignal,
      ) => createAbortablePromise(signal),
    );
    deleteObjectsMock.mockImplementation(
      async (
        _selector: string,
        _bucket: string,
        _objects: Array<{ key: string; version_id?: string }>,
        signal?: AbortSignal,
      ) => createAbortablePromise(signal),
    );

    renderPage({ defaultShowInspector: true });
    await user.click(await findRowByLabel("a.txt"));
    await user.click(screen.getByRole("tab", { name: "Details" }));
    await user.click(
      within(screen.getByRole("tabpanel", { name: "Details" })).getByRole(
        "button",
        { name: "Open full details" },
      ),
    );

    const detailsDialog = await screen.findByRole("dialog", {
      name: "Object details · a.txt",
    });
    await user.click(within(detailsDialog).getByRole("tab", { name: "Versions" }));
    await within(detailsDialog).findByRole("button", { name: "Restore" });

    await user.click(within(detailsDialog).getByRole("button", { name: "Restore" }));
    let dialog = await openOperationsPanel(user);
    await user.click(await within(dialog).findByRole("button", { name: "Stop" }));

    await waitFor(() => {
      expect(screen.getByText("Restore version cancelled.")).toBeInTheDocument();
    });
    expect(copyObjectMock.mock.calls[0]?.[3]).toBeInstanceOf(AbortSignal);
    expect((copyObjectMock.mock.calls[0]?.[3] as AbortSignal).aborted).toBe(
      true,
    );

    await user.click(within(dialog).getByRole("button", { name: "Collapse operations" }));

    await user.click(
      within(detailsDialog).getByRole("button", { name: "Delete version" }),
    );
    const confirm = await screen.findByRole("dialog", { name: "Delete version" });
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    dialog = await openOperationsPanel(user);
    await user.click(await within(dialog).findByRole("button", { name: "Stop" }));

    await waitFor(() => {
      expect(screen.getByText("Delete version cancelled.")).toBeInTheDocument();
    });
    expect(deleteObjectsMock.mock.calls[0]?.[3]).toBeInstanceOf(AbortSignal);
    expect((deleteObjectsMock.mock.calls[0]?.[3] as AbortSignal).aborted).toBe(
      true,
    );
  });

  it("orders operation cards by descending add order across different operation types", async () => {
    const user = userEvent.setup();
    renderPage();

    await enableActionBar(user);
    await user.click(screen.getByRole("checkbox", { name: "Select b.txt" }));
    await user.click(
      within(getActionsToolbar()).getByRole("button", { name: "Delete" }),
    );
    const confirm = await screen.findByRole("dialog", {
      name: "Delete objects",
    });
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.getByText("Deleted 2 object(s)")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("checkbox", { name: "Select a.txt" }));
    await user.click(screen.getByRole("checkbox", { name: "Select b.txt" }));
    await user.click(
      within(getActionsToolbar()).getByRole("button", { name: "Copy" }),
    );
    await user.dblClick(await findRowByLabel("docs"));
    await findRowByLabel("readme.txt");
    await pasteFromCurrentPath(user);

    await waitFor(() => {
      expect(screen.getByText("Copied 2 of 2 item(s).")).toBeInTheDocument();
    });

    const dialog = await openOperationsPanel(user);
    const copyCardTitle = within(dialog).getByText("Copying items");
    const deleteCardTitle = within(dialog).getByText("Deleting 2 objects");

    expect(
      Boolean(
        copyCardTitle.compareDocumentPosition(deleteCardTitle) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);

    await user.click(
      within(dialog).getByRole("button", { name: "Clear completed/failed" }),
    );
    await waitFor(() => {
      expect(
        screen.queryByRole("complementary", { name: "Operations" }),
      ).not.toBeInTheDocument();
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
    const infoButton = within(warningLine as HTMLElement).getByRole("button", {
      name: "CORS actions",
    });
    expect(infoButton).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: `Add ${window.location.origin} to CORS`,
      }),
    ).not.toBeInTheDocument();

    await user.click(infoButton);

    expect(
      await screen.findByText(
        `Allow direct access from ${window.location.origin} by adding CORS rules to this bucket.`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: `Add ${window.location.origin} to CORS`,
      }),
    ).toBeInTheDocument();
  });

  it("applies CORS from popover and closes popover on Escape/outside click", async () => {
    const user = userEvent.setup();
    getBucketCorsStatusMock.mockResolvedValue({ enabled: false, rules: [] });
    ensureBucketCorsMock.mockResolvedValue({ enabled: true, rules: [] });
    renderPage();

    const warningLine = (
      await screen.findByText(
        "Direct download/upload is not allowed on this bucket.",
      )
    ).closest("p");
    if (!warningLine) {
      throw new Error("CORS warning line not found");
    }
    await user.click(
      within(warningLine).getByRole("button", { name: "CORS actions" }),
    );
    expect(
      screen.getByRole("button", {
        name: `Add ${window.location.origin} to CORS`,
      }),
    ).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => {
      expect(
        screen.queryByRole("button", {
          name: `Add ${window.location.origin} to CORS`,
        }),
      ).not.toBeInTheDocument();
    });

    await user.click(
      within(warningLine).getByRole("button", { name: "CORS actions" }),
    );
    expect(
      screen.getByRole("button", {
        name: `Add ${window.location.origin} to CORS`,
      }),
    ).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    await waitFor(() => {
      expect(
        screen.queryByRole("button", {
          name: `Add ${window.location.origin} to CORS`,
        }),
      ).not.toBeInTheDocument();
    });

    await user.click(
      within(warningLine).getByRole("button", { name: "CORS actions" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: `Add ${window.location.origin} to CORS`,
      }),
    );

    await waitFor(() => {
      expect(ensureBucketCorsMock).toHaveBeenCalledWith(
        "acc-1",
        "bucket-1",
        window.location.origin,
        undefined,
      );
    });
    expect(
      await screen.findByText("CORS rules updated for this bucket."),
    ).toBeInTheDocument();
  });
});
