import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ManagerMigrationDetailPage from "./ManagerMigrationDetailPage";
import ManagerMigrationsListPage from "./ManagerMigrationsListPage";
import ManagerMigrationWizardPage from "./ManagerMigrationWizardPage";

const listExecutionContextsMock = vi.fn();
const listBucketsMock = vi.fn();
const listManagerMigrationsMock = vi.fn();
const getManagerMigrationMock = vi.fn();
const streamManagerMigrationMock = vi.fn();

vi.mock("../../../api/executionContexts", () => ({
  listExecutionContexts: (...args: unknown[]) => listExecutionContextsMock(...args),
}));

vi.mock("../../../api/buckets", () => ({
  listBuckets: (...args: unknown[]) => listBucketsMock(...args),
}));

vi.mock("../../../api/managerMigrations", async () => {
  const actual = await vi.importActual("../../../api/managerMigrations");
  return {
    ...actual,
    listManagerMigrations: (...args: unknown[]) => listManagerMigrationsMock(...args),
    getManagerMigration: (...args: unknown[]) => getManagerMigrationMock(...args),
    streamManagerMigration: (...args: unknown[]) => streamManagerMigrationMock(...args),
    createManagerMigration: vi.fn(),
    updateManagerMigration: vi.fn(),
    runManagerMigrationPrecheck: vi.fn(),
    pauseManagerMigration: vi.fn(),
    resumeManagerMigration: vi.fn(),
    continueManagerMigration: vi.fn(),
    startManagerMigration: vi.fn(),
    stopManagerMigration: vi.fn(),
    rollbackManagerMigration: vi.fn(),
    retryManagerMigrationItem: vi.fn(),
    rollbackManagerMigrationItem: vi.fn(),
    retryFailedManagerMigrationItems: vi.fn(),
    rollbackFailedManagerMigrationItems: vi.fn(),
    deleteManagerMigration: vi.fn(),
  };
});

vi.mock("../S3AccountContext", () => ({
  useS3AccountContext: () => ({
    selectedS3AccountId: "src-ctx",
    requiresS3AccountSelection: true,
  }),
}));

function buildDraftDetail() {
  return {
    id: 11,
    created_by_user_id: 1,
    source_context_id: "src-ctx",
    target_context_id: "tgt-ctx",
    mode: "one_shot",
    copy_bucket_settings: true,
    delete_source: false,
    strong_integrity_check: false,
    lock_target_writes: true,
    use_same_endpoint_copy: false,
    auto_grant_source_read_for_copy: false,
    webhook_url: null,
    mapping_prefix: "",
    status: "draft",
    pause_requested: false,
    cancel_requested: false,
    precheck_status: "passed",
    precheck_report: null,
    precheck_checked_at: null,
    parallelism_max: 8,
    total_items: 1,
    completed_items: 0,
    failed_items: 0,
    skipped_items: 0,
    awaiting_items: 0,
    error_message: null,
    started_at: null,
    finished_at: null,
    last_heartbeat_at: null,
    created_at: "2026-03-05T10:00:00Z",
    updated_at: "2026-03-05T10:00:05Z",
    items: [
      {
        id: 101,
        source_bucket: "bucket-a",
        target_bucket: "bucket-a-copy",
        status: "pending",
        step: "create_bucket",
        pre_sync_done: false,
        read_only_applied: false,
        target_lock_applied: false,
        target_bucket_exists: false,
        objects_copied: 0,
        objects_deleted: 0,
        source_count: null,
        target_count: null,
        matched_count: null,
        different_count: null,
        only_source_count: null,
        only_target_count: null,
        diff_sample: null,
        error_message: null,
        started_at: null,
        finished_at: null,
        created_at: "2026-03-05T10:00:00Z",
        updated_at: "2026-03-05T10:00:05Z",
      },
    ],
    recent_events: [],
  };
}

describe("Manager migration routing", () => {
  beforeEach(() => {
    const detail = buildDraftDetail();
    listExecutionContextsMock.mockResolvedValue([
      { id: "src-ctx", display_name: "Source", endpoint_id: 1 },
      { id: "tgt-ctx", display_name: "Target", endpoint_id: 2 },
    ]);
    listBucketsMock.mockResolvedValue([{ name: "bucket-a" }]);
    listManagerMigrationsMock.mockResolvedValue([
      {
        ...detail,
        items: undefined,
        recent_events: undefined,
      },
    ]);
    getManagerMigrationMock.mockResolvedValue(detail);
    streamManagerMigrationMock.mockImplementation(async (_migrationId: number, options?: { onSnapshot?: (payload: unknown) => void }) => {
      options?.onSnapshot?.(detail);
      return detail;
    });
  });

  it("navigates list -> detail -> edit draft wizard", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/manager/migrations"]}>
        <Routes>
          <Route path="/manager/migrations" element={<ManagerMigrationsListPage />} />
          <Route path="/manager/migrations/:migrationId" element={<ManagerMigrationDetailPage />} />
          <Route path="/manager/migrations/new" element={<ManagerMigrationWizardPage />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText("Migration #11");
    await user.click(screen.getByRole("button", { name: /Migration #11/i }));

    await screen.findByRole("button", { name: "Edit draft" });
    await user.click(screen.getByRole("button", { name: "Edit draft" }));

    await waitFor(() => {
      expect(screen.getByText("Edit draft #11")).toBeInTheDocument();
    });
  });
});
