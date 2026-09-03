import { formatLocalDateTime } from "./dateTime";

describe("formatLocalDateTime", () => {
  it("uses the shared placeholder for missing or invalid Date values", () => {
    expect(formatLocalDateTime()).toBe("-");
    expect(formatLocalDateTime(null)).toBe("-");
    expect(formatLocalDateTime(new Date(Number.NaN))).toBe("-");
  });

  it("preserves invalid source strings and formats valid values locally", () => {
    const value = new Date("2026-09-03T08:30:00Z");
    expect(formatLocalDateTime("not-a-date")).toBe("not-a-date");
    expect(formatLocalDateTime(value)).toBe(value.toLocaleString());
    expect(formatLocalDateTime(value.toISOString())).toBe(value.toLocaleString());
  });
});
