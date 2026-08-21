import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ApiTokensPage from "./ApiTokensPage";

const listApiTokensMock = vi.fn();
const createApiTokenMock = vi.fn();
const revokeApiTokenMock = vi.fn();

vi.mock("../../api/apiTokens", () => ({
  listApiTokens: (includeRevoked?: boolean) => listApiTokensMock(includeRevoked),
  createApiToken: (...args: unknown[]) => createApiTokenMock(...args),
  revokeApiToken: (...args: unknown[]) => revokeApiTokenMock(...args),
}));

describe("ApiTokensPage list states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listApiTokensMock.mockResolvedValue([]);
    revokeApiTokenMock.mockResolvedValue(undefined);
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
});
