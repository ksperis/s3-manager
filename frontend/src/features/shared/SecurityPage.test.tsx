/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SecurityPage from "./SecurityPage";

const mocks = vi.hoisted(() => ({
  adminRevokeSession: vi.fn(),
  beginSecurityPasskey: vi.fn(),
  clear: vi.fn(),
  decideExternalLinkRequest: vi.fn(),
  finishSecurityPasskey: vi.fn(),
  listAdminSessions: vi.fn(),
  listExternalIdentities: vi.fn(),
  listExternalLinkRequests: vi.fn(),
  listSecurityCredentials: vi.fn(),
  listSecuritySessions: vi.fn(),
  logoutAllSessions: vi.fn(),
  regenerateRecoveryCodes: vi.fn(),
  revokeExternalIdentity: vi.fn(),
  revokeSecurityCredential: vi.fn(),
  revokeSecuritySession: vi.fn(),
}));

vi.mock("../../auth/SessionProvider", () => ({
  useSession: () => ({ user: { id: 1, role: "ui_superadmin" }, clear: mocks.clear }),
}));

vi.mock("../../api/security", () => ({
  adminRevokeSession: mocks.adminRevokeSession,
  beginSecurityPasskey: mocks.beginSecurityPasskey,
  decideExternalLinkRequest: mocks.decideExternalLinkRequest,
  finishSecurityPasskey: mocks.finishSecurityPasskey,
  listAdminSessions: mocks.listAdminSessions,
  listExternalIdentities: mocks.listExternalIdentities,
  listExternalLinkRequests: mocks.listExternalLinkRequests,
  listSecurityCredentials: mocks.listSecurityCredentials,
  listSecuritySessions: mocks.listSecuritySessions,
  logoutAllSessions: mocks.logoutAllSessions,
  regenerateRecoveryCodes: mocks.regenerateRecoveryCodes,
  revokeExternalIdentity: mocks.revokeExternalIdentity,
  revokeSecurityCredential: mocks.revokeSecurityCredential,
  revokeSecuritySession: mocks.revokeSecuritySession,
}));

describe("SecurityPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listSecurityCredentials.mockResolvedValue([]);
    mocks.listSecuritySessions.mockResolvedValue([
      {
        id: "current-session",
        principal_type: "user",
        auth_type: "webauthn",
        created_at: "2026-08-14T10:00:00Z",
        last_activity_at: "2026-08-14T10:05:00Z",
        idle_expires_at: "2026-08-14T22:05:00Z",
        absolute_expires_at: "2026-08-21T10:00:00Z",
        current: true,
      },
    ]);
    mocks.listExternalIdentities.mockResolvedValue([
      {
        id: "identity-1",
        provider_type: "oidc",
        provider_id: "company",
        email: "admin@example.com",
        email_verified: true,
        created_at: "2026-08-14T10:00:00Z",
      },
    ]);
    mocks.listExternalLinkRequests.mockResolvedValue([
      {
        id: "request-1",
        user_id: 2,
        provider_type: "ldap",
        provider_id: "directory",
        email: "candidate@example.com",
        status: "pending",
        created_at: "2026-08-14T10:00:00Z",
        expires_at: "2026-08-15T10:00:00Z",
      },
    ]);
    mocks.listAdminSessions.mockResolvedValue([
      {
        id: "other-session",
        principal_type: "user",
        auth_type: "webauthn",
        user_id: 42,
        created_at: "2026-08-14T10:00:00Z",
        last_activity_at: "2026-08-14T10:05:00Z",
        idle_expires_at: "2026-08-14T22:05:00Z",
        absolute_expires_at: "2026-08-21T10:00:00Z",
        current: false,
      },
    ]);
    mocks.revokeSecurityCredential.mockResolvedValue(undefined);
    mocks.regenerateRecoveryCodes.mockResolvedValue(["code-one", "code-two"]);
  });

  it("shows external identities, global sessions and manual link requests to a superadmin", async () => {
    render(<SecurityPage />);

    expect(await screen.findByText("oidc:company")).toBeInTheDocument();
    expect(screen.getByText("User #42")).toBeInTheDocument();
    expect(screen.getByText("candidate@example.com · ldap:directory")).toBeInTheDocument();
    expect(mocks.listAdminSessions).toHaveBeenCalledOnce();
    expect(mocks.listExternalLinkRequests).toHaveBeenCalledOnce();
  });

  it("keeps successful sections visible when one security resource fails and retries only that section", async () => {
    const user = userEvent.setup();
    mocks.listExternalIdentities.mockRejectedValueOnce(new Error("Identity service down"));

    render(<SecurityPage />);

    expect(await screen.findByText("Current session")).toBeInTheDocument();
    expect(screen.getByText("User #42")).toBeInTheDocument();
    expect(await screen.findByText(/Identity service down|Unable to load external identities/)).toBeInTheDocument();
    expect(screen.queryByText("No external identities linked.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("oidc:company")).toBeInTheDocument();
    expect(mocks.listExternalIdentities).toHaveBeenCalledTimes(2);
  });

  it("confirms passkey revocation before executing it", async () => {
    const user = userEvent.setup();
    mocks.listSecurityCredentials.mockResolvedValue([
      { id: "credential-1", name: "Laptop", created_at: "2026-08-14T10:00:00Z" },
    ]);

    render(<SecurityPage />);

    const passkeysCard = (await screen.findByRole("heading", { name: "Passkeys" })).closest("section");
    expect(passkeysCard).not.toBeNull();
    await user.click(within(passkeysCard!).getByRole("button", { name: "Revoke" }));
    const dialog = screen.getByRole("dialog", { name: "Revoke passkey" });
    expect(mocks.revokeSecurityCredential).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Revoke passkey" }));
    await waitFor(() => expect(mocks.revokeSecurityCredential).toHaveBeenCalledWith("credential-1"));
  });

  it("confirms recovery-code rotation and global logout", async () => {
    const user = userEvent.setup();
    mocks.listSecurityCredentials.mockResolvedValue([
      { id: "credential-1", name: "Laptop", created_at: "2026-08-14T10:00:00Z" },
    ]);

    render(<SecurityPage />);

    await user.click(await screen.findByRole("button", { name: "Generate new recovery codes" }));
    expect(screen.getByRole("dialog", { name: "Generate new recovery codes" })).toBeInTheDocument();
    expect(mocks.regenerateRecoveryCodes).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Log out everywhere" }));
    expect(screen.getByRole("dialog", { name: "Log out everywhere" })).toBeInTheDocument();
    expect(mocks.logoutAllSessions).not.toHaveBeenCalled();
  });
});
