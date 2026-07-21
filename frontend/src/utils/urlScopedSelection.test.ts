import { describe, expect, it } from "vitest";
import { resolveUrlScopedSelection } from "./urlScopedSelection";

describe("resolveUrlScopedSelection", () => {
  const availableIds = ["a", "b", "c"];

  it("keeps a valid URL authoritative over mounted and stored values", () => {
    expect(resolveUrlScopedSelection({
      availableIds,
      urlValue: "a",
      currentValue: "b",
      fallbackValues: ["c"],
    })).toBe("a");
  });

  it("keeps the current tab context when navigation omits the query parameter", () => {
    expect(resolveUrlScopedSelection({
      availableIds,
      urlValue: null,
      currentValue: "b",
      fallbackValues: ["c"],
    })).toBe("b");
  });

  it("uses preferences only for an uninitialized tab", () => {
    expect(resolveUrlScopedSelection({
      availableIds,
      urlValue: null,
      currentValue: null,
      fallbackValues: ["c"],
    })).toBe("c");
  });
});
