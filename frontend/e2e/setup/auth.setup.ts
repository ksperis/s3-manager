import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import { expect, test as setup, type APIResponse, type Page } from "@playwright/test";

import {
  E2E_ADMIN_EMAIL,
  E2E_ADMIN_FULL_NAME,
  E2E_ADMIN_PASSWORD,
  E2E_BOOTSTRAP_URL_PATH,
  E2E_AUTH_ADMIN_EMAIL,
  E2E_AUTH_ADMIN_FULL_NAME,
  E2E_AUTH_ADMIN_PASSWORD,
  E2E_BROWSER_CONNECTION_NAME,
  E2E_BUCKET_NAME,
  E2E_FRONTEND_BASE_URL,
  E2E_S3_ACCESS_KEY,
  E2E_S3_ENDPOINT,
  E2E_S3_REGION,
  E2E_S3_SECRET_KEY,
  E2E_STORAGE_STATE_PATH,
  E2E_USER_EMAIL,
  E2E_USER_FULL_NAME,
  E2E_USER_PASSWORD,
} from "../helpers/config";

type PaginatedUsersResponse = {
  items: Array<{
    id: number;
    email: string;
    role?: string | null;
    is_active?: boolean;
  }>;
};

type CreatedUser = {
  id: number;
  email: string;
};

type PrivateConnection = {
  id: number;
  name: string;
};

type PrivateStorageEndpoint = {
  id: number;
  endpoint_url: string;
  is_default: boolean;
};

type UserSeed = {
  email: string;
  password: string;
  fullName: string;
  role: "ui_admin" | "ui_user";
  canCreateManualPrivateConnections?: boolean;
  browserAdvancedFeaturesEnabled?: boolean;
};

async function assertOk(response: APIResponse, message: string) {
  const ok = response.ok();
  const detail = ok ? "" : ` (${response.status()} ${await response.text()})`;
  expect(ok, `${message}${detail}`).toBeTruthy();
}

async function waitForBootstrapUrl(timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = (await readFile(E2E_BOOTSTRAP_URL_PATH, "utf8")).trim();
      if (value) return value;
    } catch {
      // The backend wrapper writes the file immediately after migrations and token issuance.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the first-admin bootstrap URL");
}

async function csrfHeaders(page: Page): Promise<Record<string, string>> {
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === "csrf_token")?.value;
  return {
    Origin: E2E_FRONTEND_BASE_URL,
    ...(csrf ? { "X-CSRF-Token": csrf } : {}),
  };
}

async function ensureUser(page: Page, seed: UserSeed): Promise<CreatedUser> {
  const listResponse = await page.request.get("/api/admin/users", {
    params: { search: seed.email, page: 1, page_size: 200 },
  });
  await assertOk(listResponse, "Unable to list UI users");
  const listPayload = (await listResponse.json()) as PaginatedUsersResponse;
  const existing = listPayload.items.find((item) => item.email === seed.email);

  if (!existing) {
    const createResponse = await page.request.post("/api/admin/users", {
      headers: await csrfHeaders(page),
      data: {
        email: seed.email,
        password: seed.password,
        full_name: seed.fullName,
        role: seed.role,
        can_create_manual_private_connections: Boolean(
          seed.canCreateManualPrivateConnections,
        ),
        browser_advanced_features_enabled: Boolean(
          seed.browserAdvancedFeaturesEnabled,
        ),
      },
    });
    await assertOk(createResponse, "Unable to create E2E UI user");
    return (await createResponse.json()) as CreatedUser;
  }

  const updateResponse = await page.request.put(`/api/admin/users/${existing.id}`, {
    headers: await csrfHeaders(page),
    data: {
      full_name: seed.fullName,
      password: seed.password,
      role: seed.role,
      is_active: true,
      can_create_manual_private_connections: Boolean(
        seed.canCreateManualPrivateConnections,
      ),
      browser_advanced_features_enabled: Boolean(
        seed.browserAdvancedFeaturesEnabled,
      ),
    },
  });
  await assertOk(updateResponse, "Unable to refresh E2E UI user");
  return (await updateResponse.json()) as CreatedUser;
}

async function ensurePrivateConnection(page: Page): Promise<PrivateConnection> {
  const listResponse = await page.request.get("/api/connections");
  await assertOk(listResponse, "Unable to list private S3 connections");
  const connections = (await listResponse.json()) as PrivateConnection[];
  const existing = connections.find(
    (item) => item.name === E2E_BROWSER_CONNECTION_NAME,
  );

  const endpointsResponse = await page.request.get(
    "/api/connections/storage-endpoints",
  );
  await assertOk(endpointsResponse, "Unable to list private S3 endpoints");
  const endpoints = (await endpointsResponse.json()) as PrivateStorageEndpoint[];
  const normalizedEndpoint = E2E_S3_ENDPOINT.replace(/\/+$/, "");
  const endpoint =
    endpoints.find(
      (item) => item.endpoint_url.replace(/\/+$/, "") === normalizedEndpoint,
    ) ??
    endpoints.find((item) => item.is_default) ??
    endpoints[0];
  expect(endpoint, "No managed S3 endpoint is available for Browser E2E").toBeDefined();

  const payload = {
    name: E2E_BROWSER_CONNECTION_NAME,
    storage_endpoint_id: endpoint!.id,
    access_key_id: E2E_S3_ACCESS_KEY,
    secret_access_key: E2E_S3_SECRET_KEY,
    access_manager: false,
    access_browser: true,
  };

  if (!existing) {
    const createResponse = await page.request.post("/api/connections", {
      headers: await csrfHeaders(page),
      data: payload,
    });
    await assertOk(createResponse, "Unable to create private Moto connection");
    return (await createResponse.json()) as PrivateConnection;
  }

  const updateResponse = await page.request.put(`/api/connections/${existing.id}`, {
    headers: await csrfHeaders(page),
    data: {
      ...payload,
      is_active: true,
    },
  });
  await assertOk(updateResponse, "Unable to update private Moto connection");
  return (await updateResponse.json()) as PrivateConnection;
}

setup("bootstrap browser auth with S3 backend", async ({ page }) => {
  const { seedMoto } = await import("../../scripts/e2e/seed-moto.mjs");
  await seedMoto({
    endpoint: E2E_S3_ENDPOINT,
    accessKeyId: E2E_S3_ACCESS_KEY,
    secretAccessKey: E2E_S3_SECRET_KEY,
    region: E2E_S3_REGION,
    bucketName: E2E_BUCKET_NAME,
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await page.goto(await waitForBootstrapUrl());
  await page.getByLabel("Full name").fill(E2E_ADMIN_FULL_NAME);
  await page.getByLabel("Email").fill(E2E_ADMIN_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(E2E_ADMIN_PASSWORD);
  await page.getByLabel("Confirm password").fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Create administrator" }).click();
  await expect(page.getByRole("heading", { name: "Create your administrator passkey" })).toBeVisible();
  await page.getByRole("button", { name: "Create passkey" }).click();
  await expect(page.getByText("Save these one-time recovery codes now.")).toBeVisible();
  await page.getByRole("button", { name: "I saved these recovery codes" }).click();
  await expect(page).toHaveURL(/\/admin(?:\?.*)?$/);

  await assertOk(
    await page.request.post("/api/auth/logout", { headers: await csrfHeaders(page) }),
    "Admin logout failed",
  );
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(E2E_ADMIN_EMAIL);
  await page.locator('input[type="password"]').fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Verify your passkey" })).toBeVisible();
  await page.getByRole("button", { name: "Use passkey" }).click();
  await expect(page).toHaveURL(/\/admin(?:\?.*)?$/);

  await ensureUser(page, {
    email: E2E_USER_EMAIL,
    password: E2E_USER_PASSWORD,
    fullName: E2E_USER_FULL_NAME,
    role: "ui_user",
    canCreateManualPrivateConnections: true,
    browserAdvancedFeaturesEnabled: true,
  });
  await ensureUser(page, {
    email: E2E_AUTH_ADMIN_EMAIL,
    password: E2E_AUTH_ADMIN_PASSWORD,
    fullName: E2E_AUTH_ADMIN_FULL_NAME,
    role: "ui_admin",
  });
  await assertOk(
    await page.request.post("/api/auth/logout", { headers: await csrfHeaders(page) }),
    "Admin logout failed",
  );
  await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });

  await mkdir(dirname(E2E_STORAGE_STATE_PATH), { recursive: true });
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(E2E_USER_EMAIL);
  await page.locator('input[type="password"]').fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/unauthorized(?:\?.*)?$/);
  const connection = await ensurePrivateConnection(page);
  await page.goto(
    `/browser?ctx=${encodeURIComponent(`conn-${connection.id}`)}&bucket=${encodeURIComponent(E2E_BUCKET_NAME)}`,
  );
  await expect(page).toHaveURL(/\/browser(?:\?.*)?$/);
  expect(await page.evaluate(() => window.localStorage.getItem("token"))).toBeNull();
  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === "ui_access")?.httpOnly).toBe(true);
  expect(cookies.find((cookie) => cookie.name === "refresh_token")?.httpOnly).toBe(true);
  expect(cookies.find((cookie) => cookie.name === "csrf_token")?.httpOnly).toBe(false);
  await page.reload();
  await expect(page).toHaveURL(/\/browser(?:\?.*)?$/);
  await expect(page.getByRole("button", { name: "Select bucket" })).toContainText(
    E2E_BUCKET_NAME,
    { timeout: 30_000 },
  );
  await page.context().storageState({ path: E2E_STORAGE_STATE_PATH });
});
