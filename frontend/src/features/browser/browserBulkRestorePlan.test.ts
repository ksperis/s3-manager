/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it, vi } from "vitest";
import type { BrowserObjectVersion } from "../../api/browser";
import { buildBulkRestorePlan } from "./browserBulkRestorePlan";
import type { BrowserItem } from "./browserTypes";

function item(key: string, type: BrowserItem["type"] = "file"): BrowserItem {
  return {
    id: key,
    key,
    name: key.split("/").filter(Boolean).at(-1) ?? key,
    type,
    size: "0 B",
    modified: "-",
    owner: "-",
  };
}

function version(
  key: string,
  versionId: string,
  modified: string,
  options: { latest?: boolean; deleted?: boolean } = {},
): BrowserObjectVersion {
  return {
    key,
    version_id: versionId,
    is_latest: options.latest ?? false,
    is_delete_marker: options.deleted ?? false,
    last_modified: modified,
  };
}

const emptyListing = { versions: [], deleteMarkers: [] };

describe("buildBulkRestorePlan", () => {
  it("restores only currently deleted files in latest mode", async () => {
    const deletedKey = "deleted.txt";
    const liveKey = "live.txt";
    const listVersionsForKey = vi.fn(async (key: string) => {
      if (key === deletedKey) {
        return {
          versions: [version(key, "v1", "2026-01-01T00:00:00Z")],
          deleteMarkers: [
            version(key, "d1", "2026-02-01T00:00:00Z", {
              latest: true,
              deleted: true,
            }),
          ],
        };
      }
      return {
        versions: [
          version(key, "v2", "2026-02-01T00:00:00Z", { latest: true }),
        ],
        deleteMarkers: [],
      };
    });
    const listObjectsForPrefix = vi.fn(async () => []);

    const plan = await buildBulkRestorePlan({
      items: [item(deletedKey), item(liveKey)],
      restoreLatestDeleted: true,
      targetTime: Number.NaN,
      deleteMissing: true,
      listVersionsForKey,
      listVersionsForPrefix: async () => emptyListing,
      listObjectsForPrefix,
    });

    expect(plan.restoreList).toEqual([{ key: deletedKey, versionId: "v1" }]);
    expect(plan.deleteList).toEqual([]);
    expect(plan.unchangedKeys.size).toBe(0);
    expect(listObjectsForPrefix).not.toHaveBeenCalled();
  });

  it("separates restore, unchanged, and missing files for a snapshot", async () => {
    const targetTime = new Date("2026-02-15T00:00:00Z").getTime();
    const listVersionsForKey = vi.fn(async (key: string) => {
      if (key === "restore.txt") {
        return {
          versions: [
            version(key, "v2", "2026-03-01T00:00:00Z", { latest: true }),
            version(key, "v1", "2026-02-01T00:00:00Z"),
          ],
          deleteMarkers: [],
        };
      }
      if (key === "unchanged.txt") {
        return {
          versions: [
            version(key, "v1", "2026-02-01T00:00:00Z", { latest: true }),
          ],
          deleteMarkers: [],
        };
      }
      return emptyListing;
    });

    const plan = await buildBulkRestorePlan({
      items: [item("restore.txt"), item("unchanged.txt"), item("missing.txt")],
      restoreLatestDeleted: false,
      targetTime,
      deleteMissing: true,
      listVersionsForKey,
      listVersionsForPrefix: async () => emptyListing,
      listObjectsForPrefix: async () => [],
    });

    expect(plan.restoreList).toEqual([
      { key: "restore.txt", versionId: "v1" },
    ]);
    expect(plan.deleteList).toEqual(["missing.txt"]);
    expect([...plan.unchangedKeys]).toEqual(["unchanged.txt"]);
  });

  it("plans folder versions and deletes current keys absent at the date", async () => {
    const targetTime = new Date("2026-02-15T00:00:00Z").getTime();
    const listVersionsForPrefix = vi.fn(async () => ({
      versions: [
        version("docs/report.txt", "v2", "2026-03-01T00:00:00Z", {
          latest: true,
        }),
        version("docs/report.txt", "v1", "2026-02-01T00:00:00Z"),
      ],
      deleteMarkers: [],
    }));

    const plan = await buildBulkRestorePlan({
      items: [item("docs/", "folder")],
      restoreLatestDeleted: false,
      targetTime,
      deleteMissing: true,
      listVersionsForKey: async () => emptyListing,
      listVersionsForPrefix,
      listObjectsForPrefix: async () => [
        { key: "docs/report.txt", size: 1 },
        { key: "docs/new.txt", size: 1 },
      ],
    });

    expect(listVersionsForPrefix).toHaveBeenCalledWith("docs/");
    expect(plan.restoreList).toEqual([
      { key: "docs/report.txt", versionId: "v1" },
    ]);
    expect(plan.deleteList).toEqual(["docs/new.txt"]);
  });
});
