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
    { account_id: 101, role: "portal_user", account_role: "portal_user", account_admin: false },
  ],
  capabilities: {
    can_manage_buckets: true,
    can_manage_iam: false,
    access_browser: false,
  },
};

type PortalVisualLocale = "en" | "fr" | "de";

const portalRoutes = [
  {
    path: "/portal",
    expected: { en: "Dashboard", fr: "Tableau de bord", de: "Dashboard" },
  },
  {
    path: "/portal/storage-spaces",
    expected: { en: "Spaces", fr: "Espaces", de: "Bereiche" },
  },
  {
    path: "/portal/storage-spaces/genomics-2026?prefix=raw-data%2F2024%2F03%2F",
    expected: {
      en: "sample_001.fastq.gz",
      fr: "sample_001.fastq.gz",
      de: "sample_001.fastq.gz",
    },
  },
  {
    path: "/portal/storage-spaces/genomics-2026?tab=settings",
    expected: {
      en: "Version history settings",
      fr: "Paramètres de l’historique des versions",
      de: "Einstellungen für den Versionsverlauf",
    },
  },
  {
    path: "/portal/storage-spaces/genomics-2026?tab=statistics",
    expected: {
      en: "File composition",
      fr: "Composition des fichiers",
      de: "Dateizusammensetzung",
    },
  },
  {
    path: "/portal/storage-spaces/genomics-2026/objects/raw-data/2024/03/sample_001.fastq.gz",
    expected: {
      en: "Quick preview",
      fr: "Aperçu rapide",
      de: "Schnellvorschau",
    },
  },
  {
    path: "/portal/shares",
    expected: { en: "Collaborators", fr: "Collaborateurs", de: "Mitwirkende" },
  },
  {
    path: "/portal/history",
    expected: { en: "History", fr: "Historique", de: "Verlauf" },
  },
  {
    path: "/portal/history?view=transfers",
    expected: { en: "Activity", fr: "Activité", de: "Aktivität" },
  },
  {
    path: "/portal/usage",
    expected: {
      en: "Storage health",
      fr: "État du stockage",
      de: "Speicherstatus",
    },
  },
  {
    path: "/portal/access-keys",
    expected: {
      en: "External S3 tools",
      fr: "Outils S3 externes",
      de: "Externe S3-Werkzeuge",
    },
  },
  {
    path: "/portal/requests",
    expected: {
      en: "Help requests",
      fr: "Demandes d'aide",
      de: "Hilfeanfragen",
    },
  },
  {
    path: "/portal/settings",
    expected: { en: "Settings", fr: "Paramètres", de: "Einstellungen" },
  },
];

const viewports = [
  { name: "desktop", width: 1728, height: 972 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 390, height: 844 },
];

const themes = ["light", "dark"] as const;

const locales: PortalVisualLocale[] = ["en", "fr", "de"];

const connectToolLabels = {
  en: {
    tab: "Connect tool",
    configure: "Configure a tool",
    dialog: "Connect a tool",
    advanced: "Advanced tools and manual setup",
    close: "Close modal",
    manual: "Other S3-compatible application",
    directConnect: "Connect Myself",
  },
  fr: {
    tab: "Connecter un outil",
    configure: "Configurer un outil",
    dialog: "Connecter un outil",
    advanced: "Outils avancés et configuration manuelle",
    close: "Fermer la fenêtre",
    manual: "Autre application compatible S3",
    directConnect: "Connecter Moi-même",
  },
  de: {
    tab: "Werkzeug verbinden",
    configure: "Werkzeug konfigurieren",
    dialog: "Werkzeug verbinden",
    advanced: "Erweiterte Werkzeuge und manuelle Einrichtung",
    close: "Dialog schließen",
    manual: "Andere S3-kompatible Anwendung",
    directConnect: "Verbinden Ich selbst",
  },
} satisfies Record<
  PortalVisualLocale,
  { tab: string; configure: string; dialog: string; advanced: string; close: string; manual: string; directConnect: string }
>;

function buildPortalUser(language: PortalVisualLocale) {
  return { ...portalUser, ui_language: language };
}

async function seedPortalSession(
  page: Page,
  theme: (typeof themes)[number],
  language: PortalVisualLocale,
) {
  const user = buildPortalUser(language);
  await page.addInitScript(
    (storage) => {
      localStorage.clear();
      localStorage.setItem("token", "docs-token");
      localStorage.setItem("user", JSON.stringify(storage.user));
      localStorage.setItem("selectedWorkspace", "portal");
      localStorage.setItem("selectedPortalAccountId", "101");
      localStorage.setItem("theme", storage.theme);
    },
    { user, theme },
  );
}

async function openPortalRoute(
  page: Page,
  routePath: string,
  scenarioId: string,
  theme: (typeof themes)[number],
  language: PortalVisualLocale,
) {
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
    scenarioId,
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
          test(`${viewport.name} ${theme} ${language} ${route.path}`, async ({
            page,
          }) => {
            await page.setViewportSize({
              width: viewport.width,
              height: viewport.height,
            });
            const mockRegistry = await openPortalRoute(
              page,
              route.path,
              `portal-visual-qa-${viewport.name}-${theme}-${language}-${route.path}`,
              theme,
              language,
            );

            const main = page.locator("main");
            await expect(
              main
                .getByText(route.expected[language], { exact: false })
                .first(),
            ).toBeVisible();
            await expect(
              main.getByText("/portal/browser", { exact: false }),
            ).toHaveCount(0);
            if (
              route.path.startsWith("/portal/storage-spaces/") &&
              !route.path.includes("/objects/") &&
              !route.path.includes("tab=settings") &&
              !route.path.includes("tab=statistics")
            ) {
              await expect(
                main.getByRole("button", { name: "Selected storage space" }),
              ).toBeVisible();
              await expect(
                main.getByRole("button", { name: "Search options" }),
              ).toHaveCount(0);
            }
            if (route.path === "/portal/access-keys") {
              const labels = connectToolLabels[language];
              const directConnectButton = main.getByRole("button", {
                name: new RegExp(`^${labels.directConnect}`),
              });
              await directConnectButton.click();
              const directDialog = page.getByRole("dialog", { name: labels.dialog });
              await expect(directDialog).toBeVisible();
              await page.keyboard.press("Escape");
              await expect(directDialog).toBeHidden();
              await expect(directConnectButton).toBeFocused();
              await main.getByRole("tab", { name: labels.tab }).click();
              await main.getByRole("button", { name: labels.configure }).click();
              const dialog = page.getByRole("dialog", { name: labels.dialog });
              await expect(dialog).toBeVisible();
              await expect(dialog.getByText("Cyberduck / Mountain Duck", { exact: true })).toBeVisible();
              await expect(dialog.getByText("WinSCP", { exact: true })).toBeVisible();
              await expect(dialog.locator("details")).not.toHaveAttribute("open", "");
              await expect(dialog.getByText(labels.advanced, { exact: true })).toBeVisible();
              await expect(dialog.getByRole("button", { name: labels.close })).toBeVisible();
              await dialog.getByText(labels.advanced, { exact: true }).click();
              await expect(dialog.locator("details")).toHaveAttribute("open", "");
              await expect(dialog.getByText("rclone", { exact: true })).toBeVisible();
              await expect(dialog.getByRole("heading", { name: labels.manual })).toBeVisible();
              await page.keyboard.press("Escape");
              await expect(dialog).toBeHidden();
              await expect(main.getByRole("button", { name: labels.configure })).toBeFocused();
            }

            const horizontalOverflow = await page.evaluate(
              () =>
                Math.max(
                  document.documentElement.scrollWidth,
                  document.body.scrollWidth,
                ) - window.innerWidth,
            );
            expect(horizontalOverflow).toBeLessThanOrEqual(2);

            let activeElement = await page.evaluate(() => {
              const active = document.activeElement;
              return {
                tag: active?.tagName ?? null,
                ariaLabel: active?.getAttribute("aria-label") ?? null,
                text: active?.textContent?.trim().slice(0, 80) ?? null,
              };
            });
            if (activeElement.tag === "BODY") {
              await page.keyboard.press("Tab");
              activeElement = await page.evaluate(() => {
                const active = document.activeElement;
                return {
                  tag: active?.tagName ?? null,
                  ariaLabel: active?.getAttribute("aria-label") ?? null,
                  text: active?.textContent?.trim().slice(0, 80) ?? null,
                };
              });
            }
            expect(activeElement.tag).not.toBe("BODY");

            mockRegistry.assertNoUnmatched();
          });
        }
      }
    }
  }
});
