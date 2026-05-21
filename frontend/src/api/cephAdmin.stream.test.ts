import { afterEach, describe, expect, it, vi } from "vitest";

import { streamCephAdminAccounts, streamCephAdminBuckets, streamCephAdminUsers } from "./cephAdmin";

function buildStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
}

describe("streamCephAdminBuckets", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses progress and result events across partial chunks", async () => {
    const progressEvents: Array<{ percent: number; stage: string }> = [];
    const responseBody = buildStream([
      "event: progress\n",
      "data: {\"request_id\":\"r1\",\"percent\":12,\"stage\":\"scan_entries\",\"processed\":1,\"total\":10}\n\n",
      "event: progress\n",
      "data: {\"request_id\":\"r1\",\"percent\":57,\"stage\":\"expensive_filters\",\"processed\":7,\"total\":10}\n\n",
      "event: result\n",
      "data: {\"items\":[{\"name\":\"bucket-a\"}],\"total\":1,\"page\":1,\"page_size\":25,\"has_next\":false}\n\n",
      "event: done\n",
      "data: {\"request_id\":\"r1\"}\n\n",
    ]);
    const fetchMock = vi.fn(async () => {
      return new Response(responseBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await streamCephAdminBuckets(
      7,
      { page: 1, page_size: 25, advanced_filter: '{"match":"all","rules":[]}' },
      {
        onProgress: (event) => progressEvents.push({ percent: event.percent, stage: event.stage }),
      }
    );

    expect(progressEvents).toEqual([
      { percent: 12, stage: "scan_entries" },
      { percent: 57, stage: "expensive_filters" },
    ]);
    expect(result.total).toBe(1);
    expect(result.items.map((item) => item.name)).toEqual(["bucket-a"]);
  });

  it("throws when stream emits an error event", async () => {
    const responseBody = buildStream([
      "event: progress\n",
      "data: {\"request_id\":\"r2\",\"percent\":33,\"stage\":\"scan_entries\",\"processed\":3,\"total\":9}\n\n",
      "event: error\n",
      "data: {\"request_id\":\"r2\",\"detail\":\"backend timeout\"}\n\n",
      "event: done\n",
      "data: {\"request_id\":\"r2\"}\n\n",
    ]);
    const fetchMock = vi.fn(async () => {
      return new Response(responseBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      streamCephAdminBuckets(7, { page: 1, page_size: 25, advanced_filter: '{"match":"all","rules":[]}' })
    ).rejects.toThrow("backend timeout");
  });
});

describe("ceph-admin RGW entity listing streams", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses account listing progress and result events", async () => {
    const progressEvents: Array<{ percent: number; stage: string }> = [];
    const responseBody = buildStream([
      "event: progress\n",
      "data: {\"request_id\":\"r3\",\"percent\":65,\"stage\":\"expensive_filters\",\"processed\":1,\"total\":1}\n\n",
      "event: result\n",
      "data: {\"items\":[{\"account_id\":\"RGW01\"}],\"total\":1,\"page\":1,\"page_size\":25,\"has_next\":false}\n\n",
      "event: done\n",
      "data: {\"request_id\":\"r3\"}\n\n",
    ]);
    const fetchMock = vi.fn(async () => {
      return new Response(responseBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await streamCephAdminAccounts(
      7,
      { page: 1, page_size: 25, advanced_filter: '{"match":"all","rules":[]}' },
      {
        onProgress: (event) => progressEvents.push({ percent: event.percent, stage: event.stage }),
      }
    );

    expect(progressEvents).toEqual([{ percent: 65, stage: "expensive_filters" }]);
    expect(result.items.map((item) => item.account_id)).toEqual(["RGW01"]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/ceph-admin/endpoints/7/accounts/stream?"),
      expect.objectContaining({ method: "GET" })
    );
  });

  it("parses user listing progress and result events", async () => {
    const progressEvents: Array<{ percent: number; stage: string }> = [];
    const responseBody = buildStream([
      "event: progress\n",
      "data: {\"request_id\":\"r4\",\"percent\":50,\"stage\":\"detail_enrichment\",\"processed\":0,\"total\":2}\n\n",
      "event: result\n",
      "data: {\"items\":[{\"uid\":\"alice\"}],\"total\":1,\"page\":1,\"page_size\":25,\"has_next\":false}\n\n",
      "event: done\n",
      "data: {\"request_id\":\"r4\"}\n\n",
    ]);
    const fetchMock = vi.fn(async () => {
      return new Response(responseBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await streamCephAdminUsers(
      7,
      { page: 1, page_size: 25, advanced_filter: '{"match":"all","rules":[]}' },
      {
        onProgress: (event) => progressEvents.push({ percent: event.percent, stage: event.stage }),
      }
    );

    expect(progressEvents).toEqual([{ percent: 50, stage: "detail_enrichment" }]);
    expect(result.items.map((item) => item.uid)).toEqual(["alice"]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/ceph-admin/endpoints/7/users/stream?"),
      expect.objectContaining({ method: "GET" })
    );
  });
});
