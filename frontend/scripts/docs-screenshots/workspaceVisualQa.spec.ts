import { expect, test, type Page } from "@playwright/test";

import { registerApiMocks } from "./mockApi";
import { scenarios } from "./scenarios";
import type { DocScreenshotScenario, ScenarioAction, ScreenshotThemeVariant } from "./types";

const ROUTE_CASES: Array<{
  scenarioId: string;
  workspace: string;
  route?: string;
  waitFor?: string;
  selectedExecutionContextId?: string;
  expectNormalBrowserUsageHidden?: boolean;
  expectPortalBrowser?: boolean;
  runScenarioWaitActions?: boolean;
}> = [
  { scenarioId: "workspace-admin", workspace: "admin", route: "/admin" },
  { scenarioId: "workspace-manager", workspace: "manager", route: "/manager" },
  {
    scenarioId: "feature-objects-browser",
    workspace: "browser",
    route: "/browser",
    expectNormalBrowserUsageHidden: true,
  },
  {
    scenarioId: "workspace-browser",
    workspace: "browser-portal",
    route: "/browser?bucket=rgw-portal-genomics-2026",
    waitFor: "main button:has-text('genomics-2026')",
    selectedExecutionContextId: "101",
    expectPortalBrowser: true,
    runScenarioWaitActions: false,
  },
  { scenarioId: "workspace-ceph-admin", workspace: "ceph-admin", route: "/ceph-admin", waitFor: "h1:has-text('Ceph Admin')" },
  { scenarioId: "gallery-storage-ops-dashboard", workspace: "storage-ops", route: "/storage-ops" },
  { scenarioId: "workspace-portal", workspace: "portal", route: "/portal" },
];

const VIEWPORTS = [
  { name: "desktop", width: 1728, height: 972 },
  { name: "mobile", width: 390, height: 844 },
] as const;

const THEMES: ScreenshotThemeVariant[] = ["light", "dark"];

function scenarioById(id: string): DocScreenshotScenario {
  const scenario = scenarios.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`Missing docs screenshot scenario '${id}'`);
  return scenario;
}

async function seedLocalStorage(
  page: Page,
  scenario: DocScreenshotScenario,
  theme: ScreenshotThemeVariant,
  overrides: Partial<DocScreenshotScenario["storage"]> = {}
) {
  await page.addInitScript((storage) => {
    localStorage.clear();
    localStorage.setItem("token", storage.token);
    localStorage.setItem("user", JSON.stringify(storage.user));
    if (storage.selectedWorkspace) localStorage.setItem("selectedWorkspace", storage.selectedWorkspace);
    if (storage.selectedExecutionContextId) {
      localStorage.setItem("selectedExecutionContextId", storage.selectedExecutionContextId);
    }
    if (storage.selectedPortalAccountId) localStorage.setItem("selectedPortalAccountId", storage.selectedPortalAccountId);
    if (storage.selectedCephAdminEndpointId) {
      localStorage.setItem("selectedCephAdminEndpointId", storage.selectedCephAdminEndpointId);
    }
    localStorage.setItem("theme", storage.theme);
    Object.entries(storage.extraEntries ?? {}).forEach(([key, value]) => localStorage.setItem(key, value));
  }, { ...scenario.storage, ...overrides, theme });
}

async function runAction(page: Page, action: ScenarioAction) {
  if (action.type === "wait") {
    await page.locator(action.selector).first().waitFor({ state: "visible", timeout: 30_000 });
    return;
  }
  if (action.type === "click") {
    await page.locator(action.selector).first().click({ timeout: 15_000 });
    return;
  }
  if (action.type === "fill") {
    await page.locator(action.selector).first().fill(action.value, { timeout: 15_000 });
    return;
  }
  if (action.type === "select") {
    await page.locator(action.selector).first().selectOption(action.value, { timeout: 15_000 });
    return;
  }
  await page.locator(action.selector).first().press(action.key, { timeout: 15_000 });
}

async function openWorkspaceCase(
  page: Page,
  scenario: DocScreenshotScenario,
  route: string,
  waitFor: string,
  theme: ScreenshotThemeVariant,
  scenarioId: string,
  storageOverrides: Partial<DocScreenshotScenario["storage"]> = {},
  runScenarioWaitActions = true
) {
  const mockRegistry = await registerApiMocks(
    page,
    [
      {
        id: "current-user",
        path: /^\/users\/me$/,
        body: scenario.storage.user,
      },
      ...scenario.mockRules,
    ],
    scenarioId
  );

  await page.emulateMedia({ colorScheme: theme });
  await seedLocalStorage(page, scenario, theme, storageOverrides);
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.locator(waitFor).first().waitFor({ state: "visible", timeout: 30_000 });
  if (runScenarioWaitActions) {
    for (const action of scenario.actions ?? []) {
      if (action.type !== "wait") break;
      await runAction(page, action);
    }
  }
  await page.waitForTimeout(100);
  return mockRegistry;
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const width = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    return width - window.innerWidth;
  });
  expect(overflow).toBeLessThanOrEqual(2);
}

async function expectShellVisibleAndSeparated(page: Page, viewportName: string) {
  const topbar = page.locator("[data-topbar]");
  const main = page.locator("main");
  await expect(topbar).toBeVisible();
  await expect(main).toBeVisible();

  const geometry = await page.evaluate(() => {
    const topbar = document.querySelector("[data-topbar]");
    const main = document.querySelector("main");
    const sidebar = document.querySelector("aside[data-sidebar-variant='desktop']");
    const topbarRect = topbar?.getBoundingClientRect();
    const mainRect = main?.getBoundingClientRect();
    const sidebarRect = sidebar?.getBoundingClientRect();
    return {
      topbar: topbarRect ? { top: topbarRect.top, bottom: topbarRect.bottom, width: topbarRect.width, height: topbarRect.height } : null,
      main: mainRect ? { top: mainRect.top, left: mainRect.left, width: mainRect.width, height: mainRect.height } : null,
      sidebar: sidebarRect
        ? { top: sidebarRect.top, right: sidebarRect.right, width: sidebarRect.width, height: sidebarRect.height }
        : null,
    };
  });

  expect(geometry.topbar?.height ?? 0).toBeGreaterThan(40);
  expect(geometry.main?.height ?? 0).toBeGreaterThan(200);
  expect(geometry.main?.top ?? 0).toBeGreaterThanOrEqual(geometry.topbar?.bottom ?? 0);

  const sidebarWidth = geometry.sidebar?.width ?? 0;
  if (viewportName === "desktop") {
    if (sidebarWidth > 0) {
      expect(sidebarWidth).toBeGreaterThan(48);
      expect(geometry.main?.left ?? 0).toBeGreaterThanOrEqual(geometry.sidebar?.right ?? 0);
    }
  } else {
    expect(sidebarWidth).toBeLessThanOrEqual(1);
  }
}

async function expectKeyboardFocus(page: Page) {
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => {
    const active = document.activeElement;
    if (!active) return null;
    const rect = active.getBoundingClientRect();
    return {
      tag: active.tagName,
      width: rect.width,
      height: rect.height,
      ariaLabel: active.getAttribute("aria-label"),
      text: active.textContent?.trim().slice(0, 80) ?? "",
    };
  });
  expect(focused?.tag).not.toBe("BODY");
  expect(focused?.width ?? 0).toBeGreaterThan(0);
  expect(focused?.height ?? 0).toBeGreaterThan(0);
}

async function expectCriticalButtonTextFits(page: Page) {
  const clipped = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll("main button, main a")).filter((element) => {
      const rect = element.getBoundingClientRect();
      const text = element.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && text.length > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    return candidates
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          text: element.textContent?.replace(/\s+/g, " ").trim().slice(0, 80) ?? "",
          width: rect.width,
          scrollWidth: element.scrollWidth,
          overflowX: window.getComputedStyle(element).overflowX,
        };
      })
      .filter((item) => item.scrollWidth - item.width > 2 && item.overflowX === "hidden")
      .slice(0, 5);
  });
  expect(clipped).toEqual([]);
}

async function expectPrimarySurfacesUsePlainTheme(page: Page) {
  const offenders = await page.evaluate(() => {
    const selectors = [
      "main > [class*='bg-gradient']",
      "main > [class*='backdrop-blur']",
      "main [class*='ui-surface-card'][class*='bg-gradient']",
      "main [class*='ui-surface-card'][class*='backdrop-blur']",
      "main [class*='ui-surface-muted'][class*='bg-gradient']",
      "main [class*='ui-surface-muted'][class*='backdrop-blur']",
      "main [class*='shadow-2xl']",
    ];
    return selectors.flatMap((selector) =>
      Array.from(document.querySelectorAll(selector)).map((element) => ({
        selector,
        className: element.getAttribute("class")?.slice(0, 160) ?? "",
      }))
    );
  });
  expect(offenders).toEqual([]);
}

async function expectBrowserNormalUsageHidden(page: Page) {
  await expect(page.getByText("Usage & Metrics", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Loading usage...", { exact: true })).toHaveCount(0);
}

async function expectBrowserSidebarShell(page: Page, viewportName: string) {
  if (viewportName === "desktop") {
    const sidebar = page.locator("aside[data-sidebar-variant='desktop']");
    await expect(sidebar.getByText("S3 Manager", { exact: true })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: "Collapse sidebar" })).toBeVisible();
    const geometry = await sidebar.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        height: rect.height,
        viewportHeight: window.innerHeight,
      };
    });
    expect(Math.abs(geometry.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.height - geometry.viewportHeight)).toBeLessThanOrEqual(2);
    return;
  }

  await page.getByRole("button", { name: "Open navigation" }).click();
  const sidebar = page.locator("aside[data-sidebar-variant='mobile']");
  await expect(sidebar.getByText("S3 Manager", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sidebar).toHaveClass(/-translate-x-full/);
}

async function expectPortalBrowserSidebar(page: Page, viewportName: string) {
  let openedMobileDrawer = false;
  const sidebar =
    viewportName === "desktop"
      ? page.locator("aside[data-sidebar-variant='desktop']")
      : page.locator("aside[data-sidebar-variant='mobile']");
  if (viewportName !== "desktop") {
    await page.getByRole("button", { name: "Open navigation" }).click();
    openedMobileDrawer = true;
  }
  await expect(sidebar.getByText("Storage Spaces", { exact: true }).first()).toBeVisible();
  await expect(sidebar.getByText("genomics-2026", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("rgw-portal-genomics-2026", { exact: false })).toHaveCount(0);
  await expect(page.getByText("rgw-portal-photos", { exact: false })).toHaveCount(0);
  await expect(page.getByText("rgw-portal-datasets", { exact: false })).toHaveCount(0);
  await expect(sidebar.getByText("Open in Portal", { exact: true }).first()).toBeVisible();
  await expect(sidebar.getByText(/8\.3\s*TB/).first()).toBeVisible();
  if (openedMobileDrawer) {
    await page.keyboard.press("Escape");
    await expect(sidebar).toHaveClass(/-translate-x-full/);
  }
}

async function expectManagerKpiQuotaMeters(page: Page) {
  const meters = await page.evaluate(() =>
    Array.from(document.querySelectorAll("main [role='meter']")).map((element) => ({
      label: element.getAttribute("aria-label"),
      value: Number(element.getAttribute("aria-valuenow") ?? "0"),
    }))
  );
  const expectedLabels = ["Storage used quota usage", "Buckets quota usage", "Objects quota usage"];
  const quotaMeters = meters.filter((meter) => meter.label && expectedLabels.includes(meter.label));

  expect(quotaMeters.map((meter) => meter.label)).toEqual(expect.arrayContaining(expectedLabels));
  expect(quotaMeters).toHaveLength(expectedLabels.length);
  for (const meter of quotaMeters) {
    expect(meter.value).toBeGreaterThan(0);
  }
}

async function expectManagerKpiValuesAligned(page: Page) {
  const valueRows = await page.evaluate(() =>
    Array.from(document.querySelectorAll("main [data-kpi-card]")).map((card) => {
      const cardRect = card.getBoundingClientRect();
      const value = card.querySelector("[data-kpi-value]");
      const valueRect = value?.getBoundingClientRect();
      return {
        label: card.getAttribute("data-kpi-card"),
        cardTop: Math.round(cardRect.top),
        valueTop: valueRect ? Math.round(valueRect.top) : null,
      };
    })
  );
  expect(valueRows).toHaveLength(4);

  const rows = new Map<number, number[]>();
  for (const item of valueRows) {
    if (item.valueTop == null) continue;
    rows.set(item.cardTop, [...(rows.get(item.cardTop) ?? []), item.valueTop]);
  }

  for (const rowValues of rows.values()) {
    if (rowValues.length <= 1) continue;
    const minTop = Math.min(...rowValues);
    const maxTop = Math.max(...rowValues);
    expect(maxTop - minTop).toBeLessThanOrEqual(2);
  }
}

async function expectManagerQuotaStatusRows(page: Page) {
  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll("main [data-quota-status-row]")).map((element) => ({
      label: element.getAttribute("data-quota-status-row"),
      text: element.textContent?.replace(/\s+/g, " ").trim() ?? "",
    }))
  );

  expect(rows.map((row) => row.label)).toEqual(["Storage", "Buckets", "Objects", "Users", "Roles", "Groups"]);
  expect(rows.some((row) => row.text.includes("Bandwidth (month)"))).toBe(false);
  expect(rows.find((row) => row.label === "Buckets")?.text).toContain(" / ");
  expect(rows.find((row) => row.label === "Users")?.text).toContain(" / ");
  expect(rows.find((row) => row.label === "Roles")?.text).toContain(" / ");
  expect(rows.find((row) => row.label === "Groups")?.text).toContain(" / ");
}

test.describe("Workspace visual QA", () => {
  for (const routeCase of ROUTE_CASES) {
    const scenario = scenarioById(routeCase.scenarioId);
    for (const theme of THEMES) {
      for (const viewport of VIEWPORTS) {
        test(`${routeCase.workspace} ${theme} ${viewport.name}`, async ({ page }) => {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          const route = routeCase.route ?? scenario.route;
          const mockRegistry = await openWorkspaceCase(
            page,
            scenario,
            route,
            routeCase.waitFor ?? scenario.waitFor,
            theme,
            `${routeCase.workspace}-${theme}-${viewport.name}`,
            routeCase.selectedExecutionContextId
              ? { selectedExecutionContextId: routeCase.selectedExecutionContextId }
              : {},
            routeCase.runScenarioWaitActions ?? true
          );

          await expectShellVisibleAndSeparated(page, viewport.name);
          await expectNoHorizontalOverflow(page);
          await expectKeyboardFocus(page);
          await expectCriticalButtonTextFits(page);
          await expectPrimarySurfacesUsePlainTheme(page);
          if (routeCase.workspace === "manager") {
            await expectManagerKpiQuotaMeters(page);
            await expectManagerKpiValuesAligned(page);
            await expectManagerQuotaStatusRows(page);
          }
          if (routeCase.expectNormalBrowserUsageHidden) {
            await expectBrowserNormalUsageHidden(page);
          }
          if (routeCase.workspace === "browser" || routeCase.workspace === "browser-portal") {
            await expectBrowserSidebarShell(page, viewport.name);
          }
          if (routeCase.expectPortalBrowser) {
            await expectPortalBrowserSidebar(page, viewport.name);
          }

          mockRegistry.assertNoUnmatched();
        });
      }
    }
  }
});
