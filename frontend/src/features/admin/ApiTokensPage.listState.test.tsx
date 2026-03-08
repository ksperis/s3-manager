import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ApiTokensPage from "./ApiTokensPage";

const listApiTokensMock = vi.fn();

vi.mock("../../api/apiTokens", () => ({
  listApiTokens: (includeRevoked?: boolean) => listApiTokensMock(includeRevoked),
  createApiToken: vi.fn(),
  revokeApiToken: vi.fn(),
}));

describe("ApiTokensPage list states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows error banner and error row when list load fails with no rows", async () => {
    listApiTokensMock.mockRejectedValueOnce(new Error("Failed to load tokens"));

    render(<ApiTokensPage />);

    expect(await screen.findByText("Failed to load tokens")).toBeInTheDocument();
    expect(screen.getByText("Unable to load API tokens.")).toBeInTheDocument();
  });

  it("keeps existing rows on refresh failure and does not show table error row", async () => {
    listApiTokensMock
      .mockResolvedValueOnce([
        {
          id: "tok-1",
          name: "token-alpha",
          created_at: "2026-03-01T00:00:00.000Z",
          expires_at: "2026-06-01T00:00:00.000Z",
          last_used_at: null,
          revoked_at: null,
        },
      ])
      .mockRejectedValueOnce(new Error("Refresh failed"));

    render(<ApiTokensPage />);

    expect(await screen.findByText("token-alpha")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByText("Refresh failed")).toBeInTheDocument();
    expect(screen.getByText("token-alpha")).toBeInTheDocument();
    expect(screen.queryByText("Unable to load API tokens.")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(listApiTokensMock).toHaveBeenCalledTimes(2);
    });
  });
});
