import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/appSettings", () => ({
  fetchBrandingSettings: vi.fn(),
}));

import { fetchBrandingSettings } from "../../api/appSettings";
import { applyBranding, bootstrapBranding, generatePrimaryScale, isValidHexColor } from "./brandingRuntime";

const fetchBrandingSettingsMock = vi.mocked(fetchBrandingSettings);

describe("brandingRuntime", () => {
  beforeEach(() => {
    document.documentElement.style.cssText = "";
    window.localStorage.clear();
    fetchBrandingSettingsMock.mockReset();
  });

  it("validates hex colors", () => {
    expect(isValidHexColor("#0ea5e9")).toBe(true);
    expect(isValidHexColor("#0EA5E9")).toBe(true);
    expect(isValidHexColor("0ea5e9")).toBe(false);
    expect(isValidHexColor("#0ea5e")).toBe(false);
  });

  it("generates a full scale for a valid color", () => {
    const scale = generatePrimaryScale("#0ea5e9", "light");
    expect(Object.keys(scale)).toHaveLength(11);
    expect(scale[50]).toMatch(/^\d+ \d+ \d+$/);
    expect(scale[950]).toMatch(/^\d+ \d+ \d+$/);
  });

  it("applies branding variables and persists the selected color", () => {
    const applied = applyBranding("#123456");
    expect(applied).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--ui-primary-light-500-rgb")).toMatch(/\d+ \d+ \d+/);
    expect(document.documentElement.style.getPropertyValue("--ui-primary-dark-500-rgb")).toMatch(/\d+ \d+ \d+/);
    expect(window.localStorage.getItem("branding.primary_color")).toBe("#123456");
  });

  it("bootstraps from cache first, then refreshes from API", async () => {
    window.localStorage.setItem("branding.primary_color", "#112233");
    fetchBrandingSettingsMock.mockResolvedValue({ primary_color: "#445566" });

    await bootstrapBranding();

    expect(window.localStorage.getItem("branding.primary_color")).toBe("#445566");
    expect(document.documentElement.style.getPropertyValue("--ui-primary-light-500-rgb")).toMatch(/\d+ \d+ \d+/);
  });

  it("keeps cached color if branding API fails", async () => {
    window.localStorage.setItem("branding.primary_color", "#112233");
    fetchBrandingSettingsMock.mockRejectedValue(new Error("network"));

    await bootstrapBranding();

    expect(window.localStorage.getItem("branding.primary_color")).toBe("#112233");
    expect(document.documentElement.style.getPropertyValue("--ui-primary-light-500-rgb")).toMatch(/\d+ \d+ \d+/);
  });
});
