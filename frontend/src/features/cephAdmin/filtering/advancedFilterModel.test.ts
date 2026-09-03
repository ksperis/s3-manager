import { describe, expect, it } from "vitest";

import { advancedFilterFieldHighlight, appendNumericFilterRule } from "./advancedFilterModel";

describe("advancedFilterModel", () => {
  it("prioritizes pending field presentation over applied presentation", () => {
    expect(advancedFilterFieldHighlight(true, true)).toEqual({
      labelClass: expect.stringContaining("text-amber-700"),
      fieldClass: expect.stringContaining("border-amber-400"),
    });
    expect(advancedFilterFieldHighlight(true, false)).toEqual({
      labelClass: expect.stringContaining("text-emerald-700"),
      fieldClass: expect.stringContaining("border-emerald-400"),
    });
    expect(advancedFilterFieldHighlight(false, false)).toEqual({ labelClass: "", fieldClass: "" });
  });

  it("appends only finite numeric rules", () => {
    const rules: Array<Record<string, unknown>> = [];

    appendNumericFilterRule(rules, "max_buckets", "gte", " 12 ");
    appendNumericFilterRule(rules, "max_buckets", "lte", "");
    appendNumericFilterRule(rules, "max_buckets", "lte", "invalid");

    expect(rules).toEqual([{ field: "max_buckets", op: "gte", value: 12 }]);
  });
});
