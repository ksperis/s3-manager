import { describe, expect, it } from "vitest";

import { buildAdminNav } from "./router";

function getSettingsLink(label: string, options: Parameters<typeof buildAdminNav>) {
  const settingsSection = buildAdminNav(...options).find((section) => section.label === "Settings");
  return settingsSection?.links.find((link) => link.label === label);
}

function getUsageReportingLink(label: string, options: Parameters<typeof buildAdminNav>) {
  const usageReportingSection = buildAdminNav(...options).find((section) => section.label === "Usage & Reporting");
  return usageReportingSection?.links.find((link) => link.label === label);
}

describe("buildAdminNav", () => {
  it("sets explicit hint for disabled Browser settings link", () => {
    const browserLink = getSettingsLink("Browser", [true, false, false, false, false, true]);

    expect(browserLink?.disabled).toBe(true);
    expect(browserLink?.disabledHint).toBe("Browser feature is disabled in General settings.");
  });

  it("does not set hint when Browser settings link is enabled", () => {
    const browserLink = getSettingsLink("Browser", [true, true, true, false, false, true]);

    expect(browserLink?.disabled).toBe(false);
    expect(browserLink?.disabledHint).toBeUndefined();
  });

  it("sets explicit hint for disabled Portal settings link", () => {
    const portalLink = getSettingsLink("Portal", [false, true, false, false, false, true]);

    expect(portalLink?.disabled).toBe(true);
    expect(portalLink?.disabledHint).toBe("Portal feature is disabled in General settings.");
  });

  it("does not expose API Tokens in settings navigation", () => {
    const settingsSection = buildAdminNav(true, true, true, false, true, true).find((section) => section.label === "Settings");
    const apiTokensLink = settingsSection?.links.find((link) => link.label === "API Tokens");

    expect(apiTokensLink).toBeUndefined();
  });

  it("keeps settings collapsed until the admin settings route asks for expansion", () => {
    const baseArgs = [true, true, false, false, false, true] as const;

    expect(buildAdminNav(...baseArgs).find((section) => section.label === "Settings")?.collapsed).toBe(true);
    expect(buildAdminNav(...baseArgs, true).find((section) => section.label === "Settings")?.collapsed).toBe(false);
  });

  it("exposes Usage History only when usage history is enabled", () => {
    const enabledLink = getUsageReportingLink("Usage History", [true, true, false, true, false, true]);
    const disabledLink = getUsageReportingLink("Usage History", [true, true, false, false, false, true]);

    expect(enabledLink?.to).toBe("/admin/usage-history");
    expect(disabledLink).toBeUndefined();
  });

  it("groups usage metrics and billing under Usage & Reporting", () => {
    const adminNav = buildAdminNav(true, true, true, true, false, true);
    const overview = adminNav.find((section) => section.label === "Overview");
    const usageReporting = adminNav.find((section) => section.label === "Usage & Reporting");

    expect(overview?.links.map((link) => link.label)).toEqual(["Dashboard"]);
    expect(usageReporting?.links.map((link) => link.label)).toEqual([
      "Usage & Metrics",
      "Billing",
      "Usage History",
    ]);
  });
});
