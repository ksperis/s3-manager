import { describe, expect, it } from "vitest";

import { buildAdminNav } from "./router";

function getSettingsLink(label: string, options: Parameters<typeof buildAdminNav>) {
  const settingsSection = buildAdminNav(...options).find((section) => section.label === "Settings");
  return settingsSection?.links.find((link) => link.label === label);
}

describe("buildAdminNav", () => {
  it("sets explicit hints for disabled Browser and Portal settings links", () => {
    const browserLink = getSettingsLink("Browser", [false, false, false, false, true]);
    const portalLink = getSettingsLink("Portal", [false, false, false, false, true]);

    expect(browserLink?.disabled).toBe(true);
    expect(browserLink?.disabledHint).toBe("Browser feature is disabled in General settings.");
    expect(portalLink?.disabled).toBe(true);
    expect(portalLink?.disabledHint).toBe("Portal feature is disabled in General settings.");
  });

  it("does not set hints when Browser and Portal settings links are enabled", () => {
    const browserLink = getSettingsLink("Browser", [true, true, false, false, true]);
    const portalLink = getSettingsLink("Portal", [true, true, false, false, true]);

    expect(browserLink?.disabled).toBe(false);
    expect(browserLink?.disabledHint).toBeUndefined();
    expect(portalLink?.disabled).toBe(false);
    expect(portalLink?.disabledHint).toBeUndefined();
  });
});
