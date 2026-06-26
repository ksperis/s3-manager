import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  backupCephAdminBucketConfigs: vi.fn(),
  listCephAdminBuckets: vi.fn(),
  streamCephAdminBuckets: vi.fn(),
  refreshCephAdminBucketListingCache: vi.fn(),
  refreshStorageOpsBucketListingCache: vi.fn(),
  listStorageOpsBuckets: vi.fn(),
  streamStorageOpsBuckets: vi.fn(),
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
  backupCephAdminBucketConfigs: mocks.backupCephAdminBucketConfigs,
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
  updateStorageOpsBucketQuota: mocks.noopAsync,
}));

vi.mock("../cephAdmin/CephAdminEndpointContext", () => ({
  useCephAdminEndpoint: () => ({
    selectedEndpointId: 7,
    selectedEndpoint: {
      id: 7,
      name: "Archive",
      capabilities: { metrics: false, static_website: true, sns: true, sse: true },
      tags: [],
    },
    endpoints: [],
  }),
}));

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    generalSettings: {
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
  default: ({
    open,
    children,
  }: {
    open: boolean;
    children: ReactNode;
  }) => (open ? <div role="dialog" aria-label="Bulk update">{children}</div> : null),
}));

vi.mock("./BucketOpsRowActionsMenu", () => ({
  default: () => null,
}));

vi.mock("./BucketSelectionActionsBar", () => ({
  default: ({
    exportSelectedBuckets,
    onShowConfigBackupModal,
    selectionActionProgress,
    openBulkUpdateModal,
  }: {
    exportSelectedBuckets: (format: "text" | "csv" | "json") => Promise<void> | void;
    onShowConfigBackupModal?: () => void;
    selectionActionProgress?: { label: string; completed: number; total: number } | null;
    openBulkUpdateModal: () => void;
  }) => (
    <div>
      <button type="button" onClick={() => void exportSelectedBuckets("csv")}>
        Trigger CSV export
      </button>
      <button type="button" onClick={openBulkUpdateModal}>
        Trigger bulk update
      </button>
      {onShowConfigBackupModal ? (
        <button type="button" onClick={onShowConfigBackupModal}>
          Trigger config backup
        </button>
      ) : null}
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
    mocks.backupCephAdminBucketConfigs.mockReset();
    mocks.listCephAdminBuckets.mockReset();
    mocks.streamCephAdminBuckets.mockReset();
    mocks.listStorageOpsBuckets.mockReset();
    mocks.streamStorageOpsBuckets.mockReset();
    mocks.refreshCephAdminBucketListingCache.mockReset();
    mocks.refreshStorageOpsBucketListingCache.mockReset();
    mocks.refreshCephAdminBucketListingCache.mockResolvedValue({ refreshed: true });
    mocks.refreshStorageOpsBucketListingCache.mockResolvedValue({ refreshed: true });
    mocks.backupCephAdminBucketConfigs.mockResolvedValue({
      kind: "ceph-admin.bucket-config-backup",
      version: 1,
      generated_at: "2026-05-26T10:00:00Z",
      source: { surface: "ceph-admin", endpoint_id: 7, endpoint_name: "Archive" },
      features: ["quota", "versioning"],
      buckets: [],
    });
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

  it("backs up selected bucket configs and downloads the JSON payload", async () => {
    const allBuckets = buildBuckets(1);
    mocks.listCephAdminBuckets.mockImplementation(createBucketListMock(allBuckets));

    render(
      <MemoryRouter>
        <BucketOpsWorkbench mode="ceph-admin" shell={{ pageDescription: "Ceph buckets" }} />
      </MemoryRouter>
    );

    expect(await screen.findByText("bucket-001")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    fireEvent.click(screen.getByRole("button", { name: "Trigger config backup" }));

    expect(await screen.findByRole("dialog", { name: "Backup bucket configs" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download JSON" }));

    await waitFor(() => expect(mocks.backupCephAdminBucketConfigs).toHaveBeenCalledTimes(1));
    expect(mocks.backupCephAdminBucketConfigs).toHaveBeenCalledWith(7, {
      buckets: ["bucket-001"],
      features: [
        "quota",
        "versioning",
        "object_lock",
        "public_access_block",
        "lifecycle",
        "cors",
        "policy",
        "access_logging",
        "tags",
      ],
    });
    expect(window.URL.createObjectURL).toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  });

  it("offers bulk notification configuration operations", async () => {
    const allBuckets = buildBuckets(1);
    mocks.listCephAdminBuckets.mockImplementation(createBucketListMock(allBuckets));

    render(
      <MemoryRouter>
        <BucketOpsWorkbench mode="ceph-admin" shell={{ pageDescription: "Ceph buckets" }} />
      </MemoryRouter>
    );

    expect(await screen.findByText("bucket-001")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    fireEvent.click(screen.getByRole("button", { name: "Trigger bulk update" }));

    expect(await screen.findByRole("dialog", { name: "Bulk update" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Add or update notification configurations" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Delete notification configurations" })).toBeInTheDocument();
  });

  it("disables Storage Ops bulk quota updates without privileged Ceph access", async () => {
    mocks.listStorageOpsBuckets.mockResolvedValue({
      items: [{ name: "conn-2::bucket-001", bucket_name: "bucket-001", context_id: "conn-2" }],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
      stats_available: true,
    });

    render(
      <MemoryRouter>
        <BucketOpsWorkbench mode="storage-ops" shell={{ pageDescription: "Storage Ops buckets" }} />
      </MemoryRouter>
    );

    expect(await screen.findByText("bucket-001")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    fireEvent.click(screen.getByRole("button", { name: "Trigger bulk update" }));

    const quotaOption = screen.getByRole("option", {
      name: "Set bucket quota (privileged Ceph access required)",
    }) as HTMLOptionElement;
    expect(quotaOption.disabled).toBe(true);
  });

  it("enables Storage Ops bulk quota updates with privileged Ceph access", async () => {
    window.localStorage.setItem(
      "user",
      JSON.stringify({
        role: "ui_user",
        manager_tool_access: {
          bucket_compare: false,
          bucket_integrity_check: false,
          bucket_migration: false,
          feature_rules: false,
          bucket_quota: true,
          ceph_s3_user_keys: false,
        },
      })
    );
    mocks.listStorageOpsBuckets.mockResolvedValue({
      items: [{ name: "conn-2::bucket-001", bucket_name: "bucket-001", context_id: "conn-2" }],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
      stats_available: true,
    });

    render(
      <MemoryRouter>
        <BucketOpsWorkbench mode="storage-ops" shell={{ pageDescription: "Storage Ops buckets" }} />
      </MemoryRouter>
    );

    expect(await screen.findByText("bucket-001")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    fireEvent.click(screen.getByRole("button", { name: "Trigger bulk update" }));

    const quotaOption = screen.getByRole("option", { name: "Set bucket quota" }) as HTMLOptionElement;
    expect(quotaOption.disabled).toBe(false);
  });

  it("reports Storage Ops bulk quota items without target grants during preview", async () => {
    window.localStorage.setItem(
      "user",
      JSON.stringify({
        role: "ui_user",
        manager_tool_access: {
          bucket_compare: false,
          bucket_integrity_check: false,
          bucket_migration: false,
          feature_rules: false,
          bucket_quota: true,
          ceph_s3_user_keys: false,
        },
      })
    );
    mocks.listStorageOpsBuckets.mockResolvedValue({
      items: [
        {
          name: "conn-2::bucket-001",
          bucket_name: "bucket-001",
          context_id: "conn-2",
          bucket_quota_available: false,
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
      stats_available: true,
    });

    render(
      <MemoryRouter>
        <BucketOpsWorkbench mode="storage-ops" shell={{ pageDescription: "Storage Ops buckets" }} />
      </MemoryRouter>
    );

    expect(await screen.findByText("bucket-001")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    fireEvent.click(screen.getByRole("button", { name: "Trigger bulk update" }));

    const dialog = await screen.findByRole("dialog", { name: "Bulk update" });
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "set_quota" } });
    const quotaInputs = await within(dialog).findAllByPlaceholderText("Leave empty to clear");
    fireEvent.change(quotaInputs[0], { target: { value: "1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Preview" }));

    expect(await screen.findByText("Bucket quota management is not available for this context.")).toBeInTheDocument();
  });
});
