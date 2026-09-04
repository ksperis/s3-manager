import { describe, expect, it } from "vitest";

import {
  DELETED_OBJECT_DETAILS_MESSAGE,
  buildObjectDetailsTabs,
  resolveBrowserObjectDetailsTab,
  resolveRoutedObjectDetailsTab,
} from "./browserObjectDetailsModel";

describe("buildObjectDetailsTabs", () => {
  it("keeps Standard details read-only and concise", () => {
    expect(
      buildObjectDetailsTabs({
        hasArchiveTab: true,
        isDeleted: false,
        profile: "standard",
        versioningEnabled: true,
      }),
    ).toEqual([
      { id: "preview", label: "Preview" },
      { id: "details", label: "Details" },
    ]);
  });

  it("adds technical views only to Advanced", () => {
    expect(
      buildObjectDetailsTabs({
        hasArchiveTab: true,
        isDeleted: false,
        profile: "advanced",
        versioningEnabled: true,
      }).map((tab) => tab.id),
    ).toEqual(["preview", "versions", "properties", "protection", "archive"]);
  });

  it("opens deleted objects through versions only", () => {
    expect(
      buildObjectDetailsTabs({
        hasArchiveTab: false,
        isDeleted: true,
        profile: "advanced",
        versioningEnabled: true,
      }),
    ).toEqual([{ id: "versions", label: "Versions" }]);
  });

  it("normalizes requested tabs for Standard, Advanced, and deleted objects", () => {
    expect(
      resolveBrowserObjectDetailsTab({
        isDeleted: false,
        isStorageSpace: false,
        profile: "standard",
        requestedTab: "protection",
        versioningEnabled: true,
      }),
    ).toEqual({ initialTab: "details" });
    expect(
      resolveBrowserObjectDetailsTab({
        isDeleted: false,
        isStorageSpace: false,
        profile: "advanced",
        requestedTab: "details",
        versioningEnabled: true,
      }),
    ).toEqual({ initialTab: "properties" });
    expect(
      resolveBrowserObjectDetailsTab({
        isDeleted: true,
        isStorageSpace: false,
        profile: "advanced",
        requestedTab: "preview",
        versioningEnabled: false,
      }),
    ).toEqual({
      initialTab: null,
      warning: DELETED_OBJECT_DETAILS_MESSAGE,
    });
  });

  it("normalizes technical tabs before routing them", () => {
    expect(
      resolveRoutedObjectDetailsTab({
        isDeleted: false,
        requestedTab: "protection",
      }),
    ).toBe("properties");
  });
});
