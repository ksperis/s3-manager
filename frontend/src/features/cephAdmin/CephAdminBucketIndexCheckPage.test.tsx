import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  streamCephAdminBucketIndexChecks: vi.fn(),
}));

vi.mock("../../api/bucketIndexCheck", async () => {
  const actual = await vi.importActual<typeof import("../../api/bucketIndexCheck")>("../../api/bucketIndexCheck");
  return { ...actual, streamCephAdminBucketIndexChecks: mocks.streamCephAdminBucketIndexChecks };
});

import CephAdminBucketIndexCheckPage from "./CephAdminBucketIndexCheckPage";

describe("CephAdminBucketIndexCheckPage", () => {
  it("runs read-only tenant-aware index checks and renders partial failures", async () => {
    mocks.streamCephAdminBucketIndexChecks.mockResolvedValue({
      status: "completed_with_errors",
      total_buckets: 2,
      completed_buckets: 2,
      failed_buckets: 1,
      started_at: "2026-01-01T00:00:00Z",
      finished_at: "2026-01-01T00:00:01Z",
      buckets: [
        { name: "bucket-a", tenant: "tenant-a", status: "completed", duration_seconds: 0.1, operation: "check_bucket_index", message: "index clean" },
        { name: "bucket-b", status: "failed", duration_seconds: 0.2, operation: "check_bucket_index", message: "index mismatch" },
      ],
    });

    render(
      <MemoryRouter>
        <CephAdminBucketIndexCheckPage
          endpointId={7}
          endpointName="Lab"
          targets={[{ name: "bucket-a", tenant: "tenant-a" }, { name: "bucket-b" }]}
          onClose={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(screen.getByText(/bulk action is read-only/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run index checks" }));

    await waitFor(() => expect(mocks.streamCephAdminBucketIndexChecks).toHaveBeenCalledTimes(1));
    expect(mocks.streamCephAdminBucketIndexChecks).toHaveBeenCalledWith(
      7,
      { targets: [{ name: "bucket-a", tenant: "tenant-a" }, { name: "bucket-b" }], parallelism: 4 },
      expect.objectContaining({ signal: expect.any(AbortSignal), onProgress: expect.any(Function) })
    );
    expect(await screen.findByText("index mismatch")).toBeInTheDocument();
    expect(screen.getByText("1 bucket index check failed.")).toBeInTheDocument();
  });
});
