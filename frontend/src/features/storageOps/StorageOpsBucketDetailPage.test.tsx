import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listStorageOpsBuckets: vi.fn(),
  listExecutionContexts: vi.fn(),
}));

vi.mock("../../api/storageOps", () => ({
  STORAGE_OPS_SCOPE_ID: 1,
  listStorageOpsBuckets: mocks.listStorageOpsBuckets,
}));

vi.mock("../../api/executionContexts", () => ({
  listExecutionContexts: mocks.listExecutionContexts,
}));

vi.mock("../manager/BucketDetailPage", () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="bucket-detail" data-props={JSON.stringify(props)}>
      Loaded bucket detail
    </div>
  ),
}));

import StorageOpsBucketDetailPage from "./StorageOpsBucketDetailPage";

function BucketListMarker() {
  const navigate = useNavigate();
  return (
    <div>
      <p>Bucket list</p>
      <button type="button" onClick={() => navigate(1)}>
        Forward
      </button>
    </div>
  );
}

function renderRoute(initialEntry: string | { pathname: string; search?: string; state?: unknown }) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/storage-ops/buckets/:bucketName" element={<StorageOpsBucketDetailPage />} />
        <Route path="/storage-ops/buckets" element={<BucketListMarker />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("StorageOpsBucketDetailPage", () => {
  beforeEach(() => {
    mocks.listStorageOpsBuckets.mockReset();
    mocks.listExecutionContexts.mockReset();
    mocks.listExecutionContexts.mockResolvedValue([
      {
        id: "account-1",
        kind: "account",
        display_name: "Account A",
        tags: [],
        endpoint_tags: [],
        capabilities: { can_manage_iam: true, sts_capable: false, admin_api_capable: true },
      },
    ]);
  });

  it("validates the explicit context and renders the shared bucket detail", async () => {
    mocks.listStorageOpsBuckets.mockResolvedValue({
      items: [
        {
          name: "account-1::bucket-a",
          bucket_name: "bucket-a",
          context_id: "account-1",
          context_name: "Account A",
          context_kind: "account",
          bucket_quota_available: true,
        },
      ],
      total: 1,
      page: 1,
      page_size: 1,
      has_next: false,
    });

    renderRoute("/storage-ops/buckets/bucket-a?ctx=account-1");

    expect(await screen.findByText("Loaded bucket detail")).toBeInTheDocument();
    expect(mocks.listStorageOpsBuckets).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        page: 1,
        page_size: 1,
        with_stats: false,
        advanced_filter: expect.any(String),
      }),
      { signal: expect.any(AbortSignal) }
    );
    expect(mocks.listExecutionContexts).toHaveBeenCalledWith("manager", { signal: expect.any(AbortSignal) });
    const advancedFilter = JSON.parse(mocks.listStorageOpsBuckets.mock.calls[0][1].advanced_filter) as {
      rules: Array<Record<string, unknown>>;
    };
    expect(advancedFilter.rules).toEqual([
      { field: "context_id", op: "eq", value: "account-1" },
      { field: "name", op: "eq", value: "bucket-a" },
    ]);
    const props = JSON.parse(screen.getByTestId("bucket-detail").dataset.props ?? "{}") as Record<string, unknown>;
    expect(props).toMatchObject({
      mode: "manager",
      bucketNameOverride: "bucket-a",
      accountIdOverride: "account-1",
      quotaAvailableOverride: true,
      embedded: true,
      hideObjectsTab: true,
    });
  });

  it("requires ctx without falling back to another execution context", async () => {
    renderRoute("/storage-ops/buckets/bucket-a");

    expect(screen.getByRole("heading", { name: "Execution context required" })).toBeInTheDocument();
    expect(mocks.listStorageOpsBuckets).not.toHaveBeenCalled();
    expect(mocks.listExecutionContexts).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "Back to buckets" })[0]);
    expect(await screen.findByText("Bucket list")).toBeInTheDocument();
  });

  it("shows an explicit state when the execution context is no longer available", async () => {
    mocks.listExecutionContexts.mockResolvedValue([]);
    mocks.listStorageOpsBuckets.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 1,
      has_next: false,
    });

    renderRoute("/storage-ops/buckets/bucket-a?ctx=missing-context");

    expect(await screen.findByRole("heading", { name: "Execution context unavailable" })).toBeInTheDocument();
  });

  it("shows an explicit not-found state for a missing bucket", async () => {
    mocks.listStorageOpsBuckets.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 1,
      has_next: false,
    });

    renderRoute("/storage-ops/buckets/missing?ctx=account-1");

    expect(await screen.findByRole("heading", { name: "Bucket not found" })).toBeInTheDocument();
  });

  it("shows an explicit unavailable state when validation is denied", async () => {
    mocks.listStorageOpsBuckets.mockRejectedValue({
      isAxiosError: true,
      response: { status: 403, data: { detail: "Storage Ops access denied" } },
    });

    renderRoute("/storage-ops/buckets/bucket-a?ctx=account-1");

    expect(await screen.findByRole("heading", { name: "Bucket configuration unavailable" })).toBeInTheDocument();
    expect(screen.getByText("Storage Ops access denied")).toBeInTheDocument();
  });

  it("uses the list history origin for breadcrumbs and the return action", async () => {
    mocks.listStorageOpsBuckets.mockResolvedValue({
      items: [
        {
          name: "account-1::bucket-a",
          bucket_name: "bucket-a",
          context_id: "account-1",
          context_name: "Account A",
          context_kind: "account",
          bucket_quota_available: false,
        },
      ],
      total: 1,
      page: 1,
      page_size: 1,
      has_next: false,
    });

    render(
      <MemoryRouter
        initialEntries={[
          "/storage-ops/buckets?owner=tenant-a",
          {
            pathname: "/storage-ops/buckets/bucket-a",
            search: "?ctx=account-1",
            state: {
              bucketListOrigin: {
                surface: "storage-ops",
                scopeKey: "storage-ops",
                listUrl: "/storage-ops/buckets?owner=tenant-a",
              },
            },
          },
        ]}
        initialIndex={1}
      >
        <Routes>
          <Route path="/storage-ops/buckets/:bucketName" element={<StorageOpsBucketDetailPage />} />
          <Route path="/storage-ops/buckets" element={<BucketListMarker />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText("Loaded bucket detail");
    expect(screen.getByRole("link", { name: "Buckets" })).toHaveAttribute(
      "href",
      "/storage-ops/buckets?owner=tenant-a"
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to buckets" }));
    await waitFor(() => expect(screen.getByText("Bucket list")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    await waitFor(() => expect(screen.getByText("Loaded bucket detail")).toBeInTheDocument());
  });
});
