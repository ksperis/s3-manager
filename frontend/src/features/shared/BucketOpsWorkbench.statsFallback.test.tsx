import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  listCephAdminBuckets: vi.fn(),
  streamCephAdminBuckets: vi.fn(),
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
  listStorageOpsBuckets: vi.fn(),
  putStorageOpsBucketCors: mocks.noopAsync,
  putStorageOpsBucketLifecycle: mocks.noopAsync,
  putStorageOpsBucketLogging: mocks.noopAsync,
  putStorageOpsBucketPolicy: mocks.noopAsync,
  setStorageOpsBucketVersioning: mocks.noopAsync,
  streamStorageOpsBuckets: vi.fn(),
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

vi.mock("./BucketOpsBulkUpdateModal", () => ({
  default: () => null,
}));

vi.mock("./BucketOpsRowActionsMenu", () => ({
  default: () => null,
}));

vi.mock("./BucketSelectionActionsBar", () => ({
  default: () => null,
}));

import BucketOpsWorkbench from "./BucketOpsWorkbench";

describe("BucketOpsWorkbench Ceph Admin stats fallback", () => {
  beforeEach(() => {
    mocks.listCephAdminBuckets.mockReset();
    mocks.streamCephAdminBuckets.mockReset();
    mocks.noopAsync.mockClear();
    mocks.navigate.mockReset();
    window.localStorage.clear();
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

    expect(await screen.findByText(/Bucket stats are unavailable via Ceph Admin credentials/i)).toBeInTheDocument();

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
});
