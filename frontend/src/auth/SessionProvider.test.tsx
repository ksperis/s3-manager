/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCurrentSession } from "../api/auth";
import { SessionProvider, shouldBootstrapSession, useSession } from "./SessionProvider";

vi.mock("../api/auth", () => ({
  fetchCurrentSession: vi.fn(),
}));

function SessionState() {
  const { loading } = useSession();
  return <span>{loading ? "loading" : "ready"}</span>;
}

describe("SessionProvider OIDC bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("recognizes only provider callback paths", () => {
    expect(shouldBootstrapSession("/oidc/google/callback")).toBe(false);
    expect(shouldBootstrapSession("/oidc/google/callback/")).toBe(false);
    expect(shouldBootstrapSession("/oidc/google/start")).toBe(true);
    expect(shouldBootstrapSession("/login")).toBe(true);
  });

  it("does not restore a session before the OIDC code exchange", async () => {
    window.history.replaceState({}, "", "/oidc/google/callback?code=code&state=state");

    render(
      <SessionProvider>
        <SessionState />
      </SessionProvider>,
    );

    await waitFor(() => expect(screen.getByText("ready")).toBeInTheDocument());
    expect(fetchCurrentSession).not.toHaveBeenCalled();
  });
});
