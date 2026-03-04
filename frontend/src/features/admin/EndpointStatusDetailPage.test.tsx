import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type {
  EndpointHealthIncidentsResponse,
  EndpointHealthRawChecksResponse,
  EndpointHealthSeries,
  EndpointHealthSummaryResponse,
} from "../../api/healthchecks";
import EndpointStatusDetailPage from "./EndpointStatusDetailPage";

const fetchHealthSummaryMock = vi.fn<() => Promise<EndpointHealthSummaryResponse>>();
const fetchHealthSeriesMock = vi.fn<(endpointId: number, window: string) => Promise<EndpointHealthSeries>>();
const fetchHealthIncidentsMock = vi.fn<(endpointId: number, window: string) => Promise<EndpointHealthIncidentsResponse>>();
const fetchHealthRawChecksMock = vi.fn<
  (endpointId: number, window: string, page?: number, pageSize?: number) => Promise<EndpointHealthRawChecksResponse>
>();
const runHealthchecksMock = vi.fn();

vi.mock("../../api/healthchecks", () => ({
  fetchHealthSummary: () => fetchHealthSummaryMock(),
  fetchHealthSeries: (endpointId: number, window: string) => fetchHealthSeriesMock(endpointId, window),
  fetchHealthIncidents: (endpointId: number, window: string) => fetchHealthIncidentsMock(endpointId, window),
  fetchHealthRawChecks: (endpointId: number, window: string, page?: number, pageSize?: number) =>
    fetchHealthRawChecksMock(endpointId, window, page, pageSize),
  runHealthchecks: () => runHealthchecksMock(),
}));

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/admin/endpoint-status/42"]}>
      <Routes>
        <Route path="/admin/endpoint-status/:endpointId" element={<EndpointStatusDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("EndpointStatusDetailPage latency chart", () => {
  beforeEach(() => {
    const summaryPayload: EndpointHealthSummaryResponse = {
      generated_at: "2026-03-04T12:00:00.000Z",
      endpoints: [
        {
          endpoint_id: 42,
          name: "Zone-2",
          endpoint_url: "https://s3-z2.example.test",
          status: "down",
          checked_at: "2026-03-04T11:55:00.000Z",
          latency_ms: null,
          http_status: null,
          error_message: "Connection timeout",
          check_mode: "http",
          check_target_url: "https://s3-z2.example.test",
        },
      ],
    };

    const weekSeries: EndpointHealthSeries = {
      endpoint_id: 42,
      window: "week",
      start: "2026-03-04T00:00:00.000Z",
      end: "2026-03-04T01:00:00.000Z",
      data_points: 3,
      check_mode: "http",
      check_target_url: "https://s3-z2.example.test",
      check_type: "availability",
      scope: "endpoint",
      resolution_seconds: 300,
      series: [
        { timestamp: "2026-03-04T00:00:00.000Z", status: "degraded", latency_ms: null, http_status: 503, check_mode: "http" },
        { timestamp: "2026-03-04T00:20:00.000Z", status: "down", latency_ms: null, http_status: null, check_mode: "http" },
        { timestamp: "2026-03-04T00:40:00.000Z", status: "down", latency_ms: null, http_status: null, check_mode: "http" },
      ],
      daily: [],
    };

    const monthSeries: EndpointHealthSeries = {
      ...weekSeries,
      window: "month",
      daily: [
        { day: "2026-03-03", ok_count: 5, degraded_count: 2, down_count: 1, avg_latency_ms: 780, p95_latency_ms: 1500 },
        { day: "2026-03-04", ok_count: 4, degraded_count: 1, down_count: 0, avg_latency_ms: 540, p95_latency_ms: 920 },
      ],
    };

    fetchHealthSummaryMock.mockResolvedValue(summaryPayload);
    fetchHealthSeriesMock.mockImplementation(async (_endpointId: number, window: string) => (window === "month" ? monthSeries : weekSeries));
    fetchHealthIncidentsMock.mockResolvedValue({
      endpoint_id: 42,
      window: "week",
      check_mode: "http",
      check_type: "availability",
      scope: "endpoint",
      incidents: [],
    });
    fetchHealthRawChecksMock.mockResolvedValue({
      endpoint_id: 42,
      window: "week",
      start: "2026-03-04T00:00:00.000Z",
      end: "2026-03-04T01:00:00.000Z",
      page: 1,
      page_size: 25,
      total: 0,
      checks: [],
    });
    runHealthchecksMock.mockResolvedValue({});
  });

  it("shows outage overlays legend, explicit no-latency message, and daily subtitle on 30d", async () => {
    renderPage();

    expect(await screen.findByText(/latency from 5-minute rollups\./i)).toBeInTheDocument();
    expect(screen.getByText("Degraded window")).toBeInTheDocument();
    expect(screen.getByText("Down window")).toBeInTheDocument();
    expect(screen.getByText(/No measurable latency in this range/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "30d" }));
    await waitFor(() => {
      expect(fetchHealthSeriesMock).toHaveBeenCalledWith(42, "month");
    });
    expect(await screen.findByText(/latency from daily aggregates\./i)).toBeInTheDocument();
  });
});
