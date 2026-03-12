import { render, screen } from "@testing-library/react";
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

  it("does not render summary filter header", () => {
    render(
      <MemoryRouter>
        <ManagerMigrationsListPage />
      </MemoryRouter>
    );

    expect(screen.queryByText("Total")).not.toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
  });

  it("prioritizes cancel_requested over draft in list ordering", () => {
    mockUseManagerMigrationsList.mockReturnValue({
      migrations: [buildMigration(30, "draft"), buildMigration(31, "cancel_requested"), buildMigration(32, "completed")],
      migrationsLoading: false,
      migrationsError: null,
    });

    render(
      <MemoryRouter>
        <ManagerMigrationsListPage />
      </MemoryRouter>
    );

    const titles = screen.getAllByText(/Migration #/i).map((node) => node.textContent);
    expect(titles[0]).toBe("Migration #31");
    expect(screen.getByText("Migration #30")).toBeInTheDocument();
    expect(screen.getByText("Migration #32")).toBeInTheDocument();
  });
});
