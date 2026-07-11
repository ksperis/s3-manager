import { afterEach, describe, expect, it, vi } from "vitest";

import { streamCephAdminBucketIndexChecks } from "./bucketIndexCheck";

function buildStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
}

describe("Ceph Admin bucket index check stream", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts tenant-aware read-only targets and reports progress", async () => {
    const onProgress = vi.fn();
    const fetchMock = vi.fn(async () =>
      new Response(
        buildStream([
          'event: progress\ndata: {"stage":"completed","bucket_name":"bucket-a","tenant":"tenant-a","total_buckets":1,"completed_buckets":1,"failed_buckets":0}\n\n',
          'event: result\ndata: {"status":"completed","total_buckets":1,"completed_buckets":1,"failed_buckets":0,"started_at":"2026-01-01T00:00:00Z","finished_at":"2026-01-01T00:00:01Z","buckets":[]}\n\n',
          'event: done\ndata: {"request_id":"r1","status":"completed"}\n\n',
        ]),
        { status: 200, headers: { "content-type": "text/event-stream" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await streamCephAdminBucketIndexChecks(
      7,
      { targets: [{ name: "bucket-a", tenant: "tenant-a" }], parallelism: 4 },
      { onProgress }
    );

    expect(result.status).toBe("completed");
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ bucket_name: "bucket-a", completed_buckets: 1 }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ceph-admin/endpoints/7/bucket-index-check/stream",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ targets: [{ name: "bucket-a", tenant: "tenant-a" }], parallelism: 4 }),
      })
    );
  });
});
