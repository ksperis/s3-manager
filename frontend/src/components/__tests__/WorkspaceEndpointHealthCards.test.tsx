import { render, screen, within } from "@testing-library/react";
import type { WorkspaceEndpointHealthOverviewResponse } from "../../api/healthchecks";
import WorkspaceEndpointHealthCards from "../WorkspaceEndpointHealthCards";

const workspaceHealth: WorkspaceEndpointHealthOverviewResponse = {
  generated_at: "2026-03-12T13:00:00Z",
  incident_highlight_minutes: 720,
  endpoint_count: 1,
  up_count: 0,
  degraded_count: 0,
  down_count: 1,
  unknown_count: 0,
  endpoints: [
    {
      endpoint_id: 10,
      name: "Primary endpoint",
      endpoint_url: "https://s3.example.com",
      status: "down",
      checked_at: "2026-03-12T12:59:00Z",
      latency_ms: null,
      check_mode: "http",
    },
  ],
  incidents: [
    {
      endpoint_id: 10,
      endpoint_name: "Primary endpoint",
      endpoint_url: "https://s3.example.com",
      status: "down",
      start: "2026-03-12T12:30:00Z",
      end: null,
      duration_minutes: 30,
      check_mode: "http",
      ongoing: true,
      recent: true,
    },
    {
      endpoint_id: 10,
      endpoint_name: "Primary endpoint",
      endpoint_url: "https://s3.example.com",
      status: "down",
      start: "2026-03-12T10:00:00Z",
      end: "2026-03-12T10:20:00Z",
      duration_minutes: 20,
      check_mode: "http",
      ongoing: false,
      recent: true,
    },
  ],
};

describe("WorkspaceEndpointHealthCards", () => {
  it("shows only incident state badges while keeping endpoint status badges", () => {
    render(
      <WorkspaceEndpointHealthCards
        data={workspaceHealth}
        loading={false}
        showStatusCounters={false}
      />
    );

    const title = screen.getByText("Ongoing / Recent Incidents");
    const incidentsSection = title.closest("section");
    expect(incidentsSection).not.toBeNull();
    const incidents = within(incidentsSection as HTMLElement);

    expect(incidents.getByText("In progress")).toBeInTheDocument();
    expect(incidents.getByText("Resolved")).toBeInTheDocument();
    expect(incidents.queryByText("Down")).not.toBeInTheDocument();
    expect(incidents.queryByText("Degraded")).not.toBeInTheDocument();
    expect(incidents.queryByText("Up")).not.toBeInTheDocument();
    expect(incidents.queryByText("Unknown")).not.toBeInTheDocument();
    expect(screen.getAllByText("Down")).toHaveLength(1);
  });
});
