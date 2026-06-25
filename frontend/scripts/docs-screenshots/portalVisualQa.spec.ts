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
    expected: "Quick preview",
  },
  { path: "/portal/shares", expected: "Shared with me" },
  { path: "/portal/activity", expected: "Activity" },
  { path: "/portal/transfers", expected: "Transfers" },
  { path: "/portal/usage", expected: "Usage & Analytics" },
  { path: "/portal/access-keys", expected: "Access keys" },
  { path: "/portal/settings", expected: "Settings" },
];

const viewports = [
  { name: "desktop", width: 1728, height: 972 },
  { name: "mobile", width: 390, height: 844 },
];

const themes = ["light", "dark"] as const;

async function seedPortalSession(page: Page, theme: (typeof themes)[number]) {
  await page.addInitScript((storage) => {
    localStorage.clear();
    localStorage.setItem("token", "docs-token");
    localStorage.setItem("user", JSON.stringify(storage.user));
    localStorage.setItem("selectedWorkspace", "portal");
    localStorage.setItem("selectedPortalAccountId", "101");
    localStorage.setItem("theme", storage.theme);
  }, { user: portalUser, theme });
}

async function openPortalRoute(page: Page, routePath: string, scenarioId: string, theme: (typeof themes)[number]) {
  const mockRegistry = await registerApiMocks(
    page,
    [
      {
        id: "portal-current-user",
        path: /^\/users\/me$/,
        body: portalUser,
      },
      ...buildBaseRules(),
    ],
    scenarioId
  );
  await page.emulateMedia({ colorScheme: theme });
  await seedPortalSession(page, theme);
  await page.goto(routePath, { waitUntil: "domcontentloaded" });
  return mockRegistry;
}

test.describe("Portal visual QA", () => {
  for (const viewport of viewports) {
    for (const theme of themes) {
      for (const route of portalRoutes) {
        test(`${viewport.name} ${theme} ${route.path}`, async ({ page }) => {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          const mockRegistry = await openPortalRoute(
            page,
            route.path,
            `portal-visual-qa-${viewport.name}-${theme}-${route.path}`,
            theme
          );

          const main = page.locator("main");
          await expect(main.getByText(route.expected, { exact: false }).first()).toBeVisible();
          await expect(main.getByText("/portal/browser", { exact: false })).toHaveCount(0);
          if (route.path.startsWith("/portal/storage-spaces/") && !route.path.includes("/objects/")) {
            await expect(main.getByRole("button", { name: "Selected storage space" })).toBeVisible();
            await expect(main.getByRole("button", { name: "Search options" })).toHaveCount(0);
          }

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
  }
});
