/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { PortalAccessKey, PortalStorageSpaceSummary } from "../../api/portal";

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

export function buildGenericConnectionSheet(
  connection: PortalExternalToolConnection,
  options?: { secretAccessKey?: string | null }
): string {
  const secret = options?.secretAccessKey?.trim();
  const lines = [
    "Storage Space connection details",
    "",
    `Storage Space: ${connection.storageSpaceName}`,
    `Storage name for external tools: ${connection.bucketName}`,
    `Service address: ${connection.endpoint?.original || "Configured storage service"}`,
    `Access ID: ${connection.key.access_key_id}`,
    `Permission: ${connection.permissionLabel}`,
    `Secret: ${secret || "Not included in this file"}`,
    "",
    "Cyberduck",
    "- Import or double-click the .duck bookmark.",
    "- Enter the secret when Cyberduck asks for the password.",
    "- The bookmark opens directly on the selected space.",
    "",
    "Manual setup",
    "- Use the service address, storage name, access ID, and secret above.",
    "- Keep the secret in a password manager or your usual secure storage.",
  ];
  if (secret) {
    lines.splice(1, 0, "This file contains a one-time secret. Delete it after configuring your tool.");
  }
  return `${lines.join("\n")}\n`;
}

export function triggerPortalExternalToolDownload(filename: string, content: string, mimeType: string): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
