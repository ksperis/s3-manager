import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  listCephAdminBuckets: vi.fn(),
  streamCephAdminBuckets: vi.fn(),
  refreshCephAdminBucketListingCache: vi.fn(),
  refreshStorageOpsBucketListingCache: vi.fn(),
  fetchCephAdminBucketUiTags: vi.fn(),
  fetchStorageOpsBucketUiTags: vi.fn(),
  patchCephAdminBucketUiTags: vi.fn(),
  patchStorageOpsBucketUiTags: vi.fn(),
  noopAsync: vi.fn(async () => ({})),
  navigate: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useLocation: () => ({ pathname: "/ceph-admin/buckets", search: "" }),
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
  listStorageOpsBuckets: vi.fn(),
  putStorageOpsBucketCors: mocks.noopAsync,
  putStorageOpsBucketLifecycle: mocks.noopAsync,
  putStorageOpsBucketLogging: mocks.noopAsync,
  putStorageOpsBucketNotifications: mocks.noopAsync,
  putStorageOpsBucketPolicy: mocks.noopAsync,
  refreshStorageOpsBucketListingCache: mocks.refreshStorageOpsBucketListingCache,
  setStorageOpsBucketVersioning: mocks.noopAsync,
  streamStorageOpsBuckets: vi.fn(),
  updateStorageOpsBucketObjectLock: mocks.noopAsync,
  updateStorageOpsBucketPublicAccessBlock: mocks.noopAsync,
}));

vi.mock("../../api/bucketUiTags", () => ({
  fetchCephAdminBucketUiTags: mocks.fetchCephAdminBucketUiTags,
  fetchStorageOpsBucketUiTags: mocks.fetchStorageOpsBucketUiTags,
  patchCephAdminBucketUiTags: mocks.patchCephAdminBucketUiTags,
  patchStorageOpsBucketUiTags: mocks.patchStorageOpsBucketUiTags,
}));

vi.mock("../cephAdmin/CephAdminEndpointContext", () => ({
  useCephAdminEndpoint: () => ({
    selectedEndpointId: 7,
    selectedEndpoint: {
      id: 7,
      name: "Archive",
      capabilities: { metrics: false, static_website: true, sse: true },
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

vi.mock("./BucketSelectionActionsBar", () => ({
  default: () => null,
}));

import BucketOpsWorkbench from "./BucketOpsWorkbench";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function getTableOverflowContainer() {
  const container = screen.getByRole("table").parentElement;
  expect(container).not.toBeNull();
  return container as HTMLElement;
}

describe("BucketOpsWorkbench Ceph Admin stats fallback", () => {
  beforeEach(() => {
    mocks.listCephAdminBuckets.mockReset();
    mocks.streamCephAdminBuckets.mockReset();
    mocks.refreshCephAdminBucketListingCache.mockReset();
    mocks.refreshStorageOpsBucketListingCache.mockReset();
    mocks.refreshCephAdminBucketListingCache.mockResolvedValue({ refreshed: true });
    mocks.refreshStorageOpsBucketListingCache.mockResolvedValue({ refreshed: true });
    mocks.fetchCephAdminBucketUiTags.mockReset();
    mocks.fetchStorageOpsBucketUiTags.mockReset();
    mocks.patchCephAdminBucketUiTags.mockReset();
    mocks.patchStorageOpsBucketUiTags.mockReset();
    mocks.fetchCephAdminBucketUiTags.mockResolvedValue({ definitions: [], assignments: [] });
    mocks.fetchStorageOpsBucketUiTags.mockResolvedValue({ definitions: [], assignments: [] });
    mocks.patchCephAdminBucketUiTags.mockResolvedValue({ definitions: [], assignments: [] });
    mocks.patchStorageOpsBucketUiTags.mockResolvedValue({ definitions: [], assignments: [] });
    mocks.noopAsync.mockClear();
    mocks.navigate.mockReset();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("opens Ceph Admin bucket configuration on the endpoint-scoped detail route", async () => {
    mocks.listCephAdminBuckets.mockResolvedValue({
      items: [{ name: "bucket-a", owner: "owner-a" }],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
      stats_available: true,
    });

    render(
      <MemoryRouter>
        <BucketOpsWorkbench mode="ceph-admin" shell={{ pageDescription: "Ceph buckets" }} />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole("button", { name: "bucket-a" }));

    expect(mocks.navigate).toHaveBeenCalledWith(
      {
        pathname: "/ceph-admin/buckets/bucket-a",
        search: "?ep=7",
      },
      {
        state: {
          bucketListOrigin: {
            surface: "ceph-admin",
            scopeKey: "7",
            listUrl: "/ceph-admin/buckets",
          },
        },
      }
    );
  });

  it("requests bucket stats by default and surfaces degraded stats warnings", async () => {
    mocks.listCephAdminBuckets.mockResolvedValue({
      items: [{ name: "bucket-a", owner: "owner-a" }],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
      stats_available: false,
      stats_warning:
        "Bucket stats are unavailable via Ceph Admin credentials on this endpoint. Showing owner metadata without usage or quota values.",
    });

    render(
      <MemoryRouter>
        <BucketOpsWorkbench
          mode="ceph-admin"
          shell={{
            pageDescription: "Ceph buckets",
          }}
        />
      </MemoryRouter>
    );

    await waitFor(() => expect(mocks.listCephAdminBuckets).toHaveBeenCalled());
    expect(mocks.listCephAdminBuckets).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        with_stats: true,
      }),
      expect.any(Object)
    );

    fireEvent.click(screen.getByRole("button", { name: /Advanced filter/i }));

    expect(await screen.findByText("Bucket stats unavailable")).toBeInTheDocument();
    expect(screen.getAllByText(/showing owner metadata without usage or quota values/i).length).toBeGreaterThan(0);
  });

  it("falls back to plain listing when an exact quick filter payload is too large for streaming", async () => {
    mocks.listCephAdminBuckets.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 25,
      has_next: false,
      stats_available: true,
    });

    render(
      <MemoryRouter>
        <BucketOpsWorkbench
          mode="ceph-admin"
          shell={{
            pageDescription: "Ceph buckets",
          }}
        />
      </MemoryRouter>
    );

    await waitFor(() => expect(mocks.listCephAdminBuckets).toHaveBeenCalled());
    mocks.listCephAdminBuckets.mockClear();
    mocks.streamCephAdminBuckets.mockClear();

    const longExactFilter = Array.from({ length: 600 }, (_, index) => `bucket-${String(index).padStart(4, "0")}`).join(
      "\n"
    );

    fireEvent.change(screen.getByLabelText("Quick filter"), {
      target: { value: longExactFilter },
    });

    await waitFor(() => expect(mocks.listCephAdminBuckets).toHaveBeenCalled());
    expect(mocks.streamCephAdminBuckets).not.toHaveBeenCalled();
    expect(mocks.listCephAdminBuckets).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        advanced_filter: expect.stringContaining('"op":"in"'),
      }),
      expect.any(Object)
    );
  });

  it("hides the horizontal table overflow behind the advanced filter drawer while buckets are loading", async () => {
    const pending = createDeferred<{
      items: Array<{ name: string; owner: string }>;
      total: number;
      page: number;
      page_size: number;
      has_next: boolean;
      stats_available: boolean;
    }>();
    mocks.listCephAdminBuckets.mockReturnValueOnce(pending.promise);

    render(
      <MemoryRouter>
        <BucketOpsWorkbench
          mode="ceph-admin"
          shell={{
            pageDescription: "Ceph buckets",
          }}
        />
      </MemoryRouter>
    );

    expect(await screen.findByText("Loading buckets...")).toBeInTheDocument();
    expect(getTableOverflowContainer()).toHaveClass("overflow-x-auto");
    expect(screen.getByRole("table")).toHaveClass("!table-auto", "!w-max", "min-w-full");

    fireEvent.click(screen.getByRole("button", { name: /Advanced filter/i }));

    const backdrop = screen.getByLabelText("Close advanced filter drawer");
    expect(backdrop).toHaveClass("bg-black/50");
    expect(backdrop).not.toHaveClass("bg-slate-950/45");
    expect(screen.getByText("Buckets listing").closest(".fixed")).toHaveClass("z-[46]");
    expect(getTableOverflowContainer()).toHaveClass("overflow-x-hidden");
    expect(getTableOverflowContainer()).not.toHaveClass("overflow-x-auto");

    pending.resolve({
      items: [],
      total: 0,
      page: 1,
      page_size: 25,
      has_next: false,
      stats_available: true,
    });

    expect(await screen.findByText("No buckets.")).toBeInTheDocument();
  });

  it("clears the current rows and shows loading while a new filter request is in flight", async () => {
    const deferred = createDeferred<{
      items: Array<{ name: string; owner: string }>;
      total: number;
      page: number;
      page_size: number;
      has_next: boolean;
      stats_available: boolean;
    }>();

    mocks.listCephAdminBuckets
      .mockResolvedValueOnce({
        items: [{ name: "bucket-a", owner: "owner-a" }],
        total: 1,
        page: 1,
        page_size: 25,
        has_next: false,
        stats_available: true,
      })
      .mockImplementationOnce(() => deferred.promise);

    render(
      <MemoryRouter>
        <BucketOpsWorkbench
          mode="ceph-admin"
          shell={{
            pageDescription: "Ceph buckets",
          }}
        />
      </MemoryRouter>
    );

    expect(await screen.findByText("bucket-a")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Quick filter"), {
      target: { value: "bucket-b" },
    });

    await waitFor(() => expect(mocks.listCephAdminBuckets).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("bucket-a")).not.toBeInTheDocument();
    expect(screen.getByText("Loading buckets...")).toBeInTheDocument();

    deferred.resolve({
      items: [{ name: "bucket-b", owner: "owner-b" }],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
      stats_available: true,
    });

    expect(await screen.findByText("bucket-b")).toBeInTheDocument();
    expect(screen.queryByText("Loading buckets...")).not.toBeInTheDocument();
  });
});
