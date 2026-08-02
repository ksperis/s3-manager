import { describe, expect, it } from "vitest";

import type { PortalAccessKey, PortalStorageSpaceSummary } from "../../api/portal";
import {
  buildCyberduckBookmark,
  buildGenericConnectionSheet,
  bucketNameForPortalExternalTool,
  parsePortalExternalToolEndpoint,
  portalExternalToolPermissionLabel,
  type PortalExternalToolConnection,
} from "./portalExternalToolAccess";

const externalKey: PortalAccessKey = {
  access_key_id: "AK-EXT",
  target_type: "external",
  storage_space_name: "Research Data",
  bucket_name: "research-data-bucket",
  permission: "read_write",
};

const storageSpace = {
  id: "research-data",
  name: "Research Data",
  internal_bucket_name: "research-data-bucket",
} as PortalStorageSpaceSummary;

function connection(overrides: Partial<PortalExternalToolConnection> = {}): PortalExternalToolConnection {
  return {
    key: externalKey,
    endpoint: parsePortalExternalToolEndpoint("https://s3.example.test:9443")!,
    forcePathStyle: false,
    storageSpaceName: "Research Data",
    bucketName: "research-data-bucket",
    permissionLabel: portalExternalToolPermissionLabel(externalKey.permission),
    ...overrides,
  };
}

describe("portalExternalToolAccess", () => {
  it("normalizes S3 endpoints for external tools", () => {
    expect(parsePortalExternalToolEndpoint("s3.example.test")).toMatchObject({
      original: "s3.example.test",
      protocol: "https",
      hostname: "s3.example.test",
      port: 443,
    });
    expect(parsePortalExternalToolEndpoint("http://localhost:9000")).toMatchObject({
      original: "http://localhost:9000",
      protocol: "http",
      hostname: "localhost",
      port: 9000,
    });
    expect(parsePortalExternalToolEndpoint("mailto:user@example.test")).toBeNull();
  });

  it("uses the explicit bucket name before the selected space", () => {
    expect(bucketNameForPortalExternalTool(externalKey, storageSpace)).toBe("research-data-bucket");
    expect(bucketNameForPortalExternalTool({ ...externalKey, bucket_name: null }, storageSpace)).toBe("research-data-bucket");
  });

  it("builds a secret-free Cyberduck bookmark scoped to the bucket path", () => {
    const bookmark = buildCyberduckBookmark(connection());

    expect(bookmark).toContain("<key>Protocol</key>");
    expect(bookmark).toContain("<string>s3</string>");
    expect(bookmark).toContain("<string>s3.example.test</string>");
    expect(bookmark).toContain("<string>9443</string>");
    expect(bookmark).toContain("<string>AK-EXT</string>");
    expect(bookmark).toContain("<string>/research-data-bucket</string>");
    expect(bookmark).not.toContain("s3.bucket.virtualhost.disable");
    expect(bookmark).not.toContain("SK-EXT");
  });

  it("disables virtual-host addressing for path-style endpoints", () => {
    const bookmark = buildCyberduckBookmark(connection({ forcePathStyle: true }));
    const document = new DOMParser().parseFromString(bookmark, "application/xml");

    expect(document.querySelector("parsererror")).toBeNull();
    expect(bookmark).toContain("<key>Custom</key>");
    expect(bookmark).toContain("<key>s3.bucket.virtualhost.disable</key>");
    expect(bookmark).toContain("<string>true</string>");
  });

  it("builds generic connection sheets with an explicit one-time secret option", () => {
    const withoutSecret = buildGenericConnectionSheet(connection());
    const withSecret = buildGenericConnectionSheet(connection(), { secretAccessKey: "SK-EXT" });

    expect(withoutSecret).toContain("Storage name for external tools: research-data-bucket");
    expect(withoutSecret).toContain("Secret: Not included in this file");
    expect(withoutSecret).not.toContain("SK-EXT");
    expect(withSecret).toContain("This file contains a one-time secret.");
    expect(withSecret).toContain("Secret: SK-EXT");
  });
});
