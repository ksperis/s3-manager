import { describe, expect, it } from "vitest";

import { ROUTE_ACCESS_MATRIX } from "./routerAccessMatrix";

describe("ROUTE_ACCESS_MATRIX", () => {
  it("documents every workspace surface", () => {
    expect(new Set(ROUTE_ACCESS_MATRIX.map((row) => row.surface))).toEqual(
      new Set(["shared", "admin", "manager", "browser", "portal", "ceph-admin", "storage-ops"])
    );
  });

  it("keeps storage authorization delegated to S3 IAM and backend enforcement", () => {
    expect(ROUTE_ACCESS_MATRIX).not.toHaveLength(0);
    expect(ROUTE_ACCESS_MATRIX.every((row) => row.storagePermissionAuthority === "S3/IAM/backend")).toBe(true);
  });

  it("keeps UI gates framed as surface access and affordances", () => {
    const matrixText = JSON.stringify(ROUTE_ACCESS_MATRIX).toLowerCase();

    expect(matrixText).not.toContain("grant storage");
    expect(matrixText).not.toContain("storage permission granted");
    expect(matrixText).not.toContain("iam replacement");
    expect(matrixText).not.toContain("parallel permission");
  });
});
