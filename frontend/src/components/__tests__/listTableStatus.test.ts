import { describe, expect, it } from "vitest";
import { resolveListTableStatus } from "../list/listTableStatus";

describe("resolveListTableStatus", () => {
  it("returns loading when loading and no rows", () => {
    expect(resolveListTableStatus({ loading: true, error: null, rowCount: 0 })).toBe("loading");
  });

  it("returns error when there is an error and no rows", () => {
    expect(resolveListTableStatus({ loading: false, error: "boom", rowCount: 0 })).toBe("error");
  });

  it("returns empty when not loading, no error, and no rows", () => {
    expect(resolveListTableStatus({ loading: false, error: null, rowCount: 0 })).toBe("empty");
  });

  it("returns ready when rows exist even if an error is present", () => {
    expect(resolveListTableStatus({ loading: false, error: "boom", rowCount: 3 })).toBe("ready");
  });
});
