import { describe, expect, it } from "vitest";

import { calculateActionProgressPercent } from "./actionProgress";

describe("calculateActionProgressPercent", () => {
  it("returns 0 when progress is missing or total is zero", () => {
    expect(calculateActionProgressPercent(null)).toBe(0);
    expect(calculateActionProgressPercent({ completed: 1, total: 0 })).toBe(0);
  });

  it("calculates a bounded rounded percent", () => {
    expect(calculateActionProgressPercent({ completed: 2, total: 5 })).toBe(40);
    expect(calculateActionProgressPercent({ completed: 10, total: 8 })).toBe(100);
    expect(calculateActionProgressPercent({ completed: -3, total: 8 })).toBe(0);
  });
});
