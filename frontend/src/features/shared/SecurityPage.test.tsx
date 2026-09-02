/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../api/client";
import SecurityPage from "./SecurityPage";

const mocks = vi.hoisted(() => ({
  beginSecurityPasskey: vi.fn(),
  beginRecentWebAuthnVerification: vi.fn(),
  clear: vi.fn(),
  finishSecurityPasskey: vi.fn(),
  finishRecentWebAuthnVerification: vi.fn(),
  authenticatePasskey: vi.fn(),
  listExternalIdentities: vi.fn(),
  listSecurityCredentials: vi.fn(),
  listSecuritySessions: vi.fn(),
  logoutAllSessions: vi.fn(),
  regenerateRecoveryCodes: vi.fn(),
  revokeExternalIdentity: vi.fn(),
  revokeSecurityCredential: vi.fn(),
  revokeSecuritySession: vi.fn(),
}));
const policyState = vi.hoisted(() => ({
  require_passkey_for_admins: true,
  require_passkey_for_users: false,
  allow_user_external_identity_unlink: false,
}));
const storedUserState = vi.hoisted(() => ({
  role: "ui_superadmin",
  authType: "password",
  has_local_password: true,
}));

vi.mock("../../auth/SessionProvider", () => ({
  useSession: () => ({ user: { id: 1, role: "ui_superadmin" }, clear: mocks.clear }),
}));

vi.mock("../../api/security", () => ({
  beginRecentWebAuthnVerification: mocks.beginRecentWebAuthnVerification,
  beginSecurityPasskey: mocks.beginSecurityPasskey,
  finishSecurityPasskey: mocks.finishSecurityPasskey,
  finishRecentWebAuthnVerification: mocks.finishRecentWebAuthnVerification,
  listExternalIdentities: mocks.listExternalIdentities,
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

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({ generalSettings: policyState }),
}));

vi.mock("../../utils/workspaces", () => ({
  readStoredUser: () => storedUserState,
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
    policyState.require_passkey_for_admins = true;
    policyState.require_passkey_for_users = false;
    storedUserState.role = "ui_superadmin";
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
    mocks.revokeSecurityCredential.mockResolvedValue(undefined);
    mocks.regenerateRecoveryCodes.mockResolvedValue(["code-one", "code-two"]);
    mocks.beginRecentWebAuthnVerification.mockResolvedValue({ challenge: "challenge" });
    mocks.authenticatePasskey.mockResolvedValue({ id: "credential" });
    mocks.finishRecentWebAuthnVerification.mockResolvedValue({ mfa_verified_at: "2026-08-14T10:00:00Z" });
  });

  it("explains whether passkey enrollment is required for the current role", async () => {
    const { unmount } = render(<SecurityPage />);
    expect(await screen.findByText("A passkey is required for your role and for sensitive actions.")).toBeInTheDocument();
    expect(screen.getByText("At least 12 characters.")).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toHaveAttribute("minlength", "12");

    unmount();
    storedUserState.role = "ui_user";
    render(<SecurityPage />);
    expect(await screen.findByText(/Passkeys are optional for your role/)).toBeInTheDocument();
  });

  it("shows only the current user's identities and sessions", async () => {
    render(<SecurityPage />);

    expect(await screen.findByText("oidc:company")).toBeInTheDocument();
    expect(screen.getByText("Current session")).toBeInTheDocument();
    expect(screen.queryByText("External identity link requests")).not.toBeInTheDocument();
    expect(screen.queryByText("Platform sessions")).not.toBeInTheDocument();
  });

  it("keeps successful sections visible when one security resource fails and retries only that section", async () => {
    const user = userEvent.setup();
    mocks.listExternalIdentities.mockRejectedValueOnce(new Error("Identity service down"));

    render(<SecurityPage />);

    expect(await screen.findByText("Current session")).toBeInTheDocument();
    expect(await screen.findByText(/Identity service down|Unable to load external identities/)).toBeInTheDocument();
    expect(screen.queryByText("No external identities linked.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("oidc:company")).toBeInTheDocument();
    expect(mocks.listExternalIdentities).toHaveBeenCalledTimes(2);
  });

  it("blocks revocation when the role requires the last passkey", async () => {
    const user = userEvent.setup();
    mocks.listSecurityCredentials.mockResolvedValue([
      { id: "credential-1", name: "Laptop", created_at: "2026-08-14T10:00:00Z" },
    ]);

    render(<SecurityPage />);

    const passkeysCard = (await screen.findByRole("heading", { name: "Passkeys" })).closest("section");
    expect(passkeysCard).not.toBeNull();
    const revokeButton = within(passkeysCard!).getByRole("button", { name: "Revoke" });
    expect(revokeButton).toBeDisabled();
    expect(screen.getByText("Add another passkey before revoking this one because your role requires at least one.")).toBeInTheDocument();
    await user.click(revokeButton);
    expect(screen.queryByRole("dialog", { name: "Revoke passkey" })).not.toBeInTheDocument();
    expect(mocks.revokeSecurityCredential).not.toHaveBeenCalled();
  });

  it("confirms passkey revocation before executing it when another passkey remains", async () => {
    const user = userEvent.setup();
    mocks.listSecurityCredentials.mockResolvedValue([
      { id: "credential-1", name: "Laptop", created_at: "2026-08-14T10:00:00Z" },
      { id: "credential-2", name: "Phone", created_at: "2026-08-15T10:00:00Z" },
    ]);

    render(<SecurityPage />);

    const passkeysCard = (await screen.findByRole("heading", { name: "Passkeys" })).closest("section");
    expect(passkeysCard).not.toBeNull();
    const laptopRow = screen.getByText("Laptop").closest("li");
    expect(laptopRow).not.toBeNull();
    await user.click(within(laptopRow!).getByRole("button", { name: "Revoke" }));
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

  it("verifies and retries a previously confirmed sensitive action exactly once", async () => {
    const user = userEvent.setup();
    storedUserState.role = "ui_user";
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

  it("cancels an action step-up without retrying or exposing the raw guard", async () => {
    const user = userEvent.setup();
    storedUserState.role = "ui_user";
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
