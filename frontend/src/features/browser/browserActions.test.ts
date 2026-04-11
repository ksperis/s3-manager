import { describe, expect, it } from "vitest";
import { resolveBrowserActions } from "./browserActions";
import type { BrowserItem } from "./browserTypes";

const fileItem: BrowserItem = {
  id: "file-1",
  key: "a.txt",
  name: "a.txt",
  type: "file",
  size: "10 B",
  sizeBytes: 10,
  modified: "2026-03-10 10:15",
  modifiedAt: 0,
  owner: "owner",
};

const folderItem: BrowserItem = {
  id: "folder-1",
  key: "docs/",
  name: "docs",
  type: "folder",
  size: "-",
  sizeBytes: 0,
  modified: "2026-03-10 10:15",
  modifiedAt: 0,
  owner: "owner",
};

describe("resolveBrowserActions", () => {
  it("enables path actions consistently when bucket context is available", () => {
    const actions = resolveBrowserActions({
      scope: "path",
      bucketName: "bucket-1",
      hasS3AccountContext: true,
      versioningEnabled: true,
      canPaste: true,
      clipboardMode: "move",
      currentPath: "bucket-1/docs",
      showFolderItems: true,
      showDeletedObjects: false,
    });

    expect(actions.uploadFiles.enabled).toBe(true);
    expect(actions.uploadFolder.enabled).toBe(true);
    expect(actions.newFolder.enabled).toBe(true);
    expect(actions.paste.label).toBe("Paste (Move)");
    expect(actions.paste.enabled).toBe(true);
    expect(actions.restoreToDate.visible).toBe(true);
    expect(actions.cleanOldVersions.visible).toBe(true);
    expect(actions.copyPath.enabled).toBe(true);
    expect(actions.toggleShowFolders.label).toBe("Hide folders");
    expect(actions.toggleShowDeleted.label).toBe("Show deleted");
  });

  it("disables copy URL in SSE-C mode for single file selection without hiding the action", () => {
    const actions = resolveBrowserActions({
      scope: "selection",
      items: [fileItem],
      bucketName: "bucket-1",
      hasS3AccountContext: true,
      versioningEnabled: false,
      canPaste: false,
      copyUrlDisabled: true,
      copyUrlDisabledReason: "Copy URL is disabled in SSE-C mode.",
    });

    expect(actions.download.visible).toBe(true);
    expect(actions.download.enabled).toBe(true);
    expect(actions.copyUrl.visible).toBe(true);
    expect(actions.copyUrl.enabled).toBe(false);
    expect(actions.copyUrl.disabledReason).toBe("Copy URL is disabled in SSE-C mode.");
    expect(actions.advanced.visible).toBe(true);
    expect(actions.advanced.enabled).toBe(true);
  });

  it("keeps destructive and clipboard actions visible but disabled when selection contains deleted items", () => {
    const deletedFile: BrowserItem = { ...fileItem, id: "file-deleted", isDeleted: true };
    const actions = resolveBrowserActions({
      scope: "selection",
      items: [fileItem, deletedFile],
      bucketName: "bucket-1",
      hasS3AccountContext: true,
      versioningEnabled: true,
      canPaste: false,
    });

    expect(actions.download.visible).toBe(false);
    expect(actions.copy.visible).toBe(true);
    expect(actions.copy.enabled).toBe(false);
    expect(actions.cut.visible).toBe(true);
    expect(actions.cut.enabled).toBe(false);
    expect(actions.bulkAttributes.visible).toBe(true);
    expect(actions.bulkAttributes.enabled).toBe(false);
    expect(actions.delete.visible).toBe(true);
    expect(actions.delete.enabled).toBe(false);
    expect(actions.restoreToDate.visible).toBe(true);
    expect(actions.restoreToDate.enabled).toBe(true);
  });

  it("keeps item-level disabled states for deleted objects while preserving versions access", () => {
    const deletedFile: BrowserItem = { ...fileItem, isDeleted: true };
    const actions = resolveBrowserActions({
      scope: "item",
      items: [deletedFile],
      bucketName: "bucket-1",
      hasS3AccountContext: true,
      versioningEnabled: true,
      canPaste: false,
      inspectorAvailable: true,
    });

    expect(actions.details.visible).toBe(true);
    expect(actions.details.enabled).toBe(true);
    expect(actions.preview.visible).toBe(true);
    expect(actions.preview.enabled).toBe(false);
    expect(actions.download.visible).toBe(true);
    expect(actions.download.enabled).toBe(false);
    expect(actions.versions.visible).toBe(true);
    expect(actions.versions.enabled).toBe(true);
    expect(actions.copy.enabled).toBe(false);
    expect(actions.delete.enabled).toBe(false);
  });

  it("keeps file Details available even when the inspector panel is disabled", () => {
    const actions = resolveBrowserActions({
      scope: "item",
      items: [fileItem],
      bucketName: "bucket-1",
      hasS3AccountContext: true,
      versioningEnabled: false,
      canPaste: false,
      inspectorAvailable: false,
    });

    expect(actions.details.visible).toBe(true);
    expect(actions.details.enabled).toBe(true);
  });

  it("keeps open available for a single folder selection", () => {
    const actions = resolveBrowserActions({
      scope: "selection",
      items: [folderItem],
      bucketName: "bucket-1",
      hasS3AccountContext: true,
      versioningEnabled: false,
      canPaste: false,
    });

    expect(actions.download.visible).toBe(true);
    expect(actions.download.label).toBe("Download folder");
    expect(actions.open.visible).toBe(true);
    expect(actions.open.enabled).toBe(true);
    expect(actions.copyUrl.visible).toBe(false);
    expect(actions.advanced.visible).toBe(false);
  });
});
