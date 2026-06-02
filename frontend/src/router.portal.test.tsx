import { describe, expect, it } from "vitest";
import { createAppRoutes } from "./router";

function findRouteByPath(routes: Array<{ path?: string; children?: unknown[] }>, path: string): { path?: string; children?: unknown[] } | null {
  for (const route of routes) {
    if (route.path === path) return route;
    const found = findRouteByPath((route.children ?? []) as Array<{ path?: string; children?: unknown[] }>, path);
    if (found) return found;
  }
  return null;
}

describe("portal routes", () => {
  it("keeps only canonical storage workspace routes under portal", () => {
    const portalRoute = findRouteByPath(createAppRoutes() as Array<{ path?: string; children?: unknown[] }>, "/portal");
    const childPaths = ((portalRoute?.children ?? []) as Array<{ path?: string }>).map((route) => route.path).filter(Boolean);

    expect(childPaths).toEqual([
      "storage-spaces",
      "storage-spaces/:spaceId/objects/*",
      "storage-spaces/:spaceId",
      "shares",
      "activity",
      "transfers",
      "usage",
      "settings",
    ]);
    expect(childPaths).not.toContain("browser");
    expect(childPaths).not.toContain("buckets");
    expect(childPaths).not.toContain("manage");
    expect(childPaths).not.toContain("billing");
  });

  it("does not expose Browser Manager Admin or mock administration pages inside portal", () => {
    const portalRoute = findRouteByPath(createAppRoutes() as Array<{ path?: string; children?: unknown[] }>, "/portal");
    const childPaths = new Set(((portalRoute?.children ?? []) as Array<{ path?: string }>).map((route) => route.path).filter(Boolean));

    [
      "admin",
      "manager",
      "browser",
      "buckets",
      "users",
      "groups",
      "policies",
      "access-keys",
      "iam-compliance",
      "account-settings",
    ].forEach((path) => {
      expect(childPaths.has(path)).toBe(false);
    });
  });
});
