/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { PortalAccessKey, PortalStorageSpaceSummary } from "../../api/portal";
import { triggerDownload } from "../../utils/download";

export type PortalExternalToolEndpoint = {
  original: string;
  protocol: "http" | "https";
  hostname: string;
  port: number;
};

export type PortalExternalToolConnection = {
  key: PortalAccessKey;
  endpoint: PortalExternalToolEndpoint | null;
  forcePathStyle: boolean;
  storageSpaceName: string;
  bucketName: string;
  permissionLabel: string;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function safeFilePart(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "storage-space";
}

function normalizedEndpointUrl(endpoint: PortalExternalToolEndpoint): string {
  const defaultPort = endpoint.protocol === "https" ? 443 : 80;
  const hostname = endpoint.hostname.includes(":") && !endpoint.hostname.startsWith("[")
    ? `[${endpoint.hostname}]`
    : endpoint.hostname;
  const port = endpoint.port === defaultPort ? "" : `:${endpoint.port}`;
  return `${endpoint.protocol}://${hostname}${port}`;
}

export function parsePortalExternalToolEndpoint(endpoint?: string | null): PortalExternalToolEndpoint | null {
  const raw = (endpoint ?? "").trim();
  if (!raw) return null;
  const hasHttpScheme = /^https?:\/\//i.test(raw);
  const hasUnsupportedScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) && !hasHttpScheme;
  if (hasUnsupportedScheme) return null;
  const withScheme = hasHttpScheme ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return {
      original: raw,
      protocol: parsed.protocol === "http:" ? "http" : "https",
      hostname: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : parsed.protocol === "http:" ? 80 : 443,
    };
  } catch {
    return null;
  }
}

export function portalExternalToolPermissionLabel(permission?: PortalAccessKey["permission"] | null): string {
  if (permission === "read_write") return "Read/write";
  if (permission === "read_only") return "Read only";
  return "Current Portal access";
}

export function bucketNameForPortalExternalTool(
  key: PortalAccessKey | null,
  space: Pick<PortalStorageSpaceSummary, "id" | "internal_bucket_name"> | null
): string {
  return key?.bucket_name || space?.internal_bucket_name || space?.id || "";
}

export function storageSpaceNameForPortalExternalTool(
  key: PortalAccessKey | null,
  space: Pick<PortalStorageSpaceSummary, "name"> | null
): string {
  return key?.storage_space_name || space?.name || "Storage Space";
}

export function portalExternalToolBaseFilename(connection: Pick<PortalExternalToolConnection, "storageSpaceName" | "bucketName">): string {
  return `${safeFilePart(connection.storageSpaceName)}-${safeFilePart(connection.bucketName)}`;
}

export function buildCyberduckBookmark(connection: PortalExternalToolConnection): string {
  if (!connection.endpoint) {
    throw new Error("A valid endpoint is required for Cyberduck bookmarks.");
  }
  const nickname = `${connection.storageSpaceName} - ${connection.bucketName}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Protocol</key>
  <string>s3</string>
  <key>Nickname</key>
  <string>${escapeXml(nickname)}</string>
  <key>Hostname</key>
  <string>${escapeXml(connection.endpoint.hostname)}</string>
  <key>Port</key>
  <string>${connection.endpoint.port}</string>
  <key>Username</key>
  <string>${escapeXml(connection.key.access_key_id)}</string>
  <key>Path</key>
  <string>/${escapeXml(connection.bucketName)}</string>
${connection.forcePathStyle ? `  <key>Custom</key>
  <dict>
    <key>s3.bucket.virtualhost.disable</key>
    <string>true</string>
  </dict>
` : ""}</dict>
</plist>
`;
}

export function buildWinScpProfile(connection: PortalExternalToolConnection): string {
  if (!connection.endpoint) {
    throw new Error("A valid endpoint is required for WinSCP profiles.");
  }
  const sessionName = portalExternalToolBaseFilename(connection);
  return `[Sessions\\${sessionName}]
HostName=${connection.endpoint.hostname}
PortNumber=${connection.endpoint.port}
UserName=${connection.key.access_key_id}
FSProtocol=7
Ftps=${connection.endpoint.protocol === "https" ? 1 : 0}
RemoteDirectory=/${connection.bucketName}
S3UrlStyle=${connection.forcePathStyle ? 1 : 0}
`;
}

export function portalExternalToolRcloneRemoteName(
  connection: Pick<PortalExternalToolConnection, "storageSpaceName" | "bucketName">
): string {
  return portalExternalToolBaseFilename(connection).replace(/[.-]/g, "_");
}

export function portalExternalToolRcloneSecretEnvironmentVariable(
  connection: Pick<PortalExternalToolConnection, "storageSpaceName" | "bucketName">
): string {
  return `RCLONE_CONFIG_${portalExternalToolRcloneRemoteName(connection).toUpperCase()}_SECRET_ACCESS_KEY`;
}

export function buildRcloneConfig(connection: PortalExternalToolConnection): string {
  if (!connection.endpoint) {
    throw new Error("A valid endpoint is required for rclone configurations.");
  }
  const remoteName = portalExternalToolRcloneRemoteName(connection);
  const secretEnvironmentVariable = portalExternalToolRcloneSecretEnvironmentVariable(connection);
  return `# Set ${secretEnvironmentVariable} in your environment before using this remote.
# Example: rclone lsd ${remoteName}:${connection.bucketName}
[${remoteName}]
type = s3
provider = Ceph
env_auth = false
access_key_id = ${connection.key.access_key_id}
endpoint = ${normalizedEndpointUrl(connection.endpoint)}
force_path_style = ${connection.forcePathStyle ? "true" : "false"}
`;
}

export function buildGenericConnectionSheet(connection: PortalExternalToolConnection): string {
  const lines = [
    "Storage Space connection details",
    "",
    `Storage Space: ${connection.storageSpaceName}`,
    `Storage name for external tools: ${connection.bucketName}`,
    `Service address: ${connection.endpoint?.original || "Configured storage service"}`,
    `Access ID: ${connection.key.access_key_id}`,
    `Permission: ${connection.permissionLabel}`,
    "Secret: Not included in this file",
    "",
    "Cyberduck",
    "- Import or double-click the .duck bookmark in Cyberduck or Mountain Duck.",
    "- Enter the secret when the application asks for the password.",
    "- The bookmark opens directly on the selected space.",
    "",
    "Manual setup",
    "- Use the service address, storage name, and Access ID above.",
    "- Enter the one-time secret when the application asks for it.",
    "- Keep the secret in a password manager or your usual secure storage.",
  ];
  return `${lines.join("\n")}\n`;
}

export function triggerPortalExternalToolDownload(filename: string, content: string, mimeType: string): void {
  triggerDownload(filename, content, mimeType);
}
