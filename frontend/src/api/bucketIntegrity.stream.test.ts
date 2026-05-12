import { afterEach, describe, expect, it, vi } from "vitest";

import {
  streamManagerBucketIntegrityCheck,
  streamCephAdminBucketIntegrityCheck,
  streamStorageOpsBucketIntegrityCheck,
} from "./bucketIntegrity";

function buildStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
}

describe("bucket integrity streams", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts manager payload and parses progress/result events", async () => {
    const progressEvents: Array<{ checked: number; listed: number }> = [];
    const responseBody = buildStream([
      'event: progress\ndata: {"stage":"verify","total_buckets":1,"completed_buckets":0,"listed_count":2,"checked_count":1,"failed_count":0,"bytes_read":12}\n\n',
      'event: result\ndata: {"status":"passed","total_buckets":1,"completed_buckets":1,"listed_count":2,"checked_count":2,"failed_count":0,"bytes_read":24,"started_at":"2026-01-01T00:00:00Z","finished_at":"2026-01-01T00:00:01Z","buckets":[]}\n\n',
      'event: done\ndata: {"request_id":"r1"}\n\n',
    ]);
    const fetchMock = vi.fn(async () => {
      return new Response(responseBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await streamManagerBucketIntegrityCheck(
      "s3u-1",
      { buckets: ["bucket-a"], parallelism: 4, all_versions: true },
      {
        onProgress: (event) => progressEvents.push({ checked: event.checked_count, listed: event.listed_count }),
      }
    );

    expect(result.status).toBe("passed");
    expect(progressEvents).toEqual([{ checked: 1, listed: 2 }]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/manager/bucket-integrity/stream?account_id=s3u-1",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ buckets: ["bucket-a"], parallelism: 4, all_versions: true }),
      })
    );
  });

  it("posts ceph admin and storage ops targets to their surfaces", async () => {
    const resultPayload =
      'event: result\ndata: {"status":"completed_with_errors","total_buckets":1,"completed_buckets":1,"listed_count":0,"checked_count":0,"failed_count":1,"bytes_read":0,"started_at":"2026-01-01T00:00:00Z","finished_at":"2026-01-01T00:00:01Z","buckets":[]}\n\n';
    const fetchMock = vi.fn(async () => {
      return new Response(buildStream([resultPayload, 'event: done\ndata: {"request_id":"r1"}\n\n']), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await streamCephAdminBucketIntegrityCheck(7, { buckets: ["bucket-a"] });
    await streamStorageOpsBucketIntegrityCheck({ targets: [{ context_id: "s3u-1", bucket_name: "bucket-a" }] });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/ceph-admin/endpoints/7/buckets/integrity-check/stream",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/storage-ops/buckets/integrity-check/stream",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ targets: [{ context_id: "s3u-1", bucket_name: "bucket-a" }] }),
      })
    );
  });
});
