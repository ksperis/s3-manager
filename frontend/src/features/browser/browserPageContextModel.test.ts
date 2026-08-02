import { describe, expect, it } from "vitest";
import { resolveBrowserWorkspaceContext } from "./browserPageContextModel";

describe("resolveBrowserWorkspaceContext", () => {
  it("resolves the standalone Browser vocabulary and sidebar", () => {
    expect(
      resolveBrowserWorkspaceContext({
        pathname: "/browser/",
        workspaceSurface: "browser",
      }),
    ).toMatchObject({
      normalizedPath: "/browser",
      isMainBrowserPath: true,
      isEmbeddedBrowserPath: false,
      workspaceNoun: "bucket",
      workspaceObjectNounPlural: "objects",
      selectorWorkspaceNounTitle: "Buckets",
      showWorkspaceSidebar: true,
    });
  });

  it("uses Portal vocabulary only on the embedded Portal surface", () => {
    expect(
      resolveBrowserWorkspaceContext({
        pathname: "/portal/storage-spaces/42",
        workspaceSurface: "portal",
        lockedBucketName: " project-data ",
      }),
    ).toMatchObject({
      isPortalBrowserSurface: true,
      isEmbeddedBrowserPath: true,
      usePortalWorkspaceLabels: true,
      workspaceNoun: "storage space",
      workspaceNounCapitalized: "Storage Space",
      workspaceObjectNoun: "file",
      workspaceObjectNounPlural: "files",
      resolvedLockedBucketName: "project-data",
      showWorkspaceSidebar: false,
    });
  });

  it("keeps bucket vocabulary for Manager and Ceph Admin embeds", () => {
    for (const pathname of ["/manager/browser", "/ceph-admin/browser"]) {
      expect(
        resolveBrowserWorkspaceContext({
          pathname,
          workspaceSurface: pathname.startsWith("/manager")
            ? "manager"
            : "ceph-admin",
        }),
      ).toMatchObject({
        isEmbeddedBrowserPath: true,
        workspaceNoun: "bucket",
        workspaceObjectNoun: "object",
      });
    }
  });
});
