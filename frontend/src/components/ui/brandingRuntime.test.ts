import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/appSettings", () => ({
  fetchBrandingSettings: vi.fn(),
}));

import { fetchBrandingSettings } from "../../api/appSettings";
import { DEFAULT_PRIMARY_COLOR, applyBranding, bootstrapBranding, generatePrimaryScale } from "./brandingRuntime";

const fetchBrandingSettingsMock = vi.mocked(fetchBrandingSettings);

describe("brandingRuntime", () => {
  beforeEach(() => {
    document.documentElement.style.cssText = "";
    window.localStorage.clear();
    fetchBrandingSettingsMock.mockReset();
  });

  it("generates a full scale for a valid color", () => {
    const scale = generatePrimaryScale(DEFAULT_PRIMARY_COLOR, "light");
    expect(Object.keys(scale)).toHaveLength(11);
    expect(scale[50]).toBe("218 231 249");
    expect(scale[500]).toBe("5 105 248");
    expect(scale[700]).toBe("3 71 168");
    expect(scale[950]).toBe("1 25 58");
    expect(generatePrimaryScale(DEFAULT_PRIMARY_COLOR, "dark")[200]).toBe("94 154 241");
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
