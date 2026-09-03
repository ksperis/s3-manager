import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import ApiTokensPage from "./ApiTokensPage";

const listApiTokensMock = vi.fn();
const createApiTokenMock = vi.fn();
const revokeApiTokenMock = vi.fn();
const beginRecentWebAuthnVerificationMock = vi.fn();
const finishRecentWebAuthnVerificationMock = vi.fn();
const authenticatePasskeyMock = vi.fn();

vi.mock("../../api/apiTokens", () => ({
  listApiTokens: (includeRevoked?: boolean) => listApiTokensMock(includeRevoked),
  createApiToken: (...args: unknown[]) => createApiTokenMock(...args),
  revokeApiToken: (...args: unknown[]) => revokeApiTokenMock(...args),
}));

vi.mock("../../api/security", () => ({
  beginRecentWebAuthnVerification: (...args: unknown[]) => beginRecentWebAuthnVerificationMock(...args),
  finishRecentWebAuthnVerification: (...args: unknown[]) => finishRecentWebAuthnVerificationMock(...args),
}));

vi.mock("../../auth/webauthn", () => ({
  authenticatePasskey: (...args: unknown[]) => authenticatePasskeyMock(...args),
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

describe("ApiTokensPage list states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listApiTokensMock.mockResolvedValue([]);
    revokeApiTokenMock.mockResolvedValue(undefined);
    beginRecentWebAuthnVerificationMock.mockResolvedValue({ challenge: "challenge" });
    authenticatePasskeyMock.mockResolvedValue({ id: "credential" });
    finishRecentWebAuthnVerificationMock.mockResolvedValue({ mfa_verified_at: "2026-08-14T10:00:00Z" });
  });

  it("shows the load error once in the table when no rows are available", async () => {
    listApiTokensMock.mockRejectedValueOnce(new Error("Failed to load tokens"));

    render(<ApiTokensPage />);

    expect(await screen.findByText("Failed to load tokens")).toBeInTheDocument();
    expect(screen.getAllByText("Failed to load tokens")).toHaveLength(1);
    expect(screen.queryByText("Unable to load API tokens.")).not.toBeInTheDocument();
  });

  it("keeps existing rows on refresh failure and does not show table error row", async () => {
    listApiTokensMock
      .mockResolvedValueOnce([
        {
          id: "tok-1",
          name: "token-alpha",
          created_at: "2026-03-01T00:00:00.000Z",
          expires_at: "2099-06-01T00:00:00.000Z",
          last_used_at: null,
          revoked_at: null,
        },
      ])
      .mockRejectedValueOnce(new Error("Refresh failed"));

    render(<ApiTokensPage />);

    expect(await screen.findByText("token-alpha")).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveClass("responsive-data-table");
    expect(screen.getByText("token-alpha").closest("td")).toHaveAttribute("data-mobile-primary", "true");
    expect(screen.getByText("active").closest("td")).toHaveAttribute("data-label", "Status");
    expect(screen.getByRole("button", { name: "Revoke" }).closest("td")).toHaveAttribute("data-mobile-actions", "true");

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByText("Refresh failed")).toBeInTheDocument();
    expect(screen.getByText("token-alpha")).toBeInTheDocument();
    expect(screen.queryByText("Unable to load API tokens.")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(listApiTokensMock).toHaveBeenCalledTimes(2);
    });
  });

  it("shows newly created token in the shared one-time secret panel", async () => {
    createApiTokenMock.mockResolvedValue({
      access_token: "secret-token-value",
      api_token: {
        id: "tok-new",
        name: "automation",
        created_at: "2026-03-01T00:00:00.000Z",
        expires_at: "2099-06-01T00:00:00.000Z",
        last_used_at: null,
        revoked_at: null,
      },
    });

    render(<ApiTokensPage />);

    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText("ansible-production"), { target: { value: "automation" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create token" }));

    expect(await screen.findByText("New API token: automation")).toBeInTheDocument();
    expect(screen.getByText("One-time display")).toBeInTheDocument();
    expect(screen.getByText("secret-token-value")).toHaveClass("font-mono");
    expect(screen.getByText("secret-token-value")).toHaveClass("border-amber-200");
    expect(screen.getByRole("button", { name: "Copy auth header" })).toBeInTheDocument();
  });

  it("confirms token revocation with its scopes before calling the API", async () => {
    listApiTokensMock.mockResolvedValue([
      {
        id: "tok-1",
        name: "deployment-bot",
        scopes: ["manager:read", "manager:write"],
        created_at: "2026-03-01T00:00:00.000Z",
        expires_at: "2099-06-01T00:00:00.000Z",
        last_used_at: null,
        revoked_at: null,
      },
    ]);

    render(<ApiTokensPage />);
    await screen.findByText("deployment-bot");
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    expect(screen.getByRole("heading", { name: "Revoke API token?" })).toBeInTheDocument();
    expect(screen.getByText("manager:read, manager:write")).toBeInTheDocument();
    expect(revokeApiTokenMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Revoke token" }));
    await waitFor(() => expect(revokeApiTokenMock).toHaveBeenCalledWith("tok-1"));
  });

  it("does not launch passkey verification while loading the token list", async () => {
    listApiTokensMock.mockRejectedValueOnce(recentWebAuthnRequiredError());

    render(<ApiTokensPage />);

    expect(await screen.findByText("Recent WebAuthn verification required")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Verify with passkey" })).not.toBeInTheDocument();
    expect(listApiTokensMock).toHaveBeenCalledOnce();
    expect(beginRecentWebAuthnVerificationMock).not.toHaveBeenCalled();
  });

  it("keeps the create form and retries token creation once after passkey verification", async () => {
    createApiTokenMock
      .mockRejectedValueOnce(recentWebAuthnRequiredError())
      .mockResolvedValueOnce({
        access_token: "step-up-secret",
        api_token: {
          id: "tok-step-up",
          name: "step-up-automation",
          scopes: ["profile:read"],
          created_at: "2026-03-01T00:00:00.000Z",
          expires_at: "2099-06-01T00:00:00.000Z",
          last_used_at: null,
          revoked_at: null,
        },
      });

    render(<ApiTokensPage />);
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    const createDialog = screen.getByRole("dialog", { name: "Create API token" });
    fireEvent.change(within(createDialog).getByPlaceholderText("ansible-production"), { target: { value: "step-up-automation" } });
    fireEvent.click(within(createDialog).getByRole("button", { name: "Create token" }));

    const verificationDialog = await screen.findByRole("dialog", { name: "Verify with passkey" });
    fireEvent.click(within(verificationDialog).getByRole("button", { name: "Verify with passkey" }));

    await waitFor(() => expect(createApiTokenMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("New API token: step-up-automation")).toBeInTheDocument();
  });

  it("does not wrap defensive token revocation in passkey verification", async () => {
    listApiTokensMock.mockResolvedValue([
      {
        id: "tok-step-up-revoke",
        name: "deployment-bot",
        scopes: ["manager:read"],
        created_at: "2026-03-01T00:00:00.000Z",
        expires_at: "2099-06-01T00:00:00.000Z",
        last_used_at: null,
        revoked_at: null,
      },
    ]);
    revokeApiTokenMock.mockRejectedValueOnce(recentWebAuthnRequiredError());

    render(<ApiTokensPage />);
    await screen.findByText("deployment-bot");
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Revoke API token?" })).getByRole("button", { name: "Revoke token" }));

    expect(await screen.findByText("Recent WebAuthn verification required")).toBeInTheDocument();
    expect(revokeApiTokenMock).toHaveBeenCalledTimes(1);
    expect(beginRecentWebAuthnVerificationMock).not.toHaveBeenCalled();
  });

  it("surfaces a second guard response without opening another verification prompt", async () => {
    createApiTokenMock
      .mockRejectedValueOnce(recentWebAuthnRequiredError())
      .mockRejectedValueOnce(recentWebAuthnRequiredError());

    render(<ApiTokensPage />);
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    const createDialog = screen.getByRole("dialog", { name: "Create API token" });
    fireEvent.change(within(createDialog).getByPlaceholderText("ansible-production"), { target: { value: "still-locked" } });
    fireEvent.click(within(createDialog).getByRole("button", { name: "Create token" }));
    const verificationDialog = await screen.findByRole("dialog", { name: "Verify with passkey" });
    fireEvent.click(within(verificationDialog).getByRole("button", { name: "Verify with passkey" }));

    expect(await within(createDialog).findByText("Recent WebAuthn verification required")).toBeInTheDocument();
    expect(createApiTokenMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog", { name: "Verify with passkey" })).not.toBeInTheDocument();
  });
});
