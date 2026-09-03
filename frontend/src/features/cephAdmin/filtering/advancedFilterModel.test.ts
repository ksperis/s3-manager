import { describe, expect, it } from "vitest";

import {
  advancedFilterFieldHighlight,
  appendNumericFilterRule,
  buildNumericFilterSummaryItems,
} from "./advancedFilterModel";

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

  it("builds numeric and percentage summary items", () => {
    expect(
      buildNumericFilterSummaryItems(
        { count: " 1200 ", invalid: "many", percent: "25", blank: " " },
        [
          { key: "count", label: "Count >=" },
          { key: "invalid", label: "Invalid" },
          { key: "percent", label: "Usage >=", format: "percent" },
          { key: "blank", label: "Blank" },
        ],
        "draft-",
      ),
    ).toEqual([
      { field: "count", id: "draft-count", label: "Count >= 1,200" },
      { field: "invalid", id: "draft-invalid", label: "Invalid many" },
      { field: "percent", id: "draft-percent", label: "Usage >= 25%" },
    ]);
  });
});
