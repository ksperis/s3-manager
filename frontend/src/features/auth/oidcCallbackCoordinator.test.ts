/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it, vi } from "vitest";
import type { AuthenticationResponse } from "../../api/auth";
import { coordinateOidcCallback } from "./oidcCallbackCoordinator";

describe("coordinateOidcCallback", () => {
  it("shares one single-use exchange across concurrent React effects", async () => {
    let resolveRequest: ((response: AuthenticationResponse) => void) | undefined;
    const response = { status: "authenticated" } as AuthenticationResponse;
    const complete = vi.fn(
      () => new Promise<AuthenticationResponse>((resolve) => {
        resolveRequest = resolve;
      }),
    );

    const first = coordinateOidcCallback("google", "code", "state", complete);
    const second = coordinateOidcCallback("google", "code", "state", complete);

    expect(second).toBe(first);
    expect(complete).toHaveBeenCalledTimes(1);
    resolveRequest?.(response);
    await expect(Promise.all([first, second])).resolves.toEqual([response, response]);
  });

  it("does not merge different OIDC states", async () => {
    const complete = vi.fn(async () => ({ status: "authenticated" }) as AuthenticationResponse);

    await Promise.all([
      coordinateOidcCallback("google", "code-1", "state-1", complete),
      coordinateOidcCallback("google", "code-2", "state-2", complete),
    ]);

    expect(complete).toHaveBeenCalledTimes(2);
  });
});
