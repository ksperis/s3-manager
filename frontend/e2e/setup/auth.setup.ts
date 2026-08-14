import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { expect, test as setup, type APIResponse, type Page } from "@playwright/test";

import {
  E2E_ADMIN_EMAIL,
  E2E_ADMIN_PASSWORD,
  E2E_BUCKET_NAME,
  E2E_FRONTEND_BASE_URL,
  E2E_S3_ACCESS_KEY,
  E2E_S3_ENDPOINT,
  E2E_S3_REGION,
  E2E_S3_SECRET_KEY,
  E2E_SHARED_CONNECTION_NAME,
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

type PaginatedConnectionsResponse = {
  items: Array<{
    id: number;
    name: string;
  }>;
};

type CreatedUser = {
  id: number;
  email: string;
};

type CreatedConnection = {
  id: number;
  name: string;
};

async function assertOk(response: APIResponse, message: string) {
  const ok = response.ok();
  const detail = ok ? "" : ` (${response.status()} ${await response.text()})`;
  expect(ok, `${message}${detail}`).toBeTruthy();
}

async function csrfHeaders(page: Page): Promise<Record<string, string>> {
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === "csrf_token")?.value;
  return {
    Origin: E2E_FRONTEND_BASE_URL,
    ...(csrf ? { "X-CSRF-Token": csrf } : {}),
  };
}

async function ensureUser(page: Page): Promise<CreatedUser> {
  const listResponse = await page.request.get("/api/admin/users", {
    params: { search: E2E_USER_EMAIL, page: 1, page_size: 200 },
  });
  await assertOk(listResponse, "Unable to list UI users");
  const listPayload = (await listResponse.json()) as PaginatedUsersResponse;
  const existing = listPayload.items.find((item) => item.email === E2E_USER_EMAIL);

  if (!existing) {
    const createResponse = await page.request.post("/api/admin/users", {
      headers: await csrfHeaders(page),
      data: {
        email: E2E_USER_EMAIL,
        password: E2E_USER_PASSWORD,
        full_name: E2E_USER_FULL_NAME,
        role: "ui_user",
      },
    });
    await assertOk(createResponse, "Unable to create E2E UI user");
    return (await createResponse.json()) as CreatedUser;
  }

  const updateResponse = await page.request.put(`/api/admin/users/${existing.id}`, {
    headers: await csrfHeaders(page),
    data: {
      password: E2E_USER_PASSWORD,
      role: "ui_user",
      is_active: true,
    },
  });
  await assertOk(updateResponse, "Unable to refresh E2E UI user");
  return (await updateResponse.json()) as CreatedUser;
}

async function ensureConnection(page: Page): Promise<CreatedConnection> {
  const listResponse = await page.request.get("/api/admin/s3-connections", {
    params: { search: E2E_SHARED_CONNECTION_NAME, page: 1, page_size: 200 },
  });
  await assertOk(listResponse, "Unable to list shared S3 connections");
  const listPayload = (await listResponse.json()) as PaginatedConnectionsResponse;
  const existing = listPayload.items.find((item) => item.name === E2E_SHARED_CONNECTION_NAME);

  if (!existing) {
    const createResponse = await page.request.post("/api/admin/s3-connections", {
      headers: await csrfHeaders(page),
      data: {
        name: E2E_SHARED_CONNECTION_NAME,
        provider_hint: "other",
        endpoint_url: E2E_S3_ENDPOINT,
        region: E2E_S3_REGION,
        access_key_id: E2E_S3_ACCESS_KEY,
        secret_access_key: E2E_S3_SECRET_KEY,
        access_manager: false,
        access_browser: true,
        force_path_style: true,
        verify_tls: false,
      },
    });
    await assertOk(createResponse, "Unable to create shared Moto connection");
    return (await createResponse.json()) as CreatedConnection;
  }

  const updateResponse = await page.request.put(`/api/admin/s3-connections/${existing.id}`, {
    headers: await csrfHeaders(page),
    data: {
      name: E2E_SHARED_CONNECTION_NAME,
      provider_hint: "other",
      endpoint_url: E2E_S3_ENDPOINT,
      region: E2E_S3_REGION,
      access_manager: false,
      access_browser: true,
      force_path_style: true,
      verify_tls: false,
      is_active: true,
    },
  });
  await assertOk(updateResponse, "Unable to update shared Moto connection");

  const rotateResponse = await page.request.put(`/api/admin/s3-connections/${existing.id}/credentials`, {
    headers: await csrfHeaders(page),
    data: {
      access_key_id: E2E_S3_ACCESS_KEY,
      secret_access_key: E2E_S3_SECRET_KEY,
    },
  });
  await assertOk(rotateResponse, "Unable to rotate shared Moto connection credentials");
  return (await rotateResponse.json()) as CreatedConnection;
}

async function ensureConnectionLink(
  page: Page,
  connectionId: number,
  userId: number,
): Promise<void> {
  const listResponse = await page.request.get(`/api/admin/s3-connections/${connectionId}/users`);
  await assertOk(listResponse, "Unable to list shared connection users");
  const linkedUsers = (await listResponse.json()) as Array<{ user_id: number }>;
  if (linkedUsers.some((entry) => entry.user_id === userId)) {
    return;
  }
  const linkResponse = await page.request.post(`/api/admin/s3-connections/${connectionId}/users`, {
    headers: await csrfHeaders(page),
    data: { user_id: userId },
  });
  await assertOk(linkResponse, "Unable to link E2E user to shared Moto connection");
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

  await page.goto("/login");
  await page.locator('input[type="email"]').fill(E2E_ADMIN_EMAIL);
  await page.locator('input[type="password"]').fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
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

  const user = await ensureUser(page);
  const connection = await ensureConnection(page);
  await ensureConnectionLink(page, connection.id, user.id);
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
  await expect(page).toHaveURL(/\/browser(?:\?.*)?$/);
  expect(await page.evaluate(() => window.localStorage.getItem("token"))).toBeNull();
  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === "ui_access")?.httpOnly).toBe(true);
  expect(cookies.find((cookie) => cookie.name === "refresh_token")?.httpOnly).toBe(true);
  expect(cookies.find((cookie) => cookie.name === "csrf_token")?.httpOnly).toBe(false);
  await page.reload();
  await expect(page).toHaveURL(/\/browser(?:\?.*)?$/);
  await page.goto(`/browser?bucket=${encodeURIComponent(E2E_BUCKET_NAME)}`);
  await expect(page.getByRole("button", { name: "Select bucket" })).toContainText(E2E_BUCKET_NAME);
  await page.context().storageState({ path: E2E_STORAGE_STATE_PATH });
});
