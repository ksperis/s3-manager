/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export type ApiClientContractRow = {
  area: "auth" | "admin" | "manager" | "browser" | "portal" | "ceph-admin" | "storage-ops" | "shared";
  clientFile: string;
  transport: "axios" | "fetch-sse" | "aws-sdk";
  mappingBoundary: "typed-api-payload" | "api-to-view-model" | "stream-event-parser";
  contextHeaders: string[];
  errorSurface: "extractApiError" | "sanitized-stream-error" | "caller-owned";
};

export const API_CLIENT_CONTRACTS: ApiClientContractRow[] = [
  {
    area: "shared",
    clientFile: "api/client.ts",
    transport: "axios",
    mappingBoundary: "typed-api-payload",
    contextHeaders: ["Authorization", "X-S3-Endpoint"],
    errorSurface: "caller-owned",
  },
  {
    area: "auth",
    clientFile: "api/auth.ts",
    transport: "axios",
    mappingBoundary: "typed-api-payload",
    contextHeaders: ["Authorization", "X-S3-Endpoint"],
    errorSurface: "extractApiError",
  },
  {
    area: "admin",
    clientFile: "api/users.ts",
    transport: "axios",
    mappingBoundary: "typed-api-payload",
    contextHeaders: ["Authorization"],
    errorSurface: "extractApiError",
  },
  {
    area: "admin",
    clientFile: "api/accounts.ts",
    transport: "axios",
    mappingBoundary: "typed-api-payload",
    contextHeaders: ["Authorization"],
    errorSurface: "extractApiError",
  },
  {
    area: "admin",
    clientFile: "api/storageEndpoints.ts",
    transport: "axios",
    mappingBoundary: "typed-api-payload",
    contextHeaders: ["Authorization"],
    errorSurface: "extractApiError",
  },
  {
    area: "browser",
    clientFile: "api/browser.ts",
    transport: "axios",
    mappingBoundary: "typed-api-payload",
    contextHeaders: ["Authorization", "X-S3-Workspace", "X-S3-SSE-C-*"],
    errorSurface: "extractApiError",
  },
  {
    area: "shared",
    clientFile: "api/sseBucketsStream.ts",
    transport: "fetch-sse",
    mappingBoundary: "stream-event-parser",
    contextHeaders: ["Authorization"],
    errorSurface: "sanitized-stream-error",
  },
  {
    area: "manager",
    clientFile: "api/managerMigrations.ts",
    transport: "fetch-sse",
    mappingBoundary: "stream-event-parser",
    contextHeaders: ["Authorization"],
    errorSurface: "sanitized-stream-error",
  },
  {
    area: "portal",
    clientFile: "api/portal.ts",
    transport: "axios",
    mappingBoundary: "typed-api-payload",
    contextHeaders: ["Authorization", "X-S3-Workspace"],
    errorSurface: "extractApiError",
  },
  {
    area: "ceph-admin",
    clientFile: "api/cephAdmin.ts",
    transport: "axios",
    mappingBoundary: "typed-api-payload",
    contextHeaders: ["Authorization"],
    errorSurface: "extractApiError",
  },
  {
    area: "storage-ops",
    clientFile: "api/storageOps.ts",
    transport: "axios",
    mappingBoundary: "typed-api-payload",
    contextHeaders: ["Authorization"],
    errorSurface: "extractApiError",
  },
  {
    area: "manager",
    clientFile: "api/buckets.ts",
    transport: "axios",
    mappingBoundary: "typed-api-payload",
    contextHeaders: ["Authorization"],
    errorSurface: "extractApiError",
  },
];
