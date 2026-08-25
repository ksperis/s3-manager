/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import client, {
  API_REQUEST_TIMEOUT_MS,
  AUTH_REFRESH_TIMEOUT_MS,
  buildApiRequestHeaders,
  buildApiFetchHeaders,
  buildApiUrl,
  INTERACTIVE_REQUEST_TIMEOUT_MS,
  timeoutForRequestProfile,
} from "./client";
import { CLIENT_STORAGE_KEYS } from "../utils/clientStorage";
import { setSessionUserCache } from "../utils/workspaces";

beforeEach(() => {
  localStorage.clear();
  setSessionUserCache(null);
  document.cookie = "csrf_token=; Max-Age=0; path=/";
  vi.restoreAllMocks();
});

describe("API request profiles", () => {
  it("keeps business requests unbounded and explicit profiles stable", () => {
    expect(API_REQUEST_TIMEOUT_MS).toBe(0);
    expect(client.defaults.timeout).toBe(0);
    expect(timeoutForRequestProfile("interactive")).toBe(15_000);
    expect(timeoutForRequestProfile("long_running")).toBe(0);
    expect(AUTH_REFRESH_TIMEOUT_MS).toBe(8_000);
    expect(INTERACTIVE_REQUEST_TIMEOUT_MS).toBe(15_000);
  });

  it("uses cookies and CSRF without permitting a browser Bearer header", async () => {
    document.cookie = "csrf_token=csrf-value; path=/";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await client.post("/users/me", { display_name: "Updated" }, {
      headers: { Authorization: "Bearer forbidden-ui-token" },
    });

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(init?.credentials).toBe("include");
    expect(headers.get("X-CSRF-Token")).toBe("csrf-value");
    expect(headers.has("Authorization")).toBe(false);
  });

  it("adds CSRF only to unsafe methods", () => {
    document.cookie = "csrf_token=csrf-value; path=/";
    expect(buildApiRequestHeaders("GET").has("X-CSRF-Token")).toBe(false);
    expect(buildApiRequestHeaders("POST").get("X-CSRF-Token")).toBe("csrf-value");
  });

  it("builds authenticated fetch requests from the shared API contract", () => {
    setSessionUserCache({ authType: "s3_session" });
    localStorage.setItem(
      CLIENT_STORAGE_KEYS.s3SessionEndpoint,
      "https://s3.example.test",
    );

    expect(buildApiFetchHeaders({ "X-Request-Scope": "browser" })).toEqual({
      "X-Request-Scope": "browser",
      "X-S3-Endpoint": "https://s3.example.test",
    });
    const url = new URL(buildApiUrl("/browser/buckets/data/download", { key: "a/b", empty: null }));
    expect(url.pathname).toBe("/api/browser/buckets/data/download");
    expect(url.searchParams.get("key")).toBe("a/b");
    expect(url.searchParams.has("empty")).toBe(false);
  });
});
