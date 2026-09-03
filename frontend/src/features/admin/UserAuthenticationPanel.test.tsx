/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FormEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../api/client";
import UserAuthenticationPanel from "./UserAuthenticationPanel";

const mocks = vi.hoisted(() => ({
  addAdminExternalIdentity: vi.fn(),
  authenticatePasskey: vi.fn(),
  beginRecentWebAuthnVerification: vi.fn(),
  finishRecentWebAuthnVerification: vi.fn(),
  getAdminUserSecurity: vi.fn(),
  resetAdminUserMfa: vi.fn(),
  restoreAdminExternalIdentity: vi.fn(),
  revokeAdminExternalIdentity: vi.fn(),
  revokeAdminUserSession: vi.fn(),
  setAdminUserPassword: vi.fn(),
}));

vi.mock("../../api/security", () => ({
  addAdminExternalIdentity: mocks.addAdminExternalIdentity,
  beginRecentWebAuthnVerification: mocks.beginRecentWebAuthnVerification,
  finishRecentWebAuthnVerification: mocks.finishRecentWebAuthnVerification,
  getAdminUserSecurity: mocks.getAdminUserSecurity,
  resetAdminUserMfa: mocks.resetAdminUserMfa,
  restoreAdminExternalIdentity: mocks.restoreAdminExternalIdentity,
  revokeAdminExternalIdentity: mocks.revokeAdminExternalIdentity,
  revokeAdminUserSession: mocks.revokeAdminUserSession,
  setAdminUserPassword: mocks.setAdminUserPassword,
}));

vi.mock("../../auth/webauthn", () => ({ authenticatePasskey: mocks.authenticatePasskey }));

const security = {
  user_id: 42,
  email: "target@example.com",
  role: "ui_user",
  has_local_password: true,
  passkey_required: false,
  passkeys: [{ id: "passkey-1", name: "Laptop", created_at: "2026-08-14T10:00:00Z", revoked_at: null }],
  external_identities: [
    {
      id: "identity-1",
      provider_type: "oidc",
      provider_id: "company",
      subject: "immutable-subject",
      email: "target@example.com",
      email_verified: true,
      link_source: "trusted_email",
      created_at: "2026-08-14T10:00:00Z",
      revoked_at: null,
    },
  ],
  sessions: [
    {
      id: "session-1",
      principal_type: "user",
      auth_type: "password",
      created_at: "2026-08-14T10:00:00Z",
      last_activity_at: "2026-08-14T10:05:00Z",
      idle_expires_at: "2026-08-14T22:05:00Z",
      absolute_expires_at: "2026-08-21T10:00:00Z",
    },
  ],
};

describe("UserAuthenticationPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminUserSecurity.mockResolvedValue(security);
    mocks.addAdminExternalIdentity.mockResolvedValue({});
    mocks.resetAdminUserMfa.mockResolvedValue({});
    mocks.revokeAdminExternalIdentity.mockResolvedValue(undefined);
    mocks.setAdminUserPassword.mockResolvedValue(undefined);
    mocks.beginRecentWebAuthnVerification.mockResolvedValue({ challenge: "challenge" });
    mocks.authenticatePasskey.mockResolvedValue({ id: "credential" });
    mocks.finishRecentWebAuthnVerification.mockResolvedValue({ mfa_verified_at: "2026-08-14T10:00:00Z" });
  });

  it("shows passkeys, local password status, identities, and sessions", async () => {
    render(<UserAuthenticationPanel userId={42} canMutate />);

    expect(await screen.findByText("Laptop")).toBeInTheDocument();
    expect(screen.getByText("A local password is configured.")).toBeInTheDocument();
    expect(screen.getByText(/Authentication changes in this tab are applied immediately/)).toBeInTheDocument();
    expect(screen.getByText("At least 12 characters.")).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toHaveAttribute("minlength", "12");
    expect(screen.getByText("immutable-subject")).toBeInTheDocument();
    expect(screen.getByText(/password · Unknown address/i)).toBeInTheDocument();
  });

  it("confirms MFA reset and external identity revocation", async () => {
    const user = userEvent.setup();
    render(<UserAuthenticationPanel userId={42} canMutate />);

    await user.click(await screen.findByRole("button", { name: "Reset MFA" }));
    const resetDialog = screen.getByRole("dialog", { name: "Reset user MFA" });
    await user.click(within(resetDialog).getByRole("button", { name: "Reset MFA" }));
    await waitFor(() => expect(mocks.resetAdminUserMfa).toHaveBeenCalledWith(42));

    const identityCard = screen.getByRole("heading", { name: "External identities" }).closest("section");
    expect(identityCard).not.toBeNull();
    await user.click(within(identityCard!).getByRole("button", { name: "Revoke" }));
    const identityDialog = screen.getByRole("dialog", { name: "Revoke external identity" });
    await user.click(within(identityDialog).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(mocks.revokeAdminExternalIdentity).toHaveBeenCalledWith(42, "identity-1"));
  });

  it("keeps self-administration read-only in the Admin user view", async () => {
    render(<UserAuthenticationPanel userId={42} canMutate={false} />);

    expect(await screen.findByText(/Use your personal Security page/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset MFA" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set password" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
  });

  it("keeps authentication actions isolated from the parent user form", async () => {
    const user = userEvent.setup();
    const parentSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    render(
      <form onSubmit={parentSubmit}>
        <UserAuthenticationPanel userId={42} canMutate />
      </form>,
    );

    await user.type(await screen.findByLabelText("Provider ID"), "company-two");
    await user.type(screen.getByLabelText("Immutable subject"), "second-subject");
    await user.click(screen.getByRole("button", { name: "Link identity" }));

    await waitFor(() => expect(mocks.addAdminExternalIdentity).toHaveBeenCalled());
    expect(parentSubmit).not.toHaveBeenCalled();
  });

  it("keeps the action pending and retries it once after recent passkey verification", async () => {
    const user = userEvent.setup();
    mocks.resetAdminUserMfa
      .mockRejectedValueOnce(new ApiError("Request failed", {
        response: { status: 403, data: { detail: "Recent WebAuthn verification required" }, headers: {} },
      }))
      .mockResolvedValueOnce({});
    render(<UserAuthenticationPanel userId={42} canMutate />);

    await user.click(await screen.findByRole("button", { name: "Reset MFA" }));
    await user.click(within(screen.getByRole("dialog", { name: "Reset user MFA" })).getByRole("button", { name: "Reset MFA" }));
    const verificationDialog = await screen.findByRole("dialog", { name: "Verify with passkey" });
    await user.click(within(verificationDialog).getByRole("button", { name: "Verify with passkey" }));

    await waitFor(() => expect(mocks.resetAdminUserMfa).toHaveBeenCalledTimes(2));
    expect(mocks.beginRecentWebAuthnVerification).toHaveBeenCalledOnce();
    expect(await screen.findByText("MFA reset completed. Sessions and API tokens were revoked.")).toBeInTheDocument();
  });
});
