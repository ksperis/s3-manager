import type { Page } from "@playwright/test";
import type { MockRule } from "./types";

export type RegisteredApiMocks = {
  assertNoUnmatched: () => void;
};

function normalizePath(pathname: string): string {
  if (!pathname.startsWith("/api")) return pathname;
  const trimmed = pathname.slice(4);
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function serializeBody(body: unknown): string {
  if (body === undefined) return "";
  return JSON.stringify(body);
}

export async function registerApiMocks(page: Page, rules: MockRule[], scenarioId: string): Promise<RegisteredApiMocks> {
  const unmatchedRequests: string[] = [];

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api")) {
      await route.continue();
      return;
    }
    const path = normalizePath(url.pathname);
    const requestBodyText = request.postData() ?? "";

    const rule = rules.find((candidate) => {
      if (candidate.method && candidate.method !== method) return false;
      return candidate.path.test(path);
    });

    if (!rule) {
      const signature = `${method} ${path}`;
      unmatchedRequests.push(signature);
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          detail: `No mock configured for ${signature} (scenario: ${scenarioId})`,
        }),
      });
      return;
    }

    const payload =
      typeof rule.body === "function"
        ? rule.body({ url, method, requestBodyText })
        : rule.body;

    const status = rule.status ?? 200;
    if (payload === undefined || status === 204) {
      await route.fulfill({ status: status === 200 ? 204 : status });
      return;
    }

    await route.fulfill({
      status,
      contentType: "application/json",
      body: serializeBody(payload),
    });
  });

  return {
    assertNoUnmatched: () => {
      if (unmatchedRequests.length === 0) return;
      const unique = Array.from(new Set(unmatchedRequests)).sort();
      throw new Error(
        `Unmatched API routes in scenario '${scenarioId}':\n${unique.join("\n")}`
      );
    },
  };
}
