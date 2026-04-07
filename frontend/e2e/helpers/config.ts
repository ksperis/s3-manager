import { fileURLToPath } from "node:url";

export const E2E_FRONTEND_BASE_URL = process.env.E2E_FRONTEND_BASE_URL ?? "http://127.0.0.1:4173";
export const E2E_BACKEND_ORIGIN = process.env.E2E_BACKEND_ORIGIN ?? "http://127.0.0.1:8000";
export const E2E_BACKEND_API_URL = process.env.E2E_BACKEND_API_URL ?? `${E2E_BACKEND_ORIGIN}/api`;
export const E2E_S3_ENDPOINT = process.env.E2E_S3_ENDPOINT ?? "http://localhost:5000";
export const E2E_S3_ACCESS_KEY = process.env.E2E_S3_ACCESS_KEY ?? "minio";
export const E2E_S3_SECRET_KEY = process.env.E2E_S3_SECRET_KEY ?? "minio123";
export const E2E_S3_REGION = process.env.E2E_S3_REGION ?? "us-east-1";

export const E2E_ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? "browser-e2e-admin@example.com";
export const E2E_ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD ?? "browser-e2e-admin-password";
export const E2E_USER_EMAIL = process.env.E2E_USER_EMAIL ?? "browser-e2e-user@example.com";
export const E2E_USER_PASSWORD = process.env.E2E_USER_PASSWORD ?? "browser-e2e-user-password";
export const E2E_USER_FULL_NAME = process.env.E2E_USER_FULL_NAME ?? "Browser E2E User";
export const E2E_SHARED_CONNECTION_NAME = process.env.E2E_SHARED_CONNECTION_NAME ?? "Browser Moto E2E";
export const E2E_BUCKET_NAME = process.env.E2E_BUCKET_NAME ?? "browser-e2e";

export const E2E_STORAGE_STATE_PATH = fileURLToPath(new URL("../.auth/browser-user.json", import.meta.url));
export const E2E_UPLOAD_FIXTURE_PATH = fileURLToPath(new URL("../fixtures/upload-smoke.txt", import.meta.url));
