import { describe, expect, it } from "vitest";

import { buildAdminNav } from "./router";

function getSettingsLink(label: string, options: Parameters<typeof buildAdminNav>) {
  const settingsSection = buildAdminNav(...options).find((section) => section.label === "Settings");
  return settingsSection?.links.find((link) => link.label === label);
}

describe("buildAdminNav", () => {
  it("sets explicit hint for disabled Browser settings link", () => {
    const browserLink = getSettingsLink("Browser", [false, false, false, true]);

    expect(browserLink?.disabled).toBe(true);
    expect(browserLink?.disabledHint).toBe("Browser feature is disabled in General settings.");
  });

  it("does not set hint when Browser settings link is enabled", () => {
    const browserLink = getSettingsLink("Browser", [true, true, false, true]);

    expect(browserLink?.disabled).toBe(false);
    expect(browserLink?.disabledHint).toBeUndefined();
  });

  it("does not expose API Tokens in settings navigation", () => {
    const settingsSection = buildAdminNav(true, true, true, true).find((section) => section.label === "Settings");
    const apiTokensLink = settingsSection?.links.find((link) => link.label === "API Tokens");

    expect(apiTokensLink).toBeUndefined();
  });
});
