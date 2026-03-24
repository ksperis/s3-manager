import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GENERAL_SETTINGS } from "../components/GeneralSettingsContext";
import { classifyRouteError, resolveRouteErrorHomePath } from "./routeError";

describe("classifyRouteError", () => {
  it("treats axios network errors without a response as backend unavailable", () => {
    expect(
      classifyRouteError({
        isAxiosError: true,
        message: "socket hang up",
      })
    ).toBe("backend_unavailable");
  });

  it("treats route error responses with status 503 as backend unavailable", () => {
    expect(
      classifyRouteError({
        status: 503,
        statusText: "Service Unavailable",
        data: null,
        internal: false,
      })
    ).toBe("backend_unavailable");
  });

  it("keeps unexpected application errors generic", () => {
    expect(classifyRouteError(new Error("sensitive failure detail"))).toBe("generic");
  });
});

describe("resolveRouteErrorHomePath", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns the authenticated workspace home when available", () => {
    window.localStorage.setItem(
      "user",
      JSON.stringify({
        email: "admin@example.com",
        role: "ui_admin",
      })
    );

    expect(resolveRouteErrorHomePath(DEFAULT_GENERAL_SETTINGS)).toBe("/admin");
  });

  it("falls back to login when there is no valid workspace", () => {
    expect(resolveRouteErrorHomePath(DEFAULT_GENERAL_SETTINGS)).toBe("/login");
  });
});
