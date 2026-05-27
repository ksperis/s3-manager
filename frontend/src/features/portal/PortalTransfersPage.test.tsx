import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PortalTransfersPage from "./PortalTransfersPage";

vi.mock("./usePortalWorkspaceData", () => ({
  usePortalWorkspaceData: () => ({
    workspace: {
      transfers: [
        {
          id: "audit-1",
          name: "report.csv",
          direction: "Upload",
          status: "Completed",
          progress: 100,
          sizeBytes: 42,
          spaceName: "Research Data",
          startedLabel: "2m ago",
          etaLabel: "Completed",
          speedLabel: "-",
        },
      ],
    },
    loading: false,
    accountLoading: false,
    error: null,
    accountError: null,
    hasAccountContext: true,
  }),
}));

describe("PortalTransfersPage", () => {
  it("renders recent transfers from portal transfer data", () => {
    render(<PortalTransfersPage />);

    expect(screen.getByRole("heading", { name: "Transfers" })).toBeInTheDocument();
    expect(screen.getByText("report.csv")).toBeInTheDocument();
    expect(screen.getByText("Upload")).toBeInTheDocument();
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
  });
});
