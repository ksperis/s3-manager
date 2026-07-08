import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BillingPage from "./BillingPage";

const mocks = vi.hoisted(() => ({
  collectBillingDaily: vi.fn(),
  downloadBillingCsv: vi.fn(),
  getBillingSubjectDetail: vi.fn(),
  getBillingSubjects: vi.fn(),
  getBillingSummary: vi.fn(),
  listStorageEndpoints: vi.fn(),
}));

vi.mock("../../api/billing", () => ({
  collectBillingDaily: (...args: unknown[]) => mocks.collectBillingDaily(...args),
  downloadBillingCsv: (...args: unknown[]) => mocks.downloadBillingCsv(...args),
  getBillingSubjectDetail: (...args: unknown[]) => mocks.getBillingSubjectDetail(...args),
  getBillingSubjects: (...args: unknown[]) => mocks.getBillingSubjects(...args),
  getBillingSummary: (...args: unknown[]) => mocks.getBillingSummary(...args),
}));

vi.mock("../../api/storageEndpoints", () => ({
  listStorageEndpoints: () => mocks.listStorageEndpoints(),
}));

vi.mock("recharts", () => {
  const Chart = () => <div data-testid="billing-chart" />;
  const Passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Area: () => null,
    AreaChart: Chart,
    Bar: () => null,
    BarChart: Chart,
    CartesianGrid: () => null,
    ResponsiveContainer: Passthrough,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
  };
});

function renderPage() {
  render(
    <MemoryRouter>
      <BillingPage />
    </MemoryRouter>
  );
}

function summary(overrides = {}) {
  return {
    month: "2026-06",
    storage_endpoint_id: 7,
    usage: { bytes_in: 1024, bytes_out: 2048, ops_total: 1500 },
    storage: { avg_bytes: 4096, avg_gb_month: 0.0000038, total_objects: 10 },
    coverage: {
      days_collected: 24,
      days_in_month: 30,
      coverage_ratio: 0.8,
      storage_days_collected: 24,
      usage_days_collected: 24,
    },
    cost: { total_cost: 12.5, currency: "EUR", rate_card_name: "default" },
    ...overrides,
  };
}

function subject(id: number, name: string) {
  return {
    subject_type: "account",
    subject_id: id,
    name,
    rgw_identifier: `rgw-${id}`,
    storage: { avg_bytes: 2048, avg_gb_month: 0.0000019, total_objects: 4 },
    usage: { bytes_in: 512, bytes_out: 1024, ops_total: 250 },
    cost: { total_cost: 3.75, currency: "EUR", rate_card_name: "default" },
  };
}

function detail(id: number, name: string) {
  return {
    month: "2026-06",
    subject_type: "account",
    subject_id: id,
    name,
    rgw_identifier: `rgw-${id}`,
    daily: [{ day: "2026-06-01", storage_bytes: 2048, bytes_in: 512, bytes_out: 1024, ops_total: 250 }],
    usage: { bytes_in: 512, bytes_out: 1024, ops_total: 250 },
    storage: { avg_bytes: 2048, avg_gb_month: 0.0000019, total_objects: 4 },
    coverage: {
      days_collected: 2,
      days_in_month: 30,
      coverage_ratio: 0.07,
      storage_days_collected: 1,
      usage_days_collected: 2,
    },
    cost: { total_cost: 3.75, currency: "EUR", rate_card_name: "default" },
  };
}

describe("BillingPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    Object.defineProperty(window.URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(window.URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(window.URL, "createObjectURL").mockReturnValue("blob:billing");
    vi.spyOn(window.URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    mocks.listStorageEndpoints.mockResolvedValue([
      { id: 7, name: "Ceph main", provider: "ceph", endpoint_url: "https://rgw.example.test", is_default: true },
      { id: 8, name: "MinIO lab", provider: "minio", endpoint_url: "https://minio.example.test", is_default: false },
    ]);
    mocks.getBillingSummary.mockResolvedValue(summary());
    mocks.getBillingSubjects.mockImplementation((_month, _endpointId, _subjectType, page) => {
      const item = page === 2 ? subject(43, "Tenant B") : subject(42, "Tenant A");
      return Promise.resolve({ items: [item], total: 30, page, page_size: 25, has_next: page === 1 });
    });
    mocks.getBillingSubjectDetail.mockImplementation((_month, _endpointId, _type, subjectId) =>
      Promise.resolve(detail(Number(subjectId), Number(subjectId) === 43 ? "Tenant B" : "Tenant A"))
    );
    mocks.collectBillingDaily.mockResolvedValue({
      day: "2026-06-30",
      endpoints: 1,
      storage_records: 1,
      usage_records: 0,
      errors: [{ subject: "account", subject_id: 42, error: "RGW usage denied" }],
    });
    mocks.downloadBillingCsv.mockResolvedValue(new Blob(["subject_type\n"], { type: "text/csv" }));
  });

  it("renders billing data, paginates subjects, selects a subject, and exports CSV", async () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Billing" })).toBeInTheDocument();
    expect(await screen.findByText("Tenant A")).toBeInTheDocument();
    expect(screen.getByText("12.50 EUR")).toBeInTheDocument();
    expect(mocks.getBillingSubjects).toHaveBeenCalledWith("2026-07", 7, "account", 1, 25, "name", "asc");
    expect(screen.getByLabelText("Month")).toHaveValue("2026-07");
    expect(screen.getByLabelText("Month")).toHaveAttribute("type", "month");
    expect(screen.getByRole("combobox", { name: "Endpoint" })).toHaveValue("7");
    expect(screen.getByRole("combobox", { name: "Subject" })).toHaveValue("account");
    expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveValue("name");
    expect(screen.getByRole("combobox", { name: "Direction" })).toHaveValue("asc");
    expect(screen.getByLabelText("Collect day")).toHaveAttribute("type", "date");

    const table = screen.getByRole("table");
    expect(table).toHaveClass("responsive-data-table");
    expect(within(table).getByRole("button", { name: "View billing detail for Tenant A" }).closest("td")).toHaveAttribute(
      "data-mobile-primary",
      "true"
    );
    expect(within(table).getByText("2.0 KB").closest("td")).toHaveAttribute("data-label", "Storage avg");
    expect(within(table).getByText("250").closest("td")).toHaveAttribute("data-label", "Requests");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Tenant B")).toBeInTheDocument();
    await waitFor(() => expect(mocks.getBillingSubjects).toHaveBeenLastCalledWith("2026-07", 7, "account", 2, 25, "name", "asc"));

    fireEvent.click(screen.getByRole("button", { name: "View billing detail for Tenant B" }));
    await waitFor(() => expect(mocks.getBillingSubjectDetail).toHaveBeenCalledWith("2026-07", 7, "account", 43));
    expect(await screen.findByText("This subject has partial source coverage: Storage 1d · Usage 2d.")).toBeInTheDocument();

    const exportButton = screen.getByRole("button", { name: "Export CSV" });
    expect(exportButton).toBeEnabled();
    fireEvent.click(exportButton);
    await waitFor(() => expect(mocks.downloadBillingCsv).toHaveBeenCalledWith("2026-07", 7));
  });

  it("sorts subjects from the shared table headers", async () => {
    renderPage();

    await screen.findByText("Tenant A");
    fireEvent.click(screen.getByRole("button", { name: /^Cost$/ }));

    await waitFor(() => expect(mocks.getBillingSubjects).toHaveBeenLastCalledWith("2026-07", 7, "account", 1, 25, "cost", "desc"));

    fireEvent.click(screen.getByRole("button", { name: /Cost/ }));

    await waitFor(() => expect(mocks.getBillingSubjects).toHaveBeenLastCalledWith("2026-07", 7, "account", 1, 25, "cost", "asc"));
  });

  it("selects a subject with keyboard activation", async () => {
    const user = userEvent.setup();
    renderPage();

    const subjectButton = await screen.findByRole("button", { name: "View billing detail for Tenant A" });
    subjectButton.focus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(mocks.getBillingSubjectDetail).toHaveBeenCalledWith("2026-07", 7, "account", 42));
  });

  it("shows manual collection details with partial errors", async () => {
    renderPage();

    await screen.findByText("Tenant A");
    fireEvent.click(screen.getByRole("button", { name: "Collect daily" }));

    expect(await screen.findByText(/Collection finished with issues for/)).toBeInTheDocument();
    expect(screen.getByText("account #42: RGW usage denied")).toBeInTheDocument();
    await waitFor(() => expect(mocks.getBillingSummary).toHaveBeenCalledTimes(2));
  });

  it("disables export and explains empty billing data", async () => {
    mocks.getBillingSummary.mockResolvedValue(summary({
      usage: { bytes_in: 0, bytes_out: 0, ops_total: 0 },
      storage: { avg_bytes: null, avg_gb_month: null, total_objects: null },
      coverage: { days_collected: 0, days_in_month: 30, coverage_ratio: 0, storage_days_collected: 0, usage_days_collected: 0 },
      cost: null,
    }));
    mocks.getBillingSubjects.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25, has_next: false });

    renderPage();

    expect(await screen.findByText("No subjects for this scope.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
  });

  it("keeps table errors inside the subjects section", async () => {
    mocks.getBillingSubjects.mockRejectedValue(new Error("subject query failed"));

    renderPage();

    expect(await screen.findByText("Unable to load subjects.")).toBeInTheDocument();
    expect(screen.getByText("subject query failed")).toBeInTheDocument();
  });
});
