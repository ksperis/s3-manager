import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ManagerMigrationsListPage from "./ManagerMigrationsListPage";

const mockUseManagerContexts = vi.fn();
const mockUseManagerMigrationsList = vi.fn();

vi.mock("./hooks", () => ({
  useManagerContexts: () => mockUseManagerContexts(),
  useManagerMigrationsList: (sourceContextId: string) => mockUseManagerMigrationsList(sourceContextId),
}));

vi.mock("../S3AccountContext", () => ({
  useS3AccountContext: () => ({ selectedS3AccountId: "src-ctx" }),
}));

function buildMigration(id: number, status: string) {
  return {
    id,
    created_by_user_id: 1,
    source_context_id: "src-ctx",
    target_context_id: "tgt-ctx",
    mode: "one_shot",
    copy_bucket_settings: false,
    delete_source: false,
    strong_integrity_check: false,
    lock_target_writes: true,
    use_same_endpoint_copy: false,
    auto_grant_source_read_for_copy: false,
    webhook_url: null,
    mapping_prefix: "",
    status,
    pause_requested: false,
    cancel_requested: status === "cancel_requested",
    precheck_status: "passed",
    precheck_report: null,
    precheck_checked_at: null,
    parallelism_max: 4,
    total_items: 2,
    completed_items: 1,
    failed_items: 0,
    skipped_items: 0,
    awaiting_items: 0,
    error_message: null,
    started_at: null,
    finished_at: null,
    last_heartbeat_at: null,
    created_at: "2026-03-05T10:00:00Z",
    updated_at: "2026-03-05T10:00:01Z",
  } as const;
}

describe("ManagerMigrationsListPage", () => {
  beforeEach(() => {
    mockUseManagerContexts.mockReturnValue({
      contextLabelById: new Map([
        ["src-ctx", "Source"],
        ["tgt-ctx", "Target"],
      ]),
      contextsLoading: false,
      contextsError: null,
    });
    mockUseManagerMigrationsList.mockReturnValue({
      migrations: [buildMigration(11, "cancel_requested"), buildMigration(12, "completed")],
      migrationsLoading: false,
      migrationsError: null,
    });
  });

  it("counts cancel_requested as active", () => {
    render(
      <MemoryRouter>
        <ManagerMigrationsListPage />
      </MemoryRouter>
    );

    const activeCard = screen.getByText("Active").closest("button");
    expect(activeCard).not.toBeNull();
    expect(within(activeCard as HTMLButtonElement).getByText("1")).toBeInTheDocument();
  });

  it("keeps cancel_requested in active filter and prioritizes it over draft", async () => {
    mockUseManagerMigrationsList.mockReturnValue({
      migrations: [buildMigration(30, "draft"), buildMigration(31, "cancel_requested"), buildMigration(32, "completed")],
      migrationsLoading: false,
      migrationsError: null,
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ManagerMigrationsListPage />
      </MemoryRouter>
    );

    const titles = screen.getAllByText(/Migration #/i).map((node) => node.textContent);
    expect(titles[0]).toBe("Migration #31");

    await user.click(screen.getByRole("button", { name: /Active/i }));
    expect(screen.getByText("Migration #31")).toBeInTheDocument();
    expect(screen.queryByText("Migration #32")).not.toBeInTheDocument();
  });
});
