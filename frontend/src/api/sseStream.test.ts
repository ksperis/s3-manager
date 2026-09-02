import { describe, expect, it, vi } from "vitest";
import { consumeSseStream } from "./sseStream";

function streamChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });
}

describe("consumeSseStream", () => {
  it("parses chunked CRLF events, comments, multiline data, and trailing data", async () => {
    const encoder = new TextEncoder();
    const events = vi.fn();
    const stream = streamChunks([
      encoder.encode(": keepalive\r"),
      encoder.encode('\nevent: progress\r\ndata: {"step":1}\r\ndata: continued\r\n\r\nevent:\n'),
      encoder.encode("data: trailing"),
    ]);

    await consumeSseStream(stream, events);

    expect(events.mock.calls.map(([event]) => event)).toEqual([
      { event: "progress", data: '{"step":1}\ncontinued' },
      { event: "message", data: "trailing" },
    ]);
  });

  it("preserves unicode code points split across byte chunks", async () => {
    const bytes = new TextEncoder().encode("event: result\ndata: café ☕\n\n");
    const splitAt = bytes.indexOf(0xe2) + 1;
    const events = vi.fn();

    await consumeSseStream(
      streamChunks([bytes.slice(0, splitAt), bytes.slice(splitAt)]),
      events
    );

    expect(events).toHaveBeenCalledWith({ event: "result", data: "café ☕" });
  });

  it("ignores empty events and propagates consumer errors", async () => {
    const encoder = new TextEncoder();
    const events = vi.fn(() => {
      throw new Error("invalid event payload");
    });
    const stream = streamChunks([
      encoder.encode(": comment\n\nevent: ignored\n\nevent: error\ndata: {}\n\n"),
    ]);

    await expect(consumeSseStream(stream, events)).rejects.toThrow(
      "invalid event payload"
    );
    expect(events).toHaveBeenCalledTimes(1);
  });
});
