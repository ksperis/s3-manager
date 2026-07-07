import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BucketUsageStatsProgress, BucketUsageStatsResult } from "../../api/bucketUsageStats";
import BucketUsageStatsRunModal from "./BucketUsageStatsRunModal";

const streamCephAdminBucketUsageStatsMock = vi.fn();
const streamStorageOpsBucketUsageStatsMock = vi.fn();

vi.mock("../../api/bucketUsageStats", async () => {
  const actual = await vi.importActual<typeof import("../../api/bucketUsageStats")>("../../api/bucketUsageStats");
  return {
    ...actual,
    streamCephAdminBucketUsageStats: (...args: unknown[]) => streamCephAdminBucketUsageStatsMock(...args),
    streamStorageOpsBucketUsageStats: (...args: unknown[]) => streamStorageOpsBucketUsageStatsMock(...args),
  };
});

function buildUsageStatsResult(): BucketUsageStatsResult {
  return {
    status: "completed",
    total_buckets: 4,
    completed_buckets: 4,
    failed_buckets: 0,
    listed_versions: 12,
    listed_delete_markers: 2,
    total_bytes: 2048,
    started_at: "2026-01-01T00:00:00Z",
    finished_at: "2026-01-01T00:00:03Z",
    buckets: [],
  };
}

describe("BucketUsageStatsRunModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamCephAdminBucketUsageStatsMock.mockResolvedValue(buildUsageStatsResult());
    streamStorageOpsBucketUsageStatsMock.mockResolvedValue(buildUsageStatsResult());
  });

  it("renders streamed progress with an accessible progressbar", async () => {
    const progressEvent: BucketUsageStatsProgress = {
      request_id: "progress-1",
      stage: "list",
      bucket_name: "bucket-a",
      context_id: "ctx-1",
      context_name: "Context 1",
      total_buckets: 4,
      completed_buckets: 1,
      listed_versions: 12,
      listed_delete_markers: 2,
      total_bytes: 2048,
    };
    streamStorageOpsBucketUsageStatsMock.mockImplementationOnce(async (...args: unknown[]) => {
      const options = args[1] as { onProgress?: (event: BucketUsageStatsProgress) => void };
      options.onProgress?.(progressEvent);
      return buildUsageStatsResult();
    });

    const user = userEvent.setup();
    render(
      <BucketUsageStatsRunModal
        mode="storage-ops"
        targets={[{ contextId: "ctx-1", contextName: "Context 1", bucketName: "bucket-a" }]}
        onClose={() => undefined}
      />
    );

    const runButton = screen.getByRole("button", { name: "Run calculation" });
    expect(runButton).toHaveClass("ui-button-base");
    await user.click(runButton);

    expect(await screen.findByText("bucket-a - list")).toBeInTheDocument();
    expect(screen.getByText("12 version(s) - 2.0 KB")).toBeInTheDocument();
    expect(screen.getByText("1 / 4 buckets completed - 2 delete markers")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Bucket usage stats progress" })).toHaveAttribute(
      "aria-valuenow",
      "25"
    );
  });
});
