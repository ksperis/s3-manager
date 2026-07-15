/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it } from "vitest";
import client, {
  API_REQUEST_TIMEOUT_MS,
  AUTH_REFRESH_TIMEOUT_MS,
  INTERACTIVE_REQUEST_TIMEOUT_MS,
  timeoutForRequestProfile,
} from "./client";

describe("API request profiles", () => {
  it("keeps business requests unbounded and explicit profiles stable", () => {
    expect(API_REQUEST_TIMEOUT_MS).toBe(0);
    expect(client.defaults.timeout).toBe(0);
    expect(timeoutForRequestProfile("interactive")).toBe(15_000);
    expect(timeoutForRequestProfile("long_running")).toBe(0);
    expect(AUTH_REFRESH_TIMEOUT_MS).toBe(8_000);
    expect(INTERACTIVE_REQUEST_TIMEOUT_MS).toBe(15_000);
  });
});
