import { afterEach, describe, expect, it, vi } from "vitest";

import {
  streamAdminUsageStatsAggregate,
  streamCephAdminBucketUsageStats,
  streamCephAdminUsageStatsAggregate,
  streamManagerUsageStatsAggregate,
  streamStorageOpsBucketUsageStats,
} from "./bucketUsageStats";

function buildStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
}

describe("bucket usage stats streams", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts ceph admin and storage ops targets to their surfaces", async () => {
    const resultPayload =
      'event: result\ndata: {"status":"completed_with_warnings","total_buckets":1,"completed_buckets":1,"failed_buckets":0,"listed_versions":1,"listed_delete_markers":0,"total_bytes":10,"started_at":"2026-01-01T00:00:00Z","finished_at":"2026-01-01T00:00:01Z","buckets":[]}\n\n';
    const fetchMock = vi.fn(async () => {
      return new Response(buildStream([resultPayload, 'event: done\ndata: {"request_id":"r1"}\n\n']), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await streamCephAdminBucketUsageStats(7, { buckets: ["bucket-a"] });
    await streamStorageOpsBucketUsageStats({ targets: [{ context_id: "s3u-1", bucket_name: "bucket-a" }] });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/ceph-admin/endpoints/7/bucket-usage-stats/stream",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/storage-ops/buckets/usage-stats/stream",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ targets: [{ context_id: "s3u-1", bucket_name: "bucket-a" }] }),
      })
    );
  });

  it("posts scope aggregate calculations to manager, ceph admin, and admin managed surfaces", async () => {
    const resultPayload =
      'event: result\ndata: {"status":"completed","total_buckets":2,"completed_buckets":2,"failed_buckets":0,"listed_versions":3,"listed_delete_markers":1,"total_bytes":128,"started_at":"2026-01-01T00:00:00Z","finished_at":"2026-01-01T00:00:01Z","buckets":[]}\n\n';
    const fetchMock = vi.fn(async () => {
      return new Response(buildStream([resultPayload, 'event: done\ndata: {"request_id":"r1"}\n\n']), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await streamManagerUsageStatsAggregate("s3u-1", { parallelism: 6 });
    await streamCephAdminUsageStatsAggregate(7, { parallelism: 3 });
    await streamAdminUsageStatsAggregate(7, { parallelism: 2 });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/manager/usage-stats/stream?account_id=s3u-1",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ parallelism: 6 }),
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/ceph-admin/endpoints/7/usage-stats/stream",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ parallelism: 3 }),
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/admin/usage-stats/stream?endpoint_id=7",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ parallelism: 2 }),
      })
    );
  });
});
