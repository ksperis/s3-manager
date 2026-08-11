import { describe, expect, it } from "vitest";

import {
  ensureSuccessfulBrowserTransferResponse,
  readBrowserTransferBlob,
  readBrowserTransferStream,
} from "./browserFetchTransferResponse";

describe("browser fetch transfer responses", () => {
  it("reads successful Blob and stream payloads", async () => {
    const blob = await readBrowserTransferBlob(
      new Response("content", { status: 200 }),
      "Download failed for report.csv",
    );
    const stream = await readBrowserTransferStream(
      new Response("content", { status: 200 }),
      "Download failed for report.csv",
    );

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBe(7);
    expect(stream).toBeInstanceOf(ReadableStream);
  });

  it("formats S3 response details once for every transfer type", async () => {
    const response = new Response(
      "<Error><Code>AccessDenied</Code><Message>Forbidden</Message></Error>",
      { status: 403, statusText: "Forbidden" },
    );

    await expect(
      ensureSuccessfulBrowserTransferResponse(
        response,
        "Upload failed for report.csv",
      ),
    ).rejects.toThrow(
      "Upload failed for report.csv: HTTP 403 Forbidden - AccessDenied: Forbidden",
    );
  });

  it("rejects successful responses without a readable stream", async () => {
    await expect(
      readBrowserTransferStream(
        new Response(null, { status: 204 }),
        "Download failed for report.csv",
      ),
    ).rejects.toThrow("Streaming download is not supported in this browser.");
  });
});
