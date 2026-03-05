import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ManagerMigrationDetailPage from "./ManagerMigrationDetailPage";

const mockUseManagerContexts = vi.fn();
const mockUseManagerMigrationDetail = vi.fn();

vi.mock("./hooks", () => ({
  useManagerContexts: () => mockUseManagerContexts(),
  useManagerMigrationDetail: (migrationId: number | null) => mockUseManagerMigrationDetail(migrationId),
}));

function buildDetail() {
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
    use_same_endpoint_copy: true,
    auto_grant_source_read_for_copy: true,
    webhook_url: null,
    mapping_prefix: "",
    status: "running",
    pause_requested: false,
    cancel_requested: false,
    precheck_status: "passed",
    precheck_report: {
      errors: 1,
      warnings: 1,
      items: [
        {
          item_id: 101,
          errors: 0,
          warnings: 1,
          messages: [{ level: "warning", message: "Target bucket already exists; this item will be skipped." }],
        },
        {
          item_id: 103,
          errors: 1,
          warnings: 0,
          messages: [{ level: "error", message: "Source bucket read/list check failed: access denied." }],
        },
      ],
    },
    precheck_checked_at: null,
    parallelism_max: 8,
    total_items: 3,
    completed_items: 1,
    failed_items: 1,
    skipped_items: 0,
    awaiting_items: 0,
    error_message: null,
    started_at: "2026-03-05T10:00:00Z",
    finished_at: null,
    last_heartbeat_at: "2026-03-05T10:00:05Z",
    created_at: "2026-03-05T10:00:00Z",
    updated_at: "2026-03-05T10:00:05Z",
    items: [
      {
        id: 101,
        source_bucket: "bucket-running",
        target_bucket: "bucket-running-copy",
        status: "running",
        step: "sync",
        pre_sync_done: false,
        read_only_applied: true,
        target_lock_applied: true,
        target_bucket_exists: false,
        objects_copied: 25,
        objects_deleted: 0,
        source_count: 100,
        target_count: 20,
        matched_count: 20,
        different_count: 5,
        only_source_count: 75,
        only_target_count: 0,
        diff_sample: null,
        error_message: null,
        started_at: "2026-03-05T10:00:01Z",
        finished_at: null,
        created_at: "2026-03-05T10:00:01Z",
        updated_at: "2026-03-05T10:00:05Z",
      },
      {
        id: 102,
        source_bucket: "bucket-unknown",
        target_bucket: "bucket-unknown-copy",
        status: "pending",
        step: "sync",
        pre_sync_done: false,
        read_only_applied: false,
        target_lock_applied: true,
        target_bucket_exists: false,
        objects_copied: 3,
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
        created_at: "2026-03-05T10:00:01Z",
        updated_at: "2026-03-05T10:00:05Z",
      },
      {
        id: 103,
        source_bucket: "bucket-failed",
        target_bucket: "bucket-failed-copy",
        status: "failed",
        step: "verify",
        pre_sync_done: false,
        read_only_applied: true,
        target_lock_applied: true,
        target_bucket_exists: false,
        objects_copied: 20,
        objects_deleted: 0,
        source_count: 20,
        target_count: 20,
        matched_count: 18,
        different_count: 2,
        only_source_count: 0,
        only_target_count: 0,
        diff_sample: null,
        error_message: "Final diff is not clean",
        started_at: "2026-03-05T10:00:01Z",
        finished_at: "2026-03-05T10:02:00Z",
        created_at: "2026-03-05T10:00:01Z",
        updated_at: "2026-03-05T10:02:00Z",
      },
      {
        id: 104,
        source_bucket: "bucket-completed",
        target_bucket: "bucket-completed-copy",
        status: "completed",
        step: "completed",
        pre_sync_done: false,
        read_only_applied: true,
        target_lock_applied: true,
        target_bucket_exists: false,
        objects_copied: 10,
        objects_deleted: 0,
        source_count: 10,
        target_count: 10,
        matched_count: 10,
        different_count: 0,
        only_source_count: 0,
        only_target_count: 0,
        diff_sample: null,
        error_message: null,
        started_at: "2026-03-05T10:00:01Z",
        finished_at: "2026-03-05T10:01:00Z",
        created_at: "2026-03-05T10:00:01Z",
        updated_at: "2026-03-05T10:01:00Z",
      },
    ],
    recent_events: [],
  } as const;
}

describe("ManagerMigrationDetailPage", () => {
  beforeEach(() => {
    mockUseManagerContexts.mockReturnValue({
      contextLabelById: new Map([
        ["src-ctx", "Source"],
        ["tgt-ctx", "Target"],
      ]),
    });
    mockUseManagerMigrationDetail.mockReturnValue({
      migrationDetail: buildDetail(),
      detailLoading: false,
      detailError: null,
      setDetailError: vi.fn(),
      refresh: vi.fn(),
    });
  });

  it("shows focused bucket progress with and without source_count", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter initialEntries={["/manager/migrations/11"]}>
        <Routes>
          <Route path="/manager/migrations/:migrationId" element={<ManagerMigrationDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/bucket-running/)).toBeInTheDocument();
    expect(screen.getByText(/bucket-failed/)).toBeInTheDocument();
    expect(screen.queryByText(/bucket-completed/)).not.toBeInTheDocument();

    expect(screen.getByText("Copy progress: 25/100 (25%)")).toBeInTheDocument();
    expect(screen.queryByText(/Copy progress: 3\//)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText(/bucket-completed/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Failed" }));
    expect(screen.getByText(/bucket-failed/)).toBeInTheDocument();
    expect(screen.queryByText(/bucket-running/)).not.toBeInTheDocument();

    expect(screen.getByText("Precheck: 1 error(s), 0 warning(s)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show precheck details" }));
    expect(screen.getByText(/Source bucket read\/list check failed: access denied\./)).toBeInTheDocument();
    expect(screen.queryByText("Precheck result:")).not.toBeInTheDocument();

    const hasLegacyBucketListScroll = Array.from(container.querySelectorAll("div")).some((node) =>
      String(node.className).includes("max-h-[520px]")
    );
    expect(hasLegacyBucketListScroll).toBe(false);
  });

  it("offers precheck action when draft precheck is pending", () => {
    const pendingDetail = { ...buildDetail(), status: "draft", precheck_status: "pending" } as const;
    mockUseManagerMigrationDetail.mockReturnValue({
      migrationDetail: pendingDetail,
      detailLoading: false,
      detailError: null,
      setDetailError: vi.fn(),
      refresh: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={["/manager/migrations/11"]}>
        <Routes>
          <Route path="/manager/migrations/:migrationId" element={<ManagerMigrationDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole("button", { name: "Run precheck" })).toBeInTheDocument();
  });
});
