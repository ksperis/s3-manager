import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  deleteCephAdminBucketLogging: mocks.noopAsync,
  deleteCephAdminBucketCors: mocks.noopAsync,
  deleteCephAdminBucketLifecycle: mocks.noopAsync,
  deleteCephAdminBucketPolicy: mocks.noopAsync,
  getCephAdminBucketCors: mocks.noopAsync,
  getCephAdminBucketEncryption: mocks.noopAsync,
  getCephAdminBucketLifecycle: mocks.noopAsync,
  getCephAdminBucketLogging: mocks.noopAsync,
  getCephAdminBucketPolicy: mocks.noopAsync,
  getCephAdminBucketProperties: mocks.noopAsync,
  getCephAdminBucketPublicAccessBlock: mocks.noopAsync,
  getCephAdminBucketWebsite: mocks.noopAsync,
  listCephAdminBuckets: mocks.listCephAdminBuckets,
  putCephAdminBucketLogging: mocks.noopAsync,
  putCephAdminBucketCors: mocks.noopAsync,
  putCephAdminBucketLifecycle: mocks.noopAsync,
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
  deleteStorageOpsBucketPolicy: mocks.noopAsync,
  getStorageOpsBucketCors: mocks.noopAsync,
  getStorageOpsBucketEncryption: mocks.noopAsync,
  getStorageOpsBucketLifecycle: mocks.noopAsync,
  getStorageOpsBucketLogging: mocks.noopAsync,
  getStorageOpsBucketPolicy: mocks.noopAsync,
  getStorageOpsBucketProperties: mocks.noopAsync,
  getStorageOpsBucketPublicAccessBlock: mocks.noopAsync,
  getStorageOpsBucketWebsite: mocks.noopAsync,
  listStorageOpsBuckets: mocks.listStorageOpsBuckets,
  putStorageOpsBucketCors: mocks.noopAsync,
  putStorageOpsBucketLifecycle: mocks.noopAsync,
  putStorageOpsBucketLogging: mocks.noopAsync,
  putStorageOpsBucketPolicy: mocks.noopAsync,
  refreshStorageOpsBucketListingCache: mocks.refreshStorageOpsBucketListingCache,
  setStorageOpsBucketVersioning: mocks.noopAsync,
  streamStorageOpsBuckets: mocks.streamStorageOpsBuckets,
  updateStorageOpsBucketObjectLock: mocks.noopAsync,
  updateStorageOpsBucketPublicAccessBlock: mocks.noopAsync,
  updateStorageOpsBucketQuota: mocks.noopAsync,
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

vi.mock("./BucketOpsBulkUpdateModal", () => ({
  default: () => null,
}));

vi.mock("./BucketOpsRowActionsMenu", () => ({
  default: () => null,
}));

import BucketOpsWorkbench from "./BucketOpsWorkbench";

const STORAGE_OPS_COLUMNS_STORAGE_KEY = "storage-ops.bucket_list.columns.v2";
const LEGACY_STORAGE_OPS_COLUMNS_STORAGE_KEY = "storage-ops.bucket_list.columns.v1";

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

describe("BucketOpsWorkbench atomic quota columns", () => {
  beforeEach(() => {
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
        tags: [{ id: 1, label: "finance", color_key: "amber", scope: "standard" }],
        endpoint_tags: [],
        capabilities: { can_manage_iam: true, sts_capable: false, admin_api_capable: true },
      },
      {
        kind: "connection",
        id: "conn-2",
        display_name: "Connection B",
        endpoint_name: "Archive",
        tags: [{ id: 2, label: "shared", color_key: "sky", scope: "standard" }],
        endpoint_tags: [{ id: 3, label: "cold", color_key: "slate", scope: "standard" }],
        capabilities: { can_manage_iam: false, sts_capable: false, admin_api_capable: false },
      },
      {
        kind: "legacy_user",
        id: "s3u-3",
        display_name: "Legacy User C",
        endpoint_name: "Primary",
        tags: [],
        endpoint_tags: [],
        capabilities: { can_manage_iam: false, sts_capable: false, admin_api_capable: false },
      },
    ]);
    mocks.noopAsync.mockClear();
    mocks.navigate.mockReset();
    window.localStorage.clear();
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

  it("ignores legacy v1 column preferences after the storage key bump", async () => {
    window.localStorage.setItem(
      LEGACY_STORAGE_OPS_COLUMNS_STORAGE_KEY,
      JSON.stringify(["context_name", "owner_quota_max_size_bytes"])
    );
    mocks.listStorageOpsBuckets.mockResolvedValue({
      items: [baseBucket],
      ...baseResponse,
    });

    renderStorageOps();

    expect(await screen.findByText("bucket-a")).toBeInTheDocument();
    expect(screen.getByText("UI tags")).toBeInTheDocument();
    expect(screen.queryByText("Owner quota")).not.toBeInTheDocument();
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
    fireEvent.click(screen.getAllByRole("button", { name: "Select filtered" })[0]);

    fireEvent.change(contextFilter, { target: { value: "shared" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Select filtered" })[0]);

    fireEvent.change(contextFilter, { target: { value: "s3 user" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Select filtered" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Deselect filtered" })[0]);

    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

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
    fireEvent.click(screen.getAllByRole("button", { name: "Select filtered" })[1]);

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

    fireEvent.click(screen.getByText("Export list"));
    fireEvent.click(await screen.findByRole("button", { name: "CSV (selected columns)" }));

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
