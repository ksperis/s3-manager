import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import EndpointStatusPage, { isLatencyMeaningfullyAboveAverage } from "./EndpointStatusPage";

const fetchHealthLatencyOverviewMock = vi.fn();
const fetchHealthOverviewMock = vi.fn();
const fetchHealthGlobalIncidentsMock = vi.fn();
const runHealthchecksMock = vi.fn();

vi.mock("../../api/healthchecks", async () => {
  const actual = await vi.importActual<typeof import("../../api/healthchecks")>("../../api/healthchecks");
  return {
    ...actual,
    fetchHealthLatencyOverview: (...args: unknown[]) => fetchHealthLatencyOverviewMock(...args),
    fetchHealthOverview: (...args: unknown[]) => fetchHealthOverviewMock(...args),
    fetchHealthGlobalIncidents: (...args: unknown[]) => fetchHealthGlobalIncidentsMock(...args),
    runHealthchecks: (...args: unknown[]) => runHealthchecksMock(...args),
  };
});

describe("EndpointStatusPage latency warning threshold", () => {
  it("keeps small above-average latency variations unflagged", () => {
    expect(isLatencyMeaningfullyAboveAverage(38, 36)).toBe(false);
  });

  it("flags latency only after the 10 percent and 10 ms thresholds are both met", () => {
    expect(isLatencyMeaningfullyAboveAverage(112, 100)).toBe(true);
    expect(isLatencyMeaningfullyAboveAverage(120, 111)).toBe(false);
    expect(isLatencyMeaningfullyAboveAverage(109, 100)).toBe(false);
  });

  it("does not flag missing latency samples", () => {
    expect(isLatencyMeaningfullyAboveAverage(null, 100)).toBe(false);
    expect(isLatencyMeaningfullyAboveAverage(112, null)).toBe(false);
    expect(isLatencyMeaningfullyAboveAverage(undefined, 100)).toBe(false);
    expect(isLatencyMeaningfullyAboveAverage(112, undefined)).toBe(false);
  });
});

describe("EndpointStatusPage incidents table", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runHealthchecksMock.mockResolvedValue(undefined);
    fetchHealthLatencyOverviewMock.mockResolvedValue({
      generated_at: "2026-03-22T10:05:00Z",
      window: "day",
      start: "2026-03-21T10:05:00Z",
      end: "2026-03-22T10:05:00Z",
      endpoints: [
        {
          endpoint_id: 1,
          name: "Ceph Paris",
          endpoint_url: "https://s3.paris.example.test",
          status: "down",
          checked_at: "2026-03-22T10:00:00Z",
          latency_ms: null,
          check_mode: "http",
          min_latency_ms: null,
          avg_latency_ms: null,
          max_latency_ms: null,
        },
        {
          endpoint_id: 2,
          name: "Ceph Lyon",
          endpoint_url: "https://s3.lyon.example.test",
          status: "degraded",
          checked_at: "2026-03-22T10:00:00Z",
          latency_ms: 180,
          check_mode: "s3",
          min_latency_ms: 80,
          avg_latency_ms: 110,
          max_latency_ms: 220,
        },
      ],
    });
    fetchHealthOverviewMock.mockResolvedValue({
      generated_at: "2026-03-22T10:05:00Z",
      window: "week",
      start: "2026-03-15T10:05:00Z",
      end: "2026-03-22T10:05:00Z",
      endpoints: [],
    });
    fetchHealthGlobalIncidentsMock.mockResolvedValue({
      window: "half_year",
      start: "2025-09-22T10:05:00Z",
      end: "2026-03-22T10:05:00Z",
      total: 2,
      incidents: [
        {
          endpoint_id: 1,
          endpoint_name: "Ceph Paris",
          endpoint_url: "https://s3.paris.example.test",
          status: "down",
          start: "2026-03-22T09:00:00Z",
          end: null,
          duration_minutes: null,
          check_mode: "http",
          check_type: "availability",
          scope: "endpoint",
        },
        {
          endpoint_id: 2,
          endpoint_name: "Ceph Lyon",
          endpoint_url: "https://s3.lyon.example.test",
          status: "degraded",
          start: "2026-03-21T08:00:00Z",
          end: "2026-03-21T08:12:00Z",
          duration_minutes: 12,
          check_mode: "s3",
          check_type: "latency",
          scope: "endpoint",
        },
      ],
    });
  });

  it("renders incidents through the shared responsive table and applies the global status filter", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <EndpointStatusPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(fetchHealthGlobalIncidentsMock).toHaveBeenCalledWith("half_year", 300);
    });

    const table = screen.getByRole("table");
    expect(table).toHaveClass("responsive-data-table");
    expect(within(table).getByText("Ceph Paris").closest("td")).toHaveAttribute("data-mobile-primary", "true");
    expect(within(table).getByText("Down").closest("td")).toHaveAttribute("data-label", "Status");
    expect(within(table).getByText("Ongoing").closest("td")).toHaveAttribute("data-label", "End");
    expect(within(table).getByText("LATENCY · ENDPOINT · S3").closest("td")).toHaveAttribute("data-label", "Type");

    await user.click(screen.getByRole("button", { name: /Down\s+1/ }));

    expect(within(table).getByText("Ceph Paris")).toBeInTheDocument();
    expect(within(table).queryByText("Ceph Lyon")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 2 loaded incidents matching down")).toBeInTheDocument();
  });
});
