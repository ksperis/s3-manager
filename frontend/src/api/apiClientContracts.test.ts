import { describe, expect, it } from "vitest";

import { API_CLIENT_CONTRACTS } from "./apiClientContracts";

describe("API_CLIENT_CONTRACTS", () => {
  it("covers each frontend API surface", () => {
    expect(new Set(API_CLIENT_CONTRACTS.map((row) => row.area))).toEqual(
      new Set(["auth", "admin", "manager", "browser", "portal", "ceph-admin", "storage-ops", "shared"])
    );
  });

  it("documents context headers and mapping boundaries", () => {
    expect(API_CLIENT_CONTRACTS).not.toHaveLength(0);
    API_CLIENT_CONTRACTS.forEach((row) => {
      expect(row.clientFile).toMatch(/^api\/.+\.ts$/);
      expect(row.contextHeaders).toContain("Authorization");
      expect(["typed-api-payload", "api-to-view-model", "stream-event-parser"]).toContain(row.mappingBoundary);
    });
  });

  it("keeps stream clients on sanitized error surfaces", () => {
    const streamRows = API_CLIENT_CONTRACTS.filter((row) => row.transport === "fetch-sse");

    expect(streamRows).not.toHaveLength(0);
    streamRows.forEach((row) => {
      expect(row.errorSurface).toBe("sanitized-stream-error");
      expect(row.mappingBoundary).toBe("stream-event-parser");
    });
  });

  it("does not define frontend authorization contracts", () => {
    const matrixText = JSON.stringify(API_CLIENT_CONTRACTS).toLowerCase();

    expect(matrixText).not.toContain("frontend authorization");
    expect(matrixText).not.toContain("grant storage permission");
  });
});
