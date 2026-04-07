import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { expect, request as playwrightRequest, test as setup, type APIRequestContext, type APIResponse } from "@playwright/test";

import {
  E2E_ADMIN_EMAIL,
  E2E_ADMIN_PASSWORD,
  E2E_BACKEND_API_URL,
  E2E_BUCKET_NAME,
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

type AdminLoginResponse = {
  access_token: string;
};

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

const apiBaseUrl = `${E2E_BACKEND_API_URL.replace(/\/+$/, "")}/`;

async function assertOk(response: APIResponse, message: string) {
  const ok = response.ok();
  const detail = ok ? "" : ` (${response.status()} ${await response.text()})`;
  expect(ok, `${message}${detail}`).toBeTruthy();
}

async function loginAsAdmin(): Promise<APIRequestContext> {
  const api = await playwrightRequest.newContext({ baseURL: apiBaseUrl });
  const response = await api.post("auth/login", {
    form: {
      username: E2E_ADMIN_EMAIL,
      password: E2E_ADMIN_PASSWORD,
      grant_type: "password",
    },
  });
  await assertOk(response, "Admin login failed");
  const payload = (await response.json()) as AdminLoginResponse;
  await api.dispose();
  return playwrightRequest.newContext({
    baseURL: apiBaseUrl,
    extraHTTPHeaders: {
      Authorization: `Bearer ${payload.access_token}`,
    },
  });
}

async function ensureUser(adminApi: APIRequestContext): Promise<CreatedUser> {
  const listResponse = await adminApi.get("admin/users", {
    params: { search: E2E_USER_EMAIL, page: 1, page_size: 200 },
  });
  await assertOk(listResponse, "Unable to list UI users");
  const listPayload = (await listResponse.json()) as PaginatedUsersResponse;
  const existing = listPayload.items.find((item) => item.email === E2E_USER_EMAIL);

  if (!existing) {
    const createResponse = await adminApi.post("admin/users", {
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

  const updateResponse = await adminApi.put(`admin/users/${existing.id}`, {
    data: {
      password: E2E_USER_PASSWORD,
      role: "ui_user",
      is_active: true,
    },
  });
  await assertOk(updateResponse, "Unable to refresh E2E UI user");
  return (await updateResponse.json()) as CreatedUser;
}

async function ensureConnection(adminApi: APIRequestContext): Promise<CreatedConnection> {
  const listResponse = await adminApi.get("admin/s3-connections", {
    params: { search: E2E_SHARED_CONNECTION_NAME, page: 1, page_size: 200 },
  });
  await assertOk(listResponse, "Unable to list shared S3 connections");
  const listPayload = (await listResponse.json()) as PaginatedConnectionsResponse;
  const existing = listPayload.items.find((item) => item.name === E2E_SHARED_CONNECTION_NAME);

  if (!existing) {
    const createResponse = await adminApi.post("admin/s3-connections", {
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

  const updateResponse = await adminApi.put(`admin/s3-connections/${existing.id}`, {
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

  const rotateResponse = await adminApi.put(`admin/s3-connections/${existing.id}/credentials`, {
    data: {
      access_key_id: E2E_S3_ACCESS_KEY,
      secret_access_key: E2E_S3_SECRET_KEY,
    },
  });
  await assertOk(rotateResponse, "Unable to rotate shared Moto connection credentials");
  return (await rotateResponse.json()) as CreatedConnection;
}

async function ensureConnectionLink(
  adminApi: APIRequestContext,
  connectionId: number,
  userId: number,
): Promise<void> {
  const listResponse = await adminApi.get(`admin/s3-connections/${connectionId}/users`);
  await assertOk(listResponse, "Unable to list shared connection users");
  const linkedUsers = (await listResponse.json()) as Array<{ user_id: number }>;
  if (linkedUsers.some((entry) => entry.user_id === userId)) {
    return;
  }
  const linkResponse = await adminApi.post(`admin/s3-connections/${connectionId}/users`, {
    data: { user_id: userId },
  });
  await assertOk(linkResponse, "Unable to link E2E user to shared Moto connection");
}

setup("bootstrap browser auth with Moto", async ({ page }) => {
  const { seedMoto } = await import("../../scripts/e2e/seed-moto.mjs");
  await seedMoto({
    endpoint: E2E_S3_ENDPOINT,
    accessKeyId: E2E_S3_ACCESS_KEY,
    secretAccessKey: E2E_S3_SECRET_KEY,
    region: E2E_S3_REGION,
    bucketName: E2E_BUCKET_NAME,
  });

  const adminApi = await loginAsAdmin();
  try {
    const user = await ensureUser(adminApi);
    const connection = await ensureConnection(adminApi);
    await ensureConnectionLink(adminApi, connection.id, user.id);
  } finally {
    await adminApi.dispose();
  }

  await mkdir(dirname(E2E_STORAGE_STATE_PATH), { recursive: true });
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(E2E_USER_EMAIL);
  await page.locator('input[type="password"]').fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/browser(?:\?.*)?$/);
  await expect(page.getByRole("button", { name: "Select bucket" })).toContainText(E2E_BUCKET_NAME);
  await page.context().storageState({ path: E2E_STORAGE_STATE_PATH });
});
