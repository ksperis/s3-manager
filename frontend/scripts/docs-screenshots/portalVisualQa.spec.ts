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

type PortalVisualLocale = "en" | "fr" | "de";

const portalRoutes = [
  { path: "/portal", expected: { en: "Dashboard", fr: "Tableau de bord", de: "Dashboard" } },
  { path: "/portal/storage-spaces", expected: { en: "Spaces", fr: "Espaces", de: "Bereiche" } },
  { path: "/portal/storage-spaces/genomics-2026?prefix=raw-data%2F2024%2F03%2F", expected: { en: "sample_001.fastq.gz", fr: "sample_001.fastq.gz", de: "sample_001.fastq.gz" } },
  {
    path: "/portal/storage-spaces/genomics-2026/objects/raw-data/2024/03/sample_001.fastq.gz",
    expected: { en: "Quick preview", fr: "Aperçu rapide", de: "Schnellvorschau" },
  },
  { path: "/portal/shares", expected: { en: "Collaborators", fr: "Collaborateurs", de: "Mitwirkende" } },
  { path: "/portal/activity", expected: { en: "Activity", fr: "Activité", de: "Aktivität" } },
  { path: "/portal/transfers", expected: { en: "Transfers", fr: "Transferts", de: "Übertragungen" } },
  { path: "/portal/usage", expected: { en: "Usage & Analytics", fr: "Utilisation et analyses", de: "Nutzung und Analysen" } },
  { path: "/portal/access-keys", expected: { en: "External tools", fr: "Outils externes", de: "Externe Werkzeuge" } },
  { path: "/portal/settings", expected: { en: "Settings", fr: "Paramètres", de: "Einstellungen" } },
];

const viewports = [
  { name: "desktop", width: 1728, height: 972 },
  { name: "mobile", width: 390, height: 844 },
];

const themes = ["light", "dark"] as const;

const locales: PortalVisualLocale[] = ["en", "fr", "de"];

function buildPortalUser(language: PortalVisualLocale) {
  return { ...portalUser, ui_language: language };
}

async function seedPortalSession(page: Page, theme: (typeof themes)[number], language: PortalVisualLocale) {
  const user = buildPortalUser(language);
  await page.addInitScript((storage) => {
    localStorage.clear();
    localStorage.setItem("token", "docs-token");
    localStorage.setItem("user", JSON.stringify(storage.user));
    localStorage.setItem("selectedWorkspace", "portal");
    localStorage.setItem("selectedPortalAccountId", "101");
    localStorage.setItem("theme", storage.theme);
  }, { user, theme });
}

async function openPortalRoute(page: Page, routePath: string, scenarioId: string, theme: (typeof themes)[number], language: PortalVisualLocale) {
  const user = buildPortalUser(language);
  const mockRegistry = await registerApiMocks(
    page,
    [
      {
        id: "portal-current-user",
        path: /^\/users\/me$/,
        body: user,
      },
      ...buildBaseRules(),
    ],
    scenarioId
  );
  await page.emulateMedia({ colorScheme: theme });
  await seedPortalSession(page, theme, language);
  await page.goto(routePath, { waitUntil: "domcontentloaded" });
  return mockRegistry;
}

test.describe("Portal visual QA", () => {
  for (const viewport of viewports) {
    for (const theme of themes) {
      for (const language of locales) {
        for (const route of portalRoutes) {
          test(`${viewport.name} ${theme} ${language} ${route.path}`, async ({ page }) => {
            await page.setViewportSize({ width: viewport.width, height: viewport.height });
            const mockRegistry = await openPortalRoute(
              page,
              route.path,
              `portal-visual-qa-${viewport.name}-${theme}-${language}-${route.path}`,
              theme,
              language
            );

            const main = page.locator("main");
            await expect(main.getByText(route.expected[language], { exact: false }).first()).toBeVisible();
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
  }
});
