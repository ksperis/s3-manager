import { describe, expect, it } from "vitest";

import {
  ARCHIVE_STORAGE_CLASSES,
  buildInlinePreviewDisposition,
  buildObjectDetailsTabs,
  formatRestoreStatus,
  isObjectLockUnavailableMessage,
  nextTabAfterDeleted,
  normalizeObjectDetailPairs,
} from "../browserObjectDetailsModel";

describe("browserObjectDetailsModel", () => {
  it("normalizes tag and metadata pairs by trimming keys", () => {
    expect(
      normalizeObjectDetailPairs([
        { key: " content-type ", value: "text/plain" },
        { key: " ", value: "ignored" },
        { key: "owner", value: null },
      ])
    ).toEqual({
      "content-type": "text/plain",
      owner: "",
    });
  });

  it("formats restore status from S3 headers", () => {
    expect(formatRestoreStatus('ongoing-request="true"')).toBe("Restore in progress.");
    expect(formatRestoreStatus('ongoing-request="false"')).toBe("Temporary restore is available.");
    expect(formatRestoreStatus('ongoing-request="false", expiry-date="2030-01-01T00:00:00Z"')).toContain(
      "Temporary restore available until"
    );
  });

  it("detects object lock unavailability without hiding unrelated messages", () => {
    expect(isObjectLockUnavailableMessage("InvalidRequest: bucket object lock not configured")).toBe(true);
    expect(isObjectLockUnavailableMessage("Object Lock is not enabled")).toBe(true);
    expect(isObjectLockUnavailableMessage("AccessDenied for retention")).toBe(false);
  });

  it("keeps modal routing and inline preview disposition deterministic", () => {
    expect(nextTabAfterDeleted(true)).toBe("versions");
    expect(nextTabAfterDeleted(false)).toBe("preview");
    expect(buildInlinePreviewDisposition('rapport "été".txt')).toContain('filename="rapport \\"_t_\\".txt"');
  });

  it("builds tabs for editable, read-only, and deleted object states", () => {
    expect(
      buildObjectDetailsTabs({
        hasArchiveTab: true,
        isDeleted: false,
        readOnly: false,
        versioningEnabled: true,
      }).map((tab) => tab.id),
    ).toEqual([
      "preview",
      "versions",
      "properties",
      "protection",
      "archive",
    ]);
    expect(
      buildObjectDetailsTabs({
        hasArchiveTab: true,
        isDeleted: false,
        readOnly: true,
        versioningEnabled: true,
      }).map((tab) => tab.id),
    ).toEqual(["preview", "properties"]);
    expect(
      buildObjectDetailsTabs({
        hasArchiveTab: false,
        isDeleted: true,
        readOnly: false,
        versioningEnabled: true,
      }).map((tab) => tab.id),
    ).toEqual(["versions"]);
    expect(
      buildObjectDetailsTabs({
        hasArchiveTab: false,
        isDeleted: true,
        readOnly: false,
        versioningEnabled: false,
      }),
    ).toEqual([]);
  });

  it("documents archive storage classes", () => {
    expect(ARCHIVE_STORAGE_CLASSES.has("GLACIER")).toBe(true);
    expect(ARCHIVE_STORAGE_CLASSES.has("STANDARD")).toBe(false);
  });
});
