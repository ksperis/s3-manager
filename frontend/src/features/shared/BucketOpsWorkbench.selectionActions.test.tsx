import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  default: ({
    exportSelectedBuckets,
    selectionActionProgress,
  }: {
    exportSelectedBuckets: (format: "text" | "csv" | "json") => Promise<void> | void;
    selectionActionProgress?: { label: string; completed: number; total: number } | null;
  }) => (
    <div>
      <button type="button" onClick={() => void exportSelectedBuckets("csv")}>
        Trigger CSV export
      </button>
      {selectionActionProgress ? (
        <p>
          {selectionActionProgress.label} · {selectionActionProgress.completed} / {selectionActionProgress.total}
        </p>
      ) : null}
    </div>
  ),
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

function buildBuckets(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    name: `bucket-${String(index + 1).padStart(3, "0")}`,
    owner: `owner-${index + 1}`,
    used_bytes: index + 1,
    object_count: index + 1,
  }));
}

function createBucketListMock(allBuckets: Array<Record<string, unknown>>) {
  return (endpointId: number, params?: Record<string, unknown>) => {
    expect(endpointId).toBe(7);
    const page = Number(params?.page ?? 1);
    const pageSize = Number(params?.page_size ?? 25);
    const filter = typeof params?.filter === "string" ? params.filter.toLowerCase() : "";
    const advancedFilter = typeof params?.advanced_filter === "string" ? params.advanced_filter : undefined;

    let filtered = [...allBuckets];
    if (filter) {
      filtered = filtered.filter((bucket) => String(bucket.name).toLowerCase().includes(filter));
    }
    if (advancedFilter) {
      const parsed = JSON.parse(advancedFilter) as { rules?: Array<{ field?: string; op?: string; value?: unknown }> };
      const nameRule = parsed.rules?.find((rule) => rule.field === "name" && rule.op === "in");
      if (nameRule && Array.isArray(nameRule.value)) {
        const allowed = new Set(nameRule.value.map((value) => String(value)));
        filtered = filtered.filter((bucket) => allowed.has(String(bucket.name)));
      }
    }

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);
    return Promise.resolve({
      items,
      total,
      page,
      page_size: pageSize,
      has_next: start + pageSize < total,
      stats_available: true,
    });
  };
}

describe("BucketOpsWorkbench selection actions", () => {
  beforeEach(() => {
    mocks.listCephAdminBuckets.mockReset();
    mocks.streamCephAdminBuckets.mockReset();
    mocks.noopAsync.mockClear();
    mocks.navigate.mockReset();
    window.localStorage.clear();
    vi.restoreAllMocks();
    Object.defineProperty(window.URL, "createObjectURL", {
      value: vi.fn(() => "blob:test"),
      writable: true,
    });
    Object.defineProperty(window.URL, "revokeObjectURL", {
      value: vi.fn(),
      writable: true,
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  it("shows determinate progress while select-all resolves long filtered results", async () => {
    const allBuckets = buildBuckets(250);
    const deferred = createDeferred<{
      items: Array<Record<string, unknown>>;
      total: number;
      page: number;
      page_size: number;
      has_next: boolean;
      stats_available: boolean;
    }>();

    mocks.listCephAdminBuckets.mockImplementation((endpointId: number, params?: Record<string, unknown>) => {
      expect(endpointId).toBe(7);
      const pageSize = Number(params?.page_size ?? 25);
      const page = Number(params?.page ?? 1);
      if (pageSize === 25) {
        return Promise.resolve({
          items: allBuckets.slice(0, 25),
          total: allBuckets.length,
          page: 1,
          page_size: 25,
          has_next: true,
          stats_available: true,
        });
      }
      if (pageSize === 200 && page === 1) {
        return Promise.resolve({
          items: allBuckets.slice(0, 200),
          total: allBuckets.length,
          page: 1,
          page_size: 200,
          has_next: true,
          stats_available: true,
        });
      }
      if (pageSize === 200 && page === 2) {
        return deferred.promise;
      }
      throw new Error(`Unexpected list call: ${JSON.stringify(params)}`);
    });

    render(
      <MemoryRouter>
        <BucketOpsWorkbench mode="ceph-admin" shell={{ pageDescription: "Ceph buckets" }} />
      </MemoryRouter>
    );

    expect(await screen.findByText("bucket-001")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Select all filtered buckets"));

    await waitFor(() => expect(mocks.listCephAdminBuckets).toHaveBeenCalledTimes(3));
    expect(await screen.findByText("Selecting filtered buckets · 200 / 250")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();

    deferred.resolve({
      items: allBuckets.slice(200),
      total: allBuckets.length,
      page: 2,
      page_size: 200,
      has_next: false,
      stats_available: true,
    });

    await waitFor(() => expect(screen.queryByText("Selecting filtered buckets · 200 / 250")).not.toBeInTheDocument());
  });

  it("reuses the current filtered query for full-selection CSV export and only requests needed includes", async () => {
    const allBuckets = buildBuckets(3);
    mocks.listCephAdminBuckets.mockImplementation(createBucketListMock(allBuckets));

    render(
      <MemoryRouter>
        <BucketOpsWorkbench mode="ceph-admin" shell={{ pageDescription: "Ceph buckets" }} />
      </MemoryRouter>
    );

    expect(await screen.findByText("bucket-001")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Quick filter"), {
      target: { value: "bucket-00" },
    });

    await waitFor(() =>
      expect(mocks.listCephAdminBuckets).toHaveBeenLastCalledWith(
        7,
        expect.objectContaining({ filter: "bucket-00" }),
        expect.any(Object)
      )
    );

    fireEvent.click(screen.getByLabelText("Select all filtered buckets"));
    await waitFor(() => expect(screen.getByLabelText("Select all filtered buckets")).toBeChecked());

    mocks.listCephAdminBuckets.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Trigger CSV export" }));

    await waitFor(() => expect(mocks.listCephAdminBuckets).toHaveBeenCalled());
    expect(mocks.listCephAdminBuckets).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        page: 1,
        page_size: 200,
        filter: "bucket-00",
        advanced_filter: undefined,
        include: undefined,
        with_stats: true,
      })
    );
    const exportCalls = mocks.listCephAdminBuckets.mock.calls.map(([, params]) => params);
    expect(exportCalls).toHaveLength(1);
    expect(String(exportCalls[0]?.advanced_filter ?? "")).not.toContain('"op":"in"');
  });

  it("keeps exact-name chunk export for partial selections", async () => {
    const allBuckets = buildBuckets(3);
    mocks.listCephAdminBuckets.mockImplementation(createBucketListMock(allBuckets));

    render(
      <MemoryRouter>
        <BucketOpsWorkbench mode="ceph-admin" shell={{ pageDescription: "Ceph buckets" }} />
      </MemoryRouter>
    );

    expect(await screen.findByText("bucket-001")).toBeInTheDocument();

    const rowCheckboxes = screen.getAllByRole("checkbox").slice(1);
    fireEvent.click(rowCheckboxes[0]);
    fireEvent.click(rowCheckboxes[1]);

    mocks.listCephAdminBuckets.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Trigger CSV export" }));

    await waitFor(() => expect(mocks.listCephAdminBuckets).toHaveBeenCalled());
    expect(mocks.listCephAdminBuckets).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        page: 1,
        page_size: 200,
        advanced_filter: expect.stringContaining('"op":"in"'),
        with_stats: true,
      })
    );
  });
});
