import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, type Page } from "@playwright/test";

import { registerApiMocks } from "./mockApi";
import { scenarios } from "./scenarios";
import type {
  DocScreenshotScenario,
  ScenarioAction,
  ScreenshotThemeVariant,
} from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, "../../../doc/docs/assets/screenshots/user");
const SCREENSHOT_VARIANTS: ScreenshotThemeVariant[] = ["light", "dark"];

async function writeDebugArtifacts(page: Page, scenarioId: string, runtimeErrors: string[]) {
  const debugPath = path.join(SCREENSHOT_DIR, `${scenarioId}.debug.png`);
  const htmlPath = path.join(SCREENSHOT_DIR, `${scenarioId}.debug.html`);
  const errorsPath = path.join(SCREENSHOT_DIR, `${scenarioId}.debug.log`);
  await page.screenshot({ path: debugPath, fullPage: true });
  const html = await page.content();
  await fs.writeFile(htmlPath, html, "utf8");
  await fs.writeFile(errorsPath, runtimeErrors.join("\n"), "utf8");
}

async function seedLocalStorage(page: Page, storage: {
  token: string;
  user: Record<string, unknown>;
  selectedWorkspace?: string;
  selectedExecutionContextId?: string;
  selectedCephAdminEndpointId?: string;
  theme?: "light" | "dark";
  extraEntries?: Record<string, string>;
}) {
  await page.addInitScript((value) => {
    localStorage.clear();
    localStorage.setItem("token", value.token);
    localStorage.setItem("user", JSON.stringify(value.user));
    if (value.selectedWorkspace) {
      localStorage.setItem("selectedWorkspace", value.selectedWorkspace);
    }
    if (value.selectedExecutionContextId) {
      localStorage.setItem("selectedExecutionContextId", value.selectedExecutionContextId);
    }
    if (value.selectedCephAdminEndpointId) {
      localStorage.setItem("selectedCephAdminEndpointId", value.selectedCephAdminEndpointId);
    }
    if (value.theme === "light" || value.theme === "dark") {
      localStorage.setItem("theme", value.theme);
    } else {
      localStorage.removeItem("theme");
    }
    Object.entries(value.extraEntries ?? {}).forEach(([key, entryValue]) => {
      localStorage.setItem(key, entryValue);
    });
  }, storage);
}

async function runAction(page: Page, action: ScenarioAction) {
  if (action.type === "wait") {
    await page.locator(action.selector).first().waitFor({ state: "visible" });
    return;
  }
  if (action.type === "click") {
    const locator = page.locator(action.selector).first();
    await locator.waitFor({ state: "visible" });
    await locator.click();
    return;
  }
  if (action.type === "select") {
    const locator = page.locator(action.selector).first();
    await locator.waitFor({ state: "visible" });
    await locator.selectOption(action.value);
    return;
  }
  const locator = page.locator(action.selector).first();
  await locator.waitFor({ state: "visible" });
  await locator.press(action.key);
}

async function captureScenarioVariant(
  basePage: Page,
  scenario: DocScreenshotScenario,
  variant: ScreenshotThemeVariant
) {
  const page = await basePage.context().newPage();
  const runtimeErrors: string[] = [];

  page.on("pageerror", (error) => {
    runtimeErrors.push(`[pageerror] ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(`[console.error] ${message.text()}`);
    }
  });
  page.on("dialog", (dialog) => {
    runtimeErrors.push(`[dialog ${dialog.type()}] ${dialog.message()}`);
    void dialog.accept();
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      runtimeErrors.push(`[http ${response.status()}] ${response.request().method()} ${response.url()}`);
    }
  });

  const debugScenarioId = `${scenario.id}.${variant}`;
  try {
    await page.emulateMedia({ colorScheme: variant });
    const mockRegistry = await registerApiMocks(page, scenario.mockRules, debugScenarioId);
    await seedLocalStorage(page, { ...scenario.storage, theme: variant });

    await page.goto(scenario.route, { waitUntil: "domcontentloaded" });
    try {
      await page.locator(scenario.waitFor).first().waitFor({ state: "visible", timeout: 30_000 });
    } catch (error) {
      await writeDebugArtifacts(page, debugScenarioId, runtimeErrors);
      throw error;
    }

    try {
      for (const action of scenario.actions ?? []) {
        await runAction(page, action);
      }

      await page.waitForTimeout(250);

      const outputPath = path.join(SCREENSHOT_DIR, `${scenario.outputBasename}.${variant}.png`);
      await page.screenshot({ path: outputPath, fullPage: false });
      if (scenario.postScreenshotWaitMs && scenario.postScreenshotWaitMs > 0) {
        await page.waitForTimeout(scenario.postScreenshotWaitMs);
      }
      for (const action of scenario.postScreenshotActions ?? []) {
        await runAction(page, action);
      }

      mockRegistry.assertNoUnmatched();
    } catch (error) {
      await writeDebugArtifacts(page, debugScenarioId, runtimeErrors);
      throw error;
    }
  } finally {
    await page.close();
  }
}

test.describe.configure({ mode: "serial" });

for (const scenario of scenarios) {
  test(`docs screenshot: ${scenario.id}`, async ({ page }) => {
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    for (const variant of SCREENSHOT_VARIANTS) {
      await captureScenarioVariant(page, scenario, variant);
    }
  });
}
