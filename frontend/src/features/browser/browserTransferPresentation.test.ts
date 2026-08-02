import { describe, expect, it } from "vitest";
import {
  buildBrowserTransferWarnings,
  isStsCredentialsExpiring,
  resolveBrowserTransferAccessBadge,
  resolveBrowserTransferParallelism,
  resolveDirectCredentialStsTooltip,
} from "./browserTransferPresentation";

describe("browser transfer presentation", () => {
  it("selects and clamps direct or proxy transfer parallelism", () => {
    const settings = {
      direct_upload_parallelism: 6,
      proxy_upload_parallelism: 2,
      direct_download_parallelism: 7,
      proxy_download_parallelism: 3,
      other_operations_parallelism: 5,
    };

    expect(resolveBrowserTransferParallelism(settings, false)).toEqual({
      upload: 6,
      download: 7,
      otherOperations: 5,
    });
    expect(resolveBrowserTransferParallelism(settings, true)).toEqual({
      upload: 2,
      download: 3,
      otherOperations: 5,
    });
    expect(
      resolveBrowserTransferParallelism(
        {
          ...settings,
          proxy_upload_parallelism: 0,
          proxy_download_parallelism: Number.NaN,
          other_operations_parallelism: -1,
        },
        true,
      ),
    ).toEqual({ upload: 1, download: 2, otherOperations: 1 });
  });

  it("refreshes missing invalid or nearly expired STS credentials", () => {
    const now = Date.parse("2026-08-02T12:00:00Z");

    expect(isStsCredentialsExpiring(null, now)).toBe(true);
    expect(isStsCredentialsExpiring("not-a-date", now)).toBe(true);
    expect(isStsCredentialsExpiring("2026-08-02T12:02:00Z", now)).toBe(true);
    expect(isStsCredentialsExpiring("2026-08-02T12:02:01Z", now)).toBe(false);
  });

  it("builds transfer warnings in stable priority order", () => {
    expect(
      buildBrowserTransferWarnings({
        warningMessage: "Request warning",
        corsFixError: "CORS repair failed",
        stsCredentialsError: "STS failed",
        corsEnabled: false,
        proxyAllowed: false,
      }),
    ).toEqual([
      "Request warning",
      "CORS repair failed",
      "STS failed",
      "Direct download/upload is not allowed on this bucket.",
      "Proxy transfers are disabled in settings.",
    ]);
  });

  it("keeps transfer badge precedence and presign context", () => {
    const base = {
      hasContext: true,
      corsEnabled: true,
      proxyAllowed: true,
      useProxyTransfers: false,
      sseActive: false,
      hasStsCredentials: false,
      stsExpirationLabel: "",
      directCredentialStsTooltip: "",
    };

    expect(
      resolveBrowserTransferAccessBadge({
        ...base,
        corsEnabled: false,
        proxyAllowed: false,
        useProxyTransfers: true,
      })?.label,
    ).toBe("Unavailable");
    expect(
      resolveBrowserTransferAccessBadge({
        ...base,
        useProxyTransfers: true,
        sseActive: true,
      })?.label,
    ).toBe("Proxy");
    expect(
      resolveBrowserTransferAccessBadge({
        ...base,
        sseActive: true,
        hasStsCredentials: true,
      })?.label,
    ).toBe("SSE-C");
    expect(
      resolveBrowserTransferAccessBadge({
        ...base,
        hasStsCredentials: true,
        stsExpirationLabel: "2026-08-02 12:30",
      }),
    ).toMatchObject({
      label: "STS",
      title:
        "Download/Upload mode: STS credentials active (expires at 2026-08-02 12:30).",
    });

    const connectionTooltip = resolveDirectCredentialStsTooltip("connection");
    expect(
      resolveBrowserTransferAccessBadge({
        ...base,
        directCredentialStsTooltip: connectionTooltip,
      }),
    ).toMatchObject({
      label: "Presign",
      title: expect.stringContaining("S3 connections"),
    });
    expect(resolveDirectCredentialStsTooltip("legacy_user")).toContain(
      "legacy S3 users",
    );
    expect(resolveDirectCredentialStsTooltip(null)).toBe("");
    expect(resolveBrowserTransferAccessBadge({ ...base, hasContext: false })).toBeNull();
  });
});
