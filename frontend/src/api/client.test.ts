/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { beforeEach, describe, expect, it } from "vitest";
import client, {
  API_REQUEST_TIMEOUT_MS,
  AUTH_REFRESH_TIMEOUT_MS,
  buildApiFetchHeaders,
  buildApiUrl,
  INTERACTIVE_REQUEST_TIMEOUT_MS,
  timeoutForRequestProfile,
} from "./client";
import { CLIENT_STORAGE_KEYS } from "../utils/clientStorage";

beforeEach(() => localStorage.clear());

describe("API request profiles", () => {
  it("keeps business requests unbounded and explicit profiles stable", () => {
    expect(API_REQUEST_TIMEOUT_MS).toBe(0);
    expect(client.defaults.timeout).toBe(0);
    expect(timeoutForRequestProfile("interactive")).toBe(15_000);
    expect(timeoutForRequestProfile("long_running")).toBe(0);
    expect(AUTH_REFRESH_TIMEOUT_MS).toBe(8_000);
    expect(INTERACTIVE_REQUEST_TIMEOUT_MS).toBe(15_000);
  });

  it("builds authenticated fetch requests from the shared API contract", () => {
    localStorage.setItem(CLIENT_STORAGE_KEYS.authToken, "token-1");
    localStorage.setItem(
      CLIENT_STORAGE_KEYS.sessionUser,
      JSON.stringify({ authType: "s3_session" }),
    );
    localStorage.setItem(
      CLIENT_STORAGE_KEYS.s3SessionEndpoint,
      "https://s3.example.test",
    );

    expect(buildApiFetchHeaders({ "X-Request-Scope": "browser" })).toEqual({
      "X-Request-Scope": "browser",
      Authorization: "Bearer token-1",
      "X-S3-Endpoint": "https://s3.example.test",
    });
    const url = new URL(buildApiUrl("/browser/buckets/data/download", { key: "a/b", empty: null }));
    expect(url.pathname).toBe("/api/browser/buckets/data/download");
    expect(url.searchParams.get("key")).toBe("a/b");
    expect(url.searchParams.has("empty")).toBe(false);
  });
});
