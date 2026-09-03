import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BrowserPage from "./BrowserPage";

const searchBrowserBucketsMock = vi.fn();
const fetchBrowserSettingsMock = vi.fn();
const listBrowserObjectsMock = vi.fn();
const getBrowserBucketVersioningMock = vi.fn();
const getBrowserBucketCorsStatusMock = vi.fn();
const listMultipartUploadsMock = vi.fn();
const abortMultipartUploadMock = vi.fn();

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
    listBrowserObjects: (...args: unknown[]) => listBrowserObjectsMock(...args),
  };
});

vi.mock("../../api/browserBuckets", async () => {
  const actual = await vi.importActual<typeof import("../../api/browserBuckets")>(
    "../../api/browserBuckets",
  );
  return {
    ...actual,
    searchBrowserBuckets: (...args: unknown[]) => searchBrowserBucketsMock(...args),
    fetchBrowserSettings: (...args: unknown[]) => fetchBrowserSettingsMock(...args),
    getBrowserBucketVersioning: (...args: unknown[]) =>
      getBrowserBucketVersioningMock(...args),
    getBrowserBucketCorsStatus: (...args: unknown[]) =>
      getBrowserBucketCorsStatusMock(...args),
  };
});

vi.mock("../../api/browserMultipart", () => ({
  listMultipartUploads: (...args: unknown[]) =>
    listMultipartUploadsMock(...args),
  abortMultipartUpload: (...args: unknown[]) =>
    abortMultipartUploadMock(...args),
}));

vi.mock("../../api/bucketDetails", async () => {
  const actual = await vi.importActual<typeof import("../../api/bucketDetails")>(
    "../../api/bucketDetails",
  );
  return {
    ...actual,
    browserBucketDetails: {
      ...actual.browserBucketDetails,
      getBucketStats: (...args: unknown[]) => getBucketStatsMock(...args),
      getBucketProperties: (...args: unknown[]) =>
        getBucketPropertiesMock(...args),
      getBucketPolicy: (...args: unknown[]) => getBucketPolicyMock(...args),
      getBucketLogging: (...args: unknown[]) => getBucketLoggingMock(...args),
      getBucketWebsite: (...args: unknown[]) => getBucketWebsiteMock(...args),
    },
  };
});

function renderPage({ defaultShowInspector = true }: { defaultShowInspector?: boolean } = {}) {
  return render(
    <MemoryRouter initialEntries={["/browser"]}>
      <BrowserPage defaultShowInspector={defaultShowInspector} />
    </MemoryRouter>
  );
}

describe("BrowserPage multipart uploads modal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();

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

    listBrowserObjectsMock.mockResolvedValue({
      prefix: "",
      objects: [],
      prefixes: [],
      is_truncated: false,
      next_continuation_token: null,
    });

    getBrowserBucketVersioningMock.mockResolvedValue({ enabled: false, status: "Disabled" });
    getBrowserBucketCorsStatusMock.mockResolvedValue({ enabled: true, rules: [] });

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

    listMultipartUploadsMock.mockResolvedValue({
      uploads: [
        {
          key: "uploads/big-file.bin",
          upload_id: "upload-123",
          initiated: "2026-03-10T11:12:13Z",
          storage_class: "STANDARD",
          owner: "alice",
        },
      ],
      is_truncated: false,
      next_key: null,
      next_upload_id: null,
    });
    abortMultipartUploadMock.mockResolvedValue(undefined);
  });

  it("opens bucket multipart modal and aborts a specific upload after confirmation", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("No objects found for this path.");
    const contextToolbar = await screen.findByRole("toolbar", {
      name: "Browser context bar",
    });
    await user.click(
      within(contextToolbar).getByRole("button", { name: "More" }),
    );
    const menu = await screen.findByRole("menu");
    await user.click(
      within(menu).getByRole("menuitem", { name: "Multipart uploads" }),
    );

    expect(await screen.findByRole("dialog", { name: "Multipart uploads · bucket-1" })).toBeInTheDocument();

    await waitFor(() => {
      expect(listMultipartUploadsMock).toHaveBeenCalledWith("acc-1", "bucket-1", { maxUploads: 50 });
    });

    expect(await screen.findByText("uploads/big-file.bin")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Abort" }));

    const confirmDialog = await screen.findByRole("dialog", { name: "Abort multipart upload" });
    await user.click(within(confirmDialog).getByRole("button", { name: "Abort" }));

    await waitFor(() => {
      expect(abortMultipartUploadMock).toHaveBeenCalledWith("acc-1", "bucket-1", "upload-123", "uploads/big-file.bin", undefined);
    });

    await waitFor(() => {
      expect(screen.queryByText("uploads/big-file.bin")).not.toBeInTheDocument();
    });

    expect(await screen.findByText("Multipart upload aborted for uploads/big-file.bin.")).toBeInTheDocument();
  });

  it("opens the row More menu without restoring an inspector action toolbar", async () => {
    const user = userEvent.setup();

    listBrowserObjectsMock.mockResolvedValue({
      prefix: "",
      objects: [
        {
          key: "reports/monthly.csv",
          size: 512,
          last_modified: "2026-03-10T10:15:00Z",
          storage_class: "STANDARD",
        },
      ],
      prefixes: [],
      is_truncated: false,
      next_continuation_token: null,
    });

    renderPage({ defaultShowInspector: false });

    expect(screen.queryByRole("tablist", { name: "Inspector tabs" })).not.toBeInTheDocument();

    const fileName = await screen.findByText(/monthly\.csv/);
    const row = fileName.closest("[data-browser-item]");
    expect(row).not.toBeNull();
    const moreButton = within(row as HTMLElement).getByRole("button", {
      name: /More actions/,
    });
    await user.click(moreButton);
    const menu = await screen.findByRole("menu");

    const menuButtons = within(menu)
      .getAllByRole("button")
      .map((button) => button.textContent?.trim());

    expect(within(menu).getByRole("button", { name: "Preview" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Properties" })).toBeInTheDocument();
    expect(menuButtons.slice(0, 2)).toEqual(["Preview", "Properties"]);
    expect(menuButtons).not.toContain("Details");
    expect(menuButtons).not.toContain("Advanced");
    expect(screen.queryByRole("tablist", { name: "Inspector tabs" })).not.toBeInTheDocument();

    await user.click(within(menu).getByRole("button", { name: "Properties" }));

    expect(
      await screen.findByRole("dialog", {
        name: /Object details · .*monthly\.csv/i,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Inspector tabs" })).not.toBeInTheDocument();
  });
});
