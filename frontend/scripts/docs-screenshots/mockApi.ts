import type { Page } from "@playwright/test";
import type { MockRule } from "./types";

type RegisteredApiMocks = {
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
  const currentUserRule = rules.find(
    (candidate) => candidate.id.includes("current-user") && typeof candidate.body !== "function",
  );
  const currentUser = currentUserRule?.body;
  const effectiveRules: MockRule[] = currentUser
    ? [
        ...rules,
        {
          id: "current-auth-session",
          path: /^\/auth\/session$/,
          body: {
            authenticated: true,
            user: currentUser,
            session: null,
            auth_session: {
              id: `docs-${scenarioId}`,
              auth_type: "password",
              mfa_verified_at: null,
              idle_expires_at: "2026-08-18T12:00:00Z",
              absolute_expires_at: "2026-08-24T12:00:00Z",
            },
          },
        },
        { id: "login-oidc-providers", path: /^\/auth\/oidc\/providers$/, body: [] },
        { id: "login-ldap-providers", path: /^\/auth\/ldap\/providers$/, body: [] },
      ]
    : rules;

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

    const rule = effectiveRules.find((candidate) => {
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

    if (rule.delayMs && rule.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, rule.delayMs));
    }

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
