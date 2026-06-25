import { describe, expect, it } from "vitest";

import { FRONTEND_MUTATION_MATRIX } from "./frontendMutationMatrix";

describe("FRONTEND_MUTATION_MATRIX", () => {
  it("covers every mutating frontend surface", () => {
    expect(new Set(FRONTEND_MUTATION_MATRIX.map((row) => row.surface))).toEqual(
      new Set(["admin", "manager", "portal", "browser", "ceph-admin", "storage-ops"])
    );
  });

  it("documents loading, feedback, and audit context for every workflow", () => {
    expect(FRONTEND_MUTATION_MATRIX).not.toHaveLength(0);
    FRONTEND_MUTATION_MATRIX.forEach((row) => {
      expect(row.hasLoadingState).toBe(true);
      expect(row.hasUserFeedback).toBe(true);
      expect(row.auditContextSource).toMatch(/backend|stream/);
      expect(row.representativeFiles.length).toBeGreaterThan(0);
    });
  });

  it("does not treat frontend affordances as authorization", () => {
    const matrixText = JSON.stringify(FRONTEND_MUTATION_MATRIX).toLowerCase();

    expect(matrixText).not.toContain("frontend authorization");
    expect(matrixText).not.toContain("ui permission grants storage");
  });
});
