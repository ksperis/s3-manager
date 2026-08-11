/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it } from "vitest";

import { formatChartTooltipTimestamp } from "./chartTooltip";

describe("formatChartTooltipTimestamp", () => {
  it("preserves invalid provider labels instead of throwing", () => {
    expect(formatChartTooltipTimestamp("not-a-date", "hourly")).toBe("not-a-date");
  });

  it("handles a missing label", () => {
    expect(formatChartTooltipTimestamp(undefined, "daily")).toBe("");
  });
});
