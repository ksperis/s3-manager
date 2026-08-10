import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listCephAdminBuckets: vi.fn(),
  streamCephAdminBuckets: vi.fn(),
  listStorageOpsBuckets: vi.fn(),
  streamStorageOpsBuckets: vi.fn(),
  refreshCephAdminBucketListingCache: vi.fn(),
  refreshStorageOpsBucketListingCache: vi.fn(),
  listExecutionContexts: vi.fn(),
  noopAsync: vi.fn(async () => ({})),
  navigate: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useLocation: () => ({ pathname: "/storage-ops/buckets", search: "" }),
    useNavigate: () => mocks.navigate,
  };
});

vi.mock("../../api/cephAdmin", () => ({
  backupCephAdminBucketConfigs: mocks.noopAsync,
  deleteCephAdminBucketLogging: mocks.noopAsync,
  deleteCephAdminBucketCors: mocks.noopAsync,
  deleteCephAdminBucketLifecycle: mocks.noopAsync,
  deleteCephAdminBucketNotifications: mocks.noopAsync,
  deleteCephAdminBucketPolicy: mocks.noopAsync,
  getCephAdminBucketCors: mocks.noopAsync,
  getCephAdminBucketEncryption: mocks.noopAsync,
  getCephAdminBucketLifecycle: mocks.noopAsync,
  getCephAdminBucketLogging: mocks.noopAsync,
  getCephAdminBucketNotifications: mocks.noopAsync,
  getCephAdminBucketPolicy: mocks.noopAsync,
  getCephAdminBucketProperties: mocks.noopAsync,
  getCephAdminBucketPublicAccessBlock: mocks.noopAsync,
  getCephAdminBucketWebsite: mocks.noopAsync,
  listCephAdminBuckets: mocks.listCephAdminBuckets,
  putCephAdminBucketLogging: mocks.noopAsync,
  putCephAdminBucketCors: mocks.noopAsync,
  putCephAdminBucketLifecycle: mocks.noopAsync,
  putCephAdminBucketNotifications: mocks.noopAsync,
  putCephAdminBucketPolicy: mocks.noopAsync,
  refreshCephAdminBucketListingCache: mocks.refreshCephAdminBucketListingCache,
  setCephAdminBucketVersioning: mocks.noopAsync,
  streamCephAdminBuckets: mocks.streamCephAdminBuckets,
  updateCephAdminBucketObjectLock: mocks.noopAsync,
  updateCephAdminBucketPublicAccessBlock: mocks.noopAsync,
  updateCephAdminBucketQuota: mocks.noopAsync,
}));

vi.mock("../../api/storageOps", () => ({
  STORAGE_OPS_SCOPE_ID: 1,
  decodeStorageOpsBucketRef: vi.fn(),
  deleteStorageOpsBucketCors: mocks.noopAsync,
  deleteStorageOpsBucketLifecycle: mocks.noopAsync,
  deleteStorageOpsBucketLogging: mocks.noopAsync,
  deleteStorageOpsBucketNotifications: mocks.noopAsync,
  deleteStorageOpsBucketPolicy: mocks.noopAsync,
  getStorageOpsBucketCors: mocks.noopAsync,
  getStorageOpsBucketEncryption: mocks.noopAsync,
  getStorageOpsBucketLifecycle: mocks.noopAsync,
  getStorageOpsBucketLogging: mocks.noopAsync,
  getStorageOpsBucketNotifications: mocks.noopAsync,
  getStorageOpsBucketPolicy: mocks.noopAsync,
  getStorageOpsBucketProperties: mocks.noopAsync,
  getStorageOpsBucketPublicAccessBlock: mocks.noopAsync,
  getStorageOpsBucketWebsite: mocks.noopAsync,
  listStorageOpsBuckets: mocks.listStorageOpsBuckets,
  putStorageOpsBucketCors: mocks.noopAsync,
  putStorageOpsBucketLifecycle: mocks.noopAsync,
  putStorageOpsBucketLogging: mocks.noopAsync,
  putStorageOpsBucketNotifications: mocks.noopAsync,
  putStorageOpsBucketPolicy: mocks.noopAsync,
  refreshStorageOpsBucketListingCache: mocks.refreshStorageOpsBucketListingCache,
  setStorageOpsBucketVersioning: mocks.noopAsync,
  streamStorageOpsBuckets: mocks.streamStorageOpsBuckets,
  updateStorageOpsBucketObjectLock: mocks.noopAsync,
  updateStorageOpsBucketPublicAccessBlock: mocks.noopAsync,
}));

vi.mock("../../api/executionContexts", () => ({
  listExecutionContexts: mocks.listExecutionContexts,
}));

vi.mock("../cephAdmin/CephAdminEndpointContext", () => ({
  useCephAdminEndpoint: () => ({
    selectedEndpointId: 7,
    selectedEndpoint: {
      id: 7,
      name: "Archive",
      capabilities: { metrics: true, static_website: true, sse: true },
      tags: [],
    },
    endpoints: [],
  }),
}));

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    generalSettings: {
      browser_enabled: false,
      browser_ceph_admin_enabled: false,
    },
  }),
}));

vi.mock("../cephAdmin/CephAdminBucketCompareModal", () => ({
  default: () => null,
}));

vi.mock("../manager/BucketDetailPage", () => ({
  default: () => null,
}));

vi.mock("./BucketOpsBulkUpdatePage", () => ({
  default: () => null,
}));

vi.mock("./BucketOpsRowActionsMenu", () => ({
  default: () => null,
}));

import BucketOpsWorkbench from "./BucketOpsWorkbench";
import { saveBucketListReturnContext } from "./bucketListReturnContext";
import { buildBucketUiTagsStorageKey } from "./bucketUiTags";

const STORAGE_OPS_COLUMNS_STORAGE_KEY = "storage-ops.bucket_list.columns.v2";
const STORAGE_OPS_LIST_STATE_STORAGE_KEY = "storage-ops.bucket_list.state.v2";

const baseResponse = {
  total: 1,
  page: 1,
  page_size: 25,
  has_next: false,
  stats_available: true,
};

const baseBucket = {
  name: "bucket-a",
  bucket_name: "bucket-a",
  endpoint_id: 7,
  bucket_identity: "physical-7-bucket-a",
  context_id: "account-1",
  context_name: "Account A",
  owner: "owner-a",
  used_bytes: 5120,
  quota_max_size_bytes: 10240,
  object_count: 4,
  quota_max_objects: 8,
  owner_used_bytes: 5120,
  owner_quota_max_size_bytes: 10240,
  owner_object_count: 4,
  owner_quota_max_objects: 8,
};

function renderStorageOps() {
  return render(
    <MemoryRouter>
      <BucketOpsWorkbench
        mode="storage-ops"
        shell={{
          pageDescription: "Storage Ops buckets",
        }}
      />
    </MemoryRouter>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("BucketOpsWorkbench atomic quota columns", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    mocks.listCephAdminBuckets.mockReset();
    mocks.streamCephAdminBuckets.mockReset();
    mocks.listStorageOpsBuckets.mockReset();
    mocks.streamStorageOpsBuckets.mockReset();
    mocks.refreshCephAdminBucketListingCache.mockReset();
    mocks.refreshStorageOpsBucketListingCache.mockReset();
    mocks.listExecutionContexts.mockReset();
    mocks.refreshCephAdminBucketListingCache.mockResolvedValue({ refreshed: true });
    mocks.refreshStorageOpsBucketListingCache.mockResolvedValue({ refreshed: true });
    mocks.listExecutionContexts.mockResolvedValue([
      {
        kind: "account",
        id: "1",
        display_name: "Account A",
        endpoint_name: "Primary",
        endpoint_id: 7,
        tags: [{ id: 1, label: "finance", color_key: "amber", scope: "standard" }],
        endpoint_tags: [],
        capabilities: { can_manage_iam: true, sts_capable: false, admin_api_capable: true },
      },
      {
        kind: "connection",
        id: "conn-2",
        display_name: "Connection B",
        endpoint_name: "Archive",
        endpoint_id: 8,
        tags: [{ id: 2, label: "shared", color_key: "sky", scope: "standard" }],
        endpoint_tags: [{ id: 3, label: "cold", color_key: "slate", scope: "standard" }],
        capabilities: { can_manage_iam: false, sts_capable: false, admin_api_capable: false },
      },
      {
        kind: "legacy_user",
        id: "s3u-3",
        display_name: "Legacy User C",
        endpoint_name: "Primary",
        endpoint_id: 7,
        tags: [],
        endpoint_tags: [],
        capabilities: { can_manage_iam: false, sts_capable: false, admin_api_capable: false },
      },
    ]);
    mocks.noopAsync.mockClear();
    mocks.navigate.mockReset();
    window.localStorage.clear();
    window.sessionStorage.clear();
    Object.defineProperty(window.URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(() => "blob:mock"),
    });
    Object.defineProperty(window.URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLAnchorElement.prototype, "click", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });

  it("makes Storage Ops bucket names actionable and labels row selection with its context", async () => {
    mocks.listStorageOpsBuckets.mockResolvedValue({ items: [baseBucket], ...baseResponse });

    renderStorageOps();

    const bucketButton = await screen.findByRole("button", { name: "bucket-a" });
    const row = bucketButton.closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByRole("checkbox", { name: "Select bucket bucket-a in Account A" })).toBeInTheDocument();

    fireEvent.click(bucketButton);
    expect(mocks.navigate).toHaveBeenCalledWith(
      {
        pathname: "/storage-ops/buckets/bucket-a",
        search: "?ctx=account-1",
      },
      {
        state: expect.objectContaining({
          bucketListOrigin: {
            surface: "storage-ops",
            scopeKey: "storage-ops",
            listUrl: "/storage-ops/buckets",
          },
        }),
      }
    );
  });

  it("persists the current page and page size before opening a bucket", async () => {
    let storedAtNavigation: Record<string, { page?: number; pageSize?: number }> | null = null;
    mocks.navigate.mockImplementation(() => {
      storedAtNavigation = JSON.parse(
        window.localStorage.getItem(STORAGE_OPS_LIST_STATE_STORAGE_KEY) ?? "{}"
      ) as Record<string, { page?: number; pageSize?: number }>;
    });
    mocks.listStorageOpsBuckets.mockImplementation(async (_endpointId, params) => ({
      items: [baseBucket],
      ...baseResponse,
      total: 30,
      page: params.page ?? 1,
      page_size: params.page_size ?? 25,
      has_next: (params.page ?? 1) < 3,
    }));

    renderStorageOps();

    fireEvent.change(await screen.findByLabelText("Page size"), { target: { value: "10" } });
    await waitFor(() => expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument());
    const nextButton = screen.getByRole("button", { name: "Next" });
    fireEvent.click(nextButton);
    await waitFor(() => {
      expect(screen.getByText(/Page 2 of 3/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    });
    expect(screen.getByText(/Page 2 of 3/)).toBeInTheDocument();
    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem(STORAGE_OPS_LIST_STATE_STORAGE_KEY) ?? "{}"
      ) as Record<string, { page?: number; pageSize?: number }>;
      expect(stored["1"]).toEqual(expect.objectContaining({ page: 2, pageSize: 10 }));
    });

    fireEvent.click(screen.getByRole("button", { name: "bucket-a" }));

    expect(storedAtNavigation?.["1"]).toEqual(expect.objectContaining({ page: 2, pageSize: 10 }));
  });

  it("restores the list scroll position and focuses the originating bucket", async () => {
    const scrollTo = vi.fn();
    Object.defineProperty(window, "scrollTo", { configurable: true, value: scrollTo });
    mocks.listStorageOpsBuckets.mockResolvedValue({ items: [baseBucket], ...baseResponse });
    saveBucketListReturnContext(
      {
        surface: "storage-ops",
        scopeKey: "storage-ops",
        listUrl: "/storage-ops/buckets",
      },
      "bucket-a",
      420
    );

    renderStorageOps();

    const bucketButton = await screen.findByRole("button", { name: "bucket-a" });
    await waitFor(() => expect(bucketButton).toHaveFocus(), { timeout: 3000 });
    expect(scrollTo).toHaveBeenCalledWith({ top: 420, behavior: "auto" });
  });

  it("restores list preferences without restoring the previous tab's selection", async () => {
    window.localStorage.setItem(
      STORAGE_OPS_LIST_STATE_STORAGE_KEY,
      JSON.stringify({
        "1": {
          filter: "bucket-a",
          quickFilterMode: "contains",
          advancedApplied: null,
          tagFilters: [],
          tagFilterMode: "any",
          page: 2,
          pageSize: 50,
          sort: { field: "name", direction: "desc" },
        },
      })
    );
    mocks.listStorageOpsBuckets.mockResolvedValue({ items: [baseBucket], ...baseResponse });

    renderStorageOps();

    expect(await screen.findByLabelText("Quick filter")).toHaveValue("bucket-a");
    await waitFor(() =>
      expect(mocks.listStorageOpsBuckets).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          page: 2,
          page_size: 50,
          filter: "bucket-a",
          sort_by: "name",
          sort_dir: "desc",
        }),
        expect.any(Object)
      )
    );
    expect(screen.getByRole("checkbox", { name: "Select bucket bucket-a in Account A" })).not.toBeChecked();
  });

  it("shows S3 tag summaries from the shared bucket workbench tag column", async () => {
    window.localStorage.setItem(STORAGE_OPS_COLUMNS_STORAGE_KEY, JSON.stringify(["context_name", "tags"]));
    mocks.listStorageOpsBuckets.mockResolvedValue({
      items: [
        {
          ...baseBucket,
          tags: [
            { key: "project", value: "archive" },
            { key: "env", value: "prod" },
          ],
        },
      ],
      ...baseResponse,
    });

    renderStorageOps();

    expect(await screen.findByText("bucket-a")).toBeInTheDocument();
    fireEvent.focus(screen.getByRole("button", { name: "S3 tags details" }));

    expect(await screen.findByText("project: archive")).toBeInTheDocument();
    expect(screen.getByText("env: prod")).toBeInTheDocument();
  });

  it("shares UI tags across contexts for one physical bucket without leaking to another endpoint", async () => {
    localStorage.setItem(
      buildBucketUiTagsStorageKey("storage-ops", 7),
      JSON.stringify({
        "physical-7-bucket-a": { name: "bucket-a", tenant: null, tags: ["urgent"] },
      })
    );
    localStorage.setItem(
      buildBucketUiTagsStorageKey("storage-ops", 8),
      JSON.stringify({
        "physical-8-bucket-a": { name: "bucket-a", tenant: null, tags: ["archive"] },
      })
    );
    const buckets = [
      { ...baseBucket, name: "account-1::bucket-a", context_id: "account-1", context_name: "Account A" },
      { ...baseBucket, name: "conn-2::bucket-a", context_id: "conn-2", context_name: "Connection B" },
      {
        ...baseBucket,
        name: "account-9::bucket-a",
        context_id: "account-9",
        context_name: "Account C",
        endpoint_id: 8,
        endpoint_name: "Archive",
        bucket_identity: "physical-8-bucket-a",
      },
    ];
    mocks.listStorageOpsBuckets.mockResolvedValue({ items: buckets, ...baseResponse, total: buckets.length });

    renderStorageOps();

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Remove tag urgent" })).toHaveLength(2),
    );
    expect(screen.getAllByRole("button", { name: "Remove tag archive" })).toHaveLength(1);
    await waitFor(() =>
      expect(mocks.listStorageOpsBuckets.mock.calls.some((call) => {
        const raw = call[1]?.advanced_filter;
        return typeof raw === "string" && raw.includes('"field":"bucket_identity"');
      })).toBe(true)
    );
  });

  it("disables UI tags when a Storage Ops row has no configured endpoint", async () => {
    mocks.listStorageOpsBuckets.mockResolvedValue({
      items: [{ ...baseBucket, endpoint_id: null, bucket_identity: null }],
      ...baseResponse,
    });

    renderStorageOps();

    expect(await screen.findByText("Endpoint required")).toHaveAttribute(
      "title",
      "UI tags require a configured storage endpoint."
    );
    expect(screen.queryByRole("textbox", { name: "+" })).not.toBeInTheDocument();
  });

  it("selects and deselects filtered storage ops contexts in the compact advanced filter", async () => {
    mocks.listStorageOpsBuckets.mockResolvedValue({
      items: [baseBucket],
      ...baseResponse,
    });
    mocks.streamStorageOpsBuckets.mockResolvedValue({
      items: [baseBucket],
      ...baseResponse,
    });

    renderStorageOps();

    expect(await screen.findByText("bucket-a")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Advanced filter/i }));

    const contextFilter = await screen.findByLabelText("Filter contexts");
    fireEvent.change(contextFilter, { target: { value: "Account" } });
    const contextSelectFilteredButton = screen.getAllByRole("button", { name: "Select filtered" })[0];
    const contextDeselectFilteredButton = screen.getAllByRole("button", { name: "Deselect filtered" })[0];
    expect(contextSelectFilteredButton).toHaveClass("ui-button-base");
    expect(contextDeselectFilteredButton).toHaveClass("ui-button-base");
    fireEvent.click(contextSelectFilteredButton);

    fireEvent.change(contextFilter, { target: { value: "shared" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Select filtered" })[0]);

    fireEvent.change(contextFilter, { target: { value: "s3 user" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Select filtered" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Deselect filtered" })[0]);

    expect(screen.getByRole("button", { name: "Clear" })).toHaveClass("ui-button-base");
    for (const closeButton of screen.getAllByRole("button", { name: "Close" })) {
      expect(closeButton).toHaveClass("ui-button-base");
    }
    const applyButton = screen.getByRole("button", { name: "Apply filters" });
    expect(applyButton).toHaveClass("ui-button-base");
    fireEvent.click(applyButton);

    await waitFor(() => expect(mocks.streamStorageOpsBuckets).toHaveBeenCalled());
    const params = mocks.streamStorageOpsBuckets.mock.calls.at(-1)?.[1] as { advanced_filter?: string } | undefined;
    const payload = JSON.parse(params?.advanced_filter ?? "{}") as {
      rules?: Array<{ field?: string; op?: string; value?: unknown }>;
    };
    expect(payload.rules).toEqual(
      expect.arrayContaining([{ field: "context_id", op: "in", value: ["1", "conn-2"] }])
    );
  });

  it("selects and deselects filtered storage ops endpoints in the compact advanced filter", async () => {
    mocks.listStorageOpsBuckets.mockResolvedValue({
      items: [baseBucket],
      ...baseResponse,
    });
    mocks.streamStorageOpsBuckets.mockResolvedValue({
      items: [baseBucket],
      ...baseResponse,
    });

    renderStorageOps();

    expect(await screen.findByText("bucket-a")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Advanced filter/i }));

    const endpointFilter = await screen.findByLabelText("Filter endpoints");
    fireEvent.change(endpointFilter, { target: { value: "Primary" } });
    const endpointSelectFilteredButton = screen.getAllByRole("button", { name: "Select filtered" })[1];
    const endpointDeselectFilteredButton = screen.getAllByRole("button", { name: "Deselect filtered" })[1];
    expect(endpointSelectFilteredButton).toHaveClass("ui-button-base");
    expect(endpointDeselectFilteredButton).toHaveClass("ui-button-base");
    fireEvent.click(endpointSelectFilteredButton);

    fireEvent.change(endpointFilter, { target: { value: "cold" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Select filtered" })[1]);

    fireEvent.change(endpointFilter, { target: { value: "legacy user" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Deselect filtered" })[1]);

    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    await waitFor(() => expect(mocks.streamStorageOpsBuckets).toHaveBeenCalled());
    const params = mocks.streamStorageOpsBuckets.mock.calls.at(-1)?.[1] as { advanced_filter?: string } | undefined;
    const payload = JSON.parse(params?.advanced_filter ?? "{}") as {
      rules?: Array<{ field?: string; op?: string; value?: unknown }>;
    };
    expect(payload.rules).toEqual(expect.arrayContaining([{ field: "endpoint_name", op: "eq", value: "Archive" }]));
  });

  it("collapses secondary advanced filter sections by default", async () => {
    mocks.listStorageOpsBuckets.mockResolvedValue({
      items: [baseBucket],
      ...baseResponse,
    });

    renderStorageOps();

    expect(await screen.findByText("bucket-a")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Advanced filter/i }));

    const metricsSection = await screen.findByRole("button", { name: /Storage Metrics and Quota/i });
    const featureStatesSection = screen.getByRole("button", { name: /Feature states/i });
    const featureDetailsSection = screen.getByRole("button", { name: /Feature details/i });

    expect(metricsSection).toHaveAttribute("aria-expanded", "false");
    expect(featureStatesSection).toHaveAttribute("aria-expanded", "false");
    expect(featureDetailsSection).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Quota usage %")).not.toBeInTheDocument();
    expect(screen.queryByText("Disabled or Suspended")).not.toBeInTheDocument();
    expect(screen.queryByText("Rule name")).not.toBeInTheDocument();

    fireEvent.click(metricsSection);
    expect(metricsSection).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Quota usage %")).toBeInTheDocument();

    fireEvent.click(featureStatesSection);
    expect(featureStatesSection).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Disabled or Suspended")).toBeInTheDocument();

    fireEvent.click(featureDetailsSection);
    expect(featureDetailsSection).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByText("Rule name").length).toBeGreaterThan(0);
  });

  it("shows detailed advanced search progress while streaming bucket filters", async () => {
    mocks.listStorageOpsBuckets.mockResolvedValue({
      items: [baseBucket],
      ...baseResponse,
    });
    const pending = deferred<typeof baseResponse & { items: Array<typeof baseBucket> }>();
    mocks.streamStorageOpsBuckets.mockImplementationOnce((...args: unknown[]) => {
      const options = args[2] as
        | {
            onProgress?: (event: {
              request_id: string;
              percent: number;
              stage: string;
              processed: number;
              total: number;
              message: string;
            }) => void;
          }
        | undefined;
      options?.onProgress?.({
        request_id: "progress-1",
        percent: 48,
        stage: "context_listing",
        processed: 4,
        total: 12,
        message: "Loading context bucket listings",
      });
      return pending.promise;
    });

    renderStorageOps();

    expect(await screen.findByText("bucket-a")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Advanced filter/i }));

    const contextFilter = await screen.findByLabelText("Filter contexts");
    fireEvent.change(contextFilter, { target: { value: "Account" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Select filtered" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    expect(await screen.findByText(/Advanced search in progress/)).toBeInTheDocument();
    expect(screen.getByText(/Loading context bucket listings · 4 \/ 12/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Advanced search progress" })).toHaveAttribute(
      "aria-valuenow",
      "48"
    );

    pending.resolve({
      items: [baseBucket],
      ...baseResponse,
    });
    await waitFor(() => {
      expect(screen.queryByText(/Advanced search in progress/)).not.toBeInTheDocument();
    });
  });

  it("flushes the backend cache before reloading storage ops buckets", async () => {
    mocks.listStorageOpsBuckets.mockResolvedValue({
      items: [baseBucket],
      ...baseResponse,
    });

    renderStorageOps();

    expect(await screen.findByText("bucket-a")).toBeInTheDocument();

    const refreshButton = screen.getByRole("button", { name: "Refresh" });
    await waitFor(() => expect(refreshButton).not.toBeDisabled());
    fireEvent.click(refreshButton);

    await waitFor(() => expect(mocks.refreshStorageOpsBucketListingCache).toHaveBeenCalledWith(1));
    await waitFor(() => expect(mocks.listStorageOpsBuckets.mock.calls.length).toBeGreaterThanOrEqual(2));
    const refreshOrder = mocks.refreshStorageOpsBucketListingCache.mock.invocationCallOrder[0];
    const lastListOrder = mocks.listStorageOpsBuckets.mock.invocationCallOrder.at(-1);
    expect(refreshOrder).toBeDefined();
    expect(lastListOrder).toBeDefined();
    expect(refreshOrder as number).toBeLessThan(lastListOrder as number);
  });

  it("loads owner quota columns without enabling stats in storage ops", async () => {
    window.localStorage.setItem(
      STORAGE_OPS_COLUMNS_STORAGE_KEY,
      JSON.stringify(["context_name", "owner_quota_max_size_bytes", "owner_quota_max_objects"])
    );
    mocks.listStorageOpsBuckets.mockResolvedValue({
      items: [baseBucket],
      ...baseResponse,
    });

    renderStorageOps();

    await waitFor(() => expect(mocks.listStorageOpsBuckets).toHaveBeenCalledTimes(2));
    expect(mocks.listStorageOpsBuckets.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        include: ["owner_quota"],
        with_stats: false,
      })
    );
  });

  it("loads and renders the owner suspended column in storage ops", async () => {
    window.localStorage.setItem(
      STORAGE_OPS_COLUMNS_STORAGE_KEY,
      JSON.stringify(["context_name", "owner_suspended"])
    );
    mocks.listStorageOpsBuckets.mockResolvedValue({
      items: [{ ...baseBucket, owner_suspended: true }],
      ...baseResponse,
    });

    renderStorageOps();

    await waitFor(() => expect(mocks.listStorageOpsBuckets).toHaveBeenCalledTimes(2));
    expect(mocks.listStorageOpsBuckets.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        include: ["owner_suspended"],
        with_stats: false,
      })
    );
    expect(screen.getByText("Owner suspended")).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
  });

  it("loads owner usage percentage columns with owner quota metadata and stats", async () => {
    window.localStorage.setItem(
      STORAGE_OPS_COLUMNS_STORAGE_KEY,
      JSON.stringify([
        "owner_used_bytes",
        "owner_quota_usage_size_percent",
        "owner_object_count",
        "owner_quota_usage_object_percent",
      ])
    );
    mocks.listStorageOpsBuckets.mockResolvedValue({
      items: [baseBucket],
      ...baseResponse,
    });

    renderStorageOps();

    await waitFor(() => expect(mocks.listStorageOpsBuckets).toHaveBeenCalledTimes(2));
    expect(mocks.listStorageOpsBuckets.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        include: ["owner_quota", "owner_quota_usage"],
        with_stats: true,
      })
    );
  });

  it("exposes the Notifications column in storage ops and requests notifications enrichment", async () => {
    mocks.listStorageOpsBuckets.mockResolvedValue({
      items: [
        {
          ...baseBucket,
          features: {
            notifications: { state: "Configured", tone: "active" },
          },
        },
      ],
      ...baseResponse,
    });

    renderStorageOps();

    expect(await screen.findByText("bucket-a")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    const notificationsColumn = await screen.findByLabelText("Notifications");
    expect(notificationsColumn).toBeInTheDocument();
    const notificationsGroup = notificationsColumn.closest("div");
    expect(notificationsGroup).not.toBeNull();
    fireEvent.click(within(notificationsGroup as HTMLElement).getByRole("button", { name: "Details ▸" }));
    expect(screen.getByLabelText("Notification topic names")).toBeInTheDocument();
    const sseColumn = screen.getByLabelText("Server-side encryption");
    const sseGroup = sseColumn.closest("div");
    expect(sseGroup).not.toBeNull();
    fireEvent.click(within(sseGroup as HTMLElement).getByRole("button", { name: "Details ▸" }));
    expect(screen.getByLabelText("SSE algorithms")).toBeInTheDocument();
    expect(screen.getByLabelText("SSE KMS key IDs")).toBeInTheDocument();

    fireEvent.click(notificationsColumn);

    await waitFor(() =>
      expect(mocks.listStorageOpsBuckets.mock.calls.at(-1)?.[1]).toEqual(
        expect.objectContaining({
          include: expect.arrayContaining(["notifications"]),
        })
      )
    );
    expect(await screen.findByText("Configured")).toBeInTheDocument();
  });

  it("renders feature detail columns and exports flat CSV values", async () => {
    const blobs: Array<{ text: () => Promise<string> }> = [];
    class MockBlob {
      private readonly content: string;

      constructor(parts: unknown[]) {
        this.content = parts.map((part) => String(part)).join("");
      }

      async text() {
        return this.content;
      }
    }
    Object.defineProperty(globalThis, "Blob", {
      configurable: true,
      writable: true,
      value: MockBlob,
    });
    Object.defineProperty(window.URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn((blob: { text: () => Promise<string> }) => {
        blobs.push(blob);
        return "blob:mock";
      }),
    });
    window.localStorage.setItem(
      STORAGE_OPS_COLUMNS_STORAGE_KEY,
      JSON.stringify(["object_lock_retention_years", "policy_has_conditions", "notification_topic_names", "sse_algorithms"])
    );
    mocks.listStorageOpsBuckets.mockResolvedValue({
      items: [
        {
          ...baseBucket,
          column_details: {
            object_lock_retention_years: 1,
            policy_has_conditions: true,
            notification_topic_names: ["archive-topic", "images-topic"],
            sse_algorithms: ["aws:kms"],
          },
        },
      ],
      ...baseResponse,
    });

    renderStorageOps();

    expect(await screen.findByText("bucket-a")).toBeInTheDocument();
    expect(screen.getByText("Object Lock retention years")).toBeInTheDocument();
    expect(screen.getByText("Policy has conditions")).toBeInTheDocument();
    expect(screen.getByText("Notification topic names")).toBeInTheDocument();
    expect(screen.getByText("SSE algorithms")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.getByText("archive-topic, images-topic")).toBeInTheDocument();
    expect(screen.getByText("aws:kms")).toBeInTheDocument();

    const bucketRow = screen.getByText("bucket-a").closest("tr");
    expect(bucketRow).not.toBeNull();
    fireEvent.click(within(bucketRow as HTMLElement).getByRole("checkbox"));

    fireEvent.click(screen.getByRole("button", { name: "Actions for 1 selected bucket" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Export selection…" }));
    const firstExportDialog = await screen.findByRole("dialog", { name: "Export selection" });
    fireEvent.click(within(firstExportDialog).getByText("CSV").closest("button") as HTMLButtonElement);

    await waitFor(() => expect(mocks.listStorageOpsBuckets.mock.calls.length).toBeGreaterThanOrEqual(3));
    expect(mocks.listStorageOpsBuckets.mock.calls.at(-1)?.[1]).toEqual(
      expect.objectContaining({
        include: expect.arrayContaining([
          "object_lock_retention_years",
          "policy_has_conditions",
          "notification_topic_names",
          "sse_algorithms",
        ]),
        with_stats: false,
      })
    );

    expect(blobs).toHaveLength(1);
    const csv = await blobs[0].text();
    expect(csv).toContain('"Name","Object Lock retention years","Policy has conditions","Notification topic names","SSE algorithms"');
    expect(csv).toContain('"bucket-a","1","Yes","archive-topic, images-topic","aws:kms"');
  });

  it("groups bucket and owner quota picker options behind detail toggles", async () => {
    mocks.listStorageOpsBuckets.mockResolvedValue({
      items: [baseBucket],
      ...baseResponse,
    });

    renderStorageOps();

    expect(await screen.findByText("bucket-a")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));

    expect(screen.getByText("Bucket quota")).toBeInTheDocument();
    expect(screen.getByText("Owner quota")).toBeInTheDocument();
    expect(screen.queryByLabelText("Quota")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Owner quota")).not.toBeInTheDocument();

    const bucketQuotaGroup = screen.getByText("Bucket quota").closest("div");
    expect(bucketQuotaGroup).not.toBeNull();
    fireEvent.click(within(bucketQuotaGroup as HTMLElement).getByRole("button", { name: "Details ▸" }));
    expect(screen.getByLabelText("Quota")).toBeInTheDocument();
    expect(screen.getByLabelText("Quota status")).toBeInTheDocument();

    const ownerQuotaGroup = screen.getByText("Owner quota").closest("div");
    expect(ownerQuotaGroup).not.toBeNull();
    fireEvent.click(within(ownerQuotaGroup as HTMLElement).getByRole("button", { name: "Details ▸" }));
    expect(screen.getByLabelText("Owner quota")).toBeInTheDocument();
    expect(screen.getByLabelText("Owner object quota")).toBeInTheDocument();
  });

  it("renders atomic single-line columns and exports flat CSV values", async () => {
    const blobs: Array<{ text: () => Promise<string> }> = [];
    class MockBlob {
      private readonly content: string;

      constructor(parts: unknown[]) {
        this.content = parts.map((part) => String(part)).join("");
      }

      async text() {
        return this.content;
      }
    }
    Object.defineProperty(globalThis, "Blob", {
      configurable: true,
      writable: true,
      value: MockBlob,
    });
    Object.defineProperty(window.URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn((blob: { text: () => Promise<string> }) => {
        blobs.push(blob);
        return "blob:mock";
      }),
    });
    window.localStorage.setItem(
      STORAGE_OPS_COLUMNS_STORAGE_KEY,
      JSON.stringify([
        "owner_used_bytes",
        "owner_quota_max_size_bytes",
        "owner_quota_usage_size_percent",
        "owner_object_count",
        "owner_quota_max_objects",
        "owner_quota_usage_object_percent",
        "used_bytes",
        "quota_max_size_bytes",
        "quota_usage_size_percent",
        "object_count",
        "quota_max_objects",
        "quota_usage_object_percent",
      ])
    );
    mocks.listStorageOpsBuckets.mockResolvedValue({
      items: [baseBucket],
      ...baseResponse,
    });

    renderStorageOps();

    expect(await screen.findByText("bucket-a")).toBeInTheDocument();
    expect(screen.getByText("Owner quota %")).toBeInTheDocument();
    expect(screen.getByText("Object quota %")).toBeInTheDocument();
    expect(screen.queryByText("Owner quota usage")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Size:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Obj:/)).not.toBeInTheDocument();

    const bucketRow = screen.getByText("bucket-a").closest("tr");
    expect(bucketRow).not.toBeNull();
    fireEvent.click(within(bucketRow as HTMLElement).getByRole("checkbox"));

    fireEvent.click(screen.getByRole("button", { name: "Actions for 1 selected bucket" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Export selection…" }));
    const secondExportDialog = await screen.findByRole("dialog", { name: "Export selection" });
    fireEvent.click(within(secondExportDialog).getByText("CSV").closest("button") as HTMLButtonElement);

    await waitFor(() => expect(mocks.listStorageOpsBuckets.mock.calls.length).toBeGreaterThanOrEqual(3));
    expect(mocks.listStorageOpsBuckets.mock.calls.at(-1)?.[1]).toEqual(
      expect.objectContaining({
        include: ["owner_quota", "owner_quota_usage"],
        with_stats: true,
      })
    );

    expect(blobs).toHaveLength(1);
    const csv = await blobs[0].text();
    expect(csv).toContain('"Name","Owner used","Owner quota","Owner quota %"');
    expect(csv).toContain('"5.0 KB","10 KB","50.0%","4","8","50.0%","5.0 KB","10 KB","50.0%","4","8","50.0%"');
    expect(csv).not.toContain("Size:");
    expect(csv).not.toContain("Obj:");
  });
});
