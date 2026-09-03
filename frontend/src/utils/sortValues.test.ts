/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it } from "vitest";

import { compareByNullableField, compareNullableValues, nextSortState } from "./sortValues";

type Row = {
  name: string;
  used?: number | null;
  enabled?: boolean;
  tags?: string[];
};

describe("sortValues", () => {
  it("sorts nullable fields with missing values last in ascending order", () => {
    const rows: Row[] = [
      { name: "missing", used: null },
      { name: "large", used: 30 },
      { name: "small", used: 10 },
    ];

    const sorted = [...rows].sort((left, right) => compareByNullableField(left, right, "used", "asc"));

    expect(sorted.map((row) => row.name)).toEqual(["small", "large", "missing"]);
  });

  it("sorts nullable fields with missing values first in descending order", () => {
    const rows: Row[] = [
      { name: "small", used: 10 },
      { name: "missing" },
      { name: "large", used: 30 },
    ];

    const sorted = [...rows].sort((left, right) => compareByNullableField(left, right, "used", "desc"));

    expect(sorted.map((row) => row.name)).toEqual(["missing", "large", "small"]);
  });

  it("sorts strings and booleans without numeric casts leaking into the caller", () => {
    expect(compareNullableValues("alpha", "bravo", "asc")).toBeLessThan(0);
    expect(compareNullableValues(true, false, "asc")).toBeGreaterThan(0);
  });

  it("toggles the active field and applies the requested direction to a new field", () => {
    expect(nextSortState({ field: "name", direction: "asc" }, "name")).toEqual({
      field: "name",
      direction: "desc",
    });
    expect(nextSortState({ field: "name", direction: "desc" }, "used")).toEqual({
      field: "used",
      direction: "asc",
    });
    expect(nextSortState({ field: "name", direction: "asc" }, "used", "desc")).toEqual({
      field: "used",
      direction: "desc",
    });
  });
});
