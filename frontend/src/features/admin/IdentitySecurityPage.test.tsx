/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../api/client";
import IdentitySecurityPage from "./IdentitySecurityPage";

const mocks = vi.hoisted(() => ({
  adminRevokeSession: vi.fn(),
  authenticatePasskey: vi.fn(),
  beginRecentWebAuthnVerification: vi.fn(),
  decideExternalLinkRequest: vi.fn(),
  finishRecentWebAuthnVerification: vi.fn(),
  listAdminSessions: vi.fn(),
  listExternalLinkRequests: vi.fn(),
}));

vi.mock("../../api/security", () => ({
  adminRevokeSession: mocks.adminRevokeSession,
  beginRecentWebAuthnVerification: mocks.beginRecentWebAuthnVerification,
  decideExternalLinkRequest: mocks.decideExternalLinkRequest,
  finishRecentWebAuthnVerification: mocks.finishRecentWebAuthnVerification,
  listAdminSessions: mocks.listAdminSessions,
  listExternalLinkRequests: mocks.listExternalLinkRequests,
}));

vi.mock("../../auth/webauthn", () => ({ authenticatePasskey: mocks.authenticatePasskey }));

function recentWebAuthnRequiredError() {
  return new ApiError("Request failed", {
    response: {
      status: 403,
      data: { detail: "Recent WebAuthn verification required" },
      headers: {},
    },
  });
}

describe("IdentitySecurityPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listExternalLinkRequests.mockResolvedValue([
      {
        id: "request-1",
        user_id: 2,
        user_email: "candidate@example.com",
        user_role: "ui_user",
        provider_type: "oidc",
        provider_id: "company",
        email: "candidate@example.com",
        status: "pending",
        created_at: "2026-08-14T10:00:00Z",
        expires_at: "2026-08-15T10:00:00Z",
      },
    ]);
    mocks.listAdminSessions.mockResolvedValue([
      {
        id: "session-1",
        principal_type: "user",
        auth_type: "password",
        user_id: 2,
        user_email: "candidate@example.com",
        user_full_name: "Candidate User",
        user_role: "ui_user",
        created_at: "2026-08-14T10:00:00Z",
        last_activity_at: "2026-08-14T10:05:00Z",
        idle_expires_at: "2026-08-14T22:05:00Z",
        absolute_expires_at: "2026-08-21T10:00:00Z",
      },
    ]);
    mocks.decideExternalLinkRequest.mockResolvedValue({ id: "request-1", status: "approved" });
    mocks.adminRevokeSession.mockResolvedValue(undefined);
    mocks.beginRecentWebAuthnVerification.mockResolvedValue({ challenge: "challenge" });
    mocks.authenticatePasskey.mockResolvedValue({ id: "credential" });
    mocks.finishRecentWebAuthnVerification.mockResolvedValue({ mfa_verified_at: "2026-08-14T10:00:00Z" });
  });

  it("presents identity requests and sessions as structured administration views", async () => {
    const user = userEvent.setup();
    render(<IdentitySecurityPage />);

    const requestsPanel = await screen.findByRole("tabpanel", { name: /Link requests/ });
    expect(within(requestsPanel).getByText("External identity link requests")).toBeInTheDocument();
    expect(within(requestsPanel).getAllByText("candidate@example.com")).toHaveLength(2);
    expect(within(requestsPanel).getByText("OIDC")).toBeInTheDocument();
    expect(within(requestsPanel).getByText("User")).toBeInTheDocument();
    expect(within(requestsPanel).getByRole("table")).toHaveClass("responsive-data-table", "compact-table");
    expect(screen.queryByText("ui_user")).not.toBeInTheDocument();
    expect(screen.queryByText("Candidate User")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Active sessions/ }));
    const sessionsPanel = screen.getByRole("tabpanel", { name: /Active sessions/ });
    expect(within(sessionsPanel).getByText("Platform sessions")).toBeInTheDocument();
    expect(within(sessionsPanel).getByText("Candidate User")).toBeInTheDocument();
    expect(within(sessionsPanel).getByText("Password")).toBeInTheDocument();
    expect(within(sessionsPanel).getAllByText("User")).toHaveLength(2);
    expect(within(sessionsPanel).getByRole("table")).toHaveClass("responsive-data-table", "compact-table");
  });

  it("confirms link decisions and session revocation", async () => {
    const user = userEvent.setup();
    render(<IdentitySecurityPage />);

    await user.click(await screen.findByRole("button", { name: "Approve" }));
    const linkDialog = screen.getByRole("dialog", { name: "Approve identity link" });
    expect(mocks.decideExternalLinkRequest).not.toHaveBeenCalled();
    expect(within(linkDialog).getByText("oidc:company")).toBeInTheDocument();
    await user.click(within(linkDialog).getByRole("button", { name: "Approve link" }));
    await waitFor(() => expect(mocks.decideExternalLinkRequest).toHaveBeenCalledWith("request-1", true));

    await user.click(screen.getByRole("tab", { name: /Active sessions/ }));
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    const dialog = screen.getByRole("dialog", { name: "Revoke session" });
    expect(mocks.adminRevokeSession).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Revoke session" }));
    await waitFor(() => expect(mocks.adminRevokeSession).toHaveBeenCalledWith("session-1"));
  });

  it("retries only an approved identity link after recent passkey verification", async () => {
    const user = userEvent.setup();
    mocks.decideExternalLinkRequest
      .mockRejectedValueOnce(recentWebAuthnRequiredError())
      .mockResolvedValueOnce({ id: "request-1", status: "approved" });
    render(<IdentitySecurityPage />);

    await user.click(await screen.findByRole("button", { name: "Approve" }));
    await user.click(within(screen.getByRole("dialog", { name: "Approve identity link" })).getByRole("button", { name: "Approve link" }));
    const verificationDialog = await screen.findByRole("dialog", { name: "Verify with passkey" });
    await user.click(within(verificationDialog).getByRole("button", { name: "Verify with passkey" }));

    await waitFor(() => expect(mocks.decideExternalLinkRequest).toHaveBeenCalledTimes(2));
    expect(mocks.decideExternalLinkRequest).toHaveBeenNthCalledWith(2, "request-1", true);
    expect(mocks.beginRecentWebAuthnVerification).toHaveBeenCalledOnce();
    expect(mocks.authenticatePasskey).toHaveBeenCalledOnce();
    expect(mocks.finishRecentWebAuthnVerification).toHaveBeenCalledOnce();
  });

  it("rejects an identity link without invoking passkey verification", async () => {
    const user = userEvent.setup();
    render(<IdentitySecurityPage />);

    await user.click(await screen.findByRole("button", { name: "Reject" }));
    await user.click(within(screen.getByRole("dialog", { name: "Reject identity link request" })).getByRole("button", { name: "Reject request" }));

    await waitFor(() => expect(mocks.decideExternalLinkRequest).toHaveBeenCalledWith("request-1", false));
    expect(mocks.beginRecentWebAuthnVerification).not.toHaveBeenCalled();
  });

  it("keeps inventories hidden after a load error and offers a retry", async () => {
    const user = userEvent.setup();
    mocks.listAdminSessions.mockRejectedValueOnce(new Error("Session inventory unavailable"));
    render(<IdentitySecurityPage />);

    expect(await screen.findByText(/Session inventory unavailable|Unable to load identity security data/)).toBeInTheDocument();
    expect(screen.queryByText("No pending identity link requests.")).not.toBeInTheDocument();
    expect(screen.queryByText("No active sessions.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("tabpanel", { name: /Link requests/ })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Active sessions/ }));
    expect(screen.getByText("Candidate User")).toBeInTheDocument();
    expect(mocks.listAdminSessions).toHaveBeenCalledTimes(2);
  });
});
