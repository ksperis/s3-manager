import { describe, expect, it } from "vitest";

import type { PortalAccessKey, PortalStorageSpaceSummary } from "../../api/portal";
import {
  buildCyberduckBookmark,
  buildGenericConnectionSheet,
  buildRcloneConfig,
  buildWinScpProfile,
  bucketNameForPortalExternalTool,
  parsePortalExternalToolEndpoint,
  portalExternalToolPermissionLabel,
  portalExternalToolRcloneRemoteName,
  portalExternalToolRcloneSecretEnvironmentVariable,
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

  it("escapes Cyberduck XML values and supports HTTP endpoints", () => {
    const bookmark = buildCyberduckBookmark(connection({
      key: { ...externalKey, access_key_id: "AK&EXT" },
      endpoint: parsePortalExternalToolEndpoint("http://localhost:9000")!,
      storageSpaceName: "Research & Data",
      bucketName: "research-data-bucket",
    }));
    const document = new DOMParser().parseFromString(bookmark, "application/xml");

    expect(document.querySelector("parsererror")).toBeNull();
    expect(bookmark).toContain("<string>AK&amp;EXT</string>");
    expect(bookmark).toContain("<string>localhost</string>");
    expect(bookmark).toContain("<string>9000</string>");
  });

  it.each([
    { endpoint: "https://s3.example.test:9443", forcePathStyle: true, ftps: 1, urlStyle: 1 },
    { endpoint: "http://s3.example.test:9000", forcePathStyle: false, ftps: 0, urlStyle: 0 },
  ])("builds a secret-free WinSCP S3 session for $endpoint", ({ endpoint, forcePathStyle, ftps, urlStyle }) => {
    const profile = buildWinScpProfile(connection({
      endpoint: parsePortalExternalToolEndpoint(endpoint)!,
      forcePathStyle,
      storageSpaceName: "Research & Data",
    }));

    expect(profile).toContain("[Sessions\\research-data-research-data-bucket]");
    expect(profile).toContain("FSProtocol=7");
    expect(profile).toContain(`Ftps=${ftps}`);
    expect(profile).toContain("PortNumber=");
    expect(profile).toContain("UserName=AK-EXT");
    expect(profile).toContain("RemoteDirectory=/research-data-bucket");
    expect(profile).toContain(`S3UrlStyle=${urlStyle}`);
    expect(profile).not.toMatch(/password/i);
    expect(profile).not.toContain("SK-EXT");
  });

  it.each([
    { endpoint: "https://s3.example.test:9443", forcePathStyle: true, expectedEndpoint: "https://s3.example.test:9443" },
    { endpoint: "http://s3.example.test", forcePathStyle: false, expectedEndpoint: "http://s3.example.test" },
  ])("builds a secret-free rclone Ceph remote for $endpoint", ({ endpoint, forcePathStyle, expectedEndpoint }) => {
    const config = buildRcloneConfig(connection({
      endpoint: parsePortalExternalToolEndpoint(endpoint)!,
      forcePathStyle,
      storageSpaceName: "Research & Data",
    }));

    expect(portalExternalToolRcloneRemoteName(connection())).toBe("research_data_research_data_bucket");
    expect(portalExternalToolRcloneSecretEnvironmentVariable(connection())).toBe(
      "RCLONE_CONFIG_RESEARCH_DATA_RESEARCH_DATA_BUCKET_SECRET_ACCESS_KEY"
    );
    expect(config).toContain("[research_data_research_data_bucket]");
    expect(config).toContain("type = s3");
    expect(config).toContain("provider = Ceph");
    expect(config).toContain("access_key_id = AK-EXT");
    expect(config).toContain(`endpoint = ${expectedEndpoint}`);
    expect(config).toContain(`force_path_style = ${forcePathStyle}`);
    expect(config).toContain("rclone lsd research_data_research_data_bucket:research-data-bucket");
    expect(config).not.toContain("SK-EXT");
  });

  it("rejects every generated profile when the endpoint is invalid", () => {
    const invalidConnection = connection({ endpoint: null });

    expect(() => buildCyberduckBookmark(invalidConnection)).toThrow();
    expect(() => buildWinScpProfile(invalidConnection)).toThrow();
    expect(() => buildRcloneConfig(invalidConnection)).toThrow();
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
