import { beforeEach, describe, expect, it } from "vitest";
import { BROWSER_EMBEDDED_COLUMN_WIDTHS_STORAGE_KEY } from "./browserEmbeddedColumnsState";
import {
  COLUMN_DEFINITIONS,
  DEFAULT_VISIBLE_COLUMN_IDS,
  buildBrowserItems,
  buildBrowserPathStats,
  collectAvailableStorageClasses,
  createLazyColumnCacheEntry,
  loadColumnWidthsForSurface,
  loadVisibleColumnsForSurface,
  persistColumnWidthsForSurface,
  persistVisibleColumnsForSurface,
} from "./browserObjectTableModel";

describe("browserObjectTableModel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("keeps visible columns canonical and isolated by surface", () => {
    expect(DEFAULT_VISIBLE_COLUMN_IDS).toEqual(["size", "modified"]);

    persistVisibleColumnsForSurface(true, ["etag", "size"]);
    persistVisibleColumnsForSurface(false, ["contentType"]);

    expect(loadVisibleColumnsForSurface(true)).toEqual(["size", "etag"]);
    expect(loadVisibleColumnsForSurface(false)).toEqual([
      "contentType",
    ]);
  });

  it("drops unknown widths and clamps persisted values to the column schema", () => {
    window.localStorage.setItem(
      BROWSER_EMBEDDED_COLUMN_WIDTHS_STORAGE_KEY,
      JSON.stringify({ name: 1, size: 999, modified: 180, unknown: 123 }),
    );

    expect(loadColumnWidthsForSurface(false)).toEqual({
      name: 220,
      size: 180,
      modified: 180,
    });

    persistColumnWidthsForSurface(true, { name: 900, tagsCount: 10 });
    expect(loadColumnWidthsForSurface(true)).toEqual({
      name: 640,
      tagsCount: 72,
    });
  });

  it("defines one unique schema entry per optional column", () => {
    expect(new Set(COLUMN_DEFINITIONS.map(({ id }) => id)).size).toBe(
      COLUMN_DEFINITIONS.length,
    );
    expect(
      COLUMN_DEFINITIONS.every(
        ({ minWidthPx, defaultWidthPx, maxWidthPx }) =>
          minWidthPx <= defaultWidthPx && defaultWidthPx <= maxWidthPx,
      ),
    ).toBe(true);
  });

  it("creates independent empty lazy-field cache entries", () => {
    const first = createLazyColumnCacheEntry();
    const second = createLazyColumnCacheEntry();

    first.contentType = "text/plain";

    expect(second).toEqual({
      contentType: null,
      tagsCount: null,
      metadataCount: null,
      cacheControl: null,
      expires: null,
      restoreStatus: null,
      metadataStatus: "idle",
      tagsStatus: "idle",
    });
  });

  it("builds active, deleted, and historical rows from browser results", () => {
    const items = buildBrowserItems(
      ["root/live/"],
      ["root/live/", "root/deleted/"],
      [
        {
          key: "root/file.txt",
          size: 10,
          last_modified: "2026-08-02T10:00:00.000Z",
          etag: '"abc"',
          storage_class: "STANDARD_IA",
        },
      ],
      [
        {
          key: "root/old.txt",
          size: 0,
          last_modified: "2026-08-01T10:00:00.000Z",
          version_id: "delete-marker",
        },
      ],
      "root/",
    );

    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({
      id: "root/live/",
      name: "live",
      type: "folder",
      isDeleted: false,
    });
    expect(items[1]).toMatchObject({
      id: "root/deleted/::deleted-prefix",
      name: "deleted",
      type: "folder",
      isDeleted: true,
      isHistorical: true,
    });
    expect(items[2]).toMatchObject({
      id: "root/file.txt",
      name: "file.txt",
      type: "file",
      sizeBytes: 10,
      storageClass: "STANDARD_IA",
      etag: "abc",
    });
    expect(items[3]).toMatchObject({
      id: "root/old.txt::deleted::delete-marker",
      name: "old.txt",
      isDeleted: true,
      deleteMarkerVersionId: "delete-marker",
    });
  });

  it("summarizes path content and available storage classes", () => {
    const items = buildBrowserItems(
      ["folder/"],
      ["deleted/"],
      [
        { key: "first", size: 10, storage_class: "GLACIER" },
        { key: "second", size: 5, storage_class: "GLACIER" },
        { key: "third", size: 2 },
      ],
      [{ key: "old", size: 0, version_id: "marker" }],
      "",
    );

    expect(buildBrowserPathStats(items)).toEqual({
      totalBytes: 17,
      files: 3,
      deletedFiles: 1,
      folders: 2,
      deletedFolders: 1,
      storageCounts: { GLACIER: 2, STANDARD: 1 },
    });
    expect(collectAvailableStorageClasses(items)).toEqual(["GLACIER"]);
  });
});
