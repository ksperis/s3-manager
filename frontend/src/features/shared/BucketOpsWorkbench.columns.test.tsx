import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listCephAdminBuckets: vi.fn(),
  streamCephAdminBuckets: vi.fn(),
  listStorageOpsBuckets: vi.fn(),
  streamStorageOpsBuckets: vi.fn(),
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
  setStorageOpsBucketVersioning: mocks.noopAsync,
  streamStorageOpsBuckets: mocks.streamStorageOpsBuckets,
  updateStorageOpsBucketObjectLock: mocks.noopAsync,
  updateStorageOpsBucketPublicAccessBlock: mocks.noopAsync,
  updateStorageOpsBucketQuota: mocks.noopAsync,
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
