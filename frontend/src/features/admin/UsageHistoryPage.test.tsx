import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneralSettings } from "../../api/appSettings";
import type { UsageHistoryResponse } from "../../api/usageHistory";
import UsageHistoryPage from "./UsageHistoryPage";

const mocks = vi.hoisted(() => ({
  collectUsageHistory: vi.fn(),
  generalSettings: {} as GeneralSettings,
  listStorageEndpoints: vi.fn(),
  listUsageHistory: vi.fn(),
}));

vi.mock("../../api/storageEndpoints", () => ({
  listStorageEndpoints: () => mocks.listStorageEndpoints(),
}));

vi.mock("../../api/usageHistory", () => ({
  collectUsageHistory: (...args: unknown[]) => mocks.collectUsageHistory(...args),
  listUsageHistory: (...args: unknown[]) => mocks.listUsageHistory(...args),
}));

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    generalSettings: mocks.generalSettings,
  }),
}));

function buildGeneralSettings(overrides: Partial<GeneralSettings> = {}): GeneralSettings {
  return {
    manager_enabled: true,
    ceph_admin_enabled: false,
    storage_ops_enabled: false,
    browser_enabled: true,
    browser_root_enabled: true,
    browser_manager_enabled: true,
    browser_portal_enabled: false,
    browser_ceph_admin_enabled: false,
    portal_enabled: false,
    billing_enabled: false,
    endpoint_status_enabled: false,
    quota_alerts_enabled: false,
    usage_history_enabled: true,
    bucket_migration_enabled: false,
    bucket_purge_enabled: false,
    bucket_compare_enabled: true,
    bucket_integrity_check_enabled: true,
    manager_ceph_s3_user_keys_enabled: true,
    allow_login_access_keys: false,
    allow_login_endpoint_list: false,
    allow_login_custom_endpoint: false,
    ...overrides,
  };
}

function makeHistory(): UsageHistoryResponse {
  return {
    items: [
      {
        id: 1,
        granularity: "daily",
        period_start: "2026-06-07",
        storage_endpoint_id: 7,
        endpoint_name: "Ceph main",
        subject_type: "account",
        subject_id: 12,
        subject_name: "Tenant A",
        subject_identifier: "tenant-a",
        used_bytes: 2048,
        used_objects: 5,
        usage_ratio_pct: 50,
        samples_count: 2,
        collected_at: "2026-06-07T12:00:00",
      },
    ],
    total: 1,
    page: 1,
    page_size: 100,
    has_next: false,
    summary: {
      total_records: 1,
      subjects_count: 1,
      latest_collected_at: "2026-06-07T12:00:00",
      max_usage_ratio_pct: 50,
    },
  };
}

function renderPage() {
  render(
    <MemoryRouter>
      <UsageHistoryPage />
    </MemoryRouter>
  );
}

describe("UsageHistoryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generalSettings = buildGeneralSettings();
    mocks.listStorageEndpoints.mockResolvedValue([
      {
        id: 7,
        name: "Ceph main",
        provider: "ceph",
        endpoint_url: "https://rgw.example.test",
        is_default: true,
      },
    ]);
    mocks.listUsageHistory.mockResolvedValue(makeHistory());
    mocks.collectUsageHistory.mockResolvedValue({
      subjects_processed: 1,
      history_hourly_upserts: 1,
      history_daily_upserts: 1,
      errors: [],
    });
  });

  it("renders usage history rows with shared admin controls", async () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Usage history" })).toBeInTheDocument();
    expect(screen.getByText("Review quota usage trends for RGW accounts and users.")).toBeInTheDocument();
    expect(screen.getByText("History scope")).toBeInTheDocument();
    expect(await screen.findByText("Tenant A")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.getAllByText("50%").length).toBeGreaterThan(0);
    expect(screen.getByRole("combobox", { name: "Granularity" })).toHaveValue("daily");
    expect(screen.getByRole("combobox", { name: "Endpoint" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Subject" })).toHaveValue("all");
    expect(screen.getByLabelText("Start")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("End")).toHaveAttribute("type", "date");
    expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveValue("period");
    expect(screen.getByRole("combobox", { name: "Direction" })).toHaveValue("desc");
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();

    const table = screen.getByRole("table");
    expect(table).toHaveClass("responsive-data-table");
    expect(within(table).getByText("2026-06-07").closest("td")).toHaveAttribute("data-mobile-primary", "true");
    expect(within(table).getByText("Ceph main").closest("td")).toHaveAttribute("data-label", "Endpoint");
    expect(within(table).getByText("Tenant A").closest("td")).toHaveAttribute("data-label", "Subject");
    expect(within(table).getByText("2.0 KB").closest("td")).toHaveAttribute("data-label", "Storage");
  });

  it("sorts usage history from the shared table headers", async () => {
    renderPage();

    await screen.findByText("Tenant A");
    fireEvent.click(screen.getByRole("button", { name: /^Storage$/ }));

    await waitFor(() =>
      expect(mocks.listUsageHistory).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sortBy: "used_bytes",
          sortDir: "desc",
        })
      )
    );

    fireEvent.click(screen.getByRole("button", { name: /Storage/ }));

    await waitFor(() =>
      expect(mocks.listUsageHistory).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sortBy: "used_bytes",
          sortDir: "asc",
        })
      )
    );
  });

  it("triggers collection from the top action and reloads history", async () => {
    renderPage();

    await screen.findByText("Tenant A");
    fireEvent.click(screen.getByRole("button", { name: /collect usage/i }));

    await waitFor(() => expect(mocks.collectUsageHistory).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Collection completed: 1 subject processed/)).toBeInTheDocument();
    await waitFor(() => expect(mocks.listUsageHistory).toHaveBeenCalledTimes(2));
  });

  it("surfaces collection errors returned by the backend", async () => {
    mocks.collectUsageHistory.mockResolvedValueOnce({
      subjects_processed: 0,
      history_hourly_upserts: 0,
      history_daily_upserts: 0,
      errors: [{ error: "Usage collection failed: RGW admin error 403: AccessDenied" }],
    });

    renderPage();

    await screen.findByText("Tenant A");
    fireEvent.click(screen.getByRole("button", { name: /collect usage/i }));

    expect(await screen.findByText(/Collection finished with 1 error/)).toBeInTheDocument();
    expect(screen.getByText(/First error: Usage collection failed/)).toBeInTheDocument();
  });

  it("shows collection warnings without hiding the successful snapshot count", async () => {
    mocks.collectUsageHistory.mockResolvedValueOnce({
      subjects_processed: 1,
      history_hourly_upserts: 1,
      history_daily_upserts: 1,
      errors: [],
      warnings: [{ warning: "Quota client unavailable for endpoint 'Ceph main'." }],
    });

    renderPage();

    await screen.findByText("Tenant A");
    fireEvent.click(screen.getByRole("button", { name: /collect usage/i }));

    expect(await screen.findByText(/Collection completed: 1 subject processed/)).toBeInTheDocument();
    expect(screen.getByText(/Collection finished with 1 warning/)).toBeInTheDocument();
  });

  it("uses the disabled feature page when usage history is off", () => {
    mocks.generalSettings = buildGeneralSettings({ usage_history_enabled: false });

    renderPage();

    expect(screen.getByText("Usage history disabled")).toBeInTheDocument();
    expect(mocks.listUsageHistory).not.toHaveBeenCalled();
  });
});
