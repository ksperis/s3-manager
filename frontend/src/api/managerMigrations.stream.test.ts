import { afterEach, describe, expect, it, vi } from "vitest";

import { streamManagerMigration } from "./managerMigrations";

function buildStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
}

const SAMPLE_DETAIL = {
  id: 11,
  created_by_user_id: 1,
  source_context_id: "src-ctx",
  target_context_id: "tgt-ctx",
  mode: "one_shot",
  copy_bucket_settings: true,
  delete_source: false,
  strong_integrity_check: false,
  lock_target_writes: true,
  use_same_endpoint_copy: false,
  auto_grant_source_read_for_copy: false,
  webhook_url: null,
  mapping_prefix: "",
  status: "running",
  pause_requested: false,
  cancel_requested: false,
  precheck_status: "passed",
  precheck_report: null,
  precheck_checked_at: null,
  parallelism_max: 8,
  total_items: 1,
  completed_items: 0,
  failed_items: 0,
  skipped_items: 0,
  awaiting_items: 0,
  error_message: null,
  started_at: "2026-03-03T10:00:00Z",
  finished_at: null,
  last_heartbeat_at: "2026-03-03T10:00:05Z",
  created_at: "2026-03-03T10:00:00Z",
  updated_at: "2026-03-03T10:00:05Z",
  items: [],
  recent_events: [],
} as const;

describe("streamManagerMigration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses snapshot and done events across partial chunks", async () => {
    const snapshots: Array<{ id: number; status: string }> = [];
    const doneEvents: Array<{ migration_id: number; status: string; reason: string }> = [];
    const responseBody = buildStream([
      "event: snapshot\n",
      `data: ${JSON.stringify(SAMPLE_DETAIL)}\n\n`,
      "event: done\n",
      'data: {"migration_id":11,"status":"completed","reason":"final_state"}\n\n',
    ]);
    const fetchMock = vi.fn(async () => {
      return new Response(responseBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await streamManagerMigration(11, {
      onSnapshot: (detail) => snapshots.push({ id: detail.id, status: detail.status }),
      onDone: (event) => doneEvents.push(event),
    });

    expect(snapshots).toEqual([{ id: 11, status: "running" }]);
    expect(doneEvents).toEqual([{ migration_id: 11, status: "completed", reason: "final_state" }]);
    expect(result.id).toBe(11);
    expect(result.status).toBe("running");
  });

  it("throws when stream emits an error event", async () => {
    const responseBody = buildStream([
      "event: snapshot\n",
      `data: ${JSON.stringify(SAMPLE_DETAIL)}\n\n`,
      "event: error\n",
      'data: {"detail":"stream backend failure"}\n\n',
    ]);
    const fetchMock = vi.fn(async () => {
      return new Response(responseBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(streamManagerMigration(11)).rejects.toThrow("stream backend failure");
  });

  it("throws when stream ends without snapshot payload", async () => {
    const responseBody = buildStream([
      "event: done\n",
      'data: {"migration_id":11,"status":"completed","reason":"final_state"}\n\n',
    ]);
    const fetchMock = vi.fn(async () => {
      return new Response(responseBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(streamManagerMigration(11)).rejects.toThrow("Migration stream ended without a snapshot payload");
  });
});
