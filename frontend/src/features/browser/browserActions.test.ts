import { describe, expect, it, vi } from "vitest";
import {
  FULL_BROWSER_CAPABILITY_FACTS,
  isBrowserItemPreviewAvailable,
  resolveBrowserActions,
  resolveItemPrimaryAction,
  runBrowserAction,
} from "./browserActions";
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

const baseInput = {
  bucketName: "bucket-1",
  hasS3AccountContext: true,
  versioningEnabled: true,
  canPaste: true,
};

describe("resolveBrowserActions", () => {
  it("keeps technical actions out of Standard while retaining essential object actions", () => {
    const path = resolveBrowserActions({
      ...baseInput,
      scope: "path",
      functionalProfile: "standard",
      clipboardMode: "move",
      currentPath: "bucket-1/docs",
    });
    const item = resolveBrowserActions({
      ...baseInput,
      scope: "item",
      items: [fileItem],
      functionalProfile: "standard",
      previewAvailable: true,
    });

    expect(path.uploadFiles.visible).toBe(true);
    expect(path.refresh.visible).toBe(true);
    expect(path.paste.label).toBe("Paste (Move)");
    expect(path.versions.visible).toBe(false);
    expect(path.cleanOldVersions.visible).toBe(false);
    expect(path.multipartUploads.visible).toBe(false);
    expect(path.configureBucket.visible).toBe(false);
    expect(item.preview.visible).toBe(true);
    expect(item.properties.visible).toBe(true);
    expect(item.copyUrl.visible).toBe(false);
    expect(item.bulkAttributes.visible).toBe(false);
  });

  it("exposes Advanced actions and keeps a temporarily blocked action visible with its reason", () => {
    const actions = resolveBrowserActions({
      ...baseInput,
      scope: "selection",
      items: [fileItem],
      functionalProfile: "advanced",
      copyUrlDisabled: true,
      copyUrlDisabledReason: "Copy URL is disabled in SSE-C mode.",
    });

    expect(actions.copyUrl.visible).toBe(true);
    expect(actions.details).toMatchObject({ visible: true, enabled: true });
    expect(actions.copyUrl.enabled).toBe(false);
    expect(actions.copyUrl.disabledReason).toBe("Copy URL is disabled in SSE-C mode.");
    expect(actions.advanced.visible).toBe(true);

    const path = resolveBrowserActions({
      ...baseInput,
      scope: "path",
      functionalProfile: "advanced",
      multipartUploadsAvailable: true,
      bucketConfigurationAvailable: true,
    });
    expect(path.multipartUploads).toMatchObject({ visible: true, enabled: true });
    expect(path.configureBucket).toMatchObject({ visible: true, enabled: true });
  });

  it("uses Portal capability facts without reconstructing permissions from roles", () => {
    const viewerFacts = {
      canWriteObjects: false,
      canDeleteObjects: false,
      canRestoreObjects: false,
      canCreatePublicLinks: false,
    };
    const viewerPath = resolveBrowserActions({
      ...baseInput,
      scope: "path",
      functionalProfile: "portal",
      capabilityFacts: viewerFacts,
      currentPath: "bucket-1",
    });
    const managerItem = resolveBrowserActions({
      ...baseInput,
      scope: "item",
      items: [fileItem],
      functionalProfile: "portal",
      capabilityFacts: { ...FULL_BROWSER_CAPABILITY_FACTS, canCreatePublicLinks: true },
      publicLinkAvailable: true,
      previewAvailable: true,
    });

    expect(viewerPath.uploadFiles.visible).toBe(false);
    expect(viewerPath.newFolder.visible).toBe(false);
    expect(viewerPath.copyPath.visible).toBe(true);
    expect(viewerPath.refresh.visible).toBe(true);
    expect(viewerPath.multipartUploads.visible).toBe(false);
    expect(viewerPath.configureBucket.visible).toBe(false);
    expect(managerItem.createPublicLink.visible).toBe(true);
    expect(managerItem.copyUrl.visible).toBe(false);
    expect(managerItem.advanced.visible).toBe(false);
  });

  it("keeps refresh visible with a resolved temporary reason", () => {
    const actions = resolveBrowserActions({
      ...baseInput,
      scope: "path",
      functionalProfile: "standard",
      refreshPending: true,
    });

    expect(actions.refresh).toMatchObject({
      visible: true,
      enabled: false,
      disabledReason: "Objects are already loading.",
    });
  });

  it("keeps deleted objects outside ordinary actions but exposes authorized Portal restore", () => {
    const deletedFile = { ...fileItem, id: "deleted", isDeleted: true };
    const actions = resolveBrowserActions({
      ...baseInput,
      scope: "item",
      items: [deletedFile],
      functionalProfile: "portal",
      capabilityFacts: FULL_BROWSER_CAPABILITY_FACTS,
      restoreAvailable: true,
      inspectorAvailable: true,
    });

    expect(actions.preview.visible).toBe(false);
    expect(actions.download.enabled).toBe(false);
    expect(actions.restore.visible).toBe(true);
    expect(actions.restore.enabled).toBe(true);
    expect(actions.copy.visible).toBe(false);
  });

  it("keeps unknown S3 permissions available for backend enforcement", () => {
    const actions = resolveBrowserActions({
      ...baseInput,
      scope: "item",
      items: [fileItem],
      functionalProfile: "standard",
      capabilityFacts: FULL_BROWSER_CAPABILITY_FACTS,
      previewAvailable: true,
    });
    expect(actions.delete.visible).toBe(true);
    expect(actions.delete.enabled).toBe(true);
  });
});

describe("primary item activation", () => {
  it("opens folders, previewable files, generic files, and deleted history deterministically", () => {
    expect(resolveItemPrimaryAction(folderItem, { versioningEnabled: true })).toEqual({ kind: "open-folder" });
    expect(resolveItemPrimaryAction(fileItem, { versioningEnabled: true })).toEqual({ kind: "open-file", initialTab: "preview" });
    expect(resolveItemPrimaryAction({ ...fileItem, name: "archive.bin" }, { versioningEnabled: true })).toEqual({ kind: "open-file", initialTab: "properties" });
    expect(resolveItemPrimaryAction({ ...fileItem, isDeleted: true }, { versioningEnabled: true })).toEqual({ kind: "open-versions" });
  });

  it("enforces the common 50 MiB preview ceiling", () => {
    expect(isBrowserItemPreviewAvailable(fileItem)).toBe(true);
    expect(isBrowserItemPreviewAvailable({ ...fileItem, sizeBytes: 50 * 1024 * 1024 })).toBe(true);
    expect(isBrowserItemPreviewAvailable({ ...fileItem, sizeBytes: 50 * 1024 * 1024 + 1 })).toBe(false);
  });
});

describe("runBrowserAction", () => {
  it("executes one resolved handler and reports disabled reasons", () => {
    const handler = vi.fn();
    const enabled = resolveBrowserActions({ ...baseInput, scope: "selection", items: [folderItem] }).open;
    expect(runBrowserAction(enabled, { open: handler })).toEqual({ executed: true });
    expect(handler).toHaveBeenCalledTimes(1);

    const blocked = { ...enabled, enabled: false, disabledReason: "Operation in progress." };
    expect(runBrowserAction(blocked, { open: handler })).toEqual({ executed: false, reason: "Operation in progress." });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
