import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneralSettings } from "./api/appSettings";
import { RequirePortalAccess, createAppRoutes } from "./router";

const mocks = vi.hoisted(() => ({
  fetchCurrentUser: vi.fn(),
  generalSettings: {} as GeneralSettings,
}));

vi.mock("./components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    generalSettings: mocks.generalSettings,
  }),
}));

vi.mock("./api/users", () => ({
  fetchCurrentUser: mocks.fetchCurrentUser,
}));

const baseSettings: GeneralSettings = {
  manager_enabled: true,
  ceph_admin_enabled: false,
  storage_ops_enabled: false,
  browser_enabled: true,
  browser_root_enabled: true,
  browser_manager_enabled: true,
  browser_portal_enabled: true,
  browser_ceph_admin_enabled: false,
  portal_enabled: true,
  billing_enabled: false,
  endpoint_status_enabled: false,
  quota_alerts_enabled: false,
  usage_history_enabled: false,
  bucket_migration_enabled: true,
  bucket_purge_enabled: false,
  bucket_compare_enabled: true,
  bucket_integrity_check_enabled: true,
  manager_ceph_s3_user_keys_enabled: true,
  allow_login_access_keys: false,
  allow_login_endpoint_list: false,
  allow_login_custom_endpoint: false,
  allow_user_private_connections: false,
};

function findRouteByPath(routes: Array<{ path?: string; children?: unknown[] }>, path: string): { path?: string; children?: unknown[] } | null {
  for (const route of routes) {
    if (route.path === path) return route;
    const found = findRouteByPath((route.children ?? []) as Array<{ path?: string; children?: unknown[] }>, path);
    if (found) return found;
  }
  return null;
}

describe("portal routes", () => {
  beforeEach(() => {
    mocks.generalSettings = { ...baseSettings };
    mocks.fetchCurrentUser.mockResolvedValue({
      id: 1,
      email: "admin@example.com",
      role: "ui_admin",
      authType: "password",
      account_links: [{ account_id: 24, account_admin: true, account_role: "portal_none" }],
    });
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("keeps only canonical storage workspace routes under portal", () => {
    const portalRoute = findRouteByPath(createAppRoutes() as Array<{ path?: string; children?: unknown[] }>, "/portal");
    const childPaths = ((portalRoute?.children ?? []) as Array<{ path?: string }>).map((route) => route.path).filter(Boolean);

    expect(childPaths).toEqual([
      "profile",
      "storage-spaces",
      "storage-spaces/:spaceId/objects/*",
      "storage-spaces/:spaceId",
      "access-keys",
      "shares",
      "requests",
      "history",
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
      "iam-compliance",
      "account-settings",
    ].forEach((path) => {
      expect(childPaths.has(path)).toBe(false);
    });
  });

  it("redirects /portal to unauthorized when no explicit portal account role exists", async () => {
    window.localStorage.setItem("token", "test-token");
    window.localStorage.setItem(
      "user",
      JSON.stringify({
        id: 1,
        email: "admin@example.com",
        role: "ui_admin",
        authType: "password",
        account_links: [{ account_id: 24, account_admin: true, account_role: "portal_none" }],
      })
    );

    render(
      <MemoryRouter initialEntries={["/portal"]}>
        <Routes>
          <Route element={<RequirePortalAccess />}>
            <Route path="/portal" element={<h1>Portal workspace</h1>} />
          </Route>
          <Route path="/unauthorized" element={<h1>Unauthorized access</h1>} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole("heading", { name: "Unauthorized access" })).toBeInTheDocument();
  });

  it("allows /portal when a refreshed superadmin session has portal_manager", async () => {
    mocks.fetchCurrentUser.mockResolvedValue({
      id: 1,
      email: "admin@example.com",
      role: "ui_superadmin",
      authType: "password",
      account_links: [{ account_id: 24, account_admin: true, account_role: "portal_manager" }],
    });
    window.localStorage.setItem("token", "test-token");
    window.localStorage.setItem(
      "user",
      JSON.stringify({
        id: 1,
        email: "admin@example.com",
        role: "ui_superadmin",
        authType: "password",
        account_links: [{ account_id: 24, account_admin: true, account_role: "portal_none" }],
      })
    );

    render(
      <MemoryRouter initialEntries={["/portal"]}>
        <Routes>
          <Route element={<RequirePortalAccess />}>
            <Route path="/portal" element={<h1>Portal workspace</h1>} />
          </Route>
          <Route path="/unauthorized" element={<h1>Unauthorized access</h1>} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole("heading", { name: "Portal workspace" })).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("user") ?? "{}").account_links[0].account_role).toBe(
      "portal_manager"
    );
  });
});
