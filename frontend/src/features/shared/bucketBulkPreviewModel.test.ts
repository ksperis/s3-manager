/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it } from "vitest";
import type { BulkPreviewItem } from "./bucketBulkOperationsModel";
import {
  buildBulkPreviewExportPayload,
  buildBulkPreviewSections,
  summarizeBulkPreview,
} from "./bucketBulkPreviewModel";

const preview = (overrides: Partial<BulkPreviewItem> = {}): BulkPreviewItem => ({
  bucket: "archive",
  before: [{ text: "Disabled" }],
  after: [{ text: "Enabled", tone: "added" }],
  changed: true,
  ...overrides,
});

describe("bucketBulkPreviewModel", () => {
  it("summarizes changed, unchanged, and failed buckets separately", () => {
    expect(
      summarizeBulkPreview([
        preview(),
        preview({ bucket: "same", before: [], after: [], changed: false }),
        preview({ bucket: "failed", changed: false, error: "Denied" }),
      ]),
    ).toEqual({ changed: 1, unchanged: 1, errors: 1 });
  });

  it("splits labeled sections and detects textual or tone changes", () => {
    const sections = buildBulkPreviewSections(
      preview({
        before: [
          { text: "[Quota]" },
          { text: "10 GiB" },
          { text: "[Versioning]" },
          { text: "Enabled" },
        ],
        after: [
          { text: "[Quota]" },
          { text: "20 GiB" },
          { text: "[Versioning]" },
          { text: "Enabled" },
          { text: "[CORS]" },
          { text: "GET", tone: "added" },
        ],
      }),
      "paste_configs",
    );

    expect(sections.map(({ label, changed }) => ({ label, changed }))).toEqual([
      { label: "Quota", changed: true },
      { label: "Versioning", changed: false },
      { label: "CORS", changed: true },
    ]);
    expect(sections[2].before).toEqual([{ text: "-" }]);
  });

  it("uses the operation label for marker-free and empty previews", () => {
    expect(buildBulkPreviewSections(preview(), "enable_versioning")[0]).toMatchObject({
      label: "Versioning",
      changed: true,
    });
    expect(
      buildBulkPreviewSections(preview({ before: [], after: [], changed: false }), "set_quota"),
    ).toEqual([
      {
        key: "quota-0",
        label: "Quota",
        before: [{ text: "-" }],
        after: [{ text: "-" }],
        changed: false,
      },
    ]);
  });

  it("projects failed previews into an explicit error section", () => {
    expect(
      buildBulkPreviewSections(preview({ changed: false, error: "Access denied" }), "add_cors"),
    ).toEqual([
      {
        key: "error",
        label: "Error",
        before: [{ text: "Access denied", tone: "removed" }],
        after: [{ text: "Access denied", tone: "added" }],
        changed: true,
        error: "Access denied",
      },
    ]);
  });

  it("exports only changed or failed buckets with dynamic scope metadata", () => {
    const payload = buildBulkPreviewExportPayload({
      generatedAt: "2026-08-28T00:00:00.000Z",
      items: [
        preview(),
        preview({ bucket: "same", before: [], after: [], changed: false }),
        preview({ bucket: "failed", changed: false, error: "Denied" }),
      ],
      operation: "enable_versioning",
      scope: { id: 7, name: "Archive" },
      scopeKey: "endpoint",
    });

    expect(payload).toMatchObject({
      generated_at: "2026-08-28T00:00:00.000Z",
      endpoint: { id: 7, name: "Archive" },
      operation: "enable_versioning",
      summary: { total: 3, changed: 1, unchanged: 1, errors: 1, exported_items: 2 },
    });
    expect(payload.items.map((item) => item.bucket)).toEqual(["archive", "failed"]);
    expect(payload.items[1].sections[0]).toMatchObject({ label: "Error", error: "Denied" });
  });
});
