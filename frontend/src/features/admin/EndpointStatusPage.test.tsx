import { describe, expect, it } from "vitest";
import { isLatencyMeaningfullyAboveAverage } from "./EndpointStatusPage";

describe("EndpointStatusPage latency warning threshold", () => {
  it("keeps small above-average latency variations unflagged", () => {
    expect(isLatencyMeaningfullyAboveAverage(38, 36)).toBe(false);
  });

  it("flags latency only after the 10 percent and 10 ms thresholds are both met", () => {
    expect(isLatencyMeaningfullyAboveAverage(112, 100)).toBe(true);
    expect(isLatencyMeaningfullyAboveAverage(120, 111)).toBe(false);
    expect(isLatencyMeaningfullyAboveAverage(109, 100)).toBe(false);
  });

  it("does not flag missing latency samples", () => {
    expect(isLatencyMeaningfullyAboveAverage(null, 100)).toBe(false);
    expect(isLatencyMeaningfullyAboveAverage(112, null)).toBe(false);
    expect(isLatencyMeaningfullyAboveAverage(undefined, 100)).toBe(false);
    expect(isLatencyMeaningfullyAboveAverage(112, undefined)).toBe(false);
  });
});
