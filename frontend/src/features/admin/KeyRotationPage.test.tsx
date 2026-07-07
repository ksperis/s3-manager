import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import KeyRotationPage from "./KeyRotationPage";

const mocks = vi.hoisted(() => ({
  listStorageEndpoints: vi.fn(),
  rotateS3Keys: vi.fn(),
}));

vi.mock("../../api/storageEndpoints", () => ({
  listStorageEndpoints: () => mocks.listStorageEndpoints(),
}));

vi.mock("../../api/keyRotation", () => ({
  rotateS3Keys: (...args: unknown[]) => mocks.rotateS3Keys(...args),
}));

function renderPage() {
  render(
    <MemoryRouter>
      <KeyRotationPage />
    </MemoryRouter>
  );
}

describe("KeyRotationPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listStorageEndpoints.mockResolvedValue([
      {
        id: 7,
        name: "Ceph main",
        endpoint_url: "https://rgw.example.test",
        provider: "ceph",
        capabilities: { admin: true },
      },
      {
        id: 8,
        name: "Archive S3",
        endpoint_url: "https://archive.example.test",
        provider: "aws",
        capabilities: { admin: false },
      },
    ]);
    mocks.rotateS3Keys.mockResolvedValue({
      mode: "delete_old_keys",
      summary: {
        total: 1,
        rotated: 1,
        failed: 0,
        skipped: 0,
        deleted_old_keys: 1,
        disabled_old_keys: 0,
      },
      results: [
        {
          endpoint_id: 7,
          endpoint_name: "Ceph main",
          key_type: "account",
          target_type: "account",
          target_id: "tenant-a",
          target_label: "Tenant A",
          status: "rotated",
          message: "Rotated active account key.",
          old_access_key: "OLD123",
          new_access_key: "NEW456",
        },
      ],
    });
  });

  it("runs rotation and renders responsive execution results", async () => {
    renderPage();

    expect(await screen.findByText("Ceph main")).toBeInTheDocument();
    expect(screen.getByText("Archive S3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Run rotation" }));

    await waitFor(() =>
      expect(mocks.rotateS3Keys).toHaveBeenCalledWith({
        endpoint_ids: [7],
        key_types: ["endpoint_admin", "endpoint_supervision", "account", "s3_user", "ceph_admin"],
        deactivate_only: false,
      })
    );

    expect(await screen.findByText("Rotation completed successfully.")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(table).toHaveClass("responsive-data-table");
    expect(within(table).getByText("Ceph main").closest("td")).toHaveAttribute("data-mobile-primary", "true");
    expect(within(table).getByText("Account").closest("td")).toHaveAttribute("data-label", "Type");
    expect(within(table).getByText("Tenant A").closest("td")).toHaveAttribute("data-label", "Target");
    expect(within(table).getByText("rotated").closest("td")).toHaveAttribute("data-label", "Status");
    expect(within(table).getByText(/OLD123 -> NEW456/).closest("td")).toHaveAttribute("data-label", "Details");
  });
});
