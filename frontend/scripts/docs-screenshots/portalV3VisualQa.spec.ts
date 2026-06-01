import { expect, test, type Page } from "@playwright/test";

import { buildBaseRules } from "./fixtures/base";
import { registerApiMocks } from "./mockApi";

const portalUser = {
  id: 3,
  email: "storage.user@example.com",
  role: "ui_user",
  ui_language: "en",
  can_access_ceph_admin: false,
  authType: "password",
  account_links: [
    { account_id: 101, account_role: "portal_user", account_admin: false },
  ],
  capabilities: { can_manage_buckets: true, can_manage_iam: false, access_browser: false },
};

const portalRoutes = [
  { path: "/portal", expected: "Dashboard" },
  { path: "/portal/storage-spaces", expected: "Storage Spaces" },
  { path: "/portal/storage-spaces/genomics-2026?prefix=raw-data%2F2024%2F03%2F", expected: "sample_001.fastq.gz" },
  {
    path: "/portal/storage-spaces/genomics-2026/objects/raw-data/2024/03/sample_001.fastq.gz",
    expected: "Informations générales",
  },
  { path: "/portal/shares", expected: "Shared with me" },
  { path: "/portal/activity", expected: "Activity" },
  { path: "/portal/transfers", expected: "Transfers" },
  { path: "/portal/usage", expected: "Usage & Analytics" },
  { path: "/portal/settings", expected: "Settings" },
];

const viewports = [
  { name: "desktop", width: 1728, height: 972 },
  { name: "mobile", width: 390, height: 844 },
];

async function seedPortalSession(page: Page) {
  await page.addInitScript((user) => {
    localStorage.clear();
    localStorage.setItem("token", "docs-token");
    localStorage.setItem("user", JSON.stringify(user));
    localStorage.setItem("selectedWorkspace", "portal");
    localStorage.setItem("selectedPortalAccountId", "101");
    localStorage.setItem("theme", "light");
  }, portalUser);
}

async function openPortalRoute(page: Page, routePath: string, scenarioId: string) {
  const mockRegistry = await registerApiMocks(page, buildBaseRules(), scenarioId);
  await seedPortalSession(page);
  await page.goto(routePath, { waitUntil: "domcontentloaded" });
  return mockRegistry;
}

test.describe("Portal V3 visual QA", () => {
  for (const viewport of viewports) {
    for (const route of portalRoutes) {
      test(`${viewport.name} ${route.path}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const mockRegistry = await openPortalRoute(page, route.path, `portal-v3-visual-qa-${viewport.name}-${route.path}`);

        const main = page.locator("main");
        await expect(main.getByText(route.expected, { exact: false }).first()).toBeVisible();
        await expect(main.getByText("Open in Browser", { exact: false })).toHaveCount(0);
        await expect(main.getByText("/portal/browser", { exact: false })).toHaveCount(0);

        const horizontalOverflow = await page.evaluate(() => (
          Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth
        ));
        expect(horizontalOverflow).toBeLessThanOrEqual(2);

        await page.keyboard.press("Tab");
        const activeElement = await page.evaluate(() => {
          const active = document.activeElement;
          return {
            tag: active?.tagName ?? null,
            ariaLabel: active?.getAttribute("aria-label") ?? null,
            text: active?.textContent?.trim().slice(0, 80) ?? null,
          };
        });
        expect(activeElement.tag).not.toBe("BODY");

        mockRegistry.assertNoUnmatched();
      });
    }
  }
});
