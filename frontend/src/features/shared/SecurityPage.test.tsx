/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../api/client";
import SecurityPage from "./SecurityPage";

const mocks = vi.hoisted(() => ({
  adminRevokeSession: vi.fn(),
  beginSecurityPasskey: vi.fn(),
  beginRecentWebAuthnVerification: vi.fn(),
  clear: vi.fn(),
  decideExternalLinkRequest: vi.fn(),
  finishSecurityPasskey: vi.fn(),
  finishRecentWebAuthnVerification: vi.fn(),
  authenticatePasskey: vi.fn(),
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
  beginRecentWebAuthnVerification: mocks.beginRecentWebAuthnVerification,
  beginSecurityPasskey: mocks.beginSecurityPasskey,
  decideExternalLinkRequest: mocks.decideExternalLinkRequest,
  finishSecurityPasskey: mocks.finishSecurityPasskey,
  finishRecentWebAuthnVerification: mocks.finishRecentWebAuthnVerification,
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

vi.mock("../../auth/webauthn", () => ({
  authenticatePasskey: mocks.authenticatePasskey,
  createPasskey: vi.fn(),
}));

function recentWebAuthnRequiredError() {
  return new ApiError("Request failed", {
    response: {
      status: 403,
      data: { detail: "Recent WebAuthn verification required" },
      headers: {},
    },
  });
}

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
    mocks.beginRecentWebAuthnVerification.mockResolvedValue({ challenge: "challenge" });
    mocks.authenticatePasskey.mockResolvedValue({ id: "credential" });
    mocks.finishRecentWebAuthnVerification.mockResolvedValue({ mfa_verified_at: "2026-08-14T10:00:00Z" });
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

  it("aggregates protected load guards into one passkey banner and reloads both sections", async () => {
    const user = userEvent.setup();
    mocks.listAdminSessions.mockRejectedValueOnce(recentWebAuthnRequiredError());
    mocks.listExternalLinkRequests.mockRejectedValueOnce(recentWebAuthnRequiredError());

    render(<SecurityPage />);

    expect(await screen.findByText("Sensitive security data is locked. Verify your identity with a passkey to continue.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Verify with passkey" })).toHaveLength(1);
    expect(screen.queryByText("Recent WebAuthn verification required")).not.toBeInTheDocument();
    expect(screen.getByText("oidc:company")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Verify with passkey" }));

    await waitFor(() => expect(mocks.listAdminSessions).toHaveBeenCalledTimes(2));
    expect(mocks.listExternalLinkRequests).toHaveBeenCalledTimes(2);
    expect(mocks.beginRecentWebAuthnVerification).toHaveBeenCalledOnce();
    expect(mocks.authenticatePasskey).toHaveBeenCalledOnce();
    expect(mocks.finishRecentWebAuthnVerification).toHaveBeenCalledOnce();
    expect(await screen.findByText("User #42")).toBeInTheDocument();
  });

  it("verifies and retries a previously confirmed sensitive action exactly once", async () => {
    const user = userEvent.setup();
    mocks.listSecurityCredentials.mockResolvedValue([
      { id: "credential-1", name: "Laptop", created_at: "2026-08-14T10:00:00Z" },
    ]);
    mocks.revokeSecurityCredential
      .mockRejectedValueOnce(recentWebAuthnRequiredError())
      .mockResolvedValueOnce(undefined);

    render(<SecurityPage />);

    const passkeysCard = (await screen.findByRole("heading", { name: "Passkeys" })).closest("section");
    await user.click(within(passkeysCard!).getByRole("button", { name: "Revoke" }));
    await user.click(within(screen.getByRole("dialog", { name: "Revoke passkey" })).getByRole("button", { name: "Revoke passkey" }));

    const verificationDialog = await screen.findByRole("dialog", { name: "Verify with passkey" });
    await user.click(within(verificationDialog).getByRole("button", { name: "Verify with passkey" }));

    await waitFor(() => expect(mocks.revokeSecurityCredential).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Recent WebAuthn verification required")).not.toBeInTheDocument();
  });

  it("keeps protected sections locked with a friendly error when passkey verification is cancelled", async () => {
    const user = userEvent.setup();
    mocks.listAdminSessions.mockRejectedValueOnce(recentWebAuthnRequiredError());
    mocks.listExternalLinkRequests.mockRejectedValueOnce(recentWebAuthnRequiredError());
    mocks.authenticatePasskey.mockRejectedValueOnce(new DOMException("Cancelled", "NotAllowedError"));

    render(<SecurityPage />);
    await user.click(await screen.findByRole("button", { name: "Verify with passkey" }));

    expect(await screen.findByText("Passkey verification was cancelled or timed out. Please try again.")).toBeInTheDocument();
    expect(mocks.listAdminSessions).toHaveBeenCalledOnce();
    expect(mocks.listExternalLinkRequests).toHaveBeenCalledOnce();
  });

  it("cancels an action step-up without retrying or exposing the raw guard", async () => {
    const user = userEvent.setup();
    mocks.listSecurityCredentials.mockResolvedValue([
      { id: "credential-1", name: "Laptop", created_at: "2026-08-14T10:00:00Z" },
    ]);
    mocks.revokeSecurityCredential.mockRejectedValueOnce(recentWebAuthnRequiredError());

    render(<SecurityPage />);
    const passkeysCard = (await screen.findByRole("heading", { name: "Passkeys" })).closest("section");
    await user.click(within(passkeysCard!).getByRole("button", { name: "Revoke" }));
    await user.click(within(screen.getByRole("dialog", { name: "Revoke passkey" })).getByRole("button", { name: "Revoke passkey" }));
    const verificationDialog = await screen.findByRole("dialog", { name: "Verify with passkey" });
    await user.click(within(verificationDialog).getByRole("button", { name: "Cancel" }));

    expect(mocks.revokeSecurityCredential).toHaveBeenCalledOnce();
    expect(mocks.beginRecentWebAuthnVerification).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Revoke passkey" })).toBeInTheDocument();
    expect(screen.queryByText("Recent WebAuthn verification required")).not.toBeInTheDocument();
  });
});
