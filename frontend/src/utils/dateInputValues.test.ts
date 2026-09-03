import { currentUtcMonthInputValue } from "./dateInputValues";

describe("currentUtcMonthInputValue", () => {
  it("formats the UTC year and a zero-padded month for month inputs", () => {
    expect(currentUtcMonthInputValue(new Date("2026-01-31T23:30:00-02:00"))).toBe("2026-02");
    expect(currentUtcMonthInputValue(new Date("2026-11-15T12:00:00Z"))).toBe("2026-11");
  });
});
