import { describe, expect, it } from "vitest";

import { buildAdminNav } from "./router";

function getSettingsLink(label: string, options: Parameters<typeof buildAdminNav>) {
  const settingsSection = buildAdminNav(...options).find((section) => section.label === "Settings");
  return settingsSection?.links.find((link) => link.label === label);
}

function getAuditReportingLink(label: string, options: Parameters<typeof buildAdminNav>) {
  const auditReportingSection = buildAdminNav(...options).find((section) => section.label === "Audit & Reporting");
  return auditReportingSection?.links.find((link) => link.label === label);
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

  it("exposes Authentication in settings navigation", () => {
    const authenticationLink = getSettingsLink("Authentication", [true, true, false, false, false, true]);

    expect(authenticationLink?.to).toBe("/admin/authentication-settings");
  });

  it("groups identity administration with a dedicated security icon", () => {
    const identityAccess = buildAdminNav(true, true, false, false, false, true).find(
      (section) => section.label === "Identity & Access"
    );

    expect(identityAccess?.links.map((link) => link.label)).toEqual([
      "UI Users",
      "UI Groups",
      "Identity Security",
    ]);
    expect(identityAccess?.links.find((link) => link.label === "Identity Security")?.iconName).toBe("shield");
  });

  it("adds exact pending request badges and hides zero counts", () => {
    const populated = buildAdminNav(
      true,
      true,
      false,
      false,
      false,
      true,
      false,
      { identity_link_requests: 2, portal_requests: 5 },
    );
    const empty = buildAdminNav(
      true,
      true,
      false,
      false,
      false,
      true,
      false,
      { identity_link_requests: 0, portal_requests: 0 },
    );

    const identityLink = populated
      .find((section) => section.label === "Identity & Access")
      ?.links.find((link) => link.label === "Identity Security");
    const portalLink = populated
      .find((section) => section.label === "Audit & Reporting")
      ?.links.find((link) => link.label === "Portal Requests");
    expect(identityLink).toMatchObject({
      badge: "2",
      badgeAriaLabel: "2 pending identity link requests",
      badgeTone: "attention",
    });
    expect(portalLink).toMatchObject({
      badge: "5",
      badgeAriaLabel: "5 pending Portal requests",
      badgeTone: "attention",
    });
    expect(
      empty
        .find((section) => section.label === "Identity & Access")
        ?.links.find((link) => link.label === "Identity Security")?.badge,
    ).toBeUndefined();
    expect(
      empty
        .find((section) => section.label === "Audit & Reporting")
        ?.links.find((link) => link.label === "Portal Requests")?.badge,
    ).toBeUndefined();
  });

  it("keeps Portal Requests hidden when Portal is disabled even with pending requests", () => {
    const adminNav = buildAdminNav(
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      { identity_link_requests: 0, portal_requests: 5 },
    );

    expect(
      adminNav
        .find((section) => section.label === "Audit & Reporting")
        ?.links.find((link) => link.label === "Portal Requests"),
    ).toBeUndefined();
  });

  it("keeps settings collapsed until the admin settings route asks for expansion", () => {
    const baseArgs = [true, true, false, false, false, true] as const;

    expect(buildAdminNav(...baseArgs).find((section) => section.label === "Settings")?.collapsed).toBe(true);
    expect(buildAdminNav(...baseArgs, true).find((section) => section.label === "Settings")?.collapsed).toBe(false);
  });

  it("exposes Usage History only when usage history is enabled", () => {
    const enabledLink = getAuditReportingLink("Usage History", [true, true, false, true, false, true]);
    const disabledLink = getAuditReportingLink("Usage History", [true, true, false, false, false, true]);

    expect(enabledLink?.to).toBe("/admin/usage-history");
    expect(disabledLink).toBeUndefined();
  });

  it("exposes Portal Requests only when Portal is enabled", () => {
    const enabledLink = getAuditReportingLink("Portal Requests", [true, true, false, false, false, true]);
    const disabledLink = getAuditReportingLink("Portal Requests", [false, true, false, false, false, true]);

    expect(enabledLink?.to).toBe("/admin/portal-requests");
    expect(disabledLink).toBeUndefined();
  });

  it("groups metrics after managed tenant links and billing with audit reporting", () => {
    const adminNav = buildAdminNav(true, true, true, true, false, true);
    const overview = adminNav.find((section) => section.label === "Overview");
    const managedTenants = adminNav.find((section) => section.label === "Managed Tenants");
    const auditReporting = adminNav.find((section) => section.label === "Audit & Reporting");

    expect(overview?.links.map((link) => link.label)).toEqual(["Dashboard"]);
    expect(managedTenants?.links.map((link) => link.label)).toEqual([
      "RGW Accounts",
      "RGW Users",
      "Usage & Metrics",
    ]);
    expect(auditReporting?.links.map((link) => link.label)).toEqual([
      "Portal Requests",
      "Billing",
      "Usage History",
      "Audit trail",
    ]);
  });
});
