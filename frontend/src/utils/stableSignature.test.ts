import { describe, expect, it } from "vitest";
import { stableSignature } from "./stableSignature";

describe("stableSignature", () => {
  it("ignores object key order and tag ordering", () => {
    const left = stableSignature({
      form: { name: "demo", tags: [{ key: "env", value: "prod" }, { key: "team", value: "ops" }] },
      selectedIds: [3, 1, 2],
    });
    const right = stableSignature({
      selectedIds: [2, 3, 1],
      form: { tags: [{ key: "team", value: "ops" }, { key: "env", value: "prod" }], name: "demo" },
    });

    expect(left).toBe(right);
  });
});
