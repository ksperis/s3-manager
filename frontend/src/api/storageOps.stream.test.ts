import { afterEach, describe, expect, it, vi } from "vitest";

import { streamStorageOpsBuckets } from "./storageOps";

function buildStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
}

describe("streamStorageOpsBuckets", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses progress and result events across partial chunks", async () => {
    const progressEvents: Array<{ percent: number; stage: string; processed: number; total: number }> = [];
    const responseBody = buildStream([
      "event: progress\n",
      'data: {"request_id":"r1","percent":12,"stage":"scan_entries","processed":1,"total":10}\n\n',
      "event: progress\n",
      'data: {"request_id":"r1","percent":57,"stage":"expensive_filters","processed":7,"total":10}\n\n',
      "event: result\n",
      'data: {"items":[{"name":"s3u-1::bucket-a","bucket_name":"bucket-a","context_id":"s3u-1","context_name":"User 1","context_kind":"s3_user"}],"total":1,"page":1,"page_size":25,"has_next":false}\n\n',
      "event: done\n",
      'data: {"request_id":"r1"}\n\n',
    ]);
    const fetchMock = vi.fn(async () => {
      return new Response(responseBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await streamStorageOpsBuckets(
      1,
      { page: 1, page_size: 25, advanced_filter: '{"match":"all","rules":[]}' },
      {
        onProgress: (event) =>
          progressEvents.push({
            percent: event.percent,
            stage: event.stage,
            processed: event.processed,
            total: event.total,
          }),
      }
    );

    expect(progressEvents).toEqual([
      { percent: 12, stage: "scan_entries", processed: 1, total: 10 },
      { percent: 57, stage: "expensive_filters", processed: 7, total: 10 },
    ]);
    expect(result.total).toBe(1);
    expect(result.items.map((item) => item.bucket_name)).toEqual(["bucket-a"]);
  });

  it("throws when stream emits an error event", async () => {
    const responseBody = buildStream([
      "event: progress\n",
      'data: {"request_id":"r2","percent":33,"stage":"scan_entries","processed":3,"total":9}\n\n',
      "event: error\n",
      'data: {"request_id":"r2","detail":"backend timeout"}\n\n',
      "event: done\n",
      'data: {"request_id":"r2"}\n\n',
    ]);
    const fetchMock = vi.fn(async () => {
      return new Response(responseBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      streamStorageOpsBuckets(1, { page: 1, page_size: 25, advanced_filter: '{"match":"all","rules":[]}' })
    ).rejects.toThrow("backend timeout");
  });

  it("redacts sensitive stream error details", async () => {
    const responseBody = buildStream([
      "event: error\n",
      'data: {"detail":"failed against https://rgw.internal.local:7480 with token=secret-token and access_key=AKIAIOSFODNN7EXAMPLE"}\n\n',
    ]);
    const fetchMock = vi.fn(async () => {
      return new Response(responseBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      streamStorageOpsBuckets(1, { page: 1, page_size: 25, advanced_filter: '{"match":"all","rules":[]}' })
    ).rejects.toThrow("failed against [redacted-url] with token=[redacted] and access_key=[redacted]");
  });
});
