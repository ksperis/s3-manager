import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BrowserPage from "./BrowserPage";

const searchBrowserBucketsMock = vi.fn();
const fetchBrowserSettingsMock = vi.fn();
const listBrowserObjectsMock = vi.fn();
const getBucketVersioningMock = vi.fn();
const getBucketCorsStatusMock = vi.fn();
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
    accessMode: null,
    setAccessMode: () => {},
    canSwitchAccess: false,
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
    listMultipartUploads: (...args: unknown[]) => listMultipartUploadsMock(...args),
    abortMultipartUpload: (...args: unknown[]) => abortMultipartUploadMock(...args),
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/browser"]}>
      <BrowserPage defaultShowInspector />
    </MemoryRouter>
  );
}

describe("BrowserPage multipart uploads modal", () => {
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

    listBrowserObjectsMock.mockResolvedValue({
      prefix: "",
      objects: [],
      prefixes: [],
      is_truncated: false,
      next_continuation_token: null,
    });

    getBucketVersioningMock.mockResolvedValue({ enabled: false, status: "Disabled" });
    getBucketCorsStatusMock.mockResolvedValue({ enabled: true, rules: [] });

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

    const bucketTab = await screen.findByRole("tab", { name: "Bucket" });
    await user.click(bucketTab);

    const openButton = await screen.findByRole("button", { name: "Multipart uploads" });
    await user.click(openButton);

    expect(await screen.findByRole("dialog", { name: "Multipart uploads · bucket-1" })).toBeInTheDocument();

    await waitFor(() => {
      expect(listMultipartUploadsMock).toHaveBeenCalledWith("acc-1", "bucket-1", { maxUploads: 50 });
    });

    expect(await screen.findByText("uploads/big-file.bin")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Abort" }));

    const confirmDialog = await screen.findByRole("dialog", { name: "Abort multipart upload" });
    await user.click(within(confirmDialog).getByRole("button", { name: "Abort" }));

    await waitFor(() => {
      expect(abortMultipartUploadMock).toHaveBeenCalledWith("acc-1", "bucket-1", "upload-123", "uploads/big-file.bin");
    });

    await waitFor(() => {
      expect(screen.queryByText("uploads/big-file.bin")).not.toBeInTheDocument();
    });

    expect(await screen.findByText("Multipart upload aborted for uploads/big-file.bin.")).toBeInTheDocument();
  });
});
