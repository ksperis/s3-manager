/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it } from "vitest";

import {
  parseOptionalNonNegativeInteger,
  parseQuotaBytes,
  quotaBytesToForm,
} from "./quotaForm";

describe("Ceph Admin quota form conversions", () => {
  describe("parseOptionalNonNegativeInteger", () => {
    it.each(["", "  ", "-1", "1.5", "Infinity"])("returns null for %j", (value) => {
      expect(parseOptionalNonNegativeInteger(value)).toBeNull();
    });

    it.each([
      ["0", 0],
      [" 42 ", 42],
    ])("parses %j as %d", (value, expected) => {
      expect(parseOptionalNonNegativeInteger(value)).toBe(expected);
    });
  });

  describe("parseQuotaBytes", () => {
    it.each(["", "  ", "-1", "Infinity"])("returns null for %j", (value) => {
      expect(parseQuotaBytes(value, "GiB")).toBeNull();
    });

    it("converts decimals using the selected unit and rounds to bytes", () => {
      expect(parseQuotaBytes("1.5", "MiB")).toBe(1_572_864);
      expect(parseQuotaBytes("0.000000001", "GiB")).toBe(1);
      expect(parseQuotaBytes("2", "TiB")).toBe(2 * 1024 ** 4);
    });
  });

  describe("quotaBytesToForm", () => {
    it.each([undefined, null, 0, -1])("returns the empty GiB form for %s", (value) => {
      expect(quotaBytesToForm(value)).toEqual({ value: "", unit: "GiB" });
    });

    it("prefers the largest exact unit", () => {
      expect(quotaBytesToForm(2 * 1024 ** 4)).toEqual({ value: "2", unit: "TiB" });
      expect(quotaBytesToForm(3 * 1024 ** 3)).toEqual({ value: "3", unit: "GiB" });
      expect(quotaBytesToForm(512 * 1024 ** 2)).toEqual({ value: "512", unit: "MiB" });
    });

    it("falls back to a two-decimal GiB value", () => {
      expect(quotaBytesToForm(1024 ** 3 + 1)).toEqual({ value: "1.00", unit: "GiB" });
    });
  });
});
