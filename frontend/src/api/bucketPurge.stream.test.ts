import { afterEach, describe, expect, it, vi } from "vitest";

import {
  streamManagerBucketDeleteWithPurge,
  streamManagerBucketPurge,
  streamStorageOpsBucketPurge,
} from "./bucketPurge";

function buildStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
}

describe("bucket purge streams", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts manager payload and parses progress/result events", async () => {
    const progressEvents: Array<{ deleted: number; listed: number }> = [];
    const payload = {
      buckets: ["bucket-a"],
      parallelism: 4,
      include_versions: true,
      confirmation: "PURGE 1 BUCKETS",
    };
    const responseBody = buildStream([
      'event: progress\ndata: {"stage":"delete","total_buckets":1,"completed_buckets":0,"listed_objects":2,"listed_versions":1,"deleted_objects":1,"deleted_versions":0,"failed_count":0}\n\n',
      'event: result\ndata: {"status":"completed","total_buckets":1,"completed_buckets":1,"listed_objects":2,"listed_versions":1,"deleted_objects":2,"deleted_versions":1,"failed_count":0,"started_at":"2026-01-01T00:00:00Z","finished_at":"2026-01-01T00:00:01Z","buckets":[]}\n\n',
      'event: done\ndata: {"request_id":"r1"}\n\n',
    ]);
    const fetchMock = vi.fn(async () => {
      return new Response(responseBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await streamManagerBucketPurge("s3u-1", payload, {
      onProgress: (event) =>
        progressEvents.push({
          deleted: event.deleted_objects + event.deleted_versions,
          listed: event.listed_objects + event.listed_versions,
        }),
    });

    expect(result.status).toBe("completed");
    expect(progressEvents).toEqual([{ deleted: 1, listed: 3 }]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/manager/bucket-purge/stream?account_id=s3u-1",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(payload),
      })
    );
  });

  it("posts storage ops targets to its surface", async () => {
    const resultPayload =
      'event: result\ndata: {"status":"completed_with_errors","total_buckets":1,"completed_buckets":1,"listed_objects":0,"listed_versions":0,"deleted_objects":0,"deleted_versions":0,"failed_count":1,"started_at":"2026-01-01T00:00:00Z","finished_at":"2026-01-01T00:00:01Z","buckets":[]}\n\n';
    const fetchMock = vi.fn(async () => {
      return new Response(buildStream([resultPayload, 'event: done\ndata: {"request_id":"r1"}\n\n']), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await streamStorageOpsBucketPurge({
      targets: [{ context_id: "s3u-1", bucket_name: "bucket-a" }],
      confirmation: "PURGE 1 BUCKETS",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/storage-ops/buckets/purge/stream",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          targets: [{ context_id: "s3u-1", bucket_name: "bucket-a" }],
          confirmation: "PURGE 1 BUCKETS",
        }),
      })
    );
  });

  it("posts manager bucket delete with purge payload and parses bucket deletion result", async () => {
    const payload = {
      parallelism: 6,
      confirmation: "DELETE BUCKET bucket-a",
    };
    const responseBody = buildStream([
      'event: progress\ndata: {"stage":"delete_bucket","total_buckets":1,"completed_buckets":0,"listed_objects":2,"listed_versions":1,"deleted_objects":2,"deleted_versions":1,"failed_count":0,"bucket_deleted":false}\n\n',
      'event: result\ndata: {"status":"completed","total_buckets":1,"completed_buckets":1,"listed_objects":2,"listed_versions":1,"deleted_objects":2,"deleted_versions":1,"failed_count":0,"bucket_deleted":true,"started_at":"2026-01-01T00:00:00Z","finished_at":"2026-01-01T00:00:01Z","buckets":[]}\n\n',
    ]);
    const fetchMock = vi.fn(async () => {
      return new Response(responseBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await streamManagerBucketDeleteWithPurge("s3u-1", "bucket-a", payload);

    expect(result.bucket_deleted).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/manager/buckets/bucket-a/delete/stream?account_id=s3u-1",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(payload),
      })
    );
  });
});
