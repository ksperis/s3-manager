import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AuditLogsPage from "./AuditLogsPage";

const listAuditLogsMock = vi.fn();

vi.mock("../../api/audit", async () => {
  const actual = await vi.importActual<typeof import("../../api/audit")>("../../api/audit");
  return {
    ...actual,
    listAuditLogs: (...args: unknown[]) => listAuditLogsMock(...args),
  };
});

describe("AuditLogsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listAuditLogsMock.mockResolvedValue({
      logs: [
        {
          id: 1,
          created_at: "2026-03-22T10:00:00Z",
          user_email: "admin@example.com",
          user_role: "ui_admin",
          scope: "admin",
          action: "users.update",
          status: "success",
          entity_type: "user",
          entity_id: "12",
          account_name: null,
          account_id: null,
          metadata: { changed: true },
        },
      ],
      next_cursor: null,
    });
  });

  it("renders the admin control strip and list toolbar for the audit trail", async () => {
    render(
      <MemoryRouter>
        <AuditLogsPage />
      </MemoryRouter>
    );

    expect(screen.getByText("Audit scope")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("1 entry")).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "Audit trail" })).toBeInTheDocument();
  });
});
