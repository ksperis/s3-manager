import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StorageOpsDashboard from "./StorageOpsDashboard";
import { fetchStorageOpsSummary } from "../../api/storageOps";

vi.mock("../../api/storageOps", () => ({
  fetchStorageOpsSummary: vi.fn(),
}));

const mockFetchStorageOpsSummary = vi.mocked(fetchStorageOpsSummary);

function renderDashboard() {
  return render(
    <MemoryRouter>
      <StorageOpsDashboard />
    </MemoryRouter>
  );
}

describe("StorageOpsDashboard", () => {
  beforeEach(() => {
    mockFetchStorageOpsSummary.mockReset();
  });

  it("renders the managed context summary and bucket navigation", async () => {
    mockFetchStorageOpsSummary.mockResolvedValue({
      total_contexts: 4,
      total_accounts: 1,
      total_s3_users: 1,
      total_connections: 2,
      total_shared_connections: 1,
      total_private_connections: 1,
      total_endpoints: 2,
    });

    renderDashboard();

    const summaryLabel = await screen.findByText("Managed contexts");
    const summaryCard = summaryLabel.closest("section");
    expect(summaryCard).not.toBeNull();
    expect(within(summaryCard as HTMLElement).getByText("4")).toBeInTheDocument();
    expect(
      within(summaryCard as HTMLElement).getByText(
        "Accounts: 1 | S3 users: 1 | Connections: 2 | Shared: 1 | Private: 1 | Endpoints: 2"
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Buckets/i })).toHaveAttribute("href", "/storage-ops/buckets");
  });

  it("keeps navigation visible when the summary fails", async () => {
    mockFetchStorageOpsSummary.mockRejectedValue(new Error("Summary down"));

    renderDashboard();

    await waitFor(() => expect(screen.getByText("Summary down")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /Buckets/i })).toHaveAttribute("href", "/storage-ops/buckets");
  });
});
